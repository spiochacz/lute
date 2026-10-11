// Ported from parse/math_block.go @ 8e7896b6
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
import * as editor from "../editor/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { IAL2Map, simpleCheckIsBlockIAL } from "./inline_attribute_list.ts";
import { Inline } from "./parse.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseMathBlock(): [boolean, number];
  }
  interface Context {
    mathBlockFinalize(mathBlock: ast.Node): void;
    isMathBlockClose(tokens: Uint8Array): boolean;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const spanDataTypeTokens: Uint8Array = conv.BytesFromString("<span data-type=");

// MathBlockStart decides whether a math block ($$) starts.
export function MathBlockStart(t: Tree, container: ast.Node): number {
  if (t.Context!.indented) {
    return 0;
  }

  const [ok, mathBlockDollarOffset] = t.parseMathBlock();
  if (ok) {
    t.Context!.closeUnmatchedBlocks();
    const block = t.Context!.addChild(ast.NodeMathBlock);
    block.MathBlockDollarOffset = mathBlockDollarOffset;
    t.Context!.advanceNextNonspace();
    t.Context!.advanceOffset(mathBlockDollarOffset, false);
    return 2;
  }
  return 0;
}

export function MathBlockContinue(mathBlock: ast.Node, context: Context): number {
  const ln = context.currentLine;
  const indent = context.indent;
  if (3 >= indent && context.isMathBlockClose(ln.subarray(context.nextNonspace))) {
    context.finalize(mathBlock);
    return 2;
  } else {
    // Skip the spaces that may exist before $
    let i = mathBlock.MathBlockDollarOffset;
    let token = 0;
    for (; i > 0;) {
      token = lex.Peek(ln, context.offset);
      if (lex.ItemSpace !== token && lex.ItemTab !== token) {
        break;
      }
      context.advanceOffset(1, true);
      i--;
    }
  }
  return 0;
}

export const MathBlockMarker: Uint8Array = util.StrToBytes("$$");
export const MathBlockMarkerCaret: Uint8Array = util.StrToBytes("$$" + editor.Caret);

Context.prototype.mathBlockFinalize = function (this: Context, mathBlock: ast.Node): void {
  const context = this;
  if (2 > (mathBlock.Tokens ?? emptyTokens).length) {
    /*
      - foo

          $$
      bar
      $$
    */
    mathBlock.AppendChild(new ast.Node(ast.NodeMathBlockOpenMarker));
    mathBlock.AppendChild(new ast.Node(ast.NodeMathBlockContent));
    mathBlock.AppendChild(new ast.Node(ast.NodeMathBlockCloseMarker));
    return;
  }
  let tokens: Uint8Array = mathBlock.Tokens!.subarray(2); // Remove the leading $$
  tokens = lex.TrimWhitespace(tokens) ?? emptyTokens;
  if (context.ParseOption.VditorWYSIWYG || context.ParseOption.VditorIR || context.ParseOption.VditorSV || context.ParseOption.ProtyleWYSIWYG) {
    if (bytes.HasSuffix(tokens, MathBlockMarkerCaret)) {
      // Remove the trailing $$‸
      tokens = bytes.TrimSuffix(tokens, MathBlockMarkerCaret);
      // Move the Vditor caret to the end of the content
      tokens = slices.Append(tokens, editor.CaretTokens);
    }
  }
  if (bytes.HasSuffix(tokens, MathBlockMarker)) {
    tokens = tokens.subarray(0, tokens.length - 2); // Remove the trailing $$
  }
  if (bytes.Contains(tokens, spanDataTypeTokens)) {
    // Convert inline-level elements to block-level elements https://ld246.com/article/1730804245164
    const inlineTree = Inline("", tokens, context.ParseOption);
    if (null !== inlineTree) {
      tokens = conv.BytesFromString(inlineTree.Root!.Content());
    }
  }

  mathBlock.Tokens = null;
  mathBlock.AppendChild(new ast.Node(ast.NodeMathBlockOpenMarker));
  mathBlock.AppendChild(new ast.Node(ast.NodeMathBlockContent, tokens));
  mathBlock.AppendChild(new ast.Node(ast.NodeMathBlockCloseMarker));
};

Tree.prototype.parseMathBlock = function (this: Tree): [boolean, number] {
  const t = this;
  const marker = t.Context!.currentLine[t.Context!.nextNonspace];
  if (lex.ItemDollar !== marker) {
    return [false, 0];
  }

  const fenceChar = marker;
  let fenceLength = 0;
  for (let i = t.Context!.nextNonspace; i < t.Context!.currentLineLen && fenceChar === t.Context!.currentLine[i]; i++) {
    fenceLength++;
  }

  if (2 > fenceLength) {
    return [false, 0];
  }
  return [true, t.Context!.indent];
};

Context.prototype.isMathBlockClose = function (this: Context, tokens: Uint8Array): boolean {
  const context = this;
  if (context.ParseOption.KramdownBlockIAL && simpleCheckIsBlockIAL(tokens)) {
    // Decide whether an IAL interrupts
    const ial = context.parseKramdownBlockIAL(tokens);
    if (null !== ial && 0 < ial.length) {
      context.Tip!.ID = IAL2Map(ial).get("id") ?? "";
      context.Tip!.KramdownIAL = ial;
      context.Tip!.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, tokens));
      return true;
    }
  }

  const closeMarker = tokens[0];
  if (closeMarker !== lex.ItemDollar) {
    return false;
  }
  if (2 > lex.Accept(tokens, closeMarker)) {
    return false;
  }
  tokens = lex.TrimWhitespace(tokens) ?? emptyTokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== lex.ItemDollar) {
      return false;
    }
  }
  return true;
};
