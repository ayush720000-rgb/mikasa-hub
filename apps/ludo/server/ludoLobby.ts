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

export function getOrCreateGame(m: LudoManager, roomCode: string, hostProfile?: any): GameState {
  const code = roomCode.toUpperCase();
  if (m.games.has(code)) {
    return m.games.get(code)!;
  }

  const hostId = hostProfile?.id || 'host_' + Math.random().toString(36).substring(2, 7);
  const hostName = hostProfile?.name || 'Player 1';

  const newGame: GameState = {
    code,
    status: 'waiting',
    hostId,
    players: [
      {
        id: hostId,
        name: hostName,
        username: hostProfile?.username,
        avatarUrl: hostProfile?.avatarUrl,
        color: 'red',
        isHost: true,
        isReady: true,
        isBot: false,
        isConnected: true,
        onlineStatus: 'online',
        consecutiveAutoTurns: 0,
        tokens: m.createInitialTokens(),
      },
    ],
    departedPlayers: [],
    spectators: [],
    currentTurnColor: 'red',
    diceValue: null,
    diceRolled: false,
    turnStartTime: Date.now(),
    turnDuration: TURN_SECONDS,
    legalMoves: [],
    consecutiveSixes: 0,
    winnerColor: null,
    winnerId: null,
    rankings: [],
    stats: {
      durationSeconds: 0,
      turnsCount: 0,
      totalRolls: 0,
      totalCaptures: 0,
      totalSixes: 0,
    },
    lastAction: {
      type: 'start',
      description: 'Lobby created. Waiting for players to join!',
    },
    chat: storage.getChat(code) || [],
    createdAt: Date.now(),
  };

  m.games.set(code, newGame);
  return newGame;
}

export function createInitialTokens(m: LudoManager): [TokenPosition, TokenPosition, TokenPosition, TokenPosition] {
  return [
    { id: 0, state: 'yard', step: -1 },
    { id: 1, state: 'yard', step: -1 },
    { id: 2, state: 'yard', step: -1 },
    { id: 3, state: 'yard', step: -1 },
  ];
}

export function getNextAvailableColor(m: LudoManager, players: LobbyPlayer[]): PlayerColor {
  const taken = new Set(players.map((p) => p.color));
  // Balanced diagonal pairing for 2 players: Red (Top-Left) and Yellow (Bottom-Right)
  const preferredOrder: PlayerColor[] = ['red', 'yellow', 'green', 'blue'];
  for (const color of preferredOrder) {
    if (!taken.has(color)) return color;
  }
  return 'yellow';
}

export function joinLobby(m: LudoManager, code: string,
    user: { id: string; name: string; username?: string; avatarUrl?: string },
    asSpectator: boolean = false): GameState {
  const game = m.getOrCreateGame(code, user);

  if (asSpectator) {
    const existing = game.spectators.find((s) => s.id === user.id);
    if (!existing) {
      game.spectators.push({
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
      });
    }
    m.broadcast(code, { type: 'sync', payload: game });
    return game;
  }

  const existingPlayer = game.players.find((p) => p.id === user.id);
  if (existingPlayer) {
    existingPlayer.isConnected = true;
    existingPlayer.onlineStatus = (existingPlayer.consecutiveAutoTurns && existingPlayer.consecutiveAutoTurns > 0) ? 'afk' : 'online';
    existingPlayer.name = user.name;
    if (user.avatarUrl) existingPlayer.avatarUrl = user.avatarUrl;
    m.broadcast(code, { type: 'sync', payload: game });
    return game;
  }

  if (game.status !== 'waiting' || game.players.length >= 4) {
    // Join as spectator if game is full or already in progress
    const existing = game.spectators.find((s) => s.id === user.id);
    if (!existing) {
      game.spectators.push({
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
      });
    }
    m.broadcast(code, { type: 'sync', payload: game });
    return game;
  }

  const color = m.getNextAvailableColor(game.players);
  const newPlayer: LobbyPlayer = {
    id: user.id,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    color,
    isHost: game.players.length === 0,
    isReady: false,
    isBot: false,
    isConnected: true,
    onlineStatus: 'online',
    consecutiveAutoTurns: 0,
    capturesCount: 0,
    tokens: m.createInitialTokens(),
  };

  game.players.push(newPlayer);
  m.broadcast(code, { type: 'sync', payload: game });
  return game;
}

