import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, safeEqualHex, sha256 } from './crypto.util';

const key = randomBytes(32).toString('hex');
const secret = 'sk-live-1234567890abcdef';

describe('crypto.util (T8)', () => {
  it('encrypt → decrypt round-trips', () => {
    const payload = encrypt(secret, key);
    expect(decrypt(payload, key)).toBe(secret);
  });

  it('stores iv:authTag:ciphertext and never the plain text', () => {
    const payload = encrypt(secret, key);
    const parts = payload.split(':');
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0], 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(16);
    expect(payload).not.toContain(secret);
  });

  it('uses a fresh IV every time', () => {
    expect(encrypt(secret, key)).not.toBe(encrypt(secret, key));
  });

  it('rejects tampered ciphertext', () => {
    const [iv, tag, cipherText] = encrypt(secret, key).split(':');
    const flipped = Buffer.from(cipherText, 'base64');
    flipped[0] ^= 0xff;
    expect(() =>
      decrypt([iv, tag, flipped.toString('base64')].join(':'), key),
    ).toThrow();
  });

  it('rejects the wrong key', () => {
    const other = randomBytes(32).toString('hex');
    expect(() => decrypt(encrypt(secret, key), other)).toThrow();
  });

  it('rejects malformed values and short keys', () => {
    expect(() => decrypt('not-encrypted', key)).toThrow('Malformed');
    expect(() => encrypt(secret, 'abcd')).toThrow('32 bytes');
  });

  it('hashes with SHA-256 and compares in constant time', () => {
    const hash = sha256('token');
    expect(hash).toHaveLength(64);
    expect(safeEqualHex(hash, sha256('token'))).toBe(true);
    expect(safeEqualHex(hash, sha256('other'))).toBe(false);
  });
});
