// Ported from parse/link.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as slices from "../runtime/slices.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import * as lex from "../lex/index.ts";
import { Context } from "./types.ts";

declare module "./types.ts" {
  interface Context {
    parseLinkRefDef(tokens: Uint8Array): Uint8Array | null;
    parseLinkTitle(tokens: Uint8Array): [boolean, Uint8Array, Uint8Array, Uint8Array | null];
    parseBlockRefText(tokens: Uint8Array): [boolean, Uint8Array, Uint8Array, Uint8Array | null, string];
    parseLinkTitleMatch(opener: number, closer: number, tokens: Uint8Array): [boolean, Uint8Array, Uint8Array, Uint8Array | null];
    parseLinkDest(tokens: Uint8Array): [Uint8Array | null, Uint8Array, Uint8Array];
    parseLinkDest2(tokens: Uint8Array): [Uint8Array | null, Uint8Array, Uint8Array];
    parseLinkDest1(tokens: Uint8Array): [Uint8Array | null, Uint8Array, Uint8Array];
    parseLinkLabel(tokens: Uint8Array): [number, Uint8Array, Uint8Array];
  }
}

Context.prototype.parseLinkRefDef = function (this: Context, tokens: Uint8Array): Uint8Array | null {
  const context = this;
  if (!context.ParseOption.LinkRef) {
    return null;
  }

  [, tokens] = lex.TrimLeft(tokens);
  if (1 > tokens.length) {
    return null;
  }

  let n = 0;
  let remains: Uint8Array = new Uint8Array(0);
  let label: Uint8Array = new Uint8Array(0);
  [n, remains, label] = context.parseLinkLabel(tokens);
  if (2 > n || 1 > label.length) {
    return null;
  }

  const length = remains.length;
  if (1 > length) {
    return null;
  }

  if (0x3a /* : */ !== remains[0]) {
    return null;
  }

  remains = remains.subarray(1);
  let whitespaces: Uint8Array | null = null;
  [whitespaces, remains] = lex.TrimLeft(remains);
  let newlines = 0;
  [newlines] = lex.StatWhitespace(whitespaces ?? new Uint8Array(0));
  if (1 < newlines) {
    return null;
  }

  tokens = remains;
  let linkDest: Uint8Array | null = null;
  let destination: Uint8Array = new Uint8Array(0);
  [linkDest, remains, destination] = context.parseLinkDest(tokens);
  if (null === linkDest) {
    return null;
  }

  [whitespaces, remains] = lex.TrimLeft(remains);
  if (null === whitespaces && 0 < remains.length) {
    return null;
  }
  let spaces1 = 0;
  let tabs1 = 0;
  [newlines, spaces1, tabs1] = lex.StatWhitespace(whitespaces ?? new Uint8Array(0));
  if (1 < newlines) {
    return null;
  }

  [, tokens] = lex.TrimLeft(remains);
  let validTitle = false;
  let title: Uint8Array | null = null;
  [validTitle, , remains, title] = context.parseLinkTitle(tokens);
  if (!validTitle && 1 > newlines) {
    return null;
  }
  if (0 < spaces1 + tabs1 && !lex.IsBlankLine(remains) && lex.ItemNewline !== remains[0]) {
    return null;
  }

  const titleLine = tokens;
  [whitespaces, tokens] = lex.TrimLeft(remains);
  let spaces2 = 0;
  let tabs2 = 0;
  [, spaces2, tabs2] = lex.StatWhitespace(whitespaces ?? new Uint8Array(0));
  if (!lex.IsBlankLine(tokens) && 0 < spaces2 + tabs2) {
    remains = titleLine;
  } else {
    remains = tokens;
  }

  const link = context.Tree!.newLink(ast.NodeLink, label, destination, title, 1);
  const def = new ast.Node(ast.NodeLinkRefDef, label);
  def.AppendChild(link);
  let defBlock: ast.Node = context.Tip!;
  if (ast.NodeLinkRefDefBlock !== defBlock.Type) {
    defBlock = new ast.Node(ast.NodeLinkRefDefBlock);
  }
  defBlock.AppendChild(def);
  context.Tip!.Parent!.AppendChild(defBlock);
  return remains;
};

Context.prototype.parseLinkTitle = function (this: Context, tokens: Uint8Array): [boolean, Uint8Array, Uint8Array, Uint8Array | null] {
  const context = this;
  let validTitle = false;
  let passed: Uint8Array = new Uint8Array(0);
  let remains: Uint8Array = new Uint8Array(0);
  let title: Uint8Array | null = null;
  if (1 > tokens.length) {
    return [true, new Uint8Array(0), tokens, null];
  }
  if (lex.ItemOpenBracket === tokens[0]) {
    return [true, new Uint8Array(0), tokens, null];
  }

  [validTitle, passed, remains, title] = context.parseLinkTitleMatch(lex.ItemDoublequote, lex.ItemDoublequote, tokens);
  if (!validTitle) {
    [validTitle, passed, remains, title] = context.parseLinkTitleMatch(lex.ItemSinglequote, lex.ItemSinglequote, tokens);
    if (!validTitle) {
      [validTitle, passed, remains, title] = context.parseLinkTitleMatch(lex.ItemOpenParen, lex.ItemCloseParen, tokens);
    }
  }
  if (null !== title) {
    if (!context.ParseOption.VditorWYSIWYG && !context.ParseOption.VditorIR && !context.ParseOption.VditorSV && !context.ParseOption.ProtyleWYSIWYG) {
      title = html.UnescapeBytes(title);
    }
  }
  return [validTitle, passed, remains, title];
};

