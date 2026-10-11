// Ported from html/doctype.go @ 8e7896b6
// Copyright 2011 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import * as strings from "../runtime/strings.ts";
import * as utf8 from "../runtime/utf8.ts";
import { DoctypeNode, Node } from "./node.ts";
import { Attribute } from "./token.ts";
import { whitespace } from "./parse.ts";

// parseDoctype parses the data from a DoctypeToken into a name,
// public identifier, and system identifier. It returns a Node whose Type
// is DoctypeNode, whose Data is the name, and which has attributes
// named "system" and "public" for the two identifiers if they were present.
// quirks is whether the document should be parsed in "quirks mode".
export function parseDoctype(s: string): [Node, boolean] {
  let quirks = false;
  const n = new Node();
  n.Type = DoctypeNode;

  // Find the name.
  let space = strings.IndexAny(s, whitespace);
  if (space === -1) {
    space = s.length;
  }
  n.Data = s.slice(0, space);
  // The comparison to "html" is case-sensitive.
  if (n.Data !== "html") {
    quirks = true;
  }
  n.Data = strings.ToLower(n.Data);
  s = strings.TrimLeft(s.slice(space), whitespace);

  if (utf8.ByteLen(s) < 6) {
    // It can't start with "PUBLIC" or "SYSTEM".
    // Ignore the rest of the string.
    return [n, quirks || s !== ""];
  }

  // PORT-NOTE: byte offset. Go slices s at byte 6. Here the slice is at UTF-16 unit 6. The
  // two only differ when the first six bytes hold a non-ASCII character. Then the key is
  // not "public" or "system" in either version, and quirks is set in either version
  // (key != ""), so the result is the same.
  let key = strings.ToLower(s.slice(0, 6));
  s = s.slice(6);
  while (key === "public" || key === "system") {
    s = strings.TrimLeft(s, whitespace);
    if (s === "") {
      break;
    }
    const quote = s.charCodeAt(0);
    if (quote !== 0x22 /* " */ && quote !== 0x27 /* ' */) {
      break;
    }
    s = s.slice(1);
    const q = strings.IndexRune(s, quote);
    let id: string;
    if (q === -1) {
      id = s;
      s = "";
    } else {
      id = s.slice(0, q);
      s = s.slice(q + 1);
    }
    const attr = new Attribute();
    attr.Key = key;
    attr.Val = id;
    n.Attr.push(attr);
    if (key === "public") {
      key = "system";
    } else {
      key = "";
    }
  }

  if (key !== "" || s !== "") {
    quirks = true;
  } else if (n.Attr.length > 0) {
    if (n.Attr[0].Key === "public") {
      // PORT-NOTE: `public` is a reserved word in strict mode, so the local is named pub.
      const pub = strings.ToLower(n.Attr[0].Val);
      switch (pub) {
        case "-//w3o//dtd w3 html strict 3.0//en//":
        case "-/w3d/dtd html 4.0 transitional/en":
        case "html":
          quirks = true;
          break;
        default:
          for (const q of quirkyIDs) {
            if (strings.HasPrefix(pub, q)) {
              quirks = true;
              break;
            }
          }
      }
      // The following two public IDs only cause quirks mode if there is no system ID.
      if (
        n.Attr.length === 1 &&
        (strings.HasPrefix(pub, "-//w3c//dtd html 4.01 frameset//") ||
          strings.HasPrefix(pub, "-//w3c//dtd html 4.01 transitional//"))
      ) {
        quirks = true;
      }
    }
    const lastAttr = n.Attr[n.Attr.length - 1];
    if (
      lastAttr.Key === "system" &&
      strings.ToLower(lastAttr.Val) === "http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd"
    ) {
      quirks = true;
    }
  }

  return [n, quirks];
}

// quirkyIDs is a list of public doctype identifiers that cause a document
// to be interpreted in quirks mode. The identifiers should be in lower case.
const quirkyIDs: string[] = [
  "+//silmaril//dtd html pro v0r11 19970101//",
  "-//advasoft ltd//dtd html 3.0 aswedit + extensions//",
  "-//as//dtd html 3.0 aswedit + extensions//",
  "-//ietf//dtd html 2.0 level 1//",
  "-//ietf//dtd html 2.0 level 2//",
  "-//ietf//dtd html 2.0 strict level 1//",
  "-//ietf//dtd html 2.0 strict level 2//",
  "-//ietf//dtd html 2.0 strict//",
  "-//ietf//dtd html 2.0//",
  "-//ietf//dtd html 2.1e//",
  "-//ietf//dtd html 3.0//",
  "-//ietf//dtd html 3.2 final//",
  "-//ietf//dtd html 3.2//",
  "-//ietf//dtd html 3//",
  "-//ietf//dtd html level 0//",
  "-//ietf//dtd html level 1//",
  "-//ietf//dtd html level 2//",
  "-//ietf//dtd html level 3//",
  "-//ietf//dtd html strict level 0//",
  "-//ietf//dtd html strict level 1//",
  "-//ietf//dtd html strict level 2//",
  "-//ietf//dtd html strict level 3//",
  "-//ietf//dtd html strict//",
  "-//ietf//dtd html//",
  "-//metrius//dtd metrius presentational//",
  "-//microsoft//dtd internet explorer 2.0 html strict//",
  "-//microsoft//dtd internet explorer 2.0 html//",
  "-//microsoft//dtd internet explorer 2.0 tables//",
  "-//microsoft//dtd internet explorer 3.0 html strict//",
  "-//microsoft//dtd internet explorer 3.0 html//",
  "-//microsoft//dtd internet explorer 3.0 tables//",
  "-//netscape comm. corp.//dtd html//",
  "-//netscape comm. corp.//dtd strict html//",
  "-//o'reilly and associates//dtd html 2.0//",
  "-//o'reilly and associates//dtd html extended 1.0//",
  "-//o'reilly and associates//dtd html extended relaxed 1.0//",
  "-//softquad software//dtd hotmetal pro 6.0::19990601::extensions to html 4.0//",
  "-//softquad//dtd hotmetal pro 4.0::19971010::extensions to html 4.0//",
  "-//spyglass//dtd html 2.0 extended//",
  "-//sq//dtd html 2.0 hotmetal + extensions//",
  "-//sun microsystems corp.//dtd hotjava html//",
  "-//sun microsystems corp.//dtd hotjava strict html//",
  "-//w3c//dtd html 3 1995-03-24//",
  "-//w3c//dtd html 3.2 draft//",
  "-//w3c//dtd html 3.2 final//",
  "-//w3c//dtd html 3.2//",
  "-//w3c//dtd html 3.2s draft//",
  "-//w3c//dtd html 4.0 frameset//",
  "-//w3c//dtd html 4.0 transitional//",
  "-//w3c//dtd html experimental 19960712//",
  "-//w3c//dtd html experimental 970421//",
  "-//w3c//dtd w3 html//",
  "-//w3o//dtd w3 html 3.0//",
  "-//webtechs//dtd mozilla html 2.0//",
  "-//webtechs//dtd mozilla html//",
];
