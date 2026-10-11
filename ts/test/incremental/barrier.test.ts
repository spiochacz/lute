// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Unit tests of the read barrier (section 8.2, items for the stubs and guards; the sandbox items are added with the sandbox).

import { test } from "node:test";
import assert from "node:assert/strict";
import { BarrierViolation } from "../../src/incremental/piece.ts";
import * as ast from "../../src/ast/index.ts";
import * as html from "../../src/html/index.ts";
import { New } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { astStub, barrierStub, domStub, guard } from "../../src/incremental/barrier.ts";

function violation(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof BarrierViolation, `expected BarrierViolation, got ${String(e)}`);
    return (e as BarrierViolation).site;
  }
  assert.fail("expected a BarrierViolation");
}

test("guard: the getter gives the value read(backing), the setter replaces the backing value", () => {
  const o = { a: 1 };
  guard(o, "a", (b) => b * 10);
  assert.equal(o.a, 10);
  o.a = 4;
  assert.equal(o.a, 40);
  const desc = Object.getOwnPropertyDescriptor(o, "a");
  assert.equal(desc?.enumerable, true);
  assert.equal(desc?.configurable, true);
});

test("domStub answers DataAtom, Type and Attr", () => {
  const s = domStub(22020, 3);
  assert.equal(s.DataAtom, 22020);
  assert.equal(s.Type, html.ElementNode);
  assert.equal(s.Attr.length, 3);
  assert.deepEqual(s.Attr[0], { Namespace: "", Key: "k", Val: "v" });
});

test("domStub throws BarrierViolation with the site for any other property, and for writes", () => {
  const s = domStub(10244, 0);
  assert.equal(violation(() => s.Data), "dom.next.Data");
  assert.equal(violation(() => s.FirstChild), "dom.next.FirstChild");
  assert.equal(violation(() => (s.DataAtom = 1)), "dom.next.=DataAtom");
});

test("astStub answers Type, passes methods of ast.Node through, and throws for other properties", () => {
  const s = astStub(ast.NodeParagraph);
  assert.equal(s.Type, ast.NodeParagraph);
  assert.equal(s.IsBlock(), true);
  assert.equal(violation(() => s.Tokens), "ast.neighbour.Tokens");
  assert.equal(violation(() => s.Parent), "ast.neighbour.Parent");
});

test("barrierStub throws on every read and write, and identity comparison works", () => {
  const b = barrierStub("dom.root.FirstChild");
  assert.equal(violation(() => (b as { x: unknown }).x), "dom.root.FirstChild.x");
  assert.equal(violation(() => ((b as { x: unknown }).x = 1)), "dom.root.FirstChild.=x");
  const other = barrierStub("dom.root.FirstChild");
  assert.equal(b === b, true);
  assert.equal(b === other, false);
});

test("BarrierViolation carries the site", () => {
  const e = new BarrierViolation("ast.root.LastChild.Data");
  assert.equal(e.site, "ast.root.LastChild.Data");
  assert.ok(e instanceof Error);
});

