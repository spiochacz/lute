// Scratch prototype of candidate (b): the per-child path without its fixed costs. NOT part of the engine.
//   1. no accessors: the neighbours are linked physically (plain field assignment of a stub), so no node is reconfigured into dictionary mode;
//   2. no read recording: the variant key is the whole context tuple (always-key), so a variant is correct by construction for equal tuples;
//   3. two phases: analyse (parse + certificate + passes 1-3) for all new children, then build (passes 4-15 + genAST + adjustTree) with the
//      real DOM context, then ONE render with the real AST context: no rerun with a second context.
// Everything the sandbox of src/incremental/sandbox.ts guarantees (fresh DOM, tree, renderer per child; stubs that throw beyond the declared
// fields) is kept. The fallback decisions (scan, certificate, list coupling, tip-open, generated-id) are the same.

import * as ast from "../../../src/ast/index.ts";
import * as atom from "../../../src/html/atom/index.ts";
import * as conv from "../../../src/runtime/conv.ts";
import * as bytes from "../../../src/runtime/bytes.ts";
import * as lex from "../../../src/lex/index.ts";
import * as html from "../../../src/html/index.ts";
import * as parse from "../../../src/parse/index.ts";
import * as util from "../../../src/util/index.ts";
import { FormatRenderer } from "../../../src/render/types.ts";
import { closeDocumentWriter } from "../../../src/render/format_renderer.ts";
import type { RootOp } from "../../../src/render/recording_format_renderer.ts";
import type { Lute } from "../../../src/types.ts";
import { scanTopLevel } from "../../../src/incremental/scanner.ts";
import { certify, bodyOf, parseWithBoundary } from "../../../src/incremental/parser_certificate.ts";
import { astStub, barrierStub, domStub } from "../../../src/incremental/barrier.ts";
import { BarrierViolation, IncrementalInconsistency } from "../../../src/incremental/piece.ts";
import { ADJUST_PASSES, GENERATED_ID, coalesce, listCoupling, newSandboxRenderer } from "../../../src/incremental/sandbox.ts";
import type { ModeAdapter } from "../../../src/incremental/sandbox.ts";
import type { ChildInfo } from "../../../src/incremental/piece.ts";

export interface Key { lastOut: number; prev: number; next: number; domPrev: number; domNext: number; domNextAttrs: number }
export const keyStr = (k: Key): string => `${k.lastOut},${k.prev},${k.next},${k.domPrev},${k.domNext},${k.domNextAttrs}`;

export interface Var { ops: RootOp[]; endLastOut: number; bytes: number }
export interface Ent {
  html: string; opaque: boolean;
  info: ChildInfo | null; refusal: string | null;
  vars: Map<string, Var>;
}
export const T: Record<string, number> = {};
let _t = 0;
const lap0 = (): void => { _t = performance.now(); };
const lap = (k: string): void => { const n = performance.now(); T[k] = (T[k] ?? 0) + (n - _t); _t = n; };

// Handle of a child between the phases of one call. Not kept between calls.
interface Handle { root: html.Node; child: html.Node; atomMerge: number; attrsMerge: number; tree: parse.Tree | null; tops: ast.Node[]; info: ChildInfo | null }

function callPass(lute: Lute, name: string, node: html.Node): void {
  (lute as unknown as Record<string, (n: html.Node) => void>)[name].call(lute, node);
}

// Phase A: parse (with the certificate on the first run), passes 1-3. Returns the handle, or a refusal reason, or "dead".
function analyse(lute: Lute, htmlStr: string, doCertify: boolean, opaque: boolean): Handle | string | "dead" {
  lap0();
  let body: html.Node | null;
  if (doCertify) {
    const p = parseWithBoundary(htmlStr);
    lap("A.parse(cert)");
    if (certify(htmlStr, p.doc, p.boundary) !== null) return opaque ? "cert:opaque-preview" : "inconsistency:cert";
    body = bodyOf(p.doc);
  } else {
    body = util.ParseHTML(htmlStr);
    lap("A.parse(plain)");
  }
  if (body === null || body.FirstChild === null) throw new Error("no node");
  const root = body;
  const child = body.FirstChild;
  callPass(lute, "removeEmptyNodes", root);
  if (root.FirstChild === null) return "dead";
  callPass(lute, "removeHighlightJSSpans", root);
  if (root.FirstChild !== null) callPass(lute, "removeWbr", root.FirstChild);
  const h: Handle = { root, child, atomMerge: child.DataAtom, attrsMerge: child.Attr.length, tree: null, tops: [], info: null };
  lap("A.passes1-3");
  return h;
}

