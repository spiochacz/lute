// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Each declared context field is COVERED (its reads are recorded and no run reads outside the declared context) and REAL (some child's
// output depends on it), the latter by witness search (coordinator decision, deviation 8). A field with no witness is reported, not failed.
//
// Milestone C, C1 (restated on the key): there is no read recording, so "never read" and "read only after a text node" are checked at the
// level of the log: a field that a run never reads cannot change its output. isFirst and isLast are no fields any more (invariant I1).
// The NC14 unit test (the generated-id refusal) is here too. Default run: the COVERED sweep covers every 8th candidate; test:full covers all
// of them (test/e2e/full.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "../../src/ast/index.ts";
import * as atom from "../../src/html/atom/index.ts";
import { New } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { FormatRenderer } from "../../src/render/types.ts";
import { scanTopLevel } from "../../src/incremental/scanner.ts";
import { WYSIWYG_ADAPTER, runChild } from "../../src/incremental/sandbox.ts";
import { contextKey } from "../../src/incremental/piece.ts";
import { auditDocuments } from "./corpus_docs.ts";
import { FIELD_VALUES, BASE_CONTEXT, matchesContext, outcome, searchWitness, withField } from "./witness.ts";
import { sample } from "../e2e/full.ts";

const BUDGET_MS = 2000;

// The candidates: the non-opaque children of the accepted WYSIWYG corpus documents, in document order.
function candidates(): string[] {
  const out: string[] = [];
  for (const doc of auditDocuments()) {
    if (doc.mode !== "wysiwyg") {
      continue;
    }
    const sc = scanTopLevel(doc.html);
    if (!sc.ok) {
      continue;
    }
    for (const c of sc.children) {
      if (!c.opaque) {
        out.push(doc.html.substring(c.start, c.end));
      }
    }
  }
  return out;
}

const lute: Lute = New();
const CANDIDATES = candidates();
const SWEEP = sample(CANDIDATES, 0, 8);
const barrierTrips: string[] = [];

test("COVERED: no run of a corpus child under the base context or any single-field change trips the barrier", () => {
  for (const html of SWEEP) {
    for (const spec of FIELD_VALUES) {
      for (const v of [spec.a, spec.b]) {
        const r = runChild(lute, WYSIWYG_ADAPTER, html, withField(spec.field, v), { certify: true, opaque: false });
        if (r.refusal !== null && r.refusal.reason.startsWith("barrier:")) {
          barrierTrips.push(`${spec.field}=${String(v)}: ${r.refusal.reason}: ${html}`);
        }
      }
    }
  }
  assert.deepEqual(barrierTrips, [], "a run read outside the declared context");
  process.stdout.write(`COVERED: ${SWEEP.length} of ${CANDIDATES.length} candidates x ${FIELD_VALUES.length} fields x 2 values, no barrier trips\n`);
});

// The REAL searches: prev, next and domNext (isLast is next < 0; the lastOut and domPrev searches are replaced by the log-level tests below).
const SEARCHED = FIELD_VALUES.filter((f) => f.field !== "domPrev" && f.field !== "lastOut");
for (const spec of SEARCHED) {
  test(`REAL: the output of some child depends on ${spec.field} (witness search, ${CANDIDATES.length} candidates)`, () => {
    const res = searchWitness(lute, WYSIWYG_ADAPTER, spec.field, CANDIDATES, BUDGET_MS);
    if (res.witness === null) {
      process.stdout.write(`REAL ${spec.field}: no witness found over ${res.candidates} candidates in ${res.ms} ms\n`);
      return;
    }
    const w = res.witness;
    process.stdout.write(`REAL ${spec.field}: witness after ${res.candidates} candidates: ${JSON.stringify(w.html)} with ${spec.field} ${String(w.a)} vs ${String(w.b)}\n`);
    assert.notEqual(w.outA, w.outB);
    // the key separates the two variants: the variant made under A does not match the context of B
    const ctxA = withField(spec.field, w.a);
    const vA = runChild(lute, WYSIWYG_ADAPTER, w.html, ctxA, { certify: true, opaque: false }).variant;
    assert.ok(vA !== null);
    assert.equal(vA!.key, contextKey(ctxA), "the variant is keyed by the whole context");
    assert.equal(matchesContext(vA!, withField(spec.field, w.b)), false, "the variant of A must not match the context of B");
  });
}

// domPrev is never read (section 3 of the 2026-10-11 analysis; the proof is the log-level form here): no candidate's outcome depends on it.
test("domPrev: no candidate's outcome depends on it (the log-level form of 'never read')", () => {
  const offenders: string[] = [];
  for (const html of CANDIDATES) {
    const a = outcome(lute, WYSIWYG_ADAPTER, html, withField("domPrev", -1), false);
    const b = outcome(lute, WYSIWYG_ADAPTER, html, withField("domPrev", atom.P), false);
    if (a !== b) {
      offenders.push(`domPrev: ${html}`);
    }
  }
  assert.deepEqual(offenders, [], "a run's outcome depends on domPrev");
});

