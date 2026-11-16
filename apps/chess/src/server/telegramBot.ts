import path from 'path';
import { Context, Telegraf } from 'telegraf';
import type { InlineKeyboardButton, InlineQueryResult, InputTextMessageContent } from 'telegraf/types';
import axios from 'axios';
import { safeError } from './redact';

export interface TelegramBotInfo {
  isActive: boolean;
  username?: string;
  appUrl: string;
}

// Telegram button colours: 'primary' (blue), 'success' (green), 'danger' (red).
type InlineButton = InlineKeyboardButton & { style?: 'primary' | 'success' | 'danger' };

const WELCOME_PHOTO = path.join('public', 'assets', 'mikasa.jpg');
const MAIN_BOT_USERNAME = (process.env.MAIN_BOT_USERNAME || 'Ig_MikasaBot').replace(/^@/, '');

export function isValidBotToken(token?: string): boolean {
  if (!token) return false;
  const clean = token.trim();
  if (clean === '' || /MY_TELEGRAM|YOUR_BOT_TOKEN|placeholder/i.test(clean)) return false;
  // Standard Telegram bot token format: <bot_id>:<secret>
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(clean);
}

// Telegram HTML parse mode only needs these three characters escaped.
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Telegram errors can contain the request URL, which holds the bot token: always redact.
function errorMessage(err: unknown): string {
  return safeError(err);
}

export class TelegramBotService {
  private bot: Telegraf | null = null;
  private appUrl: string;
  // Replaced with the real handle from getMe() once the token is verified.
  private botUsername: string = (process.env.BOT_USERNAME || 'Ig_MikasaBot').replace(/^@/, '');
  // Telegram caches an uploaded photo on its side. Reusing the file_id avoids re-uploading 885 KB per /start.
  private welcomePhotoId: string | null = null;
  private token = '';
  private stopped = false;

  constructor(appUrl: string) {
    this.appUrl = appUrl || 'https://t.me';
    const rawToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

    if (!isValidBotToken(rawToken)) {
      console.log('[TelegramBot] No valid TELEGRAM_BOT_TOKEN provided. Operating in Web & Telegram WebApp mode.');
      return;
    }

    this.token = rawToken!.trim();
    this.connect(1);
  }

