// Ported from parse/heading.go @ 8e7896b6
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
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseATXHeading(): [boolean, Uint8Array, Uint8Array, number];
    parseSetextHeading(): number;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const crosshatchCaretCrosshatchTokens: Uint8Array = conv.BytesFromString("#" + editor.Caret + "#");
const spaceCaretTokens: Uint8Array = conv.BytesFromString(" " + editor.Caret);

// ATXHeadingStart decides whether an ATX heading (#) starts.
export function ATXHeadingStart(t: Tree, container: ast.Node): number {
  if (t.Context!.indented) {
    return 0;
  }

  const [ok, markers, content, level] = t.parseATXHeading();
  if (ok) {
    t.Context!.advanceNextNonspace();
    t.Context!.advanceOffset(content.length, false);
    t.Context!.closeUnmatchedBlocks();
    const heading = t.Context!.addChild(ast.NodeHeading);
    heading.HeadingLevel = level;
    heading.Tokens = content;
    const crosshatchMarker = new ast.Node(ast.NodeHeadingC8hMarker, markers);
    heading.AppendChild(crosshatchMarker);
    t.Context!.advanceOffset(t.Context!.currentLineLen - t.Context!.offset, false);
    return 2;
  }
  return 0;
}

// SetextHeadingStart decides whether a Setext heading (- =) starts.
export function SetextHeadingStart(t: Tree, container: ast.Node): number {
  if (t.Context!.indented || ast.NodeParagraph !== container.Type || !t.Context!.ParseOption.Setext) {
    return 0;
  }

  const level = t.parseSetextHeading();
  if (0 === level) {
    return 0;
  }

  if (t.Context!.ParseOption.GFMTable) {
    // Try to parse a table, because the following case is possible:
    //
    //   0
    //   -:
    //   -
    //
    // The first two lines can be parsed into a table with a single cell.
    // Empty list following GFM Table makes table broken https://github.com/b3log/lute/issues/9
    const table = t.Context!.parseTable0(container.Tokens ?? emptyTokens);
    if (null !== table) {
      // Convert the paragraph node into a table node
      container.Type = ast.NodeTable;
      container.TableAligns = table.TableAligns;
      for (let tr = table.FirstChild; null !== tr;) {
        const nextTr: ast.Node | null = tr.Next;
        container.AppendChild(tr);
        tr = nextTr;
      }
      container.Tokens = null;
      return 0;
    }
  }

  t.Context!.closeUnmatchedBlocks();
  // Parse link reference definitions
  for (let tokens = container.Tokens; null !== tokens && 0 < tokens.length && lex.ItemOpenBracket === tokens[0]; tokens = container.Tokens) {
    const remains = t.Context!.parseLinkRefDef(tokens);
    if (null !== remains) {
      container.Tokens = remains;
    } else {
      break;
    }
  }

  if (null !== container.Tokens && 0 < container.Tokens.length) {
    const child = new ast.Node(ast.NodeHeading);
    child.HeadingLevel = level;
    child.HeadingSetext = true;
    child.Tokens = lex.TrimWhitespace(container.Tokens);
    container.InsertAfter(child);
    container.Unlink();
    t.Context!.Tip = child;
    t.Context!.advanceOffset(t.Context!.currentLineLen - t.Context!.offset, false);
    return 2;
  }
  return 0;
}

// parseATXHeading returns (ok, markers, content, level).
Tree.prototype.parseATXHeading = function (this: Tree): [boolean, Uint8Array, Uint8Array, number] {
  const t = this;
  let ok = false;
  let markers: Uint8Array = emptyTokens;
  let content: Uint8Array = emptyTokens;
  let level = 0;

  let tokens: Uint8Array = t.Context!.currentLine.subarray(t.Context!.nextNonspace);
  let startCaret = false;
  if ((t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) && bytes.HasPrefix(tokens, editor.CaretTokens)) {
    tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
    startCaret = true;
  }

  const marker = tokens[0];
  if (lex.ItemCrosshatch !== marker) {
    return [ok, markers, content, level];
  }

  let inCaret = false;
  if ((t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV) && bytes.Contains(tokens, crosshatchCaretCrosshatchTokens)) {
    tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
    inCaret = true;
  }

  level = lex.Accept(tokens, lex.ItemCrosshatch);
  if (6 < level) {
    return [ok, markers, content, level];
  }

  let endCaret = false;
  if ((t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV) && bytes.HasPrefix(tokens.subarray(level), spaceCaretTokens)) {
    tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
    endCaret = true;
  }

  if (level < tokens.length && !lex.IsWhitespace(tokens[level])) {
    return [ok, markers, content, level];
  }

  markers = t.Context!.currentLine.subarray(t.Context!.nextNonspace, t.Context!.nextNonspace + level + 1);

  content = slices.Make(0, 256);
  [, tokens] = lex.TrimLeft(tokens);
  [, tokens] = lex.TrimLeft(tokens.subarray(level));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (lex.ItemNewline === token) {
      break;
    }
    content = slices.AppendByte(content, token);
  }
  [, content] = lex.TrimRight(content);
  let closingCrosshatchIndex = content.length - 1;
  for (; 0 <= closingCrosshatchIndex; closingCrosshatchIndex--) {
    if (lex.ItemCrosshatch === content[closingCrosshatchIndex]) {
      continue;
    }
    if (lex.ItemSpace === content[closingCrosshatchIndex]) {
      break;
    } else {
      closingCrosshatchIndex = content.length;
      break;
    }
  }

  if (0 >= closingCrosshatchIndex) {
    content = new Uint8Array(0);
  } else if (0 < closingCrosshatchIndex) {
    content = content.subarray(0, closingCrosshatchIndex);
    [, content] = lex.TrimRight(content);
  }

  if (t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) {
    if (startCaret || inCaret || endCaret) {
      content = slices.Append(editor.CaretTokens, content);
    }
  }
  [, content] = lex.TrimRight(content);
  ok = true;
  return [ok, markers, content, level];
};

Tree.prototype.parseSetextHeading = function (this: Tree): number {
  const t = this;
  let level = 0;
  let ln: Uint8Array = lex.TrimWhitespace(t.Context!.currentLine) ?? emptyTokens;
  let caretInLn = false;
  if (t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) {
    if (bytes.Contains(ln, editor.CaretTokens)) {
      caretInLn = true;
      ln = bytes.ReplaceAll(ln, editor.CaretTokens, emptyTokens);
      if (1 > ln.length) {
        return level;
      }
    }
  }

  let start = 0;
  let marker = ln[start];
  if (lex.ItemEqual !== marker && lex.ItemHyphen !== marker) {
    return level;
  }

  const length = ln.length;
  for (; start < length; start++) {
    const token = ln[start];
    if (lex.ItemEqual !== token && lex.ItemHyphen !== token) {
      return level;
    }

    if (0 !== marker) {
      if (marker !== token) {
        return level;
      }
    } else {
      marker = token;
    }
  }

  level = 1;
  if (lex.ItemHyphen === marker) {
    level = 2;
  }

  if ((t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG) && caretInLn) {
    t.Context!.oldtip!.Tokens = lex.TrimWhitespace(t.Context!.oldtip!.Tokens); // null stays null, as nil does in Go
    t.Context!.oldtip!.AppendTokens(editor.CaretTokens);
  }
  return level;
};
