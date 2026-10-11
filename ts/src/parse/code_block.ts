// Ported from parse/code_block.go @ 8e7896b6
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
import * as html from "../html/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseFencedCode(): [boolean, number, number, number, Uint8Array, Uint8Array];
  }
  interface Context {
    codeBlockFinalize(codeBlock: ast.Node): void;
    isFencedCodeClose(tokens: Uint8Array, openMarker: number, num: number): [boolean, Uint8Array | null];
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const newlineTokens: Uint8Array = conv.BytesFromString("\n");

// FenceCodeBlockStart decides whether a fenced code block (```) starts.
export function FenceCodeBlockStart(t: Tree, container: ast.Node): number {
  if (t.Context!.indented) {
    return 0;
  }

  const [ok, codeBlockFenceChar, codeBlockFenceLen, codeBlockFenceOffset, codeBlockOpenFence, codeBlockInfo] = t.parseFencedCode();
  if (ok) {
    t.Context!.closeUnmatchedBlocks();
    const container = t.Context!.addChild(ast.NodeCodeBlock);
    container.IsFencedCodeBlock = true;
    container.CodeBlockFenceLen = codeBlockFenceLen;
    container.CodeBlockFenceChar = codeBlockFenceChar;
    container.CodeBlockFenceOffset = codeBlockFenceOffset;
    container.CodeBlockOpenFence = codeBlockOpenFence;
    container.CodeBlockInfo = codeBlockInfo;
    t.Context!.advanceNextNonspace();
    t.Context!.advanceOffset(codeBlockFenceLen, false);
    return 2;
  }
  return 0;
}

// IndentCodeBlockStart decides whether an indented code block (    code) starts.
export function IndentCodeBlockStart(t: Tree, container: ast.Node): number {
  if (!t.Context!.ParseOption.IndentCodeBlock || !t.Context!.indented) {
    return 0;
  }

  if (t.Context!.Tip!.Type !== ast.NodeParagraph && !t.Context!.blank) {
    t.Context!.advanceOffset(4, true);
    t.Context!.closeUnmatchedBlocks();
    t.Context!.addChild(ast.NodeCodeBlock);
    return 2;
  }
  return 0;
}

export function CodeBlockContinue(codeBlock: ast.Node, context: Context): number {
  const ln = context.currentLine;
  const indent = context.indent;
  if (codeBlock.IsFencedCodeBlock) {
    const [ok, closeFence] = context.isFencedCodeClose(ln.subarray(context.nextNonspace), codeBlock.CodeBlockFenceChar, codeBlock.CodeBlockFenceLen);
    if (indent <= 3 && ok) {
      codeBlock.CodeBlockCloseFence = closeFence;
      context.finalize(codeBlock);
      return 2;
    } else {
      // Skip the spaces that may exist before the fence marker
      let i = codeBlock.CodeBlockFenceOffset;
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
  } else { // Indented code block
    if (indent >= 4) {
      context.advanceOffset(4, true);
    } else if (context.blank) {
      context.advanceNextNonspace();
    } else {
      return 1;
    }
  }
  return 0;
}

Context.prototype.codeBlockFinalize = function (this: Context, codeBlock: ast.Node): void {
  const context = this;
  if (codeBlock.IsFencedCodeBlock) {
    const content: Uint8Array = codeBlock.Tokens ?? emptyTokens;
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
    // UPSTREAM-BUG: codeBlockFinalize panics when the tokens contain no newline, for example the single caret token that isFencedCodeClose leaves for an empty fenced code block whose closing fence is followed by the caret ("```\n```‸" with a Vditor or Protyle option)
    if (i + 1 > length) {
      throw new Error("slice bounds out of range [" + (i + 1) + ":" + length + "]");
    }
    codeBlock.Tokens = content.subarray(i + 1);
  } else { // Indented code block
    codeBlock.Tokens = slices.KeepNil(codeBlock.Tokens, lex.ReplaceNewlineSpace); // nil stays nil in Go
  }
};

const codeBlockBacktick: Uint8Array = util.StrToBytes("`");

// parseFencedCode returns (ok, fenceChar, fenceLen, fenceOffset, openFence, codeBlockInfo).
Tree.prototype.parseFencedCode = function (this: Tree): [boolean, number, number, number, Uint8Array, Uint8Array] {
  const t = this;
  let fenceChar = 0;
  let fenceLen = 0;
  let openFence: Uint8Array = emptyTokens;

  const marker = t.Context!.currentLine[t.Context!.nextNonspace];
  if (lex.ItemBacktick !== marker && lex.ItemTilde !== marker) {
    return [false, fenceChar, fenceLen, 0, openFence, emptyTokens];
  }

  fenceChar = marker;
  for (let i = t.Context!.nextNonspace; i < t.Context!.currentLineLen && fenceChar === t.Context!.currentLine[i]; i++) {
    fenceLen++;
  }

  if (3 > fenceLen) {
    return [false, fenceChar, fenceLen, 0, openFence, emptyTokens];
  }

  openFence = t.Context!.currentLine.subarray(t.Context!.nextNonspace, t.Context!.nextNonspace + fenceLen);

  if (t.Context!.ParseOption.ProtyleWYSIWYG) {
    const str = conv.StringFromBytes(t.Context!.currentLine.subarray(t.Context!.nextNonspace + fenceLen));
    for (const c of str) {
      if ("~" === c) {
        return [false, fenceChar, fenceLen, 0, openFence, emptyTokens];
      }
    }
  }

  const infoTokens: Uint8Array = t.Context!.currentLine.subarray(t.Context!.nextNonspace + fenceLen);
  if (lex.ItemBacktick === marker && bytes.Contains(infoTokens, codeBlockBacktick)) {
    // The info part cannot contain `
    return [false, fenceChar, fenceLen, 0, openFence, emptyTokens];
  }
  let info: Uint8Array = html.UnescapeBytes(lex.TrimWhitespace(infoTokens)) ?? emptyTokens;
  const idx = bytes.IndexByte(info, 0x20 /* space */);
  if (0 <= idx) {
    info = info.subarray(0, idx);
  }
  return [true, fenceChar, fenceLen, t.Context!.indent, openFence, info];
};

Context.prototype.isFencedCodeClose = function (this: Context, tokens: Uint8Array, openMarker: number, num: number): [boolean, Uint8Array | null] {
  const context = this;
  const closeMarker = tokens[0];
  if (closeMarker !== openMarker) {
    return [false, null];
  }
  if (num > lex.Accept(tokens, closeMarker)) {
    return [false, null];
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
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== openMarker) {
      return [false, null];
    }
  }
  const closeFence = tokens;
  return [true, closeFence];
};
