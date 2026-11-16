import { LobbyPlayer, PlayerColor, TokenPosition } from '../types/ludo';
import { COLOR_START_OFFSETS, isPositionSafe } from './ludoConstants';

export const MAX_STEP = 56; // 0..50 on track, 51..55 in home-run, 56 is Home Center

/**
 * Calculates which tokens (0..3) can legally be moved given a dice roll
 */
export function getLegalMoves(tokens: TokenPosition[], diceValue: number): number[] {
  const legal: number[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Case 1: Token is already finished (at step 56)
    if (token.step >= MAX_STEP) {
      continue;
    }

    // Case 2: Token is in Yard (step < 0)
    if (token.step < 0) {
      if (diceValue === 6) {
        legal.push(i);
      }
      continue;
    }

    // Case 3: Token is on track or home-run lane
    const targetStep = token.step + diceValue;
    if (targetStep <= MAX_STEP) {
      legal.push(i);
    }
  }

  return legal;
}

/**
 * Checks if all 4 tokens of a player have reached home
 */
export function hasPlayerWon(tokens: TokenPosition[]): boolean {
  return tokens.every((t) => t.step >= MAX_STEP);
}

/**
 * Detects if a move results in capturing an opponent's token
 * Returns captured opponent info if any
 */
export function checkCapture(
  movingColor: PlayerColor,
  targetStep: number,
  allPlayers: LobbyPlayer[]
): { capturedPlayerId: string; capturedColor: PlayerColor; capturedTokenIndex: number } | null {
  // Yard, Home Run (51-55), and Home (56) are completely immune from capture
  if (targetStep < 0 || targetStep >= 51) {
    return null;
  }

  // Safe squares are immune
  if (isPositionSafe(movingColor, targetStep)) {
    return null;
  }

  // Absolute track index of landing square
  const movingTrackIdx = (COLOR_START_OFFSETS[movingColor] + targetStep) % 52;

  for (const player of allPlayers) {
    if (player.color === movingColor) continue;

    for (let tIdx = 0; tIdx < player.tokens.length; tIdx++) {
      const oppToken = player.tokens[tIdx];
      // Only tokens on the outer track (0..50) can be captured
      if (oppToken.step >= 0 && oppToken.step <= 50) {
        const oppTrackIdx = (COLOR_START_OFFSETS[player.color] + oppToken.step) % 52;
        if (oppTrackIdx === movingTrackIdx) {
          // Found opponent on the same square!
          return {
            capturedPlayerId: player.id,
            capturedColor: player.color,
            capturedTokenIndex: tIdx,
          };
        }
      }
    }
  }

  return null;
}

/**
 * How many opponent tokens could capture a piece standing on `step` next turn
 * (1-6 squares behind it on the shared track). Safe squares and home lanes are never threatened.
 */
export function countThreatsAt(color: PlayerColor, step: number, allPlayers: LobbyPlayer[]): number {
  if (step < 0 || step > 50 || isPositionSafe(color, step)) return 0;
  const target = (COLOR_START_OFFSETS[color] + step) % 52;
  let threats = 0;
  for (const opp of allPlayers) {
    if (opp.color === color) continue;
    for (const tok of opp.tokens) {
      if (tok.step < 0 || tok.step > 50) continue;
      const oppTrack = (COLOR_START_OFFSETS[opp.color] + tok.step) % 52;
      const dist = (target - oppTrack + 52) % 52;
      if (dist >= 1 && dist <= 6) threats++;
    }
  }
  return threats;
}

/**
 * Bot move picker. Priorities, highest first:
 *  - finishing a token, capturing, leaving the yard on a 6
 *  - landing on a safe square or entering the home run
 *  - not stepping in front of opponents, and escaping a threatened square
 *  - advancing overall
 */
