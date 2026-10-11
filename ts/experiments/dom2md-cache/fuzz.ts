// Differential fuzzer for the per-child cache of VditorDOM2Md / VditorIRDOM2Md.
//
//   node fuzz.ts --mode=wysiwyg|ir|both --pass=warm|cold|shared|evict|all --cmp=50000 --seed=1 [--impl=engine|prototype] [--corpus-snapshot=<file>] [--no-precheck]
//   node fuzz.ts --report=real        fallback rate on whole documents (no edits)
//   node fuzz.ts --check=replay --mode=... --cmp=5000 --seed=1   replay(log) against the uncached output for every generated document (no cache)
//
// --impl=engine (default, tasks/004 step 13): the cache of src/incremental through engine-adapter.ts: engine A with the cache (strict, verify
//   off: the fuzzer compares the outputs itself), engine B without it (the reference). The repro scripts of precheck import the prototype, so
//   they are run only for --impl=prototype.
// --impl=prototype: the spike's CachedDom2Md of cached.ts, or a mutated copy named by $D2M_CACHED (the historical negative controls). No evict pass.
// Passes: warm (a new engine per sequence), cold (a new engine per comparison), shared (one engine per option set for all sequences) and evict
//   (one engine per option set with maxBytes = 32 KiB, so that eviction and the too-large path run constantly).
// Outcomes must be equal, exceptions included. An IncrementalInconsistency (strict mode) is a mismatch of cause INCONSISTENCY:<reason> even when
// the reference throws too. Edits: the shared generator of test/incremental/edit_generator.ts (16 edits; channel children in the mixed picks).
// --corpus-snapshot=<file> freezes the repository's Markdown and hand-written DOM: the file is written when absent and read when present.
// The corpus sha256 is printed. Every mismatch is printed as one MISMATCH line (cause, first differing UTF-16 offset with code points,
// whether a fresh cache reproduces it); one REPRESENTATIVE block with a cold reduction per (mode, cause, offset class).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { editor, render, util, vditorDOM2MdBuildTree, vditorDOM2MdPrepare, vditorDOM2MdRenderOptions, vditorIRDOM2MdBuildTree, vditorIRDOM2MdPrepare, vditorIRDOM2MdRenderOptions } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import * as conv from "../../src/runtime/conv.ts";
import { scanTopLevel } from "../../src/incremental/scanner.ts";
import { normalizeIDs } from "../../test/oracle/oracle.ts";
import { CHANNEL_WEIGHT, EDIT_NAMES, step } from "../../test/incremental/edit_generator.ts";
import type { Lcg } from "../../test/incremental/edit_generator.ts";
import { EngineDom2Md } from "./engine-adapter.ts";
import { splitTopLevel } from "./scan.ts";
import { CONFIGS, buildDomDocs, engines, loadCorpus } from "./corpus.ts";
import type { Config, Corpus, DomDoc, MdDoc } from "./corpus.ts";

type Mode = "wysiwyg" | "ir";
type Pass = "warm" | "cold" | "shared" | "evict";

// What the passes call: the engine adapter, or (--impl=prototype) the spike's CachedDom2Md.
interface Under {
  convert(html: string): string;
  uncached(html: string): string;
  readonly stats: { fallbackCalls: number; children: number; hits: number; misses: number; missBytes: number; totalBytes: number };
  lastFallbackReason: string;
  lastInconsistency?: string;
  setProtyle?(v: boolean): void;
  counters?(): { evictions: number; tooLarge: number; inconsistencies: number; entries: number };
}

const IMPL: "engine" | "prototype" = process.argv.includes("--impl=prototype") ? "prototype" : "engine";
// The prototype module, loaded only for --impl=prototype: ./cached.ts, or a mutated copy named by $D2M_CACHED.
const CachedImpl: (new (lute: Lute, mode: Mode) => Under) | null =
  IMPL === "prototype" ? ((await import(process.env.D2M_CACHED ?? "./cached.ts")) as unknown as { CachedDom2Md: new (lute: Lute, mode: Mode) => Under }).CachedDom2Md : null;
const EVICT_BYTES = 32 * 1024;

// ---------------------------------------------------------------- RNG
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rnd = mulberry32(1);
const ri = (n: number): number => Math.floor(rnd() * n);
const pick = <T,>(a: readonly T[]): T => a[ri(a.length)];

// ---------------------------------------------------------------- args
const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? "1");
}
const argNum = (k: string, d: number): number => (args.has(k) ? Number(args.get(k)) : d);

