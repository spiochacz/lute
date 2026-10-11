// Differential fuzzer for CachedDom2Md.
//
//   node fuzz.ts --mode=wysiwyg|ir|both --pass=warm|cold|shared|all --cmp=50000 --seed=1 [--mutate=constsep|...]
//   node fuzz.ts --report=real        fallback rate on whole documents (no edits)
//
// Documents come from the reference bundle's forward methods (Md2VditorDOM / Md2VditorIRDOM) applied
// to the repository's Markdown corpora and split into top-level children. Edits are applied to the
// children list (structural) or to the HTML of one child (typing-like). After every edit
// cached(doc) is compared byte for byte with the uncached engine call. A comparison where the
// cached path took a fallback is counted separately: it proves nothing about the composition rule.

import { util } from "../../src/index.ts";
import { normalizeIDs } from "../../test/oracle/oracle.ts";
import type { CachedDom2Md, Mode } from "./cached.ts";
import { splitTopLevel } from "./scan.ts";
import { CONFIGS, buildDomDocs, engines, loadHandWrittenDom, loadMarkdownCorpus } from "./corpus.ts";
import type { Config, DomDoc } from "./corpus.ts";

// The module under test: ./cached.ts, or (negative controls) a mutated copy named by $D2M_CACHED.
const cachedModule = (await import(process.env.D2M_CACHED ?? "./cached.ts")) as typeof import("./cached.ts");
const CachedImpl = cachedModule.CachedDom2Md;

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
const TEXT_INSERTS = ["\u00a0", "\u3000", "\u000b", "\u000c", "\u2028", "a", "b", " ", "  ", "\n", "# ", "## ", "- ", "1. ", "> ", "```", "$$", "|", "*", "_", "`", "~", "\t", "\t\n", "    \n", "​", "‸", "<wbr>", "&amp;", "&lt;", "é", "中", "[x]", "[^1]", " \n", "\n\n", "---", "="];

// indexes of text runs (outside tags) in a child's HTML
function textRuns(h: string): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < h.length) {
    if (h.charCodeAt(i) === 60) {
      // skip tag, quote aware
      let j = i + 1;
      let q = 0;
      while (j < h.length) {
        const c = h.charCodeAt(j);
        if (q) {
          if (c === q) q = 0;
        } else if (c === 34 || c === 39) q = c;
        else if (c === 62) break;
        j++;
      }
      i = j + 1;
    } else {
      let j = i;
      while (j < h.length && h.charCodeAt(j) !== 60) j++;
      runs.push([i, j]);
      i = j;
    }
  }
  return runs;
}

function tagPositions(h: string): number[] {
  const p: number[] = [];
  for (let i = 0; i < h.length; i++) if (h.charCodeAt(i) === 60 || h.charCodeAt(i) === 62) p.push(i);
  return p;
}

function editChildText(h: string): string {
  const runs = textRuns(h);
  const op = ri(12);
  if (op === 0) {
    // caret between arbitrary tokens
    // only at tag boundaries (after a ">" or before a "<"), as a browser would put it
    const tp = tagPositions(h);
    const k = tp.length ? tp[ri(tp.length)] : 0;
    const at = h.charCodeAt(k) === 62 ? k + 1 : k;
    return h.slice(0, at) + "<wbr>" + h.slice(at);
  }
  if (runs.length === 0) return h;
  if (op === 1) {
    // space at the end of the last text run
    const r = runs[runs.length - 1];
    return h.slice(0, r[1]) + " " + h.slice(r[1]);
  }
  if (op === 2) {
    const r = runs[0];
    return h.slice(0, r[0]) + " " + h.slice(r[0]);
  }
  if (op === 3) {
    const r = runs[0];
    return h.slice(0, r[0]) + "# " + h.slice(r[0]);
  }
  if (op === 4) {
    const r = pick(runs);
    return h.slice(0, r[1]) + "\n" + h.slice(r[1]);
  }
  if (op === 5) {
    // delete a char
    const r = pick(runs);
    if (r[1] > r[0]) {
      const at = r[0] + ri(r[1] - r[0]);
      return h.slice(0, at) + h.slice(at + 1);
    }
    return h;
  }
  if (op === 6) {
    // <br> inside a text run (soft/hard break)
    const r = pick(runs);
    const at = r[0] + ri(r[1] - r[0] + 1);
    return h.slice(0, at) + "<br>" + h.slice(at);
  }
  const r = pick(runs);
  const at = r[0] + ri(r[1] - r[0] + 1);
  return h.slice(0, at) + pick(TEXT_INSERTS) + h.slice(at);
}

