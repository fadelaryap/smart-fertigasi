// Telegram notifications (server-only). SUBSCRIBE MODEL: notifications are
// broadcast to every active subscriber (subscribers table, populated by the bot
// poller in telegram-bot.ts). The optional telegram_chat_id setting is included
// too (deduped) as an always-on admin recipient. If there's no token or no
// recipient, falls back to LOG-ONLY. Never throws into the control flow.
import { getDb, getSetting, logEvent, type EventLevel } from "./db";

const EMOJI: Record<EventLevel, string> = {
  info: "ℹ️",
  warn: "⚠️",
  error: "🚨",
};

export interface TelegramResult {
  sent: boolean;
  count?: number;
  reason?: string;
}

export function getRecipients(): string[] {
  const subs = getDb()
    .prepare("SELECT chat_id FROM subscribers WHERE active = 1")
    .all() as { chat_id: string }[];
  const set = new Set(subs.map((s) => s.chat_id));
  const single = getSetting("telegram_chat_id");
  if (single) set.add(single); // optional admin recipient
  return [...set];
}

// Low-level send to a single chat. Returns true on HTTP 2xx.
export async function sendTelegramTo(
  token: string,
  chatId: string,
  text: string
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logEvent("warn", "telegram_send_failed", { chatId, status: res.status, body });
      return false;
    }
    return true;
  } catch (err) {
    logEvent("warn", "telegram_send_failed", { chatId, error: String(err) });
    return false;
  }
}

export async function sendTelegram(
  level: EventLevel,
  message: string
): Promise<TelegramResult> {
  const token = getSetting("telegram_bot_token");
  const text = `${EMOJI[level]} ${message}`;
  const recipients = token ? getRecipients() : [];

  if (!token || recipients.length === 0) {
    logEvent("info", "telegram_skipped", {
      level,
      message,
      reason: token ? "no_subscribers" : "no_token",
    });
    console.log(`[telegram:log-only] ${text}`);
    return { sent: false, reason: token ? "no_subscribers" : "no_token" };
  }

  let sent = 0;
  for (const chatId of recipients) {
    if (await sendTelegramTo(token, chatId, text)) sent++;
  }
  logEvent("info", "telegram_broadcast", { level, recipients: recipients.length, sent });
  return { sent: sent > 0, count: sent };
}
