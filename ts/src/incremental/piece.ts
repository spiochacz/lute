// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The types of a piece (one top-level child of the input): the context it may read, its variants, its ChildInfo and its cache entry.

import type { RootOp } from "../render/recording_format_renderer.ts";

export type Mode = "wysiwyg" | "ir";

// endLastOut of a variant whose run never assigned LastOut.
export const LASTOUT_PASS = -1;

// The context a piece may read. Nothing else about the neighbours is reachable (section 3).
export interface Context {
  lastOut: number; // LastOut of the renderer at entry, 0..255. The replay's value; 10 (LF) at the start of the document.
  prev: number; // ast.NodeType of the last top-level AST node before this piece's first one, -1 if none.
  next: number; // ast.NodeType of the first top-level AST node after this piece's last one, -1 if none.
  isFirst: boolean; // no top-level AST node before this piece's first one.
  isLast: boolean; // no top-level AST node after this piece's last one.
  domPrev: number; // html atom (DataAtom) of the nearest ALIVE top-level DOM sibling before, -1 if none.
  domNext: number; // same after.
  domNextAttrs: number; // Attr.length of that sibling; used only to answer the covered mergeVditorDOMList0 read; never part of a key.
}

export type ReadKey = "lastOut" | "prev" | "next" | "isFirst" | "isLast" | "domPrev" | "domNext";

export interface Variant {
  readKeys: ReadKey[]; // the context fields the run read, in order of first read, no duplicates
  readVals: Array<number | boolean>; // the value of each at the time of the run (same index)
  ops: RootOp[]; // root-writer log, adjacent operations coalesced (section 2.3)
  endLastOut: number; // 0..255, or LASTOUT_PASS
  bytes: number; // memory estimate
}

export interface ChildInfo {
  // context-free: a function of (html, options) only
  alive: boolean; // survives removeEmptyNodes
  atom: number; // DataAtom of the top-level element after the DOM passes (== before pass 4, checked)
  attrs: number; // Attr.length of it right before mergeVditorDOMList0
  topTypes: number[]; // Type of every top-level AST node the child produced, in order ([] if none)
}

export type RefusalKind = "unsupported" | "inconsistency";
export interface Refusal {
  kind: RefusalKind;
  reason: string; // from the closed list REASONS
}

export interface Entry {
  html: string; // the key; a flat copy (section 5.4)
  opaque: boolean; // the string contains a skipped data-render preview (scanner flag)
  info: ChildInfo | null; // null until the first run completes
  refusal: Refusal | null; // set when the child cannot be a piece; the entry then has no variants
  variants: Variant[]; // at most MAX_VARIANTS (8); the oldest is dropped when a ninth is added
  bytes: number;
  lastCall: number; // the call number that last touched the entry
}

// The closed list of reasons of section 6. Barrier reasons are "barrier:" followed by the site (not listed).
export const REASONS = [
  "options-not-fingerprintable",
  "empty-document",
  "scan:top-level-text",
  "scan:comment-or-doctype",
  "scan:stray-lt",
  "scan:tag-not-allowed",
  "scan:top-level-tag",
  "scan:upper-case-tag",
  "scan:malformed-end-tag",
  "scan:mismatched-end-tag",
  "scan:unterminated",
  "scan:unterminated-tag",
  "scan:self-closing-non-void",
  "scan:implicit-end-tag",
  "scan:table-structure",
  "scan:unterminated-attribute",
  "scan:unterminated-preview",
  "cert:opaque-preview",
  "tip-open",
  "list-coupling",
  "generated-id",
  "engine-threw",
  "too-large",
  "cert:scanner-accepted-certificate-refused",
  "sibling-structure-changed",
  "top-level-atom-changed",
  "info-changed",
  "replay:lastout-diverged",
  "replay:unlogged-mutation",
  "strict:sandwich",
  "strict:output-differs",
] as const;

export type ReasonKey = (typeof REASONS)[number];

// An inconsistency: a case that the design says cannot happen. Strict mode throws it; normal mode falls back and counts it.
export class IncrementalInconsistency extends Error {
  reason: string;

  constructor(reason: string, detail: string) {
    super(reason + ": " + detail);
    this.name = "IncrementalInconsistency";
    this.reason = reason;
  }
}

// A stub or guard of the sandbox was touched beyond its declared fields. site names the access, for example "dom.next.Data".
export class BarrierViolation extends Error {
  site: string;

  constructor(site: string) {
    super("barrier violation: " + site);
    this.name = "BarrierViolation";
    this.site = site;
  }
}