Context.prototype.parseBlockRefText = function (this: Context, tokens: Uint8Array): [boolean, Uint8Array, Uint8Array, Uint8Array | null, string] {
  const context = this;
  let validTitle = false;
  let passed: Uint8Array = new Uint8Array(0);
  let remains: Uint8Array = new Uint8Array(0);
  let title: Uint8Array | null = null;
  let subtype = "";
  if (1 > tokens.length) {
    return [true, new Uint8Array(0), tokens, null, ""];
  }
  if (lex.ItemOpenBracket === tokens[0]) {
    return [true, new Uint8Array(0), tokens, null, ""];
  }

  [validTitle, passed, remains, title] = context.parseLinkTitleMatch(lex.ItemDoublequote, lex.ItemDoublequote, tokens);
  subtype = "s";
  if (!validTitle) {
    [validTitle, passed, remains, title] = context.parseLinkTitleMatch(lex.ItemSinglequote, lex.ItemSinglequote, tokens);
    subtype = "d";
  }
  if (null !== title) {
    if (!context.ParseOption.VditorWYSIWYG && !context.ParseOption.VditorIR && !context.ParseOption.VditorSV && !context.ParseOption.ProtyleWYSIWYG) {
      title = html.UnescapeBytes(title);
    }
  }
  return [validTitle, passed, remains, title, subtype];
};

Context.prototype.parseLinkTitleMatch = function (this: Context, opener: number, closer: number, tokens: Uint8Array): [boolean, Uint8Array, Uint8Array, Uint8Array | null] {
  const context = this;
  let validTitle = false;
  let passed: Uint8Array = new Uint8Array(0);
  let remains: Uint8Array = new Uint8Array(0);
  let title: Uint8Array | null = null;
  remains = tokens;
  let length = tokens.length;
  if (2 > length) {
    return [validTitle, passed, remains, title];
  }

  if (opener !== tokens[0]) {
    return [validTitle, passed, remains, title];
  }

  const line = tokens;
  length = line.length;
  let closed = false;
  let i = 1;
  let size = 0;
  let r = 0;
  for (; i < length; i += size) {
    const token = line[i];
    passed = slices.AppendByte(passed, token);
    const v = utf8.DecodeRunePacked(line, i);
    r = v & 0xFFFFFF;
    size = v >>> 24;
    for (let j = 1; j < size; j++) {
      passed = slices.AppendByte(passed, tokens[i + j]);
    }
    title = slices.Append(title ?? new Uint8Array(0), utf8.RuneBytes(r));
    if (closer === token && !lex.IsBackslashEscapePunct(tokens, i)) {
      closed = true;
      title = title.subarray(0, title.length - 1);
      break;
    }
  }

  if (!closed) {
    passed = new Uint8Array(0);
    return [validTitle, passed, remains, title];
  }

  validTitle = true;
  remains = tokens.subarray(i + 1);
  return [validTitle, passed, remains, title];
};

Context.prototype.parseLinkDest = function (this: Context, tokens: Uint8Array): [Uint8Array | null, Uint8Array, Uint8Array] {
  const context = this;
  let ret: Uint8Array | null = null;
  let remains: Uint8Array = new Uint8Array(0);
  let destination: Uint8Array = new Uint8Array(0);
  [ret, remains, destination] = context.parseLinkDest1(tokens); // <autolink>
  if (null === ret) {
    [ret, remains, destination] = context.parseLinkDest2(tokens); // [label](/url)
  }
  if (null !== ret) {
    if (!context.ParseOption.VditorWYSIWYG && !context.ParseOption.VditorIR && !context.ParseOption.VditorSV && !context.ParseOption.ProtyleWYSIWYG) {
      destination = html.EncodeDestination(html.UnescapeBytes(destination)!);
    }
  }
  return [ret, remains, destination];
};