// ---------------------------------------------------------------- outcome comparison
interface Outcome {
  threw: boolean;
  value: string;
}
function run(f: () => string): Outcome {
  try {
    return { threw: false, value: f() };
  } catch (e) {
    return { threw: true, value: e instanceof Error ? e.message : String(e) };
  }
}
// Generated node IDs (20261011153206-bq2y33v) differ between two calls of the uncached engine itself (random suffix,
// clock); they only reach the output through the `default` branch of genASTByVditorDOM (unknown top-level
// elements, which are never composed). Both sides are normalised the way the repository's oracle tests do.
let lastWasNormalised = false;
const same = (a: Outcome, b: Outcome): boolean => {
  lastWasNormalised = false;
  if (a.threw !== b.threw) return false;
  if (a.value === b.value) return true;
  const x = normalizeIDs(a.value);
  const y = normalizeIDs(b.value);
  if (x === y) {
    lastWasNormalised = true;
    return true;
  }
  return false;
};

// ---------------------------------------------------------------- edits
// The edit generator is the shared one (test/incremental/edit_generator.ts, tasks/004 negative-control analysis, section 6 step 1). The
// fuzzer's RNG drives it through the two methods of the Lcg interface.
type Doc = string[];
const rngView = { next: (): number => rnd(), int: (n: number): number => ri(n) } as unknown as Lcg;

// applyEdit returns the edited copy of the document and the name of the edit (EDIT_NAMES).
function applyEdit(doc0: Doc, pool: string[]): { doc: Doc; op: string } {
  const doc = doc0.slice();
  const k = step(rngView, doc, pool);
  return { doc, op: EDIT_NAMES[k] };
}

// The characters that Go's unicode.IsSpace (the set of strings.TrimSpace and bytes.TrimSpace in the engine) strips; a mismatch is classified
// as leading-go-space when the outputs differ only there.
const GO_SPACE_CODES: number[] = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
const GO_SPACE_SET = new Set<number>(GO_SPACE_CODES);

// ---------------------------------------------------------------- splitter audit against the engine's parser
// The audit runs on the html after the two string replacements that convert() makes first (ZWSP, then the caret <wbr>): the input the scanner
// and the parser see in the cache. scanTopLevel of src is audited: count, tag and attribute count of every top-level child.
function auditSplit(htmlRaw: string): string | null {
  const html = htmlRaw.split(editor.Zwsp).join("").split(editor.FrontEndCaret).join("");
  const sc = scanTopLevel(html);
  if (!sc.ok) return null;
  const root = util.ParseHTML(html);
  if (root === null) return "ParseHTML returned null";
  const kids: Array<{ Data: string; Attr: unknown[] }> = [];
  for (let c = root.FirstChild; c !== null; c = c.NextSibling) kids.push(c as never);
  if (kids.length !== sc.children.length) return `child count: scanner ${sc.children.length}, parser ${kids.length}`;
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].Data !== sc.children[i].tag) return `child ${i}: scanner <${sc.children[i].tag}>, parser ${kids[i].Data}`;
    if (kids[i].Attr.length !== sc.children[i].attrs) return `child ${i}: attr count scanner ${sc.children[i].attrs}, parser ${kids[i].Attr.length}`;
  }
  return null;
}

// ---------------------------------------------------------------- reduction
function reduce(doc: Doc, bad: (d: Doc) => boolean): Doc {
  let cur = doc.slice();
  let chunk = Math.max(1, cur.length >> 1);
  while (chunk >= 1) {
    let removed = false;
    for (let i = 0; i + chunk <= cur.length; ) {
      const cand = cur.slice(0, i).concat(cur.slice(i + chunk));
      if (cand.length > 0 && bad(cand)) {
        cur = cand;
        removed = true;
      } else {
        i += chunk;
      }
    }
    if (!removed) chunk = chunk >> 1;
  }
  return cur;
}

// ---------------------------------------------------------------- driver
interface Totals {
  docs: number;
  edits: number;
  comparisons: number;
  composed: number; // comparisons where the composition path produced the answer
  fallback: number;
  mismatches: number;
  splitAudits: number;
  splitDisagreements: number;
  opCounts: Map<string, number>;
  fallbackReasons: Map<string, number>;
  hits: number;
  misses: number;
  children: number;
  idNormalisedFallback: number;
  idNormalisedComposed: number;
  missBytes: number;
  totalBytes: number;
  episodes: number; // runs of consecutive mismatching steps of one edit sequence (tasks/004 (f) item 6)
  causes: Map<string, number>; // mismatching comparisons by cause (see describeMismatch)
  coldReproduced: number; // mismatching comparisons that also mismatch with a fresh cache on the same html
  evictions: number; // engine counters, summed over the comparisons of the pass (0 for the prototype)
  tooLarge: number;
  inconsistencies: number;
  inconsistencyReasons: Map<string, number>;
}
const newTotals = (): Totals => ({ docs: 0, edits: 0, comparisons: 0, composed: 0, fallback: 0, mismatches: 0, splitAudits: 0, splitDisagreements: 0, opCounts: new Map(), fallbackReasons: new Map(), hits: 0, misses: 0, children: 0, idNormalisedFallback: 0, idNormalisedComposed: 0, missBytes: 0, totalBytes: 0, episodes: 0, causes: new Map(), coldReproduced: 0, evictions: 0, tooLarge: 0, inconsistencies: 0, inconsistencyReasons: new Map() });
const bump = (m: Map<string, number>, k: string, by = 1): void => void m.set(k, (m.get(k) ?? 0) + by);

