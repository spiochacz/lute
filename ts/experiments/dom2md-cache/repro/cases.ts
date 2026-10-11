// Regression cases for CachedDom2Md. Each case is a list of top-level children (outer HTML), a mode, an option set
// (names of corpus.ts CONFIGS), and the cache state to establish before the call:
//   "cold"            a fresh cache (default)
//   "warm-from"       a cache that first converted every document of `prime` (each a list of children)
// `expect` documents what the case demonstrates: "equal" must pass today; "mismatch" is a known failure (root cause R1)
// that must turn into "equal" after the fix. run.ts prints `equal` or both outputs and exits 1 if a case disagrees with its
// expectation, so the file becomes a regression gate once every case is expected "equal" (flip the expectations then).
import type { Mode } from "../cached.ts";

export interface Case {
  id: string;
  root: "R1" | "control" | "audit";
  mode: Mode;
  config: string;
  children: string[];
  cache?: "cold" | "warm-from";
  prime?: string[][];
  expect: "equal" | "mismatch";
  note: string;
}

const P = (t: string): string => `<p data-block="0">${t}</p>`;
const UL = '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>';
const OL = '<ol data-tight="true" data-marker="1." data-block="0"><li data-marker="1.">z</li></ol>';
const BQ = '<blockquote data-block="0"><p data-block="0">q</p></blockquote>';
const H2 = '<h2 data-block="0">h</h2>';
const CODE = '<div class="vditor-wysiwyg__block" data-type="code-block" data-block="0" data-marker="`"><pre><code>c</code></pre></div>';
const HTMLBLOCK_STRAY = '<div class="vditor-wysiwyg__block" data-type="html-block" data-block="0"><pre><code>&lt;/div&gt;</code></pre><pre class="vditor-wysiwyg__preview" data-render="2"></div><wbr></pre></div>';

const W = (id: string, children: string[], expect: Case["expect"], note: string, extra: Partial<Case> = {}): Case => ({
  id, root: expect === "mismatch" ? "R1" : "control", mode: "wysiwyg", config: "defaults", children, expect, note, ...extra,
});

export const CASES: Case[] = [
  // ---- R1: Unicode whitespace at the start of the document output is removed by TrimSpace(root writer) at the exit of a later top-level list or blockquote
  W("R1-w-ideographic-space-then-ul", [P("　a"), UL], "mismatch", "first paragraph starts with U+3000; a later list trims the whole root writer (format_renderer.ts renderList exit)"),
  W("R1-w-vt-then-bq", [P("\u000bCDATA"), BQ], "mismatch", "VT; a later blockquote does the same (renderBlockquote exit)"),
  W("R1-w-nbsp-then-ol", [P(" $"), OL], "mismatch", "NBSP"),
  W("R1-w-ff-then-h2-then-ul", [P("\u000cx"), H2, UL], "mismatch", "the trimming block need not be adjacent; the heading in between does not matter"),
  W("R1-w-u2028-then-code-then-bq", [P(" x"), CODE, BQ], "mismatch", "U+2028 with a fenced code block in between"),
  W("R1-w-whitespace-only-paragraph-swallowed", [P("　"), UL], "mismatch", "a paragraph that is only Unicode whitespace disappears completely (TrimSpace swallows it and its blank line)"),
  W("R1-w-ideographic-space-then-ul-protyle", [P("　a"), UL], "mismatch", "same under the protyle option set", { config: "protyle+ial+spin" }),
  W("R1-w-shared-cache", [P("　a"), UL], "mismatch", "cache primed with the paragraph alone (output right there), the list alone, and the paragraph with another paragraph: still wrong. The entries are fine; the composition is wrong, so cold, warm and shared are the same bug", { cache: "warm-from", prime: [[P("　a")], [UL], [P("　a"), P("b")]] }),
  { id: "R1-ir-ff-then-ul", root: "R1", mode: "ir", config: "defaults", children: [P("\u000c[foo]"), UL], cache: "cold", expect: "mismatch", note: "IR, form feed (seed 3 of the full run)" },
  { id: "R1-ir-nbsp-then-bq", root: "R1", mode: "ir", config: "vditor+toc+callout", children: [P(" a"), BQ], cache: "cold", expect: "mismatch", note: "IR" },
  // ---- controls: must stay equal
  W("C-w-ws-paragraph-alone", [P("　a")], "equal", "no list or blockquote anywhere: nothing trims the root writer"),
  W("C-w-ws-paragraph-then-paragraph-heading", [P("　a"), P("b"), H2], "equal", "paragraphs and headings do not trim the root writer"),
  W("C-w-list-before-ws-paragraph", [UL, P("　a")], "equal", "the trim happens at the list exit, before the paragraph is written: the paragraph keeps U+3000"),
  W("C-w-ascii-space-first", [P("  a"), UL], "equal", "ASCII space, tab and LF are the characters the prototype's document trim already models"),
  W("C-w-ws-in-second-paragraph", [P("a"), P("　b"), UL], "equal", "only the start of the whole output is exposed to the trim"),
  { id: "C-ir-ws-paragraph-alone", root: "control", mode: "ir", config: "defaults", children: [P("　a")], expect: "equal", note: "IR control", cache: "cold" },
  // ---- audit: a fuzzer false positive, not a cache bug (see run.ts)
  { id: "A-fuzz-audit-raw-vs-stripped", root: "audit", mode: "wysiwyg", config: "defaults", children: [HTMLBLOCK_STRAY, P("t")], cache: "cold", expect: "equal", note: "fuzz.ts auditSplit compares the scanner with ParseHTML on the RAW html (still containing the caret <wbr>) while the cache splits the html with the caret stripped; the stray </div> inside the preview lets the raw parse put <wbr> at top level. cached.convert is right (output equal); the audit must strip ZWSP and <wbr> first." },
];