export interface DomCtx { domPrev: number; domNext: number; domNextAttrs: number }

// Phase B: passes 4-15 and genAST with the DOM neighbours linked physically. Returns "tip-open" or null.
function build(lute: Lute, adapter: ModeAdapter, h: Handle, d: DomCtx): string | null {
  lap0();
  const { root, child } = h;
  const prevStub = d.domPrev < 0 ? null : domStub(d.domPrev, 0);
  const nextStub = d.domNext < 0 ? null : domStub(d.domNext, d.domNextAttrs);
  child.PrevSibling = prevStub;
  child.NextSibling = nextStub;
  if (prevStub !== null) root.FirstChild = barrierStub("dom.root.FirstChild") as html.Node;
  if (nextStub !== null) root.LastChild = barrierStub("dom.root.LastChild") as html.Node;
  const firstSet = root.FirstChild;
  const lastSet = root.LastChild;
  for (const pass of ADJUST_PASSES.slice(3)) callPass(lute, pass.name, child);
  if (root.FirstChild !== firstSet || root.LastChild !== lastSet || child.PrevSibling !== prevStub || child.NextSibling !== nextStub) {
    throw new IncrementalInconsistency("sibling-structure-changed", "a DOM pass changed the top-level links");
  }
  if (child.DataAtom !== h.atomMerge) throw new IncrementalInconsistency("top-level-atom-changed", "");
  lap("B.passes4-15");
  const tree = new parse.Tree();
  tree.Name = "";
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.Context = new parse.Context(lute.ParseOptions);
  tree.Context.Tip = tree.Root;
  adapter.genAST(lute, child, tree);
  const tipOpen = tree.Context!.Tip !== tree.Root;
  lap("B.genAST");
  adapter.adjustTree(tree);
  const tops: ast.Node[] = [];
  for (let c = tree.Root!.FirstChild; c !== null; c = c.Next) tops.push(c);
  h.tree = tree;
  h.tops = tops;
  h.info = { alive: true, atom: h.atomMerge, attrs: h.attrsMerge, topTypes: tops.map((n) => n.Type) };
  lap("B.adjustTree");
  return tipOpen ? "tip-open" : null;
}

// Phase C: link the AST neighbours physically and render once, recording the root-writer log.
function render(lute: Lute, adapter: ModeAdapter, opts: ReturnType<ModeAdapter["renderOptions"]>, h: Handle, k: Key): Var | string {
  lap0();
  const tree = h.tree!;
  const tops = h.tops;
  if (tops.length > 0) {
    const first = tops[0];
    const last = tops[tops.length - 1];
    first.Previous = k.prev < 0 ? null : astStub(k.prev);
    last.Next = k.next < 0 ? null : astStub(k.next);
    // k.isFirst == (prev < 0), k.isLast == (next < 0): the same facts, so the key does not repeat them
    if (k.prev >= 0) tree.Root!.FirstChild = barrierStub("ast.root.FirstChild") as ast.Node;
    if (k.next >= 0) tree.Root!.LastChild = barrierStub("ast.root.LastChild") as ast.Node;
  }
  let r: ReturnType<typeof newSandboxRenderer>;
  if ((globalThis as any).__reuseR) { r = ((globalThis as any).__r ??= newSandboxRenderer(tree, opts, lute.ParseOptions)); r.Tree = tree; r.NodeWriterStack = []; r.sink = null; r.muted = 0; r.rendererWrites = 0; } else r = newSandboxRenderer(tree, opts, lute.ParseOptions);
  r.LastOut = k.lastOut;
  lap("C.setup");
  const ops: RootOp[] = [];
  r.renderDocument(tree.Root!, true);
  r.sink = ops;
  for (const t of tops) ast.Walk(t, (n: ast.Node, entering: boolean): ast.WalkStatus => r.dispatch(n, entering));
  r.sink = null;
  lap("C.render");
  const merged = coalesce(ops);
  let size = 96;
  for (const op of merged) {
    if (op.kind === "Append") {
      size += op.bytes.length + 64;
      if (op.bytes.length >= GENERATED_ID.length && conv.StringFromBytes(op.bytes).includes(GENERATED_ID)) return "generated-id";
    } else size += 64;
  }
  lap("C.post");
  return { ops: merged, endLastOut: r.LastOut, bytes: size };
}

