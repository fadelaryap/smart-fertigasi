"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findUser, verifyPassword } from "@/lib/auth";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";
import { logEvent } from "@/lib/db";

export async function login(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const user = findUser(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    logEvent("warn", "login_failed", { username });
    redirect("/login?error=1");
  }

  const token = createSessionToken(user.username);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  logEvent("info", "login_ok", { username });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