interface Suite {
  cfg: Config;
  mode: Mode;
  port: ReturnType<typeof engines>["port"];
  docs: DomDoc[];
  pool: string[];
  hand: string[];
}

function buildSuite(cfg: Config, mode: Mode, corpus: Corpus): Suite {
  const { port } = engines(cfg, mode);
  const docs = buildDomDocs(cfg, mode, corpus.mds);
  const hand = corpus.hand[mode];
  const pool: string[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    if (!d.children) continue;
    for (const c of d.children) {
      if (c.length < 20000 && !seen.has(c)) {
        seen.add(c);
        pool.push(c);
      }
    }
  }
  for (const h of hand) {
    const sp = splitTopLevel(h);
    if (sp.ok) for (const c of sp.children) { const t = h.substring(c.start, c.end); if (!seen.has(t)) { seen.add(t); pool.push(t); } }
  }
  // children whose output depends on an engine option (ProtyleWYSIWYG turns a literal "<br>" in text into a newline)
  pool.push('<p data-block="0">x&lt;br&gt;y</p>', '<p data-block="0">a&lt;br /&gt;b&lt;br/&gt;c</p>');
  return { cfg, mode, port, docs, pool, hand };
}

function startDoc(s: Suite): Doc {
  // a window of consecutive children of a real/unit document, optionally spliced with foreign children
  const withKids = s.docs.filter((d) => d.children && d.children.length > 0);
  const roll = ri(10);
  if (roll === 9 && s.hand.length > 0) {
    // a browser-shaped DOM from the Go tables, as is (children if it splits, otherwise one opaque piece)
    const h = pick(s.hand);
    const sp = splitTopLevel(h);
    return sp.ok ? sp.children.map((c) => h.substring(c.start, c.end)) : [h];
  }
  if (roll < 4) {
    const big = withKids.filter((d) => d.children!.length > 30);
    const d = pick(big.length ? big : withKids);
    const len = 3 + ri(30);
    const st = ri(Math.max(1, d.children!.length - len));
    return d.children!.slice(st, st + len);
  }
  if (roll < 8) {
    const d = pick(withKids);
    const kids = d.children!.slice(0, 40);
    // splice in foreign children
    for (let k = ri(4); k > 0; k--) kids.splice(ri(kids.length + 1), 0, pick(s.pool));
    return kids;
  }
  const doc: Doc = [];
  for (let k = 2 + ri(8); k > 0; k--) doc.push(pick(s.pool));
  return doc;
}

// Where the first output difference is: the cause class, the offset and the code points there.
// cause "throw-parity": one side throws; "throw-message": both throw, different messages;
// "leading-go-space": the outputs differ only in the Go-space characters at their start (the inferred class R1 of tasks/004 (a));
// "other": anything else.
function goLeadLen(s: string): number {
  let i = 0;
  while (i < s.length && GO_SPACE_SET.has(s.charCodeAt(i))) i++;
  return i;
}

function cpsAt(s: string, i: number): string {
  if (i >= s.length) return "[end of string]";
  const out: string[] = [];
  let j = i;
  while (j < s.length && out.length < 4) {
    const cp = s.codePointAt(j)!;
    out.push("U+" + cp.toString(16).toUpperCase().padStart(4, "0"));
    j += cp > 0xffff ? 2 : 1;
  }
  return "[" + out.join(" ") + "]";
}

interface MismatchInfo {
  cause: string;
  offset: number; // UTF-16 offset of the first difference
  byteOffset: number; // the same position in UTF-8 bytes
  cachedCps: string;
  wantCps: string;
  cachedWindow: string;
  wantWindow: string;
  fell: boolean; // the cached call took the fallback path
  cold: boolean; // the same html also differs with a fresh cache
}