export class Cache {
  map = new Map<string, Ent>();
  stats = { runsA: 0, runsFull: 0, hits: 0, misses: 0, fallbacks: 0 as number, reason: "", memoHits: 0 };
  memo: Ent | null = null; // negative memo: the entry whose refusal ended the last call
  useMemo = true;
}

function fullRun(lute: Lute, adapter: ModeAdapter, opts: any, e: Ent, k: Key, d: DomCtx): Var | string {
  const a = analyse(lute, e.html, false, e.opaque);
  if (typeof a === "string") throw new Error("rerun refused: " + a);
  const tip = build(lute, adapter, a, d);
  if (tip !== null) return tip;
  return render(lute, adapter, opts, a, k);
}

// compose: the whole call. Returns the Markdown or null (fallback, reason in cache.stats.reason).
export function compose(lute: Lute, adapter: ModeAdapter, c: Cache, h: string): string | null {
  const was = ast.GetTesting();
  ast.SetTesting(true);
  try {
    return composeInner(lute, adapter, c, h);
  } catch (e) {
    if (e instanceof BarrierViolation || e instanceof IncrementalInconsistency) { c.stats.reason = "inconsistency:" + (e as Error).message; c.stats.fallbacks++; return null; }
    if (process.env.DBG && (globalThis as any).__n === undefined) { (globalThis as any).__n = 1; console.log("THREW", e); }
    c.stats.reason = "engine-threw"; c.stats.fallbacks++; return null;
  } finally {
    ast.SetTesting(was);
  }
}

