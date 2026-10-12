// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// scanTopLevel cuts the string of a Vditor DOM into its top-level elements without building a DOM. It accepts a string only if it is in
// the grammar of section 4.4 of the milestone B specification (G1-G5); otherwise it returns the code of the first violated clause.
// The cut is then certified by the engine's HTML parser (parser_certificate.ts) before any child is used.
// Ported from ts/experiments/dom2md-cache/scan.ts (the algorithm; the codes, the top-level check and the fields are the specification's).
// The HTML facts (which elements have no end tag, which start tags close an open p) are probed from the engine's parser (html_facts.ts); the
// sets ALLOWED, TOP_LEVEL and TABLE_PARTS below are the scanner's policy (what it accepts), not HTML facts.

import { htmlFacts } from "./html_facts.ts";

export interface Child {
  start: number;
  end: number;
  tag: string;
  attrs: number; // attribute count of the start tag
  opaque: boolean; // contains a skipped data-render preview <pre> (raw HTML that is not validated here)
}

export type ScanCode =
  | "no-children"
  | "top-level-text"
  | "comment-or-doctype"
  | "stray-lt"
  | "tag-not-allowed"
  | "top-level-tag"
  | "upper-case-tag"
  | "malformed-end-tag"
  | "mismatched-end-tag"
  | "unterminated"
  | "unterminated-tag"
  | "self-closing-non-void"
  | "implicit-end-tag"
  | "table-structure"
  | "unterminated-attribute"
  | "unterminated-preview";

export type ScanResult = { ok: true; children: Child[] } | { ok: false; code: ScanCode; at: number };

// Elements that may occur anywhere inside a child (grammar G2).
const ALLOWED = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
  "blockquote", "pre", "code", "hr", "br", "img", "input", "wbr", "a", "strong", "em", "b", "i", "u", "s",
  "del", "strike", "mark", "sup", "sub", "span", "div", "kbd", "font", "details", "summary", "label", "small", "abbr",
  "ins", "cite", "q", "var", "samp", "figure", "figcaption", "center", "caption", "tfoot", "colgroup", "col",
]);

// The tags that may be the top-level element of a child (grammar G4).
const TOP_LEVEL = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "hr", "div"]);

const TABLE_PARTS = new Set(["thead", "tbody", "tfoot", "tr", "colgroup"]);

function isLetter(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}

function isHeadingName(name: string): boolean {
  return name.length === 2 && name.charCodeAt(0) === 104 && name.charCodeAt(1) >= 49 && name.charCodeAt(1) <= 54;
}

