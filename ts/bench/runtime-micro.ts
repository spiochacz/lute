// Micro-benchmarks of the Go runtime layer (ts/src/runtime) on ASCII and CJK input.
//
// Usage:
//   npm run bench:runtime -- <tag> [--groups=g1,g2]
// Runs every row (or only rows whose group is listed) and merges them into
// bench/results/runtime-micro.<tag>.json. Each row runs in THREE fresh child
// processes (`node --expose-gc --max-semi-space-size=256 bench/runtime-micro.ts
// --row <id>`), so no row sees JIT state from another. The file records the
// median of the per-process medians and the min and max across processes.
//
// Row id: group.name|input|impl, where impl is runtime (the current code), ref
// (a naive native equivalent, context only), or legacy (a bench-only copy of an
// older approach, used by the A/B rows).
//
// Inputs: ASCII is benchmark/commonmark-spec.md (212 KB; it has 273 non-ASCII
// characters). CJK is the repo-root README.md repeated to about 200 KB.
// One operation is one pass over all lines (unit "line") or over the whole text
// (unit "KB"), or one call for strconv (unit "call").

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as bytes from "../src/runtime/bytes.ts";
import * as strings from "../src/runtime/strings.ts";
import * as utf8 from "../src/runtime/utf8.ts";
import * as unicode from "../src/runtime/unicode.ts";
import * as slices from "../src/runtime/slices.ts";
import * as strconv from "../src/runtime/strconv.ts";
import * as legacyTrim from "./legacy/trim-legacy.ts";
import { LegacyBuffer } from "./legacy/buffer-write-legacy.ts";
import { allocBytesPerOp, bench, gcSeenDuring } from "./lib/micro.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const PROCESSES = 3;
const CHILD_FLAGS = ["--expose-gc", "--max-semi-space-size=256"];

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { ignoreBOM: true });
const NL = new Uint8Array([0x0a]);

type Impl = "runtime" | "ref" | "legacy";
type Unit = "line" | "KB" | "call";

interface Input {
  name: "ASCII" | "CJK";
  text: string;
  bytes: Uint8Array;
  lines: string[];
  lineBytes: Uint8Array[];
  lineStarts: number[];
  cps: Uint32Array;
  chars: string[];
  kb: number;
  lineCount: number;
}

interface RowDef {
  id: string;
  group: string;
  name: string;
  input: string;
  impl: Impl;
  unit: Unit;
  unitsPerOp: number;
  fn: () => unknown;
}

type Adder = (
  group: string,
  name: string,
  input: string,
  impl: Impl,
  unit: Unit,
  unitsPerOp: number,
  fn: () => unknown,
) => void;

function makeInput(name: "ASCII" | "CJK", text: string): Input {
  const b = enc.encode(text);
  const lineBytes: Uint8Array[] = [];
  const lineStarts: number[] = [];
  let start = 0;
  for (let i = 0; i <= b.length; i++) {
    if (i === b.length || b[i] === 0x0a) {
      lineBytes.push(b.subarray(start, i));
      lineStarts.push(start);
      start = i + 1;
    }
  }
  const cps: number[] = [];
  const chars: string[] = [];
  for (const ch of text) {
    cps.push(ch.codePointAt(0) as number);
    chars.push(ch);
  }
  return {
    name,
    text,
    bytes: b,
    lines: text.split("\n"),
    lineBytes,
    lineStarts,
    cps: Uint32Array.from(cps),
    chars,
    kb: b.length / 1024,
    lineCount: lineBytes.length,
  };
}

// Hand-written references (not part of the runtime).
function handHasPrefix(s: Uint8Array, p: Uint8Array): boolean {
  if (s.length < p.length) {
    return false;
  }
  for (let k = 0; k < p.length; k++) {
    if (s[k] !== p[k]) {
      return false;
    }
  }
  return true;
}

