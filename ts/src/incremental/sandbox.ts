// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The sandbox (section 3): one top-level child runs alone, from its string to its root-writer log. Milestone C (C1 and C2): the run is three
// phases, analyse (parse, certificate, passes 1-3), build (the DOM neighbours are linked by stubs, passes 4-15, genAST, adjustTree) and
// render (the AST neighbours are linked by stubs, the recording render). The variant key is the whole context (contextKey), so no read
// is recorded. runChild is the composition of the three phases for one context.

import * as ast from "../ast/index.ts";
import * as atom from "../html/atom/index.ts";
import * as conv from "../runtime/conv.ts";
import * as lex from "../lex/index.ts";
import * as html from "../html/index.ts";
import * as parse from "../parse/index.ts";
import * as util from "../util/index.ts";
import { RecordingFormatRenderer } from "../render/recording_format_renderer.ts";
import type { RootOp } from "../render/recording_format_renderer.ts";
import { registerFormatRendererFuncs } from "../render/format_renderer.ts";
import type { Lute } from "../types.ts";
import { vditorDOM2MdAdjustTree, vditorDOM2MdPreprocess, vditorDOM2MdRenderOptions } from "../vditor_wysiwyg.ts";
import { vditorIRDOM2MdAdjustTree, vditorIRDOM2MdPreprocess, vditorIRDOM2MdRenderOptions } from "../vditor_ir.ts";
import type { Options as RenderOptions } from "../render/renderer.ts";
import { IncrementalInconsistency, BarrierViolation, contextKey } from "./piece.ts";
import type { ChildInfo, Context, Mode, Refusal, Variant } from "./piece.ts";
import { astStub, barrierStub, domStub } from "./barrier.ts";
import { certify, bodyOf, parseWithBoundary } from "./parser_certificate.ts";

// The fixed ID that SetTesting(true) gives every generated node ID (section 3.6, S15).
export const GENERATED_ID = "20060102150405-1a2b3c4";

export interface ModeAdapter {
  mode: Mode;
  preprocess(html: string): string;
  genAST(lute: Lute, child: html.Node, tree: parse.Tree): void;
  adjustTree(tree: parse.Tree): void;
  renderOptions(): RenderOptions;
}

export const WYSIWYG_ADAPTER: ModeAdapter = {
  mode: "wysiwyg",
  preprocess: (h: string): string => vditorDOM2MdPreprocess(h),
  genAST: (lute: Lute, child: html.Node, tree: parse.Tree): void => {
    lute.genASTByVditorDOM(child, tree);
  },
  adjustTree: (tree: parse.Tree): void => {
    vditorDOM2MdAdjustTree(tree);
  },
  renderOptions: (): RenderOptions => vditorDOM2MdRenderOptions(),
};

// IR_ADAPTER is the adapter of the Vditor IR DOM (vditor_ir.ts): the same stages as WYSIWYG_ADAPTER, with the IR functions.
export const IR_ADAPTER: ModeAdapter = {
  mode: "ir",
  preprocess: (h: string): string => vditorIRDOM2MdPreprocess(h),
  genAST: (lute: Lute, child: html.Node, tree: parse.Tree): void => {
    lute.genASTByVditorIRDOM(child, tree);
  },
  adjustTree: (tree: parse.Tree): void => {
    vditorIRDOM2MdAdjustTree(tree);
  },
  renderOptions: (): RenderOptions => vditorIRDOM2MdRenderOptions(),
};

// The DOM passes of adjustVditorDOM (vditor_wysiwyg.ts), in the engine's order (section 3.2). scope "root" passes take the root (the body),
// "child" passes take the child (the first child of the root; removeWbr is called with root.FirstChild as the engine does). The first
// three passes run before the DOM neighbours are linked (phase analyse); passes 4 to 15 run with the links in place (phase build).
export const ADJUST_PASSES: Array<{ name: string; scope: "root" | "child" }> = [
  { name: "removeEmptyNodes", scope: "root" },
  { name: "removeHighlightJSSpans", scope: "root" },
  { name: "removeWbr", scope: "child" },
  { name: "mergeVditorDOMList0", scope: "child" },
  { name: "adjustVditorDOMListTight0", scope: "child" },
  { name: "adjustVditorDOMListList", scope: "child" },
  { name: "adjustVditorDOMListItemInP", scope: "child" },
  { name: "removeCodeCode", scope: "child" },
  { name: "adjustVditorDOMCodeA", scope: "child" },
  { name: "adjustTag", scope: "child" },
  { name: "mergeSameStrong", scope: "child" },
  { name: "adjustTableCode", scope: "child" },
  { name: "adjustMath", scope: "child" },
  { name: "adjustNoscriptImg", scope: "child" },
  { name: "adjustBlockInTable", scope: "child" },
];

