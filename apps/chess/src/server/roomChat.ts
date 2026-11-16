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

export function addChatMessage(m: RoomManager, code: string,
    message: Omit<ChatMessage, 'id' | 'timestamp' | 'reactions'>): ChatMessage | undefined {
  const room = m.rooms.get(code.toUpperCase());
  if (!room) return undefined;

  const fullMessage: ChatMessage = {
    ...message,
    id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
    reactions: [],
  };

  room.chatMessages.push(fullMessage);
  // Keep last 150 messages preserved
  if (room.chatMessages.length > 150) {
    room.chatMessages.shift();
  }

  return fullMessage;
}

export function addReaction(m: RoomManager, code: string,
    messageId: string,
    emoji: string,
    reactor: ChatReactionUser): RoomState | undefined {
  const room = m.rooms.get(code.toUpperCase());
  if (!room) return undefined;

  const message = room.chatMessages.find((m) => m.id === messageId);
  if (!message) return undefined;

  const existingReaction = message.reactions.find((r) => r.emoji === emoji);

  if (existingReaction) {
    const userIndex = existingReaction.users.findIndex(
      (u) => String(u) === String(reactor.userId)
    );

    if (userIndex >= 0) {
      // Toggle OFF (Telegram-style reaction tap)
      existingReaction.users.splice(userIndex, 1);
      if (existingReaction.reactors) {
        existingReaction.reactors = existingReaction.reactors.filter(
          (r) => String(r.userId) !== String(reactor.userId)
        );
      }
      existingReaction.count--;
      if (existingReaction.count <= 0) {
        message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
      }
    } else {
      // Toggle ON
      existingReaction.users.push(reactor.userId);
      if (!existingReaction.reactors) existingReaction.reactors = [];
      existingReaction.reactors.push(reactor);
      existingReaction.count++;
    }
  } else {
    // Add new reaction with reactor info
    message.reactions.push({
      emoji,
      count: 1,
      users: [reactor.userId],
      reactors: [reactor],
    });
  }

  return room;
}