export function chooseBestBotMove(
  botPlayer: LobbyPlayer,
  diceValue: number,
  allPlayers: LobbyPlayer[],
  legalMoves: number[]
): number {
  if (legalMoves.length === 0) return -1;
  if (legalMoves.length === 1) return legalMoves[0];

  let bestMove = legalMoves[0];
  let bestScore = -Infinity;

  for (const tokenIdx of legalMoves) {
    const token = botPlayer.tokens[tokenIdx];
    let score = 0;

    if (token.step < 0) {
      // Leaving the yard is valuable: it needs a 6 and adds a piece to play with.
      score += 600;
    } else {
      const target = token.step + diceValue;

      if (target === MAX_STEP) score += 1200;
      else if (target >= 51 && token.step < 51) score += 450;

      if (checkCapture(botPlayer.color, target, allPlayers)) score += 1500;
      if (isPositionSafe(botPlayer.color, target)) score += 350;

      // Stepping in front of opponents is the main risk; penalise each threat at the destination.
      score -= countThreatsAt(botPlayer.color, target, allPlayers) * 260;

      // Escaping a square that is currently threatened is worth a bonus.
      if (countThreatsAt(botPlayer.color, token.step, allPlayers) > 0) score += 300;

      score += target * 4;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = tokenIdx;
    }
  }

  return bestMove;
}

/**
 * Three consecutive sixes forfeit the turn. `consecutiveSixes` is the count before this roll.
 */
export const THREE_SIXES_LIMIT = 3;

export function evaluateSixes(
  consecutiveSixes: number,
  roll: number
): { consecutiveSixes: number; penalty: boolean } {
  const next = roll === 6 ? consecutiveSixes + 1 : 0;
  return { consecutiveSixes: next, penalty: next >= THREE_SIXES_LIMIT };
}

export interface MoveResult {
  targetStep: number;
  reachedHome: boolean;
  capture: { capturedPlayerId: string; capturedColor: PlayerColor; capturedTokenIndex: number } | null;
  /** Every opponent token sent back to the yard by this move (two can share a square). */
  sentToYard: { playerId: string; tokenIndex: number }[];
  extraTurn: boolean;
}

/**
 * Apply a token move to the players' token positions. Mutates the moving token and any captured
 * opponent tokens, and returns what happened. Returns null when the move is not legal, so the
 * caller can ignore it. Legality (whose turn, dice state) is checked by the manager beforehand.
 */
export function applyTokenMove(
  players: LobbyPlayer[],
  movingColor: PlayerColor,
  tokenIndex: number,
  roll: number
): MoveResult | null {
  const mover = players.find((p) => p.color === movingColor);
  if (!mover) return null;
  const token = mover.tokens[tokenIndex];
  if (!token || token.step >= MAX_STEP) return null;
  if (token.step < 0 && roll !== 6) return null;

  const targetStep = token.step < 0 ? 0 : token.step + roll;
  if (targetStep > MAX_STEP) return null;

  token.step = targetStep;
  token.state = targetStep >= MAX_STEP ? 'finished' : targetStep >= 51 ? 'home_run' : 'track';

  const reachedHome = targetStep === MAX_STEP;
  let extraTurn = reachedHome;
  const sentToYard: { playerId: string; tokenIndex: number }[] = [];
  const capture = checkCapture(movingColor, targetStep, players);

  if (capture) {
    extraTurn = true;
    const landingTrack = (COLOR_START_OFFSETS[movingColor] + targetStep) % 52;
    for (const pl of players) {
      if (pl.color === movingColor) continue;
      pl.tokens.forEach((tk, idx) => {
        if (tk.step >= 0 && tk.step <= 50 && (COLOR_START_OFFSETS[pl.color] + tk.step) % 52 === landingTrack) {
          tk.step = -1;
          tk.state = 'yard';
          sentToYard.push({ playerId: pl.id, tokenIndex: idx });
        }
      });
    }
  }

  if (roll === 6) extraTurn = true;

  return { targetStep, reachedHome, capture, sentToYard, extraTurn };
}

/** Next player in clockwise order who has not finished all four tokens. */
export function nextTurnColor(players: LobbyPlayer[], currentColor: PlayerColor, order: PlayerColor[]): PlayerColor {
  const currentIdx = order.indexOf(currentColor);
  for (let i = 1; i <= order.length; i++) {
    const candidate = order[(currentIdx + i) % order.length];
    const player = players.find((p) => p.color === candidate);
    if (player && !hasPlayerWon(player.tokens)) return candidate;
  }
  return currentColor;
}
