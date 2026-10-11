// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The state of one engine's cache (section 5.4 and step 9): the two maps, the accounting, the statistics and the options.

import type { Entry, Variant } from "./piece.ts";

export const MAX_VARIANTS = 8;

export interface IncrementalOptions {
  strict?: boolean;
  verify?: boolean;
  maxBytes?: number;
}

export interface IncrementalStats {
  calls: number;
  composed: number;
  fallbacks: number; // composed + fallbacks == calls
  unsupported: Record<string, number>;
  inconsistencies: Record<string, number>;
  children: number;
  hits: number;
  misses: number;
  sandboxRuns: number;
  bytesIn: number;
  entries: number;
  bytesHeld: number;
  evictions: number;
  optionClears: number;
}

export function newStats(): IncrementalStats {
  return {
    calls: 0,
    composed: 0,
    fallbacks: 0,
    unsupported: {},
    inconsistencies: {},
    children: 0,
    hits: 0,
    misses: 0,
    sandboxRuns: 0,
    bytesIn: 0,
    entries: 0,
    bytesHeld: 0,
    evictions: 0,
    optionClears: 0,
  };
}

export class State {
  maps: { wysiwyg: Map<string, Entry>; ir: Map<string, Entry> };
  fp: string;
  bytes: number;
  callNo: number;
  stats: IncrementalStats;
  options: { strict: boolean; verify: boolean; maxBytes: number };

  constructor(options: IncrementalOptions) {
    this.maps = { wysiwyg: new Map<string, Entry>(), ir: new Map<string, Entry>() };
    this.fp = "";
    this.bytes = 0;
    this.callNo = 0;
    this.stats = newStats();
    this.options = {
      strict: options.strict ?? false,
      verify: options.verify ?? false,
      maxBytes: options.maxBytes ?? 64 * 1024 * 1024,
    };
  }
}

// flat returns a copy of s that owns its characters (a substring of a large string would keep the large string alive, section 5.4).
export function flat(s: string): string {
  return Buffer.from(s, "utf16le").toString("utf16le");
}

export function newEntry(html: string, opaque: boolean): Entry {
  const key = flat(html);
  return { html: key, opaque, info: null, refusal: null, variants: [], bytes: 2 * key.length + 160, lastCall: 0 };
}

// addVariant adds a variant to an entry; the oldest is dropped when there are already MAX_VARIANTS.
export function addVariant(st: State, e: Entry, v: Variant): void {
  if (e.variants.length >= MAX_VARIANTS) {
    const old = e.variants.shift()!;
    e.bytes -= old.bytes;
    st.bytes -= old.bytes;
  }
  e.variants.push(v);
  e.bytes += v.bytes;
  st.bytes += v.bytes;
}

// removeEntry deletes an entry from its map and from the accounting.
export function removeEntry(st: State, map: Map<string, Entry>, e: Entry): void {
  if (map.get(e.html) === e) {
    map.delete(e.html);
    st.bytes -= e.bytes;
  }
}

// evict is run at the end of each call (section 5.4): when the bound is exceeded, the entries that this call did not touch are deleted in
// insertion order until 75% of the bound; if the bound is still exceeded, both maps are cleared (the next call starts cold).
export function evict(st: State, call: number): void {
  const max = st.options.maxBytes;
  if (st.bytes <= max) {
    return;
  }
  for (const map of [st.maps.wysiwyg, st.maps.ir]) {
    for (const [key, e] of map) {
      if (st.bytes <= 0.75 * max) {
        break;
      }
      if (e.lastCall < call) {
        map.delete(key);
        st.bytes -= e.bytes;
        st.stats.evictions++;
      }
    }
  }
  if (st.bytes > max) {
    st.stats.evictions += st.maps.wysiwyg.size + st.maps.ir.size;
    st.maps.wysiwyg.clear();
    st.maps.ir.clear();
    st.bytes = 0;
  }
}
