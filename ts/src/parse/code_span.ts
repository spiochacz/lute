// Ported from parse/code_span.go @ 8e7896b6
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
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import * as lex from "../lex/index.ts";
import { Inline } from "./parse.ts";
import type { InlineContext } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseCodeSpan(block: ast.Node, ctx: InlineContext): ast.Node;
    matchCodeSpanEnd(tokens: Uint8Array, num: number): number;
  }
}

const escapedPipe: Uint8Array = conv.BytesFromString("\\|");
const pipe: Uint8Array = conv.BytesFromString("|");
const codeSpanDataTypeOpen: Uint8Array = conv.BytesFromString("<span data-type=\"code\">");
const ampersand: Uint8Array = conv.BytesFromString("&");
const ampersandAmp: Uint8Array = conv.BytesFromString("&amp;");
const spanDataType: Uint8Array = conv.BytesFromString("<span data-type=");
const greaterThan: Uint8Array = conv.BytesFromString(">");
const spanCloseIAL: Uint8Array = conv.BytesFromString("</span>{: ");
const closeBrace: Uint8Array = conv.BytesFromString("}");
const spanClose: Uint8Array = conv.BytesFromString("</span>");

Tree.prototype.parseCodeSpan = function (this: Tree, block: ast.Node, ctx: InlineContext): ast.Node {
  const t = this;
  let ret: ast.Node | null = null;
  const startPos = ctx.pos;
  let n = 0;
  for (; startPos + n < ctx.tokensLen; n++) {
    if (lex.ItemBacktick !== ctx.tokens[startPos + n]) {
      break;
    }
  }

  const backticks = ctx.tokens.subarray(startPos, startPos + n);
  if (ctx.tokensLen <= startPos + n) {
    ctx.pos += n;
    ret = new ast.Node(ast.NodeText, backticks);
    return ret;
  }
  const openMarker = new ast.Node(ast.NodeCodeSpanOpenMarker, backticks);

  let endPos = t.matchCodeSpanEnd(ctx.tokens.subarray(startPos + n), n);
  if (1 > endPos) {
    ctx.pos += n;
    ret = new ast.Node(ast.NodeText, backticks);
    return ret;
  }
  endPos = startPos + endPos + n;
  const closeMarker = new ast.Node(ast.NodeCodeSpanCloseMarker, ctx.tokens.subarray(endPos, endPos + n));

  let textTokens: Uint8Array = ctx.tokens.subarray(startPos + n, endPos);
  textTokens = lex.ReplaceAll(textTokens, lex.ItemNewline, lex.ItemSpace);
  if (2 < textTokens.length && lex.ItemSpace === textTokens[0] && lex.ItemSpace === textTokens[textTokens.length - 1] && !lex.IsBlankLine(textTokens)) {
    // If both ends are spaces and the whole line is not blank, strip one space from each end
    // Slice aliasing: openMarker.Tokens is a sub-slice of ctx.tokens whose capacity reaches the following bytes, so this append writes in place into the shared buffer (as in Go)
    openMarker.Tokens = slices.AppendByte(openMarker.Tokens!, textTokens[0]);
    closeMarker.Tokens = ctx.tokens.subarray(endPos - 1, endPos + n);
    textTokens = textTokens.subarray(1, textTokens.length - 1);
  }

  if (t.Context!.ParseOption.GFMTable) {
    if (ast.NodeTableCell === block.Type) {
      // Handle a pipe in code in a table https://github.com/88250/lute/issues/63
      textTokens = bytes.ReplaceAll(textTokens, escapedPipe, pipe);
    }
  }

  ret = new ast.Node(ast.NodeCodeSpan);
  ret.CodeMarkerLen = n;
  ret.AppendChild(openMarker);

  if (t.Context!.ParseOption.ProtyleWYSIWYG) {
    // Improve `inline code` markdown editing https://github.com/siyuan-note/siyuan/issues/9978

    if (!bytes.HasPrefix(textTokens, codeSpanDataTypeOpen)) {
      // HTML entities need to be escaped when converting HTML to Markdown
      textTokens = bytes.ReplaceAll(textTokens, ampersand, ampersandAmp);
    }

    // The content of a code span is parsed again with Inline under Protyle.
    // Copy the ParseOption here and turn off autoLink only for this second parse,
    // so content inside backticks is not converted automatically, without affecting autoLink of the outer plain text.
    const codeParseOptions = t.Context!.ParseOption.Copy();
    codeParseOptions.ProtyleWYSIWYGAutoLink = false;
    const inlineTree = Inline("", textTokens, codeParseOptions);
    if (null !== inlineTree) {
      const content = new bytes.Buffer();
      ast.Walk(inlineTree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
        if (!entering) {
          content.WriteString(n.Marker(entering));
          if (ast.NodeLinkTitle === n.Type) {
            content.WriteByte(lex.ItemDoublequote);
          } else if (ast.NodeTextMark === n.Type) {
            if ("kbd" === n.TextMarkType) {
              content.WriteString("</kbd>");
            } else if ("u" === n.TextMarkType) {
              content.WriteString("</u>");
            } else if ("sup" === n.TextMarkType) {
              content.WriteString("</sup>");
            } else if ("sub" === n.TextMarkType) {
              content.WriteString("</sub>");
            }
          }
          return ast.WalkContinue;
        }

        content.WriteString(n.Marker(entering));

        if (ast.NodeTextMark === n.Type) {
          if ("kbd" === n.TextMarkType) {
            content.WriteString("<kbd>");
          } else if ("u" === n.TextMarkType) {
            content.WriteString("<u>");
          } else if ("sup" === n.TextMarkType) {
            content.WriteString("<sup>");
          } else if ("sub" === n.TextMarkType) {
            content.WriteString("<sub>");
          }

          content.WriteString(n.TextMarkTextContent);
        } else if (ast.NodeText === n.Type || ast.NodeLinkText === n.Type || ast.NodeLinkTitle === n.Type || ast.NodeLinkDest === n.Type) {
          if (entering) {
            if (ast.NodeLinkTitle === n.Type) {
              content.WriteByte(lex.ItemDoublequote);
            }
          }

          // PORT-NOTE: Go reads n.Tokens as a possibly nil slice; an empty array stands in for nil here
          const nTokens: Uint8Array = n.Tokens ?? new Uint8Array(0);
          let spanIdx1 = 0;
          if (0 <= (spanIdx1 = bytes.Index(nTokens, spanDataType))) {
            let spanIdx2 = 0;
            if (0 <= (spanIdx2 = bytes.Index(nTokens.subarray(spanIdx1), greaterThan))) {
              content.Write(nTokens.subarray(0, spanIdx1));
              content.Write(nTokens.subarray(spanIdx1 + spanIdx2 + 1));
              let closeIdx = 0;
              if (0 <= (closeIdx = bytes.Index(ctx.tokens.subarray(endPos + 1), spanCloseIAL))) {
                let closeIdx2 = 0;
                if (0 <= (closeIdx2 = bytes.Index(ctx.tokens.subarray(endPos + 1 + closeIdx), closeBrace))) {
                  ctx.tokens = slices.Append(ctx.tokens.subarray(0, endPos + 1 + closeIdx), ctx.tokens.subarray(endPos + 1 + closeIdx + closeIdx2 + 1));
                  ctx.tokensLen = ctx.tokens.length;
                } else {
                  ctx.tokens = bytes.Replace(ctx.tokens, spanClose, new Uint8Array(0), 1);
                  ctx.tokensLen = ctx.tokens.length;
                }
              } else if (0 <= (closeIdx = bytes.Index(ctx.tokens.subarray(endPos + 1), spanClose))) {
                ctx.tokens = bytes.Replace(ctx.tokens, spanClose, new Uint8Array(0), 1);
                ctx.tokensLen -= 7;
              }
            } else {
              content.Write(nTokens);
            }
          } else {
            content.Write(nTokens);
          }
        } else if (ast.NodeLinkSpace === n.Type) {
          content.WriteByte(lex.ItemSpace);
        } else if (ast.NodeBackslashContent === n.Type) {
          content.WriteString("\\");
          content.Write(n.Tokens ?? new Uint8Array(0));
        } else if (ast.NodeHTMLEntity === n.Type) {
          content.Write(html.EscapeHTML(n.Tokens ?? new Uint8Array(0)));
        } else if (ast.NodeInlineMathContent === n.Type) {
          content.Write(n.Tokens ?? new Uint8Array(0));
        } else if (ast.NodeCodeSpanContent === n.Type) {
          content.WriteByte(lex.ItemBacktick);
          content.Write(n.Tokens ?? new Uint8Array(0));
          content.WriteByte(lex.ItemBacktick);
        } else if (ast.NodeEmojiAlias === n.Type) {
          content.Write(n.Tokens ?? new Uint8Array(0));
        }
        return ast.WalkContinue;
      });
      textTokens = html.UnescapeHTML(content.Bytes());
    }
  }

  ret.AppendChild(new ast.Node(ast.NodeCodeSpanContent, textTokens));
  ret.AppendChild(closeMarker);
  ctx.pos = endPos + n;
  return ret;
};

Tree.prototype.matchCodeSpanEnd = function (this: Tree, tokens: Uint8Array, num: number): number {
  const t = this;
  let pos = 0;
  const length = tokens.length;
  while (pos < length) {
    const l = lex.Accept(tokens.subarray(pos), lex.ItemBacktick);
    if (num === l) {
      const next = pos + l;
      if (length - 1 > next && lex.ItemBacktick === tokens[next]) {
        // UPSTREAM-BUG: unreachable, Accept has consumed every backtick, so tokens[next] is never a backtick; if it were reached, this continue would loop forever without advancing pos
        continue;
      }
      return pos;
    }
    if (0 < l) {
      pos += l;
    } else {
      pos++;
    }
  }
  return -1;
};
