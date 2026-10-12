// Ported from parse/table.go @ 8e7896b6
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
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import { Context } from "./types.ts";

declare module "./types.ts" {
  interface Context {
    parseTable(paragraph: ast.Node): [ast.Node | null, ast.Node | null];
    parseTable0(tokens: Uint8Array): ast.Node | null;
    newTableHead(headRows: ast.Node[]): ast.Node;
    parseTableRow(line: Uint8Array, aligns: number[], isHead: boolean): ast.Node | null;
    findTableDelimRow(lines: Uint8Array[]): number;
    parseTableDelimRow(line: Uint8Array): number[] | null;
    tableDelimAlign(col: Uint8Array): number;
  }
}

const curlyBracesOpenColon: Uint8Array = conv.BytesFromString("{:");
const pipeBytes: Uint8Array = conv.BytesFromString("|");
const newlineBytes: Uint8Array = conv.BytesFromString("\n");
const escapedPipe: Uint8Array = conv.BytesFromString("\\|");
const escapedPipeEntity: Uint8Array = conv.BytesFromString("\\&#124;");
const pipeEntity: Uint8Array = conv.BytesFromString("&#124;");

// TableCellStyleAlign reads the horizontal alignment from the inline style of a cell.
export function TableCellStyleAlign(style: string): [number, boolean] {
  let align = 0;
  let found = false;
  for (const declaration of strings.Split(style, ";")) {
    const [property, value0, ok] = strings.Cut(declaration, ":");
    if (!ok || !strings.EqualFold(strings.TrimSpace(property), "text-align")) {
      continue;
    }
    found = true;
    const value = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(value0), "!important")));
    switch (value) {
      case "left":
        align = 1;
        break;
      case "center":
        align = 2;
        break;
      case "right":
        align = 3;
        break;
      default:
        align = 0;
        break;
    }
  }
  return [align, found];
}

// TableCellAlignValue is compatible with the old align attribute, and the inline style takes precedence.
export function TableCellAlignValue(align: string, style: string): number {
  let value = 0;
  switch (strings.ToLower(strings.TrimSpace(align))) {
    case "left":
      value = 1;
      break;
    case "center":
      value = 2;
      break;
    case "right":
      value = 3;
      break;
  }
  const [styleValue, found] = TableCellStyleAlign(style);
  if (found) {
    return styleValue;
  }
  return value;
}

// isTableCellIAL determines whether the IAL contains structure or style attributes that must be kept when a table cell round-trips.
export function isTableCellIAL(ial: string[][]): boolean {
  for (const attr of ial) {
    switch (attr[0]) {
      case "colspan":
      case "rowspan":
      case "style":
      case ast.TableCellRichIAL:
        return true;
      case "class":
        for (const cls of strings.Fields(attr[1])) {
          if ("fn__none" === cls) {
            return true;
          }
        }
        break;
    }
  }
  return false;
}

