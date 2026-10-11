// Ported from parse/inline_html.go @ 8e7896b6
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
import * as slices from "../runtime/slices.ts";
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as atom from "../html/atom/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { IAL2Tokens, Tokens2IAL } from "./inline_attribute_list.ts";
import { Inline } from "./parse.ts";
import type { InlineContext, Options } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseInlineHTML(ctx: InlineContext): ast.Node | null;
    replaceCreateTokens(tokens: Uint8Array, caretInTag: boolean, caretLeftSpace: boolean): Uint8Array;
    processSpanTag(tags: Uint8Array, startTag: string, endTag: string, ctx: InlineContext): ast.Node | null;
    parseCDATA(tokens: Uint8Array): [boolean, Uint8Array, Uint8Array];
    parseDeclaration(tokens: Uint8Array): [boolean, Uint8Array, Uint8Array];
    parseProcessingInstruction(tokens: Uint8Array): [boolean, Uint8Array, Uint8Array];
    parseHTMLComment(tokens: Uint8Array): [boolean, Uint8Array, Uint8Array];
    parseTagName(tokens: Uint8Array): [Uint8Array, Uint8Array];
  }
}

const emptyBytes: Uint8Array = new Uint8Array(0);

const spaceCaretBytes: Uint8Array = conv.BytesFromString(" " + editor.Caret);
const caretReplacementBytes: Uint8Array = conv.BytesFromString(editor.CaretReplacement);
const quoteCaretReplacementBytes: Uint8Array = conv.BytesFromString("\"" + editor.CaretReplacement);
const quoteSpaceCaretReplacementBytes: Uint8Array = conv.BytesFromString("\" " + editor.CaretReplacement);
const caretReplacementSpaceBytes: Uint8Array = conv.BytesFromString(editor.CaretReplacement + " ");

const brSpaceSlashTag: Uint8Array = conv.BytesFromString("<br />");
const brSlashTag: Uint8Array = conv.BytesFromString("<br/>");
const brTag: Uint8Array = conv.BytesFromString("<br>");
const spanDataTypeEqualsTag: Uint8Array = conv.BytesFromString("<span data-type=");
const kbdTag: Uint8Array = conv.BytesFromString("<kbd>");
const uTag: Uint8Array = conv.BytesFromString("<u>");
const supTag: Uint8Array = conv.BytesFromString("<sup>");
const subTag: Uint8Array = conv.BytesFromString("<sub>");
const markTag: Uint8Array = conv.BytesFromString("<mark>");
const sTag: Uint8Array = conv.BytesFromString("<s>");
const delTag: Uint8Array = conv.BytesFromString("<del>");
const strikeTag: Uint8Array = conv.BytesFromString("<strike>");
const emTag: Uint8Array = conv.BytesFromString("<em>");
const iTag: Uint8Array = conv.BytesFromString("<i>");
const strongTag: Uint8Array = conv.BytesFromString("<strong>");
const bTag: Uint8Array = conv.BytesFromString("<b>");
const imgSpaceTag: Uint8Array = conv.BytesFromString("<img ");