  /**
   * Connects to Telegram and keeps retrying with backoff if it cannot. A single failed start
   * used to leave the bot offline until the next deploy.
   */
  private connect(attempt: number): void {
    if (this.stopped) return;
    const instance = new Telegraf(this.token);
    // Background polling errors are logged rather than thrown as unhandled rejections.
    instance.catch((err: unknown) => {
      console.log('[TelegramBot] Background update notice:', errorMessage(err));
    });

    instance.telegram
      .getMe()
      .then((me) => {
        this.bot = instance;
        if (me.username) this.botUsername = me.username;
        console.log(`Telegram Bot @${this.botUsername} connected successfully.`);
        this.setupHandlers(instance);
        return instance.telegram
          .setMyCommands([{ command: 'start', description: '♟️ ꜱᴛᴀʀᴛ ᴄʜᴇꜱꜱɴᴏᴡ' }])
          .then(() => instance.launch({ dropPendingUpdates: true }));
      })
      .then(() => console.log('Telegram Bot polling launched successfully.'))
      .catch((err: unknown) => {
        this.bot = null;
        const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** (attempt - 1));
        console.log(`[TelegramBot] Telegram unreachable (${errorMessage(err)}). Retrying in ${delayMs / 1000}s.`);
        setTimeout(() => this.connect(attempt + 1), delayMs);
      });
  }

  private setupHandlers(bot: Telegraf) {
    bot.command('start', async (ctx) => {
      const firstName = ctx.from?.first_name || 'Chess Player';
      // /start lobby_<code> comes from an inline "Enter The Game" button for a shared lobby.
      const payload = ctx.payload || '';
      const lobby = payload.startsWith('lobby_') ? payload.slice('lobby_'.length).replace(/[^A-Za-z0-9_-]/g, '') : '';
      const playUrl = lobby ? `${this.appUrl}?lobby=${encodeURIComponent(lobby)}` : this.appUrl;

      const caption =
        `👋 Welcome, <b>${escapeHtml(firstName)}</b>!\n\n` +
        `♟️ Ready to play chess?\n` +
        `<blockquote>Create lobbies, challenge friends, or play against our intelligent chess bot!</blockquote>`;

      const keyboard: InlineButton[][] = [
        [{ text: '♟️ Play ChessNow', web_app: { url: playUrl }, style: 'primary' }],
        [{ text: '🌸 Main Bot', url: `https://t.me/${MAIN_BOT_USERNAME}`, style: 'success' }],
      ];

      try {
        const sent = await ctx.replyWithPhoto(this.welcomePhotoId ?? { source: WELCOME_PHOTO }, {
          caption,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        });
        if (!this.welcomePhotoId && 'photo' in sent && sent.photo?.length) {
          this.welcomePhotoId = sent.photo[sent.photo.length - 1].file_id;
        }
      } catch (err) {
        // A missing or rejected image should not stop the welcome message.
        console.log('[TelegramBot] Welcome photo failed, sending text instead:', errorMessage(err));
        await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }
    });

    bot.on('inline_query', (ctx) => {
      const query = ctx.inlineQuery.query.trim();
      const lobby = query.replace(/[^A-Za-z0-9_-]/g, '');
      // Mini App direct link on the main bot. Telegram rejects web_app buttons inside inline results.
      const shortName = (process.env.CHESS_MINIAPP_NAME || 'Chess').trim();
      const enterUrl = `https://t.me/${MAIN_BOT_USERNAME}/${shortName}${lobby ? `?startapp=${lobby}` : ''}`;
      const origin = siteOrigin(this.appUrl);
      // The posted message is one short line. Telegram needs visible text, and emoji alone look like noise.
      const message = lobby
        ? smallCaps(`heya, join room ${lobby.toLowerCase()}`)
        : smallCaps("heya, let's play chess");
      return answerInvite(ctx, {
        id: (lobby ? `chess_lobby_${lobby}` : 'chess_play').slice(0, 64),
        title: query ? `ChessNow Lobby: ${query}` : 'ChessNow',
        description: query ? `Join room ${query}` : 'Play chess with your friends',
        thumb: origin ? `${origin}/chess/assets/mikasa-thumb.jpg` : undefined,
        message,
        keyboard: [
          [{ text: 'Play Chess ♟️', url: enterUrl, style: 'danger' }],
          [{ text: '🌺 Main Bot', url: `https://t.me/${MAIN_BOT_USERNAME}`, style: 'primary' }],
        ],
      });
    });
  }

  // Avatars are cached for a few minutes: the avatar endpoint is public, and every miss costs
  // two Telegram calls and a download.
  private avatarCache = new Map<number, { value: string | undefined; expires: number }>();

  public async fetchUserAvatarBase64(userId: number): Promise<string | undefined> {
    if (!this.bot) return undefined;
    const cached = this.avatarCache.get(userId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const value = await this.loadAvatar(userId);
    if (this.avatarCache.size >= 300) {
      const oldest = this.avatarCache.keys().next().value;
      if (oldest !== undefined) this.avatarCache.delete(oldest);
    }
    this.avatarCache.set(userId, { value, expires: Date.now() + (value ? 10 * 60_000 : 2 * 60_000) });
    return value;
  }

  private async loadAvatar(userId: number): Promise<string | undefined> {
    if (!this.bot) return undefined;
    try {
      const photos = await this.bot.telegram.getUserProfilePhotos(userId, 0, 1);
      if (photos.total_count === 0 || !photos.photos[0] || photos.photos[0].length === 0) {
        return undefined;
      }
      // Medium resolution photo
      const photoSizes = photos.photos[0];
      const selected = photoSizes[Math.min(1, photoSizes.length - 1)];
      const fileLink = await this.bot.telegram.getFileLink(selected.file_id);
      const resp = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 10_000 });
      return `data:image/jpeg;base64,${Buffer.from(resp.data).toString('base64')}`;
    } catch {
      return undefined;
    }
  }

  public stop(): void {
    this.stopped = true;
    if (this.bot) {
      try {
        this.bot.stop();
      } catch {
        // already stopped
      }
      this.bot = null;
    }
  }

  public getInfo(): TelegramBotInfo {
    return { isActive: Boolean(this.bot), username: this.botUsername, appUrl: this.appUrl };
  }
}

