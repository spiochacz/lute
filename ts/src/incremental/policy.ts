// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The policy of the cache per engine: "auto" (the default), "on" and "off". It decides when the cache starts and stops; the cache itself (the
// State and the composition) is in cache.ts and assemble.ts. The engine imports nothing of this file: dispatch.ts carries the handler only.
//
// "auto": the cache starts by itself on a call with an HTML string of at least AUTO_MIN_HTML_LENGTH characters when the previous such call in the
// same mode was SIMILAR to it (its length is within 25 percent of this one, and its first or its last 64 characters are equal to this one's).
// The first qualifying call therefore never starts the cache. A cache started this way backs off after AUTO_BACKOFF_CALLS consecutive calls that
// each fell back or had more misses than hits; the starting call itself is not counted. After a back-off the cache does not start again for
// AUTO_COOLDOWN_CALLS qualifying calls, doubled with every further back-off up to AUTO_COOLDOWN_MAX: a document that keeps falling back must not
// pay a cold fill every few calls. A cache started by "on" never backs off.
// "off": the cache is never used and its state is dropped.

import type { Lute } from "../types.ts";
import { incrementalActive, getState, setState, deleteState } from "./dispatch.ts";
import type { IncrementalMode } from "./dispatch.ts";
import { State, newStats } from "./cache.ts";
import type { IncrementalOptions, IncrementalStats } from "./cache.ts";

export type Dom2MdPolicy = "auto" | "on" | "off";

export const AUTO_MIN_HTML_LENGTH = 4096;
export const AUTO_BACKOFF_CALLS = 3;
export const AUTO_COOLDOWN_CALLS = 16;
export const AUTO_COOLDOWN_MAX = 1024;
const AUTO_SIGNATURE_CHARS = 64;
const AUTO_SIMILAR_RATIO = 0.25;

// The signature of a qualifying call: its length and its first and last characters. The document itself is not kept.
interface Signature {
  length: number;
  head: string;
  tail: string;
}

// The policy record of one engine. It is kept while the engine lives, also when the cache is not running, so that the counters are readable.
interface EnginePolicy {
  policy: Dom2MdPolicy;
  prev: { wysiwyg: Signature | null; ir: Signature | null }; // the previous qualifying call of each mode (rule (b))
  autoStarted: boolean; // the running cache was started by "auto" (it backs off)
  badCalls: number; // consecutive bad calls since the automatic start
  cooldown: number; // qualifying calls that must pass before the next automatic start (set by a back-off)
  autoStarts: number;
  autoBackoffs: number;
}

const registry = new WeakMap<Lute, EnginePolicy>();

function recordOf(lute: Lute): EnginePolicy {
  let rec = registry.get(lute);
  if (rec === undefined) {
    rec = { policy: "auto", prev: { wysiwyg: null, ir: null }, autoStarted: false, badCalls: 0, cooldown: 0, autoStarts: 0, autoBackoffs: 0 };
    registry.set(lute, rec);
  }
  return rec;
}

// getPolicy returns the policy of the engine ("auto" for an engine that has never been set).
export function getPolicy(lute: Lute): Dom2MdPolicy {
  const rec = registry.get(lute);
  return rec === undefined ? "auto" : rec.policy;
}

function signatureOf(html: string): Signature {
  return {
    length: html.length,
    head: html.substring(0, AUTO_SIGNATURE_CHARS),
    tail: html.substring(html.length - AUTO_SIGNATURE_CHARS),
  };
}

function similar(prev: Signature, cur: Signature): boolean {
  const longer = Math.max(prev.length, cur.length);
  const lengthOk = Math.abs(prev.length - cur.length) <= AUTO_SIMILAR_RATIO * longer;
  return lengthOk && (prev.head === cur.head || prev.tail === cur.tail);
}

