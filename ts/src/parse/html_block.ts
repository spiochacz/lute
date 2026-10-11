// Ported from parse/html_block.go @ 8e7896b6
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
import * as slices from "../runtime/slices.ts";
import * as conv from "../runtime/conv.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { IAL2Map, simpleCheckIsBlockIAL } from "./inline_attribute_list.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    isHTMLBlockClose(tokens: Uint8Array, htmlType: number): boolean;
    parseHTML(tokens: Uint8Array): number;
    isOpenTag(tokens: Uint8Array): boolean;
    isCloseTag(tokens: Uint8Array): boolean;
  }
  interface Context {
    htmlBlockFinalize(html: ast.Node): void;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const vditorCommentTokens: Uint8Array = conv.BytesFromString("vditor-comment");
const spanSpaceTokens: Uint8Array = conv.BytesFromString("<span ");
const iframeTokens: Uint8Array = conv.BytesFromString("<iframe");
const greaterTokens: Uint8Array = conv.BytesFromString(">");
const dataSubtypeWidgetTokens: Uint8Array = conv.BytesFromString("data-subtype=\"widget\"");
const videoTokens: Uint8Array = conv.BytesFromString("<video");
const audioTokens: Uint8Array = conv.BytesFromString("<audio");
const divTokens: Uint8Array = conv.BytesFromString("<div");
const dataTypeNodeAttributeViewTokens: Uint8Array = conv.BytesFromString("data-type=\"NodeAttributeView\"");
const dataAvTypeTokens: Uint8Array = conv.BytesFromString("data-av-type=\"");
const closeDivTokens: Uint8Array = conv.BytesFromString("</div>");
const dataAvIdTokens: Uint8Array = conv.BytesFromString("data-av-id=\"");
const quoteTokens: Uint8Array = conv.BytesFromString("\"");
const equalTokens: Uint8Array = conv.BytesFromString("=");
const commentOpenTokens: Uint8Array = util.StrToBytes("<!--");
const piOpenTokens: Uint8Array = util.StrToBytes("<?");
const declOpenTokens: Uint8Array = util.StrToBytes("<!");
const cdataOpenTokens: Uint8Array = util.StrToBytes("[CDATA[");

// HtmlBlockStart decides whether an HTML block (<) starts.
export function HtmlBlockStart(t: Tree, container: ast.Node): number {
  if (t.Context!.indented) {
    return 0;
  }

  if (lex.ItemLess !== lex.Peek(t.Context!.currentLine, t.Context!.nextNonspace)) {
    return 0;
  }

  if (t.Context!.ParseOption.VditorWYSIWYG) {
    if (bytes.Contains(t.Context!.currentLine, vditorCommentTokens)) {
      return 0;
    }
  }
  if (t.Context!.ParseOption.ProtyleWYSIWYG) {
    if (bytes.Contains(t.Context!.currentLine, spanSpaceTokens)) {
      return 0;
    }
  }

  let tokens: Uint8Array = t.Context!.currentLine.subarray(t.Context!.nextNonspace);
  const htmlType = t.parseHTML(tokens);
  if (0 !== htmlType) {
    t.Context!.closeUnmatchedBlocks();

    if (t.Context!.ParseOption.ProtyleWYSIWYG) {
      tokens = bytes.TrimSpace(tokens);
      if (bytes.HasPrefix(tokens, iframeTokens) && bytes.HasSuffix(tokens, greaterTokens)) {
        if (bytes.Contains(tokens, dataSubtypeWidgetTokens)) {
          t.Context!.addChild(ast.NodeWidget);
        } else {
          t.Context!.addChild(ast.NodeIFrame);
        }
        return 2;
      } else if (bytes.HasPrefix(tokens, videoTokens) && bytes.HasSuffix(tokens, greaterTokens)) {
        t.Context!.addChild(ast.NodeVideo);
        return 2;
      } else if (bytes.HasPrefix(tokens, audioTokens) && bytes.HasSuffix(tokens, greaterTokens)) {
        t.Context!.addChild(ast.NodeAudio);
        return 2;
      } else if (bytes.HasPrefix(tokens, divTokens) &&
        bytes.Contains(tokens, dataTypeNodeAttributeViewTokens) &&
        bytes.Contains(tokens, dataAvTypeTokens) &&
        bytes.HasSuffix(tokens, closeDivTokens)) {
        const av = t.Context!.addChild(ast.NodeAttributeView);
        const avTypeIdx = bytes.Index(tokens, dataAvTypeTokens) + dataAvTypeTokens.length;
        const avTypeEndIdx = avTypeIdx + bytes.Index(tokens.subarray(avTypeIdx), quoteTokens);
        av.AttributeViewType = conv.StringFromBytes(tokens.subarray(avTypeIdx, avTypeEndIdx));
        let avIdIdx = bytes.Index(tokens, dataAvIdTokens);
        if (0 < avIdIdx) {
          avIdIdx = avIdIdx + dataAvIdTokens.length;
          const avIdEndIdx = avIdIdx + bytes.Index(tokens.subarray(avIdIdx), quoteTokens);
          av.AttributeViewID = conv.StringFromBytes(tokens.subarray(avIdIdx, avIdEndIdx));
        } else {
          av.AttributeViewID = ast.NewNodeID();

        }
        return 2;
      }
    }

    if (t.Context!.ParseOption.ProtyleWYSIWYG) {
      // In Protyle WYSIWYG mode, only block-level elements starting with <div can be parsed into HTML blocks
      // Only HTML code wrapped in `<div>` is supported to be parsed into HTML blocks https://github.com/siyuan-note/siyuan/issues/9758
      const [, start] = lex.TrimLeft(t.Context!.currentLine.subarray(t.Context!.nextNonspace));
      if (!bytes.HasPrefix(start, divTokens)) {
        return 0;
      }
    }

    const block = t.Context!.addChild(ast.NodeHTMLBlock);
    block.HtmlBlockType = htmlType;
    return 2;
  }
  return 0;
}

export function HtmlBlockContinue(html: ast.Node, context: Context): number {
  let tokens: Uint8Array = context.currentLine.subarray(context.offset);
  if (context.ParseOption.KramdownBlockIAL && simpleCheckIsBlockIAL(tokens)) {
    // Decide whether an IAL interrupts
    if (context.Tip!.ParentIs(ast.NodeListItem)) {
      [, tokens] = lex.TrimLeft(tokens);
    }
    const ial = context.parseKramdownBlockIAL(tokens);
    if (null !== ial && 0 < ial.length) {
      context.Tip!.ID = IAL2Map(ial).get("id") ?? "";
      context.Tip!.KramdownIAL = ial;
      return 1;
    }
  }

  if (context.blank && (html.HtmlBlockType === 6 || html.HtmlBlockType === 7)) {
    return 1;
  }
  return 0;
}

Context.prototype.htmlBlockFinalize = function (this: Context, html: ast.Node): void {
  html.Tokens = slices.KeepNil(slices.KeepNil(html.Tokens, lex.ReplaceNewlineSpace), (b) => lex.TrimRight(b)[1]); // nil stays nil in Go
};

const htmlBlockTags1: Uint8Array[] = ["<script", "<pre", "<style", "<textarea"].map((s) => util.StrToBytes(s));
const htmlBlockCloseTags1: Uint8Array[] = ["</script>", "</pre>", "</style>", "</textarea>"].map((s) => util.StrToBytes(s));
const htmlBlockTags6: Uint8Array[] = [
  "<address", "<article", "<aside", "<base", "<basefont", "<blockquote", "<body", "<caption", "<center", "<col", "<colgroup", "<dd", "<details", "<dialog", "<dir", "<div", "<dl", "<dt", "<fieldset", "<figcaption", "<figure", "<footer", "<form", "<frame", "<frameset", "<h1", "<h2", "<h3", "<h4", "<h5", "<h6", "<head", "<header", "<hr", "<html", "<iframe", "<legend", "<li", "<link", "<main", "<menu", "<menuitem", "<nav", "<noframes", "<ol", "<optgroup", "<option", "<p", "<param", "<section", "<source", "<summary", "<table", "<tbody", "<td", "<tfoot", "<th", "<thead", "<title", "<tr", "<track", "<ul", "<video", "<audio",
  "</address", "</article", "</aside", "</base", "</basefont", "</blockquote", "</body", "</caption", "</center", "</col", "</colgroup", "</dd", "</details", "</dialog", "</dir", "</div", "</dl", "</dt", "</fieldset", "</figcaption", "</figure", "</footer", "</form", "</frame", "</frameset", "</h1", "</h2", "</h3", "</h4", "</h5", "</h6", "</head", "</header", "</hr", "</html", "</iframe", "</legend", "</li", "</link", "</main", "</menu", "</menuitem", "</nav", "</noframes", "</ol", "</optgroup", "</option", "</p", "</param", "</section", "</source", "</summary", "</table", "</tbody", "</td", "</tfoot", "</th", "</thead", "</title", "</tr", "</track", "</ul", "</video", "</audio",
].map((s) => util.StrToBytes(s));
const htmlBlockSinglequote: Uint8Array = util.StrToBytes("'");
const htmlBlockDoublequote: Uint8Array = util.StrToBytes("\"");
const htmlBlockGreater: Uint8Array = util.StrToBytes(">");

Tree.prototype.isHTMLBlockClose = function (this: Tree, tokens: Uint8Array, htmlType: number): boolean {
  const t = this;
  if (t.Context!.ParseOption.KramdownBlockIAL && simpleCheckIsBlockIAL(tokens)) {
    // Decide whether an IAL interrupts
    const ial = t.Context!.parseKramdownBlockIAL(tokens);
    if (null !== ial && 0 < ial.length) {
      t.Context!.Tip!.ID = IAL2Map(ial).get("id") ?? "";
      t.Context!.Tip!.KramdownIAL = ial;
      t.Context!.Tip!.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, tokens));
      return true;
    }
  }

  const length = tokens.length;
  switch (htmlType) {
    case 1: {
      const pos = lex.AcceptTokenss(tokens, htmlBlockCloseTags1);
      if (0 <= pos) {
        return true;
      }
      return false;
    }
    case 2:
      for (let i = 0; i < length - 3; i++) {
        if (lex.ItemHyphen === tokens[i] && lex.ItemHyphen === tokens[i + 1] && lex.ItemGreater === tokens[i + 2]) {
          return true;
        }
      }
      break;
    case 3:
      for (let i = 0; i < length - 2; i++) {
        if (lex.ItemQuestion === tokens[i] && lex.ItemGreater === tokens[i + 1]) {
          return true;
        }
      }
      break;
    case 4:
      return bytes.Contains(tokens, htmlBlockGreater);
    case 5:
      for (let i = 0; i < length - 2; i++) {
        if (lex.ItemCloseBracket === tokens[i] && lex.ItemCloseBracket === tokens[i + 1]) {
          return true;
        }
      }
      break;
  }
  return false;
};

