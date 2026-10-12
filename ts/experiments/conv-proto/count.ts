// Counts the string <-> bytes conversions of one engine call (tasks/007): calls and bytes of conv.BytesFromString and
// conv.StringFromBytes by call site, plus bytes.Buffer.WriteString / Buffer.String (the DomText round trip) and the attribute values
// that are decoded against the ones that are read. Counts are not affected by the machine's speed.
// Requires the "count" variant (a copy of ts/src whose runtime/conv.ts exports `stats`, see mkvariants.sh).
// Usage: VARIANT=<dir of the count variant> node count.ts <method> <fixture html file>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const variant = process.env.VARIANT;
if (!variant) {
  throw new Error("VARIANT=<dir> is required");
}
const [method, file] = process.argv.slice(2);
const root = pathToFileURL(variant.replace(/\\/g, "/")).href;
const lute_ = await import(`${root}/src/index.ts`);
const conv = await import(`${root}/src/runtime/conv.ts`);
const bytes = await import(`${root}/src/runtime/bytes.ts`);
const token = await import(`${root}/src/html/token.ts`);

const input = readFileSync(file, "utf8");
const lute = lute_.New();
lute.SetIncrementalDom2Md(false);

// Buffer round trips: WriteString (string -> bytes) and String (bytes -> string).
const buf = { writeStringCalls: 0, writeStringUnits: 0, stringCalls: 0, stringBytes: 0 };
const B = bytes.Buffer.prototype;
const origWS = B.WriteString;
const origStr = B.String;
B.WriteString = function (s: string): number {
  buf.writeStringCalls++;
  buf.writeStringUnits += s.length;
  return origWS.call(this, s);
};
B.String = function (): string {
  buf.stringCalls++;
  buf.stringBytes += this.Len();
  return origStr.call(this);
};

// Attribute values: how many are created by the tokenizer against how many are ever read (Attribute.Val is a counting accessor in
// the count variant; a prototype accessor from outside does not work, because Node's type stripping keeps `Val;` as an own field).
const attr = token.attrStats as { created: number; reads: number; readDistinct: number; reset(): void };

// Warm-up call so that the counted call is a steady-state one (the counts do not depend on it, but caches in the engine might).
(lute as unknown as Record<string, (s: string) => string>)[method](input);
conv.stats.start();
conv.stats.reset();
buf.writeStringCalls = buf.writeStringUnits = buf.stringCalls = buf.stringBytes = 0;
attr.reset();
const out = (lute as unknown as Record<string, (s: string) => string>)[method](input);
const s = conv.stats.snapshot();
console.log(
  JSON.stringify(
    { method, file, inputChars: input.length, outputChars: out.length, conv: s, buffer: buf, attr: { created: attr.created, reads: attr.reads, readDistinct: attr.readDistinct } },
    null,
    1,
  ),
);
