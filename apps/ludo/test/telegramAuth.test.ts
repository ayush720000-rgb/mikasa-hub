import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  validateTelegramInitData,
  createTelegramSessionToken,
  validateTelegramSessionToken,
  issueIdentityToken,
  verifyIdentityToken,
  resolvePlayerIdentity,
} from '../server/telegramAuth';

const TOKEN = '123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';

function signInitData(fields: Record<string, string>, token = TOKEN): string {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

const fresh = () => Math.floor(Date.now() / 1000) - 30;
const user = (id = 7) => JSON.stringify({ id, first_name: 'Lia' });

test('accepts correctly signed initData and returns the user', () => {
  const result = validateTelegramInitData(signInitData({ auth_date: String(fresh()), user: user() }), TOKEN);
  assert.equal(result.valid, true);
  assert.equal(result.user?.id, 7);
});

test('rejects initData signed with a different token', () => {
  const result = validateTelegramInitData(signInitData({ auth_date: String(fresh()), user: user() }, 'x:yyyyyyyyyyyyyyyyyyyyyyyyy'), TOKEN);
  assert.equal(result.valid, false);
});

test('rejects tampered initData', () => {
  const signed = signInitData({ auth_date: String(fresh()), user: user(7) });
  assert.equal(validateTelegramInitData(signed.replace('id%22%3A7', 'id%22%3A8'), TOKEN).valid, false);
});

test('rejects empty initData', () => {
  assert.equal(validateTelegramInitData('', TOKEN).valid, false);
});

test('session tokens round-trip for the right user and fail for a wrong token', () => {
  const session = createTelegramSessionToken(99, TOKEN);
  assert.deepEqual(validateTelegramSessionToken(session, TOKEN), { valid: true, userId: 99 });
  assert.equal(validateTelegramSessionToken(session, 'other:token_zzzzzzzzzzzzzzzzzzzzzzzz').valid, false);
});

test('expired session tokens are rejected', () => {
  const expired = createTelegramSessionToken(5, TOKEN, -10);
  assert.equal(validateTelegramSessionToken(expired, TOKEN).valid, false);
});

test('rejects initData when no bot token is configured (fails closed)', () => {
  const signed = signInitData({ auth_date: String(fresh()), user: user() }, TOKEN);
  assert.equal(validateTelegramInitData(signed).valid, false);
  assert.equal(validateTelegramInitData(signed, '').valid, false);
});

test('rejects initData older than 24 hours', () => {
  const old = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
  const result = validateTelegramInitData(signInitData({ auth_date: String(old), user: user() }), TOKEN);
  assert.equal(result.valid, false);
});

test('rejects initData dated in the future beyond clock skew', () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const result = validateTelegramInitData(signInitData({ auth_date: String(future), user: user() }), TOKEN);
  assert.equal(result.valid, false);
});

test('guest identity tokens round-trip and reject tampering and expiry', () => {
  const token = issueIdentityToken('guest_abc123');
  assert.equal(verifyIdentityToken(token), 'guest_abc123');
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'guest_victim', exp: 9999999999 })).toString('base64url');
  assert.equal(verifyIdentityToken(`${forged}.${sig}`), null);
  assert.equal(verifyIdentityToken(issueIdentityToken('guest_old', -10)), null);
  assert.equal(verifyIdentityToken(undefined), null);
});

test('resolvePlayerIdentity maps Telegram sessions to tg_ ids and guest tokens to guest ids only', () => {
  const session = createTelegramSessionToken(42, TOKEN);
  assert.equal(resolvePlayerIdentity(session, TOKEN), 'tg_42');
  assert.equal(resolvePlayerIdentity(session, undefined), null);
  assert.equal(resolvePlayerIdentity(issueIdentityToken('guest_zz'), TOKEN), 'guest_zz');
  assert.equal(resolvePlayerIdentity('garbage', TOKEN), null);
});
