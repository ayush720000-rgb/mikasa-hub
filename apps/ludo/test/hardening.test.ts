import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LudoManager, MAX_GAMES } from '../server/ludoManager';
import { redactSecrets, safeError } from '../server/redact';
import { pgPoolConfig } from '../server/pgConfig';

const HOUR = 60 * 60_000;

// ---- log redaction ------------------------------------------------------------------------
test('redact: bot token inside a Telegram API URL is removed', () => {
  const out = redactSecrets('GET https://api.telegram.org/bot1234567890:AAH-secret_value1234567890abcdefghij/getChat failed');
  assert.ok(!out.includes('AAH-secret'));
  assert.ok(out.includes('/bot<redacted>/getChat'));
});

test('redact: file URLs, bare tokens and configured secrets are removed', () => {
  assert.ok(!redactSecrets('https://api.telegram.org/file/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/p.jpg').includes('ABCDEF'));
  assert.ok(!redactSecrets('123456789:AAHdLMNOPQRSTUVWXYZabcdefghijklmnop').includes('AAHd'));
  process.env.IDENTITY_SECRET = 'a-private-signing-secret';
  try {
    assert.ok(!redactSecrets('leaked a-private-signing-secret here').includes('private'));
  } finally {
    delete process.env.IDENTITY_SECRET;
  }
});

test('safeError: keeps the message and the cause, redacted', () => {
  const err = new Error('fetch failed', { cause: new Error('bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef refused') });
  const out = safeError(err);
  assert.ok(out.includes('fetch failed') && out.includes('refused'));
  assert.ok(!out.includes('ABCDEF'));
});

// ---- game cleanup -------------------------------------------------------------------------
function fakeSocket(open = true) {
  return { readyState: open ? 1 : 3 } as any; // 1 = OPEN, 3 = CLOSED in the ws library
}

test('sweepGames: keeps active games, removes old ended and abandoned ones', () => {
  const m = new LudoManager();
  const active = m.getOrCreateGame('ACTIVE', { id: 'tg_1', name: 'A' });
  const ended = m.getOrCreateGame('ENDED1', { id: 'tg_2', name: 'B' });
  const abandoned = m.getOrCreateGame('GONE01', { id: 'tg_3', name: 'C' });
  m.registerConnection('ACTIVE', fakeSocket());
  m.registerConnection('ENDED1', fakeSocket());
  ended.status = 'ended';
  void active; void abandoned;

  assert.equal(m.sweepGames(Date.now() + 10 * 60_000), 0, 'nothing expires after 10 minutes');
  assert.equal(m.games.size, 3);

  // 90 minutes: the game with no open connection goes
  assert.equal(m.sweepGames(Date.now() + 90 * 60_000), 1);
  assert.ok(m.games.has('ACTIVE') && m.games.has('ENDED1') && !m.games.has('GONE01'));

  // 3 hours: the ended game goes too, the one with a player connected stays
  assert.equal(m.sweepGames(Date.now() + 3 * HOUR), 1);
  assert.ok(m.games.has('ACTIVE') && !m.games.has('ENDED1'));
  assert.equal(m.connections.has('ENDED1'), false, 'its connection set is released');

  // 25 hours: nothing lives that long
  assert.equal(m.sweepGames(Date.now() + 25 * HOUR), 1);
  assert.equal(m.games.size, 0);
});

test('sweepGames: closed sockets do not count as presence, and removal clears the turn timer', () => {
  const m = new LudoManager();
  m.getOrCreateGame('QUIET1', { id: 'tg_9', name: 'Z' });
  m.registerConnection('QUIET1', fakeSocket(false));
  let fired = false;
  m.timers.set('QUIET1', setTimeout(() => { fired = true; }, 60_000));
  assert.equal(m.sweepGames(Date.now() + 2 * HOUR), 1);
  assert.equal(m.timers.has('QUIET1'), false);
  assert.equal(fired, false);
});

test('removeConnection: an emptied room releases its connection set', () => {
  const m = new LudoManager();
  const ws = fakeSocket();
  m.registerConnection('ROOM01', ws);
  m.removeConnection('ROOM01', ws, null);
  assert.equal(m.connections.has('ROOM01'), false);
});

test('MAX_GAMES is a sane bound', () => {
  assert.ok(MAX_GAMES >= 100 && MAX_GAMES <= 10_000);
});

// ---- database settings --------------------------------------------------------------------
test('pgPoolConfig: sslmode becomes explicit TLS settings, other cases pass through', () => {
  assert.deepEqual(pgPoolConfig('postgresql://u:p@h/db?sslmode=require'),
    { connectionString: 'postgresql://u:p@h/db', ssl: { rejectUnauthorized: true } });
  assert.deepEqual(pgPoolConfig('postgresql://u:p@h/db?sslmode=disable'),
    { connectionString: 'postgresql://u:p@h/db', ssl: false });
  assert.deepEqual(pgPoolConfig('postgresql://u:p@h/db?sslmode=no-verify'),
    { connectionString: 'postgresql://u:p@h/db', ssl: { rejectUnauthorized: false } });
  assert.deepEqual(pgPoolConfig('postgresql://u:p@h/db'), { connectionString: 'postgresql://u:p@h/db' });
  assert.deepEqual(pgPoolConfig('not a url'), { connectionString: 'not a url' });
  const compat = 'postgresql://u:p@h/db?uselibpqcompat=true&sslmode=require';
  assert.deepEqual(pgPoolConfig(compat), { connectionString: compat });
});
