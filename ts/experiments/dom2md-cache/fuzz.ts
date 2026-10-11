// Differential fuzzer for CachedDom2Md.
//
//   node fuzz.ts --mode=wysiwyg|ir|both --pass=warm|cold|shared|all --cmp=50000 --seed=1 [--corpus-snapshot=<file>] [--no-precheck]
//   node fuzz.ts --report=real        fallback rate on whole documents (no edits)
//   node fuzz.ts --check=replay --mode=... --cmp=5000 --seed=1   replay(log) against the uncached output for every generated document (no cache; tasks/004 (f) item 7)
// Before the fuzz, repro/run.ts and repro/sweep.ts --len=2 (both modes) run; the fuzz aborts if one of them fails (tasks/004 (f) item 5).
// --corpus-snapshot=<file> freezes the repository's Markdown and hand-written DOM: the file is written when absent and read when present.
// The corpus sha256 is printed. Every mismatch is printed as one MISMATCH line (cause, first differing UTF-16 offset with code points,
// whether a fresh cache reproduces it); one REPRESENTATIVE block with a cold reduction per (mode, cause, offset class).
//
// Documents come from the reference bundle's forward methods (Md2VditorDOM / Md2VditorIRDOM) applied
// to the repository's Markdown corpora and split into top-level children. Edits are applied to the
// children list (structural) or to the HTML of one child (typing-like). After every edit
// cached(doc) is compared byte for byte with the uncached engine call. A comparison where the
// cached path took a fallback is counted separately: it proves nothing about the composition rule.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { editor, render, util, vditorDOM2MdBuildTree, vditorDOM2MdPrepare, vditorDOM2MdRenderOptions, vditorIRDOM2MdBuildTree, vditorIRDOM2MdPrepare, vditorIRDOM2MdRenderOptions } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import * as conv from "../../src/runtime/conv.ts";
import { normalizeIDs } from "../../test/oracle/oracle.ts";
import type { CachedDom2Md, Mode } from "./cached.ts";
import { splitTopLevel } from "./scan.ts";
import { CONFIGS, buildDomDocs, engines, loadCorpus } from "./corpus.ts";
import type { Config, Corpus, DomDoc, MdDoc } from "./corpus.ts";

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

// The characters that Go's unicode.IsSpace (the set of strings.TrimSpace and bytes.TrimSpace in the engine) strips.
// The prototype's own trim strips only ASCII space, tab and LF, so these are the characters that expose R1 (tasks/004, (a)).
const GO_SPACE_CODES: number[] = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
const GO_SPACE_STRS: string[] = GO_SPACE_CODES.map((c) => String.fromCharCode(c));
const GO_SPACE_SET = new Set<number>(GO_SPACE_CODES);
const BLOCKQUOTE_START = /^<blockquote\b/;

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
  // tasks/004 (f) item 3: edits aimed at the first output bytes of the document and at its last block kind, about 3% each
  if (rnd() < 0.12) {
    const kind = ri(4);
    if (kind === 0) {
      // first-ws: a Go-space character (or two) at the start of the first text run of the first child that has text
      const ws = pick(GO_SPACE_STRS) + (rnd() < 0.5 ? "" : pick(GO_SPACE_STRS));
      const i = d.findIndex((c) => textRuns(c).length > 0);
      if (i < 0) {
        d.splice(0, 0, '<p data-block="0">' + ws + "</p>");
      } else {
        const r = textRuns(d[i])[0];
        d[i] = d[i].slice(0, r[0]) + ws + d[i].slice(r[0]);
      }
      return { doc: d, op: "first-ws" };
    }
    if (kind === 1) {
      // prepend-ws-paragraph: <p>X</p> at position 0, X a Go-space character alone or followed by text
      d.splice(0, 0, '<p data-block="0">' + pick(GO_SPACE_STRS) + (rnd() < 0.5 ? "a" : "") + "</p>");
      return { doc: d, op: "prepend-ws-paragraph" };
    }
    if (kind === 2) {
      // append-trimmer: a list or a blockquote from the pool, appended or inserted after position 0
      const trimmers = pool.filter((c) => LIST.test(c) || BLOCKQUOTE_START.test(c));
      const tr = trimmers.length ? pick(trimmers) : '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">z</li></ul>';
      if (rnd() < 0.5) d.push(tr);
      else d.splice(Math.min(1, d.length), 0, tr);
      return { doc: d, op: "append-trimmer" };
    }
    // empty-first: an empty paragraph, list or heading at position 0, before a whitespace paragraph
    d.splice(0, 0, pick(['<p data-block="0"></p>', '<ul data-block="0"></ul>', '<h2 data-block="0"></h2>']), '<p data-block="0">' + pick(GO_SPACE_STRS) + "a</p>");
    return { doc: d, op: "empty-first" };
  }
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
// The audit runs on the html after the two string replacements that convert() makes first (ZWSP, then the caret <wbr>),
// the same input the scanner and the parser see in the cache (fix (f) item 1; before, the audit saw the raw html and reported
// the caret-containing documents as disagreements, the class A of tasks/004 (a)).
function auditSplit(htmlRaw: string): string | null {
  const html = htmlRaw.split(editor.Zwsp).join("").split(editor.FrontEndCaret).join("");
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
  episodes: number; // runs of consecutive mismatching steps of one edit sequence (tasks/004 (f) item 6)
  causes: Map<string, number>; // mismatching comparisons by cause (see describeMismatch)
  coldReproduced: number; // mismatching comparisons that also mismatch with a fresh cache on the same html
}
const newTotals = (): Totals => ({ docs: 0, edits: 0, comparisons: 0, composed: 0, fallback: 0, mismatches: 0, splitAudits: 0, splitDisagreements: 0, opCounts: new Map(), fallbackReasons: new Map(), hits: 0, misses: 0, children: 0, idNormalisedFallback: 0, idNormalisedComposed: 0, missBytes: 0, totalBytes: 0, episodes: 0, causes: new Map(), coldReproduced: 0 });
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
  const lists = pool.filter((c) => LIST.test(c));
  return { cfg, mode, port, docs, pool, lists, hand };
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

