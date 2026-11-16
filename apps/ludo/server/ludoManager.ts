import { rollFairDie, ShuffledBagDie } from './dice';

// Dice state per match. WeakMap so finished games are garbage-collected.
const matchDice = new WeakMap<object, ShuffledBagDie>();
const USE_SHUFFLED_BAG = true; // disclosed in the lobby rules; same for every player
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
  applyTokenMove,
  chooseBestBotMove,
  evaluateSixes,
  getLegalMoves,
  hasPlayerWon,
  MAX_STEP,
  nextTurnColor,
} from '../src/utils/ludoRules';
import { storage } from './storage';
import { TURN_SECONDS } from './ludoConfig';
import { getOrCreateGame, createInitialTokens, getNextAvailableColor, joinLobby, selectColor, toggleReady, addBot, removeBot, leaveMatch, finishByForfeit, removePlayer, startGame } from './ludoLobby';
import { handleChatMessage, handleChatReaction, handleQuickReaction, rematch } from './ludoChat';


export interface ClientConnection {
  ws: WebSocket;
  userId: string;
  roomCode: string;
}

// Games that nobody is using are removed, so a server that stays up for weeks does not fill
// its memory with old matches and chat history. Saved match history is not affected.
const ENDED_GAME_TTL_MS = 2 * 60 * 60_000;      // finished match, idle for 2 hours
const ABANDONED_GAME_TTL_MS = 60 * 60_000;      // nobody connected, idle for 1 hour
const MAX_GAME_AGE_MS = 24 * 60 * 60_000;       // nothing lives longer than a day
/** Most games held at once. New games are refused beyond this. */
export const MAX_GAMES = 1000;

/** The newest sign of life in a game: creation, last turn start or last chat message. */
function lastActivity(game: GameState): number {
  const lastChat = game.chat.length ? game.chat[game.chat.length - 1].timestamp : 0;
  return Math.max(game.createdAt || 0, game.turnStartTime || 0, lastChat || 0);
}

export class LudoManager {
  public games: Map<string, GameState> = new Map();
  public timers: Map<string, NodeJS.Timeout> = new Map();
  public connections: Map<string, Set<WebSocket>> = new Map(); // roomCode -> WebSockets

  constructor() {}

  public getOrCreateGame(roomCode: string, hostProfile?: any): GameState {
    return getOrCreateGame(this, roomCode, hostProfile);
  }

  public getGame(code: string): GameState | undefined {
    return this.games.get(code.toUpperCase());
  }

  /** True while at least one browser is connected to the room. */
  public hasOpenConnection(roomCode: string): boolean {
    const set = this.connections.get(roomCode.toUpperCase());
    if (!set) return false;
    for (const ws of set) if (ws.readyState === WebSocket.OPEN) return true;
    return false;
  }

  /** Remove games that are finished, abandoned or very old. Returns how many were removed. */
  public sweepGames(now: number = Date.now()): number {
    let removed = 0;
    for (const [code, game] of this.games) {
      const idle = now - lastActivity(game);
      const expired =
        now - (game.createdAt || now) > MAX_GAME_AGE_MS ||
        (game.status === 'ended' && idle > ENDED_GAME_TTL_MS) ||
        (!this.hasOpenConnection(code) && idle > ABANDONED_GAME_TTL_MS);
      if (!expired) continue;
      const timer = this.timers.get(code);
      if (timer) clearTimeout(timer);
      this.timers.delete(code);
      this.connections.delete(code);
      this.games.delete(code);
      removed += 1;
    }
    return removed;
  }

  public getActivePublicGames(): { code: string; playersCount: number; status: string }[] {
    const list: { code: string; playersCount: number; status: string }[] = [];
    this.games.forEach((game) => {
      list.push({
        code: game.code,
        playersCount: game.players.length,
        status: game.status,
      });
    });
    return list;
  }

  public registerConnection(roomCode: string, ws: WebSocket) {
    const code = roomCode.toUpperCase();
    if (!this.connections.has(code)) {
      this.connections.set(code, new Set());
    }
    this.connections.get(code)!.add(ws);
  }

