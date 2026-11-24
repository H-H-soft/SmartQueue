import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { hashToken, newToken } from './domain.js';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLEL = 1;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLEL, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLEL}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const [, costText, blockText, parallelText, saltText, keyText] = String(encoded).split('$');
  const cost = Number(costText);
  const block = Number(blockText);
  const parallel = Number(parallelText);
  if (cost !== COST || block !== BLOCK_SIZE || parallel !== PARALLEL || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, { N: cost, r: block, p: parallel, maxmem: 64 * 1024 * 1024 });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function issueAccountToken() {
  const token = newToken();
  return { token, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) };
}

export function publicAccount(account) {
  const { id, email, profile, highContrast, largeText, createdAt } = account;
  return { id, email, profile, highContrast, largeText, createdAt };
}
