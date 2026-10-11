// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// Milestone C, step C1 (tasks/004, "Milestone C analysis", section 7, C1): the invariants of the key and of the stubs.
//   I2  a stub exposes exactly the fields of its key and throws on any other read or write;
//   I4  the key contains every context field the stubs expose: a field added to Context must be added to contextKey.
// I1 (isFirst is prev < 0 and isLast is next < 0) holds by construction: Context has no isFirst or isLast field.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as ast from "../../src/ast/index.ts";
import * as atom from "../../src/html/atom/index.ts";
import * as html from "../../src/html/index.ts";
import { New } from "../../src/index.ts";
import { astStub, domStub } from "../../src/incremental/barrier.ts";
import { BarrierViolation, contextKey } from "../../src/incremental/piece.ts";
import type { Context } from "../../src/incremental/piece.ts";
import { WYSIWYG_ADAPTER, runChild } from "../../src/incremental/sandbox.ts";
import { BASE_CONTEXT } from "./witness.ts";

function violation(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof BarrierViolation, `expected BarrierViolation, got ${String(e)}`);
    return (e as BarrierViolation).site;
  }
  assert.fail("expected a BarrierViolation");
}

// I4: every field of Context changes the key when it changes (the fields are enumerated from a value, so a new field without a key entry
// fails here).
test("I4: contextKey separates every field of Context", () => {
  const base: Context = { ...BASE_CONTEXT };
  const fields = Object.keys(base) as Array<keyof Context>;
  assert.deepEqual(fields.slice().sort(), ["domNext", "domNextAttrs", "domPrev", "lastOut", "next", "prev"], "the fields of Context");
  for (const f of fields) {
    const changed: Context = { ...base, [f]: base[f] === 1 ? 2 : 1 };
    assert.notEqual(contextKey(changed), contextKey(base), `${f} must be part of the key`);
  }
});

test("I2: the previous-sibling stub answers DataAtom and Type, and throws on Attr", () => {
  const p = domStub(atom.P, null, "prev");
  assert.equal(p.DataAtom, atom.P);
  assert.equal(p.Type, html.ElementNode);
  assert.equal(violation(() => p.Attr), "dom.prev.Attr");
  assert.equal(violation(() => p.NextSibling), "dom.prev.NextSibling");
  assert.equal(violation(() => ((p as unknown as { DataAtom: number }).DataAtom = 1)), "dom.prev.=DataAtom");
});

test("I2: the next-sibling stub answers DataAtom, Type and Attr with the key's attribute count, and throws on the rest", () => {
  const n = domStub(atom.Ul, 2, "next");
  assert.equal(n.DataAtom, atom.Ul);
  assert.equal(n.Attr.length, 2);
  assert.equal(violation(() => n.Data), "dom.next.Data");
});

test("I2: an AST neighbour stub answers Type and the methods of ast.Node, and throws on the rest and on writes", () => {
  const s = astStub(ast.NodeParagraph);
  assert.equal(s.Type, ast.NodeParagraph);
  assert.equal(s.IsBlock(), true);
  assert.equal(violation(() => s.Previous), "ast.neighbour.Previous");
  assert.equal(violation(() => ((s as unknown as { Type: number }).Type = 3)), "ast.neighbour.=Type");
});

// Determinism: the same context gives the same run (the key is the whole context, so equal keys give equal logs).
test("same key, same log: a run repeated with the same context gives equal operations", () => {
  const lute = New();
  const ctx: Context = { ...BASE_CONTEXT, prev: ast.NodeText, next: ast.NodeParagraph, domNext: atom.P, domNextAttrs: 0 };
  for (const h of ['<p data-block="0">a<br>b</p>', '<blockquote data-block="0"><p data-block="0">x</p></blockquote>', '<hr data-block="0" />']) {
    const a = runChild(lute, WYSIWYG_ADAPTER, h, ctx, { certify: true, opaque: false });
    const b = runChild(lute, WYSIWYG_ADAPTER, h, ctx, { certify: true, opaque: false });
    assert.equal(a.refusal, null, JSON.stringify(a.refusal));
    assert.equal(a.variant!.key, b.variant!.key);
    assert.deepEqual(a.variant!.ops, b.variant!.ops);
    assert.equal(a.variant!.endLastOut, b.variant!.endLastOut);
  }
});
