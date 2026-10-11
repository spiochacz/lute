// Prototype: per-top-level-child cache for VditorDOM2Md (WYSIWYG) and VditorIRDOM2Md (IR).
//
// It wraps the public engine methods from outside; nothing in ts/src is touched. See README.md for
// the full rule set and the report in tasks/004-incremental-and-fast-paths.md.
//
// Composition rule (validated by fuzz.ts):
//
//   result(doc) = trim(U_1 + U_2 + ... + U_n) + "\n"          trim = strip " \t\n" at both ends
//
// U_i is the UNTRIMMED output of top-level child i in its context. Without an engine hook it is
// obtained by "sandwiching": the engine is called on  <hr> + child + <something>  and the output
//   "---\n\n" + U_i + tail
// is sliced. Per child there are four variants of U_i, because the engine consults the siblings in
// exactly two ways (everything else is inside the child's own subtree):
//
//   last   isLastNode(): a block nested in the child (a code block in a list item, say) writes one
//          blank line less when the child is the LAST NODE OF THE AST (not the last DOM child: later
//          children that produce no AST node do not count);
//   next   genASTByVditorDOM / genASTByVditorIRDOM turn a <br> in a top-level <p> into a ZWSP when the
//          DOM sibling after the <p> is a ul, ol or blockquote, AFTER removeEmptyNodes has removed the
//          siblings that vanish (an empty <ul> does not count).
//
// and one fallback per cross-sibling pass of adjustVditorDOM that could not be modelled:
//   mergeVditorDOMList0 merges adjacent lists of the same tag when the second has exactly one attribute.
//
// The negative controls in negative-control.ts work by rewriting single statements of THIS file in a
// scratch copy; keep the statements marked "NC:" on one line each.

import { ast, editor, html as htmlpkg, parse, util } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { splitTopLevel } from "./scan.ts";
import type { Child } from "./scan.ts";

export type Mode = "wysiwyg" | "ir";

export interface Stats {
  calls: number;
  cachedCalls: number; // calls answered by composition
  fallbackCalls: number;
  fallbackReasons: Map<string, number>;
  children: number; // children seen in composed calls
  hits: number;
  misses: number;
  missBytes: number; // bytes of child HTML probed/sent to the engine (without sentinels)
  totalBytes: number; // bytes of input HTML in composed calls
  cacheEntries: number;
  evictions: number;
  engineThrew: number;
  fingerprintClears: number;
  unsafeChildren: number; // children rejected by the probe (parser check or state leak)
  variantCalls: number; // engine calls made to fill a variant
}

export function newStats(): Stats {
  return {
    calls: 0, cachedCalls: 0, fallbackCalls: 0, fallbackReasons: new Map(), children: 0, hits: 0, misses: 0,
    missBytes: 0, totalBytes: 0, cacheEntries: 0, evictions: 0, engineThrew: 0, fingerprintClears: 0, unsafeChildren: 0,
    variantCalls: 0,
  };
}

export interface Timing {
  prep: number; // fingerprint + caret/ZWSP strip
  split: number;
  classify: number;
  keys: number; // substring + Map lookup
  miss: number; // probes and engine calls for misses
  assemble: number;
}

const HR = '<hr data-block="0" />';
const BQ = '<blockquote data-block="0"><p data-block="0">q</p></blockquote>';
const BQ_EMPTY = '<blockquote data-block="0"></blockquote>';
const PROBE = "<p>x</p>";
const HEAD = "---\n\n"; // output of HR as the first block, untrimmed
const TAIL_HR = "---\n"; // trimmed output of HR as the last block, plus the final newline
const TAIL_BQ = "> q\n";

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "hr"]);
const CACHEABLE_DIV_TYPES = new Set(["code-block", "math-block", "html-block", "yaml-front-matter", "toc-block"]);

export function childKind(c: Child): string | null {
  if (BLOCK_TAGS.has(c.tag)) {
    return c.tag;
  }
  if (c.tag === "div" && CACHEABLE_DIV_TYPES.has(c.dataType)) { // NC: div-kinds
    return c.dataType;
  }
  return null;
}

function fallbackReasonForChild(c: Child): string {
  if (c.tag === "div") {
    if (c.dataType === "footnotes-block") return "footnotes-block";
    if (c.dataType === "link-ref-defs-block") return "link-ref-defs-block";
    return "other div" + (c.dataType === "" ? "" : "[" + c.dataType + "]");
  }
  return "top-level <" + c.tag + ">";
}

