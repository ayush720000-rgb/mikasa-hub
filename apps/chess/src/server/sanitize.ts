/**
 * Clean data that arrives from clients before it is stored or sent to other players.
 * Every field is clamped to a sane size and type, so one malformed or oversized message
 * cannot crash the server or fill its memory.
 */
import type { BotDifficulty, GameRules, UserProfile } from '../types/chess';

export const MAX_NAME = 64;
export const MAX_CHAT_TEXT = 1000;
export const MAX_REPLY_TEXT = 200;
export const MAX_EMOJI = 16;
// Avatars are small JPEG/SVG data URLs (Telegram photos run to about 80 000 characters).
export const MAX_AVATAR = 300_000;

const BOT_DIFFICULTIES: readonly BotDifficulty[] = [
  'beginner', 'casual', 'intermediate', 'advanced', 'master', 'grandmaster',
];

export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** An image address the browser can show: a data URL, an https URL or an app-relative path. */
export function cleanAvatar(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_AVATAR) return undefined;
  return /^(data:image\/|https:\/\/|\/(?!\/))/i.test(value) ? value : undefined;
}

/** A player profile from a client. The id always comes from the verified connection. */
export function cleanUserProfile(raw: unknown, id: string | number): UserProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const username = cleanText(r.username, MAX_NAME);
  const avatarUrl = cleanAvatar(r.avatarUrl);
  return {
    id,
    name: cleanText(r.name, MAX_NAME) || 'Player',
    ...(username ? { username } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    isBot: false, // only the server creates bot players
  };
}

function clampSeconds(value: unknown, max: number): number {
  const n = typeof value === 'number' ? value : Number.NaN;
  // 0 means "no value": the room falls back to its default (untimed games send 0).
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : 0;
}

export function cleanGameRules(raw: unknown): GameRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const preferred = r.preferredColor === 'w' || r.preferredColor === 'b' ? r.preferredColor : 'random';
  const difficulty = BOT_DIFFICULTIES.find((d) => d === r.botDifficulty);
  return {
    timerEnabled: r.timerEnabled === true,
    initialTimeSec: clampSeconds(r.initialTimeSec, 10_800),
    incrementSec: clampSeconds(r.incrementSec, 180),
    preferredColor: preferred,
    isBotGame: r.isBotGame === true,
    ...(difficulty ? { botDifficulty: difficulty } : {}),
  };
}

export interface CleanChat {
  senderName: string;
  senderAvatar?: string;
  isSpectator: boolean;
  text: string;
  replyTo: { id: string; senderName: string; text: string } | null;
}

/** A chat message from a client, or null when there is nothing to send. */
export function cleanChatMessage(raw: unknown): CleanChat | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = cleanText(r.text, MAX_CHAT_TEXT);
  if (!text) return null;
  let replyTo: CleanChat['replyTo'] = null;
  if (r.replyTo && typeof r.replyTo === 'object') {
    const ref = r.replyTo as Record<string, unknown>;
    const id = cleanText(ref.id, 64);
    if (id) replyTo = { id, senderName: cleanText(ref.senderName, MAX_NAME), text: cleanText(ref.text, MAX_REPLY_TEXT) };
  }
  return {
    senderName: cleanText(r.senderName, MAX_NAME) || 'Player',
    senderAvatar: cleanAvatar(r.senderAvatar),
    isSpectator: r.isSpectator === true,
    text,
    replyTo,
  };
}
