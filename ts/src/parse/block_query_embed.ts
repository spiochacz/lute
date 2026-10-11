// Ported from parse/block_query_embed.go @ 8e7896b6
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
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseBlockQueryEmbed(): ast.Node | null;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const openBracesTokens: Uint8Array = conv.BytesFromString("{{");
const caretOpenBracesTokens: Uint8Array = conv.BytesFromString(editor.Caret + "{{");
const closeBracesTokens: Uint8Array = conv.BytesFromString("}}");

// BlockQueryEmbedStart decides whether a content block query embed ({{ SELECT * FROM blocks WHERE content LIKE '%todo%' }}) starts.
export function BlockQueryEmbedStart(t: Tree, container: ast.Node): number {
  if (!t.Context!.ParseOption.BlockRef || t.Context!.indented) {
    return 0;
  }

  const node = t.parseBlockQueryEmbed();
  if (null === node) {
    return 0;
  }

  t.Context!.closeUnmatchedBlocks();

  for (; !t.Context!.Tip!.CanContain(ast.NodeBlockQueryEmbed);) {
    t.Context!.finalize(t.Context!.Tip!); // Note that calling finalize iterates towards the parent node
  }
  t.Context!.Tip!.AppendChild(node);
  t.Context!.Tip = node;
  return 2;
}

Tree.prototype.parseBlockQueryEmbed = function (this: Tree): ast.Node | null {
  const t = this;
  let tokens: Uint8Array = t.Context!.currentLine.subarray(t.Context!.nextNonspace);
  const startCaret = bytes.HasPrefix(tokens, caretOpenBracesTokens);
  if (!bytes.HasPrefix(tokens, openBracesTokens) && !startCaret) {
    return null;
  }
  if (startCaret) {
    tokens = bytes.Replace(tokens, caretOpenBracesTokens, openBracesTokens, 1);
  }

  tokens = tokens.subarray(2);
  tokens = bytes.TrimSpace(tokens);
  if (t.Context!.ParseOption.ProtyleWYSIWYG) {
    tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
  }
  if (!bytes.HasSuffix(tokens, closeBracesTokens)) {
    return null;
  }

  tokens = tokens.subarray(0, tokens.length - 2); // Remove the trailing }}
  const script = slices.NilIfEmpty(bytes.TrimSpace(tokens)); // Go: bytes.TrimSpace returns nil when the result is empty, and script is a node's Tokens
  tokens = bytes.TrimSuffix(tokens, editor.CaretTokens); // UPSTREAM-BUG: dead assignment, tokens is not used afterwards (parse/block_query_embed.go:62)

  const ret = new ast.Node(ast.NodeBlockQueryEmbed);
  ret.AppendChild(new ast.Node(ast.NodeOpenBrace));
  ret.AppendChild(new ast.Node(ast.NodeOpenBrace));
  ret.AppendChild(new ast.Node(ast.NodeBlockQueryEmbedScript, script));
  ret.AppendChild(new ast.Node(ast.NodeCloseBrace));
  ret.AppendChild(new ast.Node(ast.NodeCloseBrace));
  return ret;
};
