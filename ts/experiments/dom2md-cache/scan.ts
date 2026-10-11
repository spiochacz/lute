// Top-level splitter for Vditor editor HTML (the string handed to VditorDOM2Md / VditorIRDOM2Md).
//
// It cuts the string into the top-level elements without building a DOM, and it refuses (returns a
// bail reason) whenever the cut could differ from what the engine's own HTML parser (html.Parse,
// full-document mode, body content) would produce, or whenever a child cannot be parsed in
// isolation exactly as it is parsed in context. The refusals are conservative:
//
//   - top-level text, comments, doctype, stray or mismatched end tags, unterminated tags;
//   - any tag outside the allow-list below (raw-text and foreign content: script, style, textarea,
//     title, svg, math, template, select, noscript, iframe, ...; and anything unknown);
//   - upper-case tag names, self-closing syntax on a non-void element;
//   - nesting that makes the HTML parser close elements implicitly: a block start tag while a <p> is
//     open, <li> not directly in a list, a heading in a heading, <a> in <a>, anything but the table
//     parts directly in a table, and non-blank text directly in a table, thead, tbody or tr.
//
// Because every accepted child is a balanced element tree whose nesting needs no implied end tags,
// the parser's insertion mode and active formatting elements are the same at the start of every
// child; that is what makes "parse the child alone" equal to "parse the child in context".

export interface Child {
  start: number;
  end: number;
  tag: string;
  attrs: number; // attribute count of the start tag
  dataType: string; // value of the data-type attribute of the start tag ("" if absent)
  opaque: boolean; // contains a skipped data-render preview <pre> (raw HTML that is not validated here)
}

export type Split = { ok: true; children: Child[] } | { ok: false; reason: string; at: number };

const VOID = new Set(["br", "hr", "img", "input", "wbr", "col"]);

// Elements that may occur anywhere inside a child.
const ALLOWED = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
  "blockquote", "pre", "code", "hr", "br", "img", "input", "wbr", "a", "strong", "em", "b", "i", "u", "s",
  "del", "strike", "mark", "sup", "sub", "span", "div", "kbd", "font", "details", "summary", "label", "small", "abbr",
  "ins", "cite", "q", "var", "samp", "figure", "figcaption", "center", "caption", "tfoot", "colgroup", "col",
]);

// Start tags that close an open <p> (HTML parsing: "has a p element in button scope"); a conservative
// superset, so a child that has one of them inside a <p> is refused instead of reasoned about.
const CLOSES_P = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "blockquote", "pre", "div", "hr", "details",
  "summary",
]);

const TABLE_PARTS = new Set(["thead", "tbody", "tfoot", "tr", "colgroup"]);

function isLetter(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}