// SandboxRenderer is the recording renderer of a sandbox run. Its Newline at the root writes nothing and does not read LastOut
// (section 2.2): the replay decides the newline. A nested Newline reads LastOut, which is the entry value of the run (the key has it).
export class SandboxRenderer extends RecordingFormatRenderer {
  Newline(): void {
    const r = this;
    if (null !== r.sink && r.isRootWriter()) {
      r.sink.push({ kind: "NewlineIfNotLF" });
      r.LastOut = lex.ItemNewline;
      return;
    }
    RecordingFormatRenderer.prototype.Newline.call(r);
  }
}

export function newSandboxRenderer(tree: parse.Tree, options: RenderOptions, parseOptions: parse.Options): SandboxRenderer {
  const ret = new SandboxRenderer(tree, options, parseOptions);
  registerFormatRendererFuncs(ret);
  return ret;
}

export interface RunOptions {
  certify: boolean; // parse with the certificate (first run of a child); false when the child is already certified
  opaque: boolean; // the scanner flagged the child as containing a data-render preview
}

export interface RunResult {
  info: ChildInfo | null; // null when the run refused before the child's info was known
  variant: Variant | null;
  refusal: Refusal | null;
}

// The DOM context of a child: the neighbours' atoms and the attribute count of the next one (the covered merge read).
export interface DomCtx {
  domPrev: number;
  domNext: number;
  domNextAttrs: number;
}

// A child between the phases of one call (milestone C, C2). It holds DOM nodes, so it lives only inside one call (invariant I3).
export interface Handle {
  root: html.Node; // the body of the child's own parse
  child: html.Node; // root.FirstChild, the child itself
  atomMerge: number; // DataAtom before the merge pass
  attrsMerge: number; // Attr.length before the merge pass
}

export type Analysis = { kind: "refused"; refusal: Refusal } | { kind: "dead"; atom: number } | { kind: "alive"; handle: Handle };

export interface Built {
  info: ChildInfo; // context-free; topTypes come from the tree of the build
  tree: parse.Tree;
  tops: ast.Node[]; // the top-level AST nodes of the child
  tipOpen: boolean; // tree.Context.Tip is not the root after genAST
}

export type Rendered = { variant: Variant } | { refusal: Refusal };

// callPass calls one DOM pass of the engine by name on the given node, with the engine's own method.
function callPass(lute: Lute, name: string, node: html.Node): void {
  const f = (lute as unknown as Record<string, (n: html.Node) => void>)[name];
  f.call(lute, node);
}

// withTesting runs f with the testing flag of the node IDs on (section 3.6, S15), and restores the caller's flag, also on a throw.
export function withTesting<T>(f: () => T): T {
  const was = ast.GetTesting();
  ast.SetTesting(true);
  try {
    return f();
  } finally {
    ast.SetTesting(was);
  }
}

// coalesce merges adjacent Append operations with the same setsLastOut and drops empty ones (section 2.3).
export function coalesce(ops: RootOp[]): RootOp[] {
  const out: RootOp[] = [];
  for (const op of ops) {
    if (op.kind === "Append") {
      if (op.bytes.length === 0) {
        continue;
      }
      const last = out.length > 0 ? out[out.length - 1] : null;
      if (last !== null && last.kind === "Append" && last.setsLastOut === op.setsLastOut) {
        const m = new Uint8Array(last.bytes.length + op.bytes.length);
        m.set(last.bytes, 0);
        m.set(op.bytes, last.bytes.length);
        out[out.length - 1] = { kind: "Append", bytes: m, setsLastOut: op.setsLastOut };
        continue;
      }
    }
    out.push(op);
  }
  return out;
}

