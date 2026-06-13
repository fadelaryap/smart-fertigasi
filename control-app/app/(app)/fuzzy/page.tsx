import { getDb } from "@/lib/db";
import { updateFuzzy } from "./actions";
import { FUZZY_FIELDS } from "./fields";
import { SubmitButton } from "../../submit-button";

export const dynamic = "force-dynamic";

const GROUPS: { title: string; note: string; fields: string[] }[] = [
  {
    title: "Soil moisture (%)",
    note: "dry / normal / wet membership breakpoints",
    fields: ["sdmin", "snmin", "sdmax", "swmin", "snmax", "swmax"],
  },
  {
    title: "ET0 (mm/jam)",
    note: "low / med / high membership breakpoints",
    fields: ["elmin", "emmin", "elmax", "ehmin", "emmax", "ehmax"],
  },
  {
    title: "Output durasi (menit)",
    note: "short / medium / long + output_max",
    fields: ["os", "om", "ol", "output_max"],
  },
];

export default function FuzzyPage() {
  const cfg = getDb().prepare("SELECT * FROM fuzzy_config WHERE id=1").get() as Record<
    string,
    number
  >;

  return (
    <form action={updateFuzzy} className="panel">
      <h1>Parameter Fuzzy</h1>
      <p className="muted">
        Dibaca ulang oleh brain.py tiap run — perubahan langsung berlaku tanpa restart.
      </p>
      {GROUPS.map((g) => (
        <div key={g.title} className="panel" style={{ background: "var(--bg)" }}>
          <h3 style={{ margin: "0 0 2px" }}>{g.title}</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            {g.note}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
              gap: 10,
            }}
          >
            {g.fields.map((f) => (
              <div key={f}>
                <label htmlFor={f}>{f}</label>
                <input
                  id={f}
                  name={f}
                  type="number"
                  step="any"
                  defaultValue={cfg[f]}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="muted">Total field: {FUZZY_FIELDS.length}</p>
      <SubmitButton pendingText="Menyimpan…">Simpan fuzzy config</SubmitButton>
    </form>
  );
}
