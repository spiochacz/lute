// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// tryDom2Md is one call of the cache (section 5.1). It returns the output of the composed document, or null when the normal path must run
// (a counted fallback). In strict mode an inconsistency throws IncrementalInconsistency, after it is counted.
//
// Milestone C, step C2: the order of one call is fingerprint, preprocess, scan, lookup, a pre-pass over the stored refusals, analyse (opaque
// children first), list coupling, DOM sweeps, build (in document order, stopping at tip-open), AST sweeps, replay. A child is analysed once and
// built once per call; the replay renders it from its handle when the DOM context of the build is the one of the position, otherwise it runs
// in full with the exact context.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as lex from "../lex/index.ts";
import * as parse from "../parse/index.ts";
import { FormatRenderer } from "../render/types.ts";
import { closeDocumentWriter } from "../render/format_renderer.ts";
import type { Lute } from "../types.ts";
import { fingerprint } from "./options_fingerprint.ts";
import { scanTopLevel } from "./scanner.ts";
import { sandwichCheck } from "./parser_certificate.ts";
import { analyse, build, classify, listCoupling, render, runChild } from "./sandbox.ts";
import type { Built, DomCtx, Handle, ModeAdapter } from "./sandbox.ts";
import { addVariant, clearMemoSlots, evict, MEMO_REPROBE, newEntry, removeEntry, State } from "./cache.ts";
import type { MemoSlot } from "./cache.ts";
import type { Entry, ChildInfo, Context, Refusal, Variant } from "./piece.ts";
import { IncrementalInconsistency, contextKey } from "./piece.ts";

// The result of a variant miss at the replay: a refusal, or a run with its info and its variant.
type Got = { kind: "refused"; refusal: Refusal } | { kind: "ran"; info: ChildInfo; variant: Variant };

function sameInfo(a: ChildInfo, b: ChildInfo): boolean {
  return a.alive === b.alive && a.atom === b.atom && a.attrs === b.attrs && a.topTypes.length === b.topTypes.length && a.topTypes.every((t, i) => t === b.topTypes[i]);
}

// Outcome of one call: the composed output, or the reason of the fallback with its kind.
type Outcome = { out: string } | { reason: string; kind: "unsupported" | "inconsistency" };

// A phase result: its value, or the refusal of its exception (the classification of sandbox.ts, section 6).
type Phase<T> = { ok: true; value: T } | { ok: false; refusal: Refusal };

function phase<T>(f: () => T): Phase<T> {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    return { ok: false, refusal: classify(e) };
  }
}

// The handling of an inconsistency (section 6): counted in both modes; strict mode throws, normal mode returns it as a fallback.
function inconsistency(st: State, reason: string, detail: string): Outcome {
  if (st.options.strict) {
    st.stats.inconsistencies[reason] = (st.stats.inconsistencies[reason] ?? 0) + 1;
    st.stats.fallbacks++;
    throw new IncrementalInconsistency(reason, detail);
  }
  return { reason, kind: "inconsistency" };
}

// refusalOutcome: an unsupported refusal of a child is kept in its entry (the same child is not run again); an inconsistency is never
// cached: normal mode deletes the entry and falls back.
function refusalOutcome(st: State, map: Map<string, Entry>, e: Entry, refusal: Refusal, detail: string): Outcome {
  if (refusal.kind === "unsupported") {
    e.refusal = refusal;
    if (MEMO_REASONS.has(refusal.reason)) {
      setMemo(slotOf(st, map), e);
    }
    return { reason: refusal.reason, kind: "unsupported" };
  }
  removeEntry(st, map, e);
  return inconsistency(st, refusal.reason, detail);
}

// The negative memo (milestone C, C3, tasks/004 section 6.4): the refusals that are a function of the child string and the options only. A
// list-coupling, a scan refusal, too-large and an inconsistency are not of this kind and are never memoised.
const MEMO_REASONS = new Set<string>(["cert:opaque-preview", "tip-open", "generated-id", "engine-threw"]);

function slotOf(st: State, map: Map<string, Entry>): MemoSlot {
  return map === st.maps.wysiwyg ? st.memo.wysiwyg : st.memo.ir;
}

