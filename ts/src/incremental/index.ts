// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The public API of the per-child cache (section 7.2). The feature is off until EnableIncrementalDom2Md is called on an engine; with no engine
// enabled, the public methods run the normal path (one integer test).

import type { Lute } from "../types.ts";
import { incrementalActive, registerIncrementalHandler, deleteState, getState, setState } from "./dispatch.ts";
import type { IncrementalMode } from "./dispatch.ts";
import { State, newStats } from "./cache.ts";
import type { IncrementalOptions, IncrementalStats } from "./cache.ts";
import { tryDom2Md } from "./assemble.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "./sandbox.ts";
import { IncrementalInconsistency } from "./piece.ts";

export { IncrementalInconsistency } from "./piece.ts";
export type { IncrementalOptions, IncrementalStats } from "./cache.ts";

// EnableIncrementalDom2Md turns the cache on for the engine. It is idempotent: a second call replaces the options and keeps the cache.
export function EnableIncrementalDom2Md(lute: Lute, options?: IncrementalOptions): void {
  const existing = getState<State>(lute);
  if (existing === undefined) {
    setState(lute, new State(options ?? {}));
    incrementalActive.count++;
    return;
  }
  const o = options ?? {};
  existing.options = {
    strict: o.strict ?? false,
    verify: o.verify ?? false,
    maxBytes: o.maxBytes ?? 64 * 1024 * 1024,
  };
}

// DisableIncrementalDom2Md drops the cache and the statistics of the engine.
export function DisableIncrementalDom2Md(lute: Lute): void {
  if (deleteState(lute)) {
    incrementalActive.count--;
  }
}

// IncrementalDom2MdStats returns a copy of the statistics, or null when the cache is not enabled for the engine.
export function IncrementalDom2MdStats(lute: Lute): IncrementalStats | null {
  const st = getState<State>(lute);
  if (st === undefined) {
    return null;
  }
  const s = st.stats;
  return {
    ...s,
    unsupported: { ...s.unsupported },
    inconsistencies: { ...s.inconsistencies },
    entries: st.maps.wysiwyg.size + st.maps.ir.size,
    bytesHeld: st.bytes,
  };
}

// ResetIncrementalDom2MdStats zeroes the statistics; the cache is kept.
export function ResetIncrementalDom2MdStats(lute: Lute): void {
  const st = getState<State>(lute);
  if (st !== undefined) {
    const fresh = newStats();
    st.stats = fresh;
  }
}

registerIncrementalHandler((lute: Lute, mode: IncrementalMode, html: string): string | null => {
  const st = getState<State>(lute);
  if (st === undefined) {
    return null;
  }
  return tryDom2Md(st, lute, mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER, html);
});
