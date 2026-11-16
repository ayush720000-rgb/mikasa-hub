import { safeError } from './redact';
import path from 'path';
import { Context, Telegraf } from 'telegraf';
import type { InlineKeyboardButton, InlineQueryResult, InputTextMessageContent } from 'telegraf/types';

// Telegram button colours: 'primary' (blue), 'success' (green), 'danger' (red).
type StyledButton = InlineKeyboardButton & { style?: 'primary' | 'success' | 'danger' };

const WELCOME_PHOTO = path.join('public', 'assets', 'mikasa-mascot.jpg');
const MAIN_BOT_USERNAME = (process.env.MAIN_BOT_USERNAME || 'Ig_MikasaBot').replace(/^@/, '');

function isValidBotToken(token?: string): boolean {
  if (!token) return false;
  const clean = token.trim();
  if (clean === '' || /MY_TELEGRAM|YOUR_BOT_TOKEN|placeholder/i.test(clean)) return false;
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(clean);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Telegram errors can contain the request URL, which holds the bot token: always redact.
function errorMessage(err: unknown): string {
  return safeError(err);
}

/**
 * Ludo's Telegram bot: the /start welcome message with the Mini App button and a link to the
 * main bot. Telegram login and avatar lookups use the same token, but they work without polling.
 */
export class LudoTelegramBot {
  private bot: Telegraf | null = null;
  private welcomePhotoId: string | null = null;
  private botUsername = (process.env.BOT_USERNAME || 'Ig_MikasaBot').replace(/^@/, '');
  private token = '';
  private stopped = false;

  constructor(private readonly appUrl: string) {}

  public start(): void {
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!isValidBotToken(token)) {
      console.log('[LudoBot] No valid TELEGRAM_BOT_TOKEN provided. Bot disabled, web app still runs.');
      return;
    }
    this.token = token;
    this.connect(1);
  }

  /** Connects to Telegram and keeps retrying with backoff if it cannot. */
  private connect(attempt: number): void {
    if (this.stopped) return;
    const instance = new Telegraf(this.token);
    instance.catch((err: unknown) => console.log('[LudoBot] Background update notice:', errorMessage(err)));

    instance.telegram
      .getMe()
      .then((me) => {
        this.bot = instance;
        if (me.username) this.botUsername = me.username;
        this.setupHandlers(instance);
        console.log(`Ludo bot @${this.botUsername} connected successfully.`);
        return instance.telegram
          .setMyCommands([{ command: 'start', description: '🎲 ꜱᴛᴀʀᴛ ʟᴜᴅᴏɴᴏᴡ' }])
          .then(() => instance.launch({ dropPendingUpdates: true }));
      })
      .then(() => console.log('Ludo bot polling launched successfully.'))
      .catch((err: unknown) => {
        this.bot = null;
        const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** (attempt - 1));
        console.log(`[LudoBot] Telegram unreachable (${errorMessage(err)}). Retrying in ${delayMs / 1000}s.`);
        setTimeout(() => this.connect(attempt + 1), delayMs);
      });
  }

  private setupHandlers(bot: Telegraf) {
    bot.on('inline_query', (ctx) => {
      // Mini App direct link on the main bot. Telegram rejects web_app buttons inside inline results.
      const shortName = (process.env.LUDO_MINIAPP_NAME || 'ludo').trim();
      const enterUrl = `https://t.me/${MAIN_BOT_USERNAME}/${shortName}`;
      const origin = siteOrigin(this.appUrl);
      const message = smallCaps("heya, let's play ludo");
      return answerInvite(ctx, {
        id: 'ludo_play',
        title: 'LudoNow',
        description: 'Race your tokens home with your friends',
        thumb: origin ? `${origin}/ludo/assets/mikasa-mascot-thumb.jpg` : undefined,
        message,
        keyboard: [
          [{ text: 'Play Ludo 🎲', url: enterUrl, style: 'danger' }],
          [{ text: '🌺 Main Bot', url: `https://t.me/${MAIN_BOT_USERNAME}`, style: 'primary' }],
        ],
      });
    });

    bot.command('start', async (ctx) => {
      const firstName = ctx.from?.first_name || 'Player';
      const caption =
        `👋 Welcome, <b>${escapeHtml(firstName)}</b>!\n\n` +
        `🎲 Ready to roll?\n` +
        `<blockquote>Create a lobby, invite your friends, and race your tokens home!</blockquote>`;

      const playButton: StyledButton = { text: '🎲 Play LudoNow', web_app: { url: siteOrigin(this.appUrl) ? `${siteOrigin(this.appUrl)}/ludo/` : this.appUrl }, style: 'danger' };
      const mainButton: StyledButton = {
        text: '🌸 Main Bot',
        url: `https://t.me/${MAIN_BOT_USERNAME}`,
        style: 'success',
      };
      const reply_markup = { inline_keyboard: [[playButton], [mainButton]] };

      try {
        const sent = await ctx.replyWithPhoto(this.welcomePhotoId ?? { source: WELCOME_PHOTO }, {
          caption,
          parse_mode: 'HTML',
          reply_markup,
        });
        if (!this.welcomePhotoId && 'photo' in sent && sent.photo?.length) {
          this.welcomePhotoId = sent.photo[sent.photo.length - 1].file_id;
        }
      } catch (err) {
        console.log('[LudoBot] Welcome photo failed, sending text instead:', errorMessage(err));
        await ctx.reply(caption, { parse_mode: 'HTML', reply_markup });
      }
    });
  }

  public stop(): void {
    this.stopped = true;
    try {
      this.bot?.stop();
    } catch {
      // already stopped
    }
    this.bot = null;
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
  keyboard: StyledButton[][];
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
