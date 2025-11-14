// src/lib/auth.ts
import argon2 from "argon2";
import { sign, verify, type SignOptions, type JwtPayload as LibJwtPayload } from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env";

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, parallelism: 1 });
}
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

type JwtPayload = {
  sub: string;
  orgId: string;
  role: "OWNER" | "ADMIN" | "USER" | "AUDITOR";
  email: string;
};

export function signAccessToken(payload: JwtPayload): string {
  const opts: SignOptions = {
    algorithm: "HS256",
    issuer: env.JWT_ISSUER,
    // jsonwebtoken's typings are strict about this union; your env is a plain string.
    // It's valid at runtime, so we assert to the expected type.
    expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"],
    subject: payload.sub,
  };
  return sign(payload, env.JWT_SECRET, opts);
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: env.JWT_ISSUER,
  }) as LibJwtPayload & JwtPayload; // overlay our fields
  return decoded as JwtPayload;
}

// ---------- API Keys (HMAC-like pattern) ----------
export function createApiKeyMaterial(): { id: string; rawKey: string; secretHash: string } {
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString("base64url");
  const rawKey = `ak_${id}.${secret}`;
  const secretHash = hashApiKeySecret(secret);
  return { id, rawKey, secretHash };
}

export function parseRawApiKey(raw: string): { id: string; secret: string } | null {
  const m = /^ak_([a-f0-9-]{36})\.([A-Za-z0-9\-_]{10,})$/.exec(raw);
  if (!m) return null;
  return { id: m[1], secret: m[2] };
}

export function hashApiKeySecret(secret: string): string {
  return crypto.createHash("sha256").update(secret + env.API_KEY_PEPPER, "utf8").digest("hex");
}

export function verifyApiKeySecret(secret: string, storedHash: string): boolean {
  const h = hashApiKeySecret(secret);
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(storedHash, "hex"));
}