Context.prototype.parseLinkDest2 = function (this: Context, tokens: Uint8Array): [Uint8Array | null, Uint8Array, Uint8Array] {
  const context = this;
  let ret: Uint8Array | null = null;
  let remains: Uint8Array = new Uint8Array(0);
  let destination: Uint8Array = new Uint8Array(0);
  remains = tokens;
  const length = tokens.length;
  if (1 > length) {
    return [ret, remains, destination];
  }

  ret = slices.Make(0, 256);
  destination = slices.Make(0, 256);

  let openParens = 0;
  let i = 0;
  let size = 0;
  let r = 0;
  while (i < length) {
    const token = tokens[i];
    ret = slices.AppendByte(ret, token);
    const v = utf8.DecodeRunePacked(tokens, i);
    r = v & 0xFFFFFF;
    size = v >>> 24;
    for (let j = 1; j < size; j++) {
      ret = slices.AppendByte(ret, tokens[i + j]);
    }
    destination = slices.Append(destination, utf8.RuneBytes(r));
    if (lex.IsWhitespace(token) || lex.IsControl(token)) {
      destination = destination.subarray(0, destination.length - 1);
      ret = ret.subarray(0, ret.length - 1);
      break;
    }

    if (lex.ItemOpenParen === token && !lex.IsBackslashEscapePunct(tokens, i)) {
      openParens++;
    }
    if (lex.ItemCloseParen === token && !lex.IsBackslashEscapePunct(tokens, i)) {
      openParens--;
      if (1 > openParens) {
        i++;
        break;
      }
    }

    i += size;
  }

  remains = tokens.subarray(i);
  if (length > i && !lex.IsWhitespace(tokens[i])) {
    ret = null;
    return [ret, remains, destination];
  }

  return [ret, remains, destination];
};

Context.prototype.parseLinkDest1 = function (this: Context, tokens: Uint8Array): [Uint8Array | null, Uint8Array, Uint8Array] {
  const context = this;
  let ret: Uint8Array | null = null;
  let remains: Uint8Array = new Uint8Array(0);
  let destination: Uint8Array = new Uint8Array(0);
  remains = tokens;
  const length = tokens.length;
  if (2 > length) {
    return [ret, remains, destination];
  }

  if (lex.ItemLess !== tokens[0]) {
    return [ret, remains, destination];
  }

  ret = slices.Make(0, 256);
  destination = slices.Make(0, 256);

  let closed = false;
  let i = 0;
  let size = 0;
  let r = 0;
  for (; i < length; i += size) {
    const token = tokens[i];
    ret = slices.AppendByte(ret, token);
    size = 1;
    if (0 < i) {
      const v = utf8.DecodeRunePacked(tokens, i);
      r = v & 0xFFFFFF;
      size = v >>> 24;
      for (let j = 1; j < size; j++) {
        ret = slices.AppendByte(ret, tokens[i + j]);
      }
      destination = slices.Append(destination, utf8.RuneBytes(r));
      if (lex.ItemLess === token && !lex.IsBackslashEscapePunct(tokens, i)) {
        ret = null;
        return [ret, remains, destination];
      }
    }

    if (lex.ItemGreater === token && !lex.IsBackslashEscapePunct(tokens, i)) {
      closed = true;
      destination = destination.subarray(0, destination.length - 1);
      break;
    }
  }

  if (!closed) {
    ret = null;
    return [ret, remains, destination];
  }

  remains = tokens.subarray(i + 1);

  return [ret, remains, destination];
};

Context.prototype.parseLinkLabel = function (this: Context, tokens: Uint8Array): [number, Uint8Array, Uint8Array] {
  const context = this;
  let n = 0;
  let remains: Uint8Array = new Uint8Array(0);
  let label: Uint8Array = new Uint8Array(0);
  const length = tokens.length;
  if (2 > length) {
    return [n, remains, label];
  }

  if (lex.ItemOpenBracket !== tokens[0]) {
    return [n, remains, label];
  }

  let closed = false;
  let i = 1;
  while (i < length) {
    const token = tokens[i];
    const v = utf8.DecodeRunePacked(tokens, i);
    const r = v & 0xFFFFFF;
    const size = v >>> 24;
    label = slices.Append(label, utf8.RuneBytes(r));
    if (lex.ItemCloseBracket === token && !lex.IsBackslashEscapePunct(tokens, i)) {
      closed = true;
      label = label.subarray(0, label.length - 1);
      remains = tokens.subarray(i + 1);
      break;
    }
    if (lex.ItemOpenBracket === token && !lex.IsBackslashEscapePunct(tokens, i)) {
      return [n, remains, label];
    }
    i += size;
  }

  if (!closed || null === lex.TrimWhitespace(label) || 999 < label.length) {
    return [n, remains, label];
  }

  label = lex.TrimWhitespace(label)!;
  if (!context.ParseOption.VditorWYSIWYG && !context.ParseOption.VditorIR && !context.ParseOption.VditorSV && !context.ParseOption.ProtyleWYSIWYG) {
    label = lex.ReplaceAll(label, lex.ItemNewline, lex.ItemSpace);
    let length = label.length;
    let token = 0;
    for (let i = 0; i < length; i++) {
      token = label[i];
      if (token === lex.ItemSpace && i < length - 1 && label[i + 1] === lex.ItemSpace) {
        label = slices.Append(label.subarray(0, i), label.subarray(i + 1));
        length--;
      }
    }
  }
  n = i + 1;
  return [n, remains, label];
};
