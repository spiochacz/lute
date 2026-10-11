// Ported from parse/toc.go @ 8e7896b6
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
import * as editor from "../editor/index.ts";
import * as lex from "../lex/index.ts";
import { Context } from "./types.ts";

declare module "./types.ts" {
  interface Context {
    parseToC(paragraph: ast.Node): ast.Node | null;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const tocTokens: Uint8Array = conv.BytesFromString("[toc]");

Context.prototype.parseToC = function (this: Context, paragraph: ast.Node): ast.Node | null {
  const context = this;
  const lines = lex.Split(paragraph.Tokens ?? emptyTokens, lex.ItemNewline);
  if (1 !== lines.length) {
    return null;
  }

  let content: Uint8Array = bytes.TrimSpace(lines[0]);
  if (context.ParseOption.VditorWYSIWYG || context.ParseOption.VditorIR || context.ParseOption.VditorSV) {
    content = bytes.ReplaceAll(content, editor.CaretTokens, emptyTokens);
  }
  if (!bytes.EqualFold(content, tocTokens)) {
    return null;
  }
  return new ast.Node(ast.NodeToC);
};
