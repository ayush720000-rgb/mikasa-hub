import crypto from 'crypto';
import { safeError } from './redact';

export interface VerifiedTelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export type TelegramAuthResult =
  | { ok: true; user: VerifiedTelegramUser }
  | { ok: false; status: number; error: string };

const MAX_AGE_SECONDS = 86400;
const MAX_CLOCK_SKEW_SECONDS = 60;

/**
 * Verify Telegram Mini App initData against the bot token.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): TelegramAuthResult {
  if (!botToken || !initData) {
    return { ok: false, status: 400, error: 'Telegram authentication data or bot token is missing.' };
  }

  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');
    if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
      return { ok: false, status: 401, error: 'Invalid Telegram authentication hash.' };
    }

    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();
    const suppliedHash = Buffer.from(receivedHash, 'hex');
    if (suppliedHash.length !== calculatedHash.length || !crypto.timingSafeEqual(suppliedHash, calculatedHash)) {
      return { ok: false, status: 401, error: 'Telegram authentication could not be verified.' };
    }

    const authDate = Number(params.get('auth_date'));
    if (
      !Number.isFinite(authDate) ||
      authDate > nowSeconds + MAX_CLOCK_SKEW_SECONDS ||
      nowSeconds - authDate > MAX_AGE_SECONDS
    ) {
      return { ok: false, status: 401, error: 'Telegram authentication data has expired. Reopen the Mini App.' };
    }

    const userRaw = params.get('user');
    if (!userRaw) return { ok: false, status: 401, error: 'Telegram user data is missing.' };
    const user = JSON.parse(userRaw);
    if (!Number.isSafeInteger(user.id) || !user.first_name) {
      return { ok: false, status: 401, error: 'Telegram user data is invalid.' };
    }
    return {
      ok: true,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name || undefined,
        username: user.username || undefined,
        language_code: user.language_code || undefined,
        photo_url: user.photo_url || undefined,
      },
    };
  } catch (error) {
    console.error('[TelegramAuth] Verification failed:', safeError(error));
    return { ok: false, status: 400, error: 'Could not read Telegram authentication data.' };
  }
}
