import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomState } from '../src/types/chess';
import { buildMatchRecord, calculateStats } from '../src/utils/playerStatsCore';

// statsStore.ts imports the pg driver at module load, but without DATABASE_URL it only uses memory.
delete process.env.DATABASE_URL;

function room(overrides: Partial<RoomState> = {}): RoomState {
  const base = {
    code: 'ABC123',
    hostId: 111,
    gameRules: { timerEnabled: false, initialTimeSec: 600, incrementSec: 0 },
    status: 'finished',
    whitePlayer: { user: { id: 111, name: 'Alice' }, color: 'w', connected: true },
    blackPlayer: { user: { id: 222, name: 'Bob' }, color: 'b', connected: true },
    spectators: [],
    fen: '',
    turn: 'w',
    pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5',
    resolution: 'checkmate',
    winnerColor: 'w',
    winnerUserId: 111,
    chatMessages: [],
    createdTimestamp: Date.now() - 300_000,
    lastMoveTimestamp: Date.now(),
  } as unknown as RoomState;
  return { ...base, ...overrides };
}

test('a white win is recorded as a win for white and a loss for black', () => {
  const r = room();
  const white = buildMatchRecord(r, 111);
  const black = buildMatchRecord(r, 222);
  assert.equal(white?.result, 'win');
  assert.equal(white?.playerColor, 'w');
  assert.equal(black?.result, 'loss');
  assert.equal(black?.playerColor, 'b');
  assert.equal(white?.opponentName, 'Bob');
});

test('a draw by agreement is a draw for both players', () => {
  const r = room({ winnerUserId: undefined, resolution: 'draw_agreement' });
  assert.equal(buildMatchRecord(r, 111)?.result, 'draw');
  assert.equal(buildMatchRecord(r, 222)?.result, 'draw');
});

test('a spectator or stranger gets no record', () => {
  assert.equal(buildMatchRecord(room(), 999), null);
});

test('games still in progress are not recorded', () => {
  assert.equal(buildMatchRecord(room({ status: 'in_progress' }), 111), null);
});

test('the record id is stable, so recording the same game twice is idempotent', () => {
  const r = room();
  assert.equal(buildMatchRecord(r, 111)?.id, buildMatchRecord(r, 111)?.id);
});

test('string and numeric user ids are treated as the same player', () => {
  assert.equal(buildMatchRecord(room(), '111')?.result, 'win');
});

test('stats are computed from records, with zeros when there are no games', () => {
  const empty = calculateStats([]);
  assert.equal(empty.totalGames, 0);
  assert.equal(empty.winRate, 0);
  assert.equal(empty.overallAvgMoveTimeSec, 0);
  assert.equal(empty.fastestMoveSec, 0);

  const records = [
    buildMatchRecord(room(), 111)!,
    buildMatchRecord(room({ winnerUserId: 222, resolution: 'resignation' }), 111)!,
    buildMatchRecord(room({ winnerUserId: undefined, resolution: 'draw_agreement' }), 111)!,
  ];
  const stats = calculateStats(records);
  assert.equal(stats.totalGames, 3);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 1);
  assert.equal(stats.draws, 1);
  assert.equal(stats.winRate, 33.3);
});

test('the browser no longer stores or invents match history', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const dir = path.dirname(url.fileURLToPath(import.meta.url));
  const loader = fs.readFileSync(path.join(dir, '..', 'src', 'utils', 'playerStats.ts'), 'utf-8');
  const panel = fs.readFileSync(path.join(dir, '..', 'src', 'components', 'GameMatchView.tsx'), 'utf-8');
  assert.equal(/localStorage/.test(loader), false, 'stats loader must not use localStorage');
  assert.equal(/recordMatch/.test(panel), false, 'match view must not record results on the client');
  const core = fs.readFileSync(path.join(dir, '..', 'src', 'utils', 'playerStatsCore.ts'), 'utf-8');
  assert.equal(/Math\.random/.test(core), false, 'stats must not contain random numbers');
});

test('in-memory store: records a game once per player and keeps players separate', async () => {
  const { statsStore } = await import('../src/server/statsStore');
  const r = room();
  await statsStore.recordFinishedGame(r);
  await statsStore.recordFinishedGame(r); // a repeated finished event must not duplicate
  const alice = await statsStore.getStats('111');
  const bob = await statsStore.getStats('222');
  const stranger = await statsStore.getStats('999');
  assert.equal(alice.totalGames, 1);
  assert.equal(alice.wins, 1);
  assert.equal(bob.totalGames, 1);
  assert.equal(bob.losses, 1);
  assert.equal(stranger.totalGames, 0);
});

test('in-memory store: bot opponents are not recorded as players', async () => {
  const { statsStore } = await import('../src/server/statsStore');
  const r = room({
    code: 'BOT999',
    createdTimestamp: 42,
    blackPlayer: { user: { id: 'chess-bot', name: 'Bot', isBot: true }, color: 'b', connected: true } as never,
  });
  await statsStore.recordFinishedGame(r);
  assert.equal((await statsStore.getStats('chess-bot')).totalGames, 0);
  assert.equal((await statsStore.getStats('111')).totalGames >= 1, true);
});
