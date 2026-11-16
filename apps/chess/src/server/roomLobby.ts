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

export function createRoom(m: RoomManager, host: UserProfile, rules: GameRules, customCode?: string): RoomState {
  const code = customCode ? customCode.toUpperCase() : generateLobbyCode();
  const chess = new Chess();
  m.chessInstances.set(code, chess);

  // Determine host color
  let hostColor: Color = 'w';
  if (rules.preferredColor === 'b') {
    hostColor = 'b';
  } else if (rules.preferredColor === 'random') {
    hostColor = randomInt(0, 2) === 0 ? 'w' : 'b';
  }

  const initialTimeMs = (rules.initialTimeSec || 600) * 1000;

  const hostPlayer: PlayerState = {
    user: host,
    color: hostColor,
    connected: true,
    timeLeftMs: initialTimeMs,
  };

  let whitePlayer: PlayerState | undefined = hostColor === 'w' ? hostPlayer : undefined;
  let blackPlayer: PlayerState | undefined = hostColor === 'b' ? hostPlayer : undefined;

  // If bot game, add the Bot immediately as the opposing player
  if (rules.isBotGame) {
    const botColor: Color = hostColor === 'w' ? 'b' : 'w';
    const botMeta = getBotMetadata(rules.botDifficulty || 'master');
    const botPlayer: PlayerState = {
      user: {
        id: 'chess-bot',
        name: `${botMeta.name} (${botMeta.elo})`,
        username: `${botMeta.title}_BOT`,
        avatarUrl: `${process.env.APP_BASE || ''}/assets/mikasa.jpg`,
        isBot: true,
      },
      color: botColor,
      connected: true,
      timeLeftMs: initialTimeMs,
    };

    if (botColor === 'w') whitePlayer = botPlayer;
    else blackPlayer = botPlayer;
  }

  const room: RoomState = {
    code,
    hostId: host.id,
    gameRules: rules,
    status: rules.isBotGame ? 'in_progress' : 'waiting',
    whitePlayer,
    blackPlayer,
    spectators: [],
    fen: chess.fen(),
    turn: 'w',
    pgn: '',
    lastMoveTimestamp: Date.now(),
    chatMessages: [
      {
        id: `msg-${Date.now()}`,
        senderId: 'system',
        senderName: 'Mikasa Chess',
        isSpectator: false,
        text: rules.isBotGame
          ? `Match started against ${rules.botDifficulty?.toUpperCase() || 'CASUAL'} Bot!`
          : `Lobby created! Share code ${code} to invite a player.`,
        timestamp: Date.now(),
        reactions: [],
      },
    ],
    createdTimestamp: Date.now(),
  };

  m.rooms.set(code, room);

  // If bot is white, schedule its opening move
  if (rules.isBotGame && whitePlayer?.user.isBot) {
    m.scheduleBotMove(code, 600);
  }

  return room;
}

export function generateLobbyCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(randomInt(0, chars.length));  // join codes are secrets: use the CSPRNG
  }
  return result;
}

