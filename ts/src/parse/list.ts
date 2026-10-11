// Ported from parse/list.go @ 8e7896b6
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
import * as strconv from "../runtime/strconv.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { IAL2Tokens } from "./inline_attribute_list.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseListMarker(container: ast.Node): [ast.ListData | null, string[][] | null];
    parseOrderedListMarker(tokens: Uint8Array): [Uint8Array | null, number];
  }
  interface Context {
    listFinalize(list: ast.Node): void;
  }
}

const emptyTokens: Uint8Array = new Uint8Array(0);
const dotSpaceTokens: Uint8Array = conv.BytesFromString(". ");
const dotTokens: Uint8Array = conv.BytesFromString(".");
const closeBraceTokens: Uint8Array = conv.BytesFromString("}");

// ListStart decides whether a list, list item (* - + 1.) or task list item starts.
export function ListStart(t: Tree, container: ast.Node): number {
  if (ast.NodeList !== container.Type && t.Context!.indented) {
    return 0;
  }

  const [data, ial] = t.parseListMarker(container);
  if (null === data) {
    return 0;
  }

  // When the list item is empty, add an empty paragraph before creating the sub list, to avoid a list directly under a list item https://github.com/siyuan-note/siyuan/issues/17890
  let emptyListItem: ast.Node | null = null;
  if (t.Context!.ParseOption.EnsureListItemParagraph && ast.NodeListItem === t.Context!.Tip!.Type) {
    const fc = t.Context!.Tip!.FirstChild;
    if (null === fc || ast.NodeKramdownBlockIAL === fc.Type) {
      emptyListItem = t.Context!.Tip;
    }
  }

  t.Context!.closeUnmatchedBlocks();

  // closeUnmatchedBlocks may already have triggered listFinalize, which adds a paragraph to this empty list item, so do not append it again
  // https://github.com/siyuan-note/siyuan/issues/17890
  if (null !== emptyListItem && null === emptyListItem.FirstChild) {
    const p = new ast.Node(ast.NodeParagraph);
    if (t.Context!.ParseOption.KramdownBlockIAL) {
      const id = ast.NewNodeID();
      const ialTokens = conv.BytesFromString("{: id=\"" + id + "\"}");
      p.ID = id;
      p.KramdownIAL = [["id", id]];
      p.AppendChild(new ast.Node(ast.NodeKramdownBlockIAL, ialTokens));
    }
    emptyListItem.AppendChild(p);
  }

  const listsMatch = container.Type === ast.NodeList && t.Context!.listsMatch(container.ListData!, data);
  if (t.Context!.Tip!.Type !== ast.NodeList || !listsMatch) {
    const list = t.Context!.addChild(ast.NodeList);
    list.ListData = data;
  }
  const listItem = t.Context!.addChild(ast.NodeListItem);
  listItem.ListData = data;
  if (t.Context!.ParseOption.KramdownBlockIAL && null !== ial) {
    listItem.KramdownIAL = ial;
    listItem.ID = listItem.IALAttr("id");
    t.Context!.offset += IAL2Tokens(ial).length;
  }

  listItem.Tokens = data.Marker;
  if (1 === listItem.ListData.Typ || (3 === listItem.ListData.Typ && 0 === listItem.ListData.BulletChar)) {
    // Correct the ordered list item number
    const prev = listItem.Previous;
    if (null !== prev) {
      listItem.ListData.Num = prev.ListData!.Num + 1;
    } else {
      listItem.ListData.Num = data.Start;
    }
  }
  return 1;
}

export function ListItemContinue(listItem: ast.Node, context: Context): number {
  if (context.blank) {
    if (null === listItem.FirstChild) { // The list item is empty after the marker
      return 1;
    }

    context.advanceNextNonspace();
  } else if (context.indent >= listItem.ListData!.MarkerOffset + listItem.ListData!.Padding) {
    context.advanceOffset(listItem.ListData!.MarkerOffset + listItem.ListData!.Padding, true);
  } else {
    return 1;
  }
  return 0;
}