const WRAPPED = /^<(p|h[1-6])\b([^>]*)>([\s\S]*)<\/\1>$/;
const LIST = /^<(ul|ol)\b([^>]*)>([\s\S]*)<\/\1>$/;

function restyleTag(h: string): string {
  const m = WRAPPED.exec(h);
  if (!m) return h;
  const nt = pick(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);
  return "<" + nt + m[2] + ">" + m[3] + "</" + nt + ">";
}

function listAttrVariant(h: string): string {
  const m = LIST.exec(h);
  if (!m) return h;
  const attrs = pick(["", ' data-tight="true"', ' data-marker="*" data-tight="true"', ' data-block="0"', ' data-tight="false" data-block="0" data-marker="-"']);
  return "<" + m[1] + attrs + ">" + m[3] + "</" + m[1] + ">";
}

function mergeTwo(a: string, b: string): string | null {
  const ma = WRAPPED.exec(a);
  const mb = WRAPPED.exec(b);
  if (ma && mb) return "<" + ma[1] + ma[2] + ">" + ma[3] + mb[3] + "</" + ma[1] + ">";
  const la = LIST.exec(a);
  const lb = LIST.exec(b);
  if (la && lb) return "<" + la[1] + la[2] + ">" + la[3] + lb[3] + "</" + la[1] + ">";
  return null;
}

function splitOne(h: string): string[] | null {
  const m = WRAPPED.exec(h);
  if (m) {
    const runs = textRuns(m[3]);
    if (runs.length === 0) return null;
    const r = pick(runs);
    const at = r[0] + ri(r[1] - r[0] + 1);
    const open = "<" + m[1] + m[2] + ">";
    const close = "</" + m[1] + ">";
    return [open + m[3].slice(0, at) + close, open + m[3].slice(at) + close];
  }
  const l = LIST.exec(h);
  if (l) {
    const cuts: number[] = [];
    let i = -1;
    while ((i = l[3].indexOf("</li><li", i + 1)) >= 0) cuts.push(i + 5);
    if (cuts.length === 0) return null;
    const at = pick(cuts);
    const open = "<" + l[1] + (ri(3) === 0 ? ' data-tight="true"' : l[2]) + ">";
    const open2 = "<" + l[1] + (ri(3) === 0 ? ' data-tight="true"' : l[2]) + ">";
    const close = "</" + l[1] + ">";
    return [open + l[3].slice(0, at) + close, open2 + l[3].slice(at) + close];
  }
  return null;
}

// Junk that is only present for one comparison (the editor's DOM is never left in such a state for long) ...
const TRANSIENT_FILLERS = ["\n", " ", "text", "<wbr>", "<!-- c -->", "\u200b", "<div></div>", "<span>s</span>"];
// ... and empty blocks that stay in the document (they are composable: the engine drops them).
const EMPTY_BLOCKS = ["<p></p>", "<p data-block=\"0\"></p>", "<ul></ul>", "<ol data-block=\"0\"></ol>", "<blockquote data-block=\"0\"></blockquote>", "<h2 data-block=\"0\"></h2>", "<ul data-tight=\"true\" data-block=\"0\"><li></li></ul>", "<hr>"];

type Doc = string[];

