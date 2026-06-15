// Telegram bot poller (Control App side). Long-polls getUpdates and handles
// /subscribe, /unsubscribe, /status so users can opt in/out of notifications.
// We use polling (not a webhook) because the deployment is HTTP-only (no HTTPS).
//
// Token is read from settings each cycle: the poller idles until a token is set
// in the UI, then activates automatically (no restart needed).
import { getDb, getSetting, setSetting, logEvent } from "./db";
import { nowIso } from "./time";

const g = globalThis as unknown as { 
  __fertBotStarted?: boolean;
  __telegramBotStatus?: "idle" | "ok" | "error";
};

export function getTelegramBotStatus() {
  return g.__telegramBotStatus || "idle";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(token: string, method: string, params: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    // getUpdates long-polls up to ~30s; allow a bit more.
    signal: AbortSignal.timeout(40_000),
  });
  return res.json();
}

function upsertSubscriber(chatId: string, name: string, username: string) {
  getDb()
    .prepare(
      `INSERT INTO subscribers (chat_id, name, username, active, subscribed_at)
         VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         active = 1, name = excluded.name, username = excluded.username,
         subscribed_at = excluded.subscribed_at, unsubscribed_at = NULL`
    )
    .run(chatId, name, username, nowIso());
}

function deactivateSubscriber(chatId: string) {
  getDb()
    .prepare(
      "UPDATE subscribers SET active = 0, unsubscribed_at = ? WHERE chat_id = ?"
    )
    .run(nowIso(), chatId);
}

async function handleUpdate(token: string, update: any): Promise<void> {
  const msg = update?.message;
  if (!msg || typeof msg.text !== "string") return;
  const chat = msg.chat ?? {};
  const chatId = String(chat.id);
  const name =
    [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || "";
  const username = chat.username ?? "";
  const cmd = msg.text.trim().toLowerCase().split(/\s|@/)[0];

  if (cmd === "/start" || cmd === "/subscribe") {
    upsertSubscriber(chatId, name, username);
    logEvent("info", "telegram_subscribe", { chatId, name, username });
    await api(token, "sendMessage", {
      chat_id: chatId,
      text: "✅ Kamu berlangganan notifikasi fertigasi AgriHub. Kirim /unsubscribe untuk berhenti.",
    });
  } else if (cmd === "/unsubscribe" || cmd === "/stop") {
    deactivateSubscriber(chatId);
    logEvent("info", "telegram_unsubscribe", { chatId });
    await api(token, "sendMessage", {
      chat_id: chatId,
      text: "🛑 Kamu berhenti berlangganan. Kirim /subscribe untuk berlangganan lagi.",
    });
  } else if (cmd === "/status") {
    const row = getDb()
      .prepare("SELECT active FROM subscribers WHERE chat_id = ?")
      .get(chatId) as { active: number } | undefined;
    await api(token, "sendMessage", {
      chat_id: chatId,
      text:
        row && row.active
          ? "Status: berlangganan ✅"
          : "Status: belum berlangganan. Kirim /subscribe.",
    });
  } else {
    await api(token, "sendMessage", {
      chat_id: chatId,
      text: "Perintah: /subscribe, /unsubscribe, /status",
    });
  }
}

async function pollLoop(): Promise<void> {
  // Runs for the lifetime of the server process.
  let consecutiveErrors = 0;
  const BASE_BACKOFF = 10_000;    // 10 seconds
  const MAX_BACKOFF  = 120_000;   // 2 minutes cap

  for (;;) {
    const token = getSetting("telegram_bot_token");
    if (!token) {
      g.__telegramBotStatus = "idle";
      await sleep(15_000); // idle until a token is configured in the UI
      continue;
    }
    const offset = Number(getSetting("telegram_update_offset") || "0");
    try {
      const res = await api(token, "getUpdates", { offset, timeout: 30 });
      if (!res?.ok) {
        g.__telegramBotStatus = "error";
        // e.g. 409 Conflict (another getUpdates / webhook set), invalid token, etc.
        logEvent("warn", "telegram_poll_not_ok", { description: res?.description });
        await sleep(10_000);
        continue;
      }
      // Success — reset backoff counter
      g.__telegramBotStatus = "ok";
      consecutiveErrors = 0;
      const updates: any[] = Array.isArray(res.result) ? res.result : [];
      let maxId = offset - 1;
      for (const upd of updates) {
        maxId = Math.max(maxId, upd.update_id);
        try {
          await handleUpdate(token, upd);
        } catch (err) {
          logEvent("warn", "telegram_handle_error", { error: String(err) });
        }
      }
      if (updates.length) setSetting("telegram_update_offset", String(maxId + 1));
    } catch (err: unknown) {
      g.__telegramBotStatus = "error";
      consecutiveErrors++;
      // Extract the underlying cause (e.g. DNS ENOTFOUND, ECONNREFUSED)
      const cause = (err as { cause?: unknown })?.cause;
      const detail = cause ? `${String(err)} — cause: ${String(cause)}` : String(err);
      // Only log every Nth error to terminal to reduce console spam
      if (consecutiveErrors <= 3 || consecutiveErrors % 10 === 0) {
        console.warn(`[telegram-bot] Poll error (x${consecutiveErrors}):`, detail);
      }
      const backoff = Math.min(BASE_BACKOFF * Math.pow(2, consecutiveErrors - 1), MAX_BACKOFF);
      await sleep(backoff);
    }
  }
}

export function startTelegramBot(): void {
  if (g.__fertBotStarted) return;
  g.__fertBotStarted = true;
  logEvent("info", "telegram_bot_started", {});
  void pollLoop();
}