Tree.prototype.parseInlineHTML = function (this: Tree, ctx: InlineContext): ast.Node | null {
  const t = this;
  let tokens: Uint8Array = ctx.tokens;
  let caretInTag = false;
  let caretLeftSpace = false;
  if (t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) {
    const caretIndex = bytes.Index(tokens, editor.CaretTokens);
    caretInTag = caretIndex > ctx.pos;
    if (caretInTag) {
      caretLeftSpace = bytes.Contains(tokens, spaceCaretBytes);
      tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, caretReplacementBytes);
      tokens = bytes.ReplaceAll(tokens, quoteCaretReplacementBytes, quoteSpaceCaretReplacementBytes);
    }
  }

  const startPos = ctx.pos;
  let ret: ast.Node | null = new ast.Node(ast.NodeText, Uint8Array.of(tokens[ctx.pos]));
  if (3 > ctx.tokensLen || ctx.tokensLen <= startPos + 1) {
    ctx.pos++;
    return ret;
  }

  let tags: Uint8Array = emptyBytes;
  tags = slices.AppendByte(tags, tokens[startPos]);
  if (lex.ItemSlash === tokens[startPos + 1] && 1 < ctx.tokensLen - (startPos + 1)) { // a closing tag
    tags = slices.AppendByte(tags, tokens[startPos + 1]);
    const [remains, tagName] = t.parseTagName(tokens.subarray(ctx.pos + 2));
    if (1 > tagName.length) {
      ctx.pos++;
      return ret;
    }
    tags = slices.Append(tags, tagName);
    tokens = remains;
  } else {
    const [remains, tagName] = t.parseTagName(tokens.subarray(ctx.pos + 1));
    if (0 < tagName.length) {
      tags = slices.Append(tags, tagName);
      tokens = remains;
      for (;;) {
        const [valid, remains, attr] = TagAttr(tokens);
        if (!valid) {
          ctx.pos++;
          return ret;
        }

        tokens = remains;
        tags = slices.Append(tags, attr);
        if (1 > attr.length) {
          break;
        }
      }
    } else {
      const [valid, remains, comment] = t.parseHTMLComment(tokens.subarray(ctx.pos + 1));
      if (valid) {
        tags = slices.Append(tags, comment);
        tags = t.replaceCreateTokens(tags, caretInTag, caretLeftSpace);
        tokens = remains;
        ctx.pos += tags.length;
        ret = new ast.Node(ast.NodeInlineHTML, tags);
        return ret;
      } else {
        const [valid, remains, ins] = t.parseProcessingInstruction(tokens.subarray(ctx.pos + 1));
        if (valid) {
          tags = slices.Append(tags, ins);
          tags = t.replaceCreateTokens(tags, caretInTag, caretLeftSpace);
          tokens = remains;
          ctx.pos += tags.length;
          ret = new ast.Node(ast.NodeInlineHTML, tags);
          return ret;
        } else {
          const [valid, remains, decl] = t.parseDeclaration(tokens.subarray(ctx.pos + 1));
          if (valid) {
            tags = slices.Append(tags, decl);
            tags = t.replaceCreateTokens(tags, caretInTag, caretLeftSpace);
            tokens = remains;
            ctx.pos += tags.length;
            ret = new ast.Node(ast.NodeInlineHTML, tags);
            return ret;
          } else {
            const [valid, remains, cdata] = t.parseCDATA(tokens.subarray(ctx.pos + 1));
            if (valid) {
              tags = slices.Append(tags, cdata);
              tags = t.replaceCreateTokens(tags, caretInTag, caretLeftSpace);
              tokens = remains;
              ctx.pos += tags.length;
              ret = new ast.Node(ast.NodeInlineHTML, tags);
              return ret;
            } else {
              ctx.pos++;
              return ret;
            }
          }
        }
      }
    }
  }

  let whitespaces: Uint8Array | null = null;
  [whitespaces, tokens] = lex.TrimLeft(tokens);
  const length = tokens.length;
  if (1 > length) {
    ctx.pos = startPos + 1;
    return ret;
  }

  if ((lex.ItemGreater === tokens[0]) ||
    (1 < length && lex.ItemSlash === tokens[0] && lex.ItemGreater === tokens[1])) {
    tags = slices.Append(tags, whitespaces ?? emptyBytes);
    tags = slices.AppendByte(tags, tokens[0]);
    if (lex.ItemSlash === tokens[0]) {
      tags = slices.AppendByte(tags, tokens[1]);
    }
    tags = t.replaceCreateTokens(tags, caretInTag, caretLeftSpace);
    ctx.pos += tags.length;

    if (t.Context!.ParseOption.ProtyleWYSIWYG) {
      if (bytes.EqualFold(tags, brSpaceSlashTag) || bytes.EqualFold(tags, brSlashTag) || bytes.EqualFold(tags, brTag)) {
        ret = new ast.Node(ast.NodeBr);
        return ret;
      } else if (bytes.HasPrefix(tags, spanDataTypeEqualsTag)) {
        ret = t.processSpanTag(tags, "<span data-type=", "</span>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, kbdTag)) {
        ret = t.processSpanTag(tags, "<kbd>", "</kbd>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, uTag)) {
        ret = t.processSpanTag(tags, "<u>", "</u>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, supTag)) {
        ret = t.processSpanTag(tags, "<sup>", "</sup>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, subTag)) {
        ret = t.processSpanTag(tags, "<sub>", "</sub>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, markTag)) {
        ret = t.processSpanTag(tags, "<mark>", "</mark>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, sTag)) {
        ret = t.processSpanTag(tags, "<s>", "</s>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, delTag)) {
        ret = t.processSpanTag(tags, "<del>", "</del>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, strikeTag)) {
        ret = t.processSpanTag(tags, "<strike>", "</strike>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, emTag)) {
        ret = t.processSpanTag(tags, "<em>", "</em>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, iTag)) {
        ret = t.processSpanTag(tags, "<i>", "</i>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, strongTag)) {
        ret = t.processSpanTag(tags, "<strong>", "</strong>", ctx);
        return ret;
      } else if (bytes.EqualFold(tags, bTag)) {
        ret = t.processSpanTag(tags, "<b>", "</b>", ctx);
        return ret;
      } else if (bytes.HasPrefix(bytes.ToLower(tags), imgSpaceTag)) {
        const contextNode = new html.Node();
        contextNode.Type = html.ElementNode;
        const [nodes] = html.ParseFragment(tags, contextNode);
        if (1 !== nodes.length) {
          ret = new ast.Node(ast.NodeInlineHTML, tags);
          return ret;
        }
        const node = nodes[0];

        if (atom.Img === node.DataAtom) {
          ret = new ast.Node(ast.NodeImage);
          ret.AppendChild(new ast.Node(ast.NodeBang));
          ret.AppendChild(new ast.Node(ast.NodeOpenBracket));
          const text = util.DomAttrValue(node, "alt");
          if ("" !== text) {
            ret.AppendChild(new ast.Node(ast.NodeLinkText, conv.BytesFromString(text)));
          }
          ret.AppendChild(new ast.Node(ast.NodeCloseBracket));
          ret.AppendChild(new ast.Node(ast.NodeOpenParen));
          const src = util.DomAttrValue(node, "src");
          if ("" !== src) {
            ret.AppendChild(new ast.Node(ast.NodeLinkDest, conv.BytesFromString(src)));
          }
          const title = util.DomAttrValue(node, "title");
          if ("" !== title) {
            ret.AppendChild(new ast.Node(ast.NodeLinkTitle, conv.BytesFromString(title)));
          }
          ret.AppendChild(new ast.Node(ast.NodeCloseParen));
          let width = strings.TrimSpace(util.DomAttrValue(node, "width"));
          if ("" !== width) {
            if (util.IsDigit(width)) {
              width += "px";
            }
            const style = "width: " + width + ";";
            const ial = new ast.Node(ast.NodeKramdownSpanIAL, IAL2Tokens([["style", style]]));
            ret.SetIALAttr("style", style);
            ret.InsertAfter(ial);
          } else {
            let height = strings.TrimSpace(util.DomAttrValue(node, "height"));
            if ("" !== height) {
              if (util.IsDigit(height)) {
                height += "px";
              }
              const style = "height: " + height + ";";
              const ial = new ast.Node(ast.NodeKramdownSpanIAL, IAL2Tokens([["style", style]]));
              ret.SetIALAttr("style", style);
              ret.InsertAfter(ial);
            }
          }

          return ret;
        }
        ret = new ast.Node(ast.NodeInlineHTML, tags);
      }
    }
    ret = new ast.Node(ast.NodeInlineHTML, tags);
    return ret;
  }

  ctx.pos = startPos + 1;
  return ret;
};

Tree.prototype.replaceCreateTokens = function (this: Tree, tokens: Uint8Array, caretInTag: boolean, caretLeftSpace: boolean): Uint8Array {
  const t = this;
  if ((t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV) && caretInTag || t.Context!.ParseOption.ProtyleWYSIWYG) {
    if (!bytes.Contains(tokens, caretReplacementSpaceBytes) && !caretLeftSpace) {
      tokens = bytes.ReplaceAll(tokens, quoteSpaceCaretReplacementBytes, quoteCaretReplacementBytes);
    }
    tokens = bytes.ReplaceAll(tokens, caretReplacementBytes, editor.CaretTokens);
  }
  return tokens;
};

Tree.prototype.processSpanTag = function (this: Tree, tags: Uint8Array, startTag: string, endTag: string, ctx: InlineContext): ast.Node | null {
  const t = this;
  let ret: ast.Node | null = null;
  const remains: Uint8Array = ctx.tokens.subarray(ctx.pos);
  if (1 > remains.length) {
    return ret;
  }

  const endTagBytes = conv.BytesFromString(endTag);
  const startTagBytes = conv.BytesFromString(startTag);
  const end = bytes.Index(remains, endTagBytes);
  const innerStartTagIndex = bytes.Index(remains, startTagBytes);
  if ((bytes.Contains(remains, startTagBytes) && -1 < end && innerStartTagIndex < end) || -1 === end) {
    ret = new ast.Node(ast.NodeInlineHTML, tags);
    return ret;
  }

  const closerLen = endTag.length;
  let endTmp = end + closerLen;
  if (remains.length < endTmp) {
    endTmp = remains.length;
  }
  // PORT-NOTE: aliasing as in Go: tags may have spare capacity, so this append can write into the buffer of tags
  const tokens: Uint8Array = slices.Append(tags, remains.subarray(0, endTmp));
  const contextNode = new html.Node();
  contextNode.Type = html.ElementNode;
  const [nodes] = html.ParseFragment(tokens, contextNode);
  if (1 !== nodes.length) {
    return ret;
  }
  const node = nodes[0];

  let typ = "";
  const startTagLen = startTag.length;
  if ("<kbd>" === startTag || "<u>" === startTag || "<sup>" === startTag || "<sub>" === startTag || "<mark>" === startTag || "<s>" === startTag || "<del>" === startTag || "<strike>" === startTag || "<em>" === startTag || "<i>" === startTag || "<strong>" === startTag || "<b>" === startTag) {
    if (!t.Context!.ParseOption.HTMLTag2TextMark) {
      ret = new ast.Node(ast.NodeInlineHTML, tags);
      return ret;
    }
    typ = node.Data;
    if ("b" === typ) {
      typ = "strong";
    } else if ("i" === typ) {
      typ = "em";
    } else if ("del" === typ || "strike" === typ) {
      typ = "s";
    }
  } else { // <span data-type="a">
    // PORT-NOTE: byte offset. tags is ASCII up to startTagLen+1 (it starts with "<span data-type="), the rest is converted to a string before it is sliced
    typ = conv.StringFromBytes(tags.subarray(startTagLen + 1));
    // UPSTREAM-BUG: Go panics (slice bounds out of range [:-1]) when the attribute value has no double quote, for example "<span data-type=ab>x</span>" with ProtyleWYSIWYG
    const quoteIndex = strings.Index(typ, "\"");
    if (0 > quoteIndex) {
      // PORT-NOTE: Go panics here
      throw new Error("slice bounds out of range [:-1]");
    }
    typ = typ.slice(0, quoteIndex);
  }

  ret = new ast.Node(ast.NodeTextMark);
  ret.TextMarkType = typ;

  if (null !== node.FirstChild && typ !== node.FirstChild.Data && html.ElementNode === node.FirstChild.Type &&
    util.ContainsStr(node.FirstChild.Data, ["sup", "sub", "em", "strong"])) {
    ret.TextMarkType += " " + node.FirstChild.Data;
  }

  SetTextMarkNode(ret, node, t.Context!.ParseOption);
  ctx.pos += end + closerLen;
  return ret;
};

const cdataOpen: Uint8Array = conv.BytesFromString("![CDATA[");

Tree.prototype.parseCDATA = function (this: Tree, tokens: Uint8Array): [boolean, Uint8Array, Uint8Array] {
  let valid = false;
  let remains: Uint8Array = emptyBytes;
  let content: Uint8Array = emptyBytes;
  remains = tokens;
  if (8 > tokens.length) {
    return [valid, remains, content];
  }
  if (lex.ItemBang !== tokens[0]) {
    return [valid, remains, content];
  }
  if (lex.ItemOpenBracket !== tokens[1]) {
    return [valid, remains, content];
  }

  if (0x43 /* C */ !== tokens[2] || 0x44 /* D */ !== tokens[3] || 0x41 /* A */ !== tokens[4] || 0x54 /* T */ !== tokens[5] || 0x41 /* A */ !== tokens[6]) {
    return [valid, remains, content];
  }
  if (lex.ItemOpenBracket !== tokens[7]) {
    return [valid, remains, content];
  }

  content = slices.Append(content, tokens.subarray(0, 7));
  tokens = tokens.subarray(7);
  let token = 0;
  let i = 0;
  const length = tokens.length;
  for (; i < length; i++) {
    token = tokens[i];
    content = slices.AppendByte(content, token);
    if (i <= length - 3 && lex.ItemCloseBracket === token && lex.ItemCloseBracket === tokens[i + 1] && lex.ItemGreater === tokens[i + 2]) {
      break;
    }
  }
  tokens = tokens.subarray(i);
  if (3 > tokens.length) {
    return [valid, remains, content];
  }
  if (lex.ItemCloseBracket !== tokens[0] || lex.ItemCloseBracket !== tokens[1] || lex.ItemGreater !== tokens[2]) {
    return [valid, remains, content];
  }
  content = slices.AppendByte(content, tokens[1]);
  content = slices.AppendByte(content, tokens[2]);
  valid = true;
  remains = tokens.subarray(3);
  return [valid, remains, content];
};

Tree.prototype.parseDeclaration = function (this: Tree, tokens: Uint8Array): [boolean, Uint8Array, Uint8Array] {
  let valid = false;
  let remains: Uint8Array = emptyBytes;
  let content: Uint8Array = emptyBytes;
  remains = tokens;
  if (2 > tokens.length) {
    return [valid, remains, content];
  }

  if (lex.ItemBang !== tokens[0]) {
    return [valid, remains, content];
  }

  let token = 0;
  let i = 0;
  const rest: Uint8Array = tokens.subarray(1);
  for (let n = 0; n < rest.length; n++) {
    token = rest[n];
    if (lex.IsWhitespace(token)) {
      break;
    }
    if (!(0x41 /* A */ <= token && 0x5a /* Z */ >= token)) {
      return [valid, remains, content];
    }
  }

  content = slices.AppendByte(content, tokens[0]);
  content = slices.AppendByte(content, tokens[1]);
  tokens = tokens.subarray(2);
  const length = tokens.length;
  for (; i < length; i++) {
    token = tokens[i];
    content = slices.AppendByte(content, token);
    if (lex.ItemGreater === token) {
      break;
    }
  }
  tokens = tokens.subarray(i);
  if (1 > tokens.length || lex.ItemGreater !== tokens[0]) {
    return [valid, remains, content];
  }
  valid = true;
  remains = tokens.subarray(1);
  return [valid, remains, content];
};

Tree.prototype.parseProcessingInstruction = function (this: Tree, tokens: Uint8Array): [boolean, Uint8Array, Uint8Array] {
  let valid = false;
  let remains: Uint8Array = emptyBytes;
  let content: Uint8Array = emptyBytes;
  remains = tokens;
  if (1 > tokens.length) {
    // PORT-NOTE: Go panics here (index out of range [0] with length 0); parseInlineHTML never passes an empty slice
    throw new Error("index out of range [0] with length 0");
  }
  if (lex.ItemQuestion !== tokens[0]) {
    return [valid, remains, content];
  }

  content = slices.AppendByte(content, tokens[0]);
  tokens = tokens.subarray(1);
  let token = 0;
  let i = 0;
  const length = tokens.length;
  for (; i < length; i++) {
    token = tokens[i];
    content = slices.AppendByte(content, token);
    if (i <= length - 2 && lex.ItemQuestion === token && lex.ItemGreater === tokens[i + 1]) {
      break;
    }
  }
  tokens = tokens.subarray(i);
  if (1 > tokens.length) {
    return [valid, remains, content];
  }

  if (lex.ItemQuestion !== tokens[0] || lex.ItemGreater !== tokens[1]) {
    return [valid, remains, content];
  }
  content = slices.AppendByte(content, tokens[1]);
  valid = true;
  remains = tokens.subarray(2);
  return [valid, remains, content];
};

Tree.prototype.parseHTMLComment = function (this: Tree, tokens: Uint8Array): [boolean, Uint8Array, Uint8Array] {
  let valid = false;
  let remains: Uint8Array = emptyBytes;
  let comment: Uint8Array = emptyBytes;
  remains = tokens;
  if (3 > tokens.length) {
    return [valid, remains, comment];
  }

  if (lex.ItemBang !== tokens[0] || lex.ItemHyphen !== tokens[1] || lex.ItemHyphen !== tokens[2]) {
    return [valid, remains, comment];
  }

  const length = tokens.length;
  let i = 0;
  for (; i < length; i++) {
    comment = slices.AppendByte(comment, tokens[i]);
    if (i <= length - 3 && lex.ItemHyphen === tokens[i] && lex.ItemHyphen === tokens[i + 1] && lex.ItemGreater === tokens[i + 2]) {
      break;
    }
  }
  tokens = tokens.subarray(i);
  if (3 > tokens.length || lex.ItemHyphen !== tokens[0] || lex.ItemHyphen !== tokens[1] || lex.ItemGreater !== tokens[2]) {
    return [valid, remains, comment];
  }
  comment = slices.AppendByte(comment, tokens[1]);
  comment = slices.AppendByte(comment, tokens[2]);
  valid = true;
  remains = tokens.subarray(3);
  return [valid, remains, comment];
};

// PORT-NOTE: Go returns name and val as nil unless the attribute has a value; no caller tells nil from empty, so they are empty arrays here.
export function TagAttr(tokens: Uint8Array): [boolean, Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  let valid = true;
  let remains: Uint8Array = emptyBytes;
  let attr: Uint8Array = emptyBytes;
  let name: Uint8Array = emptyBytes;
  let val: Uint8Array = emptyBytes;
  remains = tokens;
  let whitespaces: Uint8Array = emptyBytes;
  let i = 0;
  let token = 0;
  // PORT-NOTE: Go's "for i, token = range tokens" leaves i at the last index when the loop ends without break, which the loops below reproduce
  for (let n = 0; n < tokens.length; n++) {
    i = n;
    token = tokens[n];
    if (!lex.IsWhitespace(token)) {
      break;
    }
    whitespaces = slices.AppendByte(whitespaces, token);
  }
  if (1 > whitespaces.length) {
    return [valid, remains, attr, name, val];
  }
  tokens = tokens.subarray(i);

  let attrName: Uint8Array = emptyBytes;
  [tokens, attrName] = parseAttrName(tokens);
  if (1 > attrName.length) {
    return [valid, remains, attr, name, val];
  }

  let valSpec: Uint8Array | null = null;
  [valid, tokens, valSpec] = parseAttrValSpec(tokens);
  if (!valid) {
    return [valid, remains, attr, name, val];
  }

  remains = tokens;
  attr = slices.Append(attr, whitespaces);
  attr = slices.Append(attr, attrName);
  attr = slices.Append(attr, valSpec ?? emptyBytes);
  if (null !== valSpec) {
    name = attrName;
    // UPSTREAM-BUG: for an unquoted value valSpec has no quote characters, so [2:len-1] drops the first and the last byte of the value (Go: TagAttr(" a=xy>") gives val ""; " a=bc d=ef" gives val "c")
    val = valSpec.subarray(2, valSpec.length - 1);
  }
  return [valid, remains, attr, name, val];
}

// PORT-NOTE: exported for the vector tests; Go keeps it unexported
export function parseAttrValSpec(tokens: Uint8Array): [boolean, Uint8Array, Uint8Array | null] {
  let valid = true;
  let remains: Uint8Array = emptyBytes;
  let valSpec: Uint8Array | null = null;
  remains = tokens;
  let i = 0;
  let token = 0;
  for (let n = 0; n < tokens.length; n++) {
    i = n;
    token = tokens[n];
    if (!lex.IsWhitespace(token)) {
      break;
    }
    valSpec = slices.AppendByte(valSpec ?? emptyBytes, token);
  }
  if (lex.ItemEqual !== token) {
    valSpec = null;
    return [valid, remains, valSpec];
  }
  valSpec = slices.AppendByte(valSpec ?? emptyBytes, token);
  tokens = tokens.subarray(i + 1);
  if (1 > tokens.length) {
    valid = false;
    return [valid, remains, valSpec];
  }

  for (let n = 0; n < tokens.length; n++) {
    i = n;
    token = tokens[n];
    if (!lex.IsWhitespace(token)) {
      break;
    }
    valSpec = slices.AppendByte(valSpec, token);
  }
  token = tokens[i];
  valSpec = slices.AppendByte(valSpec, token);
  tokens = tokens.subarray(i + 1);
  let closed = false;
  if (lex.ItemDoublequote === token) { // A double-quoted attribute value consists of ", zero or more characters not including ", and a final ".
    for (let n = 0; n < tokens.length; n++) {
      i = n;
      token = tokens[n];
      valSpec = slices.AppendByte(valSpec, token);
      if (lex.ItemDoublequote === token) {
        closed = true;
        break;
      }
    }
  } else if (lex.ItemSinglequote === token) { // A single-quoted attribute value consists of ', zero or more characters not including ', and a final '.
    for (let n = 0; n < tokens.length; n++) {
      i = n;
      token = tokens[n];
      valSpec = slices.AppendByte(valSpec, token);
      if (lex.ItemSinglequote === token) {
        closed = true;
        break;
      }
    }
  } else { // An unquoted attribute value is a nonempty string of characters not including whitespace, ", ', =, <, >, or `.
    for (let n = 0; n < tokens.length; n++) {
      i = n;
      token = tokens[n];
      if (lex.ItemGreater === token) {
        i--; // The greater-than character > is not counted in valSpec
        break;
      }
      valSpec = slices.AppendByte(valSpec, token);
      if (lex.IsWhitespace(token)) {
        // Attributes are separated by whitespace
        break;
      }
      if (lex.ItemDoublequote === token || lex.ItemSinglequote === token || lex.ItemEqual === token || lex.ItemLess === token || lex.ItemGreater === token || lex.ItemBacktick === token) {
        closed = false;
        break;
      }
      closed = true;
    }
  }

  if (!closed) {
    valid = false;
    valSpec = null;
    return [valid, remains, valSpec];
  }

  remains = tokens.subarray(i + 1);
  return [valid, remains, valSpec];
}

// PORT-NOTE: exported for the vector tests; Go keeps it unexported
export function parseAttrName(tokens: Uint8Array): [Uint8Array, Uint8Array] {
  let remains: Uint8Array = emptyBytes;
  let attrName: Uint8Array = emptyBytes;
  remains = tokens;
  if (1 > tokens.length) {
    // PORT-NOTE: Go panics here (index out of range [0] with length 0); TagAttr never passes an empty slice
    throw new Error("index out of range [0] with length 0");
  }
  if (!lex.IsASCIILetter(tokens[0]) && lex.ItemUnderscore !== tokens[0] && lex.ItemColon !== tokens[0]) {
    return [remains, attrName];
  }
  attrName = slices.AppendByte(attrName, tokens[0]);
  tokens = tokens.subarray(1);
  let i = 0;
  let token = 0;
  for (let n = 0; n < tokens.length; n++) {
    i = n;
    token = tokens[n];
    if (!lex.IsASCIILetterNumHyphen(token) && lex.ItemUnderscore !== token && lex.ItemDot !== token && lex.ItemColon !== token) {
      break;
    }
    attrName = slices.AppendByte(attrName, token);
  }
  if (1 > attrName.length) {
    return [remains, attrName];
  }

  // UPSTREAM-BUG: when the name runs to the end of the input without a break, i is the last index (not the length), so the last byte of the name is left in remains; for the input " ab" remains is "b"
  remains = tokens.subarray(i);
  return [remains, attrName];
}

Tree.prototype.parseTagName = function (this: Tree, tokens: Uint8Array): [Uint8Array, Uint8Array] {
  let remains: Uint8Array = emptyBytes;
  let tagName: Uint8Array = emptyBytes;
  if (1 > tokens.length) {
    return [remains, tagName];
  }

  let i = 0;
  let token = tokens[i];
  if (!lex.IsASCIILetter(token)) {
    return [tokens, emptyBytes];
  }
  tagName = slices.AppendByte(tagName, token);
  for (i = 1; i < tokens.length; i++) {
    token = tokens[i];
    if (!lex.IsASCIILetterNumHyphen(token)) {
      break;
    }
    tagName = slices.AppendByte(tagName, token);
  }
  remains = tokens.subarray(i);
  return [remains, tagName];
};

export function SetSpanIAL(node: ast.Node | null, n: html.Node | null): void {
  if (null === node || null === n) {
    return;
  }

  let insertedIAL = false;
  let style = util.DomAttrValue(n, "style");
  if ("" !== style) { // For example setting table column widths, colors and so on
    style = StyleValue(style);
    node.SetIALAttr("style", style);

    const ialTokens = IAL2Tokens(node.KramdownIAL);
    const ial = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
    if (ast.NodeTableCell === node.Type) {
      node.PrependChild(ial);
    } else {
      node.InsertAfter(ial);
    }
    insertedIAL = true;
  }

  const customAttrs = util.DomCustomAttrs(n);
  if (null !== customAttrs) {
    if (!insertedIAL) {
      for (const [k, v0] of customAttrs) {
        const v = html.UnescapeHTMLStr(v0);
        node.SetIALAttr(k, v);
      }

      const ialTokens = IAL2Tokens(node.KramdownIAL);
      const ial = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
      if (ast.NodeTableCell === node.Type) {
        node.PrependChild(ial);
      } else {
        node.InsertAfter(ial);
      }
      insertedIAL = true;
    } else {
      for (const [k, v0] of customAttrs) {
        const v = html.UnescapeHTMLStr(v0);
        node.SetIALAttr(k, v);
      }

      const ialTokens = IAL2Tokens(node.KramdownIAL);
      let ial: ast.Node | null = node.Next;
      if (ast.NodeTableCell === node.Type) {
        ial = node.FirstChild;
      }
      ial!.Tokens = ialTokens;
    }
  }

  if (atom.Th === n.DataAtom || atom.Td === n.DataAtom) {
    // Set merged table cells
    const colspan = util.DomAttrValue(n, "colspan");
    if ("" !== colspan) {
      node.SetIALAttr("colspan", colspan);
    }
    const rowspan = util.DomAttrValue(n, "rowspan");
    if ("" !== rowspan) {
      node.SetIALAttr("rowspan", rowspan);
    }
    const class_ = util.DomAttrValue(n, "class"); // PORT-NOTE: class is a reserved word, renamed to class_
    if ("" !== class_) {
      node.SetIALAttr("class", class_);
    }
    if ("" !== colspan || "" !== rowspan || "" !== class_) {
      const ialTokens = IAL2Tokens(node.KramdownIAL);
      if (!insertedIAL) {
        const ial = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
        node.PrependChild(ial);
        insertedIAL = true;
      } else {
        // Merge these two IALs
        node.FirstChild!.Tokens = IAL2Tokens(node.KramdownIAL);
      }
    }
  }

  if (null !== n.Parent && atom.Img === n.DataAtom) {
    const style = util.DomAttrValue(n.Parent, "style");
    if ("" !== style) {
      if (insertedIAL) {
        let m: string[][] | null = Tokens2IAL(node.Next!.Tokens);
        let merged = false;
        if (null !== m) {
          for (const kv of m) {
            if ("style" === kv[0]) {
              kv[1] = kv[1] + style;
              merged = true;
              break;
            }
          }
        }
        if (!merged) {
          m = m ?? [];
          m.push(["style", style]);
        }
        node.Next!.Tokens = IAL2Tokens(m);
        node.SetIALAttr("style", style);
        node.KramdownIAL = m;
      } else {
        node.SetIALAttr("style", style);
        const ialTokens = IAL2Tokens(node.KramdownIAL);
        const ial = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
        node.InsertAfter(ial);
      }
      insertedIAL = true;
    }
  }

  if (null !== n.Parent && null !== n.Parent.Parent && atom.Img === n.DataAtom) {
    const parentStyle = util.DomAttrValue(n.Parent.Parent, "style");
    if ("" !== parentStyle) {
      if (insertedIAL) {
        let m: string[][] | null = Tokens2IAL(node.Next!.Tokens);
        m = m ?? [];
        m.push(["parent-style", parentStyle]);
        node.Next!.Tokens = IAL2Tokens(m);
        node.SetIALAttr("parent-style", parentStyle);
        node.KramdownIAL = m;
      } else {
        node.SetIALAttr("parent-style", parentStyle);
        const ialTokens = IAL2Tokens(node.KramdownIAL);
        const ial = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
        node.InsertAfter(ial);
      }
    }
  }
}

export function ContainTextMark(node: ast.Node, ...dataTypes: string[]): boolean {
  const parts = strings.Split(node.TextMarkType, " ");
  for (const typ of parts) {
    for (const dataType of dataTypes) {
      if (typ === dataType) {
        return true;
      }
    }
  }
  return false;
}

export function SetTextMarkNode(node: ast.Node, n: html.Node, options: Options): void {
  node.Type = ast.NodeTextMark;
  let dataType = util.DomAttrValue(n, "data-type");
  if ("" === dataType) {
    if (n.DataAtom === atom.Span) {
      dataType = "text";
    } else {
      if ("" !== node.TextMarkType) {
        dataType = node.TextMarkType;
      } else {
        dataType = atom.AtomString(n.DataAtom);
        if ("b" === dataType) {
          dataType = "strong";
        } else if ("i" === dataType) {
          dataType = "em";
        } else if ("del" === dataType || "strike" === dataType) {
          dataType = "s";
        }
      }
    }
  }
  node.TextMarkType = dataType;
  node.TextMarkFlashcardOcclusionID = util.DomAttrValue(n, "data-occlusion-id");
  node.Tokens = null;
  let types = strings.Split(dataType, " ");
  // Reorder so that a, inline-memo, block-ref, file-annotation-ref and inline-math come first
  const tmp: string[] = [];
  for (let i = 0; i < types.length; i++) {
    const typ = types[i];
    if ("a" === typ || "inline-memo" === typ || "block-ref" === typ || "file-annotation-ref" === typ || "inline-math" === typ) {
      tmp.push(typ);
      types.splice(i, 1);
      break;
    }
  }
  types = tmp.concat(types);

  let isInlineMath = false;
  for (const typ of types) {
    switch (typ) {
      case "a":
        [node.TextMarkAHref, node.TextMarkATitle] = util.GetTextMarkAData(n);
        node.TextMarkTextContent = util.GetTextMarkTextData(n);
        break;
      case "inline-math":
        node.TextMarkInlineMathContent = util.GetTextMarkInlineMathData(n);
        isInlineMath = true;
        break;
      case "block-ref":
        [node.TextMarkBlockRefID, node.TextMarkBlockRefSubtype] = util.GetTextMarkBlockRefData(n);
        node.TextMarkTextContent = util.GetTextMarkTextData(n);
        break;
      case "file-annotation-ref":
        node.TextMarkFileAnnotationRefID = util.GetTextMarkFileAnnotationRefData(n);
        node.TextMarkTextContent = util.GetTextMarkTextData(n);
        break;
      case "inline-memo":
        node.TextMarkTextContent = util.GetTextMarkTextData(n);
        node.TextMarkInlineMemoContent = util.GetTextMarkInlineMemoData(n);
        node.TextMarkInlineMemoContent = strings.ReplaceAll(node.TextMarkInlineMemoContent, "\n", editor.IALValEscNewLine);
        node.TextMarkInlineMemoContent = strings.ReplaceAll(node.TextMarkInlineMemoContent, "\"", "&quot;");
        break;
      default:
        if (!isInlineMath) { // The content of a copied formula with font styles is incorrect https://github.com/siyuan-note/siyuan/issues/6799
          node.TextMarkTextContent = util.GetTextMarkTextDataWithoutEscapeQuote(n);

          if (node.ContainTextMarkTypes("strong", "em", "s", "mark", "sup", "sub")) {
            // Improve some inline elements Markdown editing https://github.com/siyuan-note/siyuan/issues/9999
            const [startBlank, endBlank0] = startEndBlank(node.TextMarkTextContent);
            let endBlank = endBlank0;
            if (startBlank === node.TextMarkTextContent) {
              // A whitespace-only node moves the whitespace only once, so it is not inserted twice as both leading and trailing whitespace.
              endBlank = "";
            }
            if ("" !== startBlank) {
              if (!strings.HasSuffix(node.PreviousNodeText(), " ") && !strings.HasSuffix(node.PreviousNodeText(), "　")) {
                node.InsertBefore(new ast.Node(ast.NodeText, conv.BytesFromString(startBlank)));
              }
            }
            if ("" !== endBlank) {
              if (!strings.HasPrefix(node.NextNodeText(), " ") && !strings.HasPrefix(node.NextNodeText(), "　")) {
                node.InsertAfter(new ast.Node(ast.NodeText, conv.BytesFromString(endBlank)));
              }
            }
            node.TextMarkTextContent = strings.TrimSpace(node.TextMarkTextContent);
            if (!options.KeepEscaped && !node.ContainTextMarkTypes("code")) {
              // Improve the unescaping of copied block contents https://github.com/siyuan-note/siyuan/issues/16136
              node.TextMarkTextContent = html.UnescapeHTMLStr(node.TextMarkTextContent);
            }
          }

          if (node.ParentIs(ast.NodeTableCell) && node.IsTextMarkType("code")) {
            // Use an HTML entity for the pipe character when inline code in a table contains it Improve the handling of inline-code containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9252
            node.TextMarkTextContent = strings.ReplaceAll(node.TextMarkTextContent, "|", "&#124;");
          }

          if ("u" === node.TextMarkType) {
            // Underline supports Markdown syntax inside Improve underline element parsing https://github.com/siyuan-note/siyuan/issues/13768

            let content = node.TextMarkTextContent;
            if (null !== n.FirstChild && "a" === util.DomAttrValue(n.FirstChild, "data-type")) {
              content = "[" + content + "](" + util.DomAttrValue(n.FirstChild, "data-href") + ")";
            }

            const inlineTree = Inline("", conv.BytesFromString(content), options);
            if (null !== inlineTree && null !== inlineTree.Root!.FirstChild && null !== inlineTree.Root!.FirstChild.FirstChild) {
              // Inline parsing yields plain text, restore the HTML entities before writing it back to the text mark
              node.TextMarkTextContent = html.EscapeHTMLStr(inlineTree.Root!.FirstChild.Content());
              node.TextMarkTextContent = strings.ReplaceAll(node.TextMarkTextContent, "&quot;", "\"");

              if (null === inlineTree.Root!.FirstChild.FirstChild.Next) {
                // Multiple elements inside underline are not supported
                if (ast.NodeLink === inlineTree.Root!.FirstChild.FirstChild.Type) {
                  node.TextMarkType += " a";
                  node.TextMarkAHref = inlineTree.Root!.FirstChild.FirstChild.ChildByType(ast.NodeLinkDest)!.TokensStr();
                }
              }
            }
          }
        }
        break;
    }
  }

  SetSpanIAL(node, n);
}

export function StyleValue(style: string): string {
  let ret = "";
  ret = strings.TrimSpace(style);
  ret = strings.ReplaceAll(ret, "\n", "");
  ret = strings.Join(strings.Fields(ret), " ");
  return ret;
}

export function startEndBlank(str: string): [string, string] {
  let startBlank = "";
  let endBlank = "";
  const runes = conv.RunesFromString(str);
  for (const r of runes) {
    if (0x20 /* space */ !== r && 0x09 /* \t */ !== r && 0x0a /* \n */ !== r && 0x3000 /* ideographic space */ !== r) {
      break;
    }
    startBlank += conv.StringFromRune(r);
  }

  for (let i = runes.length - 1; i >= 0; i--) {
    if (runes[i] !== 0x20 && runes[i] !== 0x09 && runes[i] !== 0x0a && runes[i] !== 0x3000) {
      break;
    }
    endBlank = conv.StringFromRune(runes[i]) + endBlank;
  }
  return [startBlank, endBlank];
}
