// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The only file of the incremental cache that the engine imports. It holds the number of engines with the cache enabled (checked on every
// call of the public wrappers) and the handler that the cache registers; with no engine enabled the handler is never reached.

import type { Lute } from "../types.ts";

export type IncrementalMode = "wysiwyg" | "ir";

// incrementalActive.count is the number of engines that have the cache enabled.
export const incrementalActive = { count: 0 };

export type IncrementalHandler = (lute: Lute, mode: IncrementalMode, html: string) => string | null;

let handler: IncrementalHandler | null = null;

// registerIncrementalHandler sets (or with null clears) the function that composes a result from the cache.
export function registerIncrementalHandler(h: IncrementalHandler | null): void {
  handler = h;
}

// tryIncrementalDom2Md returns the composed result of the cache, or null when the normal path must run.
export function tryIncrementalDom2Md(lute: Lute, mode: IncrementalMode, html: string): string | null {
  return handler === null ? null : handler(lute, mode, html);
}

// The state of each engine with the cache enabled (the module state of section 7.2; no field is added to Lute).
// PORT-NOTE: the registry is a WeakMap so that a dropped engine releases its cache.
const registry = new WeakMap<Lute, unknown>();

export function getState<T>(lute: Lute): T | undefined {
  return registry.get(lute) as T | undefined;
}

export function setState<T>(lute: Lute, st: T): void {
  registry.set(lute, st);
}

// deleteState removes the state; it returns whether the engine had one.
export function deleteState(lute: Lute): boolean {
  return registry.delete(lute);
}