  public removeConnection(roomCode: string, ws: WebSocket, userId?: string | null) {
    const code = roomCode.toUpperCase();
    const set = this.connections.get(code);
    if (set) {
      set.delete(ws);
      if (set.size === 0) this.connections.delete(code);
    }
    const game = this.getGame(code);
    if (game && userId) {
      const p = game.players.find((pl) => pl.id === userId);
      if (p) {
        p.isConnected = false;
        if (p.onlineStatus !== 'afk') {
          p.onlineStatus = 'offline';
        }
        this.broadcast(code, { type: 'sync', payload: game });
      }
    }
  }

  public broadcast(roomCode: string, message: any) {
    const code = roomCode.toUpperCase();
    const set = this.connections.get(code);
    if (!set) return;

    const payload = JSON.stringify(message);
    set.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  public createInitialTokens(): [TokenPosition, TokenPosition, TokenPosition, TokenPosition] {
    return createInitialTokens(this);
  }

  public getNextAvailableColor(players: LobbyPlayer[]): PlayerColor {
    return getNextAvailableColor(this, players);
  }

  public joinLobby(
    code: string,
    user: { id: string; name: string; username?: string; avatarUrl?: string },
    asSpectator: boolean = false
  ): GameState {
    return joinLobby(this, code, user, asSpectator);
  }

  public selectColor(code: string, userId: string, newColor: PlayerColor) {
    return selectColor(this, code, userId, newColor);
  }

  public toggleReady(code: string, userId: string) {
    return toggleReady(this, code, userId);
  }

  public addBot(code: string, hostId: string) {
    return addBot(this, code, hostId);
  }

  public removeBot(code: string, hostId: string, botId?: string) {
    return removeBot(this, code, hostId, botId);
  }

  public leaveMatch(code: string, playerId: string) {
    return leaveMatch(this, code, playerId);
  }

  public finishByForfeit(game: GameState, winner: LobbyPlayer, reason: string) {
    return finishByForfeit(this, game, winner, reason);
  }

  public removePlayer(code: string, playerId: string) {
    return removePlayer(this, code, playerId);
  }

  public startGame(code: string, hostId: string) {
    return startGame(this, code, hostId);
  }

  public startTurnTimer(game: GameState) {
    this.clearTurnTimer(game.code);

    game.turnStartTime = Date.now();
    game.turnDuration = TURN_SECONDS;

    const timer = setTimeout(() => {
      this.handleTurnTimeout(game.code);
    }, TURN_SECONDS * 1000);

    this.timers.set(game.code, timer);
  }

  public clearTurnTimer(code: string) {
    const existing = this.timers.get(code);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(code);
    }
  }

  public handleTurnTimeout(code: string) {
    const game = this.getGame(code);
    if (!game || game.status !== 'in_progress') return;

    const currentPlayer = game.players.find((p) => p.color === game.currentTurnColor);
    if (!currentPlayer) return;

    // Track consecutive automatic turns for human players
    if (!currentPlayer.isBot) {
      currentPlayer.consecutiveAutoTurns = (currentPlayer.consecutiveAutoTurns || 0) + 1;
      currentPlayer.onlineStatus = 'afk';

      // Five consecutive unattended turns means the player is removed from this match.
      if (currentPlayer.consecutiveAutoTurns >= 5) {
        const originalName = currentPlayer.name;
        const removedColor = currentPlayer.color;
        // Preserve the departed player's identity for the end-of-match podium image.
        game.departedPlayers = game.departedPlayers || [];
        if (!game.departedPlayers.some((p) => p.id === currentPlayer.id)) {
          game.departedPlayers.push({ ...currentPlayer, tokens: currentPlayer.tokens.map((t) => ({ ...t })) as LobbyPlayer['tokens'] });
        }
        game.players = game.players.filter((p) => p.id !== currentPlayer.id);
        game.lastAction = {
          type: 'pass',
          description: `🚪 ${originalName} was removed after missing 5 consecutive turns.`,
          color: removedColor,
        };
        this.handleChatMessage(code, { id: 'system', name: 'Mikasa' }, `🚪 ${originalName} was removed after missing 5 consecutive turns.`);

        if (game.players.length === 1) {
          this.finishByForfeit(game, game.players[0], `${originalName} was removed after 5 missed turns.`);
          return;
        }

        game.diceRolled = false;
        game.diceValue = null;
        game.legalMoves = [];
        const removedIndex = COLOR_TURN_ORDER.indexOf(removedColor);
        let nextColor = game.players[0].color;
        for (let offset = 1; offset <= COLOR_TURN_ORDER.length; offset++) {
          const candidate = COLOR_TURN_ORDER[(removedIndex + offset) % COLOR_TURN_ORDER.length];
          if (game.players.some((p) => p.color === candidate && !hasPlayerWon(p.tokens))) { nextColor = candidate; break; }
        }
        game.currentTurnColor = nextColor;
        const nextPlayer = game.players.find((p) => p.color === nextColor);
        this.startTurnTimer(game);
        this.broadcast(code, { type: 'sync', payload: game });
        if (nextPlayer?.isBot) setTimeout(() => this.executeBotTurn(code), 700);
        return;
      }
    }

    if (!game.diceRolled) {
      // The full turn has expired: auto-roll and auto-select a legal token.
      this.rollDice(code, currentPlayer.id, true);
    } else {
      // The player rolled manually but did not finish the move in time.
      // Auto-select the best legal move instead of always moving token zero.
      if (game.legalMoves.length > 0) {
        const roll = game.diceValue;
        const tokenIdx = roll === null
          ? game.legalMoves[0]
          : chooseBestBotMove(currentPlayer, roll, game.players, game.legalMoves);
        this.moveToken(code, currentPlayer.id, tokenIdx, true);
      } else {
        this.passTurn(game, 'Turn timed out. No legal moves.');
      }
    }
  }

