// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The sandbox (section 3): one top-level child runs alone, from its string to its root-writer log. Milestone C (C1 and C2): the run is three
// phases, analyse (parse, certificate, passes 1-3), build (the DOM neighbours are linked by stubs, passes 4-15, genAST, adjustTree) and
// render (the AST neighbours are linked by stubs, the recording render). The variant key is the whole context (contextKey), so no read
// is recorded. runChild is the composition of the three phases for one context.

import * as ast from "../ast/index.ts";
import * as atom from "../html/atom/index.ts";
import * as lex from "../lex/index.ts";
import * as html from "../html/index.ts";
import * as parse from "../parse/index.ts";
import * as util from "../util/index.ts";
import { RecordingFormatRenderer } from "../render/recording_format_renderer.ts";
import type { RootOp } from "../render/recording_format_renderer.ts";
import { registerFormatRendererFuncs } from "../render/format_renderer.ts";
import { FormatRenderer } from "../render/types.ts";
import type { Lute } from "../types.ts";
import { ADJUST_VDITOR_DOM_PASSES, vditorDOM2MdAdjustTree, vditorDOM2MdPreprocess, vditorDOM2MdRenderOptions } from "../vditor_wysiwyg.ts";
import { vditorIRDOM2MdAdjustTree, vditorIRDOM2MdPreprocess, vditorIRDOM2MdRenderOptions } from "../vditor_ir.ts";
import type { Options as RenderOptions, RendererFunc } from "../render/renderer.ts";
import { IncrementalInconsistency, BarrierViolation, contextKey } from "./piece.ts";
import type { ChildInfo, Context, Mode, Refusal, Variant } from "./piece.ts";
import { astStub, barrierStub, domStub } from "./barrier.ts";
import { certify, bodyOf, parseWithBoundary } from "./parser_certificate.ts";

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

// The DOM passes of the sandbox are the table ADJUST_VDITOR_DOM_PASSES of vditor_wysiwyg.ts (the one list that adjustVditorDOM runs too): the
// passes whose phase is "analyse" run in analyse, the passes whose phase is "build" run in build, each on the child (a "root" pass on the root).
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

// The function table of a sandbox renderer (milestone C, step C4). registerFormatRendererFuncs binds 141 methods of one instance on every
// construction, which is most of the renderer setup of a child. The table NodeType -> method name is derived ONCE from the registration
// itself: the registration runs against a spy whose RendererFuncs records its set calls and whose renderX members return a bind that
// records the name, so the mapping is the real one and never a copy. Each renderer instance then binds a method on its first use.
interface MethodTable {
  byType: Map<ast.NodeType, string>; // the table in registration order
  names: string[]; // the same, indexed by NodeType (the lookup of every dispatch)
}

let methodTable: MethodTable | null = null;

function methodTableOf(): MethodTable {
  if (methodTable !== null) {
    return methodTable;
  }
  const recorded = new Map<ast.NodeType, { method: string }>();
  const spy = new Proxy({} as Record<string, unknown>, {
    get(_t, prop): unknown {
      if (prop === "RendererFuncs") {
        return recorded;
      }
      const method = String(prop);
      return { bind: (): { method: string } => ({ method }) };
    },
  });
  registerFormatRendererFuncs(spy as unknown as FormatRenderer);
  const table = new Map<ast.NodeType, string>();
  for (const [type, m] of recorded) {
    if (typeof (FormatRenderer.prototype as unknown as Record<string, unknown>)[m.method] !== "function") {
      throw new Error("sandbox: the registration names a method that FormatRenderer does not have: " + m.method);
    }
    table.set(type, m.method);
  }
  const names: string[] = [];
  for (const [type, name] of table) {
    names[type] = name;
  }
  methodTable = { byType: table, names };
  return methodTable;
}

// LazyRendererFuncs is the RendererFuncs of one sandbox renderer. get binds the method of the table on first use and keeps the function, so
// the bound functions are the ones of the eager registration (one per type and instance). has, size and the iteration answer as the eager
// map does: the iteration first fills the map in table order. Writes throw: the registration never runs on a sandbox renderer.
class LazyRendererFuncs extends Map<ast.NodeType, RendererFunc> {
  owner: object;
  table: MethodTable;
  slots: RendererFunc[]; // the functions bound so far, by NodeType (an array: get runs on every dispatch of a node)
  filled: boolean;

  constructor(owner: object, table: MethodTable) {
    super();
    this.owner = owner;
    this.table = table;
    this.slots = [];
    this.filled = false;
  }

  get(type: ast.NodeType): RendererFunc | undefined {
    const cached = this.slots[type];
    if (cached !== undefined) {
      return cached;
    }
    const name = this.table.names[type];
    if (name === undefined) {
      return undefined;
    }
    const f = (this.owner as Record<string, (...args: unknown[]) => unknown>)[name].bind(this.owner) as RendererFunc;
    this.slots[type] = f;
    return f;
  }

