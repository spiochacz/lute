// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The sandbox (section 3): one top-level child runs alone, from its string to its root-writer log. The DOM passes are driven one by one
// (3.2), the child's genAST runs with the DOM barrier armed (3.3), the tree is adjusted by the engine's own walk, and the render phase
// records the operations on the root writer with the context reads of section 2 (3.4).

import * as ast from "../../../../src/ast/index.ts";
import * as atom from "../../../../src/html/atom/index.ts";
import * as conv from "../../../../src/runtime/conv.ts";
import * as lex from "../../../../src/lex/index.ts";
import * as html from "../../../../src/html/index.ts";
import * as parse from "../../../../src/parse/index.ts";
import * as util from "../../../../src/util/index.ts";
import { RecordingFormatRenderer } from "../../../../src/render/recording_format_renderer.ts";
import type { RootOp } from "../../../../src/render/recording_format_renderer.ts";
import { registerFormatRendererFuncs } from "../../../../src/render/format_renderer.ts";
import type { Lute } from "../../../../src/types.ts";
import { vditorDOM2MdAdjustTree, vditorDOM2MdPreprocess, vditorDOM2MdRenderOptions } from "../../../../src/vditor_wysiwyg.ts";
import { vditorIRDOM2MdAdjustTree, vditorIRDOM2MdPreprocess, vditorIRDOM2MdRenderOptions } from "../../../../src/vditor_ir.ts";
import type { Options as RenderOptions } from "../../../../src/render/renderer.ts";
import { IncrementalInconsistency, BarrierViolation, LASTOUT_PASS } from "./piece.ts";
import type { ChildInfo, Context, Mode, ReadKey, Refusal, Variant } from "./piece.ts";
import { astStub, barrierStub, domStub, guard, guardAst } from "./barrier.ts";
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
// "child" passes take the child (the first child of the root; removeWbr is called with root.FirstChild as the engine does).
// armed: the DOM barrier is on during the pass; covered: the reads of the pass are answered but not recorded (mergeVditorDOMList0, 3.5).
export const ADJUST_PASSES: Array<{ name: string; scope: "root" | "child"; armed: boolean; covered: boolean }> = [
  { name: "removeEmptyNodes", scope: "root", armed: false, covered: false },
  { name: "removeHighlightJSSpans", scope: "root", armed: false, covered: false },
  { name: "removeWbr", scope: "child", armed: false, covered: false },
  { name: "mergeVditorDOMList0", scope: "child", armed: true, covered: true },
  { name: "adjustVditorDOMListTight0", scope: "child", armed: true, covered: false },
  { name: "adjustVditorDOMListList", scope: "child", armed: true, covered: false },
  { name: "adjustVditorDOMListItemInP", scope: "child", armed: true, covered: false },
  { name: "removeCodeCode", scope: "child", armed: true, covered: false },
  { name: "adjustVditorDOMCodeA", scope: "child", armed: true, covered: false },
  { name: "adjustTag", scope: "child", armed: true, covered: false },
  { name: "mergeSameStrong", scope: "child", armed: true, covered: false },
  { name: "adjustTableCode", scope: "child", armed: true, covered: false },
  { name: "adjustMath", scope: "child", armed: true, covered: false },
  { name: "adjustNoscriptImg", scope: "child", armed: true, covered: false },
  { name: "adjustBlockInTable", scope: "child", armed: true, covered: false },
];

// SandboxRenderer is the recording renderer of a sandbox run. Its Newline at the root writes nothing and does not read LastOut
// (section 2.2): the replay decides the newline. A nested Newline reads LastOut (the accessor of the run records the read).
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