Tree.prototype.parseHTML = function (this: Tree, tokens: Uint8Array): number {
  const t = this;
  let typ = 0;
  [, tokens] = lex.TrimLeft(tokens);
  const length = tokens.length;
  if (3 > length) { // at least <? and a newline
    return typ;
  }

  if (lex.ItemLess !== tokens[0]) {
    return typ;
  }

  typ = 1;

  const pos1 = lex.AcceptTokenss(tokens, htmlBlockTags1);
  if (0 <= pos1) {
    // PORT-NOTE: Go panics here (index out of range) when the tag name ends the input, e.g. "<script"
    if (pos1 >= tokens.length) {
      throw new RangeError("index out of range [" + pos1 + "] with length " + tokens.length);
    }
    if (lex.IsWhitespace(tokens[pos1]) || lex.ItemGreater === tokens[pos1]) {
      return typ;
    }
  }

  const pos6 = lex.AcceptTokenss(tokens, htmlBlockTags6);
  if (0 <= pos6) {
    // PORT-NOTE: Go panics here (index out of range) when the tag name ends the input, e.g. "<div"
    if (pos6 >= tokens.length) {
      throw new RangeError("index out of range [" + pos6 + "] with length " + tokens.length);
    }
    if (lex.IsWhitespace(tokens[pos6]) || lex.ItemGreater === tokens[pos6]) {
      typ = 6;
      return typ;
    }
    // PORT-NOTE: Go panics here (index out of range) when "/" ends the input, e.g. "<div/"
    if (lex.ItemSlash === tokens[pos6] && pos6 + 1 >= tokens.length) {
      throw new RangeError("index out of range [" + (pos6 + 1) + "] with length " + tokens.length);
    }
    if (lex.ItemSlash === tokens[pos6] && lex.ItemGreater === tokens[pos6 + 1]) {
      typ = 6;
      return typ;
    }
  }

  const tag: Uint8Array = lex.TrimWhitespace(tokens) ?? emptyTokens;
  const isOpenTag = t.isOpenTag(tag);
  if (isOpenTag && t.Context!.Tip!.Type !== ast.NodeParagraph) {
    typ = 7;
    return typ;
  }
  const isCloseTag = t.isCloseTag(tag);
  if (isCloseTag && t.Context!.Tip!.Type !== ast.NodeParagraph) {
    typ = 7;
    return typ;
  }

  if (0 === bytes.Index(tokens, commentOpenTokens)) {
    typ = 2;
    return typ;
  }

  if (0 === bytes.Index(tokens, piOpenTokens)) {
    typ = 3;
    return typ;
  }

  if (2 < tokens.length && 0 === bytes.Index(tokens, declOpenTokens)) {
    const following = tokens.subarray(2);
    if (0x41 /* A */ <= following[0] && 0x5a /* Z */ >= following[0]) {
      typ = 4;
      return typ;
    }
    if (0 === bytes.Index(following, cdataOpenTokens)) {
      typ = 5;
      return typ;
    }
  }
  return 0;
};

