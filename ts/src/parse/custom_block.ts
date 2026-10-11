// Ported from parse/custom_block.go @ 8e7896b6
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
import * as lex from "../lex/index.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseCustomBlock(): [boolean, number, string];
  }
  interface Context {
    customBlockFinalize(customBlock: ast.Node): void;
    isCustomBlockClose(tokens: Uint8Array): boolean;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const newlineTokens: Uint8Array = conv.BytesFromString("\n");
const semicolonsTokens: Uint8Array = conv.BytesFromString(";;;");

// CustomBlockStart decides whether a fenced custom block (;;;info) starts.
export function CustomBlockStart(t: Tree, container: ast.Node): number {
  if (!t.Context!.ParseOption.CustomBlock || t.Context!.indented) {
    return 0;
  }

  const [ok, offset, info] = t.parseCustomBlock();
  if (ok) {
    t.Context!.closeUnmatchedBlocks();
    const container = t.Context!.addChild(ast.NodeCustomBlock);
    container.CustomBlockFenceOffset = offset;
    container.CustomBlockInfo = info;
    t.Context!.advanceNextNonspace();
    t.Context!.advanceOffset(3, false);
    return 2;
  }
  return 0;
}

export function CustomBlockContinue(customBlock: ast.Node, context: Context): number {
  const ln = context.currentLine;
  const indent = context.indent;
  const ok = context.isCustomBlockClose(ln.subarray(context.nextNonspace));
  if (indent <= 3 && ok) {
    context.finalize(customBlock);
    return 2;
  } else {
    // Skip the spaces that may exist before the fence marker ;
    let i = customBlock.CustomBlockFenceOffset;
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

Context.prototype.customBlockFinalize = function (this: Context, customBlock: ast.Node): void {
  const content: Uint8Array = customBlock.Tokens ?? emptyTokens;
  const length = content.length;
  if (1 > length) {
    return;
  }

  let i = 0;
  for (; i < length; i++) {
    if (lex.ItemNewline === content[i]) {
      break;
    }
  }
  // PORT-NOTE: Go panics here, `content[i+1:]` with i == length (slice bounds out of range)
  // UPSTREAM-BUG: customBlockFinalize panics when the tokens contain no newline, for example the caret-only token that the close-fence handling leaves for an empty custom block whose closing fence is followed by the caret (";;;x\n;;;‸" with a Vditor or Protyle option)
  if (i + 1 > length) {
    throw new Error("slice bounds out of range [" + (i + 1) + ":" + length + "]");
  }
  customBlock.Tokens = content.subarray(i + 1);
};

// parseCustomBlock returns (ok, fenceOffset, info).
Tree.prototype.parseCustomBlock = function (this: Tree): [boolean, number, string] {
  const t = this;
  const marker = t.Context!.currentLine[t.Context!.nextNonspace];
  if (lex.ItemSemicolon !== marker) {
    return [false, 0, ""];
  }

  let fenceLen = 0;
  for (let i = t.Context!.nextNonspace; i < t.Context!.currentLineLen && lex.ItemSemicolon === t.Context!.currentLine[i]; i++) {
    fenceLen++;
  }

  if (3 !== fenceLen) {
    return [false, 0, ""];
  }

  const infoTokens: Uint8Array = t.Context!.currentLine.subarray(t.Context!.nextNonspace + fenceLen);
  if (0 <= bytes.IndexByte(infoTokens, lex.ItemSemicolon)) {
    // The info part cannot contain ;
    return [false, 0, ""];
  }

  if (!bytes.HasSuffix(infoTokens, newlineTokens)) {
    return [false, 0, ""];
  }

  let info = conv.StringFromBytes(lex.TrimWhitespace(infoTokens) ?? emptyTokens);
  info = html.UnescapeString(info);
  const idx = strings.IndexByte(info, 0x20 /* space */);
  if (0 <= idx) {
    info = info.slice(0, idx);
  }
  if (1 > strings.ReplaceAll(info, editor.Caret, "").length) {
    return [false, 0, ""];
  }

  return [true, t.Context!.indent, info];
};

Context.prototype.isCustomBlockClose = function (this: Context, tokens: Uint8Array): boolean {
  const context = this;
  if (1 > tokens.length) {
    return false;
  }
  tokens = lex.TrimWhitespace(tokens) ?? emptyTokens;
  const endCaret = bytes.HasSuffix(tokens, editor.CaretTokens);
  if (context.ParseOption.VditorWYSIWYG || context.ParseOption.VditorIR || context.ParseOption.VditorSV || context.ParseOption.ProtyleWYSIWYG) {
    tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
    if (endCaret) {
      context.Tip!.Tokens = bytes.TrimSuffix(context.Tip!.Tokens ?? emptyTokens, newlineTokens);
      context.Tip!.Tokens = slices.Append(context.Tip!.Tokens, editor.CaretTokens);
    }
  }
  return bytes.Equal(tokens, semicolonsTokens);
};
