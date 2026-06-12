// Apply db/schema.sql to the SQLite database. Idempotent (CREATE TABLE IF NOT EXISTS).
import fs from "node:fs";
import path from "node:path";
import { loadEnv, openDb, repoRoot, resolveDbPath } from "./util.mjs";

loadEnv();

const schemaPath = path.join(repoRoot, "db", "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf8");

const db = openDb();
db.exec(schema);

console.log(`✅ Migrated: ${resolveDbPath()}`);
console.log(`   journal_mode = ${db.pragma("journal_mode", { simple: true })}`);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name)
  .filter((n) => !n.startsWith("sqlite_"));
console.log(`   tables: ${tables.join(", ")}`);
db.close();
