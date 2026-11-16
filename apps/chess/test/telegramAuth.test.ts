import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { verifyTelegramInitData } from '../src/server/telegramAuth';

const TOKEN = '123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
const NOW = 1_800_000_000;

// Build initData exactly the way Telegram signs it.
function signInitData(fields: Record<string, string>, token = TOKEN): string {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const user = JSON.stringify({ id: 42, first_name: 'Ana', username: 'ana' });
const valid = () => ({ auth_date: String(NOW - 60), user });

test('accepts correctly signed, fresh initData', () => {
  const result = verifyTelegramInitData(signInitData(valid()), TOKEN, NOW);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.user, { id: 42, first_name: 'Ana', username: 'ana', last_name: undefined, language_code: undefined, photo_url: undefined });
});

test('rejects data signed with another token', () => {
  const result = verifyTelegramInitData(signInitData(valid(), 'other:TOKEN_xxxxxxxxxxxxxxxxxxxxxxxx'), TOKEN, NOW);
  assert.deepEqual(result, { ok: false, status: 401, error: 'Telegram authentication could not be verified.' });
});

test('rejects tampered user data', () => {
  const signed = signInitData(valid());
  const tampered = signed.replace('Ana', 'Mallory');
  const result = verifyTelegramInitData(tampered, TOKEN, NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test('rejects data older than 24 hours', () => {
  const old = signInitData({ auth_date: String(NOW - 86401), user });
  const result = verifyTelegramInitData(old, TOKEN, NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /expired/);
});

test('rejects data dated far in the future', () => {
  const future = signInitData({ auth_date: String(NOW + 3600), user });
  const result = verifyTelegramInitData(future, TOKEN, NOW);
  assert.equal(result.ok, false);
});

test('rejects a missing hash', () => {
  const result = verifyTelegramInitData(`auth_date=${NOW}&user=${encodeURIComponent(user)}`, TOKEN, NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test('returns 400 when initData or the token is missing', () => {
  assert.deepEqual(verifyTelegramInitData('', TOKEN, NOW), {
    ok: false, status: 400, error: 'Telegram authentication data or bot token is missing.',
  });
  assert.equal(verifyTelegramInitData(signInitData(valid()), '', NOW).ok, false);
});

test('rejects a user without id or first name', () => {
  const bad = signInitData({ auth_date: String(NOW), user: JSON.stringify({ first_name: 'NoId' }) });
  const result = verifyTelegramInitData(bad, TOKEN, NOW);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'Telegram user data is invalid.');
});
