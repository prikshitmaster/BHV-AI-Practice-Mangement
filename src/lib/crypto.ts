/**
 * Cryptographic primitives — AUTH01/AUTH02 (PRD §10).
 *
 * Everything here uses Node's built-in `crypto`; there is no hand-rolled
 * cryptography and no third-party implementation of a primitive.
 *
 * Rules this file exists to keep:
 *   - a password is never stored, only a scrypt derivation with a per-user salt;
 *   - a TOTP seed is never stored in the clear — it is AES-256-GCM encrypted
 *     under a key held OUTSIDE the database, so a stolen dump yields no codes;
 *   - tokens (session, invitation, recovery, backup codes) are stored only as
 *     SHA-256 digests, so the database cannot be replayed against the app;
 *   - every comparison of secret material is constant time.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import type { ScryptOptions } from "node:crypto";

// promisify() drops scrypt's options overload, so wrap it explicitly.
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// OWASP-aligned scrypt parameters (N=2^16, r=8, p=1).
const SCRYPT_N = 65536;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_r * 2;

// ---------------------------------------------------------------- passwords

/** Returns `scrypt$N$r$p$salt$hash`, all base64url. Never store the input. */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(plaintext.normalize("NFKC"), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: SCRYPT_MAXMEM,
  }));

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_r,
    SCRYPT_p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");

  const derived = (await scrypt(plaintext.normalize("NFKC"), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_MAXMEM,
  }));

  return constantTimeEquals(derived, expected);
}

export function constantTimeEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ------------------------------------------------------------------- tokens

/** A high-entropy, URL-safe token. This value is shown ONCE and never stored. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** What actually goes in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokensMatch(token: string, storedHash: string): boolean {
  return constantTimeEquals(
    Buffer.from(hashToken(token), "hex"),
    Buffer.from(storedHash, "hex"),
  );
}

/** Human-transcribable recovery codes, e.g. `7K2M-9QXA-4RTP`. */
export function generateRecoveryCode(): string {
  // Excludes I, L, O, 0, 1 to avoid transcription errors.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const group = () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

// ------------------------------------------------------- secret encryption

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "APP_ENCRYPTION_KEY is not set. MFA seeds cannot be stored without it — " +
        "refusing to fall back to a default key.",
    );
    this.name = "EncryptionKeyMissingError";
  }
}

function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  // Failing closed matters more than convenience: a hardcoded fallback key
  // would make every deployment's MFA seeds decryptable by anyone with the source.
  if (!raw) throw new EncryptionKeyMissingError();

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded (AES-256).");
  }
  return key;
}

export type EncryptedSecret = { ciphertext: string; iv: string; authTag: string };

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// --------------------------------------------------------------- TOTP (RFC 6238)

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];

  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32 character in TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The RFC 6238 time step for an instant — also used for replay prevention. */
export function totpStep(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
}

export function totpCodeForStep(base32Secret: string, step: number): string {
  const key = base32Decode(base32Secret);

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

export function totpCode(base32Secret: string, at: Date = new Date()): string {
  return totpCodeForStep(base32Secret, totpStep(at));
}

/**
 * Verify a code within ±`window` steps of now (clock drift tolerance).
 * Returns the step it matched, so the caller can refuse a replay of that same
 * step — a 30-second window is otherwise a free second use of the code.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  opts: { at?: Date; window?: number; lastUsedStep?: bigint | null } = {},
): { valid: boolean; step?: number; reason?: string } {
  const at = opts.at ?? new Date();
  const window = opts.window ?? 1;
  const current = totpStep(at);
  const submitted = code.replace(/\s/g, "");

  for (let drift = -window; drift <= window; drift++) {
    const step = current + drift;
    const expected = totpCodeForStep(base32Secret, step);

    if (
      submitted.length === expected.length &&
      constantTimeEquals(Buffer.from(submitted), Buffer.from(expected))
    ) {
      if (opts.lastUsedStep != null && BigInt(step) <= opts.lastUsedStep) {
        return { valid: false, reason: "Code already used" };
      }
      return { valid: true, step };
    }
  }

  return { valid: false, reason: "Invalid code" };
}
