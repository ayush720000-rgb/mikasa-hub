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
import { addChatMessage, addReaction } from './roomChat';
import { checkClocks } from './roomClock';
import { clearBotTimer, scheduleBotMove, executeBotMove } from './roomBot';

import type { RoomManager } from './roomManager';

export function resign(m: RoomManager, code: string, userId: string | number): RoomState | undefined {
  const room = m.rooms.get(code.toUpperCase());
  if (!room || room.status !== 'in_progress') return undefined;

  if (String(room.whitePlayer?.user.id) === String(userId)) {
    room.status = 'finished';
    room.resolution = 'resignation';
    room.winnerColor = 'b';
    room.winnerUserId = room.blackPlayer?.user.id;
    m.clearBotTimer(code);
    return room;
  }

  if (String(room.blackPlayer?.user.id) === String(userId)) {
    room.status = 'finished';
    room.resolution = 'resignation';
    room.winnerColor = 'w';
    room.winnerUserId = room.whitePlayer?.user.id;
    m.clearBotTimer(code);
    return room;
  }

  return undefined;
}

export function offerDraw(m: RoomManager, code: string, userId: string | number): RoomState | undefined {
  const room = m.rooms.get(code.toUpperCase());
  if (!room || room.status !== 'in_progress') return undefined;

  let color: Color | null = null;
  if (String(room.whitePlayer?.user.id) === String(userId)) color = 'w';
  else if (String(room.blackPlayer?.user.id) === String(userId)) color = 'b';
  if (!color) return undefined;

  room.drawOffer = {
    offeredByUserId: userId,
    offeredByColor: color,
  };

  // If bot game, Bot evaluates draw offer
  if (room.gameRules.isBotGame) {
    setTimeout(() => {
      const accept = randomInt(0, 2) === 0;
      const updated = m.respondDraw(code, 'chess-bot', accept);
      if (updated) {
        m.onRoomStateChanged?.(updated);
      }
    }, 700);
  }

  return room;
}

export function respondDraw(m: RoomManager, code: string, userId: string | number, accept: boolean): RoomState | undefined {
  const room = m.rooms.get(code.toUpperCase());
  if (!room || !room.drawOffer || room.status !== 'in_progress') return undefined;

  if (String(room.drawOffer.offeredByUserId) === String(userId)) return undefined; // Cannot respond to own offer

  if (accept) {
    room.status = 'finished';
    room.resolution = 'draw_agreement';
    room.drawOffer = null;
    room.chatMessages.push({
      id: `msg-${Date.now()}`,
      senderId: 'system',
      senderName: 'Mikasa Chess',
      isSpectator: false,
      text: 'Both players agreed to a draw. The match has concluded.',
      timestamp: Date.now(),
      reactions: [],
    });
  } else {
    room.drawOffer = null;
    room.chatMessages.push({
      id: `msg-${Date.now()}`,
      senderId: 'system',
      senderName: 'Mikasa Chess',
      isSpectator: false,
      text: 'The draw offer was declined.',
      timestamp: Date.now(),
      reactions: [],
    });
  }

  return room;
}

export function rematchMatch(m: RoomManager, code: string, _requesterUserId?: string | number): RoomState | undefined {
  const upperCode = code.toUpperCase();
  const room = m.rooms.get(upperCode);
  if (!room) return undefined;

  // Clear active bot timer if running
  const existingBotTimer = m.botTimers.get(upperCode);
  if (existingBotTimer) {
    clearTimeout(existingBotTimer);
    m.botTimers.delete(upperCode);
  }

  const newChess = new Chess();
  m.chessInstances.set(upperCode, newChess);

  const initialTimeMs = (room.gameRules.initialTimeSec || 600) * 1000;

  // Swap white and black players so rematch alternates colors for fairness
  const oldWhite = room.whitePlayer;
  const oldBlack = room.blackPlayer;

  if (oldWhite && oldBlack) {
    room.whitePlayer = {
      ...oldBlack,
      color: 'w',
      timeLeftMs: initialTimeMs,
    };
    room.blackPlayer = {
      ...oldWhite,
      color: 'b',
      timeLeftMs: initialTimeMs,
    };
  } else if (oldWhite) {
    oldWhite.timeLeftMs = initialTimeMs;
  } else if (oldBlack) {
    oldBlack.timeLeftMs = initialTimeMs;
  }

  room.fen = newChess.fen();
  room.pgn = '';
  room.turn = 'w';
  room.lastMove = undefined;
  room.lastMoveTimestamp = Date.now();
  room.status = 'in_progress';
  room.winnerColor = undefined;
  room.winnerUserId = undefined;
  room.resolution = undefined;
  room.drawOffer = null;
  room.createdTimestamp = Date.now();

  room.chatMessages.push({
    id: `rematch-${Date.now()}`,
    senderId: 'system',
    senderName: 'Mikasa Chess',
    isSpectator: false,
    text: '⚔️ Rematch started! Colors have swapped.',
    timestamp: Date.now(),
    reactions: [],
  });

  // If bot game and bot is now white, schedule bot opening move
  if (room.gameRules.isBotGame && room.whitePlayer?.user.isBot) {
    m.scheduleBotMove(upperCode, 600);
  }

  return room;
}
