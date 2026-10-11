// Ported from parse/super_block.go @ 8e7896b6
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
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseSuperBlock(): [boolean, Uint8Array];
  }
  interface Context {
    superBlockFinalize(superBlock: ast.Node): void;
    isSuperBlockClose(tokens: Uint8Array): boolean;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const rowTokens: Uint8Array = conv.BytesFromString("row");
const colTokens: Uint8Array = conv.BytesFromString("col");
const caretCloseBracesTokens: Uint8Array = conv.BytesFromString(editor.Caret + "}}}");
const closeBracesTokens: Uint8Array = conv.BytesFromString("}}}");

// SuperBlockStart decides whether a super block ({{{ blocks }}}) starts.
export function SuperBlockStart(t: Tree, container: ast.Node): number {
  if (!t.Context!.ParseOption.SuperBlock || t.Context!.indented) {
    return 0;
  }

  const [ok, layout] = t.parseSuperBlock();
  if (ok) {
    t.Context!.closeUnmatchedBlocks();
    t.Context!.addChild(ast.NodeSuperBlock);
    t.Context!.addChildMarker(ast.NodeSuperBlockOpenMarker, null);
    t.Context!.addChildMarker(ast.NodeSuperBlockLayoutMarker, layout);
    t.Context!.offset = t.Context!.currentLineLen - 1; // Skip the whole line
    return 1;
  }
  return 0;
}

export function SuperBlockContinue(superBlock: ast.Node, context: Context): number {
  if (null !== context.Tip!.LastChild && ast.NodeSuperBlockCloseMarker === context.Tip!.LastChild.Type && context.Tip!.LastChild.Close) {
    return 1;
  }

  if (context.isSuperBlockClose(context.currentLine.subarray(context.nextNonspace))) {
    for (let p: ast.Node | null = context.Tip; null !== p; p = p.Parent) {
      if (ast.NodeSuperBlock === p.Type) {
        return 3; // Close
      }
    }
  }
  return 0;
}

Context.prototype.superBlockFinalize = function (this: Context, superBlock: ast.Node): void {
  const context = this;
  // Finalize all the child blocks
  for (let child = superBlock.FirstChild; null !== child; child = child.Next) {
    if (child.Close) {
      continue;
    }
    context.finalize(child);
  }
};

// parseSuperBlock returns (ok, layout).
Tree.prototype.parseSuperBlock = function (this: Tree): [boolean, Uint8Array] {
  const t = this;
  let layout: Uint8Array = emptyTokens;
  const marker = t.Context!.currentLine[t.Context!.nextNonspace];
  if (lex.ItemOpenBrace !== marker) {
    return [false, layout];
  }

  const fenceChar = marker;
  let fenceLen = 0;
  for (let i = t.Context!.nextNonspace; i < t.Context!.currentLineLen && fenceChar === t.Context!.currentLine[i]; i++) {
    fenceLen++;
  }

  if (3 !== fenceLen) {
    return [false, layout];
  }

  layout = t.Context!.currentLine.subarray(t.Context!.nextNonspace + fenceLen);
  layout = lex.TrimWhitespace(layout) ?? emptyTokens;
  if (!bytes.EqualFold(layout, emptyTokens) && !bytes.EqualFold(layout, rowTokens) && !bytes.EqualFold(layout, colTokens)) {
    return [false, layout];
  }
  return [true, layout];
};

Context.prototype.isSuperBlockClose = function (this: Context, tokens: Uint8Array): boolean {
  const context = this;
  tokens = lex.TrimWhitespace(tokens) ?? emptyTokens;
  if (bytes.Equal(tokens, caretCloseBracesTokens)) {
    const p = new ast.Node(ast.NodeParagraph, editor.CaretTokens);
    context.TipAppendChild(p);
  }
  const endCaret = bytes.HasSuffix(tokens, editor.CaretTokens);
  tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
  if (!bytes.Equal(closeBracesTokens, tokens)) {
    return false;
  }
  if (endCaret) {
    const paras = context.Tip!.ChildrenByType(ast.NodeParagraph);
    const length = paras.length;
    if (0 < length) {
      const lastP = paras[length - 1];
      lastP.Tokens = slices.Append(lastP.Tokens ?? emptyTokens, editor.CaretTokens);
    }
  }
  return true;
};