export function selectColor(m: LudoManager, code: string, userId: string, newColor: PlayerColor) {
  const game = m.getGame(code);
  if (!game || game.status !== 'waiting') return;

  // Check if color is already taken
  const isTaken = game.players.some((p) => p.id !== userId && p.color === newColor);
  if (isTaken) return;

  const player = game.players.find((p) => p.id === userId);
  if (player) {
    player.color = newColor;
    m.broadcast(code, { type: 'sync', payload: game });
  }
}

export function toggleReady(m: LudoManager, code: string, userId: string) {
  const game = m.getGame(code);
  if (!game || game.status !== 'waiting') return;

  const player = game.players.find((p) => p.id === userId);
  if (player) {
    player.isReady = !player.isReady;
    m.broadcast(code, { type: 'sync', payload: game });
  }
}

export function addBot(m: LudoManager, code: string, hostId: string) {
  const game = m.getGame(code);
  if (!game || game.status !== 'waiting' || game.hostId !== hostId || game.players.length >= 4) {
    return;
  }

  const botNames = ['Mikasa ⚔️', 'Levi ⚡', 'Eren 🛡️', 'Armin 🧠'];
  const botAvatars = [
    'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1563089145-599997674d42?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
  ];

  const idx = game.players.length;
  const color = m.getNextAvailableColor(game.players);

  const bot: LobbyPlayer = {
    id: 'bot_' + Math.random().toString(36).substring(2, 7),
    name: botNames[idx % botNames.length],
    avatarUrl: botAvatars[idx % botAvatars.length],
    color,
    isHost: false,
    isReady: true,
    isBot: true,
    isConnected: true,
    onlineStatus: 'online',
    consecutiveAutoTurns: 0,
    capturesCount: 0,
    tokens: m.createInitialTokens(),
  };

  game.players.push(bot);
  m.broadcast(code, { type: 'sync', payload: game });
}

  /** Host removes an AI bot while the lobby is still waiting. Without botId, removes the last bot added. */
export function removeBot(m: LudoManager, code: string, hostId: string, botId?: string) {
  const game = m.getGame(code);
  if (!game || game.status !== 'waiting' || game.hostId !== hostId) return;

  const index = botId
    ? game.players.findIndex((p) => p.isBot && p.id === botId)
    : game.players.map((p) => p.isBot).lastIndexOf(true);
  if (index < 0) return;

  game.players.splice(index, 1);
  m.broadcast(code, { type: 'sync', payload: game });
}

  /** A deliberate leave forfeits the active match. Remaining players keep playing. */
