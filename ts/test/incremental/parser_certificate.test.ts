// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Tests of the parser certificate (section 8.3) and the mandatory check of step 4 (coordinator decision, deviation 4): for every
// document of the opaque audit list, the certificate over the scanner's children must refuse at least one child.

import { test } from "node:test";
import assert from "node:assert/strict";
import { scanTopLevel } from "../../src/incremental/scanner.ts";
import {
  bodyOf,
  certify,
  parseWithBoundary,
  REF,
  sandwichCheck,
  serialiseNode,
} from "../../src/incremental/parser_certificate.ts";
import * as html from "../../src/html/index.ts";
import * as util from "../../src/util/index.ts";
import { auditDocuments, OPAQUE_DISAGREEMENTS_EXPECTED } from "./corpus_docs.ts";
import { sample } from "../e2e/full.ts";

test("REF is the state in body content after <hr> (section 4.2)", () => {
  const ref = REF();
  assert.deepEqual(ref.oe, ["|22020|html", "|10244|body"]);
  assert.equal(ref.afe, 0);
  assert.equal(ref.form, false);
  assert.equal(ref.templates, 0);
  assert.equal(ref.originalIM, null);
  assert.equal(ref.foster, false);
  assert.equal(ref.quirks, true);
  assert.equal(ref.fragment, false);
  assert.equal(ref.scripting, true);
  assert.equal(ref.selfClosing, false);
  assert.equal(ref.hasContext, false);
  assert.equal(ref.rawTag, "");
  assert.equal(ref.err, "Error: EOF");
  assert.equal(ref.im, parseWithBoundary("<p>x</p>").boundary!.im, "im is inBodyIM");
});

test("bodyOf of the certified parse serialises like util.ParseHTML", () => {
  for (const doc of sample(auditDocuments(), 0, 4)) {
    const s = doc.html;
    const viaCert = bodyOf(parseWithBoundary(s).doc);
    const viaUtil = util.ParseHTML(s);
    assert.equal(
      viaCert === null ? "" : serialiseNode(viaCert),
      viaUtil === null ? "" : serialiseNode(viaUtil),
      `${doc.name}: bodyOf differs from util.ParseHTML`,
    );
  }
});

test("negative samples are refused by the certificate", () => {
  const cases: Array<[string, string]> = [
    ["<p>x</p><p>y</p>", "shape"],
    ["<p>x", "oe"],
    ["<p><b>x</p>", "afe"],
    ["<ul><li>a</li>", "oe"],
    ["<p>x</p>text", "shape"],
    ["<p>x</p></p>", "shape"],
  ];
  for (const [child, expected] of cases) {
    const r = parseWithBoundary(child);
    const got = certify(child, r.doc, r.boundary);
    assert.notEqual(got, null, `${child} must be refused`);
    assert.equal(got, expected, `${child}: wrong condition`);
  }
});

test("a comment closed by EOF is refused (the boundary's last token is not an end tag)", () => {
  const child = "<p>x</p><!-- c";
  const r = parseWithBoundary(child);
  assert.notEqual(certify(child, r.doc, r.boundary), null);
});

interface ChildRecord {
  doc: string;
  index: number;
  opaque: boolean;
  refusal: string | null;
}

const records: ChildRecord[] = [];
const acceptedDocs = (): Array<{ name: string; html: string; children: ReturnType<typeof scanTopLevel> & { ok: true } }> => {
  const out: Array<{ name: string; html: string; children: ReturnType<typeof scanTopLevel> & { ok: true } }> = [];
  for (const doc of auditDocuments()) {
    const sc = scanTopLevel(doc.html);
    if (sc.ok) {
      out.push({ name: doc.name, html: doc.html, children: sc as ReturnType<typeof scanTopLevel> & { ok: true } });
    }
  }
  return out;
};

test("every non-opaque scanner child is certified, and its alone parse equals the engine's node", () => {
  let certified = 0;
  let opaqueRefused = 0;
  let sandwiched = 0;
  for (const doc of sample(acceptedDocs(), 0, 4)) {
    const whole = util.ParseHTML(doc.html);
    const tops: html.Node[] = [];
    for (let c = whole === null ? null : whole.FirstChild; c !== null; c = c.NextSibling) {
      tops.push(c);
    }
    const sameCount = tops.length === doc.children.children.length;
    for (let k = 0; k < doc.children.children.length; k++) {
      const c = doc.children.children[k];
      const child = doc.html.substring(c.start, c.end);
      const r = parseWithBoundary(child);
      const refusal = certify(child, r.doc, r.boundary);
      records.push({ doc: doc.name, index: k, opaque: c.opaque, refusal });
      if (refusal !== null) {
        if (!c.opaque) {
          throw new Error(`${doc.name}: child ${k} is not opaque and fails condition ${refusal}: ${child}`);
        }
        opaqueRefused++;
        continue;
      }
      certified++;
      const body = bodyOf(r.doc);
      assert.notEqual(body, null);
      if (sameCount && !c.opaque) {
        assert.equal(serialiseNode(body!.FirstChild!), serialiseNode(tops[k]), `${doc.name}: child ${k} alone differs from the whole document`);
      }
      const sw = sandwichCheck(child);
      assert.equal(sw, null, `${doc.name}: child ${k} fails the sandwich check ${sw}: ${child}`);
      sandwiched++;
    }
  }
  assert.ok(certified > 0);
  process.stdout.write(`certificate: ${certified} children certified (sandwich checked), ${opaqueRefused} opaque children refused\n`);
});

