#!/usr/bin/env python3
"""Watchdog — runs every minute via OS cron. The safety net, independent of the
Control App scheduler.

Responsibilities (spec §9):
  1. Turn off runs whose expected_off_at has passed  -> POST /api/stop.
  2. Absolute SAFETY CUTOFF: any channel ON longer than safety_max_minutes is
     force-stopped + error notification, independent of the duration logic.
  3. Verify the channels in play via /api/device/status (retry) — mismatch ->
     anomaly notification.
  4. Record last_checked_at / verified + event_log.

Design note: the watchdog DECIDES independently from the DB, but ACTUATES relays
through the Control App's /api/stop (eWeLink control is centralized there). If the
Control App is unreachable it logs an error and alerts loudly via Telegram.
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone

# Shared helpers (db.py, notify.py) live in brain/.
_BRAIN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "brain")
sys.path.insert(0, _BRAIN)

import requests  # noqa: E402
import db  # noqa: E402
import notify  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass


def parse_iso(s: str | None):
    if not s:
        return None
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def control_url() -> str:
    return (os.environ.get("CONTROL_APP_URL") or "http://127.0.0.1:4500").rstrip("/")


def post_stop(run_id: int):
    return requests.post(control_url() + "/api/stop", json={"run_id": run_id}, timeout=60)


def get_device_state(device_id: str, channel: int):
    r = requests.get(
        control_url() + "/api/device/status",
        params={"device_id": device_id, "channel": channel},
        timeout=15,
    )
    r.raise_for_status()
    return r.json().get("state")


def verify_channel(conn, row) -> bool:
    """Verify the real device state matches the recorded channel_state, retrying
    a few times. Updates verified/last_checked_at; notifies on persistent mismatch."""
    expected = row["state"]
    actual = None
    for attempt in range(3):
        try:
            actual = get_device_state(row["device_id"], row["channel"])
        except Exception:  # noqa: BLE001
            actual = None
        if actual == expected:
            break
        if attempt < 2:
            time.sleep(1)

    verified = 1 if actual == expected else 0
    conn.execute(
        "UPDATE channel_state SET verified=?, last_checked_at=? WHERE id=?",
        (verified, db.now_iso(), row["id"]),
    )
    conn.commit()
    if not verified:
        db.log_event(conn, "warn", "watchdog_verify_mismatch", {
            "id": row["id"], "device_id": row["device_id"], "channel": row["channel"],
            "expected": expected, "actual": actual,
        })
        notify.send_telegram(
            "warn",
            f"Anomali: device {row['device_id']} ch{row['channel']} seharusnya "
            f"'{expected}' tapi terbaca '{actual}'.",
            conn=conn,
        )
    return bool(verified)


def main() -> int:
    db.load_env()
    conn = db.connect()
    try:
        now = datetime.now(timezone.utc)
        safety_max = float(db.get_setting(conn, "safety_max_minutes", "60") or "60")

        active = conn.execute("SELECT * FROM channel_state WHERE state='on'").fetchall()
        if not active:
            print("[watchdog] no active channels.")
            return 0

        active_ids = [r["id"] for r in active]

        # 1 + 2) Decide which runs to stop (safety cutoff takes priority over expiry).
        stop_reason: dict[int, str] = {}
        for r in active:
            run_id = r["run_id"]
            if run_id is None:
                continue
            on_at = parse_iso(r["on_at"])
            exp = parse_iso(r["expected_off_at"])
            if on_at is not None and (now - on_at).total_seconds() >= safety_max * 60:
                stop_reason[run_id] = "safety_cutoff"
            elif exp is not None and now >= exp and run_id not in stop_reason:
                stop_reason[run_id] = "expired"

        for run_id, reason in stop_reason.items():
            try:
                resp = post_stop(run_id)
                ok = resp.status_code < 300
                body = resp.text[:300]
            except Exception as exc:  # noqa: BLE001
                db.log_event(conn, "error", "watchdog_stop_failed",
                             {"run_id": run_id, "reason": reason, "error": str(exc)})
                notify.send_telegram(
                    "error",
                    f"Watchdog GAGAL mematikan run #{run_id} ({reason}): {exc}. "
                    f"Control App tak terjangkau?",
                    conn=conn,
                )
                continue

            if reason == "safety_cutoff":
                db.log_event(conn, "error", "watchdog_safety_cutoff",
                             {"run_id": run_id, "ok": ok, "response": body})
                notify.send_telegram(
                    "error",
                    f"SAFETY CUTOFF: run #{run_id} menyala melebihi {safety_max:.0f} mnt "
                    f"— dipaksa mati.",
                    conn=conn,
                )
            else:
                db.log_event(conn, "info", "watchdog_expired_off",
                             {"run_id": run_id, "ok": ok, "response": body})
            print(f"[watchdog] stopped run #{run_id} ({reason}) ok={ok}")

        # 3 + 4) Verify the channels that were in play this tick (re-read post-stop).
        placeholders = ",".join("?" * len(active_ids))
        rows = conn.execute(
            f"SELECT * FROM channel_state WHERE id IN ({placeholders})", active_ids
        ).fetchall()
        mism = 0
        for row in rows:
            if not verify_channel(conn, row):
                mism += 1
        print(f"[watchdog] verified {len(rows)} channel(s), {mism} mismatch.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
