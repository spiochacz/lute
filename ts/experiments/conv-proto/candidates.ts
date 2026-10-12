// Candidate implementations of conv.StringFromBytes and conv.BytesFromString, timed over the inputs recorded from one real engine call
// (the "count" variant records them), with output equality against the current runtime checked for every input. Interleaved rounds,
// fastest kept, one short process. This is a micro measurement: a candidate that wins here must still be confirmed on whole calls (run.ts).
// Usage: VARIANT=<count variant dir> node candidates.ts <method> <fixture html file>
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
const input = readFileSync(file, "utf8");
const lute = lute_.New();
lute.SetIncrementalDom2Md(false);
const call = (lute as unknown as Record<string, (s: string) => string>)[method].bind(lute) as (s: string) => string;
call(input);
conv.recording.on = true;
call(input);
conv.recording.on = false;
const enc: string[] = conv.recording.enc.filter((s: string) => s.length < 100000);
const dec: Uint8Array[] = conv.recording.dec.filter((b: Uint8Array) => b.length < 100000);

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// ---- decode candidates ----
type Dec = (b: Uint8Array) => string;
const decCurrent: Dec = conv.StringFromBytes;
function decApply(max: number): Dec {
  return (b) => {
    const n = b.length;
    if (n <= max) {
      let ascii = true;
      for (let i = 0; i < n; i++) {
        if (b[i] >= 0x80) {
          ascii = false;
          break;
        }
      }
      if (ascii) {
        return String.fromCharCode.apply(null, b as unknown as number[]);
      }
    }
    return decoder.decode(b);
  };
}
// Latin-1 trick: TextDecoder("latin1") maps every byte to one code unit; for ASCII input the result equals the UTF-8 decode.
const latin1 = new TextDecoder("latin1");
function decLatin1(max: number): Dec {
  return (b) => {
    const n = b.length;
    if (n <= max) {
      let ascii = true;
      for (let i = 0; i < n; i++) {
        if (b[i] >= 0x80) {
          ascii = false;
          break;
        }
      }
      if (ascii) {
        return latin1.decode(b);
      }
    }
    return decoder.decode(b);
  };
}
// concatenation by chunks of 8 (no apply), ASCII only
function decLoop(max: number): Dec {
  return (b) => {
    const n = b.length;
    if (n <= max) {
      let ascii = true;
      for (let i = 0; i < n; i++) {
        if (b[i] >= 0x80) {
          ascii = false;
          break;
        }
      }
      if (ascii) {
        let s = "";
        let i = 0;
        for (; i + 4 <= n; i += 4) {
          s += String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
        }
        for (; i < n; i++) {
          s += String.fromCharCode(b[i]);
        }
        return s;
      }
    }
    return decoder.decode(b);
  };
}
// cache of short results keyed by the FNV hash of the bytes (interning): a hit returns the stored string after a byte comparison
function decCached(max: number, slots: number): Dec {
  const keys: Uint8Array[] = new Array(slots);
  const vals: string[] = new Array(slots);
  const base = decApply(32);
  return (b) => {
    const n = b.length;
    if (n > max) {
      return decoder.decode(b);
    }
    let h = 2166136261;
    for (let i = 0; i < n; i++) {
      h = Math.imul(h ^ b[i], 16777619);
    }
    const k = (h >>> 0) & (slots - 1);
    const kb = keys[k];
    if (kb !== undefined && kb.length === n) {
      let eq = true;
      for (let i = 0; i < n; i++) {
        if (kb[i] !== b[i]) {
          eq = false;
          break;
        }
      }
      if (eq) {
        return vals[k];
      }
    }
    const s = base(b);
    keys[k] = b.slice();
    vals[k] = s;
    return s;
  };
}

// ---- encode candidates ----
type Enc = (s: string) => Uint8Array;
const encCurrent: Enc = conv.BytesFromString;
function encLoop(max: number): Enc {
  return (s) => {
    const n = s.length;
    if (n <= max) {
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
    const out = encoder.encode(s);
    if (out.byteOffset === 0 && out.buffer.byteLength === out.length) {
      return out;
    }
    return new Uint8Array(out);
  };
}
// encodeInto a buffer of s.length: when every unit is ASCII it fits exactly (read === n); otherwise encode as now
function encInto(min: number): Enc {
  const small = encLoop(64);
  return (s) => {
    const n = s.length;
    if (n <= min) {
      return small(s);
    }
    const ret = new Uint8Array(n);
    const r = encoder.encodeInto(s, ret);
    if (r.read === n && r.written === n) {
      return ret;
    }
    const out = encoder.encode(s);
    if (out.byteOffset === 0 && out.buffer.byteLength === out.length) {
      return out;
    }
    return new Uint8Array(out);
  };
}

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

let sink = 0;
const decCands: Array<[string, Dec]> = [
  ["dec current (apply<=32, TextDecoder)", decCurrent],
  ["dec apply<=64", decApply(64)],
  ["dec apply<=128", decApply(128)],
  ["dec apply<=256", decApply(256)],
  ["dec latin1<=128", decLatin1(128)],
  ["dec loop4<=128", decLoop(128)],
  ["dec cached<=32 (4096 slots)", decCached(32, 4096)],
  ["dec cached<=64 (4096 slots)", decCached(64, 4096)],
];
const encCands: Array<[string, Enc]> = [
  ["enc current (loop<=64, TextEncoder)", encCurrent],
  ["enc loop<=128", encLoop(128)],
  ["enc loop<=256", encLoop(256)],
  ["enc loop<=1024", encLoop(1024)],
  ["enc encodeInto>64", encInto(64)],
  ["enc loop<=256 + encodeInto", (() => { const a = encLoop(256); const b = encInto(256); return (s: string) => (s.length <= 256 ? a(s) : b(s)); })()],
];
// equality
for (const [name, f] of decCands) {
  for (const b of dec) {
    if (f(b) !== decCurrent(b)) {
      throw new Error(`${name}: output differs for ${JSON.stringify(decCurrent(b))}`);
    }
  }
}
for (const [name, f] of encCands) {
  for (const s of enc) {
    const a = f(s);
    const b = encCurrent(s);
    if (a.length !== b.length || a.buffer.byteLength !== a.length || a.byteOffset !== 0) {
      throw new Error(`${name}: shape differs for ${JSON.stringify(s)}`);
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        throw new Error(`${name}: bytes differ for ${JSON.stringify(s)}`);
      }
    }
  }
}
const best: Record<string, number> = {};
const time = (f: () => void): number => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
for (let r = 0; r < 7; r++) {
  for (const [name, f] of decCands) {
    const t = time(() => { for (let i = 0; i < dec.length; i++) { sink += f(dec[i]).length; } });
    best[name] = Math.min(best[name] ?? Infinity, t);
  }
  for (const [name, f] of encCands) {
    const t = time(() => { for (let i = 0; i < enc.length; i++) { sink += f(enc[i]).length; } });
    best[name] = Math.min(best[name] ?? Infinity, t);
  }
}
const c1 = Math.min(canary(), canary());
console.log(JSON.stringify({ method, file: file.split(/[\\/]/).pop(), encInputs: enc.length, decInputs: dec.length, canary: +(c1 / c0).toFixed(2), canaryMs: +c0.toFixed(1), sink: sink & 0 }));
for (const [name] of [...decCands, ...encCands]) {
  console.log(`${name.padEnd(40)} ${best[name].toFixed(3).padStart(8)} ms`);
}
