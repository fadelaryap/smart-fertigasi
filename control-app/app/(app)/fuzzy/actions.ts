"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { nowIso } from "@/lib/time";
import { FUZZY_FIELDS } from "./fields";

export async function updateFuzzy(formData: FormData) {
  const values = FUZZY_FIELDS.map((f) => Number(formData.get(f)));
  if (values.some((v) => !Number.isFinite(v))) {
    revalidatePath("/fuzzy");
    return;
  }
  const setClause = FUZZY_FIELDS.map((f) => `${f}=?`).join(", ");
  getDb()
    .prepare(`UPDATE fuzzy_config SET ${setClause}, updated_at=? WHERE id=1`)
    .run(...values, nowIso());
  revalidatePath("/fuzzy");
}
