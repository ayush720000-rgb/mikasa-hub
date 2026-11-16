import { rollFairDie, ShuffledBagDie } from './dice';
import { WebSocket } from 'ws';
import {
  ChatMessage,
  GameState,
  LobbyPlayer,
  PlayerColor,
  TokenPosition,
} from '../src/types/ludo';
import { COLOR_TURN_ORDER, COLOR_START_OFFSETS } from '../src/utils/ludoConstants';
import {
  checkCapture,
  chooseBestBotMove,
  getLegalMoves,
  hasPlayerWon,
  MAX_STEP,
} from '../src/utils/ludoRules';
import { storage } from './storage';
import { TURN_SECONDS } from './ludoConfig';

import type { LudoManager } from './ludoManager';

export function handleChatMessage(m: LudoManager, code: string,
    sender: { id: string; name: string; avatarUrl?: string },
    text: string,
    replyTo?: { id: string; senderName: string; text: string }) {
  const game = m.getGame(code);
  if (!game || !text.trim()) return;

  const player = game.players.find((p) => p.id === sender.id);
  const spectator = game.spectators.find((s) => s.id === sender.id);
  const isSpectator = !player;

  const resolvedAvatar =
    sender.avatarUrl ||
    player?.avatarUrl ||
    spectator?.avatarUrl ||
    `https://api.dicebear.com/7.x/bottts/svg?seed=${sender.id}`;

  const resolvedName =
    sender.name || player?.name || spectator?.name || 'Player';

  const msg: ChatMessage = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    senderId: sender.id,
    senderName: resolvedName,
    senderAvatar: resolvedAvatar,
    senderColor: player?.color,
    isSpectator,
    text: text.trim().slice(0, 300),
    timestamp: Date.now(),
    replyTo,
    reactions: {},
  };

  game.chat.push(msg);
  if (game.chat.length > 100) game.chat.shift();
  storage.saveChat(game.code, game.chat);

  m.broadcast(code, { type: 'sync', payload: game });
}

export function handleChatReaction(m: LudoManager, code: string,
    messageId: string,
    emoji: string,
    user: { id: string; name?: string; avatarUrl?: string }) {
  const game = m.getGame(code);
  if (!game) return;

  const msg = game.chat.find((m) => m.id === messageId);
  if (!msg) return;

  if (!msg.reactions) {
    msg.reactions = {};
  }
  if (!msg.reactions[emoji]) {
    msg.reactions[emoji] = [];
  }

  // Support legacy string arrays if any exist in persisted storage
  let currentUsers = msg.reactions[emoji].map((item: any) =>
    typeof item === 'string' ? { id: item, name: 'User' } : item
  );

  const idx = currentUsers.findIndex((u) => u.id === user.id);
  if (idx >= 0) {
    // Toggle off
    currentUsers.splice(idx, 1);
    if (currentUsers.length === 0) {
      delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji] = currentUsers;
    }
  } else {
    // Look up player or spectator info
    const player = game.players.find((p) => p.id === user.id);
    const spectator = game.spectators.find((s) => s.id === user.id);
    const resolvedName = user.name || player?.name || spectator?.name || 'Player';
    const resolvedAvatar =
      user.avatarUrl ||
      player?.avatarUrl ||
      spectator?.avatarUrl ||
      `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`;

    currentUsers.push({
      id: user.id,
      name: resolvedName,
      avatarUrl: resolvedAvatar,
    });
    msg.reactions[emoji] = currentUsers;
  }

  storage.saveChat(game.code, game.chat);
  m.broadcast(code, { type: 'sync', payload: game });
}

export function handleQuickReaction(m: LudoManager, code: string, userId: string, emoji: string) {
  const game = m.getGame(code);
  if (!game) return;

  const player = game.players.find((p) => p.id === userId);
  const spectator = game.spectators.find((s) => s.id === userId);
  const senderName = player?.name || spectator?.name || 'Player';
  const senderColor = player?.color || 'green';
  const avatarUrl =
    player?.avatarUrl ||
    spectator?.avatarUrl ||
    `https://api.dicebear.com/7.x/bottts/svg?seed=${userId}`;

  const reactionPayload = {
    id: `qr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    senderId: userId,
    senderName,
    senderColor,
    avatarUrl,
    emoji,
    timestamp: Date.now(),
  };

  // Broadcast the quick reaction animation to all clients in the room
  m.broadcast(code, {
    type: 'quick_reaction',
    payload: reactionPayload,
  });

  // Also record it into game chat history
  m.handleChatMessage(
    code,
    { id: userId, name: senderName, avatarUrl },
    emoji
  );
}

export function rematch(m: LudoManager, code: string, _userId: string) {
  const game = m.getGame(code);
  if (!game) return;

  // Reset tokens and game state for all players
  game.players.forEach((p) => {
    p.tokens = m.createInitialTokens();
    p.rank = undefined;
  });

  game.status = 'in_progress';
  game.winnerColor = null;
  game.winnerId = null;
  game.rankings = [];
  game.diceRolled = false;
  game.diceValue = null;
  game.legalMoves = [];
  game.consecutiveSixes = 0;
  game.currentTurnColor = game.players[0].color;
  game.stats = {
    durationSeconds: 0,
    turnsCount: 0,
    totalRolls: 0,
    totalCaptures: 0,
    totalSixes: 0,
  };
  game.lastAction = {
    type: 'start',
    description: 'Rematch started! New round has begun!',
    color: game.currentTurnColor,
  };

  m.startTurnTimer(game);
  m.broadcast(code, { type: 'sync', payload: game });
}
