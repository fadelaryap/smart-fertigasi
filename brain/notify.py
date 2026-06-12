"""Telegram notification helper shared by brain.py and watchdog.py.

Uses only the stdlib (urllib) so it has no external dependency and runs even
before the venv is provisioned. Reads bot token + chat id from the `settings`
table. If either is empty, falls back to LOG-ONLY. Never raises into callers.

CLI:  python notify.py "your message" [info|warn|error]
"""
from __future__ import annotations

import json
import sys
import urllib.request
from typing import Optional

import db

# Ensure emoji print safely on Windows consoles (cp1252). No-op on UTF-8 systems.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

_EMOJI = {"info": "ℹ️", "warn": "⚠️", "error": "🚨"}


def _recipients(conn) -> list[str]:
    """Active subscribers (subscribe model) + optional admin telegram_chat_id."""
    rows = conn.execute("SELECT chat_id FROM subscribers WHERE active = 1").fetchall()
    ids = {r["chat_id"] for r in rows}
    single = db.get_setting(conn, "telegram_chat_id")
    if single:
        ids.add(single)
    return list(ids)


def _send_one(token: str, chat_id: str, text: str) -> bool:
    try:
        payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except Exception:  # noqa: BLE001
        return False


def send_telegram(level: str, message: str, conn=None) -> bool:
    """Broadcast a Telegram message to all active subscribers. Returns True if at
    least one send succeeded, False if log-only or all failed. Never raises."""
    own_conn = conn is None
    if own_conn:
        conn = db.connect()
    try:
        token = db.get_setting(conn, "telegram_bot_token")
        text = f"{_EMOJI.get(level, 'ℹ️')} {message}"
        recipients = _recipients(conn) if token else []

        if not token or not recipients:
            reason = "no_subscribers" if token else "no_token"
            db.log_event(conn, "info", "telegram_skipped",
                         {"level": level, "message": message, "reason": reason})
            print(f"[telegram:log-only] {text}")
            return False

        sent = sum(1 for cid in recipients if _send_one(token, cid, text))
        db.log_event(conn, "info", "telegram_broadcast",
                     {"level": level, "recipients": len(recipients), "sent": sent})
        return sent > 0
    finally:
        if own_conn:
            conn.close()


if __name__ == "__main__":
    msg = sys.argv[1] if len(sys.argv) > 1 else "test from notify.py"
    lvl = sys.argv[2] if len(sys.argv) > 2 else "info"
    sent = send_telegram(lvl, msg)
    print(f"sent={sent}")
