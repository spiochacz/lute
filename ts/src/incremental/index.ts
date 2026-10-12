// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The public API of the per-child cache (section 7.2). Each engine has a policy (policy.ts): "auto" by default, which starts the cache by itself for
// similar large documents; "on" (EnableIncrementalDom2Md); "off" (DisableIncrementalDom2Md). With the module not loaded the wrappers run the
// normal path only.

import { Lute } from "../types.ts";
import { incrementalAuto, registerIncrementalHandler, getState } from "./dispatch.ts";
import type { IncrementalMode } from "./dispatch.ts";
import { State } from "./cache.ts";
import type { IncrementalOptions, IncrementalStats } from "./cache.ts";
import { tryDom2Md } from "./assemble.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "./sandbox.ts";
import { AUTO_MIN_HTML_LENGTH, admitAuto, afterAutoCall, getPolicy, observeAuto, policyStats, resetPolicyStats, setPolicy } from "./policy.ts";
import type { Dom2MdPolicy } from "./policy.ts";

export { IncrementalInconsistency } from "./piece.ts";
export type { IncrementalOptions, IncrementalStats } from "./cache.ts";
export type { Dom2MdPolicy } from "./policy.ts";
export { AUTO_MIN_HTML_LENGTH, AUTO_COOLDOWN_CALLS } from "./policy.ts";

// EnableIncrementalDom2Md sets the policy of the engine to "on". It is idempotent: a second call replaces the options and keeps the cache.
export function EnableIncrementalDom2Md(lute: Lute, options?: IncrementalOptions): void {
  setPolicy(lute, "on", options);
}

// DisableIncrementalDom2Md sets the policy of the engine to "off": the cache and its state are dropped.
export function DisableIncrementalDom2Md(lute: Lute): void {
  setPolicy(lute, "off");
}

// SetIncrementalDom2MdPolicy sets the policy of the engine: "auto", "on" or "off" (see policy.ts).
export function SetIncrementalDom2MdPolicy(lute: Lute, policy: Dom2MdPolicy): void {
  setPolicy(lute, policy);
}

// GetIncrementalDom2MdPolicy returns the policy of the engine ("auto" when it was never set).
export function GetIncrementalDom2MdPolicy(lute: Lute): Dom2MdPolicy {
  return getPolicy(lute);
}

// IncrementalDom2MdStats returns a copy of the statistics, or null when the engine has no cache and its policy is not "auto". The automatic
// counters (autoStarts, autoBackoffs) are readable while the cache is not running.
export function IncrementalDom2MdStats(lute: Lute): IncrementalStats | null {
  return policyStats(lute);
}

// ResetIncrementalDom2MdStats zeroes the statistics, the automatic counters included; the cache is kept.
export function ResetIncrementalDom2MdStats(lute: Lute): void {
  resetPolicyStats(lute);
}

// The methods of the engine object (the bundle's engine): the same policy as the functions above. "true" is "on", "false" is "off".
declare module "../types.ts" {
  interface Lute {
    SetIncrementalDom2Md(enable: boolean): void;
    IncrementalDom2MdStats(): IncrementalStats | null;
  }
}

Lute.prototype.SetIncrementalDom2Md = function (this: Lute, enable: boolean): void {
  setPolicy(this, enable ? "on" : "off");
};

Lute.prototype.IncrementalDom2MdStats = function (this: Lute): IncrementalStats | null {
  return policyStats(this);
};

incrementalAuto.minLength = AUTO_MIN_HTML_LENGTH;

registerIncrementalHandler((lute: Lute, mode: IncrementalMode, html: string): string | null => {
  const adapter = mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
  let st = getState<State>(lute);
  if (st === undefined) {
    if (!admitAuto(lute, mode, html)) {
      return null;
    }
    // the starting call of an automatic start: a cold cache, not counted by the back-off
    st = getState<State>(lute)!;
    return tryDom2Md(st, lute, adapter, html);
  }
  observeAuto(lute, mode, html);
  const s = st.stats;
  const hits0 = s.hits;
  const misses0 = s.misses;
  const out = tryDom2Md(st, lute, adapter, html);
  afterAutoCall(lute, out === null || s.misses - misses0 > s.hits - hits0);
  return out;
});
