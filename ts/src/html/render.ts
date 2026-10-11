// Ported from html/render.go @ 8e7896b6
// Copyright 2011 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import * as bytes from "../runtime/bytes.ts";
import * as strings from "../runtime/strings.ts";
import { escape } from "./escape.ts";
import {
  CommentNode,
  DocumentNode,
  DoctypeNode,
  ElementNode,
  ErrorNode,
  Node,
  TextNode,
} from "./node.ts";

// Render renders the parse tree n to the given writer.
//
// Rendering is done on a 'best effort' basis: calling Parse on the output of
// Render will always result in something similar to the original tree, but it
// is not necessarily an exact clone unless the original tree was 'well-formed'.
// 'Well-formed' is not easily specified; the HTML5 specification is
// complicated.
//
// Calling Parse on arbitrary input typically results in a 'well-formed' parse
// tree. However, it is possible for Parse to yield a 'badly-formed' parse tree.
// For example, in a 'well-formed' parse tree, no <a> element is a child of
// another <a> element: parsing "<a><a>" results in two sibling elements.
// Similarly, in a 'well-formed' parse tree, no <a> element is a child of a
// <table> element: parsing "<p><table><a>" results in a <p> with two sibling
// children; the <a> is reparented to the <table>'s parent. However, calling
// Parse on "<a><table><a>" does not return an error, but the result has an <a>
// element with an <a> child, and is therefore not 'well-formed'.
//
// Programmatically constructed trees are typically also 'well-formed', but it
// is possible to construct a tree that looks innocuous but, when rendered and
// re-parsed, results in a different tree. A simple example is that a solitary
// text node would become a tree containing <html>, <head> and <body> elements.
// Another example is that the programmatic equivalent of "a<head>b</head>c"
// becomes "<html><head><head/><body>abc</body></html>".
//
// PORT-NOTE: Go's Render takes an io.Writer and wraps it in a bufio.Writer when it is not
// the internal writer interface. Here w is a bytes.Buffer, which never fails, so the
// wrapping and the Flush are not needed. The write calls in render1 and writeQuoted do not
// return errors either, because a bytes.Buffer write cannot fail. The errors that Go
// returns from the tree itself (ErrorNode, unknown node type, void element with children)
// are kept.
export function Render(w: bytes.Buffer, n: Node): Error | null {
  return render(w, n);
}

// plaintextAbort is returned from render1 when a <plaintext> element
// has been rendered. No more end tags should be rendered after that.
const plaintextAbort = new Error("html: internal error (plaintext abort)");

function render(w: bytes.Buffer, n: Node): Error | null {
  let err = render1(w, n);
  if (err === plaintextAbort) {
    err = null;
  }
  return err;
}

function render1(w: bytes.Buffer, n: Node): Error | null {
  // Render non-element nodes; these are the easy cases.
  switch (n.Type) {
    case ErrorNode:
      return new Error("html: cannot render an ErrorNode node");
    case TextNode:
      return escape(w, n.Data);
    case DocumentNode:
      for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
        const err = render1(w, c);
        if (err !== null) {
          return err;
        }
      }
      return null;
    case ElementNode:
      // No-op.
      break;
    case CommentNode:
      w.WriteString("<!--");
      w.WriteString(n.Data);
      w.WriteString("-->");
      return null;
    case DoctypeNode: {
      w.WriteString("<!DOCTYPE ");
      w.WriteString(n.Data);
      // PORT-NOTE: Go tests n.Attr != nil first. With no attributes the loop below sets
      // nothing and writes nothing, so the test is left out.
      let p = "";
      let s = "";
      for (const a of n.Attr) {
        switch (a.Key) {
          case "public":
            p = a.Val;
            break;
          case "system":
            s = a.Val;
            break;
        }
      }
      if (p !== "") {
        w.WriteString(" PUBLIC ");
        writeQuoted(w, p);
        if (s !== "") {
          w.WriteByte(0x20); // ' '
          writeQuoted(w, s);
        }
      } else if (s !== "") {
        w.WriteString(" SYSTEM ");
        writeQuoted(w, s);
      }
      w.WriteByte(0x3e); // '>'
      return null;
    }
    default:
      return new Error("html: unknown node type");
  }

  // Render the <xxx> opening tag.
  w.WriteByte(0x3c); // '<'
  w.WriteString(n.Data);
  for (const a of n.Attr) {
    w.WriteByte(0x20); // ' '
    if (a.Namespace !== "") {
      w.WriteString(a.Namespace);
      w.WriteByte(0x3a); // ':'
    }
    w.WriteString(a.Key);
    w.WriteString('="');
    const err = escape(w, a.Val);
    if (err !== null) {
      return err;
    }
    w.WriteByte(0x22); // '"'
  }
  if (voidElements.get(n.Data) === true) {
    if (n.FirstChild !== null) {
      return new Error("html: void element <" + n.Data + " has child nodes");
    }
    w.WriteString("/>");
    return null;
  }
  w.WriteByte(0x3e); // '>'

  // Add initial newline where there is danger of a newline beging ignored.
  {
    const c = n.FirstChild;
    if (c !== null && c.Type === TextNode && strings.HasPrefix(c.Data, "\n")) {
      switch (n.Data) {
        case "pre":
        case "listing":
        case "textarea":
          w.WriteByte(0x0a); // '\n'
          break;
      }
    }
  }

  // Render any child nodes.
  switch (n.Data) {
    case "iframe":
    case "noembed":
    case "noframes":
    case "noscript":
    case "plaintext":
    case "script":
    case "style":
    case "xmp":
      for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
        if (c.Type === TextNode) {
          w.WriteString(c.Data);
        } else {
          const err = render1(w, c);
          if (err !== null) {
            return err;
          }
        }
      }
      if (n.Data === "plaintext") {
        // Don't render anything else. <plaintext> must be the
        // last element in the file, with no closing tag.
        return plaintextAbort;
      }
      break;
    default:
      for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
        const err = render1(w, c);
        if (err !== null) {
          return err;
        }
      }
  }

  // Render the </xxx> closing tag.
  w.WriteString("</");
  w.WriteString(n.Data);
  w.WriteByte(0x3e); // '>'
  return null;
}

// writeQuoted writes s to w surrounded by quotes. Normally it will use double
// quotes, but if s contains a double quote, it will use single quotes.
// It is used for writing the identifiers in a doctype declaration.
// In valid HTML, they can't contain both types of quotes.
function writeQuoted(w: bytes.Buffer, s: string): void {
  let q = 0x22; // '"'
  if (strings.Contains(s, '"')) {
    q = 0x27; // '\''
  }
  w.WriteByte(q);
  w.WriteString(s);
  w.WriteByte(q);
}

// Section 12.1.2, "Elements", gives this list of void elements. Void elements
// are those that can't have any contents.
const voidElements: Map<string, boolean> = new Map<string, boolean>([
  ["area", true],
  ["base", true],
  ["br", true],
  ["col", true],
  ["command", true],
  ["embed", true],
  ["hr", true],
  ["img", true],
  ["input", true],
  ["keygen", true],
  ["link", true],
  ["meta", true],
  ["param", true],
  ["source", true],
  ["track", true],
  ["wbr", true],
]);