export function scanTopLevel(html: string): ScanResult {
  const facts = htmlFacts(ALLOWED); // probed once per process, on the first scan (html_facts.ts)
  const n = html.length;
  const children: Child[] = [];
  const stack: string[] = [];
  let pDepth = 0;
  let hDepth = 0;
  let aDepth = 0;
  let i = 0;
  let curStart = 0;
  let curTag = "";
  let curAttrs = 0;
  let curOpaque = false;

  while (i < n) {
    if (stack.length === 0) {
      if (html.charCodeAt(i) !== 60) {
        return { ok: false, code: "top-level-text", at: i };
      }
    } else {
      const lt = html.indexOf("<", i);
      if (lt < 0) {
        return { ok: false, code: "unterminated", at: i };
      }
      if (lt > i) {
        const top = stack[stack.length - 1];
        if (top === "table" || TABLE_PARTS.has(top)) {
          for (let k = i; k < lt; k++) {
            if (!isSpace(html.charCodeAt(k))) {
              return { ok: false, code: "table-structure", at: i };
            }
          }
        }
        i = lt;
      }
    }
    // html[i] === "<"
    const c1 = html.charCodeAt(i + 1);
    if (c1 === 47 /* / */) {
      let j = i + 2;
      const nameStart = j;
      let upper = false;
      while (j < n) {
        const c = html.charCodeAt(j);
        if (c === 62 /* > */ || isSpace(c) || c === 47) {
          break;
        }
        if (c >= 65 && c <= 90) {
          upper = true;
        }
        j++;
      }
      if (upper) {
        return { ok: false, code: "upper-case-tag", at: i };
      }
      const name = html.substring(nameStart, j);
      while (j < n && isSpace(html.charCodeAt(j))) {
        j++;
      }
      if (html.charCodeAt(j) !== 62) {
        return { ok: false, code: "malformed-end-tag", at: i };
      }
      if (stack.length === 0 || stack[stack.length - 1] !== name) {
        return { ok: false, code: "mismatched-end-tag", at: i };
      }
      stack.pop();
      if (name === "p") {
        pDepth--;
      } else if (isHeadingName(name)) {
        hDepth--;
      } else if (name === "a") {
        aDepth--;
      }
      i = j + 1;
      if (stack.length === 0) {
        children.push({ start: curStart, end: i, tag: curTag, attrs: curAttrs, opaque: curOpaque });
      }
      continue;
    }
    if (!isLetter(c1)) {
      return { ok: false, code: c1 === 33 || c1 === 63 ? "comment-or-doctype" : "stray-lt", at: i };
    }
    // start tag
    let j = i + 1;
    let upper = false;
    while (j < n) {
      const c = html.charCodeAt(j);
      if (c === 62 || isSpace(c) || c === 47) {
        break;
      }
      if (c >= 65 && c <= 90) {
        upper = true;
      }
      j++;
    }
    if (upper) {
      return { ok: false, code: "upper-case-tag", at: i };
    }
    const name = html.substring(i + 1, j);
    if (!ALLOWED.has(name)) {
      return { ok: false, code: "tag-not-allowed", at: i };
    }
    // attributes
    let attrs = 0;
    let dataRender = "";
    let selfClose = false;
    let closed = false;
    while (j < n) {
      while (j < n && isSpace(html.charCodeAt(j))) {
        j++;
      }
      const c = html.charCodeAt(j);
      if (c === 62) {
        j++;
        closed = true;
        break;
      }
      if (c === 47) {
        if (html.charCodeAt(j + 1) === 62) {
          selfClose = true;
          j += 2;
          closed = true;
          break;
        }
        j++;
        continue;
      }
      // attribute name
      const as = j;
      while (j < n) {
        const d = html.charCodeAt(j);
        if (isSpace(d) || d === 61 || d === 62 || d === 47) {
          break;
        }
        j++;
      }
      attrs++;
      const isDataRender = name === "pre" && j - as === 11 && html.startsWith("data-render", as);
      while (j < n && isSpace(html.charCodeAt(j))) {
        j++;
      }
      if (html.charCodeAt(j) === 61) {
        j++;
        while (j < n && isSpace(html.charCodeAt(j))) {
          j++;
        }
        const q = html.charCodeAt(j);
        if (q === 34 || q === 39) {
          const close = html.indexOf(q === 34 ? '"' : "'", j + 1);
          if (close < 0) {
            return { ok: false, code: "unterminated-attribute", at: i };
          }
          if (isDataRender) {
            dataRender = html.substring(j + 1, close);
          }
          j = close + 1;
        } else {
          const vs = j;
          while (j < n) {
            const d = html.charCodeAt(j);
            if (isSpace(d) || d === 62) {
              break;
            }
            j++;
          }
          if (isDataRender) {
            dataRender = html.substring(vs, j);
          }
        }
      }
    }
    if (!closed) {
      return { ok: false, code: "unterminated-tag", at: i };
    }
    const isVoid = facts.void.has(name);
    if (selfClose && !isVoid) {
      return { ok: false, code: "self-closing-non-void", at: i };
    }

    // nesting rules
    const top = stack.length > 0 ? stack[stack.length - 1] : "";
    if (pDepth > 0 && facts.closesP.has(name)) {
      return { ok: false, code: "implicit-end-tag", at: i };
    }
    if (name === "li" && top !== "ul" && top !== "ol") {
      return { ok: false, code: "implicit-end-tag", at: i };
    }
    if (isHeadingName(name) && hDepth > 0) {
      return { ok: false, code: "implicit-end-tag", at: i };
    }
    if (name === "a" && aDepth > 0) {
      return { ok: false, code: "implicit-end-tag", at: i };
    }
    if (top === "table" || top === "thead" || top === "tbody" || top === "tfoot" || top === "tr" || top === "colgroup") {
      const okChild = top === "table" ? name === "thead" || name === "tbody" || name === "tfoot" || name === "tr" || name === "caption" || name === "colgroup" : top === "tr" ? name === "th" || name === "td" : top === "colgroup" ? name === "col" : name === "tr";
      if (!okChild) {
        return { ok: false, code: "table-structure", at: i };
      }
    } else if (name === "thead" || name === "tbody" || name === "tfoot" || name === "tr" || name === "colgroup" || name === "col") {
      return { ok: false, code: "table-structure", at: i };
    } else if (name === "th" || name === "td") {
      return { ok: false, code: "table-structure", at: i };
    }
    if (stack.length === 0 && !TOP_LEVEL.has(name)) {
      return { ok: false, code: "top-level-tag", at: i };
    }

    if (stack.length === 0) {
      curStart = i;
      curTag = name;
      curAttrs = attrs;
      curOpaque = false;
    }
    i = j;
    if (name === "pre" && (dataRender === "1" || dataRender === "2")) {
      // Preview of a code, math or HTML block: raw HTML that the engine ignores but its HTML parser still reads.
      // Skip to the first </pre>; the certificate of the parser decides the cut (parser_certificate.ts).
      const close = html.indexOf("</pre>", i);
      if (close < 0) {
        return { ok: false, code: "unterminated-preview", at: i };
      }
      i = close + 6;
      curOpaque = true;
      if (stack.length === 0) {
        children.push({ start: curStart, end: i, tag: curTag, attrs: curAttrs, opaque: curOpaque });
      }
      continue;
    }
    if (isVoid) {
      if (stack.length === 0) {
        children.push({ start: curStart, end: i, tag: curTag, attrs: curAttrs, opaque: curOpaque });
      }
      continue;
    }
    stack.push(name);
    if (name === "p") {
      pDepth++;
    } else if (isHeadingName(name)) {
      hDepth++;
    } else if (name === "a") {
      aDepth++;
    }
  }
  if (stack.length !== 0) {
    return { ok: false, code: "unterminated", at: i };
  }
  if (children.length === 0) {
    return { ok: false, code: "no-children", at: 0 };
  }
  return { ok: true, children };
}
