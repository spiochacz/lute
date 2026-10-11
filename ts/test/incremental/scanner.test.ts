// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Tests of the scanner (section 8.1): one accept case per top-level tag, one refuse case per scan code, and the audit of the
// scanner's cut against the engine's own parse (util.ParseHTML) over the corpora.

import { test } from "node:test";
import assert from "node:assert/strict";
import { scanTopLevel } from "../../src/incremental/scanner.ts";
import * as bytes from "../../src/runtime/bytes.ts";
import * as conv from "../../src/runtime/conv.ts";
import * as html from "../../src/html/index.ts";
import * as util from "../../src/util/index.ts";
import { auditDocuments, OPAQUE_DISAGREEMENTS_EXPECTED } from "./corpus_docs.ts";
import { sample } from "../e2e/full.ts";

function serialise(n: html.Node): string {
  const w = new bytes.Buffer();
  const err = html.Render(w, n);
  assert.equal(err, null, "html.Render");
  return conv.StringFromBytes(w.Bytes());
}

const ACCEPT: Array<[string, string]> = [
  ["p", "<p>a</p>"],
  ["h1", "<h1>a</h1>"],
  ["h2", "<h2>a</h2>"],
  ["h3", "<h3>a</h3>"],
  ["h4", "<h4>a</h4>"],
  ["h5", "<h5>a</h5>"],
  ["h6", "<h6>a</h6>"],
  ["ul", "<ul><li>a</li></ul>"],
  ["ol", "<ol><li>a</li></ol>"],
  ["table", "<table><tbody><tr><td>a</td></tr></tbody></table>"],
  ["blockquote", "<blockquote><p>a</p></blockquote>"],
  ["hr", "<hr>"],
  ["div", '<div data-type="x">a</div>'],
];

for (const [tag, child] of ACCEPT) {
  test(`scanner accepts a top-level <${tag}>`, () => {
    const sc = scanTopLevel(child);
    assert.equal(sc.ok, true, JSON.stringify(sc));
    if (!sc.ok) {
      return;
    }
    assert.equal(sc.children.length, 1);
    assert.equal(sc.children[0].tag, tag);
    assert.equal(sc.children[0].start, 0);
    assert.equal(sc.children[0].end, child.length);
    assert.equal(sc.children[0].opaque, false);
  });
}

test("scanner counts the attributes of the top-level start tag and cuts consecutive children", () => {
  const sc = scanTopLevel('<p data-block="0" class="x">a</p><ul data-tight="true"><li>b</li></ul>');
  assert.equal(sc.ok, true);
  if (!sc.ok) {
    return;
  }
  assert.deepEqual(
    sc.children.map((c) => [c.tag, c.attrs]),
    [
      ["p", 2],
      ["ul", 1],
    ],
  );
});

test("scanner marks a child with a skipped data-render preview as opaque", () => {
  const child = '<div data-type="code-block"><pre data-render="1">&lt;form</pre></div>';
  const sc = scanTopLevel(child);
  assert.equal(sc.ok, true, JSON.stringify(sc));
  if (sc.ok) {
    assert.equal(sc.children[0].opaque, true);
  }
});

// One refuse case per scan code of section 6.
const REFUSE: Array<[string, string, string]> = [
  ["top-level-text", "a<p>b</p>", "top-level-text"],
  ["comment-or-doctype", "<p>x</p><!-- c -->", "comment-or-doctype"],
  ["stray-lt", "<p>a < b</p>", "stray-lt"],
  ["tag-not-allowed", "<p>a<script>x</script></p>", "tag-not-allowed"],
  ["top-level-tag", "<span>a</span>", "top-level-tag"],
  ["upper-case-tag", "<P>a</P>", "upper-case-tag"],
  ["malformed-end-tag", "<p>a</p x>", "malformed-end-tag"],
  ["mismatched-end-tag", "<p>a</div>", "mismatched-end-tag"],
  ["unterminated", "<p>a", "unterminated"],
  ["self-closing-non-void", "<p/>", "self-closing-non-void"],
  ["implicit-end-tag (block start tag in p)", "<p>a<ul><li>b</li></ul></p>", "implicit-end-tag"],
  ["implicit-end-tag (li outside list)", "<li>x</li>", "implicit-end-tag"],
  ["table-structure", "<table>x</table>", "table-structure"],
  ["unterminated-attribute", '<p data-x="abc>a</p>', "unterminated-attribute"],
  ["unterminated-preview", '<div data-type="code-block"><pre data-render="1">x</div>', "unterminated-preview"],
  ["no-children", "", "no-children"],
];

