// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The HTML facts of the scanner are probed from the engine's parser (src/incremental/html_facts.ts). The probed sets are pinned here as literals:
// a change of the parser's behaviour shows up as a diff of this file. The old hand-written literals (VOID and CLOSES_P of scanner.ts, deleted)
// are kept below as OLD_*, and each tag where the probe differs from them has its own line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlFacts } from "../../src/incremental/html_facts.ts";
import { scanTopLevel } from "../../src/incremental/scanner.ts";

// The scanner's ALLOWED set (scanner.ts, grammar G2), copied: the probe runs for these tags.
const ALLOWED = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
  "blockquote", "pre", "code", "hr", "br", "img", "input", "wbr", "a", "strong", "em", "b", "i", "u", "s",
  "del", "strike", "mark", "sup", "sub", "span", "div", "kbd", "font", "details", "summary", "label", "small", "abbr",
  "ins", "cite", "q", "var", "samp", "figure", "figcaption", "center", "caption", "tfoot", "colgroup", "col",
];

// The probed sets (pinned).
const PROBED_VOID = ["br", "col", "hr", "img", "input", "wbr"];
const PROBED_CLOSES_P = [
  "blockquote", "center", "details", "div", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "summary", "ul",
];

// The old hand-written literals (deleted from scanner.ts). A conservative superset for CLOSES_P.
const OLD_VOID = ["br", "col", "hr", "img", "input", "wbr"];
const OLD_CLOSES_P = ["blockquote", "details", "div", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "summary", "table", "ul"];

// The differences, one line per tag. Void: none. CLOSES_P:
//   table: the old literal had it, the probe does not. In the engine's mode (no doctype, quirks) the parser keeps a table inside an open p
//     (Go's x/net/html: the table start tag closes a p only when not in quirks mode), so the scanner accepts it and the certificate checks the child.
//   center, figcaption, figure: the probe closes the p, the old literal lacked them (a latent scanner error that only the certificate caught).
const DIFFERENT_CLOSES_P_OLD_ONLY = ["table"];
const DIFFERENT_CLOSES_P_PROBED_ONLY = ["center", "figcaption", "figure"];

test("the probed void tags are the pinned set, and every probed tag is in ALLOWED", () => {
  const f = htmlFacts(new Set(ALLOWED));
  assert.deepEqual([...f.void].sort(), PROBED_VOID);
  for (const t of f.void) {
    assert.ok(ALLOWED.includes(t), t);
  }
});

test("the probed tags that close an open p are the pinned set", () => {
  const f = htmlFacts(new Set(ALLOWED));
  assert.deepEqual([...f.closesP].sort(), PROBED_CLOSES_P);
});

test("the differences from the old literals are exactly the listed tags", () => {
  const voidDiff = PROBED_VOID.filter((t) => !OLD_VOID.includes(t)).concat(OLD_VOID.filter((t) => !PROBED_VOID.includes(t)));
  assert.deepEqual(voidDiff, [], "no void difference");
  const oldOnly = OLD_CLOSES_P.filter((t) => !PROBED_CLOSES_P.includes(t));
  const probedOnly = PROBED_CLOSES_P.filter((t) => !OLD_CLOSES_P.includes(t));
  assert.deepEqual(oldOnly, DIFFERENT_CLOSES_P_OLD_ONLY);
  assert.deepEqual(probedOnly, DIFFERENT_CLOSES_P_PROBED_ONLY);
});

test("the scanner refuses a block that closes an open p (figure) and accepts a table inside a p", () => {
  const figure = scanTopLevel('<p data-block="0">a<figure>b</figure></p>');
  assert.equal(figure.ok, false);
  assert.equal(!figure.ok && figure.code, "implicit-end-tag");
  const table = scanTopLevel('<p data-block="0">a<table><tbody><tr><td>x</td></tr></tbody></table></p>');
  assert.equal(table.ok, true, JSON.stringify(table));
});
