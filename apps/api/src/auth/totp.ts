import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { TWO_FACTOR_POLICIES, type TwoFactorPolicy } from '@darpan/shared';

/**
 * Time-based one-time passwords (RFC 6238): HMAC-SHA1, 6 digits, 30-second steps. This is what
 * Google Authenticator, Microsoft Authenticator and similar phone apps produce.
 */
const STEP_SEC = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Not a base32 secret');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 random bits, the size RFC 4226 recommends. */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SEC);
}

export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const num = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(num).padStart(DIGITS, '0');
}

/**
 * Checks a 6-digit code, allowing one step either side for clock drift. Returns the matching step,
 * or null. Steps at or before `lastStep` are refused, so a code cannot be used twice.
 */
export function verifyCode(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    const expected = Buffer.from(codeAt(secret, s));
    if (timingSafeEqual(expected, Buffer.from(code))) return s;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = 'KDCC Darpan'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}

// ---- Secrets at rest ----

function key(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY ?? '';
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must be 32 random bytes in base64 (see .env.example).');
  return buf;
}

/** Checked at startup so a bad key fails loudly, not at someone's first sign-in. */
export function assertTotpKey(): void {
  key();
}

/** AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unknown 2FA secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// ---- Recovery codes ----

/** "abcd-efgh" from an unambiguous alphabet (no 0/o, 1/l). About 40 bits each. */
export function newRecoveryCode(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => letters[b % letters.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function normaliseRecoveryCode(input: string): string {
  const s = input.toLowerCase().replace(/[^a-z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

/** Recovery codes are random, so a plain SHA-256 is enough to store them. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

/** REQUIRE_2FA from .env. Unset means off (dev); a typo means admins, the safer reading. */
export function twoFactorPolicy(): TwoFactorPolicy {
  const raw = process.env.REQUIRE_2FA;
  if (raw === undefined || raw.trim() === '') return 'off';
  const v = raw.trim().toLowerCase();
  return (TWO_FACTOR_POLICIES as readonly string[]).includes(v) ? (v as TwoFactorPolicy) : 'admins';
}
