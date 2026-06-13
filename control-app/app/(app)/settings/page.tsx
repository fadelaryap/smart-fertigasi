import { getDb } from "@/lib/db";
import { toWIB } from "@/lib/time";
import { SubmitButton } from "../../submit-button";
import { updateSettings } from "./actions";

export const dynamic = "force-dynamic";

function useSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
}

function Field({
  name,
  label,
  value,
  type = "text",
  hint,
}: {
  name: string;
  label: string;
  value: string;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} defaultValue={value} />
      {hint && (
        <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

const CHANNELS = Array.from({ length: 30 }, (_, i) => `s${i + 1}`); // s1..s30

function ChannelSelect({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value?: string;
}) {
  return (
    <div>
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={value || ""}>
        <option value="">— pilih —</option>
        {CHANNELS.map((ch) => (
          <option key={ch} value={ch}>
            {ch}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function SettingsPage() {
  const s = useSettings();
  const soilSet = new Set(
    (s.soil_channels || "").split(",").map((x) => x.trim()).filter(Boolean)
  );

  return (
    <>
      <form action={updateSettings} className="panel">
      <h1>Settings</h1>

      <div className="panel" style={{ background: "var(--bg)" }}>
        <h3>agrihub.id — sumber data</h3>
        <Field name="agrihub_base_url" label="Base URL" value={s.agrihub_base_url ?? ""} hint="mis. https://agrihub.id" />
        <Field name="agrihub_weather_device_id" label="Weather device_id (telemetry agrihub)" value={s.agrihub_weather_device_id ?? ""} hint="device_id telemetry agrihub — BUKAN device_id eWeLink." />
        <Field name="agrihub_soil_device_id" label="Soil device_id (telemetry agrihub)" value={s.agrihub_soil_device_id ?? ""} />
      </div>

      <div className="panel" style={{ background: "var(--bg)" }}>
        <h3>Pemetaan channel — Weather</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Pilih channel dari device weather untuk tiap parameter.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
          <ChannelSelect name="weather_temp_channel" label="Temperature" value={s.weather_temp_channel} />
          <ChannelSelect name="weather_rh_channel" label="Relative humidity" value={s.weather_rh_channel} />
          <ChannelSelect name="weather_wind_channel" label="Wind speed" value={s.weather_wind_channel} />
          <ChannelSelect name="weather_radiation_channel" label="Solar radiation" value={s.weather_radiation_channel} />
        </div>
      </div>

      <div className="panel" style={{ background: "var(--bg)" }}>
        <h3>Pemetaan channel — Soil (dinamis)</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Centang channel soil yang dirata-rata (boleh berapa saja).
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6 }}>
          {CHANNELS.map((ch) => (
            <label key={ch} style={{ display: "flex", alignItems: "center", gap: 4, margin: 0 }}>
              <input type="checkbox" name="soil_channels" value={ch} defaultChecked={soilSet.has(ch)} style={{ width: "auto" }} />
              {ch}
            </label>
          ))}
        </div>
      </div>

      <div className="panel" style={{ background: "var(--bg)" }}>
        <h3>Telegram</h3>
        <Field name="telegram_bot_token" label="Bot token" value={s.telegram_bot_token ?? ""} hint="Isi token → bot aktif menerima /subscribe & broadcast notif. Kosong = log-only." />
        <Field name="telegram_chat_id" label="Chat ID admin (opsional)" value={s.telegram_chat_id ?? ""} hint="Opsional — chat ini selalu menerima notif. User lain cukup kirim /subscribe ke bot." />
      </div>

      <div className="panel" style={{ background: "var(--bg)" }}>
        <h3>Timing &amp; safety</h3>
        <Field name="pump_delay_on_seconds" label="Pump delay ON (detik)" value={s.pump_delay_on_seconds ?? "7"} type="number" hint="Jeda valve→pompa (default 7)." />
        <Field name="pump_delay_off_seconds" label="Pump delay OFF (detik)" value={s.pump_delay_off_seconds ?? "0"} type="number" hint="Jeda pompa→valve saat mati (default 0)." />
        <Field name="safety_max_minutes" label="Safety cutoff (menit)" value={s.safety_max_minutes ?? "60"} type="number" hint="Cutoff absolut watchdog (default 60)." />
      </div>

      <SubmitButton pendingText="Menyimpan…">Simpan settings</SubmitButton>
      </form>

      <Subscribers />
    </>
  );
}

interface SubRow {
  chat_id: string;
  name: string | null;
  username: string | null;
  active: number;
  subscribed_at: string;
}

function Subscribers() {
  const subs = getDb()
    .prepare(
      "SELECT chat_id, name, username, active, subscribed_at FROM subscribers ORDER BY active DESC, subscribed_at DESC"
    )
    .all() as SubRow[];
  const activeCount = subs.filter((s) => s.active).length;

  return (
    <div className="panel">
      <h2>Subscriber Telegram ({activeCount} aktif)</h2>
      <p className="muted">
        Notifikasi di-broadcast ke semua subscriber aktif. User berlangganan dengan
        mengirim <code>/subscribe</code> ke bot (perlu bot token terisi di atas).
      </p>
      {subs.length === 0 ? (
        <p className="muted">Belum ada subscriber.</p>
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nama</th>
              <th>Username</th>
              <th>chat_id</th>
              <th>Status</th>
              <th>Sejak (WIB)</th>
            </tr>
          </thead>
          <tbody>
            {subs.map((sub) => (
              <tr key={sub.chat_id}>
                <td>{sub.name || "—"}</td>
                <td>{sub.username ? `@${sub.username}` : "—"}</td>
                <td>{sub.chat_id}</td>
                <td>
                  <span className={`badge ${sub.active ? "on" : "off"}`}>
                    {sub.active ? "aktif" : "berhenti"}
                  </span>
                </td>
                <td>{toWIB(sub.subscribed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
