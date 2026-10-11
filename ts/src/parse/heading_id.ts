// Ported from parse/heading_id.go @ 8e7896b6
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
import * as editor from "../editor/index.ts";
import * as util from "../util/index.ts";
import type { InlineContext } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseHeadingID(block: ast.Node, ctx: InlineContext): ast.Node | null;
  }
}

export const openCurlyBrace: Uint8Array = util.StrToBytes("{");
export const closeCurlyBrace: Uint8Array = util.StrToBytes("}");
const closeCurlyBraceCaretTokens: Uint8Array = conv.BytesFromString("}" + editor.Caret);
const emptyTokens: Uint8Array = new Uint8Array(0);

Tree.prototype.parseHeadingID = function (this: Tree, block: ast.Node, ctx: InlineContext): ast.Node | null {
  const t = this;
  if (!t.Context!.ParseOption.HeadingID || ast.NodeHeading !== block.Type || 3 > ctx.tokensLen) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, openCurlyBrace);
  }

  const startPos = ctx.pos;
  let content: Uint8Array = ctx.tokens.subarray(startPos);
  const curlyBracesEnd = bytes.Index(content, closeCurlyBrace);
  if (2 > curlyBracesEnd) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, openCurlyBrace);
  }

  const curlyBracesStart = bytes.Index(content, openCurlyBrace);
  if (0 > curlyBracesStart) {
    return null;
  }

  const length = content.length;
  if (length - 1 !== curlyBracesEnd) {
    if (!bytes.HasSuffix(content, closeCurlyBraceCaretTokens) && bytes.HasSuffix(content, editor.CaretTokens)) {
      // # foo {id}b‸
      ctx.pos++;
      return new ast.Node(ast.NodeText, openCurlyBrace);
    }
  }

  if (t.Context!.ParseOption.VditorWYSIWYG) {
    content = bytes.ReplaceAll(content, editor.CaretTokens, emptyTokens);
  }
  // PORT-NOTE: Go panics here, `content[curlyBracesStart+1:curlyBracesEnd]` with curlyBracesEnd > len(content): the end index was found before the caret was removed from content
  // UPSTREAM-BUG: parseHeadingID panics (slice bounds out of range) when VditorWYSIWYG is on and the editor caret sits inside the heading ID braces, for example "# a {#i‸d}"
  if (curlyBracesEnd > content.length) {
    throw new Error("slice bounds out of range [:" + curlyBracesEnd + "] with length " + content.length);
  }
  const id = content.subarray(curlyBracesStart + 1, curlyBracesEnd);
  ctx.pos += curlyBracesEnd + 1;
  if (null !== block.LastChild) {
    block.LastChild.Tokens = slices.KeepNil(block.LastChild.Tokens, (b) => bytes.TrimRight(b, " ")); // Go: bytes.TrimRight(nil, " ") is nil (e.g. the last child is an emphasis node)
  }
  return new ast.Node(ast.NodeHeadingID, id);
};
