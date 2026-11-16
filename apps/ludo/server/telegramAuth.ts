import crypto from 'crypto';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface AuthResult {
  valid: boolean;
  user?: TelegramUser;
  reason?: string;
}

const MAX_INITDATA_AGE_SECONDS = 24 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;
const IDENTITY_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Validates Telegram WebApp initData using HMAC-SHA256 against the bot token.
 * Fails closed: without a bot token nothing can be verified, so nothing is trusted.
 * Rejects initData whose auth_date is older than 24 hours (prevents indefinite replay).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(
  initData: string,
  botToken?: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): AuthResult {
  if (!initData) return { valid: false, reason: 'initData is empty' };
  if (!botToken || botToken.trim() === '' || botToken === 'your_telegram_bot_token_here') {
    return { valid: false, reason: 'TELEGRAM_BOT_TOKEN is not configured' };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return { valid: false, reason: 'Missing or malformed hash' };

    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();
    const supplied = Buffer.from(hash, 'hex');
    if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)) {
      return { valid: false, reason: 'HMAC signature mismatch' };
    }

    const authDate = Number(params.get('auth_date'));
    if (
      !Number.isFinite(authDate) ||
      authDate > nowSeconds + MAX_CLOCK_SKEW_SECONDS ||
      nowSeconds - authDate > MAX_INITDATA_AGE_SECONDS
    ) {
      return { valid: false, reason: 'initData expired' };
    }

    const userRaw = params.get('user');
    if (!userRaw) return { valid: false, reason: 'No user object found in initData' };
    const user: TelegramUser = JSON.parse(userRaw);
    if (!Number.isSafeInteger(user.id) || !user.first_name) return { valid: false, reason: 'Invalid user object' };
    return { valid: true, user };
  } catch (err: any) {
    return { valid: false, reason: err?.message || 'Failed to parse initData' };
  }
}

/** Signed session issued after a valid Telegram initData check (survives WebView reloads). */
export function createTelegramSessionToken(userId: number, botToken: string, ttlSeconds = 7 * 24 * 60 * 60): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const signature = crypto.createHmac('sha256', botToken).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function validateTelegramSessionToken(token: string, botToken: string): { valid: boolean; userId?: number } {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return { valid: false };
    const expected = crypto.createHmac('sha256', botToken).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return { valid: false };
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(data.userId) || !Number.isSafeInteger(data.exp) || data.exp <= Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }
    return { valid: true, userId: data.userId };
  } catch {
    return { valid: false };
  }
}

// ---- Server-issued identity for guests -------------------------------------------------
// Guest IDs are minted on the server and bound to a signed token, so a client cannot
// claim someone else's guest ID by sending it in a message. The key is IDENTITY_SECRET,
// falling back to the bot token, then to a per-process random key (guest identities then
// reset on redeploy, which is acceptable for guests).
let fallbackSecret: string | null = null;
function identitySecret(): string {
  const configured = process.env.IDENTITY_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (configured) return configured;
  if (!fallbackSecret) {
    fallbackSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] No IDENTITY_SECRET or TELEGRAM_BOT_TOKEN set; guest identities will reset on restart.');
  }
  return fallbackSecret;
}

export function issueIdentityToken(subject: string, ttlSeconds = IDENTITY_TTL_SECONDS): string {
  const payload = Buffer.from(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const signature = crypto.createHmac('sha256', identitySecret()).update(`id:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyIdentityToken(token: unknown): string | null {
  if (typeof token !== 'string' || !token) return null;
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = crypto.createHmac('sha256', identitySecret()).update(`id:${payload}`).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.sub !== 'string' || !Number.isSafeInteger(data.exp) || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return data.sub;
  } catch {
    return null;
  }
}

/**
 * Resolve a token sent by a client over WebSocket into a trusted player ID.
 * Accepts a Telegram session token (-> "tg_<id>") or a guest identity token (-> "guest_...").
 * Returns null for anything it cannot prove.
 */
export function resolvePlayerIdentity(token: unknown, botToken?: string): string | null {
  if (typeof token !== 'string' || !token) return null;
  if (botToken) {
    const session = validateTelegramSessionToken(token, botToken);
    if (session.valid && session.userId) return `tg_${session.userId}`;
  }
  const subject = verifyIdentityToken(token);
  if (subject && subject.startsWith('guest_')) return subject;
  return null;
}
