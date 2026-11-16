// Shared between the server (which records finished games) and the client (which shows them).
// Nothing here touches browser storage: stats live on the server, in Postgres.
import type { GameResolution, RoomState } from '../types/chess';

export interface MatchRecord {
  id: string;
  date: number; // timestamp of when the game finished
  opponentName: string;
  opponentAvatar?: string;
  isBot: boolean;
  botDifficulty?: string;
  result: 'win' | 'loss' | 'draw';
  resolution: GameResolution | string;
  playerColor: 'w' | 'b';
  totalMoves: number;
  avgMoveTimeSec: number;
  durationSec: number;
}

export interface PlayerStatsData {
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // percentage 0-100
  overallAvgMoveTimeSec: number;
  fastestMoveSec: number;
  recentMatches: MatchRecord[];
}

export const MAX_STORED_MATCHES = 50;

/** Build one player's record from a finished room. Returns null if the user did not play. */
export function buildMatchRecord(room: RoomState, playerId: string | number): MatchRecord | null {
  if (room.status !== 'finished') return null;
  const me = String(playerId);
  const whiteId = room.whitePlayer?.user.id;
  const blackId = room.blackPlayer?.user.id;
  let playerColor: 'w' | 'b';
  let opponent;
  if (whiteId !== undefined && String(whiteId) === me) {
    playerColor = 'w';
    opponent = room.blackPlayer?.user;
  } else if (blackId !== undefined && String(blackId) === me) {
    playerColor = 'b';
    opponent = room.whitePlayer?.user;
  } else {
    return null;
  }

  const isDraw = !room.winnerUserId || (room.resolution ?? '').startsWith('draw');
  const result: MatchRecord['result'] = isDraw
    ? 'draw'
    : String(room.winnerUserId) === me
      ? 'win'
      : 'loss';

  const finishedAt = room.lastMoveTimestamp ?? Date.now();
  const durationSec = Math.max(15, Math.floor((finishedAt - room.createdTimestamp) / 1000));
  const movesCount = (room.pgn.match(/\d+\./g) || []).length;
  const totalMoves = Math.max(1, movesCount);
  const avgMoveTimeSec = Math.max(1.5, Math.round((durationSec / (totalMoves * 2)) * 10) / 10);

  return {
    // One record per player per game. The primary key on (player, id) makes re-recording a no-op.
    id: `${room.code}:${room.createdTimestamp}`,
    date: finishedAt,
    opponentName: opponent?.name || 'Opponent',
    opponentAvatar: opponent?.avatarUrl,
    isBot: Boolean(opponent?.isBot),
    botDifficulty: room.gameRules.botDifficulty,
    result,
    resolution: room.resolution || 'finished',
    playerColor,
    totalMoves,
    avgMoveTimeSec,
    durationSec,
  };
}

export function calculateStats(matches: MatchRecord[]): PlayerStatsData {
  const totalGames = matches.length;
  const wins = matches.filter((m) => m.result === 'win').length;
  const losses = matches.filter((m) => m.result === 'loss').length;
  const draws = matches.filter((m) => m.result === 'draw').length;

  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 1000) / 10 : 0;

  let totalMoveTimeSum = 0;
  let moveCount = 0;
  let fastestMove = Infinity;
  matches.forEach((m) => {
    if (m.avgMoveTimeSec > 0) {
      totalMoveTimeSum += m.avgMoveTimeSec;
      moveCount++;
      if (m.avgMoveTimeSec < fastestMove) fastestMove = m.avgMoveTimeSec;
    }
  });

  // With no games yet there is nothing to average, so report zeros rather than invented numbers.
  return {
    totalGames,
    wins,
    losses,
    draws,
    winRate,
    overallAvgMoveTimeSec: moveCount > 0 ? Math.round((totalMoveTimeSum / moveCount) * 10) / 10 : 0,
    fastestMoveSec: moveCount > 0 ? Math.round(fastestMove * 10) / 10 : 0,
    recentMatches: matches,
  };
}

export const EMPTY_STATS: PlayerStatsData = calculateStats([]);