Context.prototype.parseTable = function (this: Context, paragraph: ast.Node): [ast.Node | null, ast.Node | null] {
  const context = this;
  let retParagraph: ast.Node | null = null;
  let retTable: ast.Node | null = null;
  let tokens: Uint8Array = new Uint8Array(0);
  const paragraphTokens: Uint8Array = paragraph.Tokens ?? new Uint8Array(0); // PORT-NOTE: Go's nil Tokens has length 0
  const length = paragraphTokens.length;
  let lineCnt = 0;
  for (let i = 0; i < length; i++) {
    if (context.ParseOption.ProtyleWYSIWYG) {
      if (-1 === bytes.IndexByte(paragraphTokens, lex.ItemPipe)) {
        // In Protyle mode lines without a pipe in a column are all put into the paragraph, so no table can be parsed without a pipe
        return [retParagraph, retTable];
      }

      let lines = lex.Split(paragraphTokens, lex.ItemNewline);

      // Lines without | are still put into the paragraph
      const beforeTableLines: Uint8Array[] = [];
      for (let j = 0; j < lines.length; j++) {
        if (!bytes.Contains(lines[j], pipeBytes)) {
          beforeTableLines.push(lines[j]);
        }
      }
      lines = lines.slice(beforeTableLines.length);

      const delimRowIndex = context.findTableDelimRow(lines);
      if (1 > delimRowIndex) {
        return [retParagraph, retTable];
      }

      const aligns = context.parseTableDelimRow(lex.TrimWhitespace(lines[delimRowIndex])!);
      if (null === aligns) {
        return [retParagraph, retTable];
      }

      const headRows: ast.Node[] = [];
      for (let j = 0; j < delimRowIndex; j++) {
        const headRow = context.parseTableRow(lex.TrimWhitespace(lines[j])!, aligns, true);
        if (null === headRow) {
          return [retParagraph, retTable];
        }
        headRows.push(headRow);
        for (let th = headRow.FirstChild; null !== th; th = th.Next) {
          const ialStart = bytes.Index(th.Tokens ?? new Uint8Array(0), curlyBracesOpenColon);
          if (0 !== ialStart) {
            continue;
          }

          const subTokens = th.Tokens!.subarray(ialStart);
          const [pos, ial] = context.parseKramdownSpanIAL(subTokens);
          if (0 < ial.length) {
            const ialTokens = subTokens.subarray(0, pos + 1);
            if (isTableCellIAL(ial)) {
              th.KramdownIAL = ial;
              const [align, found] = TableCellStyleAlign(th.IALAttr("style"));
              if (found) {
                th.TableCellAlign = align;
              }
              th.Tokens = th.Tokens!.subarray(ialTokens.length);
              const spanIAL = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
              th.PrependChild(spanIAL);
            }
          }
        }
      }

      this.hasTable = true; // PORT-NOTE: perf, departs from 1:1 (parse/table.go:139): records that a table node was created, so finalParseTableCellRich can skip its walk otherwise
      retTable = new ast.Node(ast.NodeTable);
      retTable.TableAligns = aligns;
      retTable.TableAligns = aligns;
      retTable.AppendChild(context.newTableHead(headRows));

      for (let j = delimRowIndex + 1; j < lines.length; j++) {
        const line = lex.TrimWhitespace(lines[j])!;
        const tableRow = context.parseTableRow(line, aligns, false);
        if (null === tableRow) {
          return [retParagraph, retTable];
        }
        // Extract the structure and style IAL of data row cells (kept consistent with the head row handling, not controlled by the KramdownSpanIAL option),
        // so merge information and cell styles are preserved across Markdown round trips.
        for (let td = tableRow.FirstChild; null !== td; td = td.Next) {
          const ialStart = bytes.Index(td.Tokens ?? new Uint8Array(0), curlyBracesOpenColon);
          if (0 !== ialStart) {
            continue;
          }

          const subTokens = td.Tokens!.subarray(ialStart);
          const [pos, ial] = context.parseKramdownSpanIAL(subTokens);
          if (0 < ial.length) {
            const ialTokens = subTokens.subarray(0, pos + 1);
            if (isTableCellIAL(ial)) {
              td.KramdownIAL = ial;
              const [align, found] = TableCellStyleAlign(td.IALAttr("style"));
              if (found) {
                td.TableCellAlign = align;
              }
              td.Tokens = td.Tokens!.subarray(ialTokens.length);
              const spanIAL = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
              td.PrependChild(spanIAL);
            }
          }
        }
        retTable.AppendChild(tableRow);
      }

      if (0 < beforeTableLines.length) {
        retParagraph = new ast.Node(ast.NodeParagraph, bytes.Join(beforeTableLines, newlineBytes));
      }
      return [retParagraph, retTable];
    } else {
      if (lex.ItemNewline === paragraphTokens[i] || 0 === i) {
        if (0 === i) {
          tokens = paragraphTokens.subarray(i);
        } else {
          tokens = paragraphTokens.subarray(i + 1);
        }
        const table = context.parseTable0(tokens);
        if (null !== table) {
          if (0 < lineCnt) {
            retParagraph = new ast.Node(ast.NodeParagraph, paragraphTokens.subarray(0, i));
          }
          retTable = table;
          retTable.Tokens = tokens;
          break;
        }
      }
    }
    lineCnt++;
  }
  return [retParagraph, retTable];
};

