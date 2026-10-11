// Ported from parse/image.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import type { InlineContext } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseBang(ctx: InlineContext): ast.Node;
  }
}

// parseBang parses !, which may be the image marker start ![ or a plain text !.
Tree.prototype.parseBang = function (this: Tree, ctx: InlineContext): ast.Node {
  const t = this;
  let ret: ast.Node | null = null;
  const startPos = ctx.pos;
  ctx.pos++;
  if (ctx.pos < ctx.tokensLen && lex.ItemOpenBracket === ctx.tokens[ctx.pos]) {
    ctx.pos++;
    ret = new ast.Node(ast.NodeText, ctx.tokens.subarray(startPos, ctx.pos));
    // Push the image start marker onto the stack
    t.addBracket(ret, startPos + 2, true, ctx);
    return ret;
  }

  ret = new ast.Node(ast.NodeText, ctx.tokens.subarray(startPos, ctx.pos));
  return ret;
};
