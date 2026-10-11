// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// fingerprint reads the options that the DOM2Md path reads (section 5.5): every own field of lute.ParseOptions and lute.RenderOptions, on every
// call, so that a change made in place (a field assignment, a Map entry) is seen. It returns null when a field has a type the fingerprint
// does not know; the caller then falls back (options-not-fingerprintable).

import type { Lute } from "../types.ts";

// stringKey encodes a string with its length, so that concatenations of keys and values cannot be confused.
function stringKey(s: string): string {
  return s.length + ":" + s;
}

// mapKey hashes a Map<string, string> with the entries in insertion order, keeping the size and the total number of characters.
function mapKey(m: Map<unknown, unknown>): string | null {
  let h = 0;
  let chars = 0;
  for (const [k, v] of m) {
    if (typeof k !== "string" || typeof v !== "string") {
      return null;
    }
    for (let i = 0; i < k.length; i++) {
      h = (Math.imul(h, 31) + k.charCodeAt(i)) | 0;
    }
    h = (Math.imul(h, 31) + 0) | 0; // separator between key and value
    for (let i = 0; i < v.length; i++) {
      h = (Math.imul(h, 31) + v.charCodeAt(i)) | 0;
    }
    h = (Math.imul(h, 31) + 1) | 0; // separator between entries
    chars += k.length + v.length;
  }
  return "M" + m.size + ":" + h + ":" + chars;
}

function valueKey(v: unknown): string | null {
  if (v === null) {
    return "n";
  }
  switch (typeof v) {
    case "boolean":
      return v ? "t" : "f";
    case "number":
      return "d" + String(v);
    case "string":
      return "s" + stringKey(v);
    case "object": {
      if (Array.isArray(v)) {
        const parts: string[] = [];
        for (const item of v) {
          const k = valueKey(item);
          if (k === null || item === null || typeof item === "object") {
            return null;
          }
          parts.push(k);
        }
        return "a" + v.length + "[" + parts.join(",") + "]";
      }
      if (v instanceof Map) {
        return mapKey(v);
      }
      return null;
    }
    default:
      return null;
  }
}

function objectKey(o: object): string | null {
  const parts: string[] = [];
  for (const k of Object.keys(o)) {
    const v = (o as Record<string, unknown>)[k];
    const key = valueKey(v);
    if (key === null) {
      return null;
    }
    parts.push(stringKey(k) + "=" + key);
  }
  return parts.join(";");
}

export function fingerprint(lute: Lute): string | null {
  const p = objectKey(lute.ParseOptions);
  if (p === null) {
    return null;
  }
  const r = objectKey(lute.RenderOptions);
  if (r === null) {
    return null;
  }
  return "P{" + p + "}R{" + r + "}";
}
