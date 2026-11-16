import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LobbyPlayer, PlayerColor, TokenPosition } from '../src/types/ludo';
import {
  applyTokenMove,
  evaluateSixes,
  getLegalMoves,
  MAX_STEP,
  nextTurnColor,
} from '../src/utils/ludoRules';
import { COLOR_TURN_ORDER } from '../src/utils/ludoConstants';

// Track geometry (see ludoConstants.ts): absolute track index = (start offset + step) % 52.
// red starts at 13, blue at 26, yellow at 39, green at 0. Safe absolute indices: 0, 8, 13, 21, 26, 34, 39, 47.

function tokensAt(steps: [number, number, number, number]): [TokenPosition, TokenPosition, TokenPosition, TokenPosition] {
  return steps.map((step, id) => ({
    id,
    step,
    state: step < 0 ? 'yard' : step >= MAX_STEP ? 'finished' : step >= 51 ? 'home_run' : 'track',
  })) as [TokenPosition, TokenPosition, TokenPosition, TokenPosition];
}

function player(color: PlayerColor, steps: [number, number, number, number], id = color): LobbyPlayer {
  return {
    id,
    name: color,
    color,
    isHost: false,
    isReady: true,
    isBot: false,
    isConnected: true,
    tokens: tokensAt(steps),
  };
}

const ALL_YARD: [number, number, number, number] = [-1, -1, -1, -1];

test('a token in the yard needs a six to leave', () => {
  assert.deepEqual(getLegalMoves(tokensAt(ALL_YARD), 3), []);
  assert.deepEqual(getLegalMoves(tokensAt(ALL_YARD), 6), [0, 1, 2, 3]);
  assert.equal(applyTokenMove([player('red', ALL_YARD)], 'red', 0, 3), null);
});

test('a six brings a yard token onto its start square and grants an extra turn', () => {
  const players = [player('red', ALL_YARD)];
  const result = applyTokenMove(players, 'red', 0, 6);
  assert.ok(result);
  assert.equal(players[0].tokens[0].step, 0);
  assert.equal(result.extraTurn, true);
  assert.equal(result.capture, null);
});

test('exact finish: a token must land on home with the exact roll', () => {
  // 50 + 6 = 56 is exactly home.
  const players = [player('red', [50, -1, -1, -1])];
  const result = applyTokenMove(players, 'red', 0, 6);
  assert.ok(result);
  assert.equal(result.reachedHome, true);
  assert.equal(players[0].tokens[0].step, MAX_STEP);
  assert.equal(players[0].tokens[0].state, 'finished');
  assert.equal(result.extraTurn, true);
});

test('exact finish: an overshoot is illegal and leaves the token untouched', () => {
  // 51 + 6 = 57, one past home.
  const players = [player('red', [51, -1, -1, -1])];
  assert.equal(applyTokenMove(players, 'red', 0, 6), null);
  assert.equal(players[0].tokens[0].step, 51);
  // The legal-move list agrees: step 54 with a 3 overshoots, with a 2 it lands exactly.
  assert.deepEqual(getLegalMoves(tokensAt([54, -1, -1, -1]), 3), []);
  assert.deepEqual(getLegalMoves(tokensAt([54, -1, -1, -1]), 2), [0]);
});

test('a finished token is never legal again', () => {
  assert.deepEqual(getLegalMoves(tokensAt([MAX_STEP, -1, -1, -1]), 1), []);
});

test('capture: landing on an unsafe opponent square sends that token to the yard and gives a bonus turn', () => {
  // red step 1 = absolute 14. blue step 40 = absolute (26 + 40) % 52 = 14. Square 14 is not safe.
  const players = [player('red', [0, -1, -1, -1]), player('blue', [40, -1, -1, -1])];
  const result = applyTokenMove(players, 'red', 0, 1);
  assert.ok(result);
  assert.deepEqual(result.capture, { capturedPlayerId: 'blue', capturedColor: 'blue', capturedTokenIndex: 0 });
  assert.equal(players[1].tokens[0].step, -1);
  assert.equal(players[1].tokens[0].state, 'yard');
  assert.equal(result.extraTurn, true);
});

