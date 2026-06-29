#!/usr/bin/env python3
"""Brain: fetch agrihub sensors -> fuzzy -> duration -> POST /api/run.

Usage:
  python brain.py [schedule|manual] [--dry]
  python brain.py --digest      # kirim ringkasan 'hari baru' ke subscriber Telegram

  --dry         decide only: print the decision, do NOT POST / write DB / notify.
  --digest      broadcast the daily "new day" summary (date, today's watering
                schedule, last weather/soil reading) to Telegram, then exit.

Flow:
  1. Build the fuzzy controller from the DB fuzzy_config row (rebuilt every run,
     so UI changes take effect without code changes).
  2. Read sensors from agrihub. soil_moisture = avg of the soil channels picked
     in Settings ('soil_channels'); channels that read null/0 are skipped.
  3. duration = controller.compute(...).
  4. duration == 0 -> log 'skipped' + Telegram skip notice -> done.
  5. duration  > 0 -> POST /api/run to the Control App (which runs the ON sequence).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import requests

import db
import notify
from fuzzy_controller import FuzzyConfig, FuzzyIrrigationController

# Ensure emoji/unicode print safely on Windows consoles (cp1252). No-op on Linux.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

# ─── agrihub adapter ─ PLACEHOLDER ───────────────────────────────────────────
# One endpoint returns raw channels {s0, s1, ...} for a device. We fetch the
# weather device and the soil device (by device_id), then map channels -> meaning
# using DB settings (configurable from the Settings UI). See
# docs/agrihub-latest-api.md.
# NOTE: the agrihub device_id here is NOT the eWeLink/Sonoff device_id.
DATA_PATH = "/api/data/latest"


def fetch_latest(base: str, device_id: str) -> dict:
    if not device_id:
        raise RuntimeError("device_id agrihub belum diatur di settings.")
    r = requests.get(base + DATA_PATH, params={"device_id": device_id}, timeout=15)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, dict):
        raise RuntimeError(f"respons agrihub tak terduga: {data!r}")
    return data


def _weather_channel(data: dict, channel: str, label: str) -> float:
    """Read a weather channel value.

    0 is allowed for a single channel (e.g. solar_radiation = 0 at night is
    real). The "device baru nyala / data belum valid" case — where the device
    reports 0 on *every* channel — is caught in read_sensors, not here.
    Only mapping/data errors (channel unset, missing, or null) fail.
    """
    if not channel:
        raise RuntimeError(f"channel untuk '{label}' belum dipetakan di settings.")
    if channel not in data:
        raise RuntimeError(f"{label}: channel '{channel}' tidak ada di respons agrihub.")
    raw = data[channel]
    if raw is None:
        raise RuntimeError(f"{label}: channel '{channel}' bernilai null di respons agrihub.")
    return float(raw)


def _soil_channel_value(data: dict, channel: str) -> float | None:
    """Read a soil channel value. Returns None if null or 0 (invalid)."""
    raw = data.get(channel)
    if raw is None:
        return None
    val = float(raw)
    if val == 0:
        return None  # 0 dianggap error sensor
    return val


def read_sensors(conn) -> dict:
    base = (db.get_setting(conn, "agrihub_base_url") or "").rstrip("/")
    if not base:
        raise RuntimeError("agrihub_base_url belum diatur di settings.")

    weather = fetch_latest(base, db.get_setting(conn, "agrihub_weather_device_id") or "")
    soil = fetch_latest(base, db.get_setting(conn, "agrihub_soil_device_id") or "")

    temp = _weather_channel(weather, db.get_setting(conn, "weather_temp_channel") or "", "temperature")
    rh = _weather_channel(weather, db.get_setting(conn, "weather_rh_channel") or "", "relative_humidity")
    wind = _weather_channel(weather, db.get_setting(conn, "weather_wind_channel") or "", "wind_speed")
    rad = _weather_channel(weather, db.get_setting(conn, "weather_radiation_channel") or "", "solar_radiation")

    # Satu channel 0 itu wajar (mis. radiasi 0 malam hari). Tapi kalau SEMUA 0,
    # kemungkinan device baru nyala / belum kirim data valid -> tolak.
    if temp == 0 and rh == 0 and wind == 0 and rad == 0:
        raise RuntimeError(
            "Semua channel weather (temperature, RH, wind, radiation) bernilai 0 — "
            "kemungkinan device baru nyala, data belum valid."
        )

    soil_channels = [c.strip() for c in (db.get_setting(conn, "soil_channels") or "").split(",") if c.strip()]
    if not soil_channels:
        raise RuntimeError("soil_channels belum dipilih di settings.")

    # Ambil nilai soil yang valid saja (bukan None, bukan 0)
    soil_vals = []
    skipped = []
    for c in soil_channels:
        val = _soil_channel_value(soil, c)
        if val is not None:
            soil_vals.append(val)
        else:
            skipped.append(c)

    if not soil_vals:
        raise RuntimeError(
            f"Semua soil channel ({', '.join(soil_channels)}) bernilai null atau 0 — "
            f"tidak ada data valid untuk dihitung."
        )

    if skipped:
        print(f"[brain] soil channel diabaikan (null/0): {', '.join(skipped)}")

    soil_moisture = sum(soil_vals) / len(soil_vals)

    return {
        "temperature": temp, "relative_humidity": rh, "wind_speed": wind,
        "solar_radiation": rad, "soil_moisture": soil_moisture,
        "soil_channels": soil_channels,
        "soil_channels_used": len(soil_vals),
        "soil_channels_skipped": skipped,
        "weather_raw": weather, "soil_raw": soil,
    }
# ─────────────────────────────────────────────────────────────────────────────


# ─── daily "new day" digest ──────────────────────────────────────────────────
_WIB = timezone(timedelta(hours=7))
_HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]  # weekday(): Mon=0
_BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
          "Agustus", "September", "Oktober", "November", "Desember"]
_CHANNEL_RE = re.compile(r"^s\d+$")


def _sorted_channels(data: dict) -> list[str]:
    """Channel keys (s0, s1, …) sorted numerically, not lexically (s2 before s10)."""
    chans = [k for k in data if isinstance(k, str) and _CHANNEL_RE.match(k)]
    return sorted(chans, key=lambda k: int(k[1:]))


def _fmt_val(raw) -> str:
    """Format a channel value for the digest. null -> 'null' (shown as-is)."""
    if raw is None:
        return "null"
    try:
        f = float(raw)
        return str(int(f)) if f == int(f) else f"{f:.2f}"
    except (TypeError, ValueError):
        return str(raw)


def build_digest(conn) -> str:
    """Build the 'new day' summary: date, today's watering schedule, and the last
    weather/soil reading. Sensor-fetch errors are caught per-device so the digest
    always sends (never raises just because a channel is null)."""
    now = datetime.now(_WIB)
    tanggal = f"{_HARI[now.weekday()]}, {now.day} {_BULAN[now.month]} {now.year}"

    lines = [
        "",  # keep the divider off the info-emoji line that notify prepends
        "====================================",
        "🌅 HARI BARU",
        tanggal,
        "====================================",
        "",
        "🕐 Jadwal penyiraman hari ini:",
    ]

    rows = conn.execute(
        "SELECT time FROM schedules WHERE enabled = 1 ORDER BY time"
    ).fetchall()
    if rows:
        lines += [f"   • {r['time']}" for r in rows]
    else:
        lines.append("   (tidak ada jadwal aktif)")

    base = (db.get_setting(conn, "agrihub_base_url") or "").rstrip("/")

    # Cuaca: tampilkan semua channel 's' yang ada, KECUALI yang null.
    lines += ["", "🌦️ Cuaca (pembacaan terakhir):"]
    try:
        weather = fetch_latest(base, db.get_setting(conn, "agrihub_weather_device_id") or "")
        chans = [c for c in _sorted_channels(weather) if weather.get(c) is not None]
        if chans:
            lines += [f"   {c} = {_fmt_val(weather.get(c))}" for c in chans]
        else:
            lines.append("   (tidak ada channel berisi nilai)")
    except Exception as exc:  # noqa: BLE001
        lines.append(f"   (gagal ambil data: {exc})")

    # Soil: tampilkan semua channel 's' yang ada; null ditulis apa adanya.
    lines += ["", "🌱 Soil (pembacaan terakhir):"]
    try:
        soil = fetch_latest(base, db.get_setting(conn, "agrihub_soil_device_id") or "")
        chans = _sorted_channels(soil)
        if chans:
            lines += [f"   {c} = {_fmt_val(soil.get(c))}" for c in chans]
        else:
            lines.append("   (tidak ada channel soil)")
    except Exception as exc:  # noqa: BLE001
        lines.append(f"   (gagal ambil data: {exc})")

    lines += ["", "Fertigasi terjadwal & notifikasi error tetap berjalan seperti biasa."]
    return "\n".join(lines)
# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Fertigation brain")
    parser.add_argument("triggered_by", nargs="?", default="manual",
                        choices=["schedule", "manual"])
    parser.add_argument("--dry", action="store_true",
                        help="decide only; no POST / DB write / notify")
    parser.add_argument("--test", action="store_true",
                        help="print sensor+fuzzy result as one JSON line (diagnostics UI)")
    parser.add_argument("--digest", action="store_true",
                        help="broadcast the daily 'new day' summary to Telegram, then exit")
    args = parser.parse_args()

    db.load_env()
    conn = db.connect()
    try:
        # Daily "new day" digest: build summary, broadcast, exit. No watering.
        if args.digest:
            try:
                msg = build_digest(conn)
            except Exception as exc:  # noqa: BLE001
                db.log_event(conn, "error", "digest_build_failed", {"error": str(exc)})
                print(f"[brain] digest gagal dibuat: {exc}")
                return 1
            sent = notify.send_telegram("info", msg, conn=conn)
            db.log_event(conn, "info", "digest_sent", {"broadcast": sent})
            print(f"[brain] digest {'terkirim' if sent else 'log-only'}.")
            return 0

        # 1) Rebuild fuzzy controller from DB config every run.
        cfg_row = db.get_fuzzy_config(conn)
        controller = FuzzyIrrigationController(FuzzyConfig(**cfg_row))

        # Diagnostics: print sensor + fuzzy result as ONE JSON line, no side effects.
        if args.test:
            try:
                rt = read_sensors(conn)
            except Exception as exc:  # noqa: BLE001
                print(json.dumps({"ok": False, "error": str(exc)}))
                return 0
            et0_t = controller.calc_et0(rt["temperature"], rt["relative_humidity"],
                                        rt["wind_speed"], rt["solar_radiation"])
            dur_t = controller.compute(rt["soil_moisture"], rt["temperature"],
                                       rt["relative_humidity"], rt["wind_speed"],
                                       rt["solar_radiation"])
            print(json.dumps({
                "ok": True,
                "temperature": rt["temperature"], "relative_humidity": rt["relative_humidity"],
                "wind_speed": rt["wind_speed"], "solar_radiation": rt["solar_radiation"],
                "soil_moisture": round(rt["soil_moisture"], 2),
                "soil_channels": rt["soil_channels"],
                "et0": round(et0_t, 4), "duration_minutes": round(dur_t, 2),
            }))
            return 0

        # 2) Read sensors from agrihub (channels mapped via DB settings).
        try:
            r = read_sensors(conn)
        except Exception as exc:  # noqa: BLE001
            db.log_event(conn, "error", "brain_sensor_fetch_failed", {"error": str(exc)})
            if not args.dry:
                notify.send_telegram("error", f"Brain gagal ambil data sensor: {exc}", conn=conn)
            print(f"[brain] gagal ambil sensor: {exc}")
            return 1

        temp = r["temperature"]
        rh = r["relative_humidity"]
        wind = r["wind_speed"]
        rad = r["solar_radiation"]
        soil_moisture = r["soil_moisture"]

        # 3) Compute.
        et0 = controller.calc_et0(temp, rh, wind, rad)
        duration = controller.compute(soil_moisture, temp, rh, wind, rad)

        snapshot = {
            "temperature": temp, "relative_humidity": rh, "wind_speed": wind,
            "solar_radiation": rad, "soil_moisture": round(soil_moisture, 2),
            "soil_channels": r["soil_channels"],
            "et0": round(et0, 4),
            "source": "agrihub",
        }

        print(f"[brain] soil_avg={soil_moisture:.2f}% et0={et0:.3f} mm/jam "
              f"-> durasi={duration:.2f} mnt" + (" (DRY)" if args.dry else ""))

        if args.dry:
            print("[brain] --dry: tidak POST / tidak tulis DB / tidak notif.")
            return 0

        # 4) Skip path.
        if duration == 0.0:
            started = db.now_iso()
            conn.execute(
                "INSERT INTO irrigation_runs "
                "(triggered_by, started_at, duration_minutes, status, et0, soil_avg, "
                " weather_snapshot, finished_at, notes) VALUES (?,?,?,?,?,?,?,?,?)",
                (args.triggered_by, started, 0, "skipped", et0, soil_moisture,
                 json.dumps(snapshot), started, "fuzzy<1mnt"),
            )
            conn.commit()
            db.log_event(conn, "info", "fuzzy_skip",
                         {"soil_avg": soil_moisture, "et0": et0})
            notify.send_telegram(
                "info",
                f"Skip penyiraman ({args.triggered_by}) — tanah cukup basah "
                f"(soil {soil_moisture:.1f}%, ET0 {et0:.3f} mm/jam). Durasi fuzzy < 1 mnt.",
                conn=conn,
            )
            print("[brain] SKIP (durasi < 1 mnt).")
            return 0

        # 5) Run path — POST to Control App, which executes the ON sequence.
        control_url = (os.environ.get("CONTROL_APP_URL") or "http://127.0.0.1:4500").rstrip("/")
        payload = {
            "duration_minutes": round(duration, 2),
            "triggered_by": args.triggered_by,
            "et0": round(et0, 4),
            "soil_avg": round(soil_moisture, 2),
            "weather_snapshot": snapshot,
        }
        try:
            resp = requests.post(control_url + "/api/run", json=payload, timeout=60)
            body = resp.text[:500]
        except Exception as exc:  # noqa: BLE001
            db.log_event(conn, "error", "brain_post_failed", {"error": str(exc)})
            notify.send_telegram("error", f"Brain gagal memicu /api/run: {exc}", conn=conn)
            print(f"[brain] POST gagal: {exc}")
            return 1

        if resp.status_code < 300:
            db.log_event(conn, "info", "brain_posted_run",
                         {"payload": payload, "response": body})
            print(f"[brain] POST /api/run OK: {body}")
            return 0
        db.log_event(conn, "error", "brain_post_failed",
                     {"status": resp.status_code, "body": body})
        notify.send_telegram("error",
                             f"Brain: /api/run balas HTTP {resp.status_code}: {body}", conn=conn)
        print(f"[brain] POST /api/run HTTP {resp.status_code}: {body}")
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