export function joinRoom(m: RoomManager, code: string,
    user: UserProfile,
    asSpectator: boolean = false): { room: RoomState; role: 'white' | 'black' | 'spectator'; error?: string } | { error: string } {
  const upperCode = code.toUpperCase();
  const room = m.rooms.get(upperCode);
  if (!room) {
    return { error: 'Lobby not found. Please verify the code.' };
  }

  const initialTimeMs = (room.gameRules.initialTimeSec || 600) * 1000;

  // 1. Resilient player reconnection (by ID, host ID, matching name, or reclaiming disconnected seat)
  let isWhite = Boolean(room.whitePlayer && String(room.whitePlayer.user.id) === String(user.id));
  let isBlack = Boolean(room.blackPlayer && String(room.blackPlayer.user.id) === String(user.id));

  // If host reconnected after closing site
  if (!isWhite && !isBlack && String(room.hostId) === String(user.id)) {
    if (room.whitePlayer && !room.whitePlayer.user.isBot) isWhite = true;
    else if (room.blackPlayer && !room.blackPlayer.user.isBot) isBlack = true;
  }

  // If matching name and seat was disconnected
  if (!isWhite && !isBlack) {
    if (room.whitePlayer && !room.whitePlayer.connected && !room.whitePlayer.user.isBot && room.whitePlayer.user.name === user.name) {
      isWhite = true;
    } else if (room.blackPlayer && !room.blackPlayer.connected && !room.blackPlayer.user.isBot && room.blackPlayer.user.name === user.name) {
      isBlack = true;
    }
  }

  // In an ongoing or waiting 2-player match, if a player seat was disconnected, reclaim it
  if (!asSpectator && !isWhite && !isBlack) {
    if (room.whitePlayer && !room.whitePlayer.connected && !room.whitePlayer.user.isBot && String(room.blackPlayer?.user.id) !== String(user.id)) {
      isWhite = true;
    } else if (room.blackPlayer && !room.blackPlayer.connected && !room.blackPlayer.user.isBot && String(room.whitePlayer?.user.id) !== String(user.id)) {
      isBlack = true;
    }
  }

  if (isWhite && room.whitePlayer) {
    room.whitePlayer.connected = true;
    room.whitePlayer.user = {
      ...room.whitePlayer.user,
      ...user,
    };
    return { room, role: 'white' };
  }

  if (isBlack && room.blackPlayer) {
    room.blackPlayer.connected = true;
    room.blackPlayer.user = {
      ...room.blackPlayer.user,
      ...user,
    };
    return { room, role: 'black' };
  }

  // 2. Check if already registered as spectator
  const existingSpectatorIndex = room.spectators.findIndex(
    (s) => String(s.user.id) === String(user.id)
  );
  if (existingSpectatorIndex >= 0) {
    room.spectators[existingSpectatorIndex].user = {
      ...room.spectators[existingSpectatorIndex].user,
      ...user,
    };
    return { room, role: 'spectator' };
  }

  // 3. Join as player if match is waiting and slot is open
  if (!asSpectator && room.status === 'waiting') {
    if (!room.whitePlayer) {
      room.whitePlayer = {
        user,
        color: 'w',
        connected: true,
        timeLeftMs: initialTimeMs,
      };
      room.status = 'in_progress';
      room.lastMoveTimestamp = Date.now();
      room.chatMessages.push({
        id: `msg-${Date.now()}`,
        senderId: 'system',
        senderName: 'Mikasa Chess',
        isSpectator: false,
        text: `${user.name} joined as White. The match has begun!`,
        timestamp: Date.now(),
        reactions: [],
      });
      return { room, role: 'white' };
    }

    if (!room.blackPlayer) {
      room.blackPlayer = {
        user,
        color: 'b',
        connected: true,
        timeLeftMs: initialTimeMs,
      };
      room.status = 'in_progress';
      room.lastMoveTimestamp = Date.now();
      room.chatMessages.push({
        id: `msg-${Date.now()}`,
        senderId: 'system',
        senderName: 'Mikasa Chess',
        isSpectator: false,
        text: `${user.name} joined as Black. The match has begun!`,
        timestamp: Date.now(),
        reactions: [],
      });
      return { room, role: 'black' };
    }
  }

  // 4. Otherwise, join as spectator!
  room.spectators.push({
    user,
    joinedAt: Date.now(),
  });

  room.chatMessages.push({
    id: `msg-${Date.now()}`,
    senderId: 'system',
    senderName: 'Mikasa Chess',
    isSpectator: true,
    text: `${user.name} joined as spectator.`,
    timestamp: Date.now(),
    reactions: [],
  });

  return { room, role: 'spectator' };
}

export function removeSpectator(m: RoomManager, code: string, userId: string | number): RoomState | undefined {
  const room = m.rooms.get(code.toUpperCase());
  if (!room) return undefined;
  room.spectators = room.spectators.filter((s) => String(s.user.id) !== String(userId));
  return room;
}

export function handleUserDisconnect(m: RoomManager, code: string, userId: string | number): RoomState | undefined {
  const room = m.rooms.get(code.toUpperCase());
  if (!room) return undefined;

  let modified = false;
  if (room.whitePlayer && String(room.whitePlayer.user.id) === String(userId)) {
    if (room.whitePlayer.connected) {
      room.whitePlayer.connected = false;
      modified = true;
    }
  }
  if (room.blackPlayer && String(room.blackPlayer.user.id) === String(userId)) {
    if (room.blackPlayer.connected) {
      room.blackPlayer.connected = false;
      modified = true;
    }
  }
  const spectatorCountBefore = room.spectators.length;
  room.spectators = room.spectators.filter((s) => String(s.user.id) !== String(userId));
  if (room.spectators.length !== spectatorCountBefore) {
    modified = true;
  }

  return modified ? room : undefined;
}

export function updatePlayerProfile(m: RoomManager, code: string, user: UserProfile): RoomState | undefined {
  const room = m.rooms.get(code.toUpperCase());
  if (!room) return undefined;

  let changed = false;
  if (room.whitePlayer && String(room.whitePlayer.user.id) === String(user.id)) {
    room.whitePlayer.user = {
      ...room.whitePlayer.user,
      ...user,
    };
    changed = true;
  }
  if (room.blackPlayer && String(room.blackPlayer.user.id) === String(user.id)) {
    room.blackPlayer.user = {
      ...room.blackPlayer.user,
      ...user,
    };
    changed = true;
  }

  const spectator = room.spectators.find((s) => String(s.user.id) === String(user.id));
  if (spectator) {
    spectator.user = {
      ...spectator.user,
      ...user,
    };
    changed = true;
  }

  if (changed && m.onRoomStateChanged) {
    m.onRoomStateChanged(room);
  }

  return changed ? room : undefined;
}