function applyEdit(doc0: Doc, pool: string[], lists: string[]): { doc: Doc; op: string; view?: Doc } {
  let doc = doc0;
  // repair: the document the editor shows has no stray top-level junk for long
  if (rnd() < 0.6) {
    const bad = doc.findIndex((c) => {
      const sp = splitTopLevel(c);
      return !sp.ok || sp.children.length !== 1 || (/^(span|wbr|div)$/.test(sp.children[0].tag) && !/data-type=/.test(c));
    });
    if (bad >= 0 && doc.length > 1) {
      doc = doc.slice();
      doc.splice(bad, 1);
    }
  }
  const d = doc.slice();
  const n = d.length;
  const op = ri(100);
  if (op >= 90) {
    // targeted: the sibling-dependent rules need specific neighbourhoods that random edits rarely build
    const kind = ri(4);
    if (kind === 0) {
      // a <p> with <br> followed by a list / blockquote / empty list / empty blockquote / hr
      const nextPick = pick(["<ul></ul>", "<ol data-block=\"0\"></ol>", "<blockquote data-block=\"0\"></blockquote>", "<ul data-tight=\"true\" data-block=\"0\"><li data-marker=\"*\">z</li></ul>", "<blockquote data-block=\"0\"><p data-block=\"0\">z</p></blockquote>", "<hr>", "<ol data-block=\"0\"><li>z</li></ol>"]);
      const at = ri(n + 1);
      d.splice(at, 0, '<p data-block="0">a<br>b' + (rnd() < 0.5 ? "<br>" : "") + "</p>", nextPick);
      return { doc: d, op: "targeted-br-next" };
    }
    if (kind === 1) {
      d.push(pick(EMPTY_BLOCKS));
      return { doc: d, op: "targeted-trailing-empty" };
    }
    if (kind === 2) {
      const cand = pool.filter((c) => LIST.test(c) && c.includes("code-block"));
      if (cand.length) d.push(pick(cand));
      else d.push(pick(pool));
      if (rnd() < 0.7) d.push(pick(EMPTY_BLOCKS));
      return { doc: d, op: "targeted-list-code-then-empty" };
    }
    // a list/blockquote with nested blocks at the end, then a dead sibling in the middle of two lists
    const l = pick(lists);
    const at = ri(n + 1);
    d.splice(at, 0, l, pick(["<ul></ul>", "<ol></ol>", "<ul data-block=\"0\"></ul>"]), rnd() < 0.5 ? l : pick(lists));
    return { doc: d, op: "targeted-lists-around-dead" };
  }
  if (op < 24 && n > 0) {
    const i = ri(n);
    d[i] = editChildText(doc[i]);
    return { doc: d, op: "text" };
  }
  if (op < 32 && n > 0) {
    d[ri(n)] = pick(pool);
    return { doc: d, op: "replace" };
  }
  if (op < 40) {
    d.splice(ri(n + 1), 0, pick(pool));
    return { doc: d, op: "insert" };
  }
  if (op < 46 && n > 1) {
    d.splice(ri(n), 1);
    return { doc: d, op: "delete" };
  }
  if (op < 52 && n > 0) {
    const i = ri(n);
    d.splice(i, 0, d[i]);
    return { doc: d, op: "duplicate" };
  }
  if (op < 58 && n > 1) {
    const i = ri(n);
    const j = ri(n);
    [d[i], d[j]] = [d[j], d[i]];
    return { doc: d, op: "swap" };
  }
  if (op < 64 && n > 1) {
    const i = ri(n - 1);
    const m = mergeTwo(d[i], d[i + 1]);
    if (m !== null) {
      d.splice(i, 2, m);
      return { doc: d, op: "merge" };
    }
    return { doc: d, op: "merge-none" };
  }
  if (op < 70 && n > 0) {
    const i = ri(n);
    const s = splitOne(d[i]);
    if (s !== null) {
      d.splice(i, 1, s[0], s[1]);
      return { doc: d, op: "split" };
    }
    return { doc: d, op: "split-none" };
  }
  if (op < 80) {
    // move a list next to another list (or insert a list next to a list)
    const li = d.findIndex((c) => LIST.test(c));
    const L = LIST.test(d[li] ?? "") ? d[li] : pick(lists);
    if (li >= 0 && rnd() < 0.5) {
      d.splice(li, 1);
    }
    const targets = d.map((c, i) => (LIST.test(c) ? i : -1)).filter((i) => i >= 0);
    const at = targets.length ? pick(targets) + (ri(2) ? 1 : 0) : ri(d.length + 1);
    d.splice(at, 0, rnd() < 0.5 ? L : listAttrVariant(L));
    return { doc: d, op: "move-list" };
  }
  if (op < 85 && n > 0) {
    const i = ri(n);
    d[i] = rnd() < 0.5 ? listAttrVariant(d[i]) : restyleTag(d[i]);
    return { doc: d, op: "restyle" };
  }
  if (op < 88) {
    if (rnd() < 0.5) {
      const v = doc.slice();
      v.splice(ri(n + 1), 0, pick(TRANSIENT_FILLERS));
      return { doc, op: "transient-junk", view: v };
    }
    d.splice(ri(n + 1), 0, pick(EMPTY_BLOCKS));
    return { doc: d, op: "empty-block" };
  }
  // several quick text edits in different children (typing burst)
  for (let k = 0; k < 2 && n > 0; k++) {
    const i = ri(n);
    d[i] = editChildText(d[i]);
  }
  return { doc: d, op: "burst" };
}