function handHasPrefixAt(s: Uint8Array, off: number, p: Uint8Array): boolean {
  if (s.length - off < p.length) {
    return false;
  }
  for (let k = 0; k < p.length; k++) {
    if (s[off + k] !== p[k]) {
      return false;
    }
  }
  return true;
}

function swapAsciiCase(b: Uint8Array): Uint8Array {
  const out = b.slice();
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c >= 0x41 && c <= 0x5a) {
      out[i] = c + 0x20;
    } else if (c >= 0x61 && c <= 0x7a) {
      out[i] = c - 0x20;
    }
  }
  return out;
}

// Builds the row definitions. Inputs are prepared here, outside every timed loop.
function buildRows(): RowDef[] {
  const asciiText = readFileSync(`${ROOT}benchmark/commonmark-spec.md`, "utf8");
  const readme = readFileSync(`${ROOT}README.md`, "utf8");
  const readmeBytes = enc.encode(readme).length;
  const cjkText = readme.repeat(Math.ceil((200 * 1024) / readmeBytes));
  const inputs = [makeInput("ASCII", asciiText), makeInput("CJK", cjkText)];
  const rows: RowDef[] = [];
  const add: Adder = (group, name, input, impl, unit, unitsPerOp, fn) => {
    rows.push({ id: `${group}.${name}|${input}|${impl}`, group, name, input, impl, unit, unitsPerOp, fn });
  };
  for (const inp of inputs) {
    benchInput(inp, add);
  }
  benchStrconv(add);
  benchAB(inputs, add);
  return rows;
}