for (const [name, input, code] of REFUSE) {
  test(`scanner refuses ${name} with code ${code}`, () => {
    const sc = scanTopLevel(input);
    assert.equal(sc.ok, false, `expected a refusal, got ${JSON.stringify(sc)}`);
    if (!sc.ok) {
      assert.equal(sc.code, code);
    }
  });
}

// The audit (revised by the coordinator; tasks/004, Milestone B implementation, deviation 4): for every corpus document that the
// scanner accepts, either the scanner's children equal the engine's top-level children (count, tag, attribute count and the
// serialisation of each child parsed alone against the same node of the whole document), or the document contains at least one
// opaque child (a data-render preview, whose raw HTML the scanner does not validate; the parser certificate decides, step 4).
// A disagreement in a document without an opaque child fails the test. The opaque disagreements are collected and pinned.
export interface OpaqueDisagreement {
  id: string;
  scannerCount: number;
  engineCount: number;
}

test("scanner cut agrees with util.ParseHTML over the corpora (ZWSP and caret stripped, engine preprocessing)", () => {
  // every 2nd document, plus the documents of the pinned opaque-disagreement list (the list is compared exactly below)
  const all = auditDocuments();
  const sampled = new Set(sample(all.map((_, i) => i), 0, 2));
  const docs = all.filter((d, i) => sampled.has(i) || OPAQUE_DISAGREEMENTS_EXPECTED.includes(d.name));
  let accepted = 0;
  let refused = 0;
  let children = 0;
  const opaqueDisagreements: OpaqueDisagreement[] = [];
  for (const doc of docs) {
    const sc = scanTopLevel(doc.html);
    if (!sc.ok) {
      refused++;
      continue;
    }
    accepted++;
    const whole = util.ParseHTML(doc.html);
    assert.notEqual(whole, null, `${doc.name}: util.ParseHTML failed on an accepted string`);
    const tops: html.Node[] = [];
    for (let c = whole!.FirstChild; c !== null; c = c.NextSibling) {
      tops.push(c);
    }
    children += tops.length;
    const hasOpaque = sc.children.some((c) => c.opaque);
    let disagree = "";
    if (tops.length !== sc.children.length) {
      disagree = `scanner found ${sc.children.length} children, the engine's parse ${tops.length}`;
    } else {
      for (let k = 0; k < tops.length && disagree === ""; k++) {
        const c = sc.children[k];
        const node = tops[k];
        const alone = util.ParseHTML(doc.html.substring(c.start, c.end));
        const aloneNode = alone === null ? null : alone.FirstChild;
        const a = aloneNode === null ? "(no node)" : serialise(aloneNode);
        const b = serialise(node);
        if (node.Data !== c.tag || node.Attr.length !== c.attrs || a !== b) {
          disagree = `child ${k} disagrees
 scanner: tag=${c.tag} attrs=${c.attrs}
 engine: tag=${node.Data} attrs=${node.Attr.length}
 alone: ${a}
 whole: ${b}`;
        }
      }
    }
    if (disagree === "") {
      continue;
    }
    if (!hasOpaque) {
      throw new Error(`${doc.name}: disagreement in a document without an opaque child: ${disagree}
${doc.html}`);
    }
    opaqueDisagreements.push({ id: doc.name, scannerCount: sc.children.length, engineCount: tops.length });
  }
  assert.ok(accepted > 0, "no document was accepted");
  process.stdout.write(
    `scanner audit: ${docs.length} documents, ${accepted} accepted, ${refused} refused, ${children} engine children compared
` +
      `opaque disagreements (${opaqueDisagreements.length}): ${JSON.stringify(opaqueDisagreements)}
`,
  );
  assert.deepEqual(
    opaqueDisagreements.map((d) => d.id),
    OPAQUE_DISAGREEMENTS_EXPECTED,
    "the set of opaque disagreements changed; step 4 must be re-checked for the new set",
  );
});
