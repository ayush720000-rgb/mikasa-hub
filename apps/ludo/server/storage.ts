import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { ChatMessage, MatchStats, PlayerColor, PlayerProfile } from '../src/types/ludo';
import { pgPoolConfig } from './pgConfig';

export interface SavedMatch {
  id: string;
  code: string;
  players: {
    id: string;
    name: string;
    username?: string;
    avatarUrl?: string;
    color: PlayerColor;
    isBot: boolean;
  }[];
  winnerColor: PlayerColor;
  winnerId: string;
  stats: MatchStats;
  endedAt: number;
}

interface DBData {
  users: Record<string, PlayerProfile>;
  matches: SavedMatch[];
  chatHistory: Record<string, ChatMessage[]>;
}

const STATE_KEY = 'ludo';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.resolve(DATA_DIR, 'ludo-db.json');
const SAVE_DELAY_MS = 250;

const emptyData = (): DBData => ({ users: {}, matches: [], chatHistory: {} });

/**
 * Ludo state store.
 *
 * With DATABASE_URL set (Neon Postgres), state lives in the `app_state` table and survives
 * redeploys. Without it, state goes to data/ludo-db.json. Reads come from memory; writes are
 * batched and sent in the background, so game code stays synchronous.
 */
class StorageManager {
  private data: DBData = emptyData();
  private pool: pg.Pool | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private pending: Promise<void> = Promise.resolve();

  /** Load state. Call once before the server starts accepting requests. */
  public async init(): Promise<void> {
    const url = (process.env.DATABASE_URL || '').trim();
    if (url) {
      try {
        this.pool = new pg.Pool({ ...pgPoolConfig(url), max: 3, idleTimeoutMillis: 30_000 });
        this.pool.on('error', (err) => console.error('[storage] idle Postgres client error:', err.message));
        await this.pool.query(
          `CREATE TABLE IF NOT EXISTS app_state (
             key text PRIMARY KEY,
             data jsonb NOT NULL,
             updated_at timestamptz NOT NULL DEFAULT now()
           )`
        );
        const row = await this.pool.query('SELECT data FROM app_state WHERE key = $1', [STATE_KEY]);
        if (row.rows[0]) this.data = { ...emptyData(), ...row.rows[0].data };
        console.log('[storage] Using Postgres (DATABASE_URL).');
        return;
      } catch (err) {
        // Keep the game running: fall back to the local file and say so in the logs.
        console.error('[storage] Postgres unavailable, falling back to file storage:', (err as Error).message);
        await this.pool?.end().catch(() => undefined);
        this.pool = null;
      }
    }
    this.loadFile();
  }

  private loadFile() {
    try {
      if (fs.existsSync(DB_FILE)) {
        this.data = { ...emptyData(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) };
      }
    } catch (e) {
      console.warn('[storage] Could not read data file, starting empty:', (e as Error).message);
    }
  }

  /** Queue a write. Repeated changes within SAVE_DELAY_MS are sent as one write. */
  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.pending = this.pending.then(() => this.persist()).catch(() => undefined);
    }, SAVE_DELAY_MS);
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    if (this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO app_state (key, data, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [STATE_KEY, snapshot]
        );
      } catch (err) {
        console.error('[storage] Failed to save to Postgres:', (err as Error).message);
      }
      return;
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, snapshot, 'utf-8');
    } catch (e) {
      console.error('[storage] Failed to write data file:', (e as Error).message);
    }
  }

  /** Write any pending change now. Call on shutdown. */
  public async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.pending = this.pending.then(() => this.persist()).catch(() => undefined);
    }
    await this.pending;
    await this.pool?.end().catch(() => undefined);
  }

  public getOrCreateUser(profile: {
    id: string;
    name: string;
    username?: string;
    avatarUrl?: string;
    isTelegram: boolean;
  }): PlayerProfile {
    if (this.data.users[profile.id]) {
      const user = this.data.users[profile.id];
      user.name = profile.name || user.name;
      if (profile.username) user.username = profile.username;
      if (profile.avatarUrl) user.avatarUrl = profile.avatarUrl;
      this.save();
      return user;
    }

    const newUser: PlayerProfile = {
      id: profile.id,
      name: profile.name,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      isTelegram: profile.isTelegram,
      gamesPlayed: 0,
      wins: 0,
      captures: 0,
    };
    this.data.users[profile.id] = newUser;
    this.save();
    return newUser;
  }

  public getUser(id: string): PlayerProfile | null {
    return this.data.users[id] || null;
  }

  public recordMatchEnd(match: SavedMatch) {
    this.data.matches.unshift(match);
    if (this.data.matches.length > 50) {
      this.data.matches.pop();
    }

    // Update stats for human players
    match.players.forEach((p) => {
      if (p.isBot) return;
      const user = this.data.users[p.id];
      if (user) {
        user.gamesPlayed = (user.gamesPlayed || 0) + 1;
        if (p.id === match.winnerId) {
          user.wins = (user.wins || 0) + 1;
        }
      }
    });

    this.save();
  }

  public addCapture(userId: string) {
    const user = this.data.users[userId];
    if (user) {
      user.captures = (user.captures || 0) + 1;
      this.save();
    }
  }

  public getMatches(): SavedMatch[] {
    return this.data.matches.slice(0, 20);
  }

  public saveChat(roomCode: string, messages: ChatMessage[]) {
    this.data.chatHistory[roomCode] = messages.slice(-100);
    this.save();
  }

  public getChat(roomCode: string): ChatMessage[] {
    return this.data.chatHistory[roomCode] || [];
  }
}

export const storage = new StorageManager();
