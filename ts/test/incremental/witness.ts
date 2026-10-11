// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// Witness search for the context channels (coordinator decision, tasks/004 Milestone B implementation, deviation 8): a context field is REAL
// when some child's sandbox run gives a different outcome (refusal, alive flag, log, or end LastOut) under two values of that one field, all
// else equal. The search is deterministic and bounded in time; it returns the first witness in candidate order, or none.

import * as ast from "../../src/ast/index.ts";
import * as atom from "../../src/html/atom/index.ts";
import * as conv from "../../src/runtime/conv.ts";
import type { Lute } from "../../src/index.ts";
import type { ModeAdapter } from "../../src/incremental/sandbox.ts";
import { runChild } from "../../src/incremental/sandbox.ts";
import { contextKey } from "../../src/incremental/piece.ts";
import type { Context, Variant } from "../../src/incremental/piece.ts";

// The fields of the context (milestone C, C1): isFirst and isLast are gone (they are prev < 0 and next < 0).
export type ContextField = "lastOut" | "prev" | "next" | "domPrev" | "domNext" | "domNextAttrs";

export const BASE_CONTEXT: Context = { lastOut: 10, prev: -1, next: -1, domPrev: -1, domNext: -1, domNextAttrs: 0 };

// The two values of each field of the declared context. Only the field changes between A and B. isLast is witnessed by next (-1 against a type).
export const FIELD_VALUES: Array<{ field: ContextField; a: number | boolean; b: number | boolean }> = [
  { field: "lastOut", a: 10, b: 0x78 },
  { field: "prev", a: -1, b: ast.NodeText },
  { field: "next", a: -1, b: ast.NodeParagraph },
  { field: "domPrev", a: -1, b: atom.P },
  { field: "domNext", a: -1, b: atom.Ul },
];

export function withField(field: ContextField, value: number | boolean): Context {
  return { ...BASE_CONTEXT, [field]: value };
}

// outcome is what the cache could observe of one run: refusal, the alive flag, the log and the end LastOut.
export function outcome(lute: Lute, adapter: ModeAdapter, html: string, ctx: Context, opaque: boolean): string {
  const r = runChild(lute, adapter, html, ctx, { certify: true, opaque });
  const ops = r.variant === null ? null : r.variant.ops.map((o) => (o.kind === "Append" ? [o.kind, o.setsLastOut, conv.StringFromBytes(o.bytes)] : [o.kind]));
  return JSON.stringify({ refusal: r.refusal, alive: r.info === null ? null : r.info.alive, ops, end: r.variant === null ? null : r.variant.endLastOut });
}

export interface Witness {
  field: ContextField;
  html: string;
  a: number | boolean;
  b: number | boolean;
  outA: string;
  outB: string;
  variantA: Variant;
}

export interface SearchResult {
  witness: Witness | null;
  candidates: number; // candidates examined
  ms: number;
}

// searchWitness examines the candidates in order, for at most budgetMs, and returns the first child whose outcome differs between the
// two values of the field.
export function searchWitness(lute: Lute, adapter: ModeAdapter, field: ContextField, candidates: string[], budgetMs: number): SearchResult {
  const spec = FIELD_VALUES.find((f) => f.field === field);
  if (spec === undefined) {
    throw new Error("searchWitness: unknown field " + field);
  }
  const start = Date.now();
  let examined = 0;
  for (const html of candidates) {
    if (Date.now() - start > budgetMs) {
      break;
    }
    examined++;
    const ctxA = withField(field, spec.a);
    const ctxB = withField(field, spec.b);
    const oa = outcome(lute, adapter, html, ctxA, false);
    const ob = outcome(lute, adapter, html, ctxB, false);
    if (oa !== ob) {
      const ra = runChild(lute, adapter, html, ctxA, { certify: true, opaque: false });
      return {
        witness: { field, html, a: spec.a, b: spec.b, outA: oa, outB: ob, variantA: ra.variant! },
        candidates: examined,
        ms: Date.now() - start,
      };
    }
  }
  return { witness: null, candidates: examined, ms: Date.now() - start };
}

// matchesContext reports whether a variant matches a context: the same key (milestone C, C1; the read-recording match of section 2.1 is gone).
export function matchesContext(v: Variant, c: Context): boolean {
  return v.key === contextKey(c);
}
