// Patches runtime/conv.ts of a variant copy: the original BytesFromString / StringFromBytes are renamed to *Orig and kept as the
// slow path; the new exported functions add (a) an interning cache for decodes of at most `decCacheMax` bytes, keyed by the FNV hash
// of the bytes and verified by a byte comparison (a hit returns the stored string, which is the same value Go's string(b) gives),
// (b) an ASCII check and a plain loop for encodes of at most `encLoopMax` code units (the current code stops at 64 and calls
// TextEncoder above). Both give the same values as the current code; candidates.ts checked that on the recorded inputs.
// Usage: node patch_conv.ts <variant dir> [--dec-cache=4096] [--dec-cache-max=32] [--enc-loop=256]
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const dir = args[0];
const opt = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const decCache = Number(opt("dec-cache") ?? 0);
const decCacheMax = Number(opt("dec-cache-max") ?? 32);
const encLoop = Number(opt("enc-loop") ?? 0);
const path = `${dir}/src/runtime/conv.ts`;
let s = readFileSync(path, "utf8");
if (s.includes("BytesFromStringOrig")) {
  throw new Error("already patched");
}
s = s.replace("export function BytesFromString(s: string): Uint8Array {", "function BytesFromStringOrig(s: string): Uint8Array {");
s = s.replace("export function StringFromBytes(b: Uint8Array): string {", "function StringFromBytesOrig(b: Uint8Array): string {");
let add = "\n// ---- conv-proto patch: dec-cache=" + decCache + " dec-cache-max=" + decCacheMax + " enc-loop=" + encLoop + " ----\n";
if (encLoop > 0) {
  add += `
export function BytesFromString(s: string): Uint8Array {
  if (typeof s === "string" && s.length <= ${encLoop}) {
    const n = s.length;
    const ret = new Uint8Array(n);
    let i = 0;
    for (; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x80) {
        break;
      }
      ret[i] = c;
    }
    if (i === n) {
      return ret;
    }
  }
  return BytesFromStringOrig(s);
}
`;
} else {
  add += "export const BytesFromString = BytesFromStringOrig;\n";
}
if (decCache > 0) {
  add += `
const cacheKeys: (Uint8Array | undefined)[] = new Array(${decCache});
const cacheVals: string[] = new Array(${decCache});
export function StringFromBytes(b: Uint8Array): string {
  const n = b.length;
  if (n > ${decCacheMax}) {
    return StringFromBytesOrig(b);
  }
  let h = 2166136261;
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ b[i], 16777619);
  }
  const k = (h >>> 0) & ${decCache - 1};
  const kb = cacheKeys[k];
  if (kb !== undefined && kb.length === n) {
    let eq = true;
    for (let i = 0; i < n; i++) {
      if (kb[i] !== b[i]) {
        eq = false;
        break;
      }
    }
    if (eq) {
      return cacheVals[k];
    }
  }
  const str = StringFromBytesOrig(b);
  cacheKeys[k] = b.slice();
  cacheVals[k] = str;
  return str;
}
`;
} else {
  add += "export const StringFromBytes = StringFromBytesOrig;\n";
}
writeFileSync(path, s + add);
console.log(`patched ${path}`);
