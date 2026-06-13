#!/usr/bin/env python3
"""Brain: fetch agrihub sensors -> fuzzy -> duration -> POST /api/run.

Usage:
  python brain.py [schedule|manual] [--dry]

  --dry         decide only: print the decision, do NOT POST / write DB / notify.

Flow:
  1. Build the fuzzy controller from the DB fuzzy_config row (rebuilt every run,
     so UI changes take effect without code changes).
  2. Read sensors from agrihub, soil_moisture = avg(s0, s1, s2).
  3. duration = controller.compute(...).
  4. duration == 0 -> log 'skipped' + Telegram skip notice -> done.
  5. duration  > 0 -> POST /api/run to the Control App (which runs the ON sequence).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

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


def _channel(data: dict, channel: str, label: str) -> float:
    if not channel:
        raise RuntimeError(f"channel untuk '{label}' belum dipetakan di settings.")
    if channel not in data:
        raise RuntimeError(f"{label}: channel '{channel}' tidak ada di respons agrihub.")
    return float(data[channel])


def read_sensors(conn) -> dict:
    base = (db.get_setting(conn, "agrihub_base_url") or "").rstrip("/")
    if not base:
        raise RuntimeError("agrihub_base_url belum diatur di settings.")

    weather = fetch_latest(base, db.get_setting(conn, "agrihub_weather_device_id") or "")
    soil = fetch_latest(base, db.get_setting(conn, "agrihub_soil_device_id") or "")

    temp = _channel(weather, db.get_setting(conn, "weather_temp_channel") or "", "temperature")
    rh = _channel(weather, db.get_setting(conn, "weather_rh_channel") or "", "relative_humidity")
    wind = _channel(weather, db.get_setting(conn, "weather_wind_channel") or "", "wind_speed")
    rad = _channel(weather, db.get_setting(conn, "weather_radiation_channel") or "", "solar_radiation")

    soil_channels = [c.strip() for c in (db.get_setting(conn, "soil_channels") or "").split(",") if c.strip()]
    if not soil_channels:
        raise RuntimeError("soil_channels belum dipilih di settings.")
    soil_vals = [_channel(soil, c, f"soil {c}") for c in soil_channels]
    soil_moisture = sum(soil_vals) / len(soil_vals)

    return {
        "temperature": temp, "relative_humidity": rh, "wind_speed": wind,
        "solar_radiation": rad, "soil_moisture": soil_moisture,
        "soil_channels": soil_channels, "weather_raw": weather, "soil_raw": soil,
    }
# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Fertigation brain")
    parser.add_argument("triggered_by", nargs="?", default="manual",
                        choices=["schedule", "manual"])
    parser.add_argument("--dry", action="store_true",
                        help="decide only; no POST / DB write / notify")
    parser.add_argument("--test", action="store_true",
                        help="print sensor+fuzzy result as one JSON line (diagnostics UI)")
    args = parser.parse_args()

    db.load_env()
    conn = db.connect()
    try:
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
