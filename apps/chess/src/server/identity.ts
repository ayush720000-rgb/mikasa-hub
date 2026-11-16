import crypto from 'crypto';

// Server-issued identity for every Chess connection. A socket must present a token that
// this server signed. The player ID inside the token is the only ID the server will use
// for that socket. IDs sent in message payloads are ignored.
//   Telegram user -> subject "tg:<telegram id>"  -> player id <number>
//   Browser guest -> subject "guest_<random hex>" -> player id <string>

const TTL_SECONDS = 30 * 24 * 60 * 60;
let fallbackSecret: string | null = null;

function secret(): string {
  const configured = process.env.IDENTITY_SECRET || process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
  if (configured && configured.trim()) return configured.trim();
  if (!fallbackSecret) {
    fallbackSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[identity] No IDENTITY_SECRET or bot token set; identities reset on restart.');
  }
  return fallbackSecret;
}

export function issueIdentityToken(subject: string, ttlSeconds: number = TTL_SECONDS): string {
  const payload = Buffer.from(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret()).update(`chess:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyIdentityToken(token: unknown): string | null {
  if (typeof token !== 'string' || !token) return null;
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = crypto.createHmac('sha256', secret()).update(`chess:${payload}`).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.sub !== 'string' || !Number.isSafeInteger(data.exp) || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return data.sub;
  } catch {
    return null;
  }
}

/** Map a verified subject to the player ID the rest of the server uses. */
export function playerIdForSubject(subject: string): string | number | null {
  if (/^tg:\d+$/.test(subject)) return Number(subject.slice(3));
  if (/^guest_[a-f0-9]{8,64}$/.test(subject)) return subject;
  return null;
}

export function resolveSocketIdentity(token: unknown): { id: string | number } | null {
  const subject = verifyIdentityToken(token);
  if (!subject) return null;
  const id = playerIdForSubject(subject);
  return id === null ? null : { id };
}