// What is known about one child text, independent of its neighbours.
interface Entry {
  unsafe: boolean;
  alive: boolean; // still in the DOM after adjustVditorDOM
  emits: boolean; // produces at least one AST node
  u: Array<string | undefined>; // variants: bit 0 = next alive sibling is ul/ol/blockquote, bit 1 = last AST node
}

export interface Options {
  maxEntries?: number; // FIFO bound on the number of cached children
  timing?: boolean;
}

export class CachedDom2Md {
  readonly lute: Lute;
  readonly mode: Mode;
  readonly stats: Stats = newStats();
  readonly timing: Timing = { prep: 0, split: 0, classify: 0, keys: 0, miss: 0, assemble: 0 };
  readonly maxEntries: number;
  readonly doTiming: boolean;
  lastFallbackReason = "";
  private cache = new Map<string, Entry>();
  private fp = "";

  constructor(lute: Lute, mode: Mode, opts: Options = {}) {
    this.lute = lute;
    this.mode = mode;
    this.maxEntries = opts.maxEntries ?? 200000;
    this.doTiming = opts.timing ?? false;
  }

  // The uncached call (the reference behaviour).
  uncached(html: string): string {
    return this.mode === "wysiwyg" ? this.lute.VditorDOM2Md(html) : this.lute.VditorIRDOM2Md(html);
  }