function benchInput(inp: Input, add: Adder): void {
  const B = inp.bytes;
  const L = inp.lineBytes;
  const N = inp.lineCount;
  const KB = inp.kb;
  const I = inp.name;
  const cjk = I === "CJK";
  const R = "runtime" as const;
  const REF = "ref" as const;
  const lines = inp.lines;

  const prefix = enc.encode("#");
  const suffix = enc.encode(cjk ? "。" : ".");
  const cutset = cjk ? " \t#*-。" : " \t#*-";
  const needle = enc.encode("CommonMark");
  const needleStr = "CommonMark";
  const replOld = cjk ? "的" : " ";
  const replNew = cjk ? "之" : "_";
  const replOldB = enc.encode(replOld);
  const replNewB = enc.encode(replNew);
  const absentB = enc.encode("QQQQ");
  const absentS = "QQQQ";
  const eqCopies = L.map((l) => l.slice());
  const foldAlt = L.map((l) => swapAsciiCase(l));
  const foldAltStr = foldAlt.map((b) => dec.decode(b));
  const sepStr = "\n";

  // --- bytes ---
  add("bytes", "HasPrefix", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.HasPrefix(L[i], prefix) ? 1 : 0;
    return c;
  });
  add("bytes", "HasPrefix", I, REF, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += handHasPrefix(L[i], prefix) ? 1 : 0;
    return c;
  });
  add("bytes", "HasSuffix", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.HasSuffix(L[i], suffix) ? 1 : 0;
    return c;
  });
  add("bytes", "Equal", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.Equal(L[i], eqCopies[i]) ? 1 : 0;
    return c;
  });
  add("bytes", "Equal", I, REF, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += Buffer.compare(L[i], eqCopies[i]) === 0 ? 1 : 0;
    return c;
  });
  add("bytes", "Contains", I, R, "KB", KB, () => (bytes.Contains(B, needle) ? 1 : 0));
  add("bytes", "Contains", I, REF, "KB", KB, () => (inp.text.includes(needleStr) ? 1 : 0));
  add("bytes", "Index", I, R, "KB", KB, () => bytes.Index(B, needle));
  add("bytes", "Index", I, REF, "KB", KB, () => inp.text.indexOf(needleStr));
  add("bytes", "IndexByte", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.IndexByte(L[i], 0x20) + 1;
    return c;
  });
  add("bytes", "IndexByte", I, REF, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += L[i].indexOf(0x20) + 1;
    return c;
  });
  add("bytes", "TrimSpace", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.TrimSpace(L[i]).length;
    return c;
  });
  add("bytes", "TrimSpace", I, REF, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += lines[i].trim().length;
    return c;
  });
  add("bytes", "TrimLeft", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.TrimLeft(L[i], cutset).length;
    return c;
  });
  add("bytes", "TrimRight", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.TrimRight(L[i], cutset).length;
    return c;
  });
  add("bytes", "Trim", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.Trim(L[i], cutset).length;
    return c;
  });
  add("bytes", "ReplaceAll-present", I, R, "KB", KB, () => bytes.ReplaceAll(B, replOldB, replNewB));
  add("bytes", "ReplaceAll-present", I, REF, "KB", KB, () => inp.text.replaceAll(replOld, replNew).length);
  add("bytes", "ReplaceAll-absent", I, R, "KB", KB, () => bytes.ReplaceAll(B, absentB, replNewB));
  add("bytes", "ReplaceAll-absent", I, REF, "KB", KB, () => inp.text.replaceAll(absentS, "x").length);
  add("bytes", "Split-newline", I, R, "line", N, () => bytes.Split(B, NL).length);
  add("bytes", "Split-newline", I, REF, "line", N, () => inp.text.split(sepStr).length);
  add("bytes", "EqualFold", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.EqualFold(L[i], foldAlt[i]) ? 1 : 0;
    return c;
  });
  add("bytes", "EqualFold", I, REF, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += lines[i].toLowerCase() === foldAltStr[i].toLowerCase() ? 1 : 0;
    return c;
  });
  add("bytes", "ToLower", I, R, "KB", KB, () => bytes.ToLower(B));
  add("bytes", "ToLower", I, REF, "KB", KB, () => inp.text.toLowerCase().length);
  add("bytes", "HasPrefixAt", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += bytes.HasPrefixAt(B, inp.lineStarts[i], prefix) ? 1 : 0;
    return c;
  });
  add("bytes", "HasPrefixAt", I, REF, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += handHasPrefixAt(B, inp.lineStarts[i], prefix) ? 1 : 0;
    return c;
  });

  // --- slices ---
  add("slices", "Append-in-place", I, R, "line", N, () => {
    const full = slices.Make(B.length, B.length);
    let d = slices.Reslice(full, 0);
    for (let i = 0; i < N; i++) d = slices.Append(d, L[i]);
    return d;
  });
  add("slices", "Append-realloc", I, R, "line", N, () => {
    let d: Uint8Array = new Uint8Array(0);
    for (let i = 0; i < N; i++) d = slices.Append(d, L[i]);
    return d;
  });
  add("slices", "AppendByte", I, R, "KB", KB, () => {
    let d = slices.Make(0, B.length);
    for (let i = 0; i < B.length; i++) d = slices.AppendByte(d, B[i]);
    return d;
  });
  add("slices", "AppendByte", I, REF, "KB", KB, () => {
    const out = new Uint8Array(B.length);
    for (let i = 0; i < B.length; i++) out[i] = B[i];
    return out;
  });

  // --- bytes.Buffer (String() once per pass) ---
  add("buffer", "WriteString-literals", I, R, "line", N, () => {
    const b = new bytes.Buffer();
    for (let i = 0; i < N; i++) {
      b.WriteString("<p>");
      b.WriteString("</p>\n");
    }
    return b.String();
  });
  add("buffer", "WriteString-literals", I, REF, "line", N, () => {
    let out = "";
    for (let i = 0; i < N; i++) out += "<p>" + "</p>\n";
    return out;
  });
  add("buffer", "WriteString-text", I, R, "line", N, () => {
    const b = new bytes.Buffer();
    for (let i = 0; i < N; i++) b.WriteString(lines[i]);
    return b.String();
  });
  add("buffer", "WriteString-text", I, REF, "line", N, () => {
    let out = "";
    for (let i = 0; i < N; i++) out += lines[i];
    return out;
  });
  add("buffer", "Write-lines", I, R, "line", N, () => {
    const b = new bytes.Buffer();
    for (let i = 0; i < N; i++) b.Write(L[i]);
    return b.String();
  });
  add("buffer", "Write-lines", I, REF, "line", N, () => {
    const out = new Uint8Array(B.length);
    let w = 0;
    for (let i = 0; i < N; i++) {
      out.set(L[i], w);
      w += L[i].length;
    }
    return dec.decode(out.subarray(0, w));
  });
  add("buffer", "WriteByte", I, R, "KB", KB, () => {
    const b = new bytes.Buffer();
    for (let i = 0; i < B.length; i++) b.WriteByte(B[i]);
    return b.String();
  });
  add("buffer", "WriteByte", I, REF, "KB", KB, () => {
    const out = new Uint8Array(B.length);
    for (let i = 0; i < B.length; i++) out[i] = B[i];
    return dec.decode(out);
  });

  // --- utf8 ---
  add("utf8", "DecodeRune-loop", I, R, "KB", KB, () => {
    let i = 0;
    let c = 0;
    while (i < B.length) {
      const [r, w] = utf8.DecodeRune(B.subarray(i));
      c += r;
      i += w;
    }
    return c;
  });
  add("utf8", "DecodeRune-loop", I, REF, "KB", KB, () => {
    let c = 0;
    for (const ch of inp.text) c += ch.codePointAt(0) as number;
    return c;
  });
  add("utf8", "DecodeRunePacked-loop", I, R, "KB", KB, () => {
    let i = 0;
    let c = 0;
    while (i < B.length) {
      const v = utf8.DecodeRunePacked(B, i);
      c += v & 0xffffff;
      i += v >>> 24;
    }
    return c;
  });
  add("utf8", "DecodeRuneInString-loop", I, R, "KB", KB, () => {
    const s = inp.text;
    let i = 0;
    let c = 0;
    while (i < s.length) {
      const [r, w] = utf8.DecodeRuneInString(s, i);
      c += r;
      i += w;
    }
    return c;
  });
  add("utf8", "DecodeRuneInString-loop", I, REF, "KB", KB, () => {
    const s = inp.text;
    let c = 0;
    for (let i = 0; i < s.length; i++) c += s.charCodeAt(i);
    return c;
  });
  add("utf8", "RuneCount", I, R, "KB", KB, () => utf8.RuneCount(B));
  add("utf8", "RuneCount", I, REF, "KB", KB, () => {
    let n = 0;
    for (let i = 0; i < B.length; i++) if ((B[i] & 0xc0) !== 0x80) n++;
    return n;
  });
  add("utf8", "RuneCountInString", I, R, "KB", KB, () => utf8.RuneCountInString(inp.text));
  add("utf8", "RuneCountInString", I, REF, "KB", KB, () => {
    let n = 0;
    for (const _ of inp.text) n++;
    return n;
  });
  const encBuf = new Uint8Array(4);
  add("utf8", "EncodeRune", I, R, "KB", KB, () => {
    let w = 0;
    for (let i = 0; i < inp.cps.length; i++) w += utf8.EncodeRune(encBuf, inp.cps[i]);
    return w;
  });
  const encodeOut = new Uint8Array(B.length + 16);
  add("utf8", "EncodeRune", I, REF, "KB", KB, () => enc.encodeInto(inp.text, encodeOut).written);

  // --- unicode (every rune of the text) ---
  const cps = inp.cps;
  const C = inp.chars;
  const NC = cps.length;
  const predicate = (name: string, f: (r: number) => boolean, re: RegExp): void => {
    add("unicode", name, I, R, "KB", KB, () => {
      let c = 0;
      for (let i = 0; i < NC; i++) c += f(cps[i]) ? 1 : 0;
      return c;
    });
    add("unicode", name, I, REF, "KB", KB, () => {
      let c = 0;
      for (let i = 0; i < NC; i++) c += re.test(C[i]) ? 1 : 0;
      return c;
    });
  };
  predicate("IsSpace", unicode.IsSpace, /\p{White_Space}/u);
  predicate("IsLetter", unicode.IsLetter, /\p{L}/u);
  predicate("IsPunct", unicode.IsPunct, /\p{P}/u);
  predicate("IsDigit", unicode.IsDigit, /\p{Nd}/u);
  predicate("IsSymbol", unicode.IsSymbol, /\p{S}/u);
  predicate("Is(Han)", (r) => unicode.Is(unicode.Han, r), /\p{Script=Han}/u);
  add("unicode", "ToLower", I, R, "KB", KB, () => {
    let c = 0;
    for (let i = 0; i < NC; i++) c = (c + unicode.ToLower(cps[i])) | 0;
    return c;
  });
  add("unicode", "ToLower", I, REF, "KB", KB, () => {
    let n = 0;
    for (let i = 0; i < NC; i++) n += C[i].toLowerCase().length;
    return n;
  });
  add("unicode", "SimpleFold", I, R, "KB", KB, () => {
    let c = 0;
    for (let i = 0; i < NC; i++) c = (c + unicode.SimpleFold(cps[i])) | 0;
    return c;
  });
  add("unicode", "IsEastAsianWideOrFullwidth", I, R, "KB", KB, () => {
    let c = 0;
    for (let i = 0; i < NC; i++) c += unicode.IsEastAsianWideOrFullwidth(cps[i]) ? 1 : 0;
    return c;
  });

  // --- strings ---
  add("strings", "ReplaceAll-present", I, R, "KB", KB, () => strings.ReplaceAll(inp.text, replOld, replNew).length);
  add("strings", "ReplaceAll-present", I, REF, "KB", KB, () => inp.text.replaceAll(replOld, replNew).length);
  add("strings", "ReplaceAll-absent", I, R, "KB", KB, () => strings.ReplaceAll(inp.text, absentS, "x").length);
  add("strings", "ReplaceAll-absent", I, REF, "KB", KB, () => inp.text.replaceAll(absentS, "x").length);
  add("strings", "TrimSpace", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += strings.TrimSpace(lines[i]).length;
    return c;
  });
  add("strings", "TrimSpace", I, REF, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += lines[i].trim().length;
    return c;
  });
  add("strings", "Contains", I, R, "KB", KB, () => (strings.Contains(inp.text, needleStr) ? 1 : 0));
  add("strings", "Contains", I, REF, "KB", KB, () => (inp.text.includes(needleStr) ? 1 : 0));
  add("strings", "HasPrefix", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += strings.HasPrefix(lines[i], "#") ? 1 : 0;
    return c;
  });
  add("strings", "HasPrefix", I, REF, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += lines[i].startsWith("#") ? 1 : 0;
    return c;
  });
  add("strings", "Split", I, R, "line", N, () => strings.Split(inp.text, sepStr).length);
  add("strings", "Split", I, REF, "line", N, () => inp.text.split(sepStr).length);
  add("strings", "ToLower", I, R, "KB", KB, () => strings.ToLower(inp.text).length);
  add("strings", "ToLower", I, REF, "KB", KB, () => inp.text.toLowerCase().length);
  add("strings", "Index", I, R, "KB", KB, () => strings.Index(inp.text, needleStr));
  add("strings", "Index", I, REF, "KB", KB, () => inp.text.indexOf(needleStr));
  add("strings", "Fields", I, R, "line", N, () => strings.Fields(inp.text).length);
  add("strings", "Fields", I, REF, "line", N, () => (inp.text.match(/\S+/g) ?? []).length);
  add("strings", "EqualFold", I, R, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += strings.EqualFold(lines[i], foldAltStr[i]) ? 1 : 0;
    return c;
  });
  add("strings", "EqualFold", I, REF, "line", N, () => {
    let c = 0;
    for (let i = 0; i < N; i++) c += lines[i].toLowerCase() === foldAltStr[i].toLowerCase() ? 1 : 0;
    return c;
  });
}

