// Micro measurement of the bytes.Buffer.String() round trip (DomText, DomTexhtml, domCode): records every byte array that Buffer.String()
// decodes during one engine call, then times the current implementation (utf8.Valid + non-fatal TextDecoder) against decoding through
// conv.StringFromBytes (fatal decoder, short-ASCII fast path) and against the cached variant's conv, with equality checked.
// Usage: VARIANT=<count variant dir> CACHED=<rt variant dir> node buf_micro.ts <method> <fixture html file>
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const variant = process.env.VARIANT;
const cached = process.env.CACHED;
if (!variant || !cached) {
  throw new Error("VARIANT and CACHED are required");
}
const [method, file] = process.argv.slice(2);
const root = pathToFileURL(variant.replace(/\\/g, "/")).href;
const lute_ = await import(`${root}/src/index.ts`);
const conv = await import(`${root}/src/runtime/conv.ts`);
const bytes = await import(`${root}/src/runtime/bytes.ts`);
const convCached = await import(`${pathToFileURL(cached.replace(/\\/g, "/")).href}/src/runtime/conv.ts`);
const input = readFileSync(file, "utf8");
const lute = lute_.New();
lute.SetIncrementalDom2Md(false);
const call = (lute as unknown as Record<string, (s: string) => string>)[method].bind(lute) as (s: string) => string;

const rec: Uint8Array[] = [];
let on = false;
const B = bytes.Buffer.prototype;
const origStr = B.String as () => string;
B.String = function (this: { Bytes(): Uint8Array }): string {
  if (on) {
    rec.push(this.Bytes().slice());
  }
  return origStr.call(this);
};
call(input);
on = true;
call(input);
on = false;
B.String = origStr;

const canary = (): number => {
  const t = performance.now();
  let x = 1;
  for (let i = 0; i < 6000000; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
  }
  return performance.now() - t + (x & 0);
};
canary();
const c0 = Math.min(canary(), canary());

const current = (b: Uint8Array): string => {
  const buf = new bytes.Buffer(b);
  return buf.String();
};
const viaConv = (b: Uint8Array): string => conv.StringFromBytes(b);
const viaCached = (b: Uint8Array): string => convCached.StringFromBytes(b);
for (const b of rec) {
  if (current(b) !== viaConv(b) || current(b) !== viaCached(b)) {
    throw new Error("output differs");
  }
}
let sink = 0;
const best: Record<string, number> = {};
const cands: Array<[string, (b: Uint8Array) => string]> = [
  ["Buffer.String current (utf8.Valid + decode)", current],
  ["conv.StringFromBytes (fatal decoder, apply<=32)", viaConv],
  ["cached conv.StringFromBytes (rt variant)", viaCached],
];
for (let r = 0; r < 7; r++) {
  for (const [name, f] of cands) {
    const t = performance.now();
    for (let i = 0; i < rec.length; i++) {
      sink += f(rec[i]).length;
    }
    const d = performance.now() - t;
    best[name] = Math.min(best[name] ?? Infinity, d);
  }
}
const c1 = Math.min(canary(), canary());
let total = 0;
let short = 0;
for (const b of rec) {
  total += b.length;
  if (b.length <= 32) {
    short++;
  }
}
console.log(JSON.stringify({ method, file: file.split(/[\\/]/).pop(), calls: rec.length, bytes: total, shortCalls: short, canary: +(c1 / c0).toFixed(2), canaryMs: +c0.toFixed(1), sink: sink & 0 }));
for (const [name] of cands) {
  console.log(`${name.padEnd(50)} ${best[name].toFixed(3).padStart(8)} ms`);
}
