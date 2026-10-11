// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The types of a piece (one top-level child of the input): the context it may read, its variants, its ChildInfo and its cache entry.

import type { RootOp } from "../render/recording_format_renderer.ts";

export type Mode = "wysiwyg" | "ir";

// The context a piece may read. Nothing else about the neighbours is reachable (section 3). There is no read recording: the variant
// key is the whole tuple (contextKey), so a run is a function of its key (milestone C, C1). isFirst and isLast are not fields: they are
// the facts prev < 0 and next < 0, which the sandbox links from prev and next (invariant I1).
export interface Context {
  lastOut: number; // LastOut of the renderer at entry, 0..255. The replay's value; 10 (LF) at the start of the document.
  prev: number; // ast.NodeType of the last top-level AST node before this piece's first one, -1 if none.
  next: number; // ast.NodeType of the first top-level AST node after this piece's last one, -1 if none.
  domPrev: number; // html atom (DataAtom) of the nearest ALIVE top-level DOM sibling before, -1 if none.
  domNext: number; // same after.
  domNextAttrs: number; // Attr.length of that sibling: the stub answers Attr with it, so it is part of the key (invariant I4).
}

// The key of a context: every field the stubs expose (invariant I4). A field added to Context must be added here; the test
// context_key.test.ts enumerates the fields of a Context.
export function contextKey(c: Context): string {
  return `${c.lastOut},${c.prev},${c.next},${c.domPrev},${c.domNext},${c.domNextAttrs}`;
}

export interface Variant {
  key: string; // contextKey of the context the run was made with; a variant is used only for an equal key
  ops: RootOp[]; // root-writer log, adjacent operations coalesced (section 2.3)
  endLastOut: number; // 0..255: the renderer's LastOut at the end of the run (the replay adopts it)
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
