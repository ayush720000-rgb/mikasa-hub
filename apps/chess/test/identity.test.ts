import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueIdentityToken, verifyIdentityToken, resolveSocketIdentity } from '../src/server/identity';

test('issued tokens verify to their subject', () => {
  assert.equal(verifyIdentityToken(issueIdentityToken('tg:42')), 'tg:42');
});

test('telegram and guest subjects map to the expected player ids', () => {
  assert.deepEqual(resolveSocketIdentity(issueIdentityToken('tg:42')), { id: 42 });
  assert.deepEqual(resolveSocketIdentity(issueIdentityToken('guest_0123456789abcdef')), { id: 'guest_0123456789abcdef' });
});

test('tokens with unknown subject shapes are rejected', () => {
  assert.equal(resolveSocketIdentity(issueIdentityToken('admin')), null);
  assert.equal(resolveSocketIdentity(issueIdentityToken('tg:abc')), null);
});

test('forged payloads, expired tokens and missing tokens are rejected', () => {
  const token = issueIdentityToken('tg:42');
  const [, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'tg:999', exp: 9999999999 })).toString('base64url');
  assert.equal(verifyIdentityToken(`${forged}.${sig}`), null);
  assert.equal(verifyIdentityToken(issueIdentityToken('tg:42', -10)), null);
  assert.equal(verifyIdentityToken(undefined), null);
  assert.equal(verifyIdentityToken(''), null);
});