  public rollDice(code: string, userId: string, isTimeout: boolean = false) {
    const game = this.getGame(code);
    if (!game || game.status !== 'in_progress' || game.diceRolled) return;

    const currentPlayer = game.players.find((p) => p.color === game.currentTurnColor);
    if (!currentPlayer || (currentPlayer.id !== userId && !isTimeout)) return;

    // Reset AFK counter when human manually rolls
    if (!currentPlayer.isBot && !isTimeout) {
      currentPlayer.consecutiveAutoTurns = 0;
      currentPlayer.onlineStatus = currentPlayer.isConnected ? 'online' : 'offline';
    }

    // Independent, unbiased server-side roll. Never adjust odds based on streaks or player state.
    let roll: number;
    if (USE_SHUFFLED_BAG) {
      if (!matchDice.has(game)) matchDice.set(game, new ShuffledBagDie());
      roll = matchDice.get(game)!.next();
    } else {
      roll = rollFairDie();
    }
    game.diceValue = roll;
    game.diceRolled = true;
    game.stats.totalRolls += 1;

    if (roll === 6) game.stats.totalSixes += 1;
    const sixes = evaluateSixes(game.consecutiveSixes, roll);
    game.consecutiveSixes = sixes.consecutiveSixes;

    // 3 sixes penalty rule: pass turn immediately
    if (sixes.penalty) {
      game.lastAction = {
        type: 'roll',
        description: `${currentPlayer.name} rolled three consecutive sixes! Turn passed.`,
        color: currentPlayer.color,
      };
      this.passTurn(game, `${currentPlayer.name} rolled 3 sixes!`);
      return;
    }

    const legal = getLegalMoves(currentPlayer.tokens, roll);
    game.legalMoves = legal;

    game.lastAction = {
      type: 'roll',
      description: `${currentPlayer.name} rolled a ${roll}!`,
      color: currentPlayer.color,
    };

    if (legal.length === 0) {
      // No legal moves possible, pass turn after brief delay
      this.broadcast(code, { type: 'sync', payload: game });
      setTimeout(() => {
        this.passTurn(game, `${currentPlayer.name} has no legal moves.`);
      }, 1200);
      return;
    }

    // A timed-out human turn is fully auto-played: roll, then choose a legal
    // token using the same deterministic move evaluator used by bots. The
    // timeout is counted once in handleTurnTimeout; this does not alter dice odds.
    if (isTimeout) {
      this.broadcast(code, { type: 'sync', payload: game });
      const autoMove = chooseBestBotMove(currentPlayer, roll, game.players, legal);
      setTimeout(() => {
        const latest = this.getGame(code);
        if (!latest || latest.status !== 'in_progress' || latest.currentTurnColor !== currentPlayer.color || !latest.diceRolled) return;
        this.moveToken(code, currentPlayer.id, autoMove, true);
      }, 450);
      return;
    }

    // Bots use the same legal-move evaluator, with a short presentation delay.
    if (currentPlayer.isBot) {
      this.broadcast(code, { type: 'sync', payload: game });
      const bestMove = chooseBestBotMove(currentPlayer, roll, game.players, legal);
      setTimeout(() => {
        const latest = this.getGame(code);
        if (!latest || latest.status !== 'in_progress' || latest.currentTurnColor !== currentPlayer.color || !latest.diceRolled) return;
        this.moveToken(code, currentPlayer.id, bestMove);
      }, 800);
      return;
    }

    this.broadcast(code, { type: 'sync', payload: game });
  }

