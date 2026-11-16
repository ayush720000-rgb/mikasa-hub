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
import { resign, offerDraw, respondDraw, rematchMatch } from './roomResult';
import { createRoom, joinRoom, removeSpectator, handleUserDisconnect, updatePlayerProfile } from './roomLobby';

// Rooms that nobody is using are removed, so a server that stays up for weeks does not fill
// its memory with old games and chat history.
const FINISHED_ROOM_TTL_MS = 2 * 60 * 60_000;   // finished game, idle for 2 hours
const ABANDONED_ROOM_TTL_MS = 60 * 60_000;      // no human connected, idle for 1 hour
const ANY_ROOM_TTL_MS = 12 * 60 * 60_000;       // anything, idle for 12 hours
const SWEEP_EVERY_TICKS = 60;                   // the clock ticks once a second
/** Most rooms the server holds at once. New rooms are refused beyond this. */
export const MAX_ROOMS = 1000;

/** The newest sign of life in a room: creation, last move or last chat message. */
function lastActivity(room: RoomState): number {
  const lastChat = room.chatMessages.length
    ? room.chatMessages[room.chatMessages.length - 1].timestamp
    : 0;
  return Math.max(room.createdTimestamp || 0, room.lastMoveTimestamp || 0, lastChat || 0);
}

function hasConnectedHuman(room: RoomState): boolean {
  return [room.whitePlayer, room.blackPlayer].some((p) => p && !p.user.isBot && p.connected);
}

export class RoomManager {
  private clockTicks = 0;
  public rooms: Map<string, RoomState> = new Map();
  public chessInstances: Map<string, Chess> = new Map();
  public botTimers: Map<string, NodeJS.Timeout> = new Map();
  public clockInterval?: NodeJS.Timeout;
  public onRoomStateChanged?: (
    room: RoomState,
    soundEvent?: { isCapture: boolean; isCheck: boolean }
  ) => void;

  constructor() {
    // Regular 1s clock ticker: immediately resolves match if an in-progress timer expires
    this.clockInterval = setInterval(() => {
      this.checkClocks();
      if (++this.clockTicks % SWEEP_EVERY_TICKS === 0) this.sweepRooms();
    }, 1000);
  }

