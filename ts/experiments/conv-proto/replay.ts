// Ceiling measurement (tasks/007): how much of one engine call is the conversions themselves. One call is recorded (every input of
// conv.BytesFromString and conv.StringFromBytes, in order), then in the same short process the whole call and the replay of the
// recorded conversions alone are timed, interleaved, several times; the fastest of each is reported together with the canary.
// The replay is an upper bound of what removing those conversions can save (the real code also pays for the allocation of the results).
// Requires the "count" variant. Usage: VARIANT=<count variant dir> node replay.ts <method> <fixture html file>
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const variant = process.env.VARIANT;
if (!variant) {
  throw new Error("VARIANT=<dir> is required");
}
const [method, file] = process.argv.slice(2);
const root = pathToFileURL(variant.replace(/\\/g, "/")).href;
const lute_ = await import(`${root}/src/index.ts`);
const conv = await import(`${root}/src/runtime/conv.ts`);
const slices = await import(`${root}/src/runtime/slices.ts`);
const input = readFileSync(file, "utf8");
const lute = lute_.New();
lute.SetIncrementalDom2Md(false);
const call = (lute as unknown as Record<string, (s: string) => string>)[method].bind(lute) as (s: string) => string;

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

call(input);
call(input);
conv.recording.on = true;
conv.recording.enc.length = 0;
conv.recording.dec.length = 0;
call(input);
conv.recording.on = false;
const enc: string[] = conv.recording.enc.slice();
const dec: Uint8Array[] = conv.recording.dec.slice();
// the whole-document conversions: the biggest string encoded, the biggest array decoded
const bigEnc = enc.reduce((a, b) => (b.length > a.length ? b : a), "");
const bigDec = dec.reduce((a, b) => (b.length > a.length ? b : a), new Uint8Array(0));
const encRest = enc.filter((s) => s !== bigEnc);
const decRest = dec.filter((b) => b !== bigDec);

let sink = 0;
const timeMin = (f: () => void, reps: number): number => {
  let best = Infinity;
  for (let r = 0; r < reps; r++) {
    const t = performance.now();
    f();
    const d = performance.now() - t;
    if (d < best) {
      best = d;
    }
  }
  return best;
};
const results: Record<string, number> = {};
const tasks: Array<[string, () => void]> = [
  ["whole call", () => { sink += call(input).length; }],
  ["enc: whole document (ParseHTML)", () => { sink += conv.BytesFromString(bigEnc).length; }],
  ["enc: whole document + tokenizer clone", () => { sink += slices.Clone(conv.BytesFromString(bigEnc)).length; }],
  ["enc: all other BytesFromString", () => { for (let i = 0; i < encRest.length; i++) { sink += conv.BytesFromString(encRest[i]).length; } }],
  ["enc: short ones only (<= 64 units)", () => { for (let i = 0; i < encRest.length; i++) { if (encRest[i].length <= 64) { sink += conv.BytesFromString(encRest[i]).length; } } }],
  ["enc: long ones only (> 64 units)", () => { for (let i = 0; i < encRest.length; i++) { if (encRest[i].length > 64) { sink += conv.BytesFromString(encRest[i]).length; } } }],
  ["dec: result string", () => { sink += conv.StringFromBytes(bigDec).length; }],
  ["dec: all other StringFromBytes", () => { for (let i = 0; i < decRest.length; i++) { sink += conv.StringFromBytes(decRest[i]).length; } }],
  ["dec: short ones only (<= 32 bytes)", () => { for (let i = 0; i < decRest.length; i++) { if (decRest[i].length <= 32) { sink += conv.StringFromBytes(decRest[i]).length; } } }],
  ["dec: long ones only (> 32 bytes)", () => { for (let i = 0; i < decRest.length; i++) { if (decRest[i].length > 32) { sink += conv.StringFromBytes(decRest[i]).length; } } }],
];
// interleave: 5 rounds, each task once per round, fastest kept
for (let r = 0; r < 5; r++) {
  for (const [name, f] of tasks) {
    const t = timeMin(f, 1);
    results[name] = Math.min(results[name] ?? Infinity, t);
  }
}
const c1 = Math.min(canary(), canary());
const whole = results["whole call"];
const sizeHist = (xs: number[]): Record<string, number> => {
  const h: Record<string, number> = { "<=12": 0, "13-32": 0, "33-64": 0, "65-128": 0, "129-512": 0, ">512": 0 };
  for (const n of xs) {
    h[n <= 12 ? "<=12" : n <= 32 ? "13-32" : n <= 64 ? "33-64" : n <= 128 ? "65-128" : n <= 512 ? "129-512" : ">512"]++;
  }
  return h;
};
const startTags = (input.match(/<[a-zA-Z]/g) ?? []).length;
const endTags = (input.match(/<\/[a-zA-Z]/g) ?? []).length;
console.log(
  JSON.stringify({
    method,
    file: file.split(/[\\/]/).pop(),
    encCalls: enc.length,
    decCalls: dec.length,
    startTags,
    endTags,
    encSizes: sizeHist(encRest.map((s) => s.length)),
    decSizes: sizeHist(decRest.map((b) => b.length)),
    canary: +(c1 / c0).toFixed(2),
    canaryMs: +c0.toFixed(1),
    sink: sink & 0,
  }),
);
for (const [name] of tasks) {
  console.log(`${name.padEnd(42)} ${results[name].toFixed(3).padStart(9)} ms  ${((100 * results[name]) / whole).toFixed(1).padStart(5)} % of the call`);
}