  public moveToken(code: string, userId: string, tokenIndex: number, isTimeout: boolean = false) {
    const game = this.getGame(code);
    if (!game || game.status !== 'in_progress' || !game.diceRolled || game.diceValue === null) return;

    const currentPlayer = game.players.find((p) => p.color === game.currentTurnColor);
    if (!currentPlayer || (currentPlayer.id !== userId && !isTimeout)) return;

    if (!game.legalMoves.includes(tokenIndex)) return;

    // Reset AFK counter when human manually moves
    if (!currentPlayer.isBot && !isTimeout) {
      currentPlayer.consecutiveAutoTurns = 0;
      currentPlayer.onlineStatus = currentPlayer.isConnected ? 'online' : 'offline';
    }

    const roll = game.diceValue;

    const result = applyTokenMove(game.players, currentPlayer.color, tokenIndex, roll);
    if (!result) return;
    const { capture, reachedHome } = result;
    const earnedBonus = reachedHome || capture !== null;
    let actionDesc = `${currentPlayer.name} moved token ${tokenIndex + 1}`;

    if (reachedHome) {
      actionDesc = `🎉 ${currentPlayer.name}'s token entered Home! Extra turn awarded!`;
    }

    if (capture) {
      game.stats.totalCaptures += 1;
      currentPlayer.capturesCount = (currentPlayer.capturesCount || 0) + 1;
      storage.addCapture(currentPlayer.id);
      const victimPlayer = game.players.find((p) => p.id === capture.capturedPlayerId);
      if (victimPlayer) {
        actionDesc = `⚔️ ${currentPlayer.name} captured ${victimPlayer.name}'s token! Extra turn awarded!`;
      }
    }

    if (roll === 6 && !earnedBonus) {
      actionDesc = `🎲 ${currentPlayer.name} rolled a 6! Extra turn awarded!`;
    }
    const extraTurn = result.extraTurn;

    game.lastAction = {
      type: capture ? 'capture' : reachedHome ? 'home' : 'move',
      description: actionDesc,
      color: currentPlayer.color,
      tokenIndex,
      extraTurn,
    };

    // Check victory
    if (hasPlayerWon(currentPlayer.tokens)) {
      if (!game.winnerColor) {
        game.winnerColor = currentPlayer.color;
        game.winnerId = currentPlayer.id;
        game.status = 'ended';
        this.clearTurnTimer(code);

        // Calculate dynamic scores and rankings for ALL 4 players
        const playerScores = game.players.map((p) => {
          let finishedCount = 0;
          let totalSteps = 0;
          p.tokens.forEach((t) => {
            if (t.step >= MAX_STEP) finishedCount += 1;
            totalSteps += Math.max(0, t.step);
          });
          const userRecord = storage.getUser(p.id);
          const isWinner = p.id === currentPlayer.id;
          const gamesWon = p.isBot ? Math.floor(Math.random() * 2) + 1 : (userRecord?.wins || (isWinner ? 1 : 0));
          const totalGames = p.isBot ? gamesWon + Math.floor(Math.random() * 3) + 2 : Math.max(gamesWon + 1, userRecord?.gamesPlayed || 1);

          let baseScore = finishedCount * 100 + Math.round(totalSteps * 1.5);
          if (isWinner) baseScore += 180;
          else baseScore += Math.floor(Math.random() * 15);

          return {
            player: p,
            finishedCount,
            totalSteps,
            score: Math.max(120, baseScore),
            gamesWon,
            totalGames,
          };
        });

        // 1st place is currentPlayer
        const winnerEntry = playerScores.find((e) => e.player.id === currentPlayer.id);
        const otherEntries = playerScores
          .filter((e) => e.player.id !== currentPlayer.id)
          .sort((a, b) => b.finishedCount - a.finishedCount || b.totalSteps - a.totalSteps || b.score - a.score);

        const activeRanked = [winnerEntry, ...otherEntries].filter(Boolean) as typeof playerScores;
        const departedRanked = [...(game.departedPlayers || [])].reverse()
          .filter((p) => !activeRanked.some((entry) => entry.player.id === p.id))
          .map((player) => ({
            player, finishedCount: 0,
            totalSteps: player.tokens.reduce((sum, token) => sum + Math.max(0, token.step), 0),
            score: player.score || 0,
            gamesWon: player.gamesWon || 0,
            totalGames: player.totalGames || 0,
          }));
        const fullRanked = [...activeRanked, ...departedRanked];

        // Assign ranks and scores across active and departed participants.
        fullRanked.forEach((entry, idx) => {
          entry.player.rank = idx + 1;
          entry.player.score = entry.score;
          entry.player.gamesWon = entry.gamesWon;
          entry.player.totalGames = entry.totalGames;
          if (!game.players.some((p) => p.id === entry.player.id)) {
            game.players.push(entry.player);
          }
        });

        game.rankings = fullRanked.map((e) => e.player.color);

        // Record match in persistent storage
        storage.recordMatchEnd({
          id: 'match_' + Date.now(),
          code: game.code,
          players: game.players.map((p) => ({
            id: p.id,
            name: p.name,
            username: p.username,
            avatarUrl: p.avatarUrl,
            color: p.color,
            isBot: p.isBot,
            score: p.score,
            rank: p.rank,
          })),
          winnerColor: currentPlayer.color,
          winnerId: currentPlayer.id,
          stats: game.stats,
          endedAt: Date.now(),
        });

        this.broadcast(code, { type: 'sync', payload: game });
        return;
      }
    }

    if (extraTurn) {
      // Player rolls again!
      game.diceRolled = false;
      game.diceValue = null;
      game.legalMoves = [];
      this.startTurnTimer(game);
      this.broadcast(code, { type: 'sync', payload: game });

      if (currentPlayer.isBot) {
        setTimeout(() => this.executeBotTurn(code), 1000);
      }
    } else {
      this.passTurn(game);
    }
  }