// classify maps an exception of a phase to a refusal: a barrier violation or an inconsistency is an inconsistency, any other exception
// is engine-threw (section 6).
export function classify(e: unknown): Refusal {
  if (e instanceof BarrierViolation) {
    return { kind: "inconsistency", reason: "barrier:" + e.site };
  }
  if (e instanceof IncrementalInconsistency) {
    return { kind: "inconsistency", reason: e.reason };
  }
  return { kind: "unsupported", reason: "engine-threw" };
}

// analyse is the first phase: the DOM of the child (parsed with the certificate when doCertify), passes 1 to 3. It returns the handle,
// or a refusal (certificate), or "dead" (removeEmptyNodes removed the child). It does not link any neighbour.
export function analyse(lute: Lute, htmlStr: string, doCertify: boolean, opaque: boolean): Analysis {
  let body: html.Node | null;
  if (doCertify) {
    const p = parseWithBoundary(htmlStr);
    const failed = certify(htmlStr, p.doc, p.boundary);
    if (failed !== null) {
      const refusal: Refusal = opaque
        ? { kind: "unsupported", reason: "cert:opaque-preview" }
        : { kind: "inconsistency", reason: "cert:scanner-accepted-certificate-refused" };
      return { kind: "refused", refusal };
    }
    body = bodyOf(p.doc);
  } else {
    body = util.ParseHTML(htmlStr);
  }
  if (body === null || body.FirstChild === null) {
    throw new Error("sandbox: the child parsed to no node");
  }
  const root: html.Node = body;
  const child: html.Node = body.FirstChild;
  const atomBefore = child.DataAtom;
  callPass(lute, "removeEmptyNodes", root);
  if (root.FirstChild === null) {
    return { kind: "dead", atom: atomBefore };
  }
  callPass(lute, "removeHighlightJSSpans", root);
  if (root.FirstChild !== null) {
    callPass(lute, "removeWbr", root.FirstChild);
  }
  return { kind: "alive", handle: { root, child, atomMerge: child.DataAtom, attrsMerge: child.Attr.length } };
}

// build is the second phase: the DOM neighbours are linked (plain assignments, milestone C C1), passes 4 to 15 run with the links in
// place, then genAST of the child, the tip check and adjustTree. The caller runs it inside withTesting.
export function build(lute: Lute, adapter: ModeAdapter, h: Handle, dom: DomCtx): Built {
  const { root, child } = h;
  if (root.FirstChild !== child || child.PrevSibling !== null || child.NextSibling !== null) {
    throw new IncrementalInconsistency("sibling-structure-changed", "a DOM pass before the links inserted or removed a top-level node");
  }
  const prevStub = dom.domPrev < 0 ? null : domStub(dom.domPrev, null, "prev");
  const nextStub = dom.domNext < 0 ? null : domStub(dom.domNext, dom.domNextAttrs, "next");
  child.PrevSibling = prevStub;
  child.NextSibling = nextStub;
  if (prevStub !== null) {
    root.FirstChild = barrierStub("dom.root.FirstChild") as html.Node;
  }
  if (nextStub !== null) {
    root.LastChild = barrierStub("dom.root.LastChild") as html.Node;
  }
  const linkedFirst = root.FirstChild;
  const linkedLast = root.LastChild;
  for (const pass of ADJUST_PASSES.slice(3)) {
    callPass(lute, pass.name, child);
  }
  if (root.FirstChild !== linkedFirst || root.LastChild !== linkedLast || child.PrevSibling !== prevStub || child.NextSibling !== nextStub) {
    throw new IncrementalInconsistency("sibling-structure-changed", "a DOM pass changed the top-level links");
  }
  if (child.DataAtom !== h.atomMerge) {
    throw new IncrementalInconsistency("top-level-atom-changed", `DataAtom ${h.atomMerge} then ${child.DataAtom}`);
  }
  const tree = new parse.Tree();
  tree.Name = "";
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.Context = new parse.Context(lute.ParseOptions);
  tree.Context.Tip = tree.Root;
  adapter.genAST(lute, child, tree);
  const tipOpen = tree.Context!.Tip !== tree.Root;
  adapter.adjustTree(tree);
  const tops: ast.Node[] = [];
  for (let c = tree.Root!.FirstChild; c !== null; c = c.Next) {
    tops.push(c);
  }
  const info: ChildInfo = { alive: true, atom: h.atomMerge, attrs: h.attrsMerge, topTypes: tops.map((n) => n.Type) };
  return { info, tree, tops, tipOpen };
}

