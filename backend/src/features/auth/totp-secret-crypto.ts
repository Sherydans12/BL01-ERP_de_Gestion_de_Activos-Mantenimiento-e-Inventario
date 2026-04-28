import * as crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;

function deriveKey(material: string): Buffer {
  return crypto.scryptSync(material, 'bl01-totp-v1', 32);
}

export function encryptTotpSecret(plain: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptTotpSecret(payload: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial);
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('Invalid TOTP payload');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}