// ---------------------------------------------------------------- splitter audit against the engine's parser
const ATOM_NAME_CACHE = new Map<string, true>();
function auditSplit(html: string): string | null {
  const sp = splitTopLevel(html);
  if (!sp.ok) return null;
  const root = util.ParseHTML(html);
  if (root === null) return "ParseHTML returned null";
  const kids: Array<{ Data: string; Attr: unknown[]; Type: number }> = [];
  for (let c = root.FirstChild; c !== null; c = c.NextSibling) kids.push(c as never);
  if (kids.length !== sp.children.length) return `child count: scanner ${sp.children.length}, parser ${kids.length}`;
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].Data !== sp.children[i].tag) return `child ${i}: scanner <${sp.children[i].tag}>, parser ${kids[i].Data}`;
    if (kids[i].Attr.length !== sp.children[i].attrs) {
      // duplicate attributes are dropped by the parser; only count those as disagreements when no duplicates
      return `child ${i}: attr count scanner ${sp.children[i].attrs}, parser ${kids[i].Attr.length}`;
    }
  }
  ATOM_NAME_CACHE.clear();
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
}
const newTotals = (): Totals => ({ docs: 0, edits: 0, comparisons: 0, composed: 0, fallback: 0, mismatches: 0, splitAudits: 0, splitDisagreements: 0, opCounts: new Map(), fallbackReasons: new Map(), hits: 0, misses: 0, children: 0, idNormalisedFallback: 0, idNormalisedComposed: 0, missBytes: 0, totalBytes: 0 });
const bump = (m: Map<string, number>, k: string, by = 1): void => void m.set(k, (m.get(k) ?? 0) + by);

interface Suite {
  cfg: Config;
  mode: Mode;
  port: ReturnType<typeof engines>["port"];
  docs: DomDoc[];
  pool: string[];
  lists: string[];
  hand: string[];
}

