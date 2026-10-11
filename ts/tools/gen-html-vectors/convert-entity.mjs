// Converter: html/entity.go -> ts/src/html/entity.ts.
//
// The Go table `Entities` (map[string]string, name -> one or two code points)
// is copied mechanically. Every entry is written, in Go source order, as
//   name \x01 code points (lowercase hex, comma separated) \x02
// inside string chunks, which entity.ts joins and decodes into a Map on first
// use. The generated file is marked "do not edit".
//
// Usage (from ts/): node tools/gen-html-vectors/convert-entity.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const goPath = join(here, "../../../html/entity.go");
const tsPath = join(here, "../../src/html/entity.ts");
const pinPath = join(here, "../../UPSTREAM_PIN");

const BS = String.fromCharCode(92); // backslash

const goSrc = readFileSync(goPath, "utf8");
const lines = goSrc.split(/\r?\n/);

const start = lines.findIndex((l) => l.startsWith("var Entities = map[string]string{"));
if (start < 0) {
  throw new Error("var Entities not found in html/entity.go");
}
let end = -1;
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i] === "}") {
    end = i;
    break;
  }
}
if (end < 0) {
  throw new Error("end of Entities not found");
}

// Each entry line: tab, quoted name, colon, quoted value made of \uXXXX or \UXXXXXXXX escapes.
// A value is a sequence of \uXXXX / \UXXXXXXXX escapes and plain characters.
const entryRe = new RegExp(
  "^\\t\"([^\"]+)\":\\s+\"((?:" + BS + BS + "u[0-9A-Fa-f]{4}|" + BS + BS + "U[0-9A-Fa-f]{8}|[^\"" + BS + BS + "])+)\",$"
);
const escRe = new RegExp(BS + BS + "u([0-9A-Fa-f]{4})|" + BS + BS + "U([0-9A-Fa-f]{8})|([^" + BS + BS + "])", "g");

const entries = [];
const seen = new Set();
for (let i = start + 1; i < end; i++) {
  const m = entryRe.exec(lines[i]);
  if (m === null) {
    throw new Error("unexpected line in Entities at " + (i + 1) + ": " + lines[i]);
  }
  const name = m[1];
  if (seen.has(name)) {
    throw new Error("duplicate key " + name);
  }
  seen.add(name);
  const cps = [];
  for (const e of m[2].matchAll(escRe)) {
    if (e[1] !== undefined) {
      cps.push(Number.parseInt(e[1], 16));
    } else if (e[2] !== undefined) {
      cps.push(Number.parseInt(e[2], 16));
    } else {
      cps.push(e[3].codePointAt(0));
    }
  }
  entries.push([name, cps]);
}

// Chunk the data into string literals of 80 entries so the source has short lines.
const chunks = [];
for (let i = 0; i < entries.length; i += 80) {
  const part = entries.slice(i, i + 80).map(([name, cps]) => {
    return name + BS + "x01" + cps.map((c) => c.toString(16)).join(",") + BS + "x02";
  });
  chunks.push('  "' + part.join("") + '",');
}

const pin = readFileSync(pinPath, "utf8").trim().slice(0, 8);

const out = `// Ported from html/entity.go @ ${pin}
// Code generated from html/entity.go by tools/gen-html-vectors/convert-entity.mjs. DO NOT EDIT.
// To regenerate, run from ts/: node tools/gen-html-vectors/convert-entity.mjs
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: The Go table is a map literal. Here it is stored as string data that is
// decoded into a Map on first use, because a literal of about 2,100 entries is slow
// to load and object keys have prototype hazards. Entity names contain only ASCII
// letters, digits and ';', so the separators \\x01 and \\x02 never clash with a name.

import * as conv from "../runtime/conv.ts";

// Entities lists all HTML entities, generated from https://html.spec.whatwg.org/entities.json.
// entityData holds the entries of Entities in Go source order, each as
// name \\x01 code points (lowercase hex, comma separated) \\x02.
const entityData: string = [
${chunks.join("\n")}
].join("");

let entities: Map<string, string> | null = null;

// entityMap returns the decoded Entities table: name -> string (one or two code
// points). It is built once, on first use.
export function entityMap(): Map<string, string> {
  if (entities !== null) {
    return entities;
  }
  const m = new Map<string, string>();
  for (const entry of entityData.split("\\x02")) {
    if (entry === "") {
      continue;
    }
    const sep = entry.indexOf("\\x01");
    const name = entry.slice(0, sep);
    let v = "";
    for (const cp of entry.slice(sep + 1).split(",")) {
      v += conv.StringFromRune(Number.parseInt(cp, 16));
    }
    m.set(name, v);
  }
  entities = m;
  return m;
}

// lookupEntity returns Entities[name] of html/entity.go, or "" when name is not a
// key. Go's zero value for a missing key is "", and no value of the table is empty,
// so Go's "x, ok := Entities[name]" is written as "x = lookupEntity(name)" with a
// test for x !== "".
export function lookupEntity(name: string): string {
  const v = entityMap().get(name);
  return v === undefined ? "" : v;
}
`;

writeFileSync(tsPath, out);
console.log("entries:", entries.length, "written:", tsPath);
const withSemi = entries.filter(([n]) => n.endsWith(";")).length;
console.log("names ending with ';':", withSemi, "without:", entries.length - withSemi);
console.log("two-code-point values:", entries.filter(([, c]) => c.length > 1).length);
