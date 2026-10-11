// Ported from render/sanitizer.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as io from "../runtime/io.ts";
import * as strings from "../runtime/strings.ts";
import * as unicode from "../runtime/unicode.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as util from "../util/index.ts";

// No extensible policy is implemented, only unsafe tags and attributes are filtered.
// Thanks to https://github.com/microcosm-cc/bluemonday

const setOfElementsToSkipContent: Map<string, null> = new Map<string, null>([
  ["frame", null],
  ["frameset", null],
  //"iframe":   nil,
  ["noembed", null],
  ["noframes", null],
  ["noscript", null],
  ["nostyle", null],
  ["object", null],
  ["script", null],
  ["style", null],
  ["title", null],
]);

export function Sanitize(str: string): string {
  return conv.StringFromBytes(sanitize(conv.BytesFromString(str)));
}

const spaceCaretBytes: Uint8Array = conv.BytesFromString(" " + editor.Caret);
const caretReplacementBytes: Uint8Array = conv.BytesFromString(editor.CaretReplacement);
const quoteCaretReplacementBytes: Uint8Array = conv.BytesFromString("\"" + editor.CaretReplacement);
const quoteSpaceCaretReplacementBytes: Uint8Array = conv.BytesFromString("\" " + editor.CaretReplacement);

export function sanitize(tokens: Uint8Array): Uint8Array {
  const buff = new bytes.Buffer();
  let skipElementContent = false;
  let skippingElementsCount = 0;
  let mostRecentlyStartedToken = "";

  const caretLeftSpace = bytes.Contains(tokens, spaceCaretBytes);
  tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, caretReplacementBytes);

  // PORT-NOTE: Go passes a bytes.Reader; the TypeScript tokenizer takes the bytes and copies them
  const tokenizer = html.NewTokenizer(tokens);
  for (;;) {
    if (tokenizer.Next() === html.ErrorToken) {
      const err = tokenizer.Err();
      if (err === io.EOF) {
        let ret = buff.Bytes();
        if (caretLeftSpace) {
          ret = bytes.ReplaceAll(ret, quoteCaretReplacementBytes, quoteSpaceCaretReplacementBytes);
        } else {
          ret = bytes.ReplaceAll(ret, quoteSpaceCaretReplacementBytes, quoteCaretReplacementBytes);
        }
        ret = bytes.ReplaceAll(ret, caretReplacementBytes, editor.CaretTokens);
        return ret;
      }

      return util.StrToBytes(err!.message);
    }

    const token = tokenizer.Token();
    switch (token.Type) {
      case html.DoctypeToken:
        break;
      case html.CommentToken:
        break;
      case html.StartTagToken: {
        mostRecentlyStartedToken = token.Data;

        if (setOfElementsToSkipContent.has(token.Data)) {
          skipElementContent = true;
          skippingElementsCount++;
          buff.WriteString(" ");
          break;
        }

        if (token.Attr.length !== 0) {
          token.Attr = sanitizeAttrs(token.Attr);
        }

        if (!skipElementContent) {
          // do not escape multiple query parameters
          if (linkable(token.Data)) {
            writeLinkableBuf(buff, token);
          } else {
            buff.WriteString(token.String());
          }
        }
        break;
      }
      case html.EndTagToken: {
        if (mostRecentlyStartedToken === token.Data) {
          mostRecentlyStartedToken = "";
        }

        if (setOfElementsToSkipContent.has(token.Data)) {
          skippingElementsCount--;
          if (skippingElementsCount === 0) {
            skipElementContent = false;
          }
          buff.WriteString(" ");
          break;
        }

        if (!skipElementContent) {
          buff.WriteString(token.String());
        }
        break;
      }
      case html.SelfClosingTagToken: {
        if (token.Attr.length !== 0) {
          token.Attr = sanitizeAttrs(token.Attr);
        }

        if (!skipElementContent) {
          // do not escape multiple query parameters
          if (linkable(token.Data)) {
            writeLinkableBuf(buff, token);
          } else {
            buff.WriteString(token.String());
          }
        }
        break;
      }
      case html.TextToken: {
        if (!skipElementContent) {
          switch (mostRecentlyStartedToken) {
            case "script":
              // not encouraged, but if a policy allows JavaScript we
              // should not HTML escape it as that would break the output
              buff.WriteString(token.Data);
              break;
            case "style":
              // not encouraged, but if a policy allows CSS styles we
              // should not HTML escape it as that would break the output
              buff.WriteString(token.Data);
              break;
            default:
              // HTML escape the text
              buff.WriteString(token.String());
              break;
          }
        }
        break;
      }
    }
  }
}