// enableState gives the engine a cache state (one start of the cache, counted in incrementalActive). A running state keeps its statistics and
// gets the options.
function enableState(lute: Lute, options?: IncrementalOptions): void {
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

// dropState removes the cache state of the engine (and its count in incrementalActive); the policy record and its counters are kept.
function dropState(lute: Lute): void {
  if (deleteState(lute)) {
    incrementalActive.count--;
  }
}

// setPolicy sets the policy of the engine. "on" starts the cache (or replaces its options); "off" drops it; "auto" keeps a running cache, which
// is then an automatically started one (it backs off). The options are used by "on" only.
export function setPolicy(lute: Lute, policy: Dom2MdPolicy, options?: IncrementalOptions): void {
  const rec = recordOf(lute);
  rec.policy = policy;
  if (policy === "off") {
    rec.autoStarted = false;
    rec.badCalls = 0;
    rec.cooldown = 0;
    dropState(lute);
    return;
  }
  if (policy === "on") {
    rec.autoStarted = false;
    rec.badCalls = 0;
    enableState(lute, options);
    return;
  }
  if (getState(lute) !== undefined) {
    rec.autoStarted = true;
    rec.badCalls = 0;
  }
}

// admitAuto is called for an engine with no cache state. It returns true when the cache must start for this call (policy "auto", rule (a) and
// rule (b)), and then it starts the state. Every qualifying call of the engine in auto mode becomes the previous call of its mode.
export function admitAuto(lute: Lute, mode: IncrementalMode, html: string): boolean {
  if (html.length < AUTO_MIN_HTML_LENGTH) {
    return false;
  }
  const rec = recordOf(lute);
  if (rec.policy !== "auto") {
    return false;
  }
  const cur = signatureOf(html);
  const prev = rec.prev[mode];
  rec.prev[mode] = cur;
  if (rec.cooldown > 0) {
    rec.cooldown--;
    return false;
  }
  if (prev === null || !similar(prev, cur)) {
    return false;
  }
  rec.autoStarted = true;
  rec.badCalls = 0;
  rec.autoStarts++;
  enableState(lute);
  return true;
}

// observeAuto records a qualifying call of an engine whose cache is running: in auto mode it becomes the previous call of its mode.
export function observeAuto(lute: Lute, mode: IncrementalMode, html: string): void {
  const rec = registry.get(lute);
  if (rec !== undefined && rec.policy === "auto" && html.length >= AUTO_MIN_HTML_LENGTH) {
    rec.prev[mode] = signatureOf(html);
  }
}

// afterAutoCall is the back-off (section 3 of the policy): a call that fell back or had more misses than hits is bad. After AUTO_BACKOFF_CALLS
// consecutive bad calls the state is dropped and the engine is "not started" again. It does nothing for a cache that was not started by "auto".
export function afterAutoCall(lute: Lute, bad: boolean): void {
  const rec = registry.get(lute);
  if (rec === undefined || !rec.autoStarted) {
    return;
  }
  rec.badCalls = bad ? rec.badCalls + 1 : 0;
  if (rec.badCalls >= AUTO_BACKOFF_CALLS) {
    dropState(lute);
    rec.autoStarted = false;
    rec.badCalls = 0;
    rec.autoBackoffs++;
    rec.cooldown = Math.min(AUTO_COOLDOWN_MAX, AUTO_COOLDOWN_CALLS * 2 ** (rec.autoBackoffs - 1));
  }
}

// policyStats returns the statistics of the engine, or null when the engine has no running cache and its policy is not "auto" (or it has never
// been seen by the policy). With no running cache the statistics are zero, and only the automatic counters are set.
export function policyStats(lute: Lute): IncrementalStats | null {
  const rec = registry.get(lute);
  const st = getState<State>(lute);
  if (st === undefined) {
    if (rec === undefined || rec.policy !== "auto") {
      return null;
    }
    return { ...newStats(), autoStarts: rec.autoStarts, autoBackoffs: rec.autoBackoffs };
  }
  const s = st.stats;
  return {
    ...s,
    unsupported: { ...s.unsupported },
    inconsistencies: { ...s.inconsistencies },
    entries: st.maps.wysiwyg.size + st.maps.ir.size,
    bytesHeld: st.bytes,
    autoStarts: rec?.autoStarts ?? 0,
    autoBackoffs: rec?.autoBackoffs ?? 0,
  };
}

// resetPolicyStats zeroes the statistics of the engine, the automatic counters included; the running cache is kept.
export function resetPolicyStats(lute: Lute): void {
  const st = getState<State>(lute);
  if (st !== undefined) {
    st.stats = newStats();
  }
  const rec = registry.get(lute);
  if (rec !== undefined) {
    rec.autoStarts = 0;
    rec.autoBackoffs = 0;
  }
}