function benchStrconv(add: Adder): void {
  const ints = Array.from({ length: 10000 }, (_, i) => i);
  const intStrs = ints.map((i) => String(i));
  add("strconv", "Itoa", "int", "runtime", "call", ints.length, () => {
    let c = 0;
    for (let i = 0; i < ints.length; i++) c += strconv.Itoa(ints[i]).length;
    return c;
  });
  add("strconv", "Itoa", "int", "ref", "call", ints.length, () => {
    let c = 0;
    for (let i = 0; i < ints.length; i++) c += String(ints[i]).length;
    return c;
  });
  add("strconv", "Atoi", "int", "runtime", "call", intStrs.length, () => {
    let c = 0;
    for (let i = 0; i < intStrs.length; i++) c += strconv.Atoi(intStrs[i])[0];
    return c;
  });
  add("strconv", "Atoi", "int", "ref", "call", intStrs.length, () => {
    let c = 0;
    for (let i = 0; i < intStrs.length; i++) c += parseInt(intStrs[i], 10);
    return c;
  });
}

// A/B rows: the same work done the old way (legacy) and the current way
// (runtime), side by side in the same run.
function benchAB(inputs: Input[], add: Adder): void {
  for (const inp of inputs) {
    const B = inp.bytes;
    const I = inp.name;
    const KB = inp.kb;
    const N = inp.lineCount;
    const L = inp.lineBytes;

    // (i) decoding: DecodeRune(subarray) against the packed decoder.
    add("ab.decode", "subarray-DecodeRune", I, "legacy", "KB", KB, () => {
      let i = 0;
      let c = 0;
      while (i < B.length) {
        const [r, w] = utf8.DecodeRune(B.subarray(i));
        c += r;
        i += w;
      }
      return c;
    });
    add("ab.decode", "packed", I, "runtime", "KB", KB, () => {
      let i = 0;
      let c = 0;
      while (i < B.length) {
        const v = utf8.DecodeRunePacked(B, i);
        c += v & 0xffffff;
        i += v >>> 24;
      }
      return c;
    });

    // (ii) trims with a cutset: array per call (legacy) against the scan (runtime).
    const cutset = I === "CJK" ? " \t#*-。" : " \t#*-";
    const trims: [string, (s: Uint8Array, c: string) => Uint8Array, (s: Uint8Array, c: string) => Uint8Array][] = [
      ["TrimLeft", legacyTrim.TrimLeft, bytes.TrimLeft],
      ["TrimRight", legacyTrim.TrimRight, bytes.TrimRight],
      ["Trim", legacyTrim.Trim, bytes.Trim],
    ];
    for (const [name, old, cur] of trims) {
      add("ab.trim", `${name}-array`, I, "legacy", "line", N, () => {
        let c = 0;
        for (let i = 0; i < N; i++) c += old(L[i], cutset).length;
        return c;
      });
      add("ab.trim", `${name}-scan`, I, "runtime", "line", N, () => {
        let c = 0;
        for (let i = 0; i < N; i++) c += cur(L[i], cutset).length;
        return c;
      });
    }

    // (iii) Buffer.Write: subarray copy (legacy) against set() (runtime).
    add("ab.buffer-write", "subarray", I, "legacy", "line", N, () => {
      const b = new LegacyBuffer();
      for (let i = 0; i < N; i++) b.Write(L[i]);
      return b.Len();
    });
    add("ab.buffer-write", "set", I, "runtime", "line", N, () => {
      const b = new bytes.Buffer();
      for (let i = 0; i < N; i++) b.Write(L[i]);
      return b.Len();
    });
  }
}

