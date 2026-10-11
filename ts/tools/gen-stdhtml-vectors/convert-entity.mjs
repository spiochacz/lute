// Converter: Go 1.21 src/html/entity.go -> ts/src/runtime/stdhtml_entity.ts.
// The tables `entity` (name -> one rune) and `entity2` (name -> two runes) are copied
// mechanically as string data. Entry format: name \x01 hex code points (comma separated) \x02.
// Usage (from ts/): node tools/gen-stdhtml-vectors/convert-entity.mjs [path to entity.go]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const goPath = process.argv[2] ?? "C:/Users/SlawomirPiochacz/sdk/go1.21.13/src/html/entity.go";
const tsPath = join(here, "../../src/runtime/stdhtml_entity.ts");
const BS = String.fromCharCode(92);
const lines = readFileSync(goPath, "utf8").split(/\r?\n/);

function section(startLine) {
  const s = lines.findIndex((l) => l.trim() === startLine);
  if (s < 0) throw new Error("not found: " + startLine);
  const out = [];
  for (let i = s + 1; lines[i].trim() !== "}"; i++) {
    const t = lines[i].trim();
    if (t === "" || t.startsWith("//")) continue;
    out.push(t);
  }
  return out;
}
const hex = (re, s) => [...s.matchAll(re)].map((m) => m[1].toLowerCase());
const runeRe = new RegExp("'" + BS + BS + "[uU]([0-9A-Fa-f]+)'", "g");
function convert(entries, label) {
  const names = new Set();
  const parts = entries.map((t) => {
    const m = /^"([^"]+)":\s*(.*),$/.exec(t);
    if (m === null) throw new Error(label + ": bad line " + t);
    if (names.has(m[1])) throw new Error("dup " + m[1]);
    names.add(m[1]);
    const cps = hex(runeRe, m[2]).map((h) => Number.parseInt(h, 16).toString(16));
    return m[1] + BS + "x01" + cps.join(",") + BS + "x02";
  });
  const chunks = [];
  for (let i = 0; i < parts.length; i += 80) chunks.push('  "' + parts.slice(i, i + 80).join("") + '",');
  return { chunks, n: parts.length };
}
const e1 = convert(section("entity = map[string]rune{"), "entity");
const e2 = convert(section("entity2 = map[string][2]rune{"), "entity2");

const out = `// Code generated from Go 1.21 src/html/entity.go by tools/gen-stdhtml-vectors/convert-entity.mjs. DO NOT EDIT.
// Tables of the Go standard library package html (not Lute's fork in ../html): ${e1.n} single-rune
// entities and ${e2.n} two-rune entities. Each entry is name \x01 code points (hex, comma separated) \x02.

export const entityData: string = [
${e1.chunks.join("\n")}
].join("");

export const entity2Data: string = [
${e2.chunks.join("\n")}
].join("");
`;
writeFileSync(tsPath, out);
console.log("entity", e1.n, "entity2", e2.n);