// Step 4 mandatory check (coordinator decision, deviation 4): every document of the opaque audit list has at least one child that the
// certificate refuses. Both directions of mis-cut are reported: the scanner found more children than the engine (a cut inside an
// element), or fewer (one scanner child is more than one top-level node, or ends in the middle of its element).
test("step 4: the certificate refuses at least one child of every opaque-disagreement document", () => {
  const docs = auditDocuments();
  const report: string[] = [];
  for (const id of OPAQUE_DISAGREEMENTS_EXPECTED) {
    const doc = docs.find((d) => d.name === id);
    assert.ok(doc, `${id} is in the audit population`);
    const sc = scanTopLevel(doc!.html);
    assert.equal(sc.ok, true, `${id}: the scanner accepts it`);
    if (!sc.ok) {
      continue;
    }
    const engine = util.ParseHTML(doc!.html);
    let engineCount = 0;
    for (let c = engine === null ? null : engine.FirstChild; c !== null; c = c.NextSibling) {
      engineCount++;
    }
    const direction = sc.children.length > engineCount ? "scanner found more children" : sc.children.length < engineCount ? "scanner found fewer children" : "same count";
    const perChild: string[] = [];
    let refusedAny = false;
    for (let k = 0; k < sc.children.length; k++) {
      const c = sc.children[k];
      const child = doc!.html.substring(c.start, c.end);
      const r = parseWithBoundary(child);
      const refusal = certify(child, r.doc, r.boundary);
      if (refusal !== null) {
        refusedAny = true;
      }
      const b = r.boundary;
      perChild.push(
        `  child ${k} <${c.tag}> opaque=${c.opaque}: ${refusal === null ? "certified" : "refused (" + refusal + ")"}` +
          (b === null ? "" : ` lastTokType=${b.lastTokType} lastTokData=${b.lastTokData} lastTokEnd=${b.lastTokEnd} bufLen=${b.bufLen} oe=${b.oe.length}`),
      );
    }
    report.push(`${id}: scanner ${sc.children.length}, engine ${engineCount} (${direction})\n${perChild.join("\n")}`);
    if (!refusedAny) {
      throw new Error(`STOP: ${id}: every child is certified, which is an unsoundness of the certificate\n${report.join("\n")}`);
    }
  }
  process.stdout.write(report.join("\n") + "\n");
});

// Deviation 5 (tasks/004, Milestone B implementation): the last token of the boundary is recorded after the original parseCurrentToken
// call, because the parser processes implied tokens re-entrantly. Before the fix, a <hr> child (whose processing creates implied
// html, head and body tokens) reported the implied <body> as its last token and was refused; these tests pin the fixed behaviour and the
// condition-2 refusal of a child whose last token is not its own end tag. It corrects the sentence of section 4.1 that records the token
// before delegating.
test("deviation 5: a non-opaque <hr> child is certified (its last token is the hr start tag)", () => {
  for (const child of ['<hr data-block="0" />', "<hr>", "<hr/>"]) {
    const r = parseWithBoundary(child);
    assert.equal(r.boundary!.lastTokData, "hr", child);
    assert.equal(certify(child, r.doc, r.boundary), null, child);
  }
});

test("condition 2: a child whose real last token is not its own end tag is refused", () => {
  const child = '<div data-type="x">a</div>';
  const r = parseWithBoundary(child);
  assert.equal(certify(child, r.doc, r.boundary), null, "the real boundary is certified");
  assert.equal(r.boundary!.lastTokData, "div");
  const wrongEnd = { ...r.boundary!, lastTokData: "p" };
  assert.equal(certify(child, r.doc, wrongEnd), "last-token");
  const notEnd = { ...r.boundary!, lastTokType: html.StartTagToken };
  assert.equal(certify(child, r.doc, notEnd), "last-token", "a start tag does not close a non-void element");
});