// lastOut does not change the log of a child after a text node (the log-level form of "lastOut is read only after a non-text node").
// Only the operations are compared: endLastOut of a run that writes nothing is the entry value (the renderer's field, milestone C C1), so it
// follows lastOut by construction and the replay adopts the same value.
test("lastOut: after a text node no candidate's log depends on lastOut", () => {
  const offenders: string[] = [];
  for (const html of CANDIDATES) {
    const a = runChild(lute, WYSIWYG_ADAPTER, html, { ...BASE_CONTEXT, prev: ast.NodeText, lastOut: 10 }, { certify: true, opaque: false });
    const b = runChild(lute, WYSIWYG_ADAPTER, html, { ...BASE_CONTEXT, prev: ast.NodeText, lastOut: 0x78 }, { certify: true, opaque: false });
    if (a.variant === null || b.variant === null) {
      continue;
    }
    if (JSON.stringify(a.variant.ops) !== JSON.stringify(b.variant.ops)) {
      offenders.push(`prev=NodeText: ${html}`);
    }
  }
  assert.deepEqual(offenders, [], "a log depends on lastOut after a text node");
});

// Pinned witnesses (the fixed test cases of the coordinator's decision): the child, the two values, and the fact that the outcomes differ;
// the variant made under A must not match the context of B. isLast is witnessed by next (the table with next -1 against a type).
const PINNED: Array<{ field: "lastOut" | "prev" | "next" | "domNext"; html: string; a: number | boolean; b: number | boolean }> = [
  { field: "lastOut", html: '<blockquote data-block="0"><h1 data-block="0" id="wysiwyg-Foo" data-marker="#">Foo</h1><p data-block="0">bar\nbaz</p></blockquote>', a: 10, b: 0x78 },
  { field: "prev", html: '<h1 data-block="0" id="wysiwyg-h1" data-marker="#">h1</h1>', a: -1, b: 16 },
  { field: "next", html: '<table data-block="0"><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>', a: -1, b: 1 },
  { field: "domNext", html: '<p data-block="0">line1<br />line2<br />line3\nline4</p>', a: -1, b: 42754 },
];

for (const p of PINNED) {
  test(`pinned witness: ${p.field} changes the output of ${JSON.stringify(p.html).slice(0, 60)}...`, () => {
    const ra = runChild(lute, WYSIWYG_ADAPTER, p.html, withField(p.field, p.a), { certify: true, opaque: false });
    const rb = runChild(lute, WYSIWYG_ADAPTER, p.html, withField(p.field, p.b), { certify: true, opaque: false });
    assert.equal(ra.refusal, null, JSON.stringify(ra.refusal));
    assert.equal(rb.refusal, null, JSON.stringify(rb.refusal));
    assert.notDeepEqual(ra.variant!.ops, rb.variant!.ops);
    assert.notEqual(ra.variant!.key, rb.variant!.key);
    assert.equal(matchesContext(ra.variant!, withField(p.field, p.b)), false);
  });
}

// NC14 (unit): the generated-id refusal (generatedIDLeaks in render) refuses a child whose render creates a node ID that the log shows. The
// prototype of the renderer writes a new ID; the same child must compose when the renderer is not patched (the control that makes the refusal
// meaningful).
test("NC14: a child whose output contains a generated node ID is refused as generated-id", () => {
  const html = '<p data-block="0">x</p>';
  const proto = FormatRenderer.prototype as unknown as { renderParagraph: (n: ast.Node, e: boolean) => ast.WalkStatus };
  const original = proto.renderParagraph;
  try {
    const before = runChild(lute, WYSIWYG_ADAPTER, html, BASE_CONTEXT, { certify: true, opaque: false });
    assert.equal(before.refusal, null, "unpatched: the child composes");
    proto.renderParagraph = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
      if (entering) {
        this.WriteString(ast.NewNodeID());
      }
      return original.call(this, node, entering);
    };
    const after = runChild(lute, WYSIWYG_ADAPTER, html, BASE_CONTEXT, { certify: true, opaque: false });
    assert.equal(after.refusal?.reason, "generated-id", JSON.stringify(after.refusal));
    assert.equal(after.variant, null);
  } finally {
    proto.renderParagraph = original;
  }
  const restored = runChild(lute, WYSIWYG_ADAPTER, html, BASE_CONTEXT, { certify: true, opaque: false });
  assert.equal(restored.refusal, null, "restored: the child composes again");
});