  public passTurn(game: GameState, customMsg?: string) {
    game.stats.turnsCount += 1;
    game.diceRolled = false;
    game.diceValue = null;
    game.legalMoves = [];
    game.consecutiveSixes = 0;

    // Next player in clockwise order who has not finished all four tokens
    const nextColor: PlayerColor = nextTurnColor(game.players, game.currentTurnColor, COLOR_TURN_ORDER);

    game.currentTurnColor = nextColor;
    const nextPlayer = game.players.find((p) => p.color === nextColor);

    if (customMsg) {
      game.lastAction = {
        type: 'pass',
        description: `${customMsg} ${nextPlayer?.name}'s turn.`,
        color: nextColor,
      };
    } else {
      game.lastAction = {
        type: 'move',
        description: `${nextPlayer?.name}'s turn to roll!`,
        color: nextColor,
      };
    }

    this.startTurnTimer(game);
    this.broadcast(game.code, { type: 'sync', payload: game });

    if (nextPlayer && nextPlayer.isBot) {
      setTimeout(() => this.executeBotTurn(game.code), 1000);
    }
  }

  public executeBotTurn(code: string) {
    const game = this.getGame(code);
    if (!game || game.status !== 'in_progress') return;

    const currentPlayer = game.players.find((p) => p.color === game.currentTurnColor);
    if (!currentPlayer || !currentPlayer.isBot) return;

    if (!game.diceRolled) {
      this.rollDice(code, currentPlayer.id);
    }
  }

  public handleChatMessage(
    code: string,
    sender: { id: string; name: string; avatarUrl?: string },
    text: string,
    replyTo?: { id: string; senderName: string; text: string }
  ) {
    return handleChatMessage(this, code, sender, text, replyTo);
  }

  public handleChatReaction(
    code: string,
    messageId: string,
    emoji: string,
    user: { id: string; name?: string; avatarUrl?: string }
  ) {
    return handleChatReaction(this, code, messageId, emoji, user);
  }

  public handleQuickReaction(code: string, userId: string, emoji: string) {
    return handleQuickReaction(this, code, userId, emoji);
  }

  public rematch(code: string, _userId: string) {
    return rematch(this, code, _userId);
  }
}

export const ludoManager = new LudoManager();