// Text styles for the posted message. Telegram accepts these characters in any message.
const SMALL = { a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',y:'ʏ',z:'ᴢ' } as Record<string, string>;
/** Lower-case letters become small capitals; everything else is left as it is. */
export function smallCaps(text: string): string {
  return text.toLowerCase().replace(/[a-z]/g, (ch) => SMALL[ch] ?? ch);
}
/** Bold sans-serif letters for headlines. */
export function boldSans(text: string): string {
  return text.replace(/[A-Za-z]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String.fromCodePoint(code <= 90 ? 0x1d5d4 + code - 65 : 0x1d5ee + code - 97);
  });
}

/**
 * The https origin of this deployment, e.g. https://mikasa-bots.onrender.com. Returns undefined
 * for anything else (unset, http, or Telegram's own host), so no broken picture link is sent.
 */
export function siteOrigin(base: string): string | undefined {
  try {
    const u = new URL(base);
    if (u.protocol !== 'https:' || u.hostname === 't.me') return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

export interface InviteOptions {
  id: string;
  title: string;
  /** Grey line under the headline in the inline list. Never sent into the chat. */
  description?: string;
  /** Picture https address. Omitted when the site origin is unknown. */
  thumb?: string;
  keyboard: InlineButton[][];
  /** Text sent into the chat, with the picture as its caption. Plain text, no link. */
  message: string;
}

export type InviteOutcome = 'sent' | 'sent-without-picture' | 'failed';

/**
 * Answer an inline query with one card: the picture and a short caption, with the app's button
 * under it. Telegram rejects the whole answer if any part is bad, so there are two attempts:
 * with the picture, then as plain text. The first one Telegram accepts is used. Failures are
 * logged with secrets removed and never thrown.
 */
export async function answerInvite(ctx: Context, o: InviteOptions): Promise<InviteOutcome> {
  const common = {
    id: o.id,
    title: o.title,
    ...(o.description ? { description: o.description } : {}),
    reply_markup: { inline_keyboard: o.keyboard },
  };
  const build = (thumb?: string): InlineQueryResult =>
    thumb
      ? ({ type: 'photo', ...common, photo_url: thumb, thumbnail_url: thumb, caption: o.message } as InlineQueryResult)
      : ({
          type: 'article',
          ...common,
          input_message_content: {
            message_text: o.message,
            link_preview_options: { is_disabled: true },
          } as InputTextMessageContent,
        } as InlineQueryResult);
  const attempts: { label: InviteOutcome; thumb?: string }[] = o.thumb
    ? [{ label: 'sent', thumb: o.thumb }, { label: 'sent-without-picture' }]
    : [{ label: 'sent-without-picture' }];
  for (const a of attempts) {
    try {
      // cache_time 0: Telegram otherwise keeps an answer for 5 minutes, so a fix would not show.
      await ctx.answerInlineQuery([build(a.thumb)], { cache_time: 0 });
      return a.label;
    } catch (err) {
      console.warn(`[inline] attempt "${a.label}" rejected by Telegram:`, errorMessage(err));
    }
  }
  console.error('[inline] could not answer the inline query after every attempt');
  return 'failed';
}
