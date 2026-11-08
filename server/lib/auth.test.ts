import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToken, hashPassword, sessionExpiry, verifyPassword } from './auth.js';

test('password hashes verify only the matching password', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
  assert.equal(verifyPassword('incorrect password', hash), false);
});

test('password verification safely rejects missing and malformed hashes', () => {
  assert.equal(verifyPassword('anything', ''), false);
  assert.equal(verifyPassword('anything', 'CHANGE_ME'), false);
  assert.equal(verifyPassword('anything', 'not-a-bcrypt-hash'), false);
});

test('session tokens are 32-byte hexadecimal values and are independently generated', () => {
  const tokens = Array.from({ length: 20 }, () => generateToken());
  for (const token of tokens) assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(new Set(tokens).size, tokens.length);
});

test('session expiry returns a valid UTC SQL timestamp approximately 12 hours ahead', () => {
  const before = Date.now();
  const expiry = sessionExpiry();
  const after = Date.now();

  assert.match(expiry, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const expiryMs = Date.parse(`${expiry.replace(' ', 'T')}Z`);
  assert.ok(Number.isFinite(expiryMs));
  assert.ok(expiryMs >= before + 11 * 60 * 60 * 1000);
  assert.ok(expiryMs <= after + 13 * 60 * 60 * 1000);
});