Context.prototype.parseTable0 = function (this: Context, tokens: Uint8Array): ast.Node | null {
  const context = this;
  let ret: ast.Node | null = null;
  // Check the adjacent head row and delimiter row first, and split the following data rows only when the candidate holds.
  const headEnd = bytes.IndexByte(tokens, lex.ItemNewline);
  if (0 > headEnd) {
    return ret;
  }
  let body: Uint8Array = tokens.subarray(headEnd + 1);
  let delimEnd = bytes.IndexByte(body, lex.ItemNewline);
  if (0 > delimEnd) {
    delimEnd = body.length;
  }
  const delimRow = lex.TrimWhitespace(body.subarray(0, delimEnd))!;
  if (delimEnd < body.length) {
    body = body.subarray(delimEnd + 1);
  } else {
    body = new Uint8Array(0);
  }
  if (2 > delimRow.length) {
    // A newline followed by a colon is recognized as a table https://github.com/88250/lute/issues/198
    return ret;
  }

  const aligns = context.parseTableDelimRow(delimRow);
  if (null === aligns) {
    return ret;
  }

  if (0 === body.length && 1 === aligns.length && 0 === aligns[0] && !bytes.Contains(tokens, pipeBytes)) {
    // If there are only two lines, the alignment is the default and there is no |  (foo\n---), it conflicts with the Setext heading rule.
    // But the block-level parsing has obviously already tried to parse a Setext heading, so reaching here means the Setext heading parsing failed,
    // so this must not be parsed as a table either; return a normal paragraph
    return ret;
  }

  const headRow = context.parseTableRow(lex.TrimWhitespace(tokens.subarray(0, headEnd))!, aligns, true);
  if (null === headRow) {
    return ret;
  }

  // Extract the structure and style IAL of the head cells, not controlled by the KramdownSpanIAL option,
  // so merge information and cell styles are preserved across Markdown round trips.
  for (let th = headRow.FirstChild; null !== th; th = th.Next) {
    const ialStart = bytes.LastIndex(th.Tokens ?? new Uint8Array(0), curlyBracesOpenColon);
    if (0 > ialStart) {
      continue;
    }
    const subTokens = th.Tokens!.subarray(ialStart);
    const [pos, ial] = context.parseKramdownSpanIAL(subTokens);
    if (0 < ial.length) {
      const ialTokens = subTokens.subarray(0, pos + 1);
      if (isTableCellIAL(ial)) {
        th.KramdownIAL = ial;
        const [align, found] = TableCellStyleAlign(th.IALAttr("style"));
        if (found) {
          th.TableCellAlign = align;
        }
        // UPSTREAM-BUG: ialTokens is a view of th.Tokens, and this append moves the text that follows the IAL over it in place, so the KramdownSpanIAL node gets corrupted tokens when text follows the IAL in the cell (e.g. `| a {: style="color:red"} b |`)
        th.Tokens = slices.Append(th.Tokens!.subarray(0, ialStart), th.Tokens!.subarray(ialStart + ialTokens.length));
        const spanIAL = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
        th.InsertAfter(spanIAL);
        th = th.Next!;
      }
    }
  }

  this.hasTable = true; // PORT-NOTE: perf, departs from 1:1 (parse/table.go:262): records that a table node was created, see finalParseTableCellRich
  ret = new ast.Node(ast.NodeTable);
  ret.TableAligns = aligns;
  ret.TableAligns = aligns;
  ret.AppendChild(context.newTableHead([headRow]));
  for (const tokens of lex.Split(body, lex.ItemNewline)) {
    const line = lex.TrimWhitespace(tokens)!;
    const tableRow = context.parseTableRow(line, aligns, false);
    if (null === tableRow) {
      return ret;
    }
    // Extract the structure and style IAL of data row cells (same as the head), not controlled by the KramdownSpanIAL option.
    for (let th = tableRow.FirstChild; null !== th; th = th.Next) {
      const ialStart = bytes.LastIndex(th.Tokens ?? new Uint8Array(0), curlyBracesOpenColon);
      if (0 > ialStart) {
        continue;
      }
      const subTokens = th.Tokens!.subarray(ialStart);
      const [pos, ial] = context.parseKramdownSpanIAL(subTokens);
      if (0 < ial.length) {
        const ialTokens = subTokens.subarray(0, pos + 1);
        if (isTableCellIAL(ial)) {
          th.KramdownIAL = ial;
          const [align, found] = TableCellStyleAlign(th.IALAttr("style"));
          if (found) {
            th.TableCellAlign = align;
          }
          // UPSTREAM-BUG: same aliasing as above, ialTokens is overwritten in place by the text that follows the IAL
          th.Tokens = slices.Append(th.Tokens!.subarray(0, ialStart), th.Tokens!.subarray(ialStart + ialTokens.length));
          const spanIAL = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
          th.InsertAfter(spanIAL);
          th = th.Next!;
        }
      }
    }
    ret.AppendChild(tableRow);
  }
  return ret;
};

Context.prototype.newTableHead = function (this: Context, headRows: ast.Node[]): ast.Node {
  const context = this;
  const ret = new ast.Node(ast.NodeTableHead);
  for (const headRow of headRows) {
    const tr = new ast.Node(ast.NodeTableRow);
    ret.AppendChild(tr);
    for (let c = headRow.FirstChild; null !== c;) {
      const next = c.Next;
      tr.AppendChild(c);
      c = next;
    }
  }
  return ret;
};

export function inInline(tokens: Uint8Array, i: number, mathOrCodeMarker: number): boolean {
  if (i + 1 >= tokens.length || i < 1) {
    return false;
  }

  const marker = new Uint8Array([mathOrCodeMarker]);
  const start = bytes.IndexByte(tokens.subarray(0, i), mathOrCodeMarker);
  const startClosed = 0 === bytes.Count(tokens.subarray(0, i), marker) % 2;
  if (startClosed) {
    return false;
  }
  const end = bytes.IndexByte(tokens.subarray(i + 1), mathOrCodeMarker);
  return -1 < start && -1 < end;
}