function buildSuite(cfg: Config, mode: Mode, mds: ReturnType<typeof loadMarkdownCorpus>): Suite {
  const { port } = engines(cfg, mode);
  const docs = buildDomDocs(cfg, mode, mds);
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
  for (const h of loadHandWrittenDom(mode)) {
    const sp = splitTopLevel(h);
    if (sp.ok) for (const c of sp.children) { const t = h.substring(c.start, c.end); if (!seen.has(t)) { seen.add(t); pool.push(t); } }
  }
  // children whose output depends on an engine option (ProtyleWYSIWYG turns a literal "<br>" in text into a newline)
  pool.push('<p data-block="0">x&lt;br&gt;y</p>', '<p data-block="0">a&lt;br /&gt;b&lt;br/&gt;c</p>');
  const lists = pool.filter((c) => LIST.test(c));
  return { cfg, mode, port, docs, pool, lists, hand: loadHandWrittenDom(mode) };
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

function compareOnce(c: CachedDom2Md, html: string, ts: Totals[], ctxName: string, doc: Doc | null, onMismatch: (info: string) => void): void {
  const st = c.stats;
  const before = { fb: st.fallbackCalls, ch: st.children, hit: st.hits, miss: st.misses, mb: st.missBytes, tb: st.totalBytes };
  const got = run(() => c.convert(html));
  const fell = st.fallbackCalls > before.fb;
  const want = run(() => c.uncached(html));
  const aud = fell ? null : auditSplit(html);
  if (aud !== null) {
    console.log(`SPLIT DISAGREEMENT [${ctxName}] ${aud}\n  html: ${JSON.stringify(html.slice(0, 400))}`);
  }
  const eq = same(got, want);
  const norm = eq && lastWasNormalised;
  for (const t of ts) {
    t.comparisons++;
    if (fell) {
      t.fallback++;
      bump(t.fallbackReasons, c.lastFallbackReason);
    } else {
      t.composed++;
      t.splitAudits++;
      t.children += st.children - before.ch;
      t.hits += st.hits - before.hit;
      t.misses += st.misses - before.miss;
      t.missBytes += st.missBytes - before.mb;
      t.totalBytes += st.totalBytes - before.tb;
    }
    if (aud !== null) t.splitDisagreements++;
    if (norm) {
      if (fell) t.idNormalisedFallback++;
      else t.idNormalisedComposed++;
    }
    if (!eq) t.mismatches++;
  }
  if (!eq) {
    onMismatch(`[${ctxName}] cached ${JSON.stringify(got).slice(0, 300)}\n            want   ${JSON.stringify(want).slice(0, 300)}`);
  }
}

function fuzzSuite(s: Suite, pass: "warm" | "cold" | "shared", budget: number, mutation: string, shared: CachedDom2Md | null, t: Totals, tp: Totals, report: string[]): void {
  const label = `${s.mode}/${s.cfg.name}/${pass}`;
  const mk = (): CachedDom2Md => new CachedImpl(s.port, s.mode);
  let cacheForSeq = shared ?? mk();
  let done = 0;
  let reported = 0;
  while (done < budget) {
    t.docs++;
    tp.docs++;
    let doc = startDoc(s);
    if (pass === "warm") cacheForSeq = mk();
    const steps = 8 + ri(20);
    let protyle = s.cfg.protyle === true;
    s.port.SetProtyleWYSIWYG(protyle);
    for (let step = 0; step <= steps && done < budget; step++) {
      let op = "start";
      let view: Doc | null = null;
      if (step > 0) {
        const e = applyEdit(doc, s.pool, s.lists.length ? s.lists : s.pool);
        doc = e.doc;
        op = e.op;
        view = e.view ?? null;
        t.edits++;
        tp.edits++;
        bump(t.opCounts, op);
      }
      if (step > 0 && rnd() < 0.05) {
        // the host changes an engine option between two calls (Vditor does: outlineRender.ts toggles SetToC)
        protyle = !protyle;
        s.port.SetProtyleWYSIWYG(protyle);
        bump(t.opCounts, "option-toggle");
      }
      const html = (view ?? doc).join("");
      const c = pass === "cold" ? mk() : cacheForSeq;
      const mBefore = t.mismatches;
      compareOnce(c, html, [t, tp], `${label} op=${op}`, doc, (info) => {
        if (reported < 3 && report.length < 20) {
          reported++;
          // reduce with a cold cache
          const bad = (d: Doc): boolean => {
            const h = d.join("");
            const cc = mk();
            return !same(run(() => cc.convert(h)), run(() => cc.uncached(h)));
          };
          let msg = info + "\n  document has " + doc.length + " children";
          if (bad(doc)) {
            const min = reduce(doc, bad);
            const h = min.join("");
            const cc = mk();
            msg += `\n  MINIMAL (cold) ${min.length} children: ${JSON.stringify(min)}\n    cached: ${JSON.stringify(run(() => cc.convert(h)))}\n    want:   ${JSON.stringify(run(() => cc.uncached(h)))}`;
          } else {
            msg += "\n  not reproducible with a cold cache (warm-state dependent); doc=" + JSON.stringify(doc).slice(0, 1500);
          }
          report.push(msg);
        }
      });
      done++;
      if (pass === "cold" || mutation !== "none") {
        // keep going; mismatches are counted
      }
      void mBefore;
    }
    if (cacheForSeq !== null && pass !== "cold") {
      t.hits += 0;
    }
  }
  const stats = (pass === "cold" ? null : cacheForSeq)?.stats;
  void stats;
}

function main(): void {
  rnd = mulberry32(argNum("seed", 1));
  const modes: Mode[] = args.get("mode") === "wysiwyg" ? ["wysiwyg"] : args.get("mode") === "ir" ? ["ir"] : ["wysiwyg", "ir"];
  const passes = args.get("pass") === "warm" ? ["warm"] : args.get("pass") === "cold" ? ["cold"] : args.get("pass") === "shared" ? ["shared"] : ["warm", "cold", "shared"];
  const total = argNum("cmp", 5000); // per mode, split over passes and configs
  const mutation = process.env.D2M_CACHED ? "mutated module" : "none";
  const cfgFilter = args.get("config");
  const mds = loadMarkdownCorpus();
  console.log(`markdown corpus: ${mds.length} documents (${mds.filter((m) => m.real).length} real files)`);

  if (args.get("report") === "real") {
    reportReal(modes, mds);
    return;
  }

  const t0 = performance.now();
  for (const mode of modes) {
    const totals = newTotals();
    const passTotals = new Map<string, Totals>();
    const reports: string[] = [];
    const cfgs = CONFIGS.filter((c) => !cfgFilter || c.name === cfgFilter);
    const suites = cfgs.map((c) => buildSuite(c, mode, mds));
    for (const s of suites) {
      const splittable = s.docs.filter((d) => d.children).length;
      console.log(`${mode}/${s.cfg.name}: ${s.docs.length} forward documents, ${splittable} splittable, child pool ${s.pool.length}, lists ${s.lists.length}, hand-written DOM docs ${s.hand.length}`);
    }
    const per = Math.max(1, Math.floor(total / (suites.length * passes.length)));
    const sharedCaches = new Map<string, CachedDom2Md>();
    for (const s of suites) {
      for (const pass of passes as Array<"warm" | "cold" | "shared">) {
        let sh: CachedDom2Md | null = null;
        if (pass === "shared") {
          // one cache for all unrelated documents AND all option sets of this mode
          const key = mode;
          if (!sharedCaches.has(key)) sharedCaches.set(key, new CachedImpl(s.port, mode));
          sh = sharedCaches.get(key)!;
          // the shared cache is bound to the port engine of the first suite; rebind for this suite
          (sh as unknown as { lute: unknown }).lute = s.port;
        }
        if (!passTotals.has(pass)) passTotals.set(pass, newTotals());
        fuzzSuite(s, pass, per, mutation, sh, totals, passTotals.get(pass)!, reports);
      }
    }
    console.log(`\n== ${mode} (mutation=${mutation}) docs=${totals.docs} edits=${totals.edits} comparisons=${totals.comparisons} composed=${totals.composed} fallback=${totals.fallback} mismatches=${totals.mismatches} splitAudits=${totals.splitAudits} splitDisagreements=${totals.splitDisagreements}`);
    console.log(`comparisons equal only after node-ID normalisation: fallback path ${totals.idNormalisedFallback}, composed path ${totals.idNormalisedComposed}`);
    for (const [pn, pt] of passTotals) {
      console.log(`   pass ${pn}: comparisons=${pt.comparisons} composed=${pt.composed} fallback=${pt.fallback} mismatches=${pt.mismatches}; composed calls: children=${pt.children} cache hits=${pt.hits} (${(100 * pt.hits / Math.max(1, pt.children)).toFixed(1)}%) misses=${pt.misses}; bytes probed ${pt.missBytes} of ${pt.totalBytes} (${(100 * pt.missBytes / Math.max(1, pt.totalBytes)).toFixed(1)}%)`);
    }
    console.log("ops:", [...totals.opCounts].map(([k, v]) => `${k}=${v}`).join(" "));
    console.log("fallback reasons:", [...totals.fallbackReasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("; "));
    for (const r of reports) console.log(r);
  }
  console.log(`elapsed ${(performance.now() - t0 / 1).toFixed(0)} ms (since process start offset ${(t0).toFixed(0)})`);
}

function reportReal(modes: Mode[], mds: ReturnType<typeof loadMarkdownCorpus>): void {
  for (const mode of modes) {
    for (const cfg of CONFIGS) {
      const { port } = engines(cfg, mode);
      const docs = buildDomDocs(cfg, mode, mds);
      const c = new CachedImpl(port, mode);
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
