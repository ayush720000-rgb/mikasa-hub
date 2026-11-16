// Match history for Chess players. Records are written by the server when a game finishes, so
// a client cannot add or edit a result. With DATABASE_URL set (Neon Postgres) history survives
// redeploys. Without it, history is kept in memory and is lost on restart.
import pg from 'pg';
import type { RoomState } from '../types/chess';
import {
  buildMatchRecord,
  calculateStats,
  MatchRecord,
  MAX_STORED_MATCHES,
  PlayerStatsData,
} from '../utils/playerStatsCore';
import { pgPoolConfig } from './pgConfig';

class StatsStore {
  private pool: pg.Pool | null = null;
  private memory = new Map<string, MatchRecord[]>();

  public async init(): Promise<void> {
    const url = (process.env.DATABASE_URL || '').trim();
    if (!url) {
      console.warn('[stats] DATABASE_URL is not set. Chess match history is kept in memory and is lost on restart.');
      return;
    }
    this.pool = new pg.Pool({ ...pgPoolConfig(url), max: 3, idleTimeoutMillis: 30_000 });
    this.pool.on('error', (err) => console.error('[stats] idle Postgres client error:', err.message));
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS chess_match_records (
        player_id text NOT NULL,
        id text NOT NULL,
        played_at bigint NOT NULL,
        record jsonb NOT NULL,
        PRIMARY KEY (player_id, id)
      )`);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS chess_match_records_recent
      ON chess_match_records (player_id, played_at DESC)`);
    console.log('[stats] Using Postgres for Chess match history.');
  }

  /** Record every human player's side of a finished game. Safe to call more than once. */
  public async recordFinishedGame(room: RoomState): Promise<void> {
    if (room.status !== 'finished') return;
    const humans = [room.whitePlayer, room.blackPlayer]
      .filter((p) => p && !p.user.isBot)
      .map((p) => String(p!.user.id));

    for (const playerId of humans) {
      const record = buildMatchRecord(room, playerId);
      if (!record) continue;

      if (this.pool) {
        await this.pool.query(
          `INSERT INTO chess_match_records (player_id, id, played_at, record)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (player_id, id) DO NOTHING`,
          [playerId, record.id, record.date, JSON.stringify(record)]
        );
        // Keep only the newest MAX_STORED_MATCHES per player.
        await this.pool.query(
          `DELETE FROM chess_match_records
           WHERE player_id = $1 AND id IN (
             SELECT id FROM chess_match_records WHERE player_id = $1
             ORDER BY played_at DESC OFFSET $2
           )`,
          [playerId, MAX_STORED_MATCHES]
        );
      } else {
        const list = this.memory.get(playerId) ?? [];
        if (!list.some((r) => r.id === record.id)) {
          this.memory.set(playerId, [record, ...list].slice(0, MAX_STORED_MATCHES));
        }
      }
    }
  }

  public async getStats(playerId: string): Promise<PlayerStatsData> {
    if (this.pool) {
      const { rows } = await this.pool.query<{ record: MatchRecord }>(
        `SELECT record FROM chess_match_records
         WHERE player_id = $1 ORDER BY played_at DESC LIMIT $2`,
        [playerId, MAX_STORED_MATCHES]
      );
      return calculateStats(rows.map((r) => r.record));
    }
    return calculateStats(this.memory.get(playerId) ?? []);
  }
}

export const statsStore = new StatsStore();
