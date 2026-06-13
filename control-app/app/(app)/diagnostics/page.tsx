import { getSetting } from "@/lib/db";
import { toWIB } from "@/lib/time";
import { isDryRun } from "@/lib/ewelink";
import { testEwelinkAction, testAgrihubAction } from "./actions";
import { SubmitButton } from "../../submit-button";

export const dynamic = "force-dynamic";

function parseJson(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function ResultBox({ data }: { data: any }) {
  if (!data) return <p className="muted">Belum pernah dites.</p>;
  const ok = data.ok;
  return (
    <div>
      <span className={`badge ${ok ? "on" : "off"}`} style={ok ? {} : { color: "var(--danger)" }}>
        {ok ? "OK" : "GAGAL"}
      </span>{" "}
      <span className="muted">{toWIB(data.ts)}</span>
      <pre
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 10,
          marginTop: 8,
          overflowX: "auto",
          fontSize: 12,
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default function DiagnosticsPage() {
  const ew = parseJson(getSetting("diag_ewelink_last"));
  const ag = parseJson(getSetting("diag_agrihub_last"));

  return (
    <>
      <div className="panel">
        <h1>Diagnostics</h1>
        <p className="muted">
          Uji tiap komponen tanpa menjalankan penyiraman. (Untuk jadwal: pakai tombol
          <b> Run now</b> di Dashboard — pipeline-nya sama persis — dan lihat hasil tiap tahap di
          halaman <b>Logs</b>.)
        </p>
      </div>

      <div className="panel">
        <h2>1. eWeLink / Sonoff</h2>
        <p className="muted">
          Memanggil <code>getDevices</code> asli (read-only, tidak menggerakkan relay). Perlu
          kredensial eWeLink di <code>.env</code>. Aman walau DRY-RUN ({isDryRun() ? "aktif" : "nonaktif"}).
        </p>
        <form action={testEwelinkAction}>
          <SubmitButton pendingText="Testing eWeLink…">▶ Test eWeLink</SubmitButton>
        </form>
        <div style={{ marginTop: 12 }}>
          <ResultBox data={ew} />
        </div>
      </div>

      <div className="panel">
        <h2>2. Fetch agrihub + pemetaan channel</h2>
        <p className="muted">
          Menjalankan <code>brain.py --test</code>: ambil data 2 device_id, terapkan pemetaan
          channel, hitung ET0 &amp; durasi fuzzy. Menampilkan hasil atau error di tahap mana.
        </p>
        <form action={testAgrihubAction}>
          <SubmitButton pendingText="Testing agrihub…">▶ Test agrihub</SubmitButton>
        </form>
        <div style={{ marginTop: 12 }}>
          <ResultBox data={ag} />
        </div>
      </div>
    </>
  );
}
