/**
 * Keep secrets out of logs. Telegram puts the bot token in every API URL, and HTTP libraries
 * copy that URL into their error messages, so any logged error can carry the token.
 */

// bot123456:SECRET as it appears in API URLs: .../bot123456:SECRET/getMe and .../file/bot...
const TOKEN_IN_URL = /(\bbot)\d+:[A-Za-z0-9_-]+/gi;
// A bare bot token, e.g. 123456789:AAH...
const BARE_TOKEN = /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g;
const SECRET_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'BOT_TOKEN', 'IDENTITY_SECRET', 'DATABASE_URL'];

export function redactSecrets(text: string): string {
  let out = text.replace(TOKEN_IN_URL, '$1<redacted>').replace(BARE_TOKEN, '<redacted>');
  for (const key of SECRET_ENV_KEYS) {
    const value = (process.env[key] || '').trim();
    if (value.length >= 8) out = out.split(value).join('<redacted>');
  }
  return out;
}

/** An error as one log-safe string: its message, plus the message of its cause if any. */
export function safeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.message})` : '';
    return redactSecrets(`${err.message}${causeText}`);
  }
  return redactSecrets(String(err));
}
