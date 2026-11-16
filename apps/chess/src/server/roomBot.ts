import { Chess } from 'chess.js';
import { randomInt } from 'node:crypto';
import {
  Color,
  GameRules,
  RoomState,
  UserProfile,
  ChatMessage,
  PlayerState,
  ChatReactionUser,
} from '../types/chess';
import { computeBestMoveAsync, getBotMetadata } from '../utils/chessBot';

import type { RoomManager } from './roomManager';

export function clearBotTimer(m: RoomManager, code: string): void {
  const timer = m.botTimers.get(code.toUpperCase());
  if (timer) {
    clearTimeout(timer);
    m.botTimers.delete(code.toUpperCase());
  }
}

export function scheduleBotMove(m: RoomManager, code: string, delayMs: number = 400): void {
  const upperCode = code.toUpperCase();
  m.clearBotTimer(upperCode);

  const timer = setTimeout(async () => {
    await m.executeBotMove(upperCode);
  }, delayMs);

  m.botTimers.set(upperCode, timer);
}

export async function executeBotMove(m: RoomManager, code: string): Promise<void> {
  const room = m.rooms.get(code);
  let chess = m.chessInstances.get(code);
  if (!room || room.status !== 'in_progress') return;

  if (!chess) {
    chess = new Chess(room.fen);
    m.chessInstances.set(code, chess);
  }

  const currentTurn = chess.turn();
  const botPlayer = currentTurn === 'w' ? room.whitePlayer : room.blackPlayer;
  if (!botPlayer?.user.isBot) return;

  try {
    let botMove = await computeBestMoveAsync(chess, room.gameRules.botDifficulty || 'intermediate');
    if (!botMove) {
      // Fallback to any legal move
      const fallbackMoves = chess.moves({ verbose: true });
      if (fallbackMoves.length === 0) return;
      const fallback = fallbackMoves[0];
      botMove = {
        from: fallback.from.toLowerCase(),
        to: fallback.to.toLowerCase(),
        promotion: fallback.promotion || 'q',
      };
    }

    const result = chess.move({
      from: botMove.from.toLowerCase(),
      to: botMove.to.toLowerCase(),
      promotion: (botMove.promotion || 'q').toLowerCase() as any,
    });

    if (!result) return;

    // Update timer for bot if enabled
    if (room.gameRules.timerEnabled && room.lastMoveTimestamp) {
      const elapsed = Date.now() - room.lastMoveTimestamp;
      botPlayer.timeLeftMs = Math.max(0, botPlayer.timeLeftMs - elapsed);
      botPlayer.timeLeftMs += (room.gameRules.incrementSec || 0) * 1000;
    }

    room.fen = chess.fen();
    room.turn = chess.turn();
    room.pgn = chess.pgn();
    room.lastMove = { from: botMove.from, to: botMove.to, san: result.san };
    room.lastMoveTimestamp = Date.now();

    if (chess.isCheckmate()) {
      room.status = 'finished';
      room.resolution = 'checkmate';
      room.winnerColor = currentTurn;
      room.winnerUserId = botPlayer.user.id;
      m.clearBotTimer(code);
    } else if (chess.isDraw()) {
      room.status = 'finished';
      if (chess.isStalemate()) room.resolution = 'draw_stalemate';
      else if (chess.isInsufficientMaterial()) room.resolution = 'draw_insufficient_material';
      else if (chess.isThreefoldRepetition()) room.resolution = 'draw_threefold_repetition';
      else room.resolution = 'draw_50_move';
      m.clearBotTimer(code);
    }

    const isCapture = result.san?.includes('x') || false;
    const isCheck = result.san?.includes('+') || result.san?.includes('#') || false;

    // Notify clients immediately of the AI move!
    m.onRoomStateChanged?.(room, { isCapture, isCheck });
  } catch (err) {
    console.error('Failed to execute bot move:', err);
  }
}