// ---------------------------------------------------------------- child mode

async function runChild(id: string): Promise<void> {
  const def = buildRows().find((r) => r.id === id);
  if (def === undefined) {
    throw new Error(`unknown row id: ${id}`);
  }
  const t = await bench(def.fn, { unit: def.unit, unitsPerOp: def.unitsPerOp });
  const a = await allocBytesPerOp(def.fn, 256);
  const out = {
    id,
    nsPerOp: t.nsPerOpMedian,
    nsPerOpMin: t.nsPerOpMin,
    nsPerOpMax: t.nsPerOpMax,
    nsPerUnit: t.nsPerUnitMedian,
    itersPerBatch: t.itersPerBatch,
    batches: t.batches,
    checksum: t.checksum,
    bytesPerOp: a.bytesPerOp,
    opsMeasured: a.opsMeasured,
  };
  process.stdout.write(`ROW_RESULT ${JSON.stringify(out)}\n`);
}

// ---------------------------------------------------------------- runner mode

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

interface ChildResult {
  id: string;
  nsPerOp: number;
  nsPerOpMin: number;
  nsPerOpMax: number;
  nsPerUnit: number;
  itersPerBatch: number;
  batches: number;
  checksum: number;
  bytesPerOp: number | null;
  opsMeasured: number;
}