  // The engine's inner method: no ZWSP strip on the input or on the output. Used for the pieces, because a ZWSP
  // in a piece (an empty paragraph produces one) shields the whitespace next to it from the document trim, and
  // the outer method strips ZWSP only after that trim.
  private inner(html: string): string {
    return this.mode === "wysiwyg" ? this.lute.vditorDOM2Md(html) : this.lute.vditorIRDOM2Md(html);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  // Fingerprint of everything the DOM-to-Markdown path reads from the engine instance: all primitive
  // fields of ParseOptions and RenderOptions, the content of the attribute list, and the sizes of the
  // map-valued fields. LIMITATION: an in-place change of a map that keeps its size (PutEmojis with a
  // replaced value, PutTerms) is not seen; a production version needs an options version counter.
  fingerprint(): string {
    const parts: string[] = [];
    for (const o of [this.lute.ParseOptions, this.lute.RenderOptions] as unknown as Record<string, unknown>[]) {
      for (const k in o) {
        const v = o[k];
        if (v === null || v === undefined) {
          parts.push("n");
        } else if (v instanceof Map) {
          parts.push("M" + v.size);
        } else if (Array.isArray(v)) {
          parts.push("[" + v.join(",") + "]");
        } else if (typeof v === "object") {
          parts.push("o");
        } else {
          parts.push(String(v));
        }
      }
    }
    return parts.join("|");
  }

  private fallback(html: string, reason: string): string {
    this.stats.fallbackCalls++;
    this.stats.fallbackReasons.set(reason, (this.stats.fallbackReasons.get(reason) ?? 0) + 1);
    this.lastFallbackReason = reason;
    return this.uncached(html);
  }

  convert(html0: string): string {
    const st = this.stats;
    st.calls++;
    this.lastFallbackReason = "";
    const T = this.doTiming;
    let t0 = T ? performance.now() : 0;
    const lap = (field: keyof Timing): void => {
      const t = performance.now();
      this.timing[field] += t - t0;
      t0 = t;
    };

    const fp = this.fingerprint(); // NC: fingerprint
    if (fp !== this.fp) {
      if (this.fp !== "") {
        st.fingerprintClears++;
      }
      this.cache.clear();
      this.fp = fp;
    }

    // The engine's first two steps are global string replacements: ZWSP (VditorDOM2Md / VditorIRDOM2Md) and
    // the caret "<wbr>" (vditorDOM2Md / vditorIRDOM2Md). Doing them here, in the same order, makes keys
    // independent of the caret and removes top-level carets before the split. If a replacement creates a new
    // caret the engine would have left in place, give up.
    let html = html0;
    if (html.indexOf(editor.Zwsp) >= 0) html = html.split(editor.Zwsp).join("");
    if (html.indexOf(editor.FrontEndCaret) >= 0) {
      html = html.split(editor.FrontEndCaret).join("");
      if (html.indexOf(editor.FrontEndCaret) >= 0) {
        return this.fallback(html0, "caret created by the strip");
      }
    }
    if (T) lap("prep");

    const sp = splitTopLevel(html);
    if (T) lap("split");
    if (!sp.ok) {
      return this.fallback(html0, "split: " + sp.reason);
    }
    const ch = sp.children;
    const n = ch.length;
    if (n === 0) {
      return this.fallback(html0, "empty document");
    }

    // classify by tag (cheap, no lookups)
    for (let i = 0; i < n; i++) {
      if (childKind(ch[i]) === null) {
        return this.fallback(html0, fallbackReasonForChild(ch[i]));
      }
    }
    if (T) lap("classify");

    // entries: one Map lookup per child
    const entries: Array<Entry | undefined> = new Array(n);
    const raw: string[] = new Array(n);
    let missCount = 0;
    for (let i = 0; i < n; i++) {
      const c = ch[i];
      const s = html.substring(c.start, c.end);
      raw[i] = s;
      const e = this.cache.get(s);
      entries[i] = e;
      if (e === undefined) missCount++;
    }
    if (T) lap("keys");
    st.children += n;
    st.totalBytes += html.length;
    st.hits += n - missCount;
    st.misses += missCount;

    for (let i = 0; i < n; i++) {
      if (entries[i] === undefined) {
        st.missBytes += raw[i].length;
        const e = this.probe(raw[i], ch[i]);
        if (this.cache.size >= this.maxEntries) {
          let drop = this.maxEntries >> 2;
          for (const k of this.cache.keys()) {
            this.cache.delete(k);
            st.evictions++;
            if (--drop <= 0) break;
          }
        }
        this.cache.set(raw[i], e);
        entries[i] = e;
      }
      if (entries[i]!.unsafe) {
        st.unsafeChildren++;
        return this.fallback(html0, "unsafe child (parser check or AST builder state)");
      }
    }

    // sibling structure: which children survive adjustVditorDOM, which produce AST nodes
    const alive = (i: number): boolean => entries[i]!.alive; // NC: alive
    // adjacent lists (mergeVditorDOMList0), looking at surviving siblings only
    let prevAlive = -1;
    for (let i = 0; i < n; i++) {
      if (!alive(i)) continue;
      if (prevAlive >= 0) {
        const a = ch[prevAlive];
        const b = ch[i];
        if ((a.tag === "ul" || a.tag === "ol") && b.tag === a.tag && b.attrs === 1) { // NC: adjacent-lists
          return this.fallback(html0, "adjacent lists (merge rule)");
        }
      }
      prevAlive = i;
    }
    // last AST node
    const lastEmit = lastEmitting(entries); // NC: last-emit
    // next alive sibling bit, scanning from the end
    const bits: boolean[] = new Array(n);
    let nextTag = "";
    for (let i = n - 1; i >= 0; i--) {
      bits[i] = nextTag === "ul" || nextTag === "ol" || nextTag === "blockquote";
      if (alive(i)) nextTag = ch[i].tag;
    }
    if (T) lap("classify");

    // variants
    const parts: string[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const e = entries[i]!;
      if (!e.emits) {
        parts[i] = "";
        continue;
      }
      let v = 0;
      if (bits[i] && ch[i].tag === "p" && raw[i].indexOf("<br") >= 0) v |= 1; // NC: next-bit
      if (i === lastEmit) v |= 2; // NC: last-bit
      let u = e.u[v];
      if (u === undefined) {
        const w = this.fill(raw[i], v);
        if (w === null) {
          return this.fallback(html0, this.lastFallbackReason || "sandwich shape");
        }
        u = w;
        e.u[v] = u;
      }
      parts[i] = u;
    }
    if (T) lap("miss");

    const joined = parts.join(""); // NC: assemble
    let result = trimBlank(joined) + "\n";
    if (result.indexOf(editor.Zwsp) >= 0) result = result.split(editor.Zwsp).join("");
    st.cachedCalls++;
    st.cacheEntries = this.cache.size;
    if (T) lap("assemble");
    return result;
  }

  // Computes the untrimmed output of a child in variant v by sandwiching. Returns null on an unexpected shape.
  private fill(child: string, v: number): string | null {
    const st = this.stats;
    const last = (v & 2) !== 0;
    const next = (v & 1) !== 0;
    // variant 3: last AST node but a list/blockquote follows in the DOM without producing a node
    const tailHtml = last ? (next ? BQ_EMPTY : "") : next ? BQ : HR;
    st.variantCalls++;
    let out: string;
    try {
      out = this.inner(HR + child + tailHtml);
    } catch {
      st.engineThrew++;
      this.lastFallbackReason = "engine threw on a child";
      return null;
    }
    if (last) {
      // "---\n\n" + trimRight(U) + "\n"
      if (out === "---\n") return "";
      if (out.startsWith(HEAD) && out.endsWith("\n") && out.length > HEAD.length) {
        return out.substring(HEAD.length, out.length - 1);
      }
      this.lastFallbackReason = "sandwich shape";
      return null;
    }
    const tail = next ? TAIL_BQ : TAIL_HR;
    if (!out.startsWith(HEAD) || !out.endsWith(tail) || out.length < HEAD.length + tail.length) {
      this.lastFallbackReason = "sandwich shape";
      return null;
    }
    return out.substring(HEAD.length, out.length - tail.length);
  }

  // Learns the neighbour-independent facts about a child by replaying the engine's pre-render steps (all
  // exported) on HR + child + HR: whether the child survives adjustVditorDOM, whether it produces an AST
  // node, whether any top-level child leaves tree.Context.Tip above the document (IR code and math blocks
  // without their markers, some setext headings: the next sibling would be attached inside it), and, for
  // a child with skipped preview content, whether the parser cuts exactly there.
  // A production version would get these from a hook instead of replaying the steps.
  private probe(child: string, c: Child): Entry {
    // own the key: a substring of a long document keeps the whole document alive
    child = flat(child);
    const e: Entry = { unsafe: false, alive: true, emits: true, u: [undefined, undefined, undefined, undefined] };
    if (c.opaque && !cleanParse(child, c)) { // NC: clean-check
      e.unsafe = true;
      return e;
    }
    try {
      const lute = this.lute;
      let h = (HR + child + HR).split("\t\n").join("\n");
      h = h.split("    \n").join("  \n");
      const root = util.ParseHTML(h);
      if (root === null) {
        e.unsafe = true;
        return e;
      }
      lute.adjustVditorDOM(root);
      const kids: htmlpkg.Node[] = [];
      for (let k = root.FirstChild; k !== null; k = k.NextSibling) kids.push(k);
      if (kids.length === 2) {
        e.alive = false;
      } else if (kids.length !== 3) {
        e.unsafe = true;
        return e;
      }
      const tree = new parse.Tree();
      tree.Name = "";
      tree.Root = new ast.Node(ast.NodeDocument);
      tree.Context = new parse.Context(lute.ParseOptions);
      tree.Context.Tip = tree.Root;
      let before = 0;
      for (let ki = 0; ki < kids.length; ki++) {
        if (ki === 1 && e.alive) before = countChildren(tree.Root);
        if (this.mode === "wysiwyg") lute.genASTByVditorDOM(kids[ki], tree);
        else lute.genASTByVditorIRDOM(kids[ki], tree);
        if (tree.Context.Tip !== tree.Root) { // NC: leak-check
          e.unsafe = true;
          return e;
        }
        if (ki === 1 && e.alive) e.emits = countChildren(tree.Root) > before;
      }
      if (!e.alive) e.emits = false;
    } catch {
      e.unsafe = true;
    }
    return e;
  }
}

// A copy of s that does not reference its parent string (V8 slices of long strings are views).
function flat(s: string): string {
  return (" " + s).substring(1);
}

function lastEmitting(entries: Array<Entry | undefined>): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.emits) return i;
  }
  return -1;
}

