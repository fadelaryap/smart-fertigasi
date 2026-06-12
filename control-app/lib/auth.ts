// Password hashing (scrypt) + user lookup. Node-only. The hash format here MUST
// match the seed script (scripts/seed.mjs): scrypt$<saltHex>$<hashHex>.
import crypto from "node:crypto";
import { getDb } from "./db";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const hash = crypto.scryptSync(password, salt, expected.length);
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

export function findUser(username: string): UserRow | null {
  return (
    (getDb()
      .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
      .get(username) as UserRow | undefined) ?? null
  );
}
