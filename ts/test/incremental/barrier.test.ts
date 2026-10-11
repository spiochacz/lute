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

// The sandbox items of section 8.2 (the real runChild, strict in the sense that a violation is returned as an inconsistency).
import { runChild, WYSIWYG_ADAPTER } from "../../src/incremental/sandbox.ts";
import type { Context } from "../../src/incremental/piece.ts";
import { FormatRenderer } from "../../src/render/types.ts";
import * as atom from "../../src/html/atom/index.ts";
import { Lute as LuteClass } from "../../src/types.ts";

const LUTE_CTX: Context = { lastOut: 10, prev: -1, next: -1, isFirst: true, isLast: true, domPrev: -1, domNext: -1, domNextAttrs: 0 };
const LUTE: Lute = New();

function readKeysOf(v: { readKeys: string[] } | null): string[] {
  return v === null ? [] : v.readKeys;
}

test("8.2.3 prev: a NewlineIfNotLF before the first Append only when the previous node is not a block", () => {
  const bq = '<blockquote data-block="0"><p data-block="0">x</p></blockquote>';
  const afterText = runChild(LUTE, WYSIWYG_ADAPTER, bq, { ...LUTE_CTX, prev: ast.NodeText, isFirst: false }, { certify: true, opaque: false });
  const afterPara = runChild(LUTE, WYSIWYG_ADAPTER, bq, { ...LUTE_CTX, prev: ast.NodeParagraph, isFirst: false }, { certify: true, opaque: false });
  assert.equal(afterText.refusal, null, JSON.stringify(afterText.refusal));
  assert.equal(afterPara.refusal, null, JSON.stringify(afterPara.refusal));
  assert.ok(readKeysOf(afterText.variant).includes("prev"));
  assert.equal(afterText.variant!.ops[0].kind, "NewlineIfNotLF");
  assert.notEqual(afterPara.variant!.ops[0].kind, "NewlineIfNotLF");
});

test("8.2.4 domNext: a br before ul changes the output; a ul child never reads domNext", () => {
  const p = '<p data-block="0">a<br>b</p>';
  const beforeUl = runChild(LUTE, WYSIWYG_ADAPTER, p, { ...LUTE_CTX, domNext: atom.Ul, domNextAttrs: 1 }, { certify: true, opaque: false });
  const beforeP = runChild(LUTE, WYSIWYG_ADAPTER, p, { ...LUTE_CTX, domNext: atom.P, domNextAttrs: 0 }, { certify: true, opaque: false });
  assert.equal(beforeUl.refusal, null, JSON.stringify(beforeUl.refusal));
  assert.equal(beforeP.refusal, null, JSON.stringify(beforeP.refusal));
  assert.ok(readKeysOf(beforeUl.variant).includes("domNext"));
  assert.notDeepEqual(beforeUl.variant!.ops, beforeP.variant!.ops);
  const ul = '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>';
  const ulNext = runChild(LUTE, WYSIWYG_ADAPTER, ul, { ...LUTE_CTX, domNext: atom.Ul, domNextAttrs: 0 }, { certify: true, opaque: false });
  assert.equal(ulNext.refusal, null, JSON.stringify(ulNext.refusal));
  assert.equal(readKeysOf(ulNext.variant).includes("domNext"), false, "the covered merge read is not recorded");
});

// Violations (item 5): each patches one engine function with a read outside the declared context, runs the child, and restores it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: the patched functions have specific signatures
function withPatch(target: object, name: string, wrap: (orig: any) => any, fn: () => void): void {
  const obj = target as Record<string, unknown>;
  const orig = obj[name];
  obj[name] = wrap(orig);
  try {
    fn();
  } finally {
    obj[name] = orig;
  }
}

test("8.2.5a a read of a neighbour's field (Previous.Tokens) throws BarrierViolation", () => {
  withPatch(
    FormatRenderer.prototype,
    "renderParagraph",
    (orig) =>
      function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
        if (entering && node.Previous !== null) {
          void node.Previous.Tokens;
        }
        return orig.call(this, node, entering) as ast.WalkStatus;
      },
    () => {
      const r = runChild(LUTE, WYSIWYG_ADAPTER, '<p data-block="0">x</p>', { ...LUTE_CTX, prev: ast.NodeText, isFirst: false }, { certify: true, opaque: false });
      assert.deepEqual(r.refusal, { kind: "inconsistency", reason: "barrier:ast.neighbour.Tokens" });
    },
  );
});

test("8.2.5b a read of the next DOM sibling's Data throws BarrierViolation (dom.next.Data)", () => {
  withPatch(
    LuteClass.prototype,
    "mergeSameStrong",
    (orig) =>
      function (this: Lute, n: html.Node): void {
        orig.call(this, n);
        if (n.Parent !== null && n.Parent.DataAtom === atom.Body) {
          void n.NextSibling!.Data;
        }
      },
    () => {
      const r = runChild(LUTE, WYSIWYG_ADAPTER, '<p data-block="0">x</p>', { ...LUTE_CTX, domNext: atom.Ul, domNextAttrs: 1 }, { certify: true, opaque: false });
      assert.deepEqual(r.refusal, { kind: "inconsistency", reason: "barrier:dom.next.Data" });
    },
  );
});

test("8.2.5e Unlink of a top-level child with a neighbour is a violation of the neighbour's stub", () => {
  withPatch(
    LuteClass.prototype,
    "adjustTag",
    (orig) =>
      function (this: Lute, n: html.Node): void {
        orig.call(this, n);
        n.Unlink();
      },
    () => {
      const r = runChild(LUTE, WYSIWYG_ADAPTER, '<p data-block="0">x</p>', { ...LUTE_CTX, domNext: atom.Ul, domNextAttrs: 1 }, { certify: true, opaque: false });
      assert.equal(r.refusal?.kind, "inconsistency");
      assert.ok(r.refusal!.reason.startsWith("barrier:dom.next."), r.refusal!.reason);
    },
  );
});
