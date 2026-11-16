import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/roomManager';
import { redactSecrets, safeError } from '../src/server/redact';
import {
  cleanAvatar, cleanChatMessage, cleanGameRules, cleanUserProfile, MAX_AVATAR, MAX_CHAT_TEXT, MAX_NAME,
} from '../src/server/sanitize';
import { pgPoolConfig } from '../src/server/pgConfig';

const rules = { timerEnabled: false, initialTimeSec: 600, incrementSec: 0, preferredColor: 'w' as const, isBotGame: false };
const user = (id: string | number, name = 'P') => ({ id, name });

// ---- log redaction ------------------------------------------------------------------------
test('redact: bot token inside a Telegram API URL is removed', () => {
  const text = 'request to https://api.telegram.org/bot1234567890:AAH-secret_value1234567890abcdefghij/getMe failed';
  const out = redactSecrets(text);
  assert.ok(!out.includes('AAH-secret'));
  assert.ok(out.includes('/bot<redacted>/getMe'));
});

test('redact: file download URLs and bare tokens are removed', () => {
  assert.ok(!redactSecrets('https://api.telegram.org/file/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/x.jpg').includes('ABCDEF'));
  assert.ok(!redactSecrets('token is 123456789:AAHdLMNOPQRSTUVWXYZabcdefghijklmnop ok').includes('AAHd'));
});

test('redact: configured secrets are removed from any text', () => {
  process.env.IDENTITY_SECRET = 'my-very-private-secret';
  try {
    assert.ok(!redactSecrets('failed with my-very-private-secret in it').includes('private'));
  } finally {
    delete process.env.IDENTITY_SECRET;
  }
});

test('safeError: includes the cause and redacts both', () => {
  const err = new Error('fetch failed', { cause: new Error('bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef refused') });
  const out = safeError(err);
  assert.ok(out.includes('fetch failed'));
  assert.ok(!out.includes('ABCDEF'));
  assert.equal(safeError('plain'), 'plain');
});

// ---- client data cleaning -----------------------------------------------------------------
test('cleanUserProfile: id comes from the connection, isBot is forced off, sizes are clamped', () => {
  const p = cleanUserProfile({ id: 'someone-else', name: 'x'.repeat(500), isBot: true, avatarUrl: 'javascript:alert(1)' }, 42);
  assert.equal(p.id, 42);
  assert.equal(p.isBot, false);
  assert.equal(p.name.length, MAX_NAME);
  assert.equal(p.avatarUrl, undefined);
  assert.equal('avatarUrl' in p, false);
});

test('cleanUserProfile: junk input still gives a usable profile', () => {
  for (const junk of [undefined, null, 'text', 7, []]) assert.equal(cleanUserProfile(junk, 1).name, 'Player');
});

test('cleanAvatar: accepts data, https and app paths only, and respects the size cap', () => {
  assert.ok(cleanAvatar('data:image/svg+xml;base64,AAAA'));
  assert.ok(cleanAvatar('https://t.me/i/userpic/320/x.jpg'));
  assert.ok(cleanAvatar('/chess/assets/mikasa.jpg'));
  assert.equal(cleanAvatar('//evil.example/x.png'), undefined);
  assert.equal(cleanAvatar('http://insecure.example/x.png'), undefined);
  assert.equal(cleanAvatar('data:image/png;base64,' + 'A'.repeat(MAX_AVATAR)), undefined);
  assert.equal(cleanAvatar(123), undefined);
});

test('cleanGameRules: bad values fall back, untimed games keep 0, limits apply', () => {
  const bad = cleanGameRules({ initialTimeSec: -5, incrementSec: 'x', preferredColor: 'purple', botDifficulty: 'god', isBotGame: 'yes' });
  assert.deepEqual(bad, { timerEnabled: false, initialTimeSec: 0, incrementSec: 0, preferredColor: 'random', isBotGame: false });
  assert.equal(cleanGameRules({ initialTimeSec: 0 }).initialTimeSec, 0);
  assert.equal(cleanGameRules({ initialTimeSec: 999999 }).initialTimeSec, 10800);
  const good = cleanGameRules({ timerEnabled: true, initialTimeSec: 180, incrementSec: 2, preferredColor: 'b', isBotGame: true, botDifficulty: 'master' });
  assert.deepEqual(good, { timerEnabled: true, initialTimeSec: 180, incrementSec: 2, preferredColor: 'b', isBotGame: true, botDifficulty: 'master' });
  assert.deepEqual(cleanGameRules(undefined).preferredColor, 'random');
});

