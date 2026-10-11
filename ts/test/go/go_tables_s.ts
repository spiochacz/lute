// Helper of the ported Go tests in this directory: reads the tables that tools/go-tests/extract-tables-s.mjs decoded from the Go sources.
// Each row is [name, from, to].
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Row = [name: string, from: string, to: string];

const cache = new Map<string, Record<string, Row[]>>();

export function goTable(file: string, varName: string, expectedRows: number): Row[] {
  let data = cache.get(file);
  if (data === undefined) {
    data = JSON.parse(readFileSync(fileURLToPath(new URL(`./cases/${file}.json`, import.meta.url)), "utf8")) as Record<string, Row[]>;
    cache.set(file, data);
  }
  const rows = data[varName];
  if (rows === undefined) {
    throw new Error(`table ${varName} not found in ${file}`);
  }
  if (rows.length !== expectedRows) {
    throw new Error(`table ${varName}: expected ${expectedRows} rows, got ${rows.length}`);
  }
  return rows;
}