function runRowInChildren(def: RowDef, processes: number = PROCESSES): ChildResult[] {
  const results: ChildResult[] = [];
  for (let p = 0; p < processes; p++) {
    const res = spawnSync(process.execPath, [...CHILD_FLAGS, SELF, "--row", def.id], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
      throw new Error(`child failed for ${def.id}: ${res.stderr}`);
    }
    const line = res.stdout.split("\n").find((l) => l.startsWith("ROW_RESULT "));
    if (line === undefined) {
      throw new Error(`no result for ${def.id}`);
    }
    results.push(JSON.parse(line.slice("ROW_RESULT ".length)) as ChildResult);
  }
  return results;
}

function aggregate(def: RowDef, per: ChildResult[]): Record<string, unknown> {
  const checksums = new Set(per.map((p) => p.checksum));
  if (checksums.size !== 1) {
    throw new Error(`checksum differs between processes for ${def.id}: ${[...checksums].join(", ")}`);
  }
  const nsUnit = per.map((p) => p.nsPerUnit);
  const nsOp = per.map((p) => p.nsPerOp);
  const bytesVals = per.map((p) => p.bytesPerOp);
  const bytesOk = bytesVals.every((v): v is number => v !== null) ? bytesVals : null;
  return {
    id: def.id,
    group: def.group,
    name: def.name,
    input: def.input,
    impl: def.impl,
    unit: def.unit,
    unitsPerOp: def.unitsPerOp,
    nsPerUnit: { median: round(median(nsUnit)), min: round(Math.min(...nsUnit)), max: round(Math.max(...nsUnit)) },
    nsPerOp: { median: round(median(nsOp)), min: round(Math.min(...nsOp)), max: round(Math.max(...nsOp)) },
    bytesPerOp:
      bytesOk === null
        ? null
        : {
            median: Math.round(median(bytesOk)),
            min: Math.round(Math.min(...bytesOk)),
            max: Math.round(Math.max(...bytesOk)),
          },
    checksum: per[0].checksum,
    itersPerBatch: per.map((p) => p.itersPerBatch),
    processes: per.length,
  };
}

