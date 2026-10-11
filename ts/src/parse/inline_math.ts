// Ported from parse/inline_math.go @ 8e7896b6
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
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import type { InlineContext } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseInlineMath(ctx: InlineContext): ast.Node;
    matchInlineMathEnd(tokens: Uint8Array): number;
  }
}

const dollar: Uint8Array = util.StrToBytes("$");
const spanOpen: Uint8Array = conv.BytesFromString("<span");

Tree.prototype.parseInlineMath = function (this: Tree, ctx: InlineContext): ast.Node {
  const t = this;
  let ret: ast.Node | null = null;
  if (3 > ctx.tokensLen || !t.Context!.ParseOption.InlineMath) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, dollar);
  }

  const startPos = ctx.pos;
  let blockStartPos = startPos;
  let dollars = 0;
  for (; blockStartPos < ctx.tokensLen && lex.ItemDollar === ctx.tokens[blockStartPos]; blockStartPos++) {
    dollars++;
  }
  if (2 <= dollars) {
    if (t.Context!.ParseOption.ProtyleWYSIWYG) {
      // Protyle does not allow deriving block level from inline level
      ctx.pos++;
      return new ast.Node(ast.NodeText, dollar);
    }

    // Block node
    let matchBlock = false;
    let blockEndPos = blockStartPos + dollars;
    let token = 0;
    for (; blockEndPos < ctx.tokensLen; blockEndPos++) {
      token = ctx.tokens[blockEndPos];
      if (lex.ItemDollar === token && blockEndPos < ctx.tokensLen - 1 && lex.ItemDollar === ctx.tokens[blockEndPos + 1]) {
        matchBlock = true;
        break;
      }
    }
    if (matchBlock) {
      ret = new ast.Node(ast.NodeMathBlock);
      ret.AppendChild(new ast.Node(ast.NodeMathBlockOpenMarker));
      ret.AppendChild(new ast.Node(ast.NodeMathBlockContent, ctx.tokens.subarray(blockStartPos, blockEndPos)));
      ret.AppendChild(new ast.Node(ast.NodeMathBlockCloseMarker));
      ctx.pos = blockEndPos + 2;
      return ret;
    }
  }

  if (!t.Context!.ParseOption.InlineMathAllowDigitAfterOpenMarker && ctx.tokensLen > startPos + 1 && lex.IsDigit(ctx.tokens[startPos + 1])) { // $ cannot be followed by a digit
    ctx.pos += 3;
    if (ctx.tokens.length < startPos + 3) {
      return new ast.Node(ast.NodeText, ctx.tokens.subarray(startPos));
    }
    return new ast.Node(ast.NodeText, ctx.tokens.subarray(startPos, startPos + 3));
  }

  let endPos = t.matchInlineMathEnd(ctx.tokens.subarray(startPos + 1));
  if (1 > endPos) {
    ctx.pos++;
    ret = new ast.Node(ast.NodeText, dollar);
    return ret;
  }

  if (t.Context!.ParseOption.TextMark) {
    if (bytes.Contains(ctx.tokens.subarray(startPos + 1, startPos + endPos + 1), spanOpen)) {
      // If a span node is in the middle, break the formula, the span takes precedence
      ctx.pos++;
      return new ast.Node(ast.NodeText, dollar);
    }
  }

  endPos = startPos + endPos + 2;

  const tokens = ctx.tokens.subarray(startPos + 1, endPos - 1);
  if (1 > lex.TrimWhitespace(tokens)!.length) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, dollar);
  }

  ret = new ast.Node(ast.NodeInlineMath);
  ret.AppendChild(new ast.Node(ast.NodeInlineMathOpenMarker));
  ret.AppendChild(new ast.Node(ast.NodeInlineMathContent, tokens));
  ret.AppendChild(new ast.Node(ast.NodeInlineMathCloseMarker));

  ctx.pos = endPos;
  return ret;
};

Tree.prototype.matchInlineMathEnd = function (this: Tree, tokens: Uint8Array): number {
  const t = this;
  let pos = 0;
  const length = tokens.length;
  for (; pos < length; pos++) {
    if (lex.ItemDollar === tokens[pos] && 0 < pos && lex.ItemBackslash !== tokens[pos - 1]) {
      if (pos < length - 1) {
        if (!lex.IsDigit(tokens[pos + 1]) || t.Context!.ParseOption.InlineMathAllowDigitAfterOpenMarker) {
          return pos;
        }
      } else {
        return pos;
      }
    } else if (lex.ItemNewline === tokens[pos]) {
      return -1;
    }
  }
  return -1;
};