test('cleanChatMessage: empty is dropped, long text is cut, reply reference is cleaned', () => {
  assert.equal(cleanChatMessage(undefined), null);
  assert.equal(cleanChatMessage({ text: '   ' }), null);
  const m = cleanChatMessage({ text: 'a'.repeat(5000), senderName: 'Sam', replyTo: { id: 'chat-1', senderName: 'Al', text: 'b'.repeat(900) } });
  assert.ok(m);
  assert.equal(m!.text.length, MAX_CHAT_TEXT);
  assert.equal(m!.replyTo!.text.length, 200);
  assert.equal(cleanChatMessage({ text: 'hi', replyTo: { text: 'no id' } })!.replyTo, null);
});

// ---- room cleanup -------------------------------------------------------------------------
function make() {
  const m = new RoomManager();
  clearInterval(m.clockInterval);
  return m;
}
const HOUR = 60 * 60_000;

test('sweepRooms: keeps active rooms, removes old finished and abandoned ones', () => {
  const m = make();
  const active = m.createRoom(user(1), rules);        // host connected
  const finished = m.createRoom(user(2), rules);
  const abandoned = m.createRoom(user(3), rules);
  finished.status = 'finished';
  abandoned.whitePlayer!.connected = false;

  assert.equal(m.sweepRooms(Date.now() + 10 * 60_000), 0, 'nothing expires after 10 minutes');
  assert.equal(m.rooms.size, 3);

  // 90 minutes later: only the abandoned room (no connected human, idle > 1h) goes
  assert.equal(m.sweepRooms(Date.now() + 90 * 60_000), 1);
  assert.ok(m.rooms.has(active.code) && m.rooms.has(finished.code) && !m.rooms.has(abandoned.code));

  // 3 hours later: the finished room is also removed, the connected one remains
  assert.equal(m.sweepRooms(Date.now() + 3 * HOUR), 1);
  assert.ok(m.rooms.has(active.code) && !m.rooms.has(finished.code));

  // 13 hours later: even a connected room goes
  assert.equal(m.sweepRooms(Date.now() + 13 * HOUR), 1);
  assert.equal(m.rooms.size, 0);
  assert.equal(m.chessInstances.size, 0, 'chess engine objects are released too');
  m.destroy();
});

test('sweepRooms: a bot game with a connected player is kept, and recent chat keeps a room alive', () => {
  const m = make();
  const bot = m.createRoom(user(5), { ...rules, isBotGame: true, botDifficulty: 'beginner' });
  m.clearBotTimer(bot.code);
  assert.equal(m.sweepRooms(Date.now() + 2 * HOUR), 0);

  const quiet = m.createRoom(user(6), rules);
  quiet.whitePlayer!.connected = false;
  m.addChatMessage(quiet.code, { senderId: 6, senderName: 'x', isSpectator: false, text: 'still here' });
  assert.equal(m.sweepRooms(Date.now() + 30 * 60_000), 0, 'recent chat counts as activity');
  m.destroy();
});

// ---- database settings --------------------------------------------------------------------
test('pgPoolConfig: sslmode moves out of the URL and becomes explicit TLS settings', () => {
  assert.deepEqual(pgPoolConfig('postgresql://u:p@h/db?sslmode=require'),
    { connectionString: 'postgresql://u:p@h/db', ssl: { rejectUnauthorized: true } });
  assert.deepEqual(pgPoolConfig('postgresql://u:p@h/db?sslmode=disable'),
    { connectionString: 'postgresql://u:p@h/db', ssl: false });
  assert.deepEqual(pgPoolConfig('postgresql://u:p@h/db?sslmode=no-verify'),
    { connectionString: 'postgresql://u:p@h/db', ssl: { rejectUnauthorized: false } });
  assert.deepEqual(pgPoolConfig('postgresql://u:p@h/db'), { connectionString: 'postgresql://u:p@h/db' });
});

test('pgPoolConfig: other options stay, libpq-compat and unparseable URLs pass through untouched', () => {
  assert.equal(pgPoolConfig('postgresql://u:p@h/db?sslmode=require&application_name=x').connectionString,
    'postgresql://u:p@h/db?application_name=x');
  const compat = 'postgresql://u:p@h/db?uselibpqcompat=true&sslmode=require';
  assert.deepEqual(pgPoolConfig(compat), { connectionString: compat });
  assert.deepEqual(pgPoolConfig('not a url'), { connectionString: 'not a url' });
});