function describeMismatch(got: Outcome, want: Outcome): Omit<MismatchInfo, "fell" | "cold"> {
  if (got.threw !== want.threw) {
    return { cause: "throw-parity", offset: 0, byteOffset: 0, cachedCps: "threw " + got.threw + ": " + got.value.slice(0, 80), wantCps: "threw " + want.threw + ": " + want.value.slice(0, 80), cachedWindow: "", wantWindow: "" };
  }
  const a = got.value;
  const b = want.value;
  let i = 0;
  while (i < a.length && i < b.length && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  let cause: string;
  if (got.threw) cause = "throw-message";
  else cause = a.slice(goLeadLen(a)) === b.slice(goLeadLen(b)) ? "leading-go-space" : "other";
  const from = Math.max(0, i - 30);
  return {
    cause,
    offset: i,
    byteOffset: new TextEncoder().encode(a.slice(0, i)).length,
    cachedCps: cpsAt(a, i),
    wantCps: cpsAt(b, i),
    cachedWindow: JSON.stringify(a.slice(from, i + 60)),
    wantWindow: JSON.stringify(b.slice(from, i + 60)),
  };
}

// snapshot reads the counters of the engine under test (the prototype has no engine counters).
function snapshot(c: Under): { fb: number; children: number; hits: number; misses: number; mb: number; tb: number; ev: number; tl: number; inc: number } {
  const st = c.stats;
  const k = c.counters?.() ?? { evictions: 0, tooLarge: 0, inconsistencies: 0, entries: 0 };
  return { fb: st.fallbackCalls, children: st.children, hits: st.hits, misses: st.misses, mb: st.missBytes, tb: st.totalBytes, ev: k.evictions, tl: k.tooLarge, inc: k.inconsistencies };
}

function compareOnce(c: Under, html: string, ts: Totals[], ctxName: string, mk: () => Under, onMismatch: (m: MismatchInfo) => void): boolean {
  const before = snapshot(c);
  const got = run(() => c.convert(html));
  const after = snapshot(c);
  const fell = after.fb > before.fb;
  const want = run(() => c.uncached(html));
  const aud = fell ? null : auditSplit(html);
  if (aud !== null) {
    console.log(`SPLIT DISAGREEMENT [${ctxName}] ${aud}\n  html: ${JSON.stringify(html.slice(0, 400))}`);
  }
  const inc = c.lastInconsistency ?? "";
  const eq = same(got, want) && inc === "";
  const norm = eq && lastWasNormalised;
  let mi: MismatchInfo | null = null;
  if (!eq) {
    const d0 = describeMismatch(got, want);
    const d = inc !== "" ? { ...d0, cause: "INCONSISTENCY:" + inc } : d0;
    const cc = mk();
    const ccGot = run(() => cc.convert(html));
    const cold = !same(ccGot, run(() => cc.uncached(html))) || (cc.lastInconsistency ?? "") !== "";
    mi = { ...d, fell, cold };
    for (const t of ts) {
      bump(t.causes, d.cause);
      if (cold) t.coldReproduced++;
      if (inc !== "") bump(t.inconsistencyReasons, inc);
    }
  }
  for (const t of ts) {
    t.comparisons++;
    if (fell) {
      t.fallback++;
      bump(t.fallbackReasons, c.lastFallbackReason);
    } else {
      t.composed++;
      t.splitAudits++;
      t.children += after.children - before.children;
      t.hits += after.hits - before.hits;
      t.misses += after.misses - before.misses;
      t.missBytes += after.mb - before.mb;
      t.totalBytes += after.tb - before.tb;
    }
    if (aud !== null) t.splitDisagreements++;
    if (norm) {
      if (fell) t.idNormalisedFallback++;
      else t.idNormalisedComposed++;
    }
    if (!eq) t.mismatches++;
    t.evictions += after.ev - before.ev;
    t.tooLarge += after.tl - before.tl;
    t.inconsistencies += after.inc - before.inc;
  }
  if (mi !== null) onMismatch(mi);
  return eq;
}


interface Ctx {
  mode: Mode;
  reps: Set<string>; // distinct (mode, cause, offset class) keys that already have a representative
  detail: string[]; // representative reports, printed after the summary
  seq: number; // edit sequences so far in this mode
}

// makeUnder builds the engine under test for a suite: the engine adapter (default) or the prototype, with the suite's option setters.
function makeUnder(s: { cfg: Config; mode: Mode; port: Lute }, maxBytes: number | undefined): Under {
  if (CachedImpl !== null) return new CachedImpl(s.port, s.mode);
  return new EngineDom2Md(s.cfg.setters(s.mode), s.mode, maxBytes === undefined ? {} : { maxBytes });
}

function fuzzSuite(s: Suite, pass: Pass, budget: number, shared: Under | null, t: Totals, tp: Totals, ctx: Ctx): void {
  const label = `${s.mode}/${s.cfg.name}/${pass}`;
  // the ProtyleWYSIWYG state of the suite; every engine created here starts in it
  let protyle = s.cfg.protyle === true;
  const mk = (): Under => {
    const u = makeUnder(s, pass === "evict" ? EVICT_BYTES : undefined);
    u.setProtyle?.(protyle);
    return u;
  };
  let cacheForSeq: Under = shared ?? mk();
  let done = 0;
  // the host changes an engine option between two calls (Vditor does: outlineRender.ts toggles SetToC); applied to the port and the cache
  const setProtyle = (v: boolean): void => {
    protyle = v;
    s.port.SetProtyleWYSIWYG(v);
    if (pass !== "cold") cacheForSeq.setProtyle?.(v);
  };
  while (done < budget) {
    t.docs++;
    tp.docs++;
    setProtyle(s.cfg.protyle === true);
    if (pass === "warm") cacheForSeq = mk();
    let doc = startDoc(s);
    const steps = 8 + ri(20);
    const seq = ++ctx.seq;
    let inEpisode = false;
    for (let step = 0; step <= steps && done < budget; step++) {
      let op = "start";
      if (step > 0) {
        const e = applyEdit(doc, s.pool);
        doc = e.doc;
        op = e.op;
        t.edits++;
        tp.edits++;
        bump(t.opCounts, op);
      }
      if (step > 0 && rnd() < 0.05) {
        setProtyle(!protyle);
        bump(t.opCounts, "option-toggle");
      }
      const list: Doc = doc;
      const html = list.join("");
      const c = pass === "cold" ? mk() : cacheForSeq;
      const eq = compareOnce(c, html, [t, tp], `${label} op=${op}`, mk, (m) => {
        const newEpisode = !inEpisode;
        console.log(`MISMATCH ${label} seq=${seq} step=${step} op=${op} path=${m.fell ? "fallback" : "composed"} ${newEpisode ? "episode-start" : "episode-continued"} cause=${m.cause} offset=${m.offset} (utf8 byte ${m.byteOffset}) cached=${m.cachedCps} want=${m.wantCps} cold=${m.cold ? "reproduces" : "does-not-reproduce"}`);
        const key = `${s.mode}|${m.cause}|${m.offset === 0 ? "offset 0" : "offset > 0"}`;
        if (ctx.reps.has(key)) return;
        ctx.reps.add(key);
        const lines = [`REPRESENTATIVE ${key}; first seen ${label} seq=${seq} step=${step} op=${op}; document has ${list.length} children`, `  cached: ${m.cachedWindow}`, `  want:   ${m.wantWindow}`];
        if (m.cold) {
          const bad = (d: Doc): boolean => {
            const h = d.join("");
            const cc = mk();
            const g = run(() => cc.convert(h));
            return !same(g, run(() => cc.uncached(h))) || (cc.lastInconsistency ?? "") !== "";
          };
          const min = reduce(list, bad);
          const h = min.join("");
          const cc = mk();
          lines.push(`  MINIMAL (cold) ${min.length} children: ${JSON.stringify(min)}`, `    cached: ${JSON.stringify(run(() => cc.convert(h))).slice(0, 600)}`, `    want:   ${JSON.stringify(run(() => cc.uncached(h))).slice(0, 600)}`);
        } else {
          lines.push("  not reproducible with a cold cache (warm-state dependent)");
        }
        ctx.detail.push(lines.join("\n"));
      });
      if (!eq && !inEpisode) {
        t.episodes++;
        tp.episodes++;
      }
      inEpisode = !eq;
      done++;
    }
  }
}

// tasks/004 (f) item 5: the regression cases and the bounded sweep run first; the fuzz is aborted when one of them fails.
// A case of repro/cases.ts that does not match its expectation, or any sweep document that differs in a way other than
// the leading-Unicode-whitespace class, aborts the run. (The known R1 cases mismatch by design: their expectation says so.)
function precheck(): void {
  const script = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
  const cases = spawnSync(process.execPath, [script("./repro/run.ts")], { encoding: "utf8", maxBuffer: 1 << 26 });
  const casesLast = (cases.stdout ?? "").trim().split("\n").pop() ?? "";
  console.log(`[precheck] repro/run.ts exit ${cases.status}: ${casesLast}`);
  let failed = cases.status !== 0;
  for (const m of ["wysiwyg", "ir"] as Mode[]) {
    const sw = spawnSync(process.execPath, [script("./repro/sweep.ts"), `--mode=${m}`, "--len=2"], { encoding: "utf8", maxBuffer: 1 << 26 });
    const out = sw.stdout ?? "";
    const unexplained = /unexplained by leading-Unicode-whitespace strip: (\d+)/.exec(out);
    const counts = /mode=\S+ config=\S+ documents=\d+ mismatching=\d+/.exec(out);
    const n = unexplained ? Number(unexplained[1]) : -1;
    console.log(`[precheck] repro/sweep.ts --mode=${m} --len=2 exit ${sw.status}: ${counts ? counts[0] : "no summary"}; ${unexplained ? unexplained[0] : "no unexplained line"}`);
    if (sw.status !== 0 || n !== 0) failed = true;
  }
  if (failed) {
    console.log("[precheck] FAILED: aborting the fuzz");
    process.exit(1);
  }
}


// ---------------------------------------------------------------- --check=replay (tasks/004 (f) item 7, milestone A)
// For every generated document, the output of the public method (the uncached call) must equal the replay of the operations that
// the recording renderer logged for the same document: the stages of the public method, the recording renderer, then
// ReplayFormatLogs. The LastOut after every top-level node is compared too. No cache is involved.
function replayText(lute: Lute, mode: Mode, html: string, lastOutOk: { value: boolean }): string {
  const input = html.split(editor.Zwsp).join("");
  const root = mode === "wysiwyg" ? vditorDOM2MdPrepare(lute, input) : vditorIRDOM2MdPrepare(lute, input);
  if (root === null) return "";
  const tree = mode === "wysiwyg" ? vditorDOM2MdBuildTree(lute, root) : vditorIRDOM2MdBuildTree(lute, root);
  const options = mode === "wysiwyg" ? vditorDOM2MdRenderOptions() : vditorIRDOM2MdRenderOptions();
  const [, logs] = render.NewRecordingFormatRenderer(tree, options, lute.ParseOptions).RenderWithLogs();
  const trace = render.ReplayFormatLogsTrace(logs);
  lastOutOk.value = trace.lastOuts.length === logs.pieces.length && trace.lastOuts.every((v, i) => v === logs.pieces[i].lastOut);
  return conv.StringFromBytes(trace.output).split(editor.Zwsp).join("");
}

// replayOnce compares the replay of one document with the uncached call; it returns true when they are equal (after the
// node-ID normalisation of `same`, which is counted apart).
function replayOnce(port: Suite["port"], mode: Mode, html: string, t: Totals, onMismatch: (m: MismatchInfo) => void): boolean {
  const want = run(() => (mode === "wysiwyg" ? port.VditorDOM2Md(html) : port.VditorIRDOM2Md(html)));
  const lastOutOk = { value: true };
  const got = run(() => replayText(port, mode, html, lastOutOk));
  let eq = same(got, want);
  const norm = eq && lastWasNormalised;
  t.comparisons++;
  if (norm) t.idNormalisedComposed++;
  if (!eq) {
    const d = describeMismatch(got, want);
    t.mismatches++;
    bump(t.causes, d.cause);
    onMismatch({ ...d, fell: false, cold: false });
  } else if (!lastOutOk.value) {
    // the bytes agree but LastOut after a top-level node does not: the log does not express it
    t.mismatches++;
    bump(t.causes, "lastout-after-piece");
    onMismatch({ cause: "lastout-after-piece", offset: 0, byteOffset: 0, cachedCps: "replay", wantCps: "replay", cachedWindow: "", wantWindow: "", fell: false, cold: false });
    eq = false;
  }
  return eq;
}

function replaySuite(s: Suite, budget: number, t: Totals, ctx: Ctx): void {
  const label = `replay/${s.mode}/${s.cfg.name}`;
  let done = 0;
  while (done < budget) {
    t.docs++;
    let doc = startDoc(s);
    const steps = 8 + ri(20);
    let protyle = s.cfg.protyle === true;
    s.port.SetProtyleWYSIWYG(protyle);
    const seq = ++ctx.seq;
    let inEpisode = false;
    for (let step = 0; step <= steps && done < budget; step++) {
      let op = "start";
      if (step > 0) {
        const e = applyEdit(doc, s.pool);
        doc = e.doc;
        op = e.op;
        t.edits++;
        bump(t.opCounts, op);
      }
      if (step > 0 && rnd() < 0.05) {
        protyle = !protyle;
        s.port.SetProtyleWYSIWYG(protyle);
        bump(t.opCounts, "option-toggle");
      }
      const list: Doc = doc;
      const html = list.join("");
      const eq = replayOnce(s.port, s.mode, html, t, (m) => {
        const newEpisode = !inEpisode;
        console.log(`MISMATCH ${label} seq=${seq} step=${step} op=${op} ${newEpisode ? "episode-start" : "episode-continued"} cause=${m.cause} offset=${m.offset} (utf8 byte ${m.byteOffset}) replay=${m.cachedCps} uncached=${m.wantCps}`);
        const key = `replay|${s.mode}|${m.cause}|${m.offset === 0 ? "offset 0" : "offset > 0"}`;
        if (ctx.reps.has(key)) return;
        ctx.reps.add(key);
        const bad = (d: Doc): boolean => {
          const h = d.join("");
          const x = run(() => (s.mode === "wysiwyg" ? s.port.VditorDOM2Md(h) : s.port.VditorIRDOM2Md(h)));
          const y = run(() => replayText(s.port, s.mode, h, { value: true }));
          return !same(x, y);
        };
        const min = bad(list) ? reduce(list, bad) : list;
        const mh = min.join("");
        ctx.detail.push([`REPLAY REPRESENTATIVE ${key}; first seen ${label} seq=${seq} step=${step} op=${op}; document has ${list.length} children`, `  replay:  ${m.cachedWindow}`, `  uncached: ${m.wantWindow}`, `  MINIMAL ${min.length} children: ${JSON.stringify(min)}`, `    html: ${JSON.stringify(mh).slice(0, 600)}`].join("\n"));
      });
      if (!eq && !inEpisode) t.episodes++;
      inEpisode = !eq;
      done++;
    }
  }
}

function runReplayCheck(modes: Mode[], corpus: Corpus, total: number): void {
  const t0 = performance.now();
  for (const mode of modes) {
    const totals = newTotals();
    const ctx: Ctx = { mode, reps: new Set<string>(), detail: [], seq: 0 };
    const cfgFilter = args.get("config");
    const cfgs = CONFIGS.filter((c) => !cfgFilter || c.name === cfgFilter);
    const suites = cfgs.map((c) => buildSuite(c, mode, corpus));
    const per = Math.max(1, Math.floor(total / suites.length));
    for (const s of suites) {
      replaySuite(s, per, totals, ctx);
    }
    console.log(`\n== replay ${mode} docs=${totals.docs} edits=${totals.edits} comparisons=${totals.comparisons} mismatches=${totals.mismatches} episodes=${totals.episodes} equal-only-after-ID-normalisation=${totals.idNormalisedComposed}`);
    console.log(`mismatches by cause: ${[...totals.causes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("; ") || "none"}`);
    console.log("ops:", [...totals.opCounts].map(([k, v]) => `${k}=${v}`).join(" "));
    for (const r of ctx.detail) console.log(r);
  }
  console.log(`elapsed ${(performance.now() - t0).toFixed(0)} ms`);
}

function main(): void {
  if (!args.has("no-precheck") && args.get("report") !== "real" && IMPL === "prototype") precheck();
  rnd = mulberry32(argNum("seed", 1));
  const modes: Mode[] = args.get("mode") === "wysiwyg" ? ["wysiwyg"] : args.get("mode") === "ir" ? ["ir"] : ["wysiwyg", "ir"];
  const ALL: Pass[] = IMPL === "prototype" ? ["warm", "cold", "shared"] : ["warm", "cold", "shared", "evict"];
  const requested = args.get("pass") ?? "all";
  const passes: Pass[] = requested === "all" ? ALL : [requested as Pass];
  if (passes.some((p) => !ALL.includes(p))) throw new Error(`--pass=${requested} is not available for --impl=${IMPL}`);
  const total = argNum("cmp", 5000); // per mode, split over passes and configs
  const mutation = process.env.D2M_CACHED ? "mutated module" : "none";
  const cfgFilter = args.get("config");
  const corpusArg = args.get("corpus-snapshot") ?? null;
  const corpus = loadCorpus(corpusArg);
  const realCount = corpus.mds.filter((m) => m.real).length;
  console.log(`markdown corpus: ${corpus.mds.length} documents (${realCount} real files); hand-written DOM: wysiwyg ${corpus.hand.wysiwyg.length}, ir ${corpus.hand.ir.length}`);
  console.log(`corpus sha256 ${corpus.hash} (${corpus.source}${corpusArg !== null ? "; snapshot file " + corpusArg : ""})`);
  console.log(`implementation: ${IMPL === "engine" ? "src/incremental through engine-adapter.ts" : "prototype cached.ts (" + mutation + ")"}; passes: ${passes.join(",")}; channel weight ${CHANNEL_WEIGHT}`);

  if (args.get("report") === "real") {
    reportReal(modes, corpus.mds);
    return;
  }
  if (args.get("check") === "replay") {
    runReplayCheck(modes, corpus, total);
    return;
  }

  const t0 = performance.now();
  for (const mode of modes) {
    const totals = newTotals();
    const passTotals = new Map<string, Totals>();
    const ctx: Ctx = { mode, reps: new Set<string>(), detail: [], seq: 0 };
    const cfgs = CONFIGS.filter((c) => !cfgFilter || c.name === cfgFilter);
    const suites = cfgs.map((c) => buildSuite(c, mode, corpus));
    for (const s of suites) {
      const splittable = s.docs.filter((d) => d.children).length;
      console.log(`${mode}/${s.cfg.name}: ${s.docs.length} forward documents, ${splittable} splittable, child pool ${s.pool.length}, hand-written DOM docs ${s.hand.length}`);
    }
    const per = Math.max(1, Math.floor(total / (suites.length * passes.length)));
    for (const s of suites) {
      for (const pass of passes) {
        // shared and evict: one engine per option set, for all sequences of the pass (evict with the 32 KiB bound)
        const sh = pass === "shared" || pass === "evict" ? makeUnder(s, pass === "evict" ? EVICT_BYTES : undefined) : null;
        if (!passTotals.has(pass)) passTotals.set(pass, newTotals());
        fuzzSuite(s, pass, per, sh, totals, passTotals.get(pass)!, ctx);
      }
    }
    console.log(`\n== ${mode} (mutation=${mutation}) docs=${totals.docs} edits=${totals.edits} comparisons=${totals.comparisons} composed=${totals.composed} fallback=${totals.fallback} mismatches=${totals.mismatches} episodes=${totals.episodes} splitAudits=${totals.splitAudits} splitDisagreements=${totals.splitDisagreements} inconsistencies=${totals.inconsistencies}`);
    console.log(`mismatches by cause: ${[...totals.causes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("; ") || "none"}; cold-reproducible: ${totals.coldReproduced} of ${totals.mismatches}`);
    console.log(`comparisons equal only after node-ID normalisation: fallback path ${totals.idNormalisedFallback}, composed path ${totals.idNormalisedComposed}`);
    for (const [pn, pt] of passTotals) {
      const bytes = IMPL === "engine" ? "bytes probed n/a (the engine keeps no per-miss byte counter)" : `bytes probed ${pt.missBytes} of ${pt.totalBytes} (${(100 * pt.missBytes / Math.max(1, pt.totalBytes)).toFixed(1)}%)`;
      console.log(`   pass ${pn}: comparisons=${pt.comparisons} composed=${pt.composed} fallback=${pt.fallback} mismatches=${pt.mismatches} episodes=${pt.episodes} causes=${[...pt.causes].map(([k, v]) => `${k}=${v}`).join(",") || "none"}; composed calls: children=${pt.children} cache hits=${pt.hits} (${(100 * pt.hits / Math.max(1, pt.children)).toFixed(1)}%) misses=${pt.misses}; ${bytes}`);
      if (IMPL === "engine") {
        const reasons = pt.inconsistencyReasons.size ? " " + JSON.stringify(Object.fromEntries(pt.inconsistencyReasons)) : "";
        console.log(`   pass ${pn} engine: evictions=${pt.evictions} too-large=${pt.tooLarge} inconsistencies=${pt.inconsistencies}${reasons}${pn === "evict" && pt.evictions === 0 ? " VACUOUS: no eviction happened" : ""}`);
      }
    }
    console.log("ops:", [...totals.opCounts].map(([k, v]) => `${k}=${v}`).join(" "));
    console.log("fallback reasons:", [...totals.fallbackReasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("; "));
    for (const r of ctx.detail) console.log(r);
  }
  console.log(`elapsed ${(performance.now() - t0).toFixed(0)} ms`);
}

function reportReal(modes: Mode[], mds: MdDoc[]): void {
  for (const mode of modes) {
    for (const cfg of CONFIGS) {
      const { port } = engines(cfg, mode);
      const docs = buildDomDocs(cfg, mode, mds);
      const c = makeUnder({ cfg, mode, port }, undefined);
      const reasons = new Map<string, number>();
      let real = 0;
      let realFallback = 0;
      let unit = 0;
      let unitFallback = 0;
      let childrenReal = 0;
      let mism = 0;
      const realLines: string[] = [];
      for (const d of docs) {
        const before = c.stats.fallbackCalls;
        const got = run(() => c.convert(d.html));
        const want = run(() => c.uncached(d.html));
        if (!same(got, want)) mism++;
        const fell = c.stats.fallbackCalls > before;
        if (d.real) {
          real++;
          if (fell) {
            realFallback++;
            realLines.push(`    ${d.name}: ${c.lastFallbackReason}`);
          }
          childrenReal += d.children?.length ?? 0;
        } else {
          unit++;
          if (fell) {
            unitFallback++;
            bump(reasons, c.lastFallbackReason);
          }
        }
      }
      console.log(`${mode}/${cfg.name}: real files ${real}, fallback ${realFallback}; unit-test snippets ${unit}, fallback ${unitFallback}; mismatches ${mism}`);
      for (const l of realLines) console.log(l);
      console.log("    snippet fallback reasons:", [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`).join("; "));
    }
  }
}

main();