export function splitTopLevel(html: string): Split {
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
  let curDataType = "";
  let curOpaque = false;

  while (i < n) {
    if (stack.length === 0) {
      if (html.charCodeAt(i) !== 60) {
        return { ok: false, reason: "top-level text", at: i };
      }
    } else {
      const lt = html.indexOf("<", i);
      if (lt < 0) {
        return { ok: false, reason: "unterminated", at: i };
      }
      if (lt > i) {
        const top = stack[stack.length - 1];
        if (top === "table" || TABLE_PARTS.has(top)) {
          for (let k = i; k < lt; k++) {
            if (!isSpace(html.charCodeAt(k))) {
              return { ok: false, reason: "text in table structure", at: i };
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
        return { ok: false, reason: "upper-case tag", at: i };
      }
      const name = html.substring(nameStart, j);
      while (j < n && isSpace(html.charCodeAt(j))) {
        j++;
      }
      if (html.charCodeAt(j) !== 62) {
        return { ok: false, reason: "malformed end tag", at: i };
      }
      if (stack.length === 0 || stack[stack.length - 1] !== name) {
        return { ok: false, reason: "mismatched end tag", at: i };
      }
      stack.pop();
      if (name === "p") {
        pDepth--;
      } else if (name.length === 2 && name.charCodeAt(0) === 104 && name.charCodeAt(1) >= 49 && name.charCodeAt(1) <= 54) {
        hDepth--;
      } else if (name === "a") {
        aDepth--;
      }
      i = j + 1;
      if (stack.length === 0) {
        children.push({ start: curStart, end: i, tag: curTag, attrs: curAttrs, dataType: curDataType, opaque: curOpaque });
      }
      continue;
    }
    if (!isLetter(c1)) {
      return { ok: false, reason: c1 === 33 || c1 === 63 ? "comment or doctype" : "stray <", at: i };
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
      return { ok: false, reason: "upper-case tag", at: i };
    }
    const name = html.substring(i + 1, j);
    if (!ALLOWED.has(name)) {
      return { ok: false, reason: "tag <" + name + ">", at: i };
    }
    // attributes
    let attrs = 0;
    let dataType = "";
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
      let isDataType = false;
      let isDataRender = false;
      if (stack.length === 0 && j - as === 9 && html.startsWith("data-type", as)) {
        isDataType = true;
      } else if (name === "pre" && j - as === 11 && html.startsWith("data-render", as)) {
        isDataRender = true;
      }
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
            return { ok: false, reason: "unterminated attribute", at: i };
          }
          if (isDataType) {
            dataType = html.substring(j + 1, close);
          } else if (isDataRender) {
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
          if (isDataType) {
            dataType = html.substring(vs, j);
          } else if (isDataRender) {
            dataRender = html.substring(vs, j);
          }
        }
      }
    }
    if (!closed) {
      return { ok: false, reason: "unterminated tag", at: i };
    }
    const isVoid = VOID.has(name);
    if (selfClose && !isVoid) {
      return { ok: false, reason: "self-closing non-void <" + name + ">", at: i };
    }

    // nesting rules
    const top = stack.length > 0 ? stack[stack.length - 1] : "";
    if (pDepth > 0 && CLOSES_P.has(name)) {
      return { ok: false, reason: "block start tag inside <p>", at: i };
    }
    if (name === "li" && top !== "ul" && top !== "ol") {
      return { ok: false, reason: "<li> outside a list", at: i };
    }
    if (name.length === 2 && name.charCodeAt(0) === 104 && name.charCodeAt(1) >= 49 && name.charCodeAt(1) <= 54 && hDepth > 0) {
      return { ok: false, reason: "heading in heading", at: i };
    }
    if (name === "a" && aDepth > 0) {
      return { ok: false, reason: "<a> in <a>", at: i };
    }
    if (top === "table" || top === "thead" || top === "tbody" || top === "tfoot" || top === "tr" || top === "colgroup") {
      const okChild = top === "table" ? name === "thead" || name === "tbody" || name === "tfoot" || name === "tr" || name === "caption" || name === "colgroup" : top === "tr" ? name === "th" || name === "td" : top === "colgroup" ? name === "col" : name === "tr";
      if (!okChild) {
        return { ok: false, reason: "element in table structure", at: i };
      }
    } else if (name === "thead" || name === "tbody" || name === "tfoot" || name === "tr" || name === "colgroup" || name === "col") {
      return { ok: false, reason: "table part outside table", at: i };
    } else if (name === "th" || name === "td") {
      return { ok: false, reason: "cell outside row", at: i };
    }

    if (stack.length === 0) {
      curStart = i;
      curTag = name;
      curAttrs = attrs;
      curDataType = dataType;
      curOpaque = false;
    }
    i = j;
    if (name === "pre" && (dataRender === "1" || dataRender === "2")) {
      // Preview of a code, math or HTML block: raw HTML that the engine ignores but its HTML parser still
      // reads. Skip to the first </pre>; the cache verifies the cut with the engine's parser (cached.ts).
      const close = html.indexOf("</pre>", i);
      if (close < 0) {
        return { ok: false, reason: "unterminated preview", at: i };
      }
      i = close + 6;
      curOpaque = true;
      if (stack.length === 0) {
        children.push({ start: curStart, end: i, tag: curTag, attrs: curAttrs, dataType: curDataType, opaque: curOpaque });
      }
      continue;
    }
    if (isVoid) {
      if (stack.length === 0) {
        children.push({ start: curStart, end: i, tag: curTag, attrs: curAttrs, dataType: curDataType, opaque: curOpaque });
      }
      continue;
    }
    stack.push(name);
    if (name === "p") {
      pDepth++;
    } else if (name.length === 2 && name.charCodeAt(0) === 104 && name.charCodeAt(1) >= 49 && name.charCodeAt(1) <= 54) {
      hDepth++;
    } else if (name === "a") {
      aDepth++;
    }
  }
  if (stack.length !== 0) {
    return { ok: false, reason: "unterminated", at: i };
  }
  return { ok: true, children };
}
