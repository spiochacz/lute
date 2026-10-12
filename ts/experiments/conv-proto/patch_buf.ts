// Patches runtime/bytes.ts of a variant copy so that Buffer.String() decodes through conv.StringFromBytes (the fatal TextDecoder path with
// the short-ASCII fast path and, in a patched conv, the interning cache) instead of its own utf8.Valid + non-fatal decode. Same value:
// both give Go's string(b) (per-byte U+FFFD for invalid bytes). DomText, DomTexhtml, domCode and the footnote re-render use Buffer.String.
// Usage: node patch_buf.ts <variant dir>
import { readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2];
const path = `${dir}/src/runtime/bytes.ts`;
let s = readFileSync(path, "utf8");
const old = `  String(): string {
    const b = this.Bytes();
    if (utf8.Valid(b)) {
      return textDecoder.decode(b);
    }
    let out = "";
    for (let i = 0; i < b.length; ) {
      const v = utf8.DecodeRunePacked(b, i);
      out += String.fromCodePoint(v & 0xffffff);
      const w = v >>> 24;
      i += w;
    }
    return out;
  }`;
if (!s.includes(old)) {
  throw new Error("Buffer.String not found as expected");
}
s = s.replace(old, `  String(): string {
    return StringFromBytes(this.Bytes());
  }`);
s = s.replace(`import * as utf8 from "./utf8.ts";`, `import * as utf8 from "./utf8.ts";\nimport { StringFromBytes } from "./conv.ts";`);
writeFileSync(path, s);
console.log(`patched ${path}`);