Context.prototype.listFinalize = function (this: Context, list: ast.Node): void {
  const context = this;
  let item = list.FirstChild;

  // Check whether the child list items contain blank lines; if so, the list is not tight, that is, it is loose
  for (; null !== item;) {
    if (endsWithBlankLine(item) && null !== item.Next) {
      list.ListData!.Tight = false;
      break;
    }

    let subItem = item.FirstChild;
    for (; null !== subItem;) {
      if (endsWithBlankLine(subItem) && (null !== item.Next || null !== subItem.Next)) {
        list.ListData!.Tight = false;
        break;
      }
      subItem = subItem.Next;
    }
    item = item.Next;
  }

  if (context.ParseOption.KramdownBlockIAL) {
    for (let li = list.FirstChild; null !== li; li = li.Next) {
      if (null === li.FirstChild) {
        if (ast.NodeKramdownBlockIAL !== li.Type) {
          let id = ast.NewNodeID();
          let ialTokens: Uint8Array = conv.BytesFromString("{: id=\"" + id + "\"}");
          li.KramdownIAL = [["id", id]];
          li.ID = id;
          li.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, ialTokens));

          id = ast.NewNodeID();
          ialTokens = conv.BytesFromString("{: id=\"" + id + "\"}");
          const p = new ast.Node(ast.NodeParagraph);
          p.ID = id;
          p.KramdownIAL = [["id", id]];
          p.ID = id;
          p.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, ialTokens));
          li.AppendChild(p);
          li = li.Next!;
        }

        continue;
      }

      const firstChildTokens: Uint8Array = li.FirstChild.Tokens ?? emptyTokens;
      if (7 < firstChildTokens.length && 0x7b /* { */ === firstChildTokens[0]) {
        const ial = context.parseKramdownIALInListItem(li.FirstChild.Tokens);
        if (null !== ial && 0 < ial.length) {
          li.KramdownIAL = ial;
          li.ID = ial[0][1];
          const ialTokens = IAL2Tokens(ial);
          li.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, ialTokens));
          let tokens: Uint8Array | null = firstChildTokens.subarray(bytes.Index(firstChildTokens, closeBraceTokens) + 1);
          tokens = lex.TrimWhitespace(tokens);
          li.FirstChild.Tokens = tokens;
          li = li.Next!;
        }
      } else {
        let ialTokens: Uint8Array;
        if (null === li.KramdownIAL) {
          const id = ast.NewNodeID();
          ialTokens = conv.BytesFromString("{: id=\"" + id + "\"}");
          li.KramdownIAL = [["id", id]];
          li.ID = id;
        } else {
          ialTokens = IAL2Tokens(li.KramdownIAL);
        }
        li.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, ialTokens));
      }
    }
  }
};

const items1: Uint8Array = util.StrToBytes("1");