// render is the third phase: the AST neighbours are linked from prev and next (isFirst and isLast are prev < 0 and next < 0, invariant I1),
// the recording renderer runs with LastOut = ctx.lastOut, and the root-writer log is coalesced. The caller runs it inside withTesting.
export function render(lute: Lute, adapter: ModeAdapter, b: Built, ctx: Context): Rendered {
  const { tree, tops } = b;
  if (tops.length > 0) {
    const first = tops[0];
    const last = tops[tops.length - 1];
    first.Previous = ctx.prev < 0 ? null : astStub(ctx.prev);
    last.Next = ctx.next < 0 ? null : astStub(ctx.next);
    if (ctx.prev >= 0) {
      tree.Root!.FirstChild = barrierStub("ast.root.FirstChild") as ast.Node;
    }
    if (ctx.next >= 0) {
      tree.Root!.LastChild = barrierStub("ast.root.LastChild") as ast.Node;
    }
  }
  const r = newSandboxRenderer(tree, adapter.renderOptions(), lute.ParseOptions);
  r.LastOut = ctx.lastOut;
  const ops: RootOp[] = [];
  r.renderDocument(tree.Root!, true);
  r.sink = ops;
  for (const t of tops) {
    ast.Walk(t, (n: ast.Node, entering: boolean): ast.WalkStatus => r.dispatch(n, entering));
  }
  r.sink = null;
  // no renderDocument exit: the document close is the assembly's job (3.4)
  const endLastOut = r.LastOut;
  const merged = coalesce(ops);
  let text = "";
  let size = 96;
  for (const op of merged) {
    if (op.kind === "Append") {
      text += conv.StringFromBytes(op.bytes);
      size += op.bytes.length + 64;
    } else {
      size += 64;
    }
  }
  if (text.includes(GENERATED_ID)) {
    return { refusal: { kind: "unsupported", reason: "generated-id" } };
  }
  return { variant: { key: contextKey(ctx), ops: merged, endLastOut, bytes: size } };
}

// runChild runs one child alone (section 3): analyse, build and render for one context. It never throws: a barrier violation or an
// internal inconsistency is returned as an inconsistency refusal, any other exception as engine-threw. The testing flag is on for the
// whole run (3.6).
export function runChild(lute: Lute, adapter: ModeAdapter, htmlStr: string, ctx: Context, opts: RunOptions): RunResult {
  return withTesting((): RunResult => {
    try {
      const a = analyse(lute, htmlStr, opts.certify, opts.opaque);
      if (a.kind === "refused") {
        return { info: null, variant: null, refusal: a.refusal };
      }
      if (a.kind === "dead") {
        return { info: { alive: false, atom: a.atom, attrs: 0, topTypes: [] }, variant: null, refusal: null };
      }
      const b = build(lute, adapter, a.handle, ctx);
      if (b.tipOpen) {
        return { info: b.info, variant: null, refusal: { kind: "unsupported", reason: "tip-open" } };
      }
      const r = render(lute, adapter, b, ctx);
      if ("refusal" in r) {
        return { info: b.info, variant: null, refusal: r.refusal };
      }
      return { info: b.info, variant: r.variant, refusal: null };
    } catch (e) {
      return { info: null, variant: null, refusal: classify(e) };
    }
  });
}

// listCoupling decides whether the engine's mergeVditorDOMList0 would merge two alive children (section 3.5): it runs the pass on a
// skeleton of stubs, one per alive child, and reports whether a stub was unlinked.
export function listCoupling(lute: Lute, infos: ChildInfo[]): boolean {
  const root = new html.Node();
  root.Type = html.ElementNode;
  root.DataAtom = atom.Body;
  root.Data = "body";
  let count = 0;
  for (const info of infos) {
    if (!info.alive) {
      continue;
    }
    const n = new html.Node();
    n.Type = html.ElementNode;
    n.DataAtom = info.atom;
    n.Attr = Array.from({ length: info.attrs }, () => ({ Namespace: "", Key: "k", Val: "v" }));
    root.AppendChild(n);
    count++;
  }
  for (let c = root.FirstChild; c !== null; c = c.NextSibling) {
    lute.mergeVditorDOMList0(c);
  }
  let left = 0;
  for (let c = root.FirstChild; c !== null; c = c.NextSibling) {
    left++;
  }
  return left !== count;
}