export function linkable(elementName: string): boolean {
  switch (elementName) {
    case "a":
    case "area":
    case "blockquote":
    case "img":
    case "link":
    case "script":
      return true;
    default:
      return false;
  }
}

export function writeLinkableBuf(buff: bytes.Buffer, token: html.Token): void {
  // do not escape multiple query parameters
  const tokenBuff = bytes.NewBufferString("");
  tokenBuff.WriteString("<");
  tokenBuff.WriteString(token.Data);
  for (const attr of token.Attr) {
    if (attr.Key === editor.CaretReplacement) {
      tokenBuff.WriteString(" " + editor.CaretReplacement);
      continue;
    }
    tokenBuff.WriteByte(0x20 /* space */);
    tokenBuff.WriteString(attr.Key);
    tokenBuff.WriteString("=\"");
    switch (attr.Key) {
      case "href":
      case "src":
        tokenBuff.WriteString(html.EscapeString(attr.Val));
        break;
      default:
        // re-apply
        tokenBuff.WriteString(html.EscapeString(attr.Val));
        break;
    }
    tokenBuff.WriteByte(0x22 /* " */);
  }
  if (token.Type === html.SelfClosingTagToken) {
    tokenBuff.WriteString(" /");
  }
  tokenBuff.WriteString(">");
  buff.WriteString(tokenBuff.String());
}

// urlAttrs lists the attributes that carry a URL; all of them need the dangerous protocol (javascript: / data:text/html and so on) filter.
// Besides the common src/srcset/href this includes <form action> and the SVG <a xlink:href>,
// otherwise <form action="javascript:..."> and <svg><a xlink:href="javascript:..."> would bypass the filter.
const urlAttrs: Map<string, null> = new Map<string, null>([
  ["src", null],
  ["srcset", null],
  ["href", null],
  ["action", null],
  ["xlink:href", null],
]);

export function sanitizeAttrs(attrs: html.Attribute[]): html.Attribute[] {
  const ret: html.Attribute[] = [];
  for (const attr of attrs) {
    if (!allowAttr(attr.Key)) {
      continue;
    }

    if ("srcdoc" === attr.Key) {
      continue;
    }

    if (urlAttrs.has(attr.Key)) {
      let val = strings.ToLower(strings.TrimSpace(attr.Val));
      val = removeSpace(val);
      if (strings.HasPrefix(val, "data:image/svg+xml") || strings.HasPrefix(val, "data:text/html") || strings.HasPrefix(val, "javascript")) {
        continue;
      }

      const newVal = html.UnescapeAttrVal(conv.StringFromBytes(sanitize(conv.BytesFromString(val))));
      if (val !== newVal) {
        continue;
      }
    }

    ret.push(attr);
  }
  return ret;
}

export function removeSpace(s: string): string {
  const rr: number[] = [];
  for (let i = 0; i < s.length; ) {
    const v = utf8.DecodeRuneInStringPacked(s, i);
    i += v >>> 24;
    const r = v & 0xffffff;
    if (!unicode.IsSpace(r) || 0x20 /* space */ === r) {
      rr.push(r);
    }
  }
  return conv.StringFromRunes(rr);
}

export function allowAttr(attrName: string): boolean {
  if (strings.HasPrefix(strings.ToLower(attrName), "on")) {
    return false;
  }
  for (const name of eventAttrs.keys()) {
    if (attrName === name) {
      return false;
    }
  }
  return true;
}

// eventAttrs contains the dangerous attributes other than event handlers.
// Event handler attributes (starting with "on") are all rejected by allowAttr.
const eventAttrs: Map<string, null> = new Map<string, null>([
  ["http-equiv", null],
  ["formaction", null],
]);
