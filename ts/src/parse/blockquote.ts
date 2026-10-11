// Ported from parse/blockquote.go @ 8e7896b6
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
import * as lex from "../lex/index.ts";
import { Context } from "./types.ts";
import type { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Context {
    blockquoteFinalize(blockquote: ast.Node): void;
  }
}

const newlineTokens: Uint8Array = conv.BytesFromString("\n");
const emptyTokens: Uint8Array = new Uint8Array(0);

// BlockquoteStart decides whether a block quote (>) starts.
export function BlockquoteStart(t: Tree, container: ast.Node): number {
  if (t.Context!.indented) {
    return 0;
  }

  const marker = lex.Peek(t.Context!.currentLine, t.Context!.nextNonspace);
  if (lex.ItemGreater !== marker) {
    return 0;
  }

  let markers: Uint8Array = new Uint8Array([marker]);
  t.Context!.advanceNextNonspace();
  t.Context!.advanceOffset(1, false);
  // The space after > is optional
  const whitespace = lex.Peek(t.Context!.currentLine, t.Context!.offset);
  const withSpace = lex.ItemSpace === whitespace || lex.ItemTab === whitespace;
  if (withSpace) {
    t.Context!.advanceOffset(1, true);
    markers = slices.AppendByte(markers, whitespace);
  }
  t.Context!.closeUnmatchedBlocks();
  t.Context!.addChild(ast.NodeBlockquote);
  t.Context!.addChildMarker(ast.NodeBlockquoteMarker, markers);
  return 1;
}

export function BlockquoteContinue(blockquote: ast.Node, context: Context): number {
  const ln = context.currentLine;
  if (!context.indented && lex.Peek(ln, context.nextNonspace) === lex.ItemGreater) {
    context.advanceNextNonspace();
    context.advanceOffset(1, false);
    const token = lex.Peek(ln, context.offset);
    if (lex.ItemSpace === token || lex.ItemTab === token) {
      context.advanceOffset(1, true);
    }
    return 0;
  }
  return 1;
}

Context.prototype.blockquoteFinalize = function (this: Context, blockquote: ast.Node): void {
  const context = this;
  if (!context.ParseOption.Callout) {
    return;
  }

  if (null === blockquote.FirstChild || null === blockquote.FirstChild.Next) {
    return;
  }

  if (ast.NodeParagraph !== blockquote.FirstChild.Next.Type) {
    return;
  }

  const firstTwoLines = bytes.SplitN(blockquote.FirstChild.Next.Tokens ?? emptyTokens, newlineTokens, 3);
  if (2 > firstTwoLines.length) {
    return;
  }

  const line1 = conv.StringFromBytes(firstTwoLines[0]);
  if (!strings.HasPrefix(line1, "[!")) {
    return;
  }

  const idx = strings.Index(line1, "]");
  if (0 > idx) {
    return;
  }

  if ("" === conv.StringFromBytes(firstTwoLines[1])) {
    return;
  }

  blockquote.Type = ast.NodeCallout;
  blockquote.FirstChild.Unlink();
  context.calloutFinalize(blockquote);
};
