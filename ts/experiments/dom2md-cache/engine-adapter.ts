// The engine under test for fuzz.ts (tasks/004, Milestone B specification, section 7.4 and step 13). It implements the surface that fuzz.ts
// uses from the prototype (CachedDom2Md in cached.ts): convert, uncached, stats, lastFallbackReason, clear, size; on top of two engines built
// from the same setter list: engine A with the cache enabled (strict, verify off: the fuzzer compares the outputs itself) and engine B
// without the cache (the reference). Every option toggle of the fuzzer is applied to both.
//
// Two additions over the prototype's surface: lastInconsistency (the reason of an IncrementalInconsistency thrown by A in strict mode; the
// fuzzer counts it as a mismatch even when B throws too) and counters() (evictions, too-large fallbacks, inconsistencies, cumulative).

import { New, EnableIncrementalDom2Md, DisableIncrementalDom2Md, IncrementalDom2MdStats, IncrementalInconsistency } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import type { SetterCall } from "../../test/e2e/helpers.ts";

export type Mode = "wysiwyg" | "ir";

export interface EngineOptions {
  maxBytes?: number; // the cache bound; the default of the engine (64 MiB) when absent
}

function applySetters(lute: Lute, setters: readonly SetterCall[]): void {
  const proto = lute as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [name, ...args] of setters) {
    if (typeof proto[name] !== "function") {
      throw new Error(`engine has no setter ${name}`);
    }
    proto[name].apply(lute, args);
  }
}

// fallbackKey returns the reason of the fallback that happened between two statistics snapshots ("" when none).
function fallbackKey(before: Record<string, number>, after: Record<string, number>): string {
  for (const k of Object.keys(after)) {
    if ((after[k] ?? 0) > (before[k] ?? 0)) {
      return k;
    }
  }
  return "";
}

export class EngineDom2Md {
  readonly mode: Mode;
  readonly a: Lute;
  readonly b: Lute;
  readonly setters: readonly SetterCall[];
  readonly options: EngineOptions;
  lastFallbackReason = "";
  lastInconsistency = "";

  constructor(setters: readonly SetterCall[], mode: Mode, options: EngineOptions = {}) {
    this.mode = mode;
    this.setters = setters;
    this.options = options;
    this.a = New();
    applySetters(this.a, setters);
    this.b = New();
    applySetters(this.b, setters);
    this.enable();
  }

  private enable(): void {
    const o: { strict: boolean; verify: boolean; maxBytes?: number } = { strict: true, verify: false };
    if (this.options.maxBytes !== undefined) {
      o.maxBytes = this.options.maxBytes;
    }
    EnableIncrementalDom2Md(this.a, o);
  }

  // setProtyle applies the ProtyleWYSIWYG toggle of the fuzzer to both engines.
  setProtyle(v: boolean): void {
    this.a.SetProtyleWYSIWYG(v);
    this.b.SetProtyleWYSIWYG(v);
  }

  private call(lute: Lute, html: string): string {
    return this.mode === "wysiwyg" ? lute.VditorDOM2Md(html) : lute.VditorIRDOM2Md(html);
  }

  // convert is the cached call. A fallback reason is read from the statistics; an inconsistency (strict mode throws) is recorded and rethrown.
  convert(html: string): string {
    const before = IncrementalDom2MdStats(this.a)!;
    this.lastFallbackReason = "";
    this.lastInconsistency = "";
    try {
      return this.call(this.a, html);
    } catch (e) {
      if (e instanceof IncrementalInconsistency) {
        this.lastInconsistency = e.reason;
      }
      throw e;
    } finally {
      const after = IncrementalDom2MdStats(this.a)!;
      if (after.fallbacks > before.fallbacks) {
        this.lastFallbackReason = fallbackKey(before.unsupported, after.unsupported) || fallbackKey(before.inconsistencies, after.inconsistencies);
      }
    }
  }

  // uncached is the reference call (engine B, cache off).
  uncached(html: string): string {
    return this.call(this.b, html);
  }

  // stats are the counters of the prototype's surface, derived from the engine's statistics. The engine keeps no byte counter per miss, so
  // missBytes and totalBytes stay 0 (the fuzzer prints them as not available).
  get stats(): { fallbackCalls: number; children: number; hits: number; misses: number; missBytes: number; totalBytes: number } {
    const s = IncrementalDom2MdStats(this.a)!;
    return { fallbackCalls: s.fallbacks, children: s.children, hits: s.hits, misses: s.misses, missBytes: 0, totalBytes: 0 };
  }

  // counters are the cumulative counts the fuzzer reports per pass.
  counters(): { evictions: number; tooLarge: number; inconsistencies: number; entries: number } {
    const s = IncrementalDom2MdStats(this.a)!;
    return {
      evictions: s.evictions,
      tooLarge: s.unsupported["too-large"] ?? 0,
      inconsistencies: Object.values(s.inconsistencies).reduce((x, y) => x + y, 0),
      entries: s.entries,
    };
  }

  engineStats(): ReturnType<typeof IncrementalDom2MdStats> {
    return IncrementalDom2MdStats(this.a);
  }

  // clear drops the cache and enables it again with the same options (the bound and strict mode are kept).
  clear(): void {
    DisableIncrementalDom2Md(this.a);
    this.enable();
  }

  size(): number {
    return IncrementalDom2MdStats(this.a)!.entries;
  }
}