function composeInner(lute: Lute, adapter: ModeAdapter, c: Cache, hh: string): string | null {
  if (c.useMemo && c.memo !== null && hh.includes(c.memo.html)) { c.stats.memoHits++; c.stats.reason = c.memo.refusal!; c.stats.fallbacks++; return null; }
  const t0 = performance.now();
  const sc = scanTopLevel(hh);
  if (!sc.ok) { c.stats.reason = "scan:" + sc.code; c.stats.fallbacks++; return null; }
  const tS = performance.now(); T["scan"] = (T["scan"] ?? 0) + tS - t0;
  const ents: Ent[] = [];
  for (const ch of sc.children) {
    const s = hh.substring(ch.start, ch.end);
    let e = c.map.get(s);
    if (e === undefined) { e = { html: Buffer.from(s, "utf16le").toString("utf16le"), opaque: ch.opaque, info: null, refusal: null, vars: new Map() }; c.map.set(e.html, e); }
    ents.push(e);
  }
  const tL = performance.now(); T["lookup"] = (T["lookup"] ?? 0) + tL - tS;
  // negative memo of this prototype: an entry with a refusal ends the call before any work
  for (const e of ents) if (e.refusal !== null) { c.memo = e; c.stats.reason = e.refusal; c.stats.fallbacks++; return null; }
  const n = ents.length;
  // Phase A for the entries without info
  const hs: Array<Handle | null> = new Array(n).fill(null);
  const infoLite: Array<{ alive: boolean; atom: number; attrs: number }> = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = ents[i];
    if (e.info !== null) { infoLite[i] = e.info; continue; }
    const a = analyse(lute, e.html, true, e.opaque);
    c.stats.runsA++;
    if (a === "dead") { e.info = { alive: false, atom: 0, attrs: 0, topTypes: [] }; infoLite[i] = e.info; continue; }
    if (typeof a === "string") { e.refusal = a; c.memo = e; c.stats.reason = a; c.stats.fallbacks++; return null; }
    hs[i] = a;
    infoLite[i] = { alive: true, atom: a.atomMerge, attrs: a.attrsMerge };
  }
  // list coupling needs only (alive, atom, attrs): decided BEFORE any genAST or render
  if (listCoupling(lute, infoLite.map((x) => ({ alive: x.alive, atom: x.atom, attrs: x.attrs, topTypes: [] })))) { c.stats.reason = "list-coupling"; c.stats.fallbacks++; return null; }
  // DOM context sweeps
  const domP = new Array<number>(n).fill(-1), domN = new Array<number>(n).fill(-1), domNA = new Array<number>(n).fill(0);
  let la = -1;
  for (let i = 0; i < n; i++) { domP[i] = la < 0 ? -1 : infoLite[la].atom; if (infoLite[i].alive) la = i; }
  let na = -1;
  for (let i = n - 1; i >= 0; i--) { domN[i] = na < 0 ? -1 : infoLite[na].atom; domNA[i] = na < 0 ? 0 : infoLite[na].attrs; if (infoLite[i].alive) na = i; }
  const opts = adapter.renderOptions();
  // Phase B for the new children
  for (let i = 0; i < n; i++) {
    const h = hs[i];
    if (h === null) continue;
    const tip = build(lute, adapter, h, { domPrev: domP[i], domNext: domN[i], domNextAttrs: domNA[i] });
    if (tip !== null) { ents[i].refusal = tip; c.memo = ents[i]; ents[i].info = h.info; c.stats.reason = tip; c.stats.fallbacks++; return null; }
    ents[i].info = h.info;
  }
  // AST context sweeps
  const infos = ents.map((e) => e.info!);
  const emitting = (i: number): boolean => infos[i].alive && infos[i].topTypes.length > 0;
  const prevT = new Array<number>(n).fill(-1), nextT = new Array<number>(n).fill(-1);
  let le = -1;
  for (let i = 0; i < n; i++) { prevT[i] = le < 0 ? -1 : infos[le].topTypes[infos[le].topTypes.length - 1]; if (emitting(i)) le = i; }
  let ne = -1;
  for (let i = n - 1; i >= 0; i--) { nextT[i] = ne < 0 ? -1 : infos[ne].topTypes[0]; if (emitting(i)) ne = i; }
  const tB = performance.now(); T["sweeps+coupling"] = (T["sweeps+coupling"] ?? 0) + 0;
  void tB;
  // Replay with Phase C
  const R = new FormatRenderer(new parse.Tree(), adapter.renderOptions(), lute.ParseOptions);
  R.LastOut = lex.ItemNewline;
  R.Writer = new bytes.Buffer();
  for (let i = 0; i < n; i++) {
    if (!infos[i].alive) continue;
    const k: Key = { lastOut: R.LastOut, prev: prevT[i], next: nextT[i], domPrev: domP[i], domNext: domN[i], domNextAttrs: domNA[i] };
    const ks = keyStr(k);
    const e = ents[i];
    let v = e.vars.get(ks);
    if (v !== undefined) c.stats.hits++;
    else {
      c.stats.misses++;
      const res = hs[i] !== null && hs[i]!.tree !== null ? render(lute, adapter, opts, hs[i]!, k) : (c.stats.runsFull++, fullRun(lute, adapter, opts, e, k, { domPrev: domP[i], domNext: domN[i], domNextAttrs: domNA[i] }));
      if (typeof res === "string") { e.refusal = res; c.memo = e; c.stats.reason = res; c.stats.fallbacks++; return null; }
      v = res;
      if (e.vars.size >= 8) e.vars.delete(e.vars.keys().next().value!);
      e.vars.set(ks, v);
    }
    hs[i] = null; // the handle is spent (its tree was rendered once)
    lap0();
    for (const op of v.ops) {
      switch (op.kind) {
        case "Append": if (op.setsLastOut) R.Write(op.bytes); else R.Writer.Write(op.bytes); break;
        case "NewlineIfNotLF": R.Newline(); break;
        case "TrimSpaceAll": R.trimWriterTo(bytes.TrimSpace(R.Writer.Bytes())); break;
      }
    }
    R.LastOut = v.endLastOut;
    lap("replay");
  }
  closeDocumentWriter(R);
  return conv.StringFromBytes(R.Writer.Bytes());
}

void atom;
