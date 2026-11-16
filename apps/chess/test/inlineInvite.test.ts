import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerInvite, siteOrigin } from '../src/server/telegramBot';

const THUMB = 'https://app.example.com/chess/assets/thumb.jpg';
const ENTER = 'https://t.me/Ig_MikasaBot/App';
const base = {
  id: 'x_play',
  title: 'Title',
  description: 'A line under the headline',
  thumb: THUMB,
  keyboard: [
    [{ text: 'Play Chess ♟️', url: ENTER, style: 'danger' as const }],
    [{ text: '🌺 Main Bot', url: 'https://t.me/Ig_MikasaBot', style: 'primary' as const }],
  ],
  message: 'heya, let\'s play chess',
};

function fakeCtx(failures: number) {
  const calls: { results: any[]; extra: any }[] = [];
  const ctx = {
    answerInlineQuery: async (results: any[], extra: any) => {
      calls.push({ results, extra });
      if (calls.length <= failures) throw new Error('400: Bad Request: rejected');
      return true;
    },
  };
  return { ctx: ctx as any, calls };
}

test('siteOrigin: only real https origins are used', () => {
  assert.equal(siteOrigin('https://mikasa-bots.onrender.com/'), 'https://mikasa-bots.onrender.com');
  assert.equal(siteOrigin('https://t.me'), undefined);
  assert.equal(siteOrigin('http://localhost:3000'), undefined);
  assert.equal(siteOrigin(''), undefined);
});

test('inline: the card is a photo with the short caption, and no link in the chat message', async () => {
  const { ctx, calls } = fakeCtx(0);
  assert.equal(await answerInvite(ctx, base), 'sent');
  const r = calls[0].results[0];
  assert.equal(r.type, 'photo');
  assert.equal(r.photo_url, THUMB);
  assert.equal(r.thumbnail_url, THUMB);
  assert.equal(r.caption, base.message);
  assert.ok(!r.caption.includes('<a') && !r.caption.includes(ENTER), 'the caption carries no link');
  assert.equal(calls[0].extra.cache_time, 0);
});

test('inline: the red button still opens the app, and the main bot button stays', async () => {
  const { ctx, calls } = fakeCtx(0);
  await answerInvite(ctx, base);
  const rows = calls[0].results[0].reply_markup.inline_keyboard;
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0].url, ENTER);
  assert.equal(rows[0][0].style, 'danger');
  assert.equal(rows[1][0].text, '🌺 Main Bot');
});

test('inline: the description is for the list only and never enters the caption', async () => {
  const { ctx, calls } = fakeCtx(0);
  await answerInvite(ctx, base);
  assert.equal(calls[0].results[0].description, base.description);
  assert.ok(!calls[0].results[0].caption.includes(base.description));
});

test('inline: if the picture is rejected, the same text is sent as a plain message', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { ctx, calls } = fakeCtx(1);
  assert.equal(await answerInvite(ctx, base), 'sent-without-picture');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].results[0].type, 'article');
  assert.equal(calls[1].results[0].input_message_content.message_text, base.message);
});

test('inline: with no known site origin, the text is sent without a picture', async () => {
  const { ctx, calls } = fakeCtx(0);
  assert.equal(await answerInvite(ctx, { ...base, thumb: undefined }), 'sent-without-picture');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].results[0].type, 'article');
});

test('inline: if both attempts fail it reports failure and never throws', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const { ctx, calls } = fakeCtx(99);
  assert.equal(await answerInvite(ctx, base), 'failed');
  assert.equal(calls.length, 2);
});

test('inline: a token inside a Telegram error is never written to the log', async (t) => {
  const lines: string[] = [];
  t.mock.method(console, 'warn', (...a: unknown[]) => lines.push(a.join(' ')));
  t.mock.method(console, 'error', (...a: unknown[]) => lines.push(a.join(' ')));
  const ctx = { answerInlineQuery: async () => { throw new Error('request to https://api.telegram.org/bot1234567890:AAH-secret_value1234567890abcdefghij/answerInlineQuery failed'); } } as any;
  await answerInvite(ctx, base);
  assert.ok(lines.length >= 2 && lines.every((l) => !l.includes('AAH-secret')));
});
