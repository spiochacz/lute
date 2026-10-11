// Extracts the `var X = []parseTest{ {"name", "from", "to"}, ... }` (and []*parseTest) tables of the given
// Go test files (relative to the repo's test/ directory) into ts/test/go/cases/<file>.json: { "<varName>": [[name, from, to], ...] }.
// Go string literals (interpreted with \n \t \" \ \uXXXX \xNN \UXXXXXXXX, raw backtick) are decoded here; "a" + "b" is concatenated.
// Run from ts/: node tools/go-tests/extract-tables-s.mjs sanitizer_test.go setext_test.go ...
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const testDir = new URL("../../../test/", import.meta.url);
const outDir = new URL("../../test/go/cases/", import.meta.url);
mkdirSync(outDir, { recursive: true });

function decode(s) {
  const bytes = [];
  const enc = new TextEncoder();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      for (const b of enc.encode(String.fromCodePoint(s.codePointAt(i)))) bytes.push(b);
      if (s.codePointAt(i) > 0xffff) i++;
      continue;
    }
    const d = s[++i];
    const simple = { n: 10, t: 9, r: 13, "\\": 92, '"': 34, "'": 39, a: 7, b: 8, f: 12, v: 11 };
    if (d in simple) bytes.push(simple[d]);
    else if (d === "x") { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else if (d === "u") { for (const b of enc.encode(String.fromCodePoint(parseInt(s.slice(i + 1, i + 5), 16)))) bytes.push(b); i += 4; }
    else if (d === "U") { for (const b of enc.encode(String.fromCodePoint(parseInt(s.slice(i + 1, i + 9), 16)))) bytes.push(b); i += 8; }
    else throw new Error("unsupported escape \\" + d);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
}

// Tokenizer over a Go source text: yields {k:'str',v}, {k:'p',v:'{'|'}'|','|'+'|...}, {k:'id',v}.
function* tokens(text, start) {
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i) + 2; continue; }
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') { if (text[j] === "\\") j++; j++; }
      yield { k: "str", v: decode(text.slice(i + 1, j)) };
      i = j + 1; continue;
    }
    if (c === "`") {
      const j = text.indexOf("`", i + 1);
      yield { k: "str", v: text.slice(i + 1, j).replace(/\r/g, "") };
      i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (/[A-Za-z0-9_.]/.test(text[j])) j++; yield { k: "id", v: text.slice(i, j) }; i = j; continue; }
    yield { k: "p", v: c };
    i++;
  }
}

for (const file of process.argv.slice(2)) {
  const text = readFileSync(new URL(file, testDir), "utf8");
  const out = {};
  const re = /^var (\w+) = \[\]\*?parseTest ?\{/gm;
  let m;
  while ((m = re.exec(text))) {
    const rows = [];
    let depth = 1, row = null, cur = null;
    for (const t of tokens(text, re.lastIndex)) {
      if (t.k === "p" && t.v === "{") { depth++; if (depth === 2) { row = []; cur = null; } continue; }
      if (t.k === "p" && t.v === "}") {
        if (depth === 2) { if (cur !== null) row.push(cur); rows.push(row); row = null; }
        depth--; if (depth === 0) break; continue;
      }
      if (depth !== 2) continue;
      if (t.k === "str") cur = (cur ?? "") + t.v;
      else if (t.k === "p" && t.v === "+") continue;
      else if (t.k === "p" && t.v === ",") { if (cur !== null) row.push(cur); cur = null; }
      else throw new Error(`${file} ${m[1]}: unexpected token ${JSON.stringify(t)}`);
    }
    out[m[1]] = rows;
    console.log(file, m[1], rows.length);
  }
  writeFileSync(new URL(file.replace(/\.go$/, ".json"), outDir), JSON.stringify(out, null, 1));
}
