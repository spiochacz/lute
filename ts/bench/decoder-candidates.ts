// Compares the offset-based decoder designs on the CJK and ASCII inputs:
// (0) the current DecodeRune(subarray) API and (b) DecodeRunePacked. A tuple
// design (DecodeRuneAt) was also measured: CJK 11367 ns/KB, ASCII 18209 ns/KB, and
// it allocated per rune (GC inside the allocation window), so it was dropped.
// Each op is one pass over the whole text, decoding one rune at a time.
// Run: node --expose-gc --max-semi-space-size=256 bench/decoder-candidates.ts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as utf8 from "../src/runtime/utf8.ts";
import { allocBytesPerOp, bench } from "./lib/micro.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const readme = readFileSync(`${ROOT}README.md`, "utf8");
const cjk = readme.repeat(Math.ceil((200 * 1024) / Buffer.byteLength(readme)));
const ascii = readFileSync(`${ROOT}benchmark/commonmark-spec.md`, "utf8");

const inputs: [string, string][] = [
  ["ASCII", ascii],
  ["CJK", cjk],
];

for (const [name, text] of inputs) {
  const b = new TextEncoder().encode(text);
  const kb = b.length / 1024;
  const cands: [string, () => number][] = [
    [
      "(0) DecodeRune(subarray)",
      () => {
        let i = 0;
        let c = 0;
        while (i < b.length) {
          const [r, w] = utf8.DecodeRune(b.subarray(i));
          c += r;
          i += w;
        }
        return c;
      },
    ],
    [
      "(b) DecodeRunePacked",
      () => {
        let i = 0;
        let c = 0;
        while (i < b.length) {
          const v = utf8.DecodeRunePacked(b, i);
          c += v & 0xffffff;
          i += v >>> 24;
        }
        return c;
      },
    ],
  ];
  for (const [label, fn] of cands) {
    const r = await bench(fn, { unit: "KB", unitsPerOp: kb });
    const a = await allocBytesPerOp(fn, 64);
    console.log(
      `${name.padEnd(5)} ${label.padEnd(26)} ${(r.nsPerUnitMedian).toFixed(0).padStart(9)} ns/KB  ` +
        `min ${(r.nsPerOpMin / kb).toFixed(0).padStart(9)} ns/KB  B/pass ${a.bytesPerOp === null ? "GC" : a.bytesPerOp.toFixed(0)}`,
    );
  }
}
