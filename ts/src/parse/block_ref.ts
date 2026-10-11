// Ported from parse/block_ref.go @ 8e7896b6
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
import type { InlineContext } from "./parse.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseBlockRef(ctx: InlineContext): ast.Node;
  }
  interface Context {
    parseBlockRefID(tokens: Uint8Array): [Uint8Array, Uint8Array, Uint8Array];
  }
}

const closeParenPair: Uint8Array = conv.BytesFromString("))");

Tree.prototype.parseBlockRef = function (this: Tree, ctx: InlineContext): ast.Node {
  const t = this;
  if (!t.Context!.ParseOption.BlockRef) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, conv.BytesFromString("("));
  }

  const tokens = ctx.tokens.subarray(ctx.pos);
  if (5 > tokens.length || lex.ItemOpenParen !== tokens[0] || lex.ItemOpenParen !== tokens[1]) {
    ctx.pos++;
    return new ast.Node(ast.NodeText, conv.BytesFromString("("));
  }

  let id: Uint8Array = new Uint8Array(0);
  let text: Uint8Array | null = null;
  let subtype = "";
  const savePos = ctx.pos;
  ctx.pos += 2;
  let ok = false;
  let matched = false;
  let passed: Uint8Array = new Uint8Array(0);
  let remains: Uint8Array = new Uint8Array(0);
  for (;;) { // A for is used here to simplify the logic, not to loop
    [ok, passed, remains] = lex.Spnl(ctx.tokens.subarray(ctx.pos));
    if (!ok) {
      break;
    }
    ctx.pos += passed.length;
    [passed, remains, id] = t.Context!.parseBlockRefID(remains);
    if (1 > passed.length) {
      break;
    }
    ctx.pos += passed.length;
    matched = lex.ItemCloseParen === passed[passed.length - 1] && lex.ItemCloseParen === passed[passed.length - 2];
    if (matched) {
      break;
    }
    if (1 > remains.length || !lex.IsWhitespace(remains[0])) {
      break;
    }
    // When a space follows, continue by trying to parse the anchor text
    [ok, passed, remains] = lex.Spnl(remains);
    if (!ok) {
      break;
    }
    ctx.pos += passed.length + 1;
    matched = 2 <= remains.length && lex.ItemCloseParen === remains[0] && lex.ItemCloseParen === remains[1];
    if (matched) {
      ctx.pos++;
      break;
    }
    let validTitle = false;
    [validTitle, passed, remains, text, subtype] = t.Context!.parseBlockRefText(remains);
    if (!validTitle) {
      break;
    }
    ctx.pos += passed.length;
    [ok, passed, remains] = lex.Spnl(remains);
    ctx.pos += passed.length;
    matched = ok && 1 < remains.length;
    if (matched) {
      matched = lex.ItemCloseParen === remains[0] && lex.ItemCloseParen === remains[1];
      ctx.pos += 2;
    }
    break;
  }
  if (!matched) {
    ctx.pos = savePos + 1;
    return new ast.Node(ast.NodeText, conv.BytesFromString("("));
  }

  const ret = new ast.Node(ast.NodeBlockRef);
  ret.AppendChild(new ast.Node(ast.NodeOpenParen));
  ret.AppendChild(new ast.Node(ast.NodeOpenParen));
  ret.AppendChild(new ast.Node(ast.NodeBlockRefID, id));
  if (null !== text && 0 < text.length) {
    ret.AppendChild(new ast.Node(ast.NodeBlockRefSpace));
    const textNode = new ast.Node(ast.NodeBlockRefText, text);
    if ("d" === subtype) {
      textNode.Type = ast.NodeBlockRefDynamicText;
    }
    ret.AppendChild(textNode);
  }
  ret.AppendChild(new ast.Node(ast.NodeCloseParen));
  ret.AppendChild(new ast.Node(ast.NodeCloseParen));
  return ret;
};

Context.prototype.parseBlockRefID = function (this: Context, tokens: Uint8Array): [Uint8Array, Uint8Array, Uint8Array] {
  const context = this;
  let passed: Uint8Array = new Uint8Array(0);
  let remains: Uint8Array = tokens;
  let id: Uint8Array = new Uint8Array(0);
  const length = tokens.length;
  if (1 > length) {
    return [passed, remains, id];
  }

  let i = 0;
  let token = 0;
  for (; i < length; i++) {
    token = tokens[i];
    if (bytes.Contains(editor.CaretTokens, new Uint8Array([token]))) {
      continue;
    }

    if (lex.IsWhitespace(token) || 0x29 /* ) */ === token || !lex.IsASCIILetterNumHyphen(tokens[i])) {
      break;
    }
  }
  remains = tokens.subarray(i);
  id = tokens.subarray(0, i);
  if (2 > remains.length || !ast.IsNodeIDPattern(conv.StringFromBytes(id))) {
    return [passed, remains, id];
  }
  passed = slices.Make(0, 64);
  passed = slices.Append(passed, id);
  // UPSTREAM-BUG: dead code. The scan loop above skips every caret byte and stops only on a non-caret byte, so remains never starts with the caret (parse/block_ref.go:127).
  if (bytes.HasPrefix(remains, editor.CaretTokens)) {
    passed = slices.Append(passed, editor.CaretTokens);
    remains = remains.subarray(editor.CaretTokens.length);
  }
  const closed = lex.ItemCloseParen === remains[0] && lex.ItemCloseParen === remains[1];
  if (closed) {
    passed = slices.Append(passed, closeParenPair);
    return [passed, remains, id];
  }

  if (!lex.IsWhitespace(remains[0])) {
    passed = new Uint8Array(0);
    return [passed, remains, id];
  }
  return [passed, remains, id];
};