// callPass calls one DOM pass of the engine by name on the given node, with the engine's own method.
function callPass(lute: Lute, name: string, node: html.Node): void {
  const f = (lute as unknown as Record<string, (n: html.Node) => void>)[name];
  f.call(lute, node);
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

function classify(e: unknown): Refusal {
  if (e instanceof BarrierViolation) {
    return { kind: "inconsistency", reason: "barrier:" + e.site };
  }
  if (e instanceof IncrementalInconsistency) {
    return { kind: "inconsistency", reason: e.reason };
  }
  return { kind: "unsupported", reason: "engine-threw" };
}

// runChild runs one child alone (section 3). It never throws: a barrier violation or an internal inconsistency is returned as an
// inconsistency refusal, any other exception as engine-threw. The testing flag is on for the whole run (3.6).
export function runChild(lute: Lute, adapter: ModeAdapter, htmlStr: string, ctx: Context, opts: RunOptions): RunResult {
  const was = ast.GetTesting();
  ast.SetTesting(true);
  try {
    return runChildInner(lute, adapter, htmlStr, ctx, opts);
  } catch (e) {
    return { info: null, variant: null, refusal: classify(e) };
  } finally {
    ast.SetTesting(was);
  }
}

function runChildInner(lute: Lute, adapter: ModeAdapter, htmlStr: string, ctx: Context, opts: RunOptions): RunResult {
  // (1) the DOM
  let body: html.Node | null;
  if (opts.certify) {
    const p = parseWithBoundary(htmlStr);
    const failed = certify(htmlStr, p.doc, p.boundary);
    if (failed !== null) {
      const refusal: Refusal = opts.opaque
        ? { kind: "unsupported", reason: "cert:opaque-preview" }
        : { kind: "inconsistency", reason: "cert:scanner-accepted-certificate-refused" };
      return { info: null, variant: null, refusal };
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

  // The reads of the run, in order of first read (2.1).
  const reads = new Map<ReadKey, number | boolean>();
  const record = (key: ReadKey, value: number | boolean): void => {
    if (!reads.has(key)) {
      reads.set(key, value);
    }
  };

  // (2) the DOM guards (3.3)
  const dom = { armed: false, covered: false };
  guard(child, "PrevSibling", (backing: html.Node | null): html.Node | null => {
    if (!dom.armed || backing !== null) {
      return backing;
    }
    record("domPrev", ctx.domPrev);
    return ctx.domPrev < 0 ? null : domStub(ctx.domPrev, 0);
  });
  guard(child, "NextSibling", (backing: html.Node | null): html.Node | null => {
    if (!dom.armed || backing !== null) {
      return backing;
    }
    if (!dom.covered) {
      record("domNext", ctx.domNext);
    }
    return ctx.domNext < 0 ? null : domStub(ctx.domNext, ctx.domNextAttrs);
  });
  guard(root, "FirstChild", (backing: html.Node | null): html.Node | null => {
    if (!dom.armed) {
      return backing;
    }
    record("domPrev", ctx.domPrev);
    return ctx.domPrev < 0 ? backing : (barrierStub("dom.root.FirstChild") as html.Node);
  });
  guard(root, "LastChild", (backing: html.Node | null): html.Node | null => {
    if (!dom.armed) {
      return backing;
    }
    if (!dom.covered) {
      record("domNext", ctx.domNext);
    }
    return ctx.domNext < 0 ? backing : (barrierStub("dom.root.LastChild") as html.Node);
  });

  // (3) the passes, in the engine's order, with the checks of 3.2
  callPass(lute, "removeEmptyNodes", root);
  if (root.FirstChild === null) {
    return { info: { alive: false, atom: atomBefore, attrs: 0, topTypes: [] }, variant: null, refusal: null };
  }
  callPass(lute, "removeHighlightJSSpans", root);
  if (root.FirstChild !== null) {
    callPass(lute, "removeWbr", root.FirstChild);
  }
  const atomMerge = child.DataAtom;
  const attrsMerge = child.Attr.length;
  for (const pass of ADJUST_PASSES.slice(3)) {
    dom.armed = pass.armed;
    dom.covered = pass.covered;
    try {
      callPass(lute, pass.name, child);
    } finally {
      dom.armed = false;
      dom.covered = false;
    }
  }
  if (root.FirstChild !== child || child.PrevSibling !== null || child.NextSibling !== null) {
    throw new IncrementalInconsistency("sibling-structure-changed", "a DOM pass inserted or removed a top-level node");
  }
  const atomFinal = child.DataAtom;
  if (atomFinal !== atomMerge) {
    throw new IncrementalInconsistency("top-level-atom-changed", `DataAtom ${atomMerge} then ${atomFinal}`);
  }

  // (4) genAST with the barrier armed (genAST is called for the child only, as a sandbox run of one child)
  const tree = new parse.Tree();
  tree.Name = "";
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.Context = new parse.Context(lute.ParseOptions);
  tree.Context.Tip = tree.Root;
  dom.armed = true;
  dom.covered = false;
  try {
    adapter.genAST(lute, child, tree);
  } finally {
    dom.armed = false;
  }
  const tipOpen = tree.Context!.Tip !== tree.Root;
  adapter.adjustTree(tree);
  const tops: ast.Node[] = [];
  for (let c = tree.Root!.FirstChild; c !== null; c = c.Next) {
    tops.push(c);
  }
  const info: ChildInfo = { alive: true, atom: atomFinal, attrs: attrsMerge, topTypes: tops.map((n) => n.Type) };
  if (tipOpen) {
    return { info, variant: null, refusal: { kind: "unsupported", reason: "tip-open" } };
  }

  // (5) the render phase (3.4)
  const r = newSandboxRenderer(tree, adapter.renderOptions(), lute.ParseOptions);
  let value = ctx.lastOut;
  let assigned = false;
  Object.defineProperty(r, "LastOut", {
    configurable: true,
    enumerable: true,
    get(): number {
      if (!assigned) {
        record("lastOut", ctx.lastOut);
      }
      return value;
    },
    set(v: number): void {
      assigned = true;
      value = v;
    },
  });
  if (tops.length > 0) {
    const first = tops[0];
    const last = tops[tops.length - 1];
    guardAst(first, "Previous", (): ast.Node | null => {
      record("prev", ctx.prev);
      return ctx.prev < 0 ? null : astStub(ctx.prev);
    });
    guardAst(last, "Next", (): ast.Node | null => {
      record("next", ctx.next);
      return ctx.next < 0 ? null : astStub(ctx.next);
    });
    guardAst(tree.Root!, "FirstChild", (): ast.Node | null => {
      record("isFirst", ctx.isFirst);
      return ctx.isFirst ? first : (barrierStub("ast.root.FirstChild") as ast.Node);
    });
    guardAst(tree.Root!, "LastChild", (): ast.Node | null => {
      record("isLast", ctx.isLast);
      return ctx.isLast ? last : (barrierStub("ast.root.LastChild") as ast.Node);
    });
  }
  const ops: RootOp[] = [];
  r.renderDocument(tree.Root!, true);
  r.sink = ops;
  for (const t of tops) {
    ast.Walk(t, (n: ast.Node, entering: boolean): ast.WalkStatus => r.dispatch(n, entering));
  }
  r.sink = null;
  // no renderDocument exit: the document close is the assembly's job (3.4)

  // (6) after the run (3.6)
  const endLastOut = assigned ? value : LASTOUT_PASS;
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
    return { info, variant: null, refusal: { kind: "unsupported", reason: "generated-id" } };
  }
  const readKeys = Array.from(reads.keys());
  const readVals = readKeys.map((k) => reads.get(k)!);
  const variant: Variant = { readKeys, readVals, ops: merged, endLastOut, bytes: size };
  return { info, variant, refusal: null };
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

