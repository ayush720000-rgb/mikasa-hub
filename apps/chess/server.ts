import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { RoomManager, MAX_ROOMS } from './src/server/roomManager';
import { TelegramBotService } from './src/server/telegramBot';
import { verifyTelegramInitData } from './src/server/telegramAuth';
import { issueIdentityToken, resolveSocketIdentity, verifyIdentityToken } from './src/server/identity';
import crypto from 'crypto';
import { GameRules, UserProfile, RoomState } from './src/types/chess';
import { statsStore } from './src/server/statsStore';
import { safeError } from './src/server/redact';
import { cleanAvatar, cleanChatMessage, cleanGameRules, cleanText, cleanUserProfile, MAX_EMOJI, MAX_NAME } from './src/server/sanitize';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Socket.IO does not catch exceptions thrown by event handlers, so one malformed message
 * would crash the process and drop every live game. Each handler runs inside this guard.
 */
function guardSocketHandlers(socket: Socket): void {
  type Listener = (...args: any[]) => void;
  const register = socket.on.bind(socket) as (event: string, listener: Listener) => Socket;
  (socket as unknown as { on: typeof register }).on = (event, listener) =>
    register(event, (...args: any[]) => {
      try {
        listener(...args);
      } catch (err) {
        console.error(`[socket] "${event}" handler failed:`, safeError(err));
      }
    });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  // Only the app's own origin (and Telegram's web clients) may open cross-origin connections.
  const isProductionEnv = process.env.NODE_ENV === 'production';
  const allowedOrigins = new Set<string>(['https://web.telegram.org', 'https://telegram.org']);
  const configuredApp = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (configuredApp) {
    try { allowedOrigins.add(new URL(configuredApp).origin); } catch { /* invalid APP_URL */ }
  }
  if (!isProductionEnv) {
    allowedOrigins.add('http://localhost:3000');
    allowedOrigins.add('http://localhost:5173');
  }

  const io = new SocketIOServer(server, {
    cors: {
      origin: (requestOrigin, callback) => callback(null, !requestOrigin || allowedOrigins.has(requestOrigin)),
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
  const roomManager = new RoomManager();
  const telegramBot = new TelegramBotService(appUrl);

  // Hook RoomManager asynchronous events (AI bot moves, automated timer resolutions) to Socket.io
  roomManager.setOnRoomStateChanged((room, sound) => {
    if (room.status === 'finished') {
      // Recording is idempotent, so repeated finished-state events for one game are harmless.
      statsStore.recordFinishedGame(room).catch((err) =>
        console.error('[stats] could not record finished game:', safeError(err)));
    }
    io.to(`room:${room.code.toUpperCase()}`).emit('room_state', room);
    if (sound) {
      io.to(`room:${room.code.toUpperCase()}`).emit('move_sound', sound);
    }
  });

  app.use(express.json());

  // REST endpoints
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/api/bot-info', (_req, res) => {
    res.json(telegramBot.getInfo());
  });

  // Verify Telegram Mini App initData with the bot token before trusting user details.
  app.post('/api/telegram-auth', (req, res) => {
    const initData = typeof req.body?.initData === 'string' ? req.body.initData : '';
    const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
    const result = verifyTelegramInitData(initData, token);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({
      ok: true,
      user: result.user,
      identityToken: issueIdentityToken(`tg:${result.user.id}`),
    });
  });

  // Browser guests get a server-minted ID bound to a signed token. A returning guest sends
  // its token back and keeps the same ID.
  app.post('/api/guest-session', (req, res) => {
    const resumed = verifyIdentityToken(req.body?.token);
    const subject = resumed && resumed.startsWith('guest_')
      ? resumed
      : `guest_${crypto.randomBytes(8).toString('hex')}`;
    return res.json({ id: subject, token: issueIdentityToken(subject) });
  });

  app.get('/api/lobby/:code', (req, res) => {
    const room = roomManager.getRoom(req.params.code);
    if (!room) {
      return res.status(404).json({ error: 'Lobby not found' });
    }
    return res.json(room);
  });

  app.get('/api/user-avatar/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    const avatar = await telegramBot.fetchUserAvatarBase64(userId);
    res.json({ avatarUrl: avatar || null });
  });

  // Match history for the signed-in player. The identity token is the only way to name a player.
  app.get('/api/stats', async (req, res) => {
    const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const identity = resolveSocketIdentity(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!identity) return res.status(401).json({ error: 'unauthenticated' });
    try {
      return res.json(await statsStore.getStats(String(identity.id)));
    } catch (err) {
      console.error('[stats] could not read stats:', safeError(err));
      return res.status(503).json({ error: 'stats unavailable' });
    }
  });

  // Every socket must present a server-signed identity token. Nothing else identifies a player.
  io.use((socket, next) => {
    const identity = resolveSocketIdentity(socket.handshake.auth?.token);
    if (!identity) return next(new Error('unauthenticated'));
    socket.data.playerId = identity.id;
    return next();
  });

  // Socket.io handlers. Player IDs always come from socket.data.playerId, never from a payload.
  io.on('connection', (socket: Socket) => {
    guardSocketHandlers(socket);
    const myId = socket.data.playerId as string | number;
    let currentRoomCode: string | null = null;
    let currentUser: UserProfile | null = null;

    socket.on('create_room', (data: { user: UserProfile; gameRules: GameRules }, callback) => {
      if (roomManager.rooms.size >= MAX_ROOMS) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'The server is full right now. Try again in a few minutes.' });
        }
        return;
      }
      const user = cleanUserProfile(data?.user, myId);
      const room = roomManager.createRoom(user, cleanGameRules(data?.gameRules));
      currentRoomCode = room.code;
      currentUser = user;
      socket.join(`room:${room.code}`);

      if (typeof callback === 'function') {
        callback({ success: true, room });
      }
      io.to(`room:${room.code}`).emit('room_state', room);
    });

    socket.on(
      'join_room',
      (
        data: { roomCode: string; user: UserProfile; asSpectator?: boolean },
        callback
      ) => {
        const user = cleanUserProfile(data?.user, myId);
        const result = roomManager.joinRoom(data.roomCode, user, data.asSpectator === true);
        if ('error' in result && !('room' in result)) {
          if (typeof callback === 'function') {
            callback({ success: false, error: result.error });
          }
          return;
        }

        const successResult = result as {
          room: RoomState;
          role: 'white' | 'black' | 'spectator';
        };

        currentRoomCode = data.roomCode.toUpperCase();
        currentUser = user;
        socket.join(`room:${currentRoomCode}`);

        if (typeof callback === 'function') {
          callback({ success: true, room: successResult.room, role: successResult.role });
        }
        io.to(`room:${currentRoomCode}`).emit('room_state', successResult.room);
      }
    );

    socket.on(
      'make_move',
      (
        data: {
          roomCode: string;
          move: { from: string; to: string; promotion?: string };
        },
        callback
      ) => {
        const res = roomManager.makeMove(data.roomCode, myId, data.move);
        if (typeof callback === 'function') {
          callback(res);
        }
        if (res.success && res.room) {
          io.to(`room:${data.roomCode.toUpperCase()}`).emit('room_state', res.room);
          io.to(`room:${data.roomCode.toUpperCase()}`).emit('move_sound', {
            isCapture: res.room.lastMove?.san?.includes('x') || false,
            isCheck:
              res.room.lastMove?.san?.includes('+') ||
              res.room.lastMove?.san?.includes('#') ||
              false,
          });
        } else {
          // If move rejected, restore client's board to authoritative server FEN
          const current = roomManager.getRoom(data.roomCode);
          if (current) {
            socket.emit('room_state', current);
          }
        }
      }
    );

    socket.on('offer_draw', (data: { roomCode: string }) => {
      const room = roomManager.offerDraw(data.roomCode, myId);
      if (room) {
        io.to(`room:${data.roomCode.toUpperCase()}`).emit('room_state', room);
        io.to(`room:${data.roomCode.toUpperCase()}`).emit('draw_offered', {
          offeredByUserId: myId,
        });
      }
    });

    socket.on('respond_draw', (data: { roomCode: string; accept: boolean }) => {
      const room = roomManager.respondDraw(data.roomCode, myId, data.accept);
      if (room) {
        io.to(`room:${data.roomCode.toUpperCase()}`).emit('room_state', room);
      }
    });

    socket.on('resign', (data: { roomCode: string }) => {
      const room = roomManager.resign(data.roomCode, myId);
      if (room) {
        io.to(`room:${data.roomCode.toUpperCase()}`).emit('room_state', room);
        io.to(`room:${data.roomCode.toUpperCase()}`).emit('player_resigned', {
          userId: myId,
        });
      }
    });

    socket.on(
      'send_chat',
      (data: {
        roomCode: string;
        message: {
          senderName: string;
          senderAvatar?: string;
          isSpectator: boolean;
          text: string;
          replyTo?: { id: string; senderName: string; text: string } | null;
        };
      }) => {
        const clean = cleanChatMessage(data?.message);
        if (!clean) return;
        const msg = roomManager.addChatMessage(data.roomCode, { ...clean, senderId: myId });
        if (msg) {
          const room = roomManager.getRoom(data.roomCode);
          if (room) {
            io.to(`room:${data.roomCode.toUpperCase()}`).emit('room_state', room);
            io.to(`room:${data.roomCode.toUpperCase()}`).emit('new_chat_message', msg);
          }
        }
      }
    );

    socket.on(
      'react_chat',
      (data: {
        roomCode: string;
        messageId: string;
        emoji: string;
        user?: { name?: string; avatarUrl?: string };
      }) => {
        const emoji = cleanText(data?.emoji, MAX_EMOJI);
        if (!emoji) return;
        const reactorName = cleanText(data?.user?.name, MAX_NAME) || (currentUser ? currentUser.name : 'Player');
        const reactorAvatar = cleanAvatar(data?.user?.avatarUrl) || (currentUser ? currentUser.avatarUrl : undefined);

        const room = roomManager.addReaction(
          data.roomCode,
          cleanText(data.messageId, 64),
          emoji,
          {
            userId: myId,
            name: reactorName,
            avatarUrl: reactorAvatar,
          }
        );
        if (room) {
          io.to(`room:${data.roomCode.toUpperCase()}`).emit('room_state', room);
        }
      }
    );

    socket.on('update_player_profile', (data: { roomCode: string; user: UserProfile }) => {
      if (!data?.roomCode || !data?.user) return;
      const user = cleanUserProfile(data.user, myId);
      currentUser = user;
      const room = roomManager.updatePlayerProfile(data.roomCode, user);
      if (room) {
        io.to(`room:${data.roomCode.toUpperCase()}`).emit('room_state', room);
      }
    });

    socket.on('set_typing', (data: { roomCode: string; isTyping: boolean }) => {
      if (!data?.roomCode) return;
      socket.to(`room:${data.roomCode.toUpperCase()}`).emit('player_typing_status', {
        userId: myId,
        isTyping: Boolean(data.isTyping),
      });
    });

    socket.on('set_presence', (data: { roomCode: string; isAway: boolean }) => {
      if (!data?.roomCode) return;
      socket.to(`room:${data.roomCode.toUpperCase()}`).emit('player_presence_status', {
        userId: myId,
        isAway: Boolean(data.isAway),
      });
    });

    socket.on('request_rematch', (data: { roomCode: string }, callback) => {
      if (!data?.roomCode) return;
      const room = roomManager.rematchMatch(data.roomCode, myId);
      if (room) {
        io.to(`room:${data.roomCode.toUpperCase()}`).emit('room_state', room);
        if (typeof callback === 'function') callback({ success: true, room });
      } else {
        if (typeof callback === 'function') callback({ success: false });
      }
    });

    socket.on('leave_room', (data: { roomCode?: string }) => {
      const code = (data?.roomCode || currentRoomCode)?.toUpperCase();
      if (code) {
        socket.leave(`room:${code}`);
        const updated = roomManager.handleUserDisconnect(code, myId);
        if (updated) {
          io.to(`room:${code}`).emit('room_state', updated);
        }
        io.to(`room:${code}`).emit('player_presence_status', {
          userId: myId,
          isAway: true,
        });
        io.to(`room:${code}`).emit('player_typing_status', {
          userId: myId,
          isTyping: false,
        });
      }
      if (currentRoomCode === code) {
        currentRoomCode = null;
      }
    });

    socket.on('disconnect', () => {
      if (currentRoomCode) {
        io.to(`room:${currentRoomCode}`).emit('player_presence_status', {
          userId: myId,
          isAway: true,
        });
        io.to(`room:${currentRoomCode}`).emit('player_typing_status', {
          userId: myId,
          isTyping: false,
        });
        const updated = roomManager.handleUserDisconnect(currentRoomCode, myId);
        if (updated) {
          io.to(`room:${currentRoomCode}`).emit('room_state', updated);
        }
      }
    });
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  if (!isProduction) {
    // Vite is a build tool: load it only in development so production starts lighter.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  await statsStore.init().catch((err) =>
    console.error('[stats] Postgres unavailable. Stats will not persist:', safeError(err)));

  server.listen(port, '0.0.0.0', () => {
    console.log(`ChessNow fullstack server running on http://0.0.0.0:${port}`);
  });

  // Stop cleanly and exit. A SIGTERM handler that does not exit would keep the process alive.
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    telegramBot.stop();
    roomManager.destroy();
    io.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', safeError(err));
  process.exit(1); // let the supervisor restart a server that failed to start
});