Context.prototype.parseTableRow = function (this: Context, line: Uint8Array, aligns: number[], isHead: boolean): ast.Node | null {
  const context = this;
  const ret = new ast.Node(ast.NodeTableRow);
  ret.TableAligns = aligns;

  const idx = bytes.Index(line, escapedPipe);
  if (0 < idx) {
    if (inInline(line, idx, lex.ItemDollar) || inInline(line, idx, lex.ItemBacktick)) {
      line = bytes.ReplaceAll(line, escapedPipe, escapedPipeEntity);
    }
  }

  let cols = lex.SplitWithoutBackslashEscape(line, lex.ItemPipe);
  if (1 > cols.length) {
    return null;
  }
  if (lex.IsBlank(cols[0])) {
    cols = cols.slice(1);
  }
  if (cols.length > 0 && lex.IsBlank(cols[cols.length - 1])) {
    cols = cols.slice(0, cols.length - 1);
  }

  const colsLen = cols.length;
  const alignsLen = aligns.length;
  if (isHead && colsLen > alignsLen) { // The delimiter row defines the number of table columns; if the head has more columns than that, it is not a table
    return null;
  }

  let i = 0;
  let col: Uint8Array | null = new Uint8Array(0);
  for (; i < colsLen && i < alignsLen; i++) {
    col = lex.TrimWhitespace(cols[i])!;
    col = bytes.ReplaceAllOrNil(col, pipeEntity, pipeBytes); // nil for an empty col, so an empty cell has nil Tokens
    this.hasTable = true; // PORT-NOTE: perf, departs from 1:1 (parse/table.go:356): records that a table cell was created, see finalParseTableCellRich
    const cell = new ast.Node(ast.NodeTableCell);
    cell.TableCellAlign = aligns[i];
    cell.Tokens = col;
    ret.AppendChild(cell);
  }

  // The remaining columns may need to be filled in
  for (; i < alignsLen; i++) {
    this.hasTable = true; // PORT-NOTE: perf, departs from 1:1 (parse/table.go:363): records that a table cell was created, see finalParseTableCellRich
    const cell = new ast.Node(ast.NodeTableCell);
    cell.TableCellAlign = aligns[i];
    ret.AppendChild(cell);
  }
  return ret;
};

Context.prototype.findTableDelimRow = function (this: Context, lines: Uint8Array[]): number {
  const context = this;
  let index = 0;
  const length = lines.length;
  if (2 > length) {
    return -1;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (null !== context.parseTableDelimRow(line)) {
      index = i;
      return index;
    }
  }
  return -1;
};

Context.prototype.parseTableDelimRow = function (this: Context, line: Uint8Array): number[] | null {
  const context = this;
  const length = line.length;
  if (1 > length) {
    return null;
  }

  let token = 0;
  let i = 0;
  for (; i < length; i++) {
    token = line[i];
    if (lex.ItemPipe !== token && lex.ItemHyphen !== token && lex.ItemColon !== token && lex.ItemSpace !== token) {
      return null;
    }
  }

  const idx = bytes.Index(line, escapedPipe);
  if (0 < idx) {
    if (inInline(line, idx, lex.ItemDollar) || inInline(line, idx, lex.ItemBacktick)) {
      line = bytes.ReplaceAll(line, escapedPipe, escapedPipeEntity);
    }
  }

  let cols = lex.SplitWithoutBackslashEscape(line, lex.ItemPipe);
  if (lex.IsBlank(cols[0])) {
    cols = cols.slice(1);
  }
  if (cols.length > 0 && lex.IsBlank(cols[cols.length - 1])) {
    cols = cols.slice(0, cols.length - 1);
  }

  let alignments: number[] | null = null;
  for (let col of cols) {
    col = lex.TrimWhitespace(col)!;
    const replaced = bytes.ReplaceAllOrNil(col, pipeEntity, pipeBytes);
    if (null === replaced) { // nil == col
      return null;
    }
    col = replaced;

    const align = context.tableDelimAlign(col);
    if (-1 === align) {
      return null;
    }
    if (null === alignments) {
      alignments = [];
    }
    alignments.push(align);
  }
  return alignments;
};

Context.prototype.tableDelimAlign = function (this: Context, col: Uint8Array): number {
  const context = this;
  const length = col.length;
  if (1 > length) {
    return -1;
  }

  const first = col[0];
  const left = lex.ItemColon === first;
  const last = col[length - 1];
  const right = lex.ItemColon === last;

  let i = 1;
  let token = 0;
  for (; i < length - 1; i++) {
    token = col[i];
    if (lex.ItemHyphen !== token) {
      return -1;
    }
  }

  if (left && right) {
    return 2;
  }
  if (left) {
    return 1;
  }
  if (right) {
    return 3;
  }
  return 0;
};