export function leaveMatch(m: LudoManager, code: string, playerId: string) {
  const game = m.getGame(code);
  if (!game) return;
  if (game.status === 'waiting') {
    m.removePlayer(code, playerId);
    return;
  }
  if (game.status !== 'in_progress') return;

  const leaving = game.players.find((p) => p.id === playerId);
  if (!leaving || leaving.isBot) return;
  const wasCurrentTurn = game.currentTurnColor === leaving.color;
  // Keep the complete player snapshot (including Telegram name/avatar) for the final result card.
  game.departedPlayers = game.departedPlayers || [];
  if (!game.departedPlayers.some((p) => p.id === leaving.id)) {
    game.departedPlayers.push({ ...leaving, tokens: leaving.tokens.map((t) => ({ ...t })) as LobbyPlayer['tokens'] });
  }
  game.players = game.players.filter((p) => p.id !== playerId);
  game.lastAction = {
    type: 'pass',
    description: `🚪 ${leaving.name} left the match.`,
    color: leaving.color,
  };
  m.handleChatMessage(code, { id: 'system', name: 'Mikasa' }, `🚪 ${leaving.name} left the match.`);

  if (game.players.length === 1) {
    m.finishByForfeit(game, game.players[0], `${leaving.name} left the match.`);
    return;
  }

  if (wasCurrentTurn) {
    m.clearTurnTimer(code);
    game.diceRolled = false;
    game.diceValue = null;
    game.legalMoves = [];
    const removedIndex = COLOR_TURN_ORDER.indexOf(leaving.color);
    let next = game.players[0].color;
    for (let offset = 1; offset <= COLOR_TURN_ORDER.length; offset++) {
      const candidate = COLOR_TURN_ORDER[(removedIndex + offset) % COLOR_TURN_ORDER.length];
      if (game.players.some((p) => p.color === candidate && !hasPlayerWon(p.tokens))) { next = candidate; break; }
    }
    game.currentTurnColor = next;
    m.startTurnTimer(game);
    const nextPlayer = game.players.find((p) => p.color === next);
    if (nextPlayer?.isBot) setTimeout(() => m.executeBotTurn(code), 700);
  }
  m.broadcast(code, { type: 'sync', payload: game });
}

  /** End a match when only one active player remains after a forfeit/AFK removal. */
export function finishByForfeit(m: LudoManager, game: GameState, winner: LobbyPlayer, reason: string) {
  m.clearTurnTimer(game.code);
  game.status = 'ended';
  game.winnerColor = winner.color;
  game.winnerId = winner.id;
  const departed = [...(game.departedPlayers || [])].reverse().filter((p) => p.id !== winner.id);
  winner.rank = 1;
  winner.score = Math.max(180, (winner.score || 0) + 180);
  departed.forEach((player, index) => { player.rank = index + 2; });
  game.rankings = [winner, ...departed].map((p) => p.color);
  game.lastAction = {
    type: 'home',
    description: `👑 ${winner.name} wins! ${reason}`,
    color: winner.color,
  };
  m.handleChatMessage(game.code, { id: 'system', name: 'Mikasa' }, `🏆 ${winner.name} wins the match! ${reason}`);
  storage.recordMatchEnd({
    id: 'match_' + Date.now(),
    code: game.code,
    players: [winner, ...departed].map((p) => ({
      id: p.id, name: p.name, username: p.username, avatarUrl: p.avatarUrl,
      color: p.color, isBot: p.isBot, score: p.score || 0, rank: p.rank,
    })),
    winnerColor: winner.color,
    winnerId: winner.id,
    stats: game.stats,
    endedAt: Date.now(),
  });
  m.broadcast(game.code, { type: 'sync', payload: game });
}

export function removePlayer(m: LudoManager, code: string, playerId: string) {
  const game = m.getGame(code);
  if (!game || game.status !== 'waiting') return;

  game.players = game.players.filter((p) => p.id !== playerId);
  if (game.players.length > 0 && game.hostId === playerId) {
    game.players[0].isHost = true;
    game.hostId = game.players[0].id;
  }
  m.broadcast(code, { type: 'sync', payload: game });
}

export function startGame(m: LudoManager, code: string, hostId: string) {
  const game = m.getGame(code);
  if (!game || game.status !== 'waiting' || game.hostId !== hostId) return;
  if (game.players.length < 2) return;

  game.status = 'in_progress';
  game.currentTurnColor = game.players[0].color;
  game.diceValue = null;
  game.diceRolled = false;
  game.legalMoves = [];
  game.consecutiveSixes = 0;
  game.turnStartTime = Date.now();
  game.lastAction = {
    type: 'start',
    description: `Game started! ${game.players[0].name}'s turn to roll!`,
    color: game.currentTurnColor,
  };

  m.startTurnTimer(game);
  m.broadcast(code, { type: 'sync', payload: game });

  // Check if the starting player is a bot
  const currentPlayer = game.players.find((p) => p.color === game.currentTurnColor);
  if (currentPlayer && currentPlayer.isBot) {
    setTimeout(() => m.executeBotTurn(code), 1000);
  }
}
