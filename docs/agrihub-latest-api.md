# Agrihub — 1 endpoint "latest" untuk sistem fertigasi

Referensi untuk **repo agrihub.id** (Next.js App Router + Supabase). **Satu** endpoint yang
mengembalikan **channel mentah `s0, s1, … s30`** dari baris telemetry terakhir sebuah device.
Pemilih device = **`device_id`** (id di `telemetry_data` Supabase).

```
GET https://agrihub.id/api/data/latest?device_id=<DEVICE_ID>
```

Contoh respons (key dinamis, sebanyak channel yang ada di device):
```json
{ "s0": 12.4, "s1": 30.1, "s2": 65.2, "s3": 1.4, "ts": "2026-06-12T10:00:00Z" }
```

brain.py memanggil endpoint yang **sama** dua kali, beda `device_id` (weather & soil); pemetaan
`s?` → temp/rh/wind/radiation dan pemilihan channel soil dilakukan di **Settings fertigasi**.

> ⚠️ **`device_id` di sini ≠ `device_id` eWeLink/Sonoff.** Ini id device telemetry agrihub.

---

## 1. Supabase client — pakai ANON key (bukan service-role)

`telemetry_data` kamu punya policy **SELECT untuk PUBLIC**, jadi **anon boleh baca** — **tidak
perlu** service-role. Cukup anon key yang sudah ada (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Tidak ada
env baru, tidak perlu `admin.ts`.

Untuk route server (tanpa sesi login), bikin client anon sederhana:

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);
```

> Boleh juga pakai `createClient` dari `lib/supabase/client.ts` yang sudah ada — untuk baca data
> PUBLIC ini hasilnya sama. (Tidak pakai `server.ts`, karena itu butuh cookie/sesi login.)

## 2. Environment variables (Vercel)

Tidak ada yang baru — pakai yang sudah ada:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## 3. Route — `app/api/data/latest/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

const CHANNEL_RE = /^s\d+$/; // s0, s1, ... s30

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get("device_id");
  if (!deviceId) {
    return NextResponse.json({ error: "device_id required" }, { status: 400 });
  }

  // Baris telemetry TERAKHIR untuk device ini (telemetry_data: SELECT PUBLIC).
  const { data: rows, error } = await supabase
    .from("telemetry_data")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ error: "no data" }, { status: 404 });
  const latest = rows[0] as Record<string, any>;

  // (OPSIONAL) kalibrasi — hanya jalan kalau device_sensor_configs juga punya
  // policy SELECT untuk anon/public. Kalau tidak, configs = [] → nilai mentah.
  const { data: configs } = await supabase
    .from("device_sensor_configs")
    .select("sensor_key, calibration_a, calibration_b")
    .eq("device_id", deviceId);
  const cal: Record<string, { a: number; b: number }> = {};
  for (const c of configs ?? []) {
    cal[c.sensor_key] = { a: c.calibration_a ?? 1, b: c.calibration_b ?? 0 };
  }

  // Susun { s0, s1, ... } dari kolom s-* ; kalibrasi linear a*raw+b bila ada.
  const out: Record<string, number | string | null> = {};
  for (const key of Object.keys(latest)) {
    if (!CHANNEL_RE.test(key)) continue;
    const raw = latest[key];
    out[key] =
      typeof raw === "number"
        ? cal[key]
          ? raw * cal[key].a + cal[key].b
          : raw
        : raw ?? null;
  }
  out.ts = latest.created_at;
  return NextResponse.json(out);
}
```

## 4. Policy Supabase (RLS) yang dibutuhkan

| Tabel | Policy | Wajib? |
|---|---|---|
| `telemetry_data` | `SELECT` untuk **anon/public** | ✅ (kamu sudah punya) |
| `device_sensor_configs` | `SELECT` untuk **anon/public** | Hanya kalau **butuh kalibrasi** |
| `devices` | — | ❌ tidak perlu (handler tak query `devices`) |

Kalau `device_sensor_configs` belum di-allow, handler tetap jalan tapi kembalikan **nilai mentah**.

## 5. Kalibrasi — mentah vs jadi

- Pakai rumus linear `a*raw + b`. **Cocokkan dengan dashboard** (`AnimatedDeviceDetailPage`).
- Kalau `telemetry_data` **sudah** simpan nilai terkalibrasi, atau kamu mau **mentah**: hapus blok
  kalibrasi → `out[key] = raw` (dan tak perlu policy `device_sensor_configs`).
- `sensor_alias_rules` tidak dipakai di sini (itu untuk label tampilan).

## 6. Keamanan

`device_id` muncul di URL dashboard (`/dashboard/devices/{deviceId}`) = **bukan rahasia**, dan
anon key bersifat publik + policy PUBLIC → **telemetry bisa dibaca siapa pun** yang tahu device_id.
Untuk data sensor ini kamu sudah memilih tanpa proteksi tambahan — cukup sadar saja. (Kalau suatu
saat mau dibatasi, bisa pakai header secret + cek di route, atau RLS yang lebih ketat + service-role.)

## 7. Kaitan ke sisi fertigasi

- Settings fertigasi: `agrihub_base_url = https://agrihub.id`, `agrihub_weather_device_id`,
  `agrihub_soil_device_id`, + pemetaan channel (dropdown weather & checkbox soil).
- brain.py: `GET <base>/api/data/latest?device_id=<id>` untuk weather & soil, lalu terapkan pemetaan.

## 8. Uji cepat

```bash
curl "https://agrihub.id/api/data/latest?device_id=<DEVICE_ID>"
# device_id salah/ kosong -> 400/404
```
