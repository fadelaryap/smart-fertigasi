import { getDb } from "@/lib/db";
import { updateDevice } from "./actions";

export const dynamic = "force-dynamic";

interface DeviceRow {
  id: number;
  role: string;
  device_id: string;
  channel: number;
  label: string | null;
  enabled: number;
}

export default function DevicesPage() {
  const rows = getDb()
    .prepare("SELECT id, role, device_id, channel, label, enabled FROM device_config ORDER BY id")
    .all() as DeviceRow[];

  return (
    <div className="panel">
      <h1>Konfigurasi device</h1>
      <p className="muted">
        Sonoff 4CHPROR3. Valve = Device 1 (ch1 &amp; ch2), Pompa = Device 2 (ch1). Isi
        device_id asli dari hasil <code>/api/device/list</code>.
      </p>
      {rows.map((r) => (
        <form
          key={r.id}
          action={updateDevice}
          className="panel"
          style={{ background: "var(--bg)" }}
        >
          <input type="hidden" name="id" value={r.id} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "90px 1fr 80px 1fr auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <label>Role</label>
              <input value={r.role} disabled />
            </div>
            <div>
              <label>device_id</label>
              <input name="device_id" defaultValue={r.device_id} />
            </div>
            <div>
              <label>Channel</label>
              <input name="channel" type="number" defaultValue={r.channel} />
            </div>
            <div>
              <label>Label</label>
              <input name="label" defaultValue={r.label ?? ""} />
            </div>
            <div>
              <label>
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={!!r.enabled}
                  style={{ width: "auto", marginRight: 6 }}
                />
                enabled
              </label>
              <button type="submit" style={{ marginTop: 6 }}>
                Simpan
              </button>
            </div>
          </div>
        </form>
      ))}
    </div>
  );
}