function setMemo(slot: MemoSlot, e: Entry): void {
  slot.entry = e;
  slot.hits = 0;
}

function clearMemo(st: State): void {
  clearMemoSlots(st);
}

// A child built in this call, kept until its render: the handle holds DOM nodes and is used once (invariant I3: never stored in State).
interface Built1 {
  built: Built;
  handle: Handle;
  dom: DomCtx; // the DOM context of the build (the first position of the child)
}

function sameDom(d: DomCtx, c: Context): boolean {
  return d.domPrev === c.domPrev && d.domNext === c.domNext && d.domNextAttrs === c.domNextAttrs;
}

export function tryDom2Md(st: State, lute: Lute, adapter: ModeAdapter, htmlIn: string): string | null {
  const stats = st.stats;
  stats.calls++;
  const finish = (o: Outcome): string | null => {
    if ("out" in o) {
      stats.composed++;
      return o.out;
    }
    stats.fallbacks++;
    if (o.kind === "unsupported") {
      stats.unsupported[o.reason] = (stats.unsupported[o.reason] ?? 0) + 1;
    } else {
      stats.inconsistencies[o.reason] = (stats.inconsistencies[o.reason] ?? 0) + 1;
    }
    return null;
  };

  // 2-3: the options (section 5.5)
  const fp = fingerprint(lute);
  if (fp === null) {
    return finish({ reason: "options-not-fingerprintable", kind: "unsupported" });
  }
  if (fp !== st.fp) {
    if (st.fp !== "") {
      stats.optionClears++;
    }
    st.maps.wysiwyg.clear();
    st.maps.ir.clear();
    st.bytes = 0;
    st.fp = fp;
    clearMemo(st);
  }
  const map = adapter.mode === "wysiwyg" ? st.maps.wysiwyg : st.maps.ir;
  const slot = slotOf(st, map);

  // 4: the string; then the negative memo (C3): the offending child of the last refusal of this mode is still in the string, so the same
  // fallback is the answer. Every MEMO_REPROBE-th hit runs the full path instead: it refreshes or clears the memo (a fallback is always
  // correct, so the memo can only turn a composition into a fallback, and the re-probe bounds how long a stale memo can do so).
  const h = adapter.preprocess(htmlIn);
  const memoE = slot.entry;
  if (memoE !== null && memoE.refusal !== null && h.includes(memoE.html)) {
    slot.hits++;
    if (slot.hits % MEMO_REPROBE !== 0) {
      stats.memoHits++;
      return finish({ reason: memoE.refusal.reason, kind: "unsupported" });
    }
  }

  // 5: the scan
  const sc = scanTopLevel(h);
  if (!sc.ok) {
    return finish({ reason: sc.code === "no-children" ? "empty-document" : "scan:" + sc.code, kind: "unsupported" });
  }

  // 6-8: the lookup (the keys are the child strings)
  const call = ++st.callNo;
  stats.children += sc.children.length;
  const entries: Entry[] = [];
  for (const c of sc.children) {
    const s = h.substring(c.start, c.end);
    let e = map.get(s);
    if (e === undefined) {
      e = newEntry(s, c.opaque);
      map.set(e.html, e);
      st.bytes += e.bytes;
    }
    e.lastCall = call;
    entries.push(e);
  }
  if (st.bytes > st.options.maxBytes) {
    evict(st, call);
    return finish({ reason: "too-large", kind: "unsupported" });
  }

  // 9: the first stored refusal in document order names the reason; nothing is run (C2: early exit before any work)
  for (const e of entries) {
    if (e.refusal !== null) {
      if (MEMO_REASONS.has(e.refusal.reason)) {
        setMemo(slot, e);
      }
      evict(st, call);
      return finish({ reason: e.refusal.reason, kind: "unsupported" });
    }
  }

  // 10: analyse the new children (no info, no refusal): the opaque ones first, then the others, each in document order; the first refusal
  // ends the call. A dead child gets its info here (alive false, nothing else runs for it).
  const fresh: Entry[] = [];
  const seen = new Set<Entry>();
  for (const e of entries) {
    if (e.info === null && !seen.has(e)) {
      seen.add(e);
      fresh.push(e);
    }
  }
  const order = [...fresh.filter((e) => e.opaque), ...fresh.filter((e) => !e.opaque)];
  const handles = new Map<Entry, Handle>();
  for (const e of order) {
    stats.analyses++;
    stats.sandboxRuns++;
    const r = phase(() => analyse(lute, e.html, true, e.opaque));
    if (!r.ok) {
      const o = refusalOutcome(st, map, e, r.refusal, e.html);
      evict(st, call);
      return finish(o);
    }
    const a = r.value;
    if (a.kind === "refused") {
      const o = refusalOutcome(st, map, e, a.refusal, e.html);
      evict(st, call);
      return finish(o);
    }
    if (a.kind === "dead") {
      e.info = { alive: false, atom: a.atom, attrs: 0, topTypes: [] };
      continue;
    }
    // strict mode: the sandwich check (section 4.3) for each newly certified child
    if (st.options.strict) {
      const sw = sandwichCheck(e.html);
      if (sw !== null) {
        const o = inconsistency(st, "strict:sandwich", `${sw}: ${e.html}`);
        removeEntry(st, map, e);
        evict(st, call);
        return finish(o);
      }
    }
    handles.set(e, a.handle);
  }

  // 11: list coupling (section 3.5) on (alive, atom, attrs) of all children: before any genAST
  const lite: ChildInfo[] = entries.map((e) => {
    if (e.info !== null) {
      return e.info;
    }
    const hd = handles.get(e);
    if (hd === undefined) {
      throw new Error("incremental: a child without info, without refusal and without handle (internal)");
    }
    return { alive: true, atom: hd.atomMerge, attrs: hd.attrsMerge, topTypes: [] };
  });
  if (listCoupling(lute, lite)) {
    evict(st, call);
    return finish({ reason: "list-coupling", kind: "unsupported" });
  }

  // 12: the DOM sweeps (5.1): the nearest ALIVE siblings before and after each child (the DOM context of its build and of its key)
  const n = entries.length;
  const domP: number[] = new Array(n).fill(-1);
  const domN: number[] = new Array(n).fill(-1);
  const domNA: number[] = new Array(n).fill(0);
  let lastAlive = -1;
  for (let i = 0; i < n; i++) {
    domP[i] = lastAlive < 0 ? -1 : lite[lastAlive].atom;
    if (lite[i].alive) {
      lastAlive = i;
    }
  }
  let nextAlive = -1;
  for (let i = n - 1; i >= 0; i--) {
    domN[i] = nextAlive < 0 ? -1 : lite[nextAlive].atom;
    domNA[i] = nextAlive < 0 ? 0 : lite[nextAlive].attrs;
    if (lite[i].alive) {
      nextAlive = i;
    }
  }
  // 13: build the fresh alive children in document order, with the DOM context of their first position; the first tip-open ends the call
  const built = new Map<Entry, Built1>();
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    const hd = handles.get(e);
    if (hd === undefined) {
      continue;
    }
    handles.delete(e);
    const dom: DomCtx = { domPrev: domP[i], domNext: domN[i], domNextAttrs: domNA[i] };
    stats.builds++;
    const r = phase(() => build(lute, adapter, hd, dom));
    if (!r.ok) {
      const o = refusalOutcome(st, map, e, r.refusal, e.html);
      evict(st, call);
      return finish(o);
    }
    if (r.value.tipOpen) {
      const o = refusalOutcome(st, map, e, { kind: "unsupported", reason: "tip-open" }, e.html);
      evict(st, call);
      return finish(o);
    }
    e.info = r.value.info; // stored only after the build, complete (never a partial info)
    built.set(e, { built: r.value, handle: hd, dom });
  }

  // 14: the AST sweeps (5.1 line 12): the neighbours that emit, by node type
  const infos = entries.map((e) => e.info!);
  const emittingT = (i: number): boolean => infos[i].alive && infos[i].topTypes.length > 0;
  const prevT: number[] = new Array(n).fill(-1);
  const nextT: number[] = new Array(n).fill(-1);
  let lastEmit = -1;
  for (let i = 0; i < n; i++) {
    prevT[i] = lastEmit < 0 ? -1 : infos[lastEmit].topTypes[infos[lastEmit].topTypes.length - 1];
    if (emittingT(i)) {
      lastEmit = i;
    }
  }
  let nextEmit = -1;
  for (let i = n - 1; i >= 0; i--) {
    nextT[i] = nextEmit < 0 ? -1 : infos[nextEmit].topTypes[0];
    if (emittingT(i)) {
      nextEmit = i;
    }
  }

  // 15: the replay on a FormatRenderer, child by child: a variant with the same key, or a render from the build, or a full run
  // One options object for all the renderers of this call. It is frozen, so that a renderer that wrote to it (none does today) would throw
  // instead of leaking state from one child into the next.
  const renderOptions = Object.freeze(adapter.renderOptions());
  const R = new FormatRenderer(new parse.Tree(), renderOptions, lute.ParseOptions);
  R.LastOut = lex.ItemNewline;
  R.Writer = new bytes.Buffer();
  for (let i = 0; i < n; i++) {
    if (!infos[i].alive) {
      continue;
    }
    const ctx: Context = {
      lastOut: R.LastOut,
      prev: prevT[i],
      next: nextT[i],
      domPrev: domP[i],
      domNext: domN[i],
      domNextAttrs: domNA[i],
    };
    const e = entries[i];
    const key = contextKey(ctx);
    let v = e.variants.find((x) => x.key === key);
    if (v !== undefined) {
      stats.hits++;
    } else {
      stats.misses++;
      let got: Got;
      const b = built.get(e);
      if (b !== undefined && sameDom(b.dom, ctx)) {
        // the render of the build of this call (the handle is used once)
        built.delete(e);
        stats.renders++;
        const rr = phase(() => render(lute, adapter, b.built, ctx, renderOptions));
        got = rr.ok ? { kind: "ran", info: b.built.info, variant: rr.value } : { kind: "refused", refusal: rr.refusal };
      } else {
        // a child built at another position of this call, or a stored child: run in full with the exact context (section 5.1, line 14)
        stats.sandboxRuns++;
        const full = runChild(lute, adapter, e.html, ctx, { certify: false, opaque: e.opaque });
        got = full.refusal !== null ? { kind: "refused", refusal: full.refusal } : { kind: "ran", info: full.info!, variant: full.variant! };
      }
      if (got.kind === "refused") {
        const o = refusalOutcome(st, map, e, got.refusal, e.html);
        evict(st, call);
        return finish(o);
      }
      if (!sameInfo(got.info, e.info!)) {
        const o = inconsistency(st, "info-changed", e.html);
        removeEntry(st, map, e);
        evict(st, call);
        return finish(o);
      }
      v = got.variant;
      addVariant(st, e, v);
    }
    for (const op of v.ops) {
      switch (op.kind) {
        case "Append":
          if (op.setsLastOut) {
            R.Write(op.bytes);
          } else {
            R.Writer.Write(op.bytes);
          }
          break;
        case "NewlineIfNotLF":
          R.Newline();
          break;
        case "TrimSpaceAll":
          R.trimWriterTo(bytes.TrimSpace(R.Writer.Bytes()));
          break;
      }
    }
    if (st.options.strict && R.LastOut !== v.endLastOut) {
      const o = inconsistency(st, "replay:lastout-diverged", `replay LastOut ${R.LastOut}, endLastOut ${v.endLastOut}`);
      evict(st, call);
      return finish(o);
    }
    R.LastOut = v.endLastOut;
  }

  // 16-18: the document close, the output, the eviction, verify (section 5.1)
  closeDocumentWriter(R);
  const out = conv.StringFromBytes(R.Writer.Bytes());
  evict(st, call);

  if (st.options.verify) {
    const ref = adapter.mode === "wysiwyg" ? lute.vditorDOM2Md(htmlIn) : lute.vditorIRDOM2Md(htmlIn);
    if (ref !== out) {
      return finish(inconsistency(st, "strict:output-differs", `composed ${JSON.stringify(out)} normal ${JSON.stringify(ref)}`));
    }
  }
  stats.bytesIn += htmlIn.length;
  slot.entry = null; // a composed call says nothing about the offender of the memo: the memo is cleared (section 6.4)
  return finish({ out });
}