function writeOut(file: string, tag: string, rowsById: Map<string, Record<string, unknown>>): void {
  writeFileSync(
    file,
    JSON.stringify(
      {
        tag,
        date: new Date().toISOString(),
        node: process.version,
        processesPerRow: PROCESSES,
        rows: [...rowsById.values()],
      },
      null,
      2,
    ),
  );
}

function runner(): void {
  const args = process.argv.slice(2);
  const tag = args.find((a) => !a.startsWith("--")) ?? "latest";
  const groupsArg = args.find((a) => a.startsWith("--groups="));
  const groups = groupsArg ? new Set(groupsArg.slice("--groups=".length).split(",")) : null;
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = `${RESULTS_DIR}runtime-micro.${tag}.json`;
  // Rows are merged into an existing file, so a suite can be run in several
  // foreground invocations (one per group) without losing earlier rows.
  const existing: { rows: Record<string, unknown>[] } = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { rows: Record<string, unknown>[] })
    : { rows: [] };
  const rowsById = new Map<string, Record<string, unknown>>(existing.rows.map((r) => [r.id as string, r]));

  const defs = buildRows().filter((d) => groups === null || groups.has(d.group));
  console.log(`running ${defs.length} rows x ${PROCESSES} processes into ${file}`);
  let i = 0;
  for (const def of defs) {
    i++;
    rowsById.set(def.id, aggregate(def, runRowInChildren(def)));
    console.log(`[${i}/${defs.length}] ${def.id}`);
    writeOut(file, tag, rowsById);
  }
  console.log(`wrote ${file}`);
}