Tree.prototype.isOpenTag = function (this: Tree, tokens: Uint8Array): boolean {
  let length = tokens.length;
  if (3 > length) {
    return false;
  }

  if (lex.ItemLess !== tokens[0]) {
    return false;
  }
  if (lex.ItemGreater !== tokens[length - 1]) {
    return false;
  }
  if (lex.ItemSlash === tokens[length - 2]) {
    tokens = tokens.subarray(1, length - 2);
  } else {
    tokens = tokens.subarray(1, length - 1);
  }

  length = tokens.length;
  if (0 === length) {
    return false;
  }

  if (lex.IsWhitespace(tokens[0])) { // < must not be followed by whitespace
    return false;
  }

  const nameAndAttrs = lex.SplitWhitespace(tokens);
  let name = nameAndAttrs[0];
  if (!lex.IsASCIILetter(name[0])) {
    return false;
  }
  if (1 < name.length) {
    name = name.subarray(1);
    for (let k = 0; k < name.length; k++) {
      if (!lex.IsASCIILetterNumHyphen(name[k])) {
        return false;
      }
    }
  }

  const attrs = nameAndAttrs.slice(1);
  for (const attr of attrs) {
    if (1 >= attr.length) {
      continue;
    }

    const nameAndValue = bytes.SplitN(attr, equalTokens, 2);
    let name = nameAndValue[0];
    if (1 > name.length) { // The case of spaces before the equal sign
      continue;
    }
    if (!lex.IsASCIILetter(name[0]) && lex.ItemUnderscore !== name[0] && lex.ItemColon !== name[0]) {
      return false;
    }

    if (1 < name.length) {
      name = name.subarray(1);
      for (let k = 0; k < name.length; k++) {
        const n = name[k];
        if (!lex.IsASCIILetter(n) && !lex.IsDigit(n) && lex.ItemUnderscore !== n && lex.ItemDot !== n && lex.ItemColon !== n && lex.ItemHyphen !== n) {
          return false;
        }
      }
    }

    if (1 < nameAndValue.length) {
      let value = nameAndValue[1];
      if (bytes.HasPrefix(value, htmlBlockSinglequote) && bytes.HasSuffix(value, htmlBlockSinglequote)) {
        value = value.subarray(1);
        if (1 > value.length) {
          return false;
        }
        value = value.subarray(0, value.length - 1);
        if (bytes.Contains(value, htmlBlockSinglequote)) {
          return false;
        }
        continue;
      }
      if (bytes.HasPrefix(value, htmlBlockDoublequote) && bytes.HasSuffix(value, htmlBlockDoublequote)) {
        value = value.subarray(1);
        if (1 > value.length) {
          return false;
        }
        value = value.subarray(0, value.length - 1);
        if (bytes.Contains(value, htmlBlockDoublequote)) {
          return false;
        }
        continue;
      }
      if (bytes.ContainsAny(value, " \t\n") || bytes.ContainsAny(value, "\"'=<>`")) {
        return false;
      }
    }
  }
  return true;
};

Tree.prototype.isCloseTag = function (this: Tree, tokens: Uint8Array): boolean {
  tokens = lex.TrimWhitespace(tokens) ?? emptyTokens;
  let length = tokens.length;
  if (4 > length) {
    return false;
  }

  if (lex.ItemLess !== tokens[0] || lex.ItemSlash !== tokens[1]) {
    return false;
  }
  if (lex.ItemGreater !== tokens[length - 1]) {
    return false;
  }

  tokens = tokens.subarray(2, length - 1);
  length = tokens.length;
  if (0 === length) {
    return false;
  }

  let name = tokens.subarray(0);
  if (!lex.IsASCIILetter(name[0])) {
    return false;
  }
  if (1 < name.length) {
    name = name.subarray(1);
    for (let k = 0; k < name.length; k++) {
      if (!lex.IsASCIILetterNumHyphen(name[k])) {
        return false;
      }
    }
  }
  return true;
};