test('safe squares: an opponent standing on a star square cannot be captured', () => {
  // red step 8 = absolute 21, a blue star (safe). blue step 47 = absolute (26 + 47) % 52 = 21.
  const players = [player('red', [7, -1, -1, -1]), player('blue', [47, -1, -1, -1])];
  const result = applyTokenMove(players, 'red', 0, 1);
  assert.ok(result);
  assert.equal(result.capture, null);
  assert.equal(players[1].tokens[0].step, 47);
});

test('capture: every opponent token on the square goes back, not only the first', () => {
  // red step 1 = absolute 14. blue step 40 and green step 14 both sit on absolute 14.
  const players = [
    player('red', [0, -1, -1, -1]),
    player('blue', [40, -1, -1, -1]),
    player('green', [14, -1, -1, -1]),
  ];
  const result = applyTokenMove(players, 'red', 0, 1);
  assert.ok(result);
  assert.equal(result.sentToYard.length, 2);
  assert.equal(players[1].tokens[0].step, -1);
  assert.equal(players[2].tokens[0].step, -1);
});

test('home run and home squares are immune from capture', () => {
  // blue step 51 is in its home run, so it has no shared-track square and cannot be captured.
  // Red landing on the absolute index that blue step 51 would otherwise map to must not capture it.
  const blueHomeRunAbs = (26 + 51) % 52; // 25
  const redStepForAbs = (blueHomeRunAbs - 13 + 52) % 52; // 12
  const players = [player('red', [redStepForAbs - 1, -1, -1, -1]), player('blue', [51, -1, -1, -1])];
  const result = applyTokenMove(players, 'red', 0, 1);
  assert.ok(result);
  assert.equal(result.capture, null);
  assert.equal(players[1].tokens[0].step, 51);
});

test('a six that does not capture or finish still earns an extra turn', () => {
  const players = [player('red', [10, -1, -1, -1])];
  const result = applyTokenMove(players, 'red', 0, 6);
  assert.ok(result);
  assert.equal(result.extraTurn, true);
  assert.equal(result.capture, null);
  assert.equal(result.reachedHome, false);
});

test('a plain non-six move gives no extra turn', () => {
  const players = [player('red', [10, -1, -1, -1])];
  const result = applyTokenMove(players, 'red', 0, 3);
  assert.ok(result);
  assert.equal(result.extraTurn, false);
});

test('three sixes: the third consecutive six forfeits the turn', () => {
  let state = { consecutiveSixes: 0, penalty: false };
  state = evaluateSixes(state.consecutiveSixes, 6);
  assert.deepEqual(state, { consecutiveSixes: 1, penalty: false });
  state = evaluateSixes(state.consecutiveSixes, 6);
  assert.deepEqual(state, { consecutiveSixes: 2, penalty: false });
  state = evaluateSixes(state.consecutiveSixes, 6);
  assert.deepEqual(state, { consecutiveSixes: 3, penalty: true });
});

test('three sixes: any other roll resets the count', () => {
  let s = evaluateSixes(0, 6);
  s = evaluateSixes(s.consecutiveSixes, 6);
  s = evaluateSixes(s.consecutiveSixes, 4);
  assert.deepEqual(s, { consecutiveSixes: 0, penalty: false });
  s = evaluateSixes(s.consecutiveSixes, 6);
  assert.equal(s.consecutiveSixes, 1);
  assert.equal(s.penalty, false);
});

test('turn order skips players who have already finished', () => {
  const players = [
    player('red', [MAX_STEP, MAX_STEP, MAX_STEP, MAX_STEP]),
    player('blue', [0, -1, -1, -1]),
    player('yellow', [0, -1, -1, -1]),
    player('green', [0, -1, -1, -1]),
  ];
  assert.equal(nextTurnColor(players, 'green', COLOR_TURN_ORDER), 'blue');
  assert.equal(nextTurnColor(players, 'blue', COLOR_TURN_ORDER), 'yellow');
});

test('turn order wraps around the table', () => {
  const players = [player('red', [0, -1, -1, -1]), player('green', [0, -1, -1, -1])];
  assert.equal(nextTurnColor(players, 'green', COLOR_TURN_ORDER), 'red');
});