  has(type: ast.NodeType): boolean {
    return this.table.names[type] !== undefined;
  }

  get size(): number {
    return this.table.byType.size;
  }

  fill(): void {
    if (!this.filled) {
      this.filled = true;
      for (const type of this.table.byType.keys()) {
        super.set(type, this.get(type)!);
      }
    }
  }

  forEach(callback: (value: RendererFunc, key: ast.NodeType, map: Map<ast.NodeType, RendererFunc>) => void, thisArg?: unknown): void {
    this.fill();
    super.forEach(callback, thisArg);
  }

  entries(): MapIterator<[ast.NodeType, RendererFunc]> {
    this.fill();
    return super.entries();
  }

  keys(): MapIterator<ast.NodeType> {
    this.fill();
    return super.keys();
  }

  values(): MapIterator<RendererFunc> {
    this.fill();
    return super.values();
  }

  [Symbol.iterator](): MapIterator<[ast.NodeType, RendererFunc]> {
    this.fill();
    return super.entries();
  }

  set(): this {
    throw new Error("sandbox renderer: the function table is not written");
  }

  delete(): boolean {
    throw new Error("sandbox renderer: the function table is not written");
  }

  clear(): void {
    throw new Error("sandbox renderer: the function table is not written");
  }
}

export function newSandboxRenderer(tree: parse.Tree, options: RenderOptions, parseOptions: parse.Options): SandboxRenderer {
  const ret = new SandboxRenderer(tree, options, parseOptions);
  ret.RendererFuncs = new LazyRendererFuncs(ret, methodTableOf());
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
  ids: string[]; // the node IDs that the phases of this child generated so far (section 3.6); read by render
}

export type Analysis = { kind: "refused"; refusal: Refusal } | { kind: "dead"; atom: number } | { kind: "alive"; handle: Handle };

export interface Built {
  info: ChildInfo; // context-free; topTypes come from the tree of the build
  tree: parse.Tree;
  tops: ast.Node[]; // the top-level AST nodes of the child
  tipOpen: boolean; // tree.Context.Tip is not the root after genAST
  ids: string[]; // the node IDs generated for this child by analyse, build and render (the list of its handle)
}


// callPass calls one DOM pass of the engine by name on the given node, with the engine's own method.
function callPass(lute: Lute, name: string, node: html.Node): void {
  const f = (lute as unknown as Record<string, (n: html.Node) => void>)[name];
  f.call(lute, node);
}

// GeneratedNodeIDError is thrown by render when a node ID generated for the child is observable in its log. classify maps it to the refusal generated-id.
export class GeneratedNodeIDError extends Error {
  constructor() {
    super("a phase of the child created a node ID");
    this.name = "GeneratedNodeIDError";
  }
}

// collectingIDs runs one phase of a child (analyse, build or render) with ids as the collector of the node IDs (ast.InstallNodeIDCollector):
// every ID that the phase generates is appended to ids, and the previous collector is restored when the phase ends, also when it throws.
export function collectingIDs<T>(ids: string[], f: () => T): T {
  const previous = ast.InstallNodeIDCollector(ids);
  try {
    return f();
  } finally {
    ast.RemoveNodeIDCollector(previous);
  }
}

// generatedIDLeaks reports whether one of the generated IDs is observable in the log: its full ID or its first 14 characters (the time
// stamp; the engine writes id.slice(0, 14) into attributes such as updated) occurs in the concatenation of the bytes of the Append operations.
// A node ID is a time stamp plus a random suffix, so a match means that the output depends on the ID, or (improbably) that the document already
// contained the same characters, which costs only a fallback. An ID that the output never shows is not a dependence on its value: the engine
// compares IDs only for equality (vditor_wysiwyg.ts, adjustVditorDOMListItemInP, where a fresh ID equals no other ID), and no ID is used as a
// sort key or a map key on the DOM2Md paths (the consumers are listed in src/incremental/README.md). The concatenation also finds a match
// that spans two operations.
export function generatedIDLeaks(ids: string[], ops: RootOp[]): boolean {
  if (ids.length === 0) {
    return false;
  }
  let total = 0;
  for (const op of ops) {
    if (op.kind === "Append") {
      total += op.bytes.length;
    }
  }
  const log = new Uint8Array(total);
  let at = 0;
  for (const op of ops) {
    if (op.kind === "Append") {
      log.set(op.bytes, at);
      at += op.bytes.length;
    }
  }
  const encoder = new TextEncoder();
  for (const id of ids) {
    if (containsBytes(log, encoder.encode(id)) || containsBytes(log, encoder.encode(id.slice(0, 14)))) {
      return true;
    }
  }
  return false;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) {
    return true;
  }
  const last = haystack.length - needle.length;
  for (let i = 0; i <= last; i++) {
    if (haystack[i] !== needle[0]) {
      continue;
    }
    let k = 1;
    while (k < needle.length && haystack[i + k] === needle[k]) {
      k++;
    }
    if (k === needle.length) {
      return true;
    }
  }
  return false;
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
  if (e instanceof GeneratedNodeIDError) {
    return { kind: "unsupported", reason: "generated-id" };
  }
  if (e instanceof BarrierViolation) {
    return { kind: "inconsistency", reason: "barrier:" + e.site };
  }
  if (e instanceof IncrementalInconsistency) {
    return { kind: "inconsistency", reason: e.reason };
  }
  return { kind: "unsupported", reason: "engine-threw" };
}

