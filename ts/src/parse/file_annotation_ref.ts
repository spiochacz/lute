// Ported from parse/file_annotation_ref.go @ 8e7896b6
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
    parseFileAnnotationRef(ctx: InlineContext): ast.Node | null;
  }
  interface Context {
    parseFileAnnotationRefID(tokens: Uint8Array): [Uint8Array, Uint8Array, Uint8Array];
  }
}

const spaceQuote: Uint8Array = conv.BytesFromString(" \"");
const assetsSlash: Uint8Array = conv.BytesFromString("assets/");
const dotPdf: Uint8Array = conv.BytesFromString(".pdf");
const slashBytes: Uint8Array = conv.BytesFromString("/");
const dotBytes: Uint8Array = conv.BytesFromString(".");
const dotDotBytes: Uint8Array = conv.BytesFromString("..");
const greaterPair: Uint8Array = conv.BytesFromString(">>");

Tree.prototype.parseFileAnnotationRef = function (this: Tree, ctx: InlineContext): ast.Node | null {
  const t = this;
  if (!t.Context!.ParseOption.FileAnnotationRef) {
    return null;
  }

  const tokens = ctx.tokens.subarray(ctx.pos);
  if (2 > tokens.length || lex.ItemLess !== tokens[0] || lex.ItemLess !== tokens[1]) {
    return null;
  }

  let id: Uint8Array = new Uint8Array(0);
  let text: Uint8Array | null = null;
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
    [passed, remains, id] = t.Context!.parseFileAnnotationRefID(remains);
    if (1 > passed.length) {
      ctx.pos = savePos;
      break;
    }
    ctx.pos += passed.length;
    matched = lex.ItemGreater === passed[passed.length - 1] && lex.ItemGreater === passed[passed.length - 2];
    if (matched) {
      break;
    }
    if (1 > remains.length || !lex.IsWhitespace(remains[0])) {
      break;
    }
    // When a space follows, continue by trying to parse the title
    [ok, passed, remains] = lex.Spnl(remains);
    if (!ok) {
      break;
    }
    ctx.pos += passed.length + 1;
    matched = 2 <= remains.length && lex.ItemGreater === remains[0] && lex.ItemGreater === remains[1];
    if (matched) {
      ctx.pos++;
      break;
    }
    let validTitle = false;
    [validTitle, passed, remains, text] = t.Context!.parseLinkTitle(remains);
    if (!validTitle) {
      break;
    }
    ctx.pos += passed.length;
    [ok, passed, remains] = lex.Spnl(remains);
    ctx.pos += passed.length;
    matched = ok && 1 < remains.length;
    if (matched) {
      matched = lex.ItemGreater === remains[0] && lex.ItemGreater === remains[1];
      ctx.pos += 2;
    }
    break;
  }
  if (!matched) {
    ctx.pos = savePos;
    return null;
  }

  const ret = new ast.Node(ast.NodeFileAnnotationRef);
  ret.AppendChild(new ast.Node(ast.NodeLess));
  ret.AppendChild(new ast.Node(ast.NodeLess));
  ret.AppendChild(new ast.Node(ast.NodeFileAnnotationRefID, id));
  if (null !== text && 0 < text.length) {
    ret.AppendChild(new ast.Node(ast.NodeFileAnnotationRefSpace));
    const textNode = new ast.Node(ast.NodeFileAnnotationRefText, text);
    ret.AppendChild(textNode);
  }
  ret.AppendChild(new ast.Node(ast.NodeGreater));
  ret.AppendChild(new ast.Node(ast.NodeGreater));
  return ret;
};

Context.prototype.parseFileAnnotationRefID = function (this: Context, tokens: Uint8Array): [Uint8Array, Uint8Array, Uint8Array] {
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
    // Reject immediately on a nested opener, so consecutive invalid input does not rescan the remaining text again and again.
    if (lex.ItemLess === token) {
      return [passed, remains, id];
    }

    if (bytes.HasPrefix(tokens.subarray(i), spaceQuote)) {
      break;
    }

    if (0x3e /* > */ === token) {
      break;
    }
  }
  remains = tokens.subarray(i);
  let idPart: Uint8Array = tokens.subarray(0, i);
  if (bytes.ContainsAny(idPart, "<>\"\r\n\\")) {
    return [passed, remains, id];
  }
  if (!bytes.HasPrefix(idPart, assetsSlash)) {
    return [new Uint8Array(0), new Uint8Array(0), new Uint8Array(0)];
  }
  idPart = bytes.TrimPrefix(idPart, assetsSlash);
  // The query and the fragment are resource locator information and do not take part in the file path and annotation ID validation.
  const query = bytes.IndexAny(idPart, "?#");
  if (0 <= query) {
    idPart = idPart.subarray(0, query);
  }
  const separator = bytes.LastIndexByte(idPart, 0x2f /* / */);
  if (0 >= separator) {
    return [passed, remains, id];
  }
  const filePart = idPart.subarray(0, separator);
  if (!bytes.HasSuffix(bytes.ToLower(filePart), dotPdf) || 4 >= filePart.length - bytes.LastIndexByte(filePart, 0x2f /* / */) - 1) {
    return [passed, remains, id];
  }
  // PORT-NOTE: the elements of bytes.Split are only read here, never appended to, so no clone is needed
  for (const part of bytes.Split(filePart, slashBytes)) {
    if (0 === part.length || bytes.Equal(part, dotBytes) || bytes.Equal(part, dotDotBytes)) {
      return [passed, remains, id];
    }
  }
  const annotationIDPart = idPart.subarray(separator + 1);
  if (!ast.IsNodeIDPattern(conv.StringFromBytes(annotationIDPart))) {
    return [passed, remains, id];
  }

  id = tokens.subarray(0, i);
  if (2 > remains.length) {
    return [passed, remains, id];
  }
  passed = slices.Make(0, 1024);
  passed = slices.Append(passed, id);
  // UPSTREAM-BUG: dead code. The scan loop above stops only on ' "' or '>' and skips every caret byte, so remains never starts with the caret (parse/file_annotation_ref.go:160).
  if (bytes.HasPrefix(remains, editor.CaretTokens)) {
    passed = slices.Append(passed, editor.CaretTokens);
    remains = remains.subarray(editor.CaretTokens.length);
  }
  const closed = lex.ItemGreater === remains[0] && lex.ItemGreater === remains[1];
  if (closed) {
    passed = slices.Append(passed, greaterPair);
    return [passed, remains, id];
  }

  if (!lex.IsWhitespace(remains[0])) {
    passed = new Uint8Array(0);
    return [passed, remains, id];
  }
  return [passed, remains, id];
};
