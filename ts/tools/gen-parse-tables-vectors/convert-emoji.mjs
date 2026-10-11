// One-off converter: parse/emoji_map.go -> ts/src/parse/emoji_map.ts.
//
// It reads the EmojiAliasUnicode map literal of emoji_map.go line by line (every entry
// is `"alias": "unicode",` with no escape sequences; the converter fails on anything else)
// and writes the entries, in source order, as ONE string literal
// `alias \x01 unicode \x02 alias \x01 unicode ...`. It also reports how many unicode values
// have more than one alias (the reverse map of Go's init() is not deterministic for those).
//
// Usage (from ts/): node tools/gen-parse-tables-vectors/convert-emoji.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const goPath = join(here, "../../../parse/emoji_map.go");
const tsPath = join(here, "../../src/parse/emoji_map.ts");
const pin = readFileSync(join(here, "../../UPSTREAM_PIN"), "utf8").trim().slice(0, 8);

const lines = readFileSync(goPath, "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith("var EmojiAliasUnicode = map[string]string{"));
if (start < 0) throw new Error("EmojiAliasUnicode literal not found");
const entries = [];
let closed = false;
for (let i = start + 1; i < lines.length; i++) {
  const line = lines[i];
  if (line === "}") { closed = true; break; }
  if (line.trim() === "" || line.trim().startsWith("//")) continue;
  const m = /^\t"([^"\\]*)":\s*"([^"\\]*)",$/.exec(line);
  if (!m || /[\x00-\x1f]/.test(m[1] + m[2])) throw new Error("unexpected line " + (i + 1) + ": " + line);
  entries.push([m[1], m[2]]);
}
if (!closed) throw new Error("map literal not closed");

const seen = new Set();
const byValue = new Map();
for (const [k, v] of entries) {
  if (seen.has(k)) throw new Error("duplicate alias " + k);
  seen.add(k);
  if (/[\x01\x02]/.test(k) || /[\x01\x02]/.test(v)) throw new Error("separator inside data: " + k);
  if (!byValue.has(v)) byValue.set(v, []);
  byValue.get(v).push(k);
}
const dupValues = [...byValue.values()].filter((a) => a.length > 1);

const data = entries.map(([k, v]) => k + "\x01" + v).join("\x02");
const literal = JSON.stringify(data);

const license = `// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.`;

const out = `// Ported from parse/emoji_map.go @ ${pin}
${license}

// GENERATED FILE, DO NOT EDIT.
// Generated from parse/emoji_map.go by ts/tools/gen-parse-tables-vectors/convert-emoji.mjs.
// To regenerate, run from ts/: node tools/gen-parse-tables-vectors/convert-emoji.mjs

import * as strings from "../runtime/strings.ts";

// PORT-NOTE: the ${entries.length} entries of Go's EmojiAliasUnicode in source order, as one string literal: alias \\x01 unicode, entries separated by \\x02.
// Neither separator occurs in the data (checked by the converter). Decoded into a Map on first use.
const emojiAliasUnicodeData = ${literal};

let emojiAliasUnicode: Map<string, string> | null = null;
let emojiUnicodeAlias: Map<string, string> | null = null;

// EmojiAliasUnicodeMap returns Go's EmojiAliasUnicode (alias -> unicode). The Map is built on the first call; every call returns the same object.
export function EmojiAliasUnicodeMap(): Map<string, string> {
  if (null === emojiAliasUnicode) {
    const m = new Map<string, string>();
    for (const entry of emojiAliasUnicodeData.split("\\x02")) {
      const sep = entry.indexOf("\\x01");
      m.set(entry.slice(0, sep), entry.slice(sep + 1));
    }
    emojiAliasUnicode = m;
  }
  return emojiAliasUnicode;
}

// EmojiUnicodeAliasMap returns Go's EmojiUnicodeAlias (unicode -> alias), built from EmojiAliasUnicode as Go's init() does. The Map is built on the first call; every call returns the same object.
export function EmojiUnicodeAliasMap(): Map<string, string> {
  if (null === emojiUnicodeAlias) {
    const m = new Map<string, string>();
    for (const [k, v] of EmojiAliasUnicodeMap()) {
      // PORT-NOTE: Go iterates the map in random order, so when several aliases share one unicode value the winner is not deterministic in Go.
      // ${dupValues.length} unicode values have more than one alias here; the first alias in source order is kept.
      if (!m.has(v)) {
        m.set(v, k);
      }
    }
    emojiUnicodeAlias = m;
  }
  return emojiUnicodeAlias;
}

export function IsEmoji(str: string): boolean {
  // PERF-TODO: iterates the whole alias table on every call, as Go does
  for (const v of EmojiAliasUnicodeMap().values()) {
    if (strings.HasPrefix(v, str)) {
      return true;
    }
  }
  return false;
}
`;
writeFileSync(tsPath, out);
console.log("entries:", entries.length);
console.log("unicode values with more than one alias:", dupValues.length);
for (const a of dupValues) console.log(JSON.stringify(a));