// Interleaved A/A run: every row is measured in 2 * PROCESSES child processes
// that alternate between the tags aa1 and aa2, so slow drift of the machine
// (CPU frequency, temperature, other load) hits both tags equally. Two
// back-to-back full runs do not have that property.
function runnerInterleavedAA(): void {
  const groupsArg = process.argv.find((a) => a.startsWith("--groups="));
  const groups = groupsArg ? new Set(groupsArg.slice("--groups=".length).split(",")) : null;
  mkdirSync(RESULTS_DIR, { recursive: true });
  const defs = buildRows().filter((d) => groups === null || groups.has(d.group));
  const out = [new Map<string, Record<string, unknown>>(), new Map<string, Record<string, unknown>>()];
  console.log(`interleaved A/A: ${defs.length} rows x ${2 * PROCESSES} processes`);
  let i = 0;
  for (const def of defs) {
    i++;
    const per = runRowInChildren(def, 2 * PROCESSES);
    out[0].set(def.id, aggregate(def, per.filter((_, k) => k % 2 === 0)));
    out[1].set(def.id, aggregate(def, per.filter((_, k) => k % 2 === 1)));
    console.log(`[${i}/${defs.length}] ${def.id}`);
  }
  writeOut(`${RESULTS_DIR}runtime-micro.aa1.json`, "aa1", out[0]);
  writeOut(`${RESULTS_DIR}runtime-micro.aa2.json`, "aa2", out[1]);
}

if (process.argv.includes("--aa-interleaved")) {
  runnerInterleavedAA();
} else if (process.argv.includes("--controls")) {
  const zero = await allocBytesPerOp(() => {
    let s = 0;
    for (let i = 0; i < 100; i++) s += i;
    return s;
  }, 256);
  const alloc64 = await allocBytesPerOp(() => new Uint8Array(64), 256);
  const detectGc = await gcSeenDuring(() => {
    let keep: unknown = null;
    for (let i = 0; i < 400; i++) keep = new Uint8Array(1024 * 1024);
    return keep;
  });
  const detectNone = await gcSeenDuring(() => {
    let s = 0;
    for (let i = 0; i < 1000; i++) s += i;
    return s;
  });
  console.log(
    "estimator controls:",
    JSON.stringify({
      zeroAllocLoop: zero.bytesPerOp,
      alloc64Loop: alloc64.bytesPerOp,
      gcDetectorSeesGcWhenExpected: detectGc,
      gcDetectorSilentWhenNoGc: !detectNone,
    }),
  );
} else if (process.argv.includes("--row")) {
  await runChild(process.argv[process.argv.indexOf("--row") + 1]);
} else {
  runner();
}
