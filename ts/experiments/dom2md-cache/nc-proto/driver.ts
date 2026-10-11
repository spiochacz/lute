// Scratch driver for the negative-control analysis (not part of the engine). Registers the NC copy of the cache as the handler.
import { New, EnableIncrementalDom2Md, IncrementalDom2MdStats, editor } from "../../../src/index.ts";
import type { Lute } from "../../../src/index.ts";
import { registerIncrementalHandler, getState } from "../../../src/incremental/dispatch.ts";
import type { IncrementalMode } from "../../../src/incremental/dispatch.ts";
import { State } from "../../../src/incremental/cache.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "./sandbox_nc.ts";
import { tryDom2Md, NC } from "./assemble_nc.ts";

if (!process.env.REAL) registerIncrementalHandler((lute: Lute, mode: IncrementalMode, html: string): string | null => {
  const st = getState<State>(lute);
  if (st === undefined) return null;
  return tryDom2Md(st, lute, mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER, html);
});

export { NC, IncrementalDom2MdStats };
export type Mode = "wysiwyg" | "ir";
export const reference: Lute = New();
export function cached(strict = false, verify = false): Lute {
  const l = New();
  EnableIncrementalDom2Md(l, { strict, verify });
  return l;
}
export function conv(l: Lute, mode: Mode, html: string): string {
  const h = html.split(editor.Zwsp).join("");
  return mode === "wysiwyg" ? l.VditorDOM2Md(h) : l.VditorIRDOM2Md(h);
}
export function setNC(flags: Record<string, boolean>): void {
  for (const k of Object.keys(NC)) delete NC[k];
  Object.assign(NC, flags);
}
export function attempt(f: () => string): string {
  try { return f(); } catch (e) { return "THROW " + String(e).slice(0, 80); }
}