// analyse is the first phase: the DOM of the child (parsed with the certificate when doCertify), passes 1 to 3. It returns the handle,
// or a refusal (certificate), or "dead" (removeEmptyNodes removed the child). It does not link any neighbour. The node IDs that the phase
// generates are collected into the handle (ids).
export function analyse(lute: Lute, htmlStr: string, doCertify: boolean, opaque: boolean): Analysis {
  const ids: string[] = [];
  return collectingIDs(ids, () => analyseIn(lute, htmlStr, doCertify, opaque, ids));
}

function analyseIn(lute: Lute, htmlStr: string, doCertify: boolean, opaque: boolean, ids: string[]): Analysis {
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
  const passes = ADJUST_VDITOR_DOM_PASSES.filter((p) => p.phase === "analyse");
  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i];
    if (pass.scope === "root") {
      callPass(lute, pass.name, root);
    } else if (root.FirstChild !== null) {
      callPass(lute, pass.name, root.FirstChild);
    }
    // the first analyse pass (removeEmptyNodes) leaves no top-level node when the child is empty: the child is dead
    if (i === 0 && root.FirstChild === null) {
      return { kind: "dead", atom: atomBefore };
    }
  }
  return { kind: "alive", handle: { root, child, atomMerge: child.DataAtom, attrsMerge: child.Attr.length, ids } };
}

// build is the second phase: the DOM neighbours are linked (plain assignments, milestone C C1), passes 4 to 15 run with the links in
// place, then genAST of the child, the tip check and adjustTree. The node IDs it generates go to the handle (h.ids).
export function build(lute: Lute, adapter: ModeAdapter, h: Handle, dom: DomCtx): Built {
  return collectingIDs(h.ids, () => buildIn(lute, adapter, h, dom));
}

function buildIn(lute: Lute, adapter: ModeAdapter, h: Handle, dom: DomCtx): Built {
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
  for (const pass of ADJUST_VDITOR_DOM_PASSES) {
    if (pass.phase === "build") {
      callPass(lute, pass.name, child);
    }
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
  return { info, tree, tops, tipOpen, ids: h.ids };
}

// render is the third phase: the AST neighbours are linked from prev and next (isFirst and isLast are prev < 0 and next < 0, invariant I1),
// the recording renderer runs with LastOut = ctx.lastOut, and the root-writer log is coalesced. The node IDs of the child (analyse, build and
// this render) are checked against the log: one that is observable in it refuses the child as generated-id (section 3.6).
export function render(lute: Lute, adapter: ModeAdapter, b: Built, ctx: Context, options: RenderOptions = adapter.renderOptions()): Variant {
  const variant = collectingIDs(b.ids, () => renderIn(lute, adapter, b, ctx, options));
  if (generatedIDLeaks(b.ids, variant.ops)) {
    throw new GeneratedNodeIDError();
  }
  return variant;
}

function renderIn(lute: Lute, adapter: ModeAdapter, b: Built, ctx: Context, options: RenderOptions): Variant {
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
  const r = newSandboxRenderer(tree, options, lute.ParseOptions);
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
  let size = 96;
  for (const op of merged) {
    size += op.kind === "Append" ? op.bytes.length + 64 : 64;
  }
  return { key: contextKey(ctx), ops: merged, endLastOut, bytes: size };
}

// runChild runs one child alone (section 3): analyse, build and render for one context. It never throws: a barrier violation or an
// internal inconsistency is returned as an inconsistency refusal, a node ID that the output shows as generated-id, any other exception as
// engine-threw. Each phase collects the node IDs it generates (section 3.6).
export function runChild(lute: Lute, adapter: ModeAdapter, htmlStr: string, ctx: Context, opts: RunOptions): RunResult {
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
    const variant = render(lute, adapter, b, ctx);
    return { info: b.info, variant, refusal: null };
  } catch (e) {
    return { info: null, variant: null, refusal: classify(e) };
  }
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
