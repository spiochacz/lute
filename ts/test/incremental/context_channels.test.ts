// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Each declared context field is COVERED (its reads are recorded and no run reads outside the declared context) and REAL (some child's
// output depends on it), the latter by witness search (coordinator decision, deviation 8). A field with no witness is reported, not failed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { scanTopLevel } from "../../src/incremental/scanner.ts";
import { WYSIWYG_ADAPTER, runChild } from "../../src/incremental/sandbox.ts";
import { auditDocuments } from "./corpus_docs.ts";
import { FIELD_VALUES, BASE_CONTEXT, matchesContext, searchWitness, withField } from "./witness.ts";

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
const barrierTrips: string[] = [];

test("COVERED: no run of a corpus child under the base context or any single-field change trips the barrier", () => {
  for (const html of CANDIDATES) {
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
  process.stdout.write(`COVERED: ${CANDIDATES.length} candidates x ${FIELD_VALUES.length} fields x 2 values, no barrier trips\n`);
});

for (const spec of FIELD_VALUES) {
  test(`REAL: the output of some child depends on ${spec.field} (witness search, ${CANDIDATES.length} candidates)`, () => {
    const res = searchWitness(lute, WYSIWYG_ADAPTER, spec.field, CANDIDATES, BUDGET_MS);
    if (res.witness === null) {
      process.stdout.write(`REAL ${spec.field}: no witness found over ${res.candidates} candidates in ${res.ms} ms\n`);
      return;
    }
    const w = res.witness;
    process.stdout.write(`REAL ${spec.field}: witness after ${res.candidates} candidates: ${JSON.stringify(w.html)} with ${spec.field} ${String(w.a)} vs ${String(w.b)}\n`);
    assert.notEqual(w.outA, w.outB);
    // the key separates the two variants: the variant recorded under A does not match B
    const ctxB = withField(spec.field, w.b);
    const vA = runChild(lute, WYSIWYG_ADAPTER, w.html, withField(spec.field, w.a), { certify: true, opaque: false }).variant;
    assert.ok(vA !== null);
    assert.ok(vA!.readKeys.includes(spec.field), `${spec.field} must be a recorded read of the witness`);
    assert.equal(matchesContext(vA!, ctxB), false, "the variant of A must not match the context of B");
    void BASE_CONTEXT;
  });
}

// Pinned witnesses (the fixed test cases of the coordinator's decision): the child, the two values, and the fact that the outcomes differ;
// the variant recorded under A must not match the context of B.
const PINNED: Array<{ field: "lastOut" | "isLast" | "prev" | "next" | "domNext"; html: string; a: number | boolean; b: number | boolean }> = [
  { field: "lastOut", html: '<blockquote data-block="0"><h1 data-block="0" id="wysiwyg-Foo" data-marker="#">Foo</h1><p data-block="0">bar\nbaz</p></blockquote>', a: 10, b: 0x78 },
  { field: "isLast", html: '<table data-block="0"><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>', a: true, b: false },
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
    assert.ok(ra.variant!.readKeys.includes(p.field));
    assert.equal(matchesContext(ra.variant!, withField(p.field, p.b)), false);
  });
}