  /** Remove rooms that are finished, abandoned or very old. Returns how many were removed. */
  public sweepRooms(now: number = Date.now()): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      const idle = now - lastActivity(room);
      const expired =
        idle > ANY_ROOM_TTL_MS ||
        (room.status === 'finished' && idle > FINISHED_ROOM_TTL_MS) ||
        (!hasConnectedHuman(room) && idle > ABANDONED_ROOM_TTL_MS);
      if (!expired) continue;
      this.clearBotTimer(code);
      this.chessInstances.delete(code);
      this.rooms.delete(code);
      removed += 1;
    }
    return removed;
  }

  public checkClocks(): void {
    return checkClocks(this);
  }

  public clearBotTimer(code: string): void {
    return clearBotTimer(this, code);
  }

  public destroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
    for (const timer of this.botTimers.values()) {
      clearTimeout(timer);
    }
    this.botTimers.clear();
  }

  public setOnRoomStateChanged(
    cb: (room: RoomState, soundEvent?: { isCapture: boolean; isCheck: boolean }) => void
  ) {
    this.onRoomStateChanged = cb;
  }

  public createRoom(host: UserProfile, rules: GameRules, customCode?: string): RoomState {
    return createRoom(this, host, rules, customCode);
  }

  public getRoom(code: string): RoomState | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  public joinRoom(
    code: string,
    user: UserProfile,
    asSpectator: boolean = false
  ): { room: RoomState; role: 'white' | 'black' | 'spectator'; error?: string } | { error: string } {
    return joinRoom(this, code, user, asSpectator);
  }

  public removeSpectator(code: string, userId: string | number): RoomState | undefined {
    return removeSpectator(this, code, userId);
  }

  public handleUserDisconnect(code: string, userId: string | number): RoomState | undefined {
    return handleUserDisconnect(this, code, userId);
  }

  public updatePlayerProfile(code: string, user: UserProfile): RoomState | undefined {
    return updatePlayerProfile(this, code, user);
  }

  public makeMove(
    code: string,
    userId: string | number,
    move: { from: string; to: string; promotion?: string }
  ): { success: boolean; room?: RoomState; error?: string } {
    const upperCode = code.toUpperCase();
    const room = this.rooms.get(upperCode);
    let chess = this.chessInstances.get(upperCode);

    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    // Ensure chess instance exists and matches room FEN
    if (!chess) {
      chess = new Chess(room.fen);
      this.chessInstances.set(upperCode, chess);
    } else if (chess.fen() !== room.fen) {
      try {
        chess.load(room.fen);
      } catch {
        // ignore
      }
    }

    if (room.status !== 'in_progress') {
      return { success: false, error: 'Game is not in progress' };
    }

    // Check player turn & authorization
    const currentTurn = chess.turn(); // 'w' | 'b'
    const player = currentTurn === 'w' ? room.whitePlayer : room.blackPlayer;

    if (!player || String(player.user.id) !== String(userId)) {
      return { success: false, error: 'Not your turn or unauthorized' };
    }

    // Normalize coordinates
    const from = (move.from || '').toLowerCase();
    const to = (move.to || '').toLowerCase();

    // Check pawn promotion requirement
    const piece = chess.get(from as any);
    const isPawn = piece && piece.type === 'p';
    const isPromotionRank = to.endsWith('8') || to.endsWith('1');
    const promotion = isPawn && isPromotionRank ? (move.promotion || 'q').toLowerCase() : undefined;

    // Update player timer
    if (room.gameRules.timerEnabled && room.lastMoveTimestamp) {
      const elapsed = Date.now() - room.lastMoveTimestamp;
      player.timeLeftMs = Math.max(0, player.timeLeftMs - elapsed);
      player.timeLeftMs += (room.gameRules.incrementSec || 0) * 1000;

      if (player.timeLeftMs <= 0) {
        room.status = 'finished';
        room.resolution = 'timeout';
        room.winnerColor = currentTurn === 'w' ? 'b' : 'w';
        room.winnerUserId =
          currentTurn === 'w' ? room.blackPlayer?.user.id : room.whitePlayer?.user.id;
        return { success: true, room };
      }
    }

    try {
      const result = chess.move({
        from,
        to,
        promotion: promotion as any,
      });

      if (!result) {
        return { success: false, error: 'Illegal move' };
      }

      room.fen = chess.fen();
      room.turn = chess.turn();
      room.pgn = chess.pgn();
      room.lastMove = { from, to, san: result.san };
      room.lastMoveTimestamp = Date.now();
      room.drawOffer = null; // Making a move automatically clears pending draw offers

      // Check game end conditions
      if (chess.isCheckmate()) {
        room.status = 'finished';
        room.resolution = 'checkmate';
        room.winnerColor = currentTurn;
        room.winnerUserId = player.user.id;
      } else if (chess.isDraw()) {
        room.status = 'finished';
        if (chess.isStalemate()) room.resolution = 'draw_stalemate';
        else if (chess.isInsufficientMaterial()) room.resolution = 'draw_insufficient_material';
        else if (chess.isThreefoldRepetition()) room.resolution = 'draw_threefold_repetition';
        else room.resolution = 'draw_50_move';
      }

      // If playing against Bot and game continues, schedule Bot move!
      if (room.status === 'in_progress' && room.gameRules.isBotGame) {
        const nextPlayer = room.turn === 'w' ? room.whitePlayer : room.blackPlayer;
        if (nextPlayer?.user.isBot) {
          this.scheduleBotMove(upperCode, 400);
        }
      }

      return { success: true, room };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid move';
      return { success: false, error: message };
    }
  }

  public scheduleBotMove(code: string, delayMs: number = 400): void {
    return scheduleBotMove(this, code, delayMs);
  }

  public async executeBotMove(code: string): Promise<void> {
    return executeBotMove(this, code);
  }

  public resign(code: string, userId: string | number): RoomState | undefined {
    return resign(this, code, userId);
  }

  public offerDraw(code: string, userId: string | number): RoomState | undefined {
    return offerDraw(this, code, userId);
  }

  public respondDraw(code: string, userId: string | number, accept: boolean): RoomState | undefined {
    return respondDraw(this, code, userId, accept);
  }

  public addChatMessage(
    code: string,
    message: Omit<ChatMessage, 'id' | 'timestamp' | 'reactions'>
  ): ChatMessage | undefined {
    return addChatMessage(this, code, message);
  }

  public addReaction(
    code: string,
    messageId: string,
    emoji: string,
    reactor: ChatReactionUser
  ): RoomState | undefined {
    return addReaction(this, code, messageId, emoji, reactor);
  }

  public rematchMatch(code: string, _requesterUserId?: string | number): RoomState | undefined {
    return rematchMatch(this, code, _requesterUserId);
  }
}