// parseListMarker parses the generic list (list, list item or task list) marker.
Tree.prototype.parseListMarker = function (this: Tree, container: ast.Node): [ast.ListData | null, string[][] | null] {
  const t = this;
  let ial: string[][] | null = null;
  if (4 <= t.Context!.indent) {
    return [null, null];
  }

  let ln: Uint8Array = t.Context!.currentLine;
  if (t.Context!.ParseOption.ProtyleWYSIWYG) {
    const beforeDotTokensIdx = bytes.Index(ln, dotSpaceTokens);
    if (-1 < beforeDotTokensIdx) {
      let beforeCaretDotTokens: Uint8Array = ln.subarray(0, beforeDotTokensIdx);
      if (-1 < bytes.Index(beforeCaretDotTokens, editor.CaretTokens)) {
        beforeCaretDotTokens = bytes.ReplaceAll(beforeCaretDotTokens, editor.CaretTokens, emptyTokens);
        if (util.IsDigit(util.BytesToStr(beforeCaretDotTokens))) {
          ln = bytes.ReplaceAll(ln, editor.CaretTokens, emptyTokens);
          ln = bytes.Replace(ln, dotSpaceTokens, conv.BytesFromString(". " + editor.Caret), 1);
          t.Context!.currentLine = ln;
        }
      }
    }
  }

  const tokens: Uint8Array = ln.subarray(t.Context!.nextNonspace);
  const data = new ast.ListData();
  data.Typ = 0; // Unordered list by default
  data.Tight = true; // Tight mode by default
  data.MarkerOffset = t.Context!.indent; // Set the leading relative indent
  data.Num = -1; // Assume an ordered list starts at -1, it is calculated and assigned later

  let markerLength = 1;
  let marker: Uint8Array | null = new Uint8Array([tokens[0]]);
  let delim = 0;
  if (lex.ItemPlus === marker[0] || lex.ItemHyphen === marker[0] || lex.ItemAsterisk === marker[0]) {
    data.BulletChar = marker[0];
  } else {
    [marker, delim] = t.parseOrderedListMarker(tokens);
    if (null !== marker) {
      if (container.Type !== ast.NodeParagraph || bytes.Equal(items1, marker)) {
        data.Typ = 1; // Ordered list
        [data.Start] = strconv.Atoi(util.BytesToStr(marker));
        markerLength = marker.length + 1;
        data.Delimiter = delim;
      } else {
        return [null, null];
      }
    } else {
      return [null, null];
    }
  }

  data.Marker = marker;
  if (1 === data.Typ) {
    data.Marker = slices.Append(data.Marker, dotTokens);
  }

  let token = ln[t.Context!.nextNonspace + markerLength];

  // The list item marker must be followed by a whitespace character
  if (!lex.IsWhitespace(token)) {
    return [null, null];
  }

  // If it interrupts a paragraph, the list item content must not be empty
  if (container.Type === ast.NodeParagraph && lex.ItemNewline === token) {
    return [null, null];
  }

  // The list rule is satisfied here, start parsing and calculate the number of inner indent spaces
  t.Context!.advanceNextNonspace(); // Move the start index to the start of the marker
  t.Context!.advanceOffset(markerLength, true); // Move the end index to the end of the marker
  const spacesStartCol = t.Context!.column;
  const spacesStartOffset = t.Context!.offset;
  for (;;) {
    t.Context!.advanceOffset(1, true);
    token = lex.Peek(ln, t.Context!.offset);
    if (t.Context!.column - spacesStartCol >= 5 || 0 === (token) || (lex.ItemSpace !== token && lex.ItemTab !== token)) {
      break;
    }
  }

  token = lex.Peek(ln, t.Context!.offset);
  const isBlankItem = 0 === token || lex.ItemNewline === token;
  const spacesAfterMarker = t.Context!.column - spacesStartCol;
  if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || isBlankItem) {
    data.Padding = markerLength + 1;
    t.Context!.column = spacesStartCol;
    t.Context!.offset = spacesStartOffset;
    token = lex.Peek(ln, t.Context!.offset);
    if (lex.ItemSpace === token || lex.ItemTab === token) {
      t.Context!.advanceOffset(1, true);
    }
  } else {
    data.Padding = markerLength + spacesAfterMarker;
  }

  if (!isBlankItem) {
    // Decide whether it is a task list item

    let tokens: Uint8Array = ln.subarray(t.Context!.offset);
    if (t.Context!.ParseOption.KramdownBlockIAL) {
      ial = t.Context!.parseKramdownIALInListItem(tokens);
      if (null !== ial && 0 < ial.length) {
        tokens = tokens.subarray(bytes.Index(tokens, closeBraceTokens) + 1);
      }
    }

    if (t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV) {
      tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyTokens);
    }

    if (3 <= tokens.length) { // At least 3 characters are needed: [ ] or [x]
      if (lex.ItemOpenBracket === tokens[0] && lex.ItemCloseBracket !== tokens[1] && lex.ItemCloseBracket === tokens[2] &&
        (3 === tokens.length || lex.IsWhitespace(tokens[3]))) {
        const marker = tokens[1];
        if (t.Context!.ParseOption.IsValidTaskListItemMarker(marker)) {
          data.Typ = 3;
          data.Checked = marker !== 0x20 /* space */;
        }
      }
    }
  }
  return [data, ial];
};

Tree.prototype.parseOrderedListMarker = function (this: Tree, tokens: Uint8Array): [Uint8Array | null, number] {
  let marker: Uint8Array | null = null;
  let delimiter = 0;
  const length = tokens.length;
  let i = 0;
  let token = 0;
  for (; i < length; i++) {
    token = tokens[i];
    if (!lex.IsDigit(token) || 8 < i) {
      delimiter = token;
      break;
    }
    marker = slices.AppendByte(marker ?? emptyTokens, token);
  }

  if (null === marker || 1 > marker.length || (lex.ItemDot !== delimiter && lex.ItemCloseParen !== delimiter)) {
    return [null, 0];
  }

  return [marker, delimiter];
};

// endsWithBlankLine decides whether block node block ends with a blank line. If block is a list or a list item, it descends iteratively.
function endsWithBlankLine(block: ast.Node | null): boolean {
  for (; null !== block;) {
    if (block.LastLineBlank) {
      return true;
    }
    const t = block.Type;
    if (!block.LastLineChecked && (t === ast.NodeList || t === ast.NodeListItem)) {
      block.LastLineChecked = true;
      block = block.LastChild;
    } else {
      block.LastLineChecked = true;
      break;
    }
  }

  return false;
}
