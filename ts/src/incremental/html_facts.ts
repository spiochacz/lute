// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The HTML facts that the scanner (scanner.ts) needs: which elements have no end tag (void) and which start tags close an open <p>. They are
// not written here as tables. The engine's parser (html/parse.ts, a port of Go's x/net/html) has these rules in its insertion modes, so the
// facts are PROBED: each tag is parsed by the engine's own util.ParseHTML (the same parser and mode that convert a child, no doctype), and the
// result is read from the tree. The probe runs once per process, on the first scan of the cache (lazily; an engine that never uses the cache
// never runs it), and the sets are kept.
//
// This module is not the scanner's policy. The scanner's ALLOWED, TOP_LEVEL and TABLE_PARTS sets are literals in scanner.ts: they say which
// elements the cache accepts, not what HTML means. Table elements cannot be probed in body context (the parser drops thead, tbody, tr, td, th,
// caption, tfoot and colgroup there, and foster-parents their text), so they keep the scanner's explicit table-structure rules. The one table
// fact that is probed is col's void-ness, inside a colgroup, where col is an element of the tree.

import * as util from "../util/index.ts";
import * as html from "../html/index.ts";

export interface HTMLFacts {
  void: ReadonlySet<string>; // the tags of the set that have no end tag (their text is the next sibling)
  closesP: ReadonlySet<string>; // the tags of the set whose start tag closes an open p (the element is a sibling of the p, not its descendant)
}

let cached: HTMLFacts | null = null;

// htmlFacts returns the facts of the tags of the given set (the scanner's ALLOWED set). The first call probes; later calls return the same
// object. The probe is a function of the engine's parser only, so the first set decides which tags are kept, and the scanner passes ALLOWED.
export function htmlFacts(tags: ReadonlySet<string>): HTMLFacts {
  if (cached === null) {
    cached = probe(tags);
  }
  return cached;
}

// probe parses, for each tag, "<TAG>x" (void: the text is a sibling of the element, not its child) and "<p>a<TAG>b" (closesP: the element is
// a sibling of the p, not its descendant). A tag that the parser does not keep in body context (the element is not in the tree) gives no
// answer for either fact; the scanner keeps its own rules for those.
function probe(tags: ReadonlySet<string>): HTMLFacts {
  const voidTags = new Set<string>();
  const closesP = new Set<string>();
  for (const tag of tags) {
    const body = util.ParseHTML(`<${tag}>x`);
    const el = body !== null ? body.FirstChild : null;
    if (el !== null && el.Type === html.ElementNode && el.Data === tag) {
      if (el.FirstChild === null || el.FirstChild.Data !== "x") {
        voidTags.add(tag);
      }
    }
    const para = util.ParseHTML(`<p>a<${tag}>b`);
    if (para !== null) {
      const p = para.FirstChild;
      if (p !== null && p.Data === "p") {
        if (containsElement(p, tag)) {
          // the element is inside the p: it does not close it
        } else if (hasChildElement(para, tag)) {
          closesP.add(tag);
        }
      }
    }
  }
  // col is a table element, so body context drops it; inside a colgroup it is an element, and it has no end tag, so its text is not its child
  const colTable = util.ParseHTML("<table><colgroup><col>x");
  const col = colTable !== null ? findElement(colTable, "col") : null;
  if (col !== null && col.FirstChild === null && tags.has("col")) {
    voidTags.add("col");
  }
  return { void: voidTags, closesP };
}

function findElement(n: html.Node, tag: string): html.Node | null {
  for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
    if (c.Type === html.ElementNode && c.Data === tag) {
      return c;
    }
    const d = findElement(c, tag);
    if (d !== null) {
      return d;
    }
  }
  return null;
}

function containsElement(n: html.Node, tag: string): boolean {
  return findElement(n, tag) !== null;
}

function hasChildElement(n: html.Node, tag: string): boolean {
  for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
    if (c.Type === html.ElementNode && c.Data === tag) {
      return true;
    }
  }
  return false;
}