function countChildren(n: ast.Node): number {
  let k = 0;
  for (let c = n.FirstChild; c !== null; c = c.Next) k++;
  return k;
}

// The parser must cut HR + child + PROBE into exactly [hr, child element, p] with a clean p: then the cut
// of an opaque child is the parser's, and it leaves no open formatting elements behind for the next sibling.
function cleanParse(child: string, c: Child): boolean {
  const root = util.ParseHTML(HR + child + PROBE);
  if (root === null) return false;
  const a = root.FirstChild;
  const b = a === null ? null : a.NextSibling;
  const p = b === null ? null : b.NextSibling;
  if (a === null || b === null || p === null || p.NextSibling !== null) return false;
  if (a.Data !== "hr" || b.Data !== c.tag || b.Attr.length !== c.attrs || p.Data !== "p" || p.Attr.length !== 0) return false;
  const t = p.FirstChild;
  return t !== null && t.NextSibling === null && t.Type === htmlpkg.TextNode && t.Data === "x";
}

// bytes.Trim(x, " \t\n") on a string
export function trimBlank(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b) {
    const c = s.charCodeAt(a);
    if (c === 32 || c === 9 || c === 10) a++;
    else break;
  }
  while (b > a) {
    const c = s.charCodeAt(b - 1);
    if (c === 32 || c === 9 || c === 10) b--;
    else break;
  }
  return a === 0 && b === s.length ? s : s.substring(a, b);
}
