import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-constants";

// Lightweight gate (edge runtime): redirect to /login when the session cookie is
// missing or expired. This is a fast UX gate only — the cryptographic HMAC check
// is enforced server-side in the protected layout (getCurrentUser). The matcher
// EXCLUDES /api/* so the control endpoints stay open for brain/watchdog.
export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};

function isExpired(token: string): boolean {
  try {
    const part = token.split(".")[0];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const payload = JSON.parse(atob(b64 + pad));
    return typeof payload.exp !== "number" || payload.exp * 1000 < Date.now();
  } catch {
    return true; // unparseable -> treat as invalid
  }
}

export function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || isExpired(token)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
