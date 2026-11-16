import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/roomManager';

const rules = {
  timerEnabled: false,
  initialTimeSec: 600,
  incrementSec: 0,
  preferredColor: 'w' as const,
  isBotGame: false,
};

test('two players join, white opens with e2-e4, and black cannot move a knight through a piece', () => {
  const rooms = new RoomManager();
  const room = rooms.createRoom({ id: 'h1', name: 'Host' }, rules, 'TESTROOM');
  assert.equal(room.code, 'TESTROOM');
  rooms.joinRoom('TESTROOM', { id: 'g1', name: 'Guest' });

  const opening = rooms.makeMove('TESTROOM', 'h1', { from: 'e2', to: 'e4' });
  assert.equal(opening.success, true, opening.error);

  const illegal = rooms.makeMove('TESTROOM', 'g1', { from: 'g8', to: 'g1' });
  assert.equal(illegal.success, false);
});

test('a move from the player whose turn it is not is rejected', () => {
  const rooms = new RoomManager();
  rooms.createRoom({ id: 'h2', name: 'Host' }, rules, 'OTHERRM');
  rooms.joinRoom('OTHERRM', { id: 'g2', name: 'Guest' });
  assert.equal(rooms.makeMove('OTHERRM', 'g2', { from: 'e7', to: 'e5' }).success, false);
});

test('unknown room codes return safely', () => {
  const rooms = new RoomManager();
  assert.equal(rooms.getRoom('NOPE00'), undefined);
  assert.equal(rooms.makeMove('NOPE00', 'x', { from: 'e2', to: 'e4' }).success, false);
});
