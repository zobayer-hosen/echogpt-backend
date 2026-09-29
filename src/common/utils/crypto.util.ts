import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** SHA-256 hex digest (refresh tokens, email-verify tokens). */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function keyFromHex(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }
  return key;
}

/**
 * AES-256-GCM with a random 12-byte IV per value.
 * Output: `iv:authTag:ciphertext`, each base64 (ERD §3).
 */
export function encrypt(plainText: string, keyHex: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFromHex(keyHex), iv, {
    authTagLength: TAG_BYTES,
  });
  const cipherText = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), cipherText]
    .map((part) => part.toString('base64'))
    .join(':');
}

/** Reverses `encrypt()`. Throws if the value was tampered with or the key is wrong. */
export function decrypt(payload: string, keyHex: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted value');
  }
  const [iv, tag, cipherText] = parts.map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv(ALGORITHM, keyFromHex(keyHex), iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(cipherText),
    decipher.final(),
  ]).toString('utf8');
}
