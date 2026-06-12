// Signed session cookie (HMAC-SHA256 over a small JSON payload). Node-only —
// used by server actions and the protected layout's getCurrentUser(). NOT
// imported by middleware (which can't load the root .env on the edge runtime).
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { requireEnv } from "./env";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "./auth-constants";

export { SESSION_COOKIE, SESSION_MAX_AGE };

function sign(data: string): string {
  return crypto
    .createHmac("sha256", requireEnv("SESSION_SECRET"))
    .update(data)
    .digest("base64url");
}

export function createSessionToken(username: string): string {
  const payload = {
    u: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${p}.${sign(p)}`;
}

export function verifySessionToken(token: string): string | null {
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const expected = sign(p);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
      return null;
    }
    return typeof payload.u === "string" ? payload.u : null;
  } catch {
    return null;
  }
}

// Authoritative current-user check (verifies the HMAC). Use in the protected layout.
export async function getCurrentUser(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
