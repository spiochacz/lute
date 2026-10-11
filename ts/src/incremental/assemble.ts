// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// tryDom2Md is one call of the cache (section 5.1). It returns the output of the composed document, or null when the normal path must run
// (a counted fallback). In strict mode an inconsistency throws IncrementalInconsistency, after it is counted.

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
import { listCoupling, runChild } from "./sandbox.ts";
import type { ModeAdapter } from "./sandbox.ts";
import { addVariant, evict, newEntry, removeEntry, State } from "./cache.ts";
import type { Entry, ChildInfo, Context, ReadKey, Refusal, Variant } from "./piece.ts";
import { IncrementalInconsistency, LASTOUT_PASS } from "./piece.ts";

// PROVISIONAL_CONTEXT: an isolated document; the first variant is used only if the actual context equals it (section 5.1).
const PROVISIONAL: Context = { lastOut: 10, prev: -1, next: -1, isFirst: true, isLast: true, domPrev: -1, domNext: -1, domNextAttrs: 0 };

function matches(v: Variant, c: Context): boolean {
  return v.readKeys.every((k: ReadKey, i: number) => c[k] === v.readVals[i]);
}

function sameInfo(a: ChildInfo, b: ChildInfo): boolean {
  return a.alive === b.alive && a.atom === b.atom && a.attrs === b.attrs && a.topTypes.length === b.topTypes.length && a.topTypes.every((t, i) => t === b.topTypes[i]);
}

// Outcome of one call: the composed output, or the reason of the fallback with its kind.
type Outcome = { out: string } | { reason: string; kind: "unsupported" | "inconsistency" };

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
    return { reason: refusal.reason, kind: "unsupported" };
  }
  removeEntry(st, map, e);
  return inconsistency(st, refusal.reason, detail);
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
  }
  const map = adapter.mode === "wysiwyg" ? st.maps.wysiwyg : st.maps.ir;

  // 4-5: the string and its scan
  const h = adapter.preprocess(htmlIn);
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

  // 9: runs for the children that have no info yet, in document order
  for (const e of entries) {
    if (e.info !== null || e.refusal !== null) {
      continue;
    }
    stats.sandboxRuns++;
    stats.misses++;
    const res = runChild(lute, adapter, e.html, PROVISIONAL, { certify: true, opaque: e.opaque });
    if (res.refusal !== null) {
      const o = refusalOutcome(st, map, e, res.refusal, e.html);
      if ("kind" in o && o.kind === "inconsistency") {
        evict(st, call);
        return finish(o);
      }
      continue; // an unsupported refusal is reported in document order below
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
    e.info = res.info;
    if (res.variant !== null) {
      addVariant(st, e, res.variant);
    }
  }
  // 10: the first refusal in document order names the reason
  for (const e of entries) {
    if (e.refusal !== null) {
      evict(st, call);
      return finish({ reason: e.refusal.reason, kind: "unsupported" });
    }
  }
  for (const e of entries) {
    if (e.info === null) {
      throw new Error("incremental: an entry without info and without refusal (internal)");
    }
  }

  // 11: list coupling (section 3.5)
  const infos = entries.map((e) => e.info!);
  if (listCoupling(lute, infos)) {
    evict(st, call);
    return finish({ reason: "list-coupling", kind: "unsupported" });
  }

  // 12: the sweeps (5.1): neighbours that emit, and the nearest alive DOM siblings
  const n = entries.length;
  const emitting = (i: number): boolean => infos[i].alive && infos[i].topTypes.length > 0;
  const prevT: number[] = new Array(n).fill(-1);
  const domP: number[] = new Array(n).fill(-1);
  const nextT: number[] = new Array(n).fill(-1);
  const domN: number[] = new Array(n).fill(-1);
  const domNA: number[] = new Array(n).fill(0);
  let lastEmit = -1;
  let lastAlive = -1;
  for (let i = 0; i < n; i++) {
    prevT[i] = lastEmit < 0 ? -1 : infos[lastEmit].topTypes[infos[lastEmit].topTypes.length - 1];
    domP[i] = lastAlive < 0 ? -1 : infos[lastAlive].atom;
    if (infos[i].alive) {
      lastAlive = i;
    }
    if (emitting(i)) {
      lastEmit = i;
    }
  }
  let nextEmit = -1;
  let nextAlive = -1;
  for (let i = n - 1; i >= 0; i--) {
    nextT[i] = nextEmit < 0 ? -1 : infos[nextEmit].topTypes[0];
    domN[i] = nextAlive < 0 ? -1 : infos[nextAlive].atom;
    domNA[i] = nextAlive < 0 ? 0 : infos[nextAlive].attrs;
    if (infos[i].alive) {
      nextAlive = i;
    }
    if (emitting(i)) {
      nextEmit = i;
    }
  }

  // 13-14: the replay on a FormatRenderer, variant by variant
  const R = new FormatRenderer(new parse.Tree(), adapter.renderOptions(), lute.ParseOptions);
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
      isFirst: prevT[i] < 0,
      isLast: nextT[i] < 0,
      domPrev: domP[i],
      domNext: domN[i],
      domNextAttrs: domNA[i],
    };
    const e = entries[i];
    let v = e.variants.find((x) => matches(x, ctx));
    if (v !== undefined) {
      stats.hits++;
    } else {
      stats.misses++;
      stats.sandboxRuns++;
      const c = e;
      const res = runChild(lute, adapter, c.html, ctx, { certify: false, opaque: c.opaque });
      if (res.refusal !== null) {
        const o = refusalOutcome(st, map, e, res.refusal, e.html);
        evict(st, call);
        return finish(o);
      }
      if (!sameInfo(res.info!, e.info!)) {
        const o = inconsistency(st, "info-changed", e.html);
        removeEntry(st, map, e);
        evict(st, call);
        return finish(o);
      }
      v = res.variant!;
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
    if (v.endLastOut !== LASTOUT_PASS) {
      if (st.options.strict && R.LastOut !== v.endLastOut) {
        const o = inconsistency(st, "replay:lastout-diverged", `replay LastOut ${R.LastOut}, endLastOut ${v.endLastOut}`);
        evict(st, call);
        return finish(o);
      }
      R.LastOut = v.endLastOut;
    }
  }

  // 15-17: the document close, the output, the eviction
  closeDocumentWriter(R);
  const out = conv.StringFromBytes(R.Writer.Bytes());
  evict(st, call);

  // 18: verify (section 5.1 line 18)
  if (st.options.verify) {
    const ref = adapter.mode === "wysiwyg" ? lute.vditorDOM2Md(htmlIn) : lute.vditorIRDOM2Md(htmlIn);
    if (ref !== out) {
      return finish(inconsistency(st, "strict:output-differs", `composed ${JSON.stringify(out)} normal ${JSON.stringify(ref)}`));
    }
  }
  stats.bytesIn += htmlIn.length;
  return finish({ out });
}