function compareOnce(c: CachedDom2Md, html: string, ts: Totals[], ctxName: string, mk: () => CachedDom2Md, onMismatch: (m: MismatchInfo) => void): boolean {
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
  let mi: MismatchInfo | null = null;
  if (!eq) {
    const d = describeMismatch(got, want);
    const cc = mk();
    const cold = !same(run(() => cc.convert(html)), run(() => cc.uncached(html)));
    mi = { ...d, fell, cold };
    for (const t of ts) {
      bump(t.causes, d.cause);
      if (cold) t.coldReproduced++;
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
  if (mi !== null) onMismatch(mi);
  return eq;
}

interface Ctx {
  mode: Mode;
  reps: Set<string>; // distinct (mode, cause, offset class) keys that already have a representative
  detail: string[]; // representative reports, printed after the summary
  seq: number; // edit sequences so far in this mode
}

function fuzzSuite(s: Suite, pass: "warm" | "cold" | "shared", budget: number, shared: CachedDom2Md | null, t: Totals, tp: Totals, ctx: Ctx): void {
  const label = `${s.mode}/${s.cfg.name}/${pass}`;
  const mk = (): CachedDom2Md => new CachedImpl(s.port, s.mode);
  let cacheForSeq = shared ?? mk();
  let done = 0;
  while (done < budget) {
    t.docs++;
    tp.docs++;
    let doc = startDoc(s);
    if (pass === "warm") cacheForSeq = mk();
    const steps = 8 + ri(20);
    let protyle = s.cfg.protyle === true;
    s.port.SetProtyleWYSIWYG(protyle);
    const seq = ++ctx.seq;
    let inEpisode = false;
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
      const list: Doc = view ?? doc;
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
            return !same(run(() => cc.convert(h)), run(() => cc.uncached(h)));
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
  void cacheForSeq;
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
      let view: Doc | null = null;
      if (step > 0) {
        const e = applyEdit(doc, s.pool, s.lists.length ? s.lists : s.pool);
        doc = e.doc;
        op = e.op;
        view = e.view ?? null;
        t.edits++;
        bump(t.opCounts, op);
      }
      if (step > 0 && rnd() < 0.05) {
        protyle = !protyle;
        s.port.SetProtyleWYSIWYG(protyle);
        bump(t.opCounts, "option-toggle");
      }
      const list: Doc = view ?? doc;
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
  if (!args.has("no-precheck") && args.get("report") !== "real") precheck();
  rnd = mulberry32(argNum("seed", 1));
  const modes: Mode[] = args.get("mode") === "wysiwyg" ? ["wysiwyg"] : args.get("mode") === "ir" ? ["ir"] : ["wysiwyg", "ir"];
  const passes = args.get("pass") === "warm" ? ["warm"] : args.get("pass") === "cold" ? ["cold"] : args.get("pass") === "shared" ? ["shared"] : ["warm", "cold", "shared"];
  const total = argNum("cmp", 5000); // per mode, split over passes and configs
  const mutation = process.env.D2M_CACHED ? "mutated module" : "none";
  const cfgFilter = args.get("config");
  const corpusArg = args.get("corpus-snapshot") ?? null;
  const corpus = loadCorpus(corpusArg);
  const realCount = corpus.mds.filter((m) => m.real).length;
  console.log(`markdown corpus: ${corpus.mds.length} documents (${realCount} real files); hand-written DOM: wysiwyg ${corpus.hand.wysiwyg.length}, ir ${corpus.hand.ir.length}`);
  console.log(`corpus sha256 ${corpus.hash} (${corpus.source}${corpusArg !== null ? "; snapshot file " + corpusArg : ""})`);

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
        fuzzSuite(s, pass, per, sh, totals, passTotals.get(pass)!, ctx);
      }
    }
    console.log(`\n== ${mode} (mutation=${mutation}) docs=${totals.docs} edits=${totals.edits} comparisons=${totals.comparisons} composed=${totals.composed} fallback=${totals.fallback} mismatches=${totals.mismatches} episodes=${totals.episodes} splitAudits=${totals.splitAudits} splitDisagreements=${totals.splitDisagreements}`);
    console.log(`mismatches by cause: ${[...totals.causes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("; ") || "none"}; cold-reproducible: ${totals.coldReproduced} of ${totals.mismatches}`);
    console.log(`comparisons equal only after node-ID normalisation: fallback path ${totals.idNormalisedFallback}, composed path ${totals.idNormalisedComposed}`);
    for (const [pn, pt] of passTotals) {
      console.log(`   pass ${pn}: comparisons=${pt.comparisons} composed=${pt.composed} fallback=${pt.fallback} mismatches=${pt.mismatches} episodes=${pt.episodes} causes=${[...pt.causes].map(([k, v]) => `${k}=${v}`).join(",") || "none"}; composed calls: children=${pt.children} cache hits=${pt.hits} (${(100 * pt.hits / Math.max(1, pt.children)).toFixed(1)}%) misses=${pt.misses}; bytes probed ${pt.missBytes} of ${pt.totalBytes} (${(100 * pt.missBytes / Math.max(1, pt.totalBytes)).toFixed(1)}%)`);
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
