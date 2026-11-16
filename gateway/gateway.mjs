// Mikasa hub: one public port on Render, three bots behind it.
//
//   /chess/...  -> Chess app (Node/Express + Socket.IO + Telegram bot)
//   /ludo/...   -> Ludo app  (Node/Express + WebSocket + Telegram bot)
//   /uno/...    -> UNO bot   (Python polling bot, health endpoint only)
//   /health     -> hub status (always 200 while the hub itself is alive)
//
// Each app runs as its own child process on a private 127.0.0.1 port. A child that
// crashes is restarted with backoff, and the hub keeps serving the other apps meanwhile.
// Only Node built-ins are used, so the hub has no dependencies to break.

import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APPS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps');
const PUBLIC_PORT = Number(process.env.PORT) || 10000;
const PUBLIC_URL = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const PYTHON = process.env.PYTHON || 'python3';
const TSX = (dir) => path.join(dir, 'node_modules', '.bin', 'tsx');
const DATA_DIR = path.resolve(APPS_DIR, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function log(tag, msg) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

// ---- service definitions --------------------------------------------------------------
// Env var names are prefixed per bot so three different tokens can live in one service.
const services = [
  {
    name: 'chess',
    prefix: '/chess',
    port: 3101,
    cwd: path.join(APPS_DIR, 'chess'),
    command: () => [TSX(path.join(APPS_DIR, 'chess')), ['server.ts']],
    env: () => ({
      APP_BASE: '/chess',
      TELEGRAM_BOT_TOKEN: process.env.CHESS_BOT_TOKEN || '',
      BOT_USERNAME: process.env.CHESS_BOT_USERNAME || '',
      APP_URL: PUBLIC_URL ? `${PUBLIC_URL}/chess` : 'http://localhost:3101/chess',
      MAIN_BOT_USERNAME: process.env.MAIN_BOT_USERNAME || 'Ig_MikasaBot',
    }),
    required: [],
  },
  {
    name: 'ludo',
    prefix: '/ludo',
    port: 3102,
    cwd: path.join(APPS_DIR, 'ludo'),
    command: () => [TSX(path.join(APPS_DIR, 'ludo')), ['server.ts']],
    env: () => ({
      APP_BASE: '/ludo',
      TELEGRAM_BOT_TOKEN: process.env.LUDO_BOT_TOKEN || '',
      BOT_USERNAME: process.env.LUDO_BOT_USERNAME || '',
      MINIAPP_SHORT_NAME: process.env.LUDO_MINIAPP_SHORT_NAME || 'ludo',
      APP_URL: PUBLIC_URL ? `${PUBLIC_URL}/ludo` : 'http://localhost:3102/ludo',
      PUBLIC_URL: PUBLIC_URL ? `${PUBLIC_URL}/ludo` : '',
      MAIN_BOT_USERNAME: process.env.MAIN_BOT_USERNAME || 'Ig_MikasaBot',
    }),
    required: [],
  },
  {
    name: 'uno',
    prefix: '/uno',
    port: 3103,
    cwd: path.join(APPS_DIR, 'uno'),
    command: () => [PYTHON, ['bot.py']],
    env: () => ({
      TOKEN: process.env.UNO_BOT_TOKEN || '',
      PORT: '3103',
      UNO_DB: process.env.UNO_DB || path.join(DATA_DIR, 'uno.sqlite3'),
    }),
    required: ['UNO_BOT_TOKEN'],
  },
];

// Per-service runtime state.
for (const svc of services) {
  Object.assign(svc, {
    child: null,
    ready: false,
    disabled: false,
    restarts: 0,
    startedAt: 0,
    lastExit: null,
    timer: null,
  });
}

// ---- supervision -----------------------------------------------------------------------
function waitForPort(port, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

// Signal the whole process group: `tsx` starts its own Node child, and killing only the
// wrapper would leave that child holding the port, so the next restart could not bind.
function killTree(child, signal) {
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // group already gone
  }
}

function startService(svc) {
  if (svc.disabled || svc.child) return;

  const missing = svc.required.filter((key) => !process.env[key]);
  if (missing.length) {
    svc.disabled = true;
    log(svc.name, `disabled: missing ${missing.join(', ')}. The other apps keep running.`);
    return;
  }

  const [cmd, args] = svc.command();
  const env = { ...process.env, ...svc.env(), PORT: String(svc.port), NODE_ENV: 'production' };
  // Keep the hub's own Render variables away from the children.
  delete env.RENDER_EXTERNAL_URL;

  log(svc.name, `starting on 127.0.0.1:${svc.port}`);
  const child = spawn(cmd, args, { cwd: svc.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  svc.child = child;
  svc.startedAt = Date.now();

  const pipe = (stream) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.trim()) console.log(`[${svc.name}] ${line}`);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  waitForPort(svc.port).then((ok) => {
    if (svc.child === child) {
      svc.ready = ok;
      if (ok) log(svc.name, 'ready');
      else log(svc.name, 'did not open its port within 60s');
    }
  });

  child.on('error', (err) => log(svc.name, `failed to start: ${err.message}`));

  child.on('exit', (code, signal) => {
    killTree(child, 'SIGKILL'); // clear any leftover grandchildren before the port is reused
    svc.child = null;
    svc.ready = false;
    const uptime = Date.now() - svc.startedAt;
    svc.lastExit = { code, signal, at: new Date().toISOString() };
    if (uptime > 120_000) svc.restarts = 0; // a long healthy run resets the backoff
    svc.restarts += 1;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(svc.restarts, 6));
    if (shuttingDown) {
      log(svc.name, `stopped (code=${code}, signal=${signal})`);
      return;
    }
    log(svc.name, `exited (code=${code}, signal=${signal}). Restarting in ${delay / 1000}s.`);
    svc.timer = setTimeout(() => startService(svc), delay);
  });
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('hub', `${signal} received, stopping children`);
  for (const svc of services) {
    clearTimeout(svc.timer);
    killTree(svc.child, 'SIGTERM');
  }
  setTimeout(() => {
    for (const svc of services) killTree(svc.child, 'SIGKILL');
    process.exit(0);
  }, 5000).unref();
  // Exit as soon as all children have stopped.
  const check = setInterval(() => {
    if (services.every((s) => !s.child)) process.exit(0);
  }, 200);
  check.unref();
}

// ---- routing ---------------------------------------------------------------------------
function matchService(url) {
  for (const svc of services) {
    if (url === svc.prefix || url.startsWith(`${svc.prefix}/`) || url.startsWith(`${svc.prefix}?`)) {
      let rest = url.slice(svc.prefix.length);
      if (rest === '') rest = '/';
      else if (rest.startsWith('?')) rest = `/${rest}`;
      return { svc, rest };
    }
  }
  return null;
}

function statusPayload() {
  return {
    status: 'ok',
    timestamp: Date.now(),
    apps: Object.fromEntries(
      services.map((s) => [
        s.name,
        {
          prefix: s.prefix,
          state: s.disabled ? 'disabled' : s.ready ? 'running' : s.child ? 'starting' : 'restarting',
          restarts: s.restarts,
          lastExit: s.lastExit,
        },
      ])
    ),
  };
}

function sendText(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// Telegram link that opens each bot's Mini App directly (t.me/<bot>/<short-name>).
// Falls back to the web page when the bot handle is not configured.
function openLink(svc) {
  const bot = (process.env[`${svc.name.toUpperCase()}_BOT_USERNAME`] || '').replace(/^@/, '');
  if (svc.name === 'uno') {
    return bot ? { href: `https://t.me/${bot}`, label: 'Open UNO bot' } : null;
  }
  const short = process.env[`${svc.name.toUpperCase()}_MINIAPP_SHORT_NAME`] || (svc.name === 'chess' ? 'Chess' : 'ludo');
  if (bot) return { href: `https://t.me/${bot}/${short}`, label: `Open ${svc.name} Mini App` };
  return { href: `${svc.prefix}/`, label: `Open ${svc.name}` };
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function landingPage() {
  const rows = services
    .map((s) => {
      const state = s.disabled ? 'disabled (no token)' : s.ready ? 'running' : 'starting';
      const link = openLink(s);
      const action = link ? ` &middot; <a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>` : '';
      return `<li><strong>${escapeHtml(s.name)}</strong> - ${state}${action}</li>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mikasa bots</title><body style="font-family:system-ui;max-width:560px;margin:40px auto;padding:0 16px">
<h1>Mikasa bots</h1><ul>${rows}</ul></body>`;
}

function proxyHttp(req, res, svc, rest) {
  if (!svc.ready) {
    return sendText(res, 503, `${svc.name} is starting. Try again in a few seconds.`);
  }
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: svc.port,
      method: req.method,
      path: rest,
      headers: { ...req.headers, 'x-forwarded-prefix': svc.prefix },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) sendText(res, 502, `${svc.name} is unavailable right now.`);
    else res.destroy();
  });
  // If the browser goes away before the answer is complete, stop the upstream request too.
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  if (pathname === '/health') {
    return sendText(res, 200, JSON.stringify(statusPayload()), 'application/json');
  }
  if (pathname === '/' || pathname === '') {
    return sendText(res, 200, landingPage(), 'text/html; charset=utf-8');
  }

  const match = matchService(url);
  if (!match) return sendText(res, 404, 'Not found');
  proxyHttp(req, res, match.svc, match.rest);
});

// WebSocket and Socket.IO upgrades are forwarded as raw TCP after the handshake.
server.on('upgrade', (req, socket, head) => {
  const match = matchService(req.url || '/');
  if (!match || !match.svc.ready) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(match.svc.port, '127.0.0.1', () => {
    const lines = [`${req.method} ${match.rest} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
});

// ---- boot ------------------------------------------------------------------------------
process.on('uncaughtException', (err) => log('hub', `uncaught exception kept alive: ${err.stack || err}`));
process.on('unhandledRejection', (err) => log('hub', `unhandled rejection kept alive: ${err}`));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
  log('hub', `listening on 0.0.0.0:${PUBLIC_PORT}`);
  for (const svc of services) {
    if (!fs.existsSync(svc.cwd)) {
      log(svc.name, `missing app directory ${svc.cwd}`);
      svc.disabled = true;
      continue;
    }
    startService(svc);
  }
});
