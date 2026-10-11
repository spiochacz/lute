// Ported from h2m.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: the methods adjustVditorDOM, parentIs, hasAttr, prefixSpaces, suffixSpaces, HTML2Md (vditor_wysiwyg.go),
// setBlockIAL2 (protyle.go) and genASTByTabsDOM (protyle_tabs.go) are called here as Go does; they are attached by the ports of those files.
// PORT-NOTE: genASTByDOM uses `const context = tree.Context!;` for Go's `tree.Context` (never nil for a tree built in this file).
// PORT-NOTE: `class` is a reserved word; Go's local variables named `class` are called `cls`.
// PORT-NOTE: Go's `defer` statements inside genASTByDOM are kept in a list that the `finally` clause runs in reverse order, which is Go's order.

import * as bytes from "./runtime/bytes.ts";
import * as conv from "./runtime/conv.ts";
import * as slices from "./runtime/slices.ts";
import * as strconv from "./runtime/strconv.ts";
import * as strings from "./runtime/strings.ts";
import * as unicode from "./runtime/unicode.ts";
import * as ast from "./ast/index.ts";
import * as editor from "./editor/index.ts";
import * as html from "./html/index.ts";
import * as atom from "./html/atom/index.ts";
import * as lex from "./lex/index.ts";
import * as parse from "./parse/index.ts";
import * as render from "./render/index.ts";
import * as util from "./util/index.ts";
import { Lute } from "./types.ts";
import { normalizeCodeBlockBanner } from "./h2m_code_banner.ts";

declare module "./types.ts" {
  interface Lute {
    HTML2Markdown(htmlStr: string): [string, Error | null];
    HTML2Tree(dom: string): parse.Tree | null;
    HTMLNode2Tree(n: html.Node | null): parse.Tree | null;
    fixTableStructure(root: html.Node | null): void;
    fixOneTableStructure(table: html.Node): void;
    genASTByDOM(n: html.Node, tree: parse.Tree): void;
    genASTByCalloutDOM(n: html.Node, tree: parse.Tree): boolean;
  }
}

// Byte strings used as search patterns (never mutated).
const nlSpSpBytes: Uint8Array = conv.BytesFromString("\n  ");
const nlSpBytes: Uint8Array = conv.BytesFromString("\n ");
const nlBytes: Uint8Array = conv.BytesFromString("\n");
const nbspBytes: Uint8Array = conv.BytesFromString(" ");
const spBytes: Uint8Array = conv.BytesFromString(" ");
const dollar2Bytes: Uint8Array = conv.BytesFromString("$$");
const dotSpBytes: Uint8Array = conv.BytesFromString(". ");
const bulletBytes: Uint8Array = conv.BytesFromString("•");
const blackCircleBytes: Uint8Array = conv.BytesFromString("●");
const nlZwspBytes: Uint8Array = conv.BytesFromString("\n" + editor.Zwsp);
const backtickBytes: Uint8Array = conv.BytesFromString("`");
const backtick2Bytes: Uint8Array = conv.BytesFromString("``");
const backtick3Bytes: Uint8Array = conv.BytesFromString("```");
const gtBytes: Uint8Array = conv.BytesFromString(">");
const codeCloseBytes: Uint8Array = conv.BytesFromString("</code>");
const escapedPipeBytes: Uint8Array = conv.BytesFromString("\\|");
const pipeBytes: Uint8Array = conv.BytesFromString("|");
const nlNlBytes: Uint8Array = conv.BytesFromString("\n\n");

// PORT-NOTE: Go's path.Ext, which the runtime layer does not have.
function pathExt(p: string): string {
  for (let i = p.length - 1; i >= 0 && 0x2f /* / */ !== p.charCodeAt(i); i--) {
    if (0x2e /* . */ === p.charCodeAt(i)) {
      return p.slice(i);
    }
  }
  return "";
}

// HTML2Markdown 将 HTML 转换为 Markdown。
// Converts HTML to Markdown.
Lute.prototype.HTML2Markdown = function (this: Lute, htmlStr: string): [string, Error | null] {
  const lute = this;
  //fmt.Println(htmlStr)
  // Parse the string into a DOM tree
  const tree = lute.HTML2Tree(htmlStr);

  // Render the AST as formatted Markdown
  // PORT-NOTE: Go passes a possibly nil tree on and panics inside NewFormatRenderer; `tree!` makes the port throw too.
  const renderer = render.NewFormatRenderer(tree!, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.HTML2MdRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const formatted = renderer.Render();
  const markdown = util.BytesToStr(formatted);
  return [markdown, null];
};

// HTML2Tree 将 HTML 转换为 AST。
// Converts HTML to an AST.
Lute.prototype.HTML2Tree = function (this: Lute, dom: string): parse.Tree | null {
  const lute = this;
  const htmlRoot = util.ParseHTML(dom);
  return lute.HTMLNode2Tree(htmlRoot);
};

Lute.prototype.HTMLNode2Tree = function (this: Lute, n: html.Node | null): parse.Tree | null {
  const lute = this;
  if (null === n) {
    return null;
  }

  // Adjust the DOM structure
  lute.fixTableStructure(n);
  lute.adjustVditorDOM(n);

  // Convert the HTML tree into a Markdown AST
  const ret = new parse.Tree();
  ret.Name = "";
  ret.Root = new ast.Node(ast.NodeDocument);
  ret.Context = new parse.Context(lute.ParseOptions);
  ret.Context.Tip = ret.Root;
  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    lute.genASTByDOM(c, ret);
  }

  // Adjust the tree structure
  const previousLis: ast.Node[] = [];
  const unlinks: ast.Node[] = [];
  ast.Walk(ret.Root, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering) {
      if (ast.NodeList === n.Type) {
        // ul.ul => ul.li.ul
        if (null !== n.Parent && ast.NodeList === n.Parent.Type) {
          const previousLi = n.Previous;
          if (null !== previousLi) {
            previousLis.push(previousLi);
            unlinks.push(n);
          }
        }
      }
    }
    return ast.WalkContinue;
  });
  for (let i = 0; i < unlinks.length; i++) {
    const unlink = unlinks[i];
    unlink.Unlink();
    previousLis[i].AppendChild(unlink);
  }
  let styled = false;
  ast.Walk(ret.Root, (node: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering && (node.Type === ast.NodeTextMark || node.Type === ast.NodeCodeSpan) && node.IALAttr("style") !== "") {
      styled = true;
    }
    return ast.WalkContinue;
  });
  if (styled) {
    parse.NestedInlines2FlattedSpansHybrid(ret, false);
    ast.Walk(ret.Root, (node: ast.Node, entering: boolean): ast.WalkStatus => {
      if (entering && node.Type === ast.NodeTextMark) {
        parse.ApplyHTMLTextStyle(node, node.IALAttr("style"));
      }
      return ast.WalkContinue;
    });
  }
  return ret;
};

// escapeHTMLTextMarkers 将 HTML 文本中的标记符保存为转义节点，避免格式扁平化时将转义符混入正文。
// Saves the markers of HTML text as escape nodes, so that flattening the formatting does not mix the escape characters into the text.
function escapeHTMLTextMarkers(node: ast.Node): void {
  let start = 0;
  const tokens: Uint8Array = node.Tokens ?? new Uint8Array(0);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!lex.IsProtyleInlineMarker(token)) {
      continue;
    }
    if (start < i) {
      node.InsertBefore(new ast.Node(node.Type, tokens.subarray(start, i)));
    }
    const backslash = new ast.Node(ast.NodeBackslash);
    backslash.AppendChild(new ast.Node(ast.NodeBackslashContent, tokens.subarray(i, i + 1)));
    node.InsertBefore(backslash);
    start = i + 1;
  }
  if (start === 0) {
    return;
  }
  if (start < tokens.length) {
    node.Tokens = tokens.subarray(start);
  } else {
    node.Unlink();
  }
}

// fixTableStructure 直接修改传入的 *html.Node 树，完美兼容 th、td 以及 colspan、rowspan 合并单元格。
// 外部 HTML（如从浏览器、Excel、Word 复制）的合并单元格遵循 HTML 标准：被合并覆盖的位置没有对应的
// td/th 节点。而思源内部规范需要这些位置存在 class="fn__none" 的占位单元格（见 parse/table.go、
// spin_block_test.go 用例 112-116）。本函数按表格做二维网格计算，在跨行/跨列覆盖的位置补齐占位 td，
// 同时保留原“补齐残缺行列数”的行为。
// Modifies the passed *html.Node tree in place and handles th, td and merged cells (colspan, rowspan).
// The merged cells of external HTML (copied from a browser, Excel, Word) follow the HTML standard: the covered positions have no
// td/th node. The internal SiYuan convention needs placeholder cells with class="fn__none" at these positions (see parse/table.go,
// spin_block_test.go cases 112-116). This function computes a two-dimensional grid per table and fills in the placeholder td at
// the positions covered by a row or column span, and still pads incomplete rows as before.
Lute.prototype.fixTableStructure = function (this: Lute, root: html.Node | null): void {
  const lute = this;
  if (root === null) {
    return;
  }

  // 1. Find all table nodes under the root recursively and handle them table by table, so that multiple tables do not affect each other's column counts
  const tableNodes: html.Node[] = [];
  const findTables = (n: html.Node): void => {
    if (n.Type === html.ElementNode && n.DataAtom === atom.Table) {
      tableNodes.push(n);
    }
    for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
      findTables(c);
    }
  };
  findTables(root);

  for (const table of tableNodes) {
    lute.fixOneTableStructure(table);
  }
};

// fixOneTableStructure 处理单个 table：计算 maxCols 并补齐 fn__none 占位单元格。
// Handles one table: computes maxCols and fills in the fn__none placeholder cells.
Lute.prototype.fixOneTableStructure = function (this: Lute, table: html.Node): void {
  // Collect all tr below the table (across thead/tbody/tfoot)
  const trNodes: html.Node[] = [];
  const findTRs = (n: html.Node): void => {
    if (n.Type === html.ElementNode && n.DataAtom === atom.Tr) {
      trNodes.push(n);
    }
    for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
      findTRs(c);
    }
  };
  findTRs(table);
  if (0 === trNodes.length) {
    return;
  }

  // Helper: read the colspan of a cell (default 1, an invalid value counts as 1)
  const readColspan = (cell: html.Node): number => {
    const cs = util.DomAttrValue(cell, "colspan");
    if ("" !== cs) {
      const [val, err] = strconv.Atoi(cs);
      if (err === null && val > 0) {
        return val;
      }
    }
    return 1;
  };
  // Helper: read the rowspan of a cell (default 1, an invalid value counts as 1)
  const readRowspan = (cell: html.Node): number => {
    const rs = util.DomAttrValue(cell, "rowspan");
    if ("" !== rs) {
      const [val, err] = strconv.Atoi(rs);
      if (err === null && val > 0) {
        return val;
      }
    }
    return 1;
  };

  // 2. Walk all tr and compute the real maximum total column count with the colspan weights (the original logic is kept)
  let maxCols = 0;
  for (const tr of trNodes) {
    let rowCols = 0;
    for (let c = tr.FirstChild; c !== null; c = c.NextSibling) {
      if (c.Type === html.ElementNode && (c.DataAtom === atom.Td || c.DataAtom === atom.Th)) {
        if ("fn__none" === util.DomAttrValue(c, "class")) {
          // Existing placeholder cells do not count as logical columns (they are covered positions)
          continue;
        }
        rowCols += readColspan(c);
      }
    }
    if (rowCols > maxCols) {
      maxCols = rowCols;
    }
  }
  if (0 === maxCols) {
    return;
  }

  // 3. Two-dimensional grid: occupied[row][col] marks the positions covered by a cell that spans rows or columns.
  // The placeholder cells are filled in by simulating the HTML table layout.
  // Step 3 handles all rows (the header included): a fn__none placeholder after a colspan cell, a placeholder where a rowspan covers,
  // and padding at the row end, so that every row has exactly maxCols physical td and the GFM round trip has the same number of |
  // in each row, which avoids a misaligned right side.
  const rowCount = trNodes.length;
  const occupied: boolean[][] = new Array<boolean[]>(rowCount);
  for (let i = 0; i < occupied.length; i++) {
    occupied[i] = new Array<boolean>(maxCols).fill(false);
  }

  const isCell = (c: html.Node): boolean => {
    return c.Type === html.ElementNode && (c.DataAtom === atom.Td || c.DataAtom === atom.Th);
  };
  const isPlaceholder = (c: html.Node): boolean => {
    return isCell(c) && "fn__none" === util.DomAttrValue(c, "class");
  };

  for (let ri = 0; ri < trNodes.length; ri++) {
    const tr = trNodes[ri];
    let colIdx = 0;
    // Collect the real cells of this row first (skip the existing placeholder td, which belong to covered positions)
    const realCells: html.Node[] = [];
    for (let c = tr.FirstChild; c !== null; c = c.NextSibling) {
      if (isCell(c) && !isPlaceholder(c)) {
        realCells.push(c);
      }
    }

    for (const cell of realCells) {
      // Skip occupied columns (positions covered by a rowspan from above): insert a fn__none placeholder td before the cell
      while (colIdx < maxCols && occupied[ri][colIdx]) {
        insertPlaceholderBefore(cell);
        colIdx++;
      }
      if (colIdx >= maxCols) {
        // A cell beyond the table width is ignored (should not happen, maxCols was computed with colspan)
        break;
      }

      const colspan = readColspan(cell);
      // Read the rowspan and clamp it to the remaining rows to avoid going out of range
      let rowspan = readRowspan(cell);
      const remaining = rowCount - ri;
      if (rowspan > remaining) {
        rowspan = remaining;
      }

      // Mark the two-dimensional occupancy (the start cell itself included)
      for (let dr = 0; dr < rowspan && ri + dr < rowCount; dr++) {
        for (let dc = 0; dc < colspan && colIdx + dc < maxCols; dc++) {
          occupied[ri + dr][colIdx + dc] = true;
        }
      }
      // A cell spanning several columns gets (colspan-1) fn__none placeholder td after it, so that the number of physical td of the row
      // equals the number of logical columns. Otherwise the row has fewer columns when the GFM table is aligned by |, and the content
      // on the right is shifted after a Markdown round trip.
      // (Consistent with the internal SiYuan convention: a colspan cell is followed by fn__none placeholders, see spin_block_test cases 112/113)
      for (let dc = 1; dc < colspan && colIdx + dc <= maxCols; dc++) {
        appendPlaceholderAfter(cell);
      }
      colIdx += colspan;
    }

    // Row end: pad to maxCols
    while (colIdx < maxCols) {
      if (occupied[ri][colIdx]) {
        // Position covered by a rowspan: insert a fn__none placeholder td
        appendPlaceholder(tr, true);
      } else {
        // The row itself has too few columns (incomplete table): add a plain empty td without fn__none
        appendPlaceholder(tr, false);
      }
      colIdx++;
    }
  }

  // 4. Handle thead: if the table has no <thead> and the first row has a cell with rowspan>1,
  // wrap all rows covered by the rowspan of the first row in a <thead>, so that a rowspan does not cross the thead/tbody boundary and break rendering
  // (the SiYuan internal convention requires the rows covered by a rowspan to be in the same section as the start cell)
  if (1 > util.DomChildrenByType(table, atom.Thead).length && 0 < trNodes.length) {
    const firstTR = trNodes[0];
    let theadRows = 1;
    for (let c = firstTR.FirstChild; null !== c; c = c.NextSibling) {
      if (html.ElementNode !== c.Type || (atom.Th !== c.DataAtom && atom.Td !== c.DataAtom)) {
        continue;
      }
      const rs = util.DomAttrValue(c, "rowspan");
      if ("" !== rs) {
        const [val, err] = strconv.Atoi(rs);
        if (err === null && val > theadRows) {
          theadRows = val;
        }
      }
    }
    if (theadRows > 1 && theadRows <= trNodes.length) {
      // Wrap the first theadRows tr in a <thead>
      const thead = new html.Node();
      thead.Type = html.ElementNode;
      thead.DataAtom = atom.Thead;
      thead.Data = atom.AtomString(atom.Thead);
      // Insert the thead before the first tr (whether it is inside a tbody or a direct child of the table)
      firstTR.InsertBefore(thead);
      for (let i = 0; i < theadRows; i++) {
        const tr = trNodes[i];
        tr.Parent!.RemoveChild(tr);
        thead.AppendChild(tr);
      }
    }
  }
};

// insertPlaceholderBefore 在 ref 之前插入一个 class="fn__none" 的空 td。
// Inserts an empty td with class="fn__none" before ref.
function insertPlaceholderBefore(ref: html.Node): void {
  const td = newPlaceholderTD();
  ref.InsertBefore(td);
}

// appendPlaceholder 将一个空 td 追加到 tr 末尾。fnNone 为 true 时标记为 class="fn__none"（合并覆盖占位）。
// Appends an empty td to the end of tr. With fnNone true it is marked class="fn__none" (placeholder for a merged cell).
function appendPlaceholder(tr: html.Node, fnNone: boolean): void {
  tr.AppendChild(newTD(fnNone));
}

// appendPlaceholderAfter 在 ref 之后插入一个 class="fn__none" 的空 td，用作 colspan 单元格横向覆盖的占位。
// Inserts an empty td with class="fn__none" after ref, as the placeholder for the columns covered by a colspan cell.
function appendPlaceholderAfter(ref: html.Node): void {
  const td = newPlaceholderTD();
  ref.InsertAfter(td);
}

// newPlaceholderTD 构造一个 <td class="fn__none"></td> 节点（合并单元格覆盖占位）。
// Builds a <td class="fn__none"></td> node (placeholder for a merged cell).
function newPlaceholderTD(): html.Node {
  return newTD(true);
}

// newTD 构造一个空 <td> 节点。fnNone 为 true 时添加 class="fn__none"。
// Builds an empty <td> node. With fnNone true the class="fn__none" is added.
function newTD(fnNone: boolean): html.Node {
  const td = new html.Node();
  td.Type = html.ElementNode;
  td.DataAtom = atom.Td;
  td.Data = atom.AtomString(atom.Td);
  if (fnNone) {
    const attribute = new html.Attribute();
    attribute.Key = "class";
    attribute.Val = "fn__none";
    td.Attr = [attribute];
  }
  return td;
}

// extractTableCaption 将外部 HTML 表格标题规范化为思源表格 caption IAL，并从表格 DOM 中移除原节点。
// Normalizes the caption of an external HTML table into the SiYuan table caption IAL and removes the original node from the table DOM.
function extractTableCaption(table: html.Node): string {
  for (let caption = table.FirstChild; null !== caption; caption = caption.NextSibling) {
    if (atom.Caption !== caption.DataAtom) {
      continue;
    }

    const title = strings.TrimSpace(util.DomText(caption));
    const style = util.DomAttrValue(caption, "style");
    caption.Unlink();
    if ("" === title) {
      return "";
    }

    let captionHTML = `<caption contenteditable="false"`;
    if (tableCaptionAtBottom(style)) {
      captionHTML += ` style="caption-side: bottom;"`;
    }
    captionHTML += ">" + html.EscapeHTMLStr(title) + "</caption>";
    return html.EscapeHTMLStr(captionHTML);
  }
  return "";
}

// tableCaptionAtBottom 判断外部表格标题是否明确设置在表格下方。
// Tells whether the caption of an external table is explicitly set below the table.
function tableCaptionAtBottom(style: string): boolean {
  for (const declaration of strings.Split(style, ";")) {
    const parts = strings.SplitN(declaration, ":", 2);
    if (2 !== parts.length || !strings.EqualFold(strings.TrimSpace(parts[0]), "caption-side")) {
      continue;
    }
    const value = strings.TrimSpace(strings.TrimSuffix(strings.ToLower(strings.TrimSpace(parts[1])), "!important"));
    return "bottom" === value;
  }
  return false;
}

// setTableCellSpanIAL 保留表格合并结构和与表头不同的水平对齐样式，忽略外部网页的其它样式。
// class 仅保留由 fixTableStructure 插入的 fn__none 占位标记。
// Keeps the merge structure of the table and the horizontal alignment that differs from the header, and ignores other styles of the external page.
// Of the class only the fn__none placeholder mark inserted by fixTableStructure is kept.
function setTableCellSpanIAL(node: ast.Node | null, n: html.Node | null): void {
  if (null === node || null === n) {
    return;
  }
  if (atom.Th !== n.DataAtom && atom.Td !== n.DataAtom) {
    return;
  }

  const colspan = util.DomAttrValue(n, "colspan");
  if ("" !== colspan) {
    node.SetIALAttr("colspan", colspan);
  }
  const rowspan = util.DomAttrValue(n, "rowspan");
  if ("" !== rowspan) {
    node.SetIALAttr("rowspan", rowspan);
  }
  const cls = util.DomAttrValue(n, "class");
  if ("fn__none" === cls) {
    // Keep only the SiYuan merged cell placeholder mark and drop the style class of the external page
    node.SetIALAttr("class", cls);
  }
  if (node.TableCellAlign !== tableHeadCellAlign(node)) {
    let align = "start";
    switch (node.TableCellAlign) {
      case 1:
        align = "left";
        break;
      case 2:
        align = "center";
        break;
      case 3:
        align = "right";
        break;
    }
    node.SetIALAttr("style", "text-align: " + align + ";");
  }
  if ("" === colspan && "" === rowspan && "" === node.IALAttr("class") && "" === node.IALAttr("style")) {
    return;
  }

  const ialTokens = parse.IAL2Tokens(node.KramdownIAL);
  const ial = new ast.Node(ast.NodeKramdownSpanIAL, ialTokens);
  node.PrependChild(ial);
}

// tableHeadCellAlign 返回同一视觉列的表头对齐方式，供逐格样式往返使用。
// Returns the alignment of the header cell in the same visual column, for the round trip of per-cell styles.
function tableHeadCellAlign(node: ast.Node): number {
  if (null === node.Parent) {
    return 0;
  }
  let column = 0;
  for (let previous = node.Previous; null !== previous; previous = previous.Previous) {
    if (ast.NodeTableCell === previous.Type) {
      column++;
    }
  }
  let table = node.Parent.Parent;
  if (null !== table && ast.NodeTableHead === table.Type) {
    table = table.Parent;
  }
  if (null === table || null === table.FirstChild || ast.NodeTableHead !== table.FirstChild.Type || null === table.FirstChild.FirstChild) {
    return 0;
  }
  for (let cell = table.FirstChild.FirstChild.FirstChild; null !== cell; cell = cell.Next) {
    if (ast.NodeTableCell !== cell.Type) {
      continue;
    }
    if (0 === column) {
      return cell.TableCellAlign;
    }
    column--;
  }
  return 0;
}

// trimTableCellTextTokens 清理表格单元格文本边界，并保留相邻行级节点之间的一个空格。
// Cleans the boundaries of table cell text and keeps one space between adjacent inline nodes.
// PORT-NOTE: Go returns nil for an empty result; the port returns an empty array. The caller stores the result in node.Tokens and
// returns at `1 > len(node.Tokens)` before the node is attached or read anywhere else, so the difference cannot be observed.
function trimTableCellTextTokens(n: html.Node, tokens: Uint8Array): Uint8Array {
  let trimmed = bytes.TrimSpace(tokens);
  if (null === n.Parent || (atom.Td !== n.Parent.DataAtom && atom.Th !== n.Parent.DataAtom)) {
    return trimmed;
  }
  if (0 === trimmed.length) {
    if (null !== n.PrevSibling && null !== n.NextSibling && (strings.ContainsRune(n.Data, 0x20 /* space */) || strings.ContainsRune(n.Data, 0xa0 /* nbsp */))) {
      return conv.BytesFromString(" ");
    }
    return new Uint8Array(0);
  }
  const runes = conv.RunesFromString(n.Data);
  if (null !== n.PrevSibling && atom.Br !== n.PrevSibling.DataAtom && 0 < runes.length && (0x20 === runes[0] || 0xa0 === runes[0])) {
    trimmed = slices.Append(conv.BytesFromString(" "), trimmed);
  }
  if (null !== n.NextSibling && atom.Br !== n.NextSibling.DataAtom && 0 < runes.length && (0x20 === runes[runes.length - 1] || 0xa0 === runes[runes.length - 1])) {
    trimmed = slices.AppendByte(trimmed, 0x20);
  }
  return trimmed;
}

// genASTByDOM 根据指定的 DOM 节点 n 进行深度优先遍历并逐步生成 Markdown 语法树 tree。
// Walks the given DOM node n depth first and builds the Markdown syntax tree step by step.
Lute.prototype.genASTByDOM = function (this: Lute, n: html.Node, tree: parse.Tree): void {
  const lute = this;
  normalizeCodeBlockBanner(n);
  if (lute.genASTByTabsDOM(n, tree)) {
    return;
  }
  if (html.CommentNode === n.Type || atom.Meta === n.DataAtom) {
    return;
  }

  if ("svg" === n.Namespace) {
    return;
  }

  const dataRender = util.DomAttrValue(n, "data-render");
  if ("1" === dataRender) {
    return;
  }

  const cls = util.DomAttrValue(n, "class");
  if (
    strings.HasPrefix(cls, "line-number") &&
    !strings.HasPrefix(cls, "line-numbers" /* 简书代码块 Jianshu code block https://github.com/siyuan-note/siyuan/issues/4361 */)
  ) {
    return;
  }

  if (strings.Contains(cls, "mw-editsection")) {
    // 忽略 Wikipedia [编辑] Ignore the Wikipedia [edit] link. Do not clip the `Edit` element next to Wikipedia headings https://github.com/siyuan-note/siyuan/issues/11600
    return;
  }

  if (strings.Contains(cls, "citation-comment")) {
    // 忽略 Wikipedia 引用中的注释 Ignore the comments in Wikipedia citations https://github.com/siyuan-note/siyuan/issues/11640
    return;
  }

  if (lute.genASTByCalloutDOM(n, tree)) {
    return;
  }

  if (0 === n.DataAtom && html.ElementNode === n.Type) {
    // 自定义标签 Custom tag
    for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
      lute.genASTByDOM(c, tree);
    }
    return;
  }

  const context = tree.Context!;
  const node = new ast.Node(ast.NodeText, util.StrToBytes(n.Data));
  let textStyle = "";
  // The deferred calls of this function; the finally clause below runs them in reverse order, as Go does.
  const defers: Array<() => void> = [];
  try {
    if (lute.ParseOptions.ProtyleWYSIWYG) {
      textStyle = parse.HTMLNodeTextStyle(n).CSS();
      defers.push((): void => {
        if (node.Parent === null || textStyle === "") {
          return;
        }
        if (node.Type === ast.NodeCodeSpan) {
          node.SetIALAttr("style", textStyle);
          node.InsertAfter(new ast.Node(ast.NodeKramdownSpanIAL, parse.IAL2Tokens(node.KramdownIAL)));
        } else {
          parse.ApplyHTMLTextStyle(node, textStyle);
          if (node.Type === ast.NodeTextMark) {
            parse.ApplyHTMLTextSemantics(node, n);
          }
        }
      });
    }
    let withIAL = false;
    let withDOMIAL = false;
    if (atom.Table === n.DataAtom) {
      const caption = extractTableCaption(n);
      if ("" !== caption) {
        node.SetIALAttr("caption", caption);
        withIAL = true;
      }
    }

    if (0 < lute.ParseOptions.HTML2MarkdownAttrs.length) {
      for (const attr of n.Attr) {
        if (util.ContainsStr(attr.Key, lute.ParseOptions.HTML2MarkdownAttrs)) {
          node.SetIALAttr(attr.Key, attr.Val);
          withIAL = true;
          withDOMIAL = true;
        }
        if (strings.HasPrefix(attr.Key, "custom-") && util.ContainsStr("custom-*", lute.ParseOptions.HTML2MarkdownAttrs)) {
          node.SetIALAttr(attr.Key, attr.Val);
          withIAL = true;
          withDOMIAL = true;
        }
      }
    }

    if (withIAL) {
      let ialTokens = parse.IAL2Tokens(node.KramdownIAL);
      if (withDOMIAL) {
        ialTokens = lute.setBlockIAL2(n, node);
      }
      const ial = new ast.Node(ast.NodeKramdownBlockIAL, ialTokens);
      defers.push((): void => context.TipAppendChild(ial));
    }

    switch (n.DataAtom) {
      case 0: {
        const prevClass = util.DomAttrValue(n.PrevSibling, "class");
        if ("fn__space5" === prevClass) {
          // 链滴剪藏图片时多了长宽显示 Extra width and height shown when clipping images from Liandi https://github.com/siyuan-note/siyuan/issues/10987
          return;
        }

        if (null !== n.Parent && atom.A === n.Parent.DataAtom) {
          node.Type = ast.NodeLinkText;
        }

        // 将 \n空格空格* 转换为\n
        // Convert \n followed by spaces to \n
        while (bytes.Contains(node.Tokens!, nlSpSpBytes)) {
          node.Tokens = bytes.ReplaceAll(node.Tokens!, nlSpSpBytes, nlSpBytes);
        }
        node.Tokens = bytes.ReplaceAll(node.Tokens!, nlSpBytes, nlBytes);
        node.Tokens = bytes.Trim(node.Tokens!, "\t\n");

        if (lute.parentIs(n, atom.Table)) {
          if ("\n" === n.Data) {
            if (null === context.Tip!.FirstChild || null === n.NextSibling) {
              break;
            }

            context.Tip!.AppendChild(new ast.Node(ast.NodeBr));
            break;
          } else {
            if ("" === strings.TrimSpace(n.Data)) {
              node.Tokens = conv.BytesFromString(" ");
              context.Tip!.AppendChild(node);
              break;
            }
          }

          node.Tokens = trimTableCellTextTokens(n, node.Tokens!);
          node.Tokens = bytes.ReplaceAll(node.Tokens, nlBytes, spBytes);
        }
        node.Tokens = bytes.ReplaceAll(node.Tokens!, nbspBytes, spBytes); // 将 &nbsp; 转换为空格 Convert &nbsp; to a space

        node.Tokens = bytes.ReplaceAll(node.Tokens, nlBytes, spBytes); // 将 \n 转换为空格 Convert \n to a space https://github.com/siyuan-note/siyuan/issues/6052
        if (
          ast.NodeStrong === context.Tip!.Type ||
          ast.NodeEmphasis === context.Tip!.Type ||
          ast.NodeStrikethrough === context.Tip!.Type ||
          ast.NodeMark === context.Tip!.Type ||
          ast.NodeSup === context.Tip!.Type ||
          ast.NodeSub === context.Tip!.Type
        ) {
          if (bytes.HasPrefix(node.Tokens, spBytes) || 1 > bytes.TrimSpace(node.Tokens).length) {
            if (null !== context.Tip!.LastChild && context.Tip!.LastChild.IsMarker()) {
              node.Tokens = slices.Append(conv.BytesFromString(editor.Zwsp), node.Tokens);
            }
          }
          if (bytes.HasSuffix(node.Tokens, spBytes) && null === n.NextSibling) {
            node.Tokens = slices.Append(node.Tokens, conv.BytesFromString(editor.Zwsp));
          }
        }

        if (
          ast.NodeParagraph === context.Tip!.Type &&
          bytes.HasPrefix(node.Tokens, dollar2Bytes) &&
          bytes.HasSuffix(node.Tokens, dollar2Bytes) &&
          2 === bytes.Count(node.Tokens, dollar2Bytes)
        ) {
          // 将其转换为公式块 Convert it to a math block https://github.com/siyuan-note/siyuan/issues/14360
          const tex = bytes.TrimSpace(node.Tokens.subarray(2, node.Tokens.length - 2));
          appendMathBlock(tree, util.BytesToStr(tex));
          return;
        }

        let escapeMarkers = false;
        if (textStyle !== "" || (null !== n.Parent && atom.Span === n.Parent.DataAtom && 0 === n.Parent.Attr.length)) {
          // 按原文解析，不处理转义 Parse as the original text, no escaping
        } else {
          if (lute.ParseOptions.ProtyleWYSIWYG) {
            if (ast.NodeLink !== context.Tip!.Type) {
              // a 标签锚文本中的标记符不进行转义 The markers in the anchor text of an a tag are not escaped https://github.com/siyuan-note/siyuan/issues/14733
              escapeMarkers = true;
            }
          } else {
            node.Tokens = lex.EscapeCommonMarkers(node.Tokens);
            if (lute.parentIs(n, atom.Table)) {
              node.Tokens = bytes.ReplaceAll(node.Tokens, escapedPipeBytes, pipeBytes);
              node.Tokens = bytes.ReplaceAll(node.Tokens, pipeBytes, escapedPipeBytes);
            }
          }
        }

        if (1 > node.Tokens.length) {
          return;
        }

        if (
          ast.NodeListItem === context.Tip!.Type ||
          (null !== context.Tip!.Parent && ast.NodeListItem === context.Tip!.Parent.Type) ||
          (null !== context.Tip!.Parent && null !== context.Tip!.Parent.Parent && ast.NodeListItem === context.Tip!.Parent.Parent.Type)
        ) {
          // 去掉文本中开头的列表项标记符 Remove the list item marker at the beginning of the text https://github.com/siyuan-note/siyuan/issues/14329
          const idx = bytes.Index(node.Tokens, dotSpBytes);
          if (0 < idx) {
            const num = node.Tokens.subarray(0, idx);
            let isLi = true;
            for (const b of num) {
              if (!lex.IsDigit(b)) {
                isLi = false;
                break;
              }
            }
            if (isLi) {
              node.Tokens = node.Tokens.subarray(idx + 2);
            }
          }
          if (
            (null !== context.Tip!.ListData && 0 === context.Tip!.ListData.Typ) ||
            (null !== context.Tip!.Parent!.ListData && 0 === context.Tip!.Parent!.ListData.Typ) ||
            (null !== context.Tip!.Parent && null !== context.Tip!.Parent.Parent!.ListData && 0 === context.Tip!.Parent.Parent!.ListData.Typ)
          ) {
            if (0 === bytes.Index(node.Tokens, bulletBytes)) {
              node.Tokens = slices.NilIfEmpty(bytes.TrimSpace(bytes.TrimPrefix(node.Tokens, bulletBytes)));
            }
            if (0 === bytes.Index(node.Tokens ?? new Uint8Array(0), blackCircleBytes)) {
              node.Tokens = slices.NilIfEmpty(bytes.TrimSpace(bytes.TrimPrefix(node.Tokens!, blackCircleBytes)));
            }
          }
        }

        if (ast.NodeListItem === context.Tip!.Type) {
          const p = new ast.Node(ast.NodeParagraph);
          p.AppendChild(node);
          context.Tip!.AppendChild(p);
          context.Tip = p;
        } else {
          if (null !== n.Parent && atom.Dt === n.Parent.DataAtom) {
            const strong = new ast.Node(ast.NodeStrong);
            strong.AppendChild(new ast.Node(ast.NodeStrongA6kOpenMarker, util.StrToBytes("**")));
            strong.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
            strong.AppendChild(new ast.Node(ast.NodeStrongA6kCloseMarker, util.StrToBytes("**")));
            context.Tip!.AppendChild(strong);
            return;
          }

          context.Tip!.AppendChild(node);
        }
        if (escapeMarkers) {
          escapeHTMLTextMarkers(node);
        }
        break;
      }
      case atom.P:
      case atom.Div:
      case atom.Section:
      case atom.Dt:
      case atom.Dd: {
        if (ast.NodeLink === context.Tip!.Type) {
          break;
        }

        if (lute.parentIs(n, atom.Table)) {
          if (null !== n.PrevSibling && strings.Contains(n.PrevSibling.Data, "\n")) {
            break;
          }

          if (null !== n.NextSibling && strings.Contains(n.NextSibling.Data, "\n")) {
            break;
          }

          if (null === context.Tip!.FirstChild) {
            break;
          }

          context.Tip!.AppendChild(new ast.Node(ast.NodeBr));
          break;
        }

        if (ast.NodeHeading === context.Tip!.Type) {
          // h 下存在 div/p/section 则忽略分块
          // A div/p/section under h does not start a new block
          break;
        }

        const cls = util.DomAttrValue(n, "class");
        if (atom.Div === n.DataAtom || atom.Section === n.DataAtom) {
          // 解析 GitHub 语法高亮代码块
          // Parse GitHub syntax highlighted code blocks
          let language = "";
          if (strings.Contains(cls, "-source-")) {
            language = cls.slice(strings.LastIndex(cls, "-source-") + "-source-".length);
          } else if (strings.Contains(cls, "-text-html-basic")) {
            language = "html";
          } else if (strings.Contains(cls, "language-") && !strings.Contains(cls, "-math")) {
            language = cls.slice(strings.LastIndex(cls, "language-") + "language-".length);
            if (!render.NoHighlight(language)) {
              language = "";
            }
          }
          if ("" !== language) {
            node.Type = ast.NodeCodeBlock;
            node.IsFencedCodeBlock = true;
            const openMarker = new ast.Node(ast.NodeCodeBlockFenceOpenMarker, util.StrToBytes("```"));
            openMarker.CodeBlockFenceLen = 3;
            node.AppendChild(openMarker);
            node.AppendChild(new ast.Node(ast.NodeCodeBlockFenceInfoMarker));
            node.LastChild!.CodeBlockInfo = conv.BytesFromString(language);
            let tokens: Uint8Array = conv.BytesFromString(util.DomText(n));
            tokens = bytes.ReplaceAll(tokens, nbspBytes, spBytes);
            tokens = bytes.TrimSuffix(tokens, nlZwspBytes);
            const content = new ast.Node(ast.NodeCodeBlockCode, tokens);
            node.AppendChild(content);
            const closeMarker = new ast.Node(ast.NodeCodeBlockFenceCloseMarker, util.StrToBytes("```"));
            closeMarker.CodeBlockFenceLen = 3;
            node.AppendChild(closeMarker);
            context.Tip!.AppendChild(node);
            return;
          }

          // The browser extension supports CSDN formula https://github.com/siyuan-note/siyuan/issues/5624
          if (
            strings.Contains(cls, "MathJax") &&
            null !== n.NextSibling &&
            atom.Script === n.NextSibling.DataAtom &&
            strings.Contains(util.DomAttrValue(n.NextSibling, "type"), "math/tex")
          ) {
            const tex = util.DomText(n.NextSibling);
            appendMathBlock(tree, tex);
            n.NextSibling.Unlink();
            return;
          }

          // The browser extension supports Wikipedia formula clipping https://github.com/siyuan-note/siyuan/issues/11583
          const tex = strings.TrimSpace(util.DomAttrValue(n, "data-tex"));
          if ("" !== tex) {
            appendMathBlock(tree, tex);
            return;
          }
        }

        if (strings.Contains(strings.ToLower(cls), "mathjax")) {
          return;
        }

        if ("" === strings.TrimSpace(util.DomText(n))) {
          for (;;) {
            // 这里用 for 是为了简化实现
            // The for loop is used here to simplify the implementation
            if (
              util.DomExistChildByType(
                n,
                atom.Img,
                atom.Picture,
                atom.Annotation,
                atom.Iframe,
                atom.Video,
                atom.Audio,
                atom.Source,
                atom.Canvas,
                atom.Svg,
                atom.Math,
              )
            ) {
              break;
            }

            const tex = util.GetFormula(n);
            if ("" !== tex) {
              // https://github.com/siyuan-note/siyuan/issues/15457
              appendMathBlock(tree, tex);
              return;
            }

            // span 可能是 TextMark 元素，也可能是公式，其他情况则忽略
            // A span may be a TextMark element or a formula, anything else is ignored
            const spans = util.DomChildrenByType(n, atom.Span);
            if (0 < spans.length) {
              const span = spans[0];
              if ("" !== util.DomAttrValue(span, "data-type") || "" !== util.DomAttrValue(span, "data-tex")) {
                break;
              }
            }
            return;
          }
        }

        node.Type = ast.NodeParagraph;
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.H1:
      case atom.H2:
      case atom.H3:
      case atom.H4:
      case atom.H5:
      case atom.H6: {
        if (ast.NodeLink === context.Tip!.Type) {
          break;
        }

        node.Type = ast.NodeHeading;
        node.HeadingLevel = node.Tokens![1] - 0x30 /* 0 */;
        node.AppendChild(new ast.Node(ast.NodeHeadingC8hMarker, util.StrToBytes(strings.Repeat("#", node.HeadingLevel))));
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Hr: {
        node.Type = ast.NodeThematicBreak;
        context.Tip!.AppendChild(node);
        break;
      }
      case atom.Blockquote: {
        node.Type = ast.NodeBlockquote;
        node.AppendChild(new ast.Node(ast.NodeBlockquoteMarker, util.StrToBytes(">")));
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Ol:
      case atom.Ul: {
        node.Type = ast.NodeList;
        node.ListData = new ast.ListData();
        if (atom.Ol === n.DataAtom) {
          node.ListData.Typ = 1;
        }
        node.ListData.Tight = true;
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Li: {
        node.Type = ast.NodeListItem;
        let marker = util.DomAttrValue(n, "data-marker");
        let bullet = 0;
        if ("" === marker) {
          if (null !== n.Parent && atom.Ol === n.Parent.DataAtom) {
            const start = util.DomAttrValue(n.Parent, "start");
            if ("" === start) {
              marker = "1.";
            } else {
              marker = start + ".";
            }

            if (null !== context.Tip!.LastChild && ast.NodeListItem === context.Tip!.LastChild.Type && null !== context.Tip!.LastChild.ListData) {
              const lastNum = context.Tip!.LastChild.ListData.Marker.subarray(0, context.Tip!.LastChild.ListData.Marker.length - 1);
              let lastNumInt = 0;
              for (const b of lastNum) {
                lastNumInt = lastNumInt * 10 + ((b - 0x30) /* 0 */ & 0xff); // byte arithmetic wraps around in Go
              }
              lastNumInt++;
              marker = `${lastNumInt}.`;
            }
          } else {
            marker = "*";
            bullet = marker.charCodeAt(0);
          }
        } else {
          if (null !== n.Parent && "1." !== marker && atom.Ol === n.Parent.DataAtom && null !== n.Parent.Parent && (atom.Ol === n.Parent.Parent.DataAtom || atom.Ul === n.Parent.Parent.DataAtom)) {
            // 子有序列表必须从 1 开始
            // A nested ordered list must start at 1
            marker = "1.";
          }
        }
        let typ = 0;
        if (null !== context.Tip!.ListData) {
          typ = context.Tip!.ListData.Typ;
        }

        if (1 === typ && !strings.HasSuffix(marker, ".")) {
          marker += ".";
        }
        node.ListData = new ast.ListData();
        node.ListData.Typ = typ;
        node.ListData.Marker = conv.BytesFromString(marker);
        node.ListData.BulletChar = bullet;
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Pre: {
        normalizeCodeMirrorPre(n);
        if (null === n.FirstChild) {
          return;
        }
        let firstc: html.Node = n.FirstChild;

        const codes = util.DomChildrenByType(n, atom.Code);
        if (0 < codes.length) {
          // 删除第一个 code 之前的标签
          // Remove the tags before the first code
          const unlinks: html.Node[] = [];
          for (let prev = codes[0].PrevSibling; null !== prev; prev = prev.PrevSibling) {
            unlinks.push(prev);
          }
          for (const unlink of unlinks) {
            unlink.Unlink();
          }
          if (null === n.FirstChild) {
            return;
          }
          firstc = n.FirstChild;
        }

        const iconClass = util.DomAttrValue(firstc, "class");
        if (strings.Contains(iconClass, "iconfont")) {
          // 处理 pre.i,ol 的情况，i 标签为“复制代码”或“隐藏代码”，ol 标签为“行号”
          // Handle the pre.i,ol case: the i tag is "copy code" or "hide code", the ol tag is the "line numbers"
          // https://github.com/siyuan-note/siyuan/issues/15314
          // PORT-NOTE: when NextSibling is nil, Go panics at the next dereference of firstc; so does the port (TypeError).
          firstc = firstc.NextSibling!;
          n.FirstChild.Unlink();
        }

        if (atom.Em === firstc.DataAtom && null !== firstc.NextSibling && atom.Em === firstc.NextSibling.DataAtom) {
          // pre.em,em,code 的情况，这两个 em 是“复制代码”和“隐藏代码” https://github.com/siyuan-note/siyuan/issues/13026
          // The pre.em,em,code case: the two em are "copy code" and "hide code"

          if (0 < codes.length) {
            firstc = codes[0];
            const unlinks: html.Node[] = [];
            for (let prev = firstc.PrevSibling; null !== prev; prev = prev.PrevSibling) {
              unlinks.push(prev);
            }
            for (const unlink of unlinks) {
              unlink.Unlink();
            }
          }
        }

        if (atom.Div === firstc.DataAtom) {
          if (null === firstc.NextSibling) {
            if (1 === codes.length) {
              const code = codes[0];
              // pre 下只有一个 div，且 div 下只有一个 code，那么将 pre.div 替换为 pre.code https://github.com/siyuan-note/siyuan/issues/11131
              // Under the pre there is only one div and under the div only one code, so replace pre.div with pre.code
              code.Unlink();
              n.AppendChild(code);
              firstc.Unlink();
              firstc = n.FirstChild!;
            }
          } else {
            // pre 下全是 div，每个 div 为一行代码 https://github.com/siyuan-note/siyuan/issues/14195
            // 将其转换为 pre.code， code, ... code，每个 div 为一行代码，然后交由后续处理
            // Everything under the pre is a div, each div is one line of code
            // Convert it to pre.code, code, ... code, each div being one line of code, and let the following code handle it
            const unlinks: html.Node[] = [];
            const codes: html.Node[] = [];
            for (let div: html.Node | null = firstc; null !== div; div = div.NextSibling) {
              const code = new html.Node();
              code.Data = "code";
              code.DataAtom = atom.Code;
              code.Type = html.ElementNode;
              for (let child = div.FirstChild; null !== child; child = div.FirstChild) {
                child.Unlink();
                code.AppendChild(child);
              }
              codes.push(code);
              unlinks.push(div);
            }
            for (const unlink of unlinks) {
              unlink.Unlink();
            }
            for (const code of codes) {
              n.AppendChild(code);
            }
            firstc = n.FirstChild!;
          }
        }

        // 改进两种 pre.ol.li 的代码块解析 Improve the parsing of two kinds of pre.ol.li code blocks https://github.com/siyuan-note/siyuan/issues/11296
        // 第一种：将 pre.ol.li.p.span, span, ... span 转换为 pre.ol.li.p.code, code, ... code，然后交由第二种处理
        // The first kind: convert pre.ol.li.p.span, span, ... span to pre.ol.li.p.code, code, ... code, then let the second kind handle it
        let span2Code = false;
        if (
          atom.Ol === firstc.DataAtom &&
          null === firstc.NextSibling &&
          null !== firstc.FirstChild &&
          atom.Li === firstc.FirstChild.DataAtom &&
          null !== firstc.FirstChild.FirstChild &&
          atom.P === firstc.FirstChild.FirstChild.DataAtom &&
          null !== firstc.FirstChild.FirstChild.FirstChild &&
          (atom.Span === firstc.FirstChild.FirstChild.FirstChild.DataAtom || html.TextNode === firstc.FirstChild.FirstChild.FirstChild.Type)
        ) {
          for (let li: html.Node | null = firstc.FirstChild; null !== li; li = li.NextSibling) {
            const code = new html.Node();
            code.Data = "code";
            code.DataAtom = atom.Code;
            code.Type = html.ElementNode;

            const spans: html.Node[] = [];
            if (null === li.FirstChild) {
              continue;
            }

            for (let span = li.FirstChild.FirstChild; null !== span; span = span.NextSibling) {
              spans.push(span);
            }

            for (const span of spans) {
              span.Unlink();
              code.AppendChild(span);
            }

            li.FirstChild.AppendChild(code);
            span2Code = true;
          }
        }
        // 第二种：将 pre.ol.li.p.code, code, ... code 转换为 pre.code, code, ... code，然后交由后续处理
        // The second kind: convert pre.ol.li.p.code, code, ... code to pre.code, code, ... code, then let the following code handle it
        if (
          atom.Ol === firstc.DataAtom &&
          null === firstc.NextSibling &&
          null !== firstc.FirstChild &&
          atom.Li === firstc.FirstChild.DataAtom &&
          null !== firstc.FirstChild.FirstChild &&
          atom.P === firstc.FirstChild.FirstChild.DataAtom &&
          null !== firstc.FirstChild.FirstChild.FirstChild &&
          atom.Code === firstc.FirstChild.FirstChild.FirstChild.DataAtom
        ) {
          const lis: html.Node[] = [];
          const codes: html.Node[] = [];
          for (let li: html.Node | null = firstc.FirstChild; null !== li; li = li.NextSibling) {
            lis.push(li);
            if (null === li.FirstChild) {
              continue;
            }
            codes.push(li.FirstChild.FirstChild!);
          }
          for (const li of lis) {
            li.Unlink();
          }
          for (const code of codes) {
            code.Unlink();
            n.AppendChild(code);
          }
          firstc.Unlink();
          // PORT-NOTE: when the pre has no child left, Go's firstc is nil and the next line panics; the port throws as well (TypeError).
          firstc = n.FirstChild!;
        }

        if (
          html.TextNode === firstc.Type ||
          atom.Span === firstc.DataAtom ||
          atom.Code === firstc.DataAtom ||
          atom.Section === firstc.DataAtom ||
          atom.Pre === firstc.DataAtom ||
          atom.A === firstc.DataAtom ||
          atom.Strong === firstc.DataAtom ||
          atom.B === firstc.DataAtom ||
          atom.I === firstc.DataAtom ||
          atom.P === firstc.DataAtom
        ) {
          node.Type = ast.NodeCodeBlock;
          node.IsFencedCodeBlock = true;
          const openMarker = new ast.Node(ast.NodeCodeBlockFenceOpenMarker, util.StrToBytes("```"));
          openMarker.CodeBlockFenceLen = 3;
          node.AppendChild(openMarker);
          node.AppendChild(new ast.Node(ast.NodeCodeBlockFenceInfoMarker));
          if (atom.Code === firstc.DataAtom || atom.Span === firstc.DataAtom || atom.A === firstc.DataAtom) {
            let cls = util.DomAttrValue(firstc, "class");
            if (null !== n.Parent && null !== n.Parent.Parent) {
              const parentClass = util.DomAttrValue(n.Parent.Parent, "class");
              if (strings.Contains(parentClass, "language-")) {
                cls = parentClass;
              }
            }
            if (strings.HasPrefix(cls, "lang-")) {
              cls = strings.ReplaceAll(cls, "lang-", "language-");
            }

            if (!strings.Contains(cls, "language-")) {
              cls = util.DomAttrValue(n, "class");
            }
            if (strings.Contains(cls, "language-")) {
              let language = cls.slice(strings.Index(cls, "language-") + "language-".length);
              language = strings.Split(language, " ")[0];
              if ("fallback" !== language && "chroma" !== language) {
                node.LastChild!.CodeBlockInfo = conv.BytesFromString(language);
              }
            } else {
              if (atom.Code === firstc.DataAtom && !span2Code) {
                const cls = util.DomAttrValue(firstc, "class");
                if (!strings.Contains(cls, " ")) {
                  node.LastChild!.CodeBlockInfo = conv.BytesFromString(cls);
                }
              }
            }

            if (1 > node.LastChild!.CodeBlockInfo.length) {
              const cls = util.DomAttrValue(n, "class");
              if (!strings.Contains(cls, " ") && "fallback" !== cls && "chroma" !== cls) {
                node.LastChild!.CodeBlockInfo = conv.BytesFromString(cls);
              }
            }

            if (1 > node.LastChild!.CodeBlockInfo.length) {
              const lang = util.DomAttrValue(n, "data-language");
              if (!strings.Contains(lang, " ")) {
                node.LastChild!.CodeBlockInfo = conv.BytesFromString(lang);
              }
            }

            if (bytes.ContainsAny(node.LastChild!.CodeBlockInfo, "-_ ")) {
              node.LastChild!.CodeBlockInfo = new Uint8Array(0);
            }
          }

          if (atom.Code === firstc.DataAtom) {
            if (null !== firstc.NextSibling && atom.Code === firstc.NextSibling.DataAtom) {
              // pre.code code 每个 code 为一行的结构，需要在 code 中间插入换行
              // The pre.code code structure with one code per line: a line break must be inserted between the code elements
              for (let c: html.Node | null = firstc.NextSibling; null !== c; c = c.NextSibling) {
                const br = new html.Node();
                br.DataAtom = atom.Br;
                c.InsertBefore(br);
              }
            }
            if (null !== firstc.FirstChild && atom.Span === firstc.FirstChild.DataAtom) {
              // pre.code.span 每个 span 为一行的结构，需要在 span 中间插入换行
              // The pre.code.span structure with one span per line: a line break must be inserted between the spans
              for (let c = firstc.FirstChild.NextSibling; null !== c; c = c.NextSibling) {
                if (strings.Contains(util.DomAttrValue(c, "class"), "token-line")) {
                  const br = new html.Node();
                  br.DataAtom = atom.Br;
                  c.InsertBefore(br);
                }
              }
            }

            if (null !== firstc.FirstChild && atom.Ol === firstc.FirstChild.DataAtom) {
              // CSDN 代码块：pre.code.ol.li
              // CSDN code block: pre.code.ol.li
              for (let li = firstc.FirstChild.FirstChild; null !== li; li = li.NextSibling) {
                if (li !== firstc.FirstChild.FirstChild) {
                  const br = new html.Node();
                  br.DataAtom = atom.Br;
                  li.InsertBefore(br);
                }
              }
            }
            if (null !== n.LastChild && atom.Ul === n.LastChild.DataAtom) {
              // CSDN 代码块：pre.code,ul
              // CSDN code block: pre.code,ul
              n.LastChild.Unlink(); // 去掉最后一个代码行号子块 Remove the last child block with the code line numbers https://github.com/siyuan-note/siyuan/issues/5564
            }
          }

          if (atom.Pre === firstc.DataAtom && null !== firstc.FirstChild) {
            // pre.code code 每个 code 为一行的结构，需要在 code 中间插入换行
            // The pre.code code structure with one code per line: a line break must be inserted between the code elements
            for (let c = firstc.FirstChild.NextSibling; null !== c; c = c.NextSibling) {
              const br = new html.Node();
              br.DataAtom = atom.Br;
              c.InsertBefore(br);
            }
          }

          if (atom.P === firstc.DataAtom) {
            // 避免下面 util.DomText 把 p 转换为两个换行
            // Prevent util.DomText below from converting the p to two line breaks
            firstc.DataAtom = atom.Div;
          }

          let tokens: Uint8Array = conv.BytesFromString(util.DomText(n));
          tokens = bytes.ReplaceAll(tokens, nbspBytes, spBytes);
          tokens = bytes.TrimSuffix(tokens, nlZwspBytes);
          const content = new ast.Node(ast.NodeCodeBlockCode, tokens);
          node.AppendChild(content);
          const closeMarker = new ast.Node(ast.NodeCodeBlockFenceCloseMarker, util.StrToBytes("```"));
          closeMarker.CodeBlockFenceLen = 3;
          node.AppendChild(closeMarker);

          if (context.Tip!.ParentIs(ast.NodeTable)) {
            // 如果表格中只有一行一列，那么丢弃表格直接使用代码块
            // If the table has only one row and one column, drop the table and use the code block directly
            // Improve HTML parsing code blocks https://github.com/siyuan-note/siyuan/issues/11068
            for (let table = context.Tip!.Parent; null !== table; table = table.Parent) {
              if (ast.NodeTable === table.Type) {
                if (
                  null !== table.FirstChild &&
                  table.FirstChild === table.LastChild &&
                  ast.NodeTableHead === table.FirstChild.Type &&
                  table.FirstChild.FirstChild === table.FirstChild.LastChild &&
                  null !== table.FirstChild.FirstChild!.FirstChild &&
                  ast.NodeTableCell === table.FirstChild.FirstChild!.FirstChild.Type
                ) {
                  table.InsertBefore(node);
                  table.Unlink();
                  context.Tip = node;

                  let parent = n.Parent;
                  for (let i = 0; i < 32; i++) {
                    if (null === parent) {
                      break;
                    }

                    const cls = util.DomAttrValue(parent, "class");
                    if (strings.Contains(cls, "language-")) {
                      node.ChildByType(ast.NodeCodeBlockFenceInfoMarker)!.CodeBlockInfo = conv.BytesFromString(cls.slice(strings.Index(cls, "language-") + "language-".length));
                      break;
                    } else if (strings.Contains(cls, "highlight ")) {
                      node.ChildByType(ast.NodeCodeBlockFenceInfoMarker)!.CodeBlockInfo = conv.BytesFromString(cls.slice(strings.Index(cls, "highlight ") + "highlight ".length));
                      break;
                    }
                    parent = parent.Parent;
                  }

                  return;
                }
              }
            }

            // 表格中不支持添加块级元素，所以这里只能将其转换为多个行级代码元素
            // Block elements cannot be added to a table, so convert it to several inline code elements
            const lines = bytes.Split(content.Tokens!, nlBytes);
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (0 < line.length) {
                const code = new ast.Node(ast.NodeCodeSpan);
                if (bytes.Contains(line, backtickBytes)) {
                  // UPSTREAM-BUG: sets CodeMarkerLen on the code block node instead of on the code span node
                  node.CodeMarkerLen = 2;
                }
                code.AppendChild(new ast.Node(ast.NodeCodeSpanOpenMarker, conv.BytesFromString("`")));
                code.AppendChild(new ast.Node(ast.NodeCodeSpanContent, line));
                code.AppendChild(new ast.Node(ast.NodeCodeSpanCloseMarker, conv.BytesFromString("`")));
                context.Tip!.AppendChild(code);
                if (i < lines.length - 1) {
                  if (context.ParseOption.ProtyleWYSIWYG) {
                    context.Tip!.AppendChild(new ast.Node(ast.NodeBr));
                  } else {
                    context.Tip!.AppendChild(new ast.Node(ast.NodeHardBreak, conv.BytesFromString("\n")));
                  }
                }
              }
            }
          } else {
            context.Tip!.AppendChild(node);
          }
        } else {
          node.Type = ast.NodeHTMLBlock;
          node.Tokens = util.DomHTML(n);
          context.Tip!.AppendChild(node);
        }
        return;
      }
      case atom.Em:
      case atom.I: {
        const text = util.DomText(n);
        if ("" === strings.TrimSpace(text)) {
          break;
        }

        if (ast.NodeEmphasis === context.Tip!.Type || context.Tip!.ParentIs(ast.NodeEmphasis)) {
          break;
        }

        if (null !== context.Tip!.LastChild && (ast.NodeStrong === context.Tip!.LastChild.Type || ast.NodeEmphasis === context.Tip!.LastChild.Type)) {
          // 在两个相邻的加粗或者斜体之间插入零宽空格，避免标记符重复
          // Insert a zero-width space between two adjacent strong or emphasis nodes to avoid duplicated markers
          context.Tip!.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(editor.Zwsp)));
        }

        if ((!lute.ParseOptions.InlineAsterisk || !lute.ParseOptions.InlineUnderscore) && !lute.ParseOptions.HTMLTag2TextMark) {
          node.Type = ast.NodeHTMLTag;
          node.AppendChild(new ast.Node(ast.NodeHTMLTagOpen, util.StrToBytes("<em>")));
        } else {
          node.Type = ast.NodeEmphasis;
          node.AppendChild(new ast.Node(ast.NodeEmA6kOpenMarker, util.StrToBytes("*")));
        }
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Strong:
      case atom.B: {
        const text = util.DomText(n);
        if ("" === strings.TrimSpace(text)) {
          break;
        }

        if (ast.NodeStrong === context.Tip!.Type || context.Tip!.ParentIs(ast.NodeStrong)) {
          break;
        }

        if (null !== context.Tip!.LastChild && (ast.NodeStrong === context.Tip!.LastChild.Type || ast.NodeEmphasis === context.Tip!.LastChild.Type)) {
          context.Tip!.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(editor.Zwsp)));
        }

        if ((!lute.ParseOptions.InlineAsterisk || !lute.ParseOptions.InlineUnderscore) && !lute.ParseOptions.HTMLTag2TextMark) {
          node.Type = ast.NodeHTMLTag;
          node.AppendChild(new ast.Node(ast.NodeHTMLTagOpen, util.StrToBytes("<strong>")));
        } else {
          node.Type = ast.NodeStrong;
          node.AppendChild(new ast.Node(ast.NodeStrongA6kOpenMarker, util.StrToBytes("**")));
        }
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Code: {
        removeDOMComments(n);
        if (null === n.FirstChild) {
          return;
        }

        if (null !== context.Tip!.LastChild && ast.NodeCodeSpan === context.Tip!.LastChild.Type) {
          context.Tip!.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(editor.Zwsp)));
        }

        let code: Uint8Array = util.DomHTML(n);
        if (bytes.Contains(code, gtBytes)) {
          code = code.subarray(bytes.Index(code, gtBytes) + 1);
        }
        code = bytes.TrimSuffix(code, codeCloseBytes);

        if (codeTextOnly(n)) {
          // 代码中的文本修饰元素仅影响 HTML 展示，转换时使用可见文本 https://github.com/siyuan-note/siyuan/issues/18505
          // The text decoration elements in the code only affect the HTML display, so the visible text is used for the conversion
          code = conv.BytesFromString(util.DomText(n));
          code = bytes.ReplaceAll(code, nbspBytes, spBytes);
          code = bytes.ReplaceAll(code, nlBytes, spBytes);
        }

        const content = new ast.Node(ast.NodeCodeSpanContent, code);
        node.Type = ast.NodeCodeSpan;
        if (bytes.Contains(code, backtick3Bytes)) {
          node.CodeMarkerLen = 2;
        } else if (bytes.Contains(code, backtick2Bytes)) {
          node.CodeMarkerLen = 1;
        } else if (bytes.Contains(code, backtickBytes)) {
          node.CodeMarkerLen = 2;
        }
        node.AppendChild(new ast.Node(ast.NodeCodeSpanOpenMarker, conv.BytesFromString("`")));
        if (bytes.Contains(code, backtick2Bytes)) {
          content.Tokens = slices.Append(conv.BytesFromString(" "), content.Tokens!);
        }
        node.AppendChild(content);
        if (bytes.Contains(code, backtick2Bytes)) {
          content.Tokens = slices.AppendByte(content.Tokens!, 0x20);
        }
        node.AppendChild(new ast.Node(ast.NodeCodeSpanCloseMarker, conv.BytesFromString("`")));
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        return;
      }
      case atom.Br: {
        if (ast.NodeLink === context.Tip!.Type || ast.NodeHeading === context.Tip!.Type) {
          break;
        }

        if (null === n.NextSibling) {
          break;
        }

        if (context.ParseOption.ProtyleWYSIWYG && lute.parentIs(n, atom.Table)) {
          node.Type = ast.NodeBr;
        } else {
          node.Type = ast.NodeHardBreak;
          node.Tokens = util.StrToBytes("\n");
        }
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.A: {
        node.Type = ast.NodeLink;
        const text = strings.TrimSpace(util.DomText(n));
        if ("" === text && null !== n.Parent && lute.parentIs(n, atom.H1, atom.H2, atom.H3, atom.H4, atom.H5, atom.H6, atom.Div, atom.Section) && 0 === util.DomChildrenByType(n, atom.Img).length) {
          // 丢弃标题中文本为空的链接，这样的链接是没有锚文本的锚点
          // Drop the links with empty text in headings, such links are anchors without anchor text
          // https://github.com/Vanessa219/vditor/issues/359
          // https://github.com/siyuan-note/siyuan/issues/11445
          return;
        }
        if ("" === text && null === n.FirstChild) {
          // 剪藏时过滤空的超链接 Filter out empty hyperlinks when clipping https://github.com/siyuan-note/siyuan/issues/5686
          return;
        }

        if (null !== n.FirstChild && atom.Img === n.FirstChild.DataAtom && strings.Contains(util.DomAttrValue(n.FirstChild, "src"), "wikimedia.org")) {
          // Wikipedia 链接嵌套图片的情况只保留图片
          // For a Wikipedia link that wraps an image only the image is kept
          break;
        }

        node.AppendChild(new ast.Node(ast.NodeOpenBracket));
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Img: {
        const imgClass = util.DomAttrValue(n, "class");
        let imgAlt = util.DomAttrValue(n, "alt");
        if ("emoji" === imgClass) {
          const e = parse.EmojiUnicodeAliasMap().get(imgAlt) ?? "";
          if ("" !== e) {
            // 直接使用 alt 值（即 emoji 字符）Use the alt value (the emoji character) directly https://github.com/siyuan-note/siyuan/issues/13342
            node.Type = ast.NodeText;
            node.Tokens = conv.BytesFromString(imgAlt);
          } else {
            node.Type = ast.NodeEmoji;
            const emojiImg = new ast.Node(ast.NodeEmojiImg, tree.EmojiImgTokens(imgAlt, util.DomAttrValue(n, "src")));
            emojiImg.AppendChild(new ast.Node(ast.NodeEmojiAlias, util.StrToBytes(":" + imgAlt + ":")));
            node.AppendChild(emojiImg);
          }
        } else {
          node.Type = ast.NodeImage;
          node.AppendChild(new ast.Node(ast.NodeBang));
          node.AppendChild(new ast.Node(ast.NodeOpenBracket));
          if ("" !== imgAlt) {
            imgAlt = strings.TrimSpace(imgAlt);
            imgAlt = strings.ReplaceAll(imgAlt, "]", "");
            imgAlt = strings.ReplaceAll(imgAlt, "\n", " ");
            imgAlt = strings.ReplaceAll(imgAlt, "动图封面", "动图");
            node.AppendChild(new ast.Node(ast.NodeLinkText, util.StrToBytes(imgAlt)));
          }
          node.AppendChild(new ast.Node(ast.NodeCloseBracket));
          node.AppendChild(new ast.Node(ast.NodeOpenParen));
          let src = util.DomAttrValue(n, "src");
          if (strings.Contains(cls, "ztext-gif") && strings.Contains(src, "zhimg.com")) {
            // 处理知乎动图
            // Handle Zhihu animated images
            src = strings.Replace(src, ".jpg", ".webp", 1);
          }

          if (strings.HasPrefix(src, "data:image") || strings.HasSuffix(src, "img-loading.svg")) {
            // 处理可能存在的预加载情况
            // Handle a possible preloading case
            const dataSrc = util.DomAttrValue(n, "data-src");
            if ("" !== dataSrc) {
              if (strings.HasPrefix(dataSrc, "http://") || strings.HasPrefix(dataSrc, "https://")) {
                src = dataSrc;
              }
            }
          }

          // 处理使用 data-original 属性的情况 Handle the data-original attribute https://github.com/siyuan-note/siyuan/issues/11826
          const dataOriginal = util.DomAttrValue(n, "data-original");
          if ("" !== dataOriginal && !strings.HasPrefix(dataOriginal, "/")) {
            if ("" === src || !strings.HasSuffix(src, ".gif")) {
              src = dataOriginal;
            }
          }

          if ("" === src) {
            // 处理使用 srcset 属性的情况
            // Handle the srcset attribute
            const srcset = util.DomAttrValue(n, "srcset");
            if ("" !== srcset) {
              if (strings.Contains(srcset, ",")) {
                src = strings.Split(srcset, ",")[strings.Split(srcset, ",").length - 1];
                src = strings.TrimSpace(src);
                if (strings.Contains(src, " ")) {
                  src = strings.TrimSpace(strings.Split(src, " ")[0]);
                }
              } else {
                src = strings.TrimSpace(src);
                if (strings.Contains(src, " ")) {
                  src = strings.TrimSpace(strings.Split(srcset, " ")[0]);
                }
              }
            }
          }

          // Wikipedia 使用图片原图 Use the original image on Wikipedia https://github.com/siyuan-note/siyuan/issues/11640
          if (strings.Contains(src, "wikipedia/commons/thumb/")) {
            let ext = pathExt(src);
            if (strings.Contains(src, ".svg.png")) {
              ext = ".svg";
            }
            const idx = strings.Index(src, ext + "/");
            if (0 < idx) {
              src = src.slice(0, idx + ext.length);
              src = strings.ReplaceAll(src, "/commons/thumb/", "/commons/");
            }
          }

          node.AppendChild(new ast.Node(ast.NodeLinkDest, util.StrToBytes(src)));
          let linkTitle = "";

          let figcaption: html.Node | null = null;
          for (let next = n.NextSibling; null !== next; next = next.NextSibling) {
            if (html.TextNode === next.Type && "" === strings.TrimSpace(next.Data)) {
              continue;
            }

            if (atom.Figcaption === next.DataAtom) {
              figcaption = next;
              break;
            }
          }

          if (null !== figcaption) {
            linkTitle = util.DomText(figcaption);
            figcaption.Unlink();
          }
          if ("" === linkTitle) {
            linkTitle = util.DomAttrValue(n, "title");
          }
          linkTitle = strings.TrimSpace(linkTitle);
          if ("" !== linkTitle && "null" !== linkTitle && "undefined" !== linkTitle) {
            node.AppendChild(new ast.Node(ast.NodeLinkSpace));
            node.AppendChild(new ast.Node(ast.NodeLinkTitle, conv.BytesFromString(linkTitle)));
          }
          node.AppendChild(new ast.Node(ast.NodeCloseParen));

          let width = strings.TrimSpace(util.DomAttrValue(n, "width"));
          if ("" !== width) {
            if (util.IsDigit(width)) {
              width += "px";
            }
            const style = "width: " + width + ";";
            const ial = new ast.Node(ast.NodeKramdownSpanIAL, parse.IAL2Tokens([["style", style]]));
            node.SetIALAttr("style", style);
            node.InsertAfter(ial);
          } else {
            let height = strings.TrimSpace(util.DomAttrValue(n, "height"));
            if ("" !== height) {
              if (util.IsDigit(height)) {
                height += "px";
              }
              const style = "height: " + height + ";";
              const ial = new ast.Node(ast.NodeKramdownSpanIAL, parse.IAL2Tokens([["style", style]]));
              node.SetIALAttr("style", style);
              node.InsertAfter(ial);
            }
          }
        }

        if (ast.NodeDocument === context.Tip!.Type) {
          const p = new ast.Node(ast.NodeParagraph);
          context.Tip!.AppendChild(p);
          context.Tip = p;
          defers.push((): void => context.ParentTip());
        }

        const ial = node.Next;
        context.Tip!.AppendChild(node);
        if (null !== ial) {
          context.Tip!.AppendChild(ial);
        }

        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Input: {
        node.Type = ast.NodeTaskListItemMarker;
        node.ReviveFromDataTask(util.DomAttrValue(n, "data-task"), lute.hasAttr(n, "checked"));
        context.Tip!.AppendChild(node);
        if (null !== node.Parent!.Parent) {
          if (null === node.Parent!.Parent.ListData) {
            node.Parent!.Parent.ListData = new ast.ListData();
            node.Parent!.Parent.ListData.Typ = 3;
          } else {
            node.Parent!.Parent.ListData.Typ = 3;
          }
        }
        break;
      }
      case atom.Del:
      case atom.S:
      case atom.Strike: {
        if (!lute.ParseOptions.GFMStrikethrough && !lute.ParseOptions.HTMLTag2TextMark) {
          node.Type = ast.NodeHTMLTag;
          node.AppendChild(new ast.Node(ast.NodeHTMLTagOpen, util.StrToBytes("<s>")));
        } else {
          node.Type = ast.NodeStrikethrough;
          node.AppendChild(new ast.Node(ast.NodeStrikethrough2OpenMarker, util.StrToBytes("~~")));
        }
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.U: {
        if (lute.ParseOptions.ProtyleWYSIWYG) {
          // 使用原生下划线节点，使嵌套文本的样式属性参与平铺转换。
          // Use the native underline node, so that the style attributes of the nested text take part in the flattening.
          node.Type = ast.NodeUnderline;
          node.AppendChild(new ast.Node(ast.NodeUnderlineOpenMarker));
        } else {
          node.Type = ast.NodeHTMLTag;
          node.AppendChild(new ast.Node(ast.NodeHTMLTagOpen, util.StrToBytes("<u>")));
        }
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Mark: {
        if (!lute.ParseOptions.Mark && !lute.ParseOptions.HTMLTag2TextMark) {
          node.Type = ast.NodeHTMLTag;
          node.AppendChild(new ast.Node(ast.NodeHTMLTagOpen, util.StrToBytes("<mark>")));
        } else {
          node.Type = ast.NodeMark;
          node.AppendChild(new ast.Node(ast.NodeMark2OpenMarker, util.StrToBytes("==")));
        }
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Sup: {
        if (!lute.ParseOptions.Sup && !lute.ParseOptions.HTMLTag2TextMark) {
          node.Type = ast.NodeHTMLTag;
          node.AppendChild(new ast.Node(ast.NodeHTMLTagOpen, util.StrToBytes("<sup>")));
        } else {
          node.Type = ast.NodeSup;
          node.AppendChild(new ast.Node(ast.NodeSupOpenMarker));
        }
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Sub: {
        if (!lute.ParseOptions.Sub && !lute.ParseOptions.HTMLTag2TextMark) {
          node.Type = ast.NodeHTMLTag;
          node.AppendChild(new ast.Node(ast.NodeHTMLTagOpen, util.StrToBytes("<sub>")));
        } else {
          node.Type = ast.NodeSub;
          node.AppendChild(new ast.Node(ast.NodeSubOpenMarker));
        }
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Table: {
        node.Type = ast.NodeTable;
        const tableAligns: number[] = [];
        if (null !== n.FirstChild && null !== n.FirstChild.FirstChild && null !== n.FirstChild.FirstChild.FirstChild) {
          for (let th: html.Node | null = n.FirstChild.FirstChild.FirstChild; null !== th; th = th.NextSibling) {
            const align = util.DomAttrValue(th, "align");
            switch (align) {
              case "left":
                tableAligns.push(1);
                break;
              case "center":
                tableAligns.push(2);
                break;
              case "right":
                tableAligns.push(3);
                break;
              default:
                tableAligns.push(0);
            }
          }
        }

        if (null !== context.Tip!.LastChild && !context.Tip!.LastChild.IsBlock()) {
          // 如果上一个节点不是块级元素，那么需要先添加一个换行节点 Improve HTML table clipping https://github.com/siyuan-note/siyuan/issues/15307
          // If the previous node is not a block element, a line break node must be added first
          context.Tip!.AppendChild(new ast.Node(ast.NodeHardBreak));
        }

        // PORT-NOTE: Go's tableAligns is nil when empty; node.TableAligns is a plain array here.
        node.TableAligns = tableAligns;
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Thead: {
        if (null === n.FirstChild) {
          break;
        }

        const tbodys = util.DomChildrenByType(n.Parent!, atom.Tbody);
        if (0 < tbodys.length) {
          const tbody = tbodys[0];
          // 找到最多的 td 数
          // Find the largest number of td
          let tdCount = 0;
          for (let tr = tbody.FirstChild; null !== tr; tr = tr.NextSibling) {
            if (atom.Tr !== tr.DataAtom) {
              continue;
            }

            let count = 0;
            for (let td = tr.FirstChild; null !== td; td = td.NextSibling) {
              if (atom.Td === td.DataAtom) {
                count++;
              }
            }

            if (count > tdCount) {
              tdCount = count;
            }
          }

          // 补全 thead 中 tr 的 th
          // Complete the th of the tr in the thead
          for (let tr: html.Node | null = n.FirstChild; null !== tr; tr = tr.NextSibling) {
            if (atom.Tr !== tr.DataAtom) {
              continue;
            }

            let count = 0;
            for (let td = tr.FirstChild; null !== td; td = td.NextSibling) {
              if (atom.Th === td.DataAtom || atom.Td === td.DataAtom) {
                count++;
              }
            }

            if (count < tdCount) {
              for (let i = count; i < tdCount; i++) {
                const th = new html.Node();
                th.Data = "th";
                th.DataAtom = atom.Th;
                th.Type = html.ElementNode;
                tr.AppendChild(th);
              }
            }
          }
        }

        node.Type = ast.NodeTableHead;
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Tbody: {
        break;
      }
      case atom.Tr: {
        if (null === n.FirstChild) {
          break;
        }
        const table = n.Parent!.Parent;
        node.Type = ast.NodeTableRow;

        if (null === context.Tip!.ChildByType(ast.NodeTableHead) && 1 > util.DomChildrenByType(table!, atom.Thead).length) {
          // 补全 thead 节点
          // Complete the thead node
          const thead = new ast.Node(ast.NodeTableHead);
          context.Tip!.AppendChild(thead);
          context.Tip = thead;
          defers.push((): void => context.ParentTip());
        }

        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Th:
      case atom.Td: {
        node.Type = ast.NodeTableCell;
        node.TableCellAlign = parse.TableCellAlignValue(util.DomAttrValue(n, "align"), util.DomAttrValue(n, "style"));
        context.Tip!.AppendChild(node);
        setTableCellSpanIAL(node, n);
        for (const attr of n.Attr) {
          if (ast.TableCellRichAttribute === attr.Key) {
            node.TableCellRich = ast.DecodeTableCellRich(attr.Val);
            parse.ApplyTableCellRichProjection(node);
            return;
          }
        }
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Colgroup:
      case atom.Col: {
        return;
      }
      case atom.Span:
      case atom.Small: {
        const cls = util.DomAttrValue(n, "class");
        if ("fn__space5" === cls) {
          return;
        }

        if ("tip" === cls) {
          // 转换为行级备注 Convert to an inline memo https://github.com/siyuan-note/siyuan/issues/13998
          if (null !== context.Tip!.LastChild && ast.NodeText === context.Tip!.LastChild.Type) {
            context.Tip!.LastChild.Type = ast.NodeTextMark;
            context.Tip!.LastChild.TextMarkType = "inline-memo";
            context.Tip!.LastChild.TextMarkTextContent = context.Tip!.LastChild.TokensStr();
            context.Tip!.LastChild.TextMarkInlineMemoContent = util.DomText(n);
            if (null !== context.Tip!.LastChild.Previous && ast.NodeText === context.Tip!.LastChild.Previous.Type) {
              context.Tip!.LastChild.Previous.Tokens = slices.NilIfEmpty(bytes.TrimSpace(context.Tip!.LastChild.Previous.Tokens!));
              if (0 === (context.Tip!.LastChild.Previous.Tokens?.length ?? 0)) {
                context.Tip!.LastChild.Previous.Unlink();
              }
            }
            return;
          }
        }

        const title = strings.TrimSpace(util.DomAttrValue(n, "title"));
        if ("" !== title && context.Tip!.IsBlock()) {
          // 转换为行级备注 Convert to an inline memo https://github.com/siyuan-note/siyuan/issues/13998
          node.Type = ast.NodeTextMark;
          node.TextMarkType = "inline-memo";
          node.TextMarkTextContent = util.DomText(n);
          node.TextMarkInlineMemoContent = title;
          context.Tip!.AppendChild(node);
          if (null !== context.Tip!.LastChild!.Previous && ast.NodeText === context.Tip!.LastChild!.Previous.Type) {
            context.Tip!.LastChild!.Previous.Tokens = slices.NilIfEmpty(bytes.TrimSpace(context.Tip!.LastChild!.Previous.Tokens!));
            if (0 === (context.Tip!.LastChild!.Previous.Tokens?.length ?? 0)) {
              context.Tip!.LastChild!.Previous.Unlink();
            }
          }
          return;
        }

        // Improve inline elements pasting https://github.com/siyuan-note/siyuan/issues/11740
        let dataType = util.DomAttrValue(n, "data-type");
        if (strings.Contains(dataType, " ")) {
          node.Type = ast.NodeTextMark;
          node.TextMarkType = dataType;
          node.TextMarkTextContent = util.DomText(n);
          context.Tip!.AppendChild(node);
          return;
        } else {
          dataType = strings.Split(dataType, " ")[0]; // 简化为只处理第一个类型 Simplified to handle only the first type
          switch (dataType) {
            case "inline-math": {
              const mathContent = util.DomAttrValue(n, "data-content");
              appendInlineMath(tree, mathContent);
              return;
            }
            case "code": {
              if (null !== context.Tip!.LastChild && ast.NodeCodeSpan === context.Tip!.LastChild.Type) {
                context.Tip!.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(editor.Zwsp)));
              }

              const code = new ast.Node(ast.NodeCodeSpan);
              const content = util.StrToBytes(util.DomText(n));
              if (bytes.Contains(content, backtickBytes)) {
                // UPSTREAM-BUG: sets CodeMarkerLen on node (the span element's node) instead of on code
                node.CodeMarkerLen = 2;
              }
              code.AppendChild(new ast.Node(ast.NodeCodeSpanOpenMarker, conv.BytesFromString("`")));
              code.AppendChild(new ast.Node(ast.NodeCodeSpanContent, content));
              code.AppendChild(new ast.Node(ast.NodeCodeSpanCloseMarker, conv.BytesFromString("`")));
              context.Tip!.AppendChild(code);
              return;
            }
            case "tag": {
              const tag = new ast.Node(ast.NodeTag);
              tag.AppendChild(new ast.Node(ast.NodeTagOpenMarker, util.StrToBytes("#")));
              tag.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
              tag.AppendChild(new ast.Node(ast.NodeTagCloseMarker, util.StrToBytes("#")));
              context.Tip!.AppendChild(tag);
              return;
            }
            case "kbd": {
              if (null !== context.Tip!.LastChild && ast.NodeKbd === context.Tip!.LastChild.Type) {
                context.Tip!.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(editor.Zwsp)));
              }

              const kbd = new ast.Node(ast.NodeKbd);
              kbd.AppendChild(new ast.Node(ast.NodeKbdOpenMarker));
              kbd.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
              kbd.AppendChild(new ast.Node(ast.NodeKbdCloseMarker));
              context.Tip!.AppendChild(kbd);
              return;
            }
            case "sub": {
              const sub = new ast.Node(ast.NodeSub);
              sub.AppendChild(new ast.Node(ast.NodeSubOpenMarker));
              sub.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
              sub.AppendChild(new ast.Node(ast.NodeSubCloseMarker));
              context.Tip!.AppendChild(sub);
              return;
            }
            case "sup": {
              const sup = new ast.Node(ast.NodeSup);
              sup.AppendChild(new ast.Node(ast.NodeSupOpenMarker));
              sup.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
              sup.AppendChild(new ast.Node(ast.NodeSupCloseMarker));
              context.Tip!.AppendChild(sup);
              return;
            }
            case "mark": {
              const mark = new ast.Node(ast.NodeMark);
              mark.AppendChild(new ast.Node(ast.NodeMark2OpenMarker, util.StrToBytes("==")));
              mark.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
              mark.AppendChild(new ast.Node(ast.NodeMark2CloseMarker, util.StrToBytes("==")));
              context.Tip!.AppendChild(mark);
              return;
            }
            case "s": {
              const s = new ast.Node(ast.NodeStrikethrough);
              s.AppendChild(new ast.Node(ast.NodeStrikethrough2OpenMarker, util.StrToBytes("~~")));
              s.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
              s.AppendChild(new ast.Node(ast.NodeStrikethrough2CloseMarker, util.StrToBytes("~~")));
              context.Tip!.AppendChild(s);
              return;
            }
            case "u": {
              const u = new ast.Node(ast.NodeUnderline);
              u.AppendChild(new ast.Node(ast.NodeUnderlineOpenMarker));
              u.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
              u.AppendChild(new ast.Node(ast.NodeUnderlineCloseMarker));
              context.Tip!.AppendChild(u);
              return;
            }
            case "em": {
              const em = new ast.Node(ast.NodeEmphasis);
              em.AppendChild(new ast.Node(ast.NodeEmA6kOpenMarker, util.StrToBytes("*")));
              em.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
              em.AppendChild(new ast.Node(ast.NodeEmA6kCloseMarker, util.StrToBytes("*")));
              context.Tip!.AppendChild(em);
              return;
            }
            case "strong": {
              const strong = new ast.Node(ast.NodeStrong);
              strong.AppendChild(new ast.Node(ast.NodeStrongA6kOpenMarker, util.StrToBytes("**")));
              strong.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
              strong.AppendChild(new ast.Node(ast.NodeStrongA6kCloseMarker, util.StrToBytes("**")));
              context.Tip!.AppendChild(strong);
              return;
            }
            case "block-ref": {
              const ref = new ast.Node(ast.NodeBlockRef);
              ref.AppendChild(new ast.Node(ast.NodeOpenParen));
              ref.AppendChild(new ast.Node(ast.NodeOpenParen));
              ref.AppendChild(new ast.Node(ast.NodeBlockRefID, util.StrToBytes(util.DomAttrValue(n, "data-id"))));
              ref.AppendChild(new ast.Node(ast.NodeBlockRefSpace));
              if ("s" === util.DomAttrValue(n, "data-subtype")) {
                ref.AppendChild(new ast.Node(ast.NodeBlockRefText, util.StrToBytes(util.DomText(n))));
              } else {
                ref.AppendChild(new ast.Node(ast.NodeBlockRefDynamicText, util.StrToBytes(util.DomText(n))));
              }
              ref.AppendChild(new ast.Node(ast.NodeCloseParen));
              ref.AppendChild(new ast.Node(ast.NodeCloseParen));

              context.Tip!.AppendChild(ref);
              return;
            }
          }
        }

        const tex0 = strings.TrimSpace(util.DomAttrValue(n, "data-tex"));
        if ("" !== tex0 && strings.Fields(cls).includes("language-math")) {
          if (null !== util.DomChildByTypeAndClass(n, atom.Span, "katex-display") || null !== util.DomChildByTypeAndClass(n, atom.Span, "MathJax_SVG_Display")) {
            appendMathBlock(tree, tex0);
          } else {
            appendInlineMath(tree, tex0);
          }
          return;
        }

        // The browser extension supports Zhihu formula https://github.com/siyuan-note/siyuan/issues/5599
        const tex1 = strings.TrimSpace(util.DomAttrValue(n, "data-tex"));
        if ("" !== tex1) {
          const tex = tex1;
          if (
            (strings.Contains(util.DomAttrValue(n, "class"), "math-inline") && (null !== n.PrevSibling || null !== n.NextSibling || lute.parentIs(n, atom.Table))) ||
            (null !== n.Parent && strings.Contains(util.DomAttrValue(n.Parent, "class"), "math-inline"))
          ) {
            appendInlineMath(tree, tex);
            return;
          }

          const parentInline =
            null !== n.Parent &&
            (lute.parentIs(n, atom.Strong, atom.Em, atom.I, atom.B, atom.Span, atom.Td, atom.Th) || strings.Contains(util.DomAttrValue(n.Parent, "class"), "inline"));
          if (
            parentInline &&
            atom.Span === n.DataAtom &&
            null === n.PrevSibling &&
            (null === n.NextSibling || (html.TextNode === n.NextSibling.Type && "" === strings.TrimSpace(util.DomText(n.NextSibling)))) &&
            null === n.Parent!.PrevSibling &&
            (null === n.Parent!.NextSibling || (html.TextNode === n.Parent!.NextSibling.Type && "" === strings.TrimSpace(util.DomText(n.Parent!.NextSibling))))
          ) {
            appendMathBlock(tree, tex);
            return;
          }

          if (!parentInline && null === n.PrevSibling && (null === n.NextSibling || (html.TextNode === n.NextSibling.Type && "" === strings.TrimSpace(util.DomText(n.NextSibling))))) {
            appendMathBlock(tree, tex);
            return;
          }

          if (!parentInline) {
            const parentBlock = null !== n.Parent && (lute.parentIs(n, atom.Div, atom.Section, atom.P) || strings.Contains(util.DomAttrValue(n.Parent, "class"), "block"));
            if (
              parentBlock &&
              atom.Span === n.DataAtom &&
              null === n.PrevSibling &&
              (null === n.NextSibling || (html.TextNode === n.NextSibling.Type && "" === strings.TrimSpace(util.DomText(n.NextSibling))))
            ) {
              appendMathBlock(tree, tex);
              return;
            }
          }

          if ((atom.Span === n.DataAtom && "katex-display" === util.DomAttrValue(n, "class")) || null !== util.DomChildByTypeAndClass(n, atom.Span, "MathJax_SVG_Display")) {
            appendMathBlock(tree, tex);
            return;
          }

          if (strings.HasSuffix(strings.TrimSpace(tex), "\\\\") || strings.Contains(tex, "\n") || strings.Contains(tex, "\\tag{")) {
            appendMathBlock(tree, tex);
          } else {
            appendInlineMath(tree, tex);
          }
          return;
        }

        // The browser extension supports CSDN formula https://github.com/siyuan-note/siyuan/issues/5624
        if (strings.Contains(strings.ToLower(strings.TrimSpace(util.DomAttrValue(n, "class"))), "katex")) {
          const span = util.DomChildByTypeAndClass(n, atom.Span, "katex-mathml");
          if (null !== span) {
            let tex = util.DomText(span.FirstChild);
            if ("" !== tex) {
              tex = strings.TrimSpace(tex);
              while (strings.Contains(tex, "\n ")) {
                tex = strings.ReplaceAll(tex, "\n ", "\n");
              }
              // 根据最后 4 个换行符分隔公式内容
              // Split the formula content at the last 4 line breaks
              const idx = strings.LastIndex(tex, "\n\n\n\n");
              if (0 < idx) {
                tex = tex.slice(idx + 4);
                tex = strings.TrimSpace(tex);
                appendInlineMath(tree, tex);
                return;
              }
            }
          }
        }
        if (strings.Contains(strings.ToLower(strings.TrimSpace(util.DomAttrValue(n, "class"))), "mathjax")) {
          const scripts = util.DomChildrenByType(n, atom.Script);
          if (0 < scripts.length) {
            const script = scripts[0];
            const tex = util.DomText(script.FirstChild);
            if ("" !== tex) {
              appendInlineMath(tree, tex);
              return;
            }
          }
          return;
        }

        const style = util.DomAttrValue(n, "style");
        if (textStyle === "" && strings.Contains(style, "underline")) {
          const text = util.DomText(n);
          if ("" === text) {
            break;
          }

          if (null !== context.Tip!.LastChild && ast.NodeHTMLTag !== context.Tip!.LastChild.Type) {
            if (ast.NodeUnderline === context.Tip!.Type || context.Tip!.ParentIs(ast.NodeUnderline)) {
              break;
            }

            const u = new ast.Node(ast.NodeUnderline);
            u.AppendChild(new ast.Node(ast.NodeUnderlineOpenMarker));
            u.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(text)));
            u.AppendChild(new ast.Node(ast.NodeUnderlineCloseMarker));
            context.Tip!.AppendChild(u);
            return;
          }
        }

        if (textStyle === "" && strings.Contains(style, "bold")) {
          const text = util.DomText(n);
          if ("" === text) {
            break;
          }

          if (null !== context.Tip!.LastChild && ast.NodeHTMLTag !== context.Tip!.LastChild.Type) {
            if (ast.NodeStrong === context.Tip!.Type || context.Tip!.ParentIs(ast.NodeStrong)) {
              break;
            }

            if (ast.NodeStrong === context.Tip!.LastChild.Type) {
              if (null !== context.Tip!.LastChild.LastChild!.Previous && ast.NodeText === context.Tip!.LastChild.LastChild!.Previous.Type) {
                context.Tip!.LastChild.LastChild!.Previous.Tokens = slices.Append(context.Tip!.LastChild.LastChild!.Previous.Tokens ?? new Uint8Array(0), conv.BytesFromString(text));
                return;
              }
            }

            const strong = new ast.Node(ast.NodeStrong);
            strong.AppendChild(new ast.Node(ast.NodeStrongA6kOpenMarker, util.StrToBytes("**")));
            strong.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(text)));
            strong.AppendChild(new ast.Node(ast.NodeStrongA6kCloseMarker, util.StrToBytes("**")));
            context.Tip!.AppendChild(strong);
            return;
          }
        }
        break;
      }
      case atom.Kbd: {
        if (null !== context.Tip!.LastChild && ast.NodeKbd === context.Tip!.LastChild.Type) {
          context.Tip!.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(editor.Zwsp)));
        }

        const kbd = new ast.Node(ast.NodeKbd);
        kbd.AppendChild(new ast.Node(ast.NodeKbdOpenMarker));
        kbd.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(util.DomText(n))));
        kbd.AppendChild(new ast.Node(ast.NodeKbdCloseMarker));
        context.Tip!.AppendChild(kbd);
        return;
      }
      case atom.Font: {
        if (lute.ParseOptions.ProtyleWYSIWYG) {
          for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
            lute.genASTByDOM(c, tree);
          }
          return;
        }
        node.Type = ast.NodeText;
        let tokens: Uint8Array = conv.BytesFromString(util.DomText(n));
        while (bytes.Contains(tokens, nlNlBytes)) {
          tokens = bytes.ReplaceAll(tokens, nlNlBytes, nlBytes);
        }

        while (bytes.Contains(tokens, nlSpSpBytes)) {
          tokens = bytes.ReplaceAll(tokens, nlSpSpBytes, nlSpBytes);
        }
        tokens = bytes.ReplaceAll(tokens, nlSpBytes, nlBytes);

        tokens = bytes.ReplaceAll(tokens, nlBytes, spBytes);
        node.Tokens = tokens;
        context.Tip!.AppendChild(node);
        return;
      }
      case atom.Details: {
        node.Type = ast.NodeList;
        node.ListData = new ast.ListData();
        node.ListData.Tight = true;
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        defers.push((): void => context.ParentTip());
        break;
      }
      case atom.Summary: {
        if (ast.NodeList !== context.Tip!.Type || null === n.Parent || atom.Details !== n.Parent.DataAtom) {
          return;
        }

        const li = new ast.Node(ast.NodeListItem);
        li.ListData = new ast.ListData();
        li.ListData.Marker = conv.BytesFromString("*");
        li.ListData.BulletChar = 0x2a /* * */;
        node.Type = ast.NodeParagraph;
        li.AppendChild(node);
        context.Tip!.AppendChild(li);
        context.Tip = node;
        break;
      }
      case atom.Iframe:
      case atom.Audio: {
        node.Type = ast.NodeHTMLBlock;
        node.Tokens = util.DomHTML(n);
        context.Tip!.AppendChild(node);
        return;
      }
      case atom.Video: {
        const htmlContent = util.DomHTML(n);
        const h = util.ParseHTML(conv.StringFromBytes(htmlContent));
        if (null === h) {
          return;
        }
        const videos = util.DomChildrenByType(h, atom.Video);
        if (1 > videos.length) {
          return;
        }
        if (1 < videos.length) {
          node.Tokens = htmlContent;
          context.Tip!.AppendChild(node);
          return;
        }
        const video = videos[0];
        const sources = util.DomChildrenByType(video, atom.Source);
        if (1 > sources.length) {
          node.Tokens = htmlContent;
          context.Tip!.AppendChild(node);
          return;
        }

        const source = sources[0];
        source.Unlink();
        util.RemoveDomAttrs(video);
        util.SetDomAttrValue(video, "src", util.DomAttrValue(source, "src"));
        util.SetDomAttrValue(video, "controls", "controls");
        node.Tokens = util.DomHTML(video);
        context.Tip!.AppendChild(node);
        return;
      }
      case atom.Noscript: {
        return;
      }
      case atom.Script: {
        const tex = util.DomText(n.FirstChild);
        if ("" !== tex) {
          if (
            context.Tip!.IsContainerBlock() ||
            (null !== n.Parent && strings.Contains(util.DomAttrValue(n.Parent, "class"), "math display") && n.Parent.LastChild === n) ||
            strings.Contains(util.DomAttrValue(n, "type"), "mode=display")
          ) {
            appendMathBlock(tree, tex);
          } else {
            appendInlineMath(tree, tex);
          }
          return;
        }
        break;
      }
      case atom.Figcaption: {
        if (context.Tip!.IsBlock()) {
          if (null !== context.Tip!.LastChild && ast.NodeImage === context.Tip!.LastChild.Type) {
            const closeParen = context.Tip!.LastChild.ChildByType(ast.NodeCloseParen);
            if (null !== closeParen) {
              if (null !== n.FirstChild && atom.Span === n.FirstChild.DataAtom) {
                // 单独处理 <figcaption> 中的 <span leaf> 标签的情况 Handle the <span leaf> tag in <figcaption> separately https://github.com/siyuan-note/siyuan/issues/14507
                const c = n.FirstChild.FirstChild;
                if (null !== c) {
                  c.Unlink();
                  n.AppendChild(c);
                }
                n.FirstChild.Unlink();
              }

              if (!util.DomExistChildByType(n, atom.A, atom.Span)) {
                // 图片标题不包含非文本元素，包含的话走下面的逻辑，单独作为一个段落
                // The image title contains no non-text elements; if it does, the logic below makes it a paragraph of its own
                const linkTitle = strings.TrimSpace(util.DomText(n));
                if ("" !== linkTitle && "null" !== linkTitle && "undefined" !== linkTitle) {
                  closeParen.InsertBefore(new ast.Node(ast.NodeLinkSpace));
                  closeParen.InsertBefore(new ast.Node(ast.NodeLinkTitle, conv.BytesFromString(linkTitle)));
                  return;
                }
              }
            }
          }

          if (ast.NodeDocument !== context.Tip!.Type) {
            context.Tip!.AppendChild(new ast.Node(ast.NodeHardBreak));
            break;
          }
        }

        node.Type = ast.NodeParagraph;
        context.Tip!.AppendChild(node);
        context.Tip = node;
        break;
      }
      case atom.Figure:
      case atom.Picture: {
        if (!context.Tip!.IsBlock()) {
          break;
        }

        node.Type = ast.NodeParagraph;
        context.Tip!.AppendChild(node);
        context.Tip = node;
        defers.push((): void => context.ParentTip());
        break;
      }
      default:
    }

    for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
      lute.genASTByDOM(c, tree);
    }

    switch (n.DataAtom) {
      case atom.Em:
      case atom.I: {
        if ((!lute.ParseOptions.InlineAsterisk || !lute.ParseOptions.InlineUnderscore) && !lute.ParseOptions.HTMLTag2TextMark) {
          node.AppendChild(new ast.Node(ast.NodeHTMLTagClose, util.StrToBytes("</em>")));
        } else {
          node.Type = ast.NodeEmphasis;
          node.AppendChild(new ast.Node(ast.NodeEmA6kCloseMarker, util.StrToBytes("*")));
        }
        appendSpace(n, tree, lute);
        break;
      }
      case atom.Strong:
      case atom.B: {
        if ((!lute.ParseOptions.InlineAsterisk || !lute.ParseOptions.InlineUnderscore) && !lute.ParseOptions.HTMLTag2TextMark) {
          node.AppendChild(new ast.Node(ast.NodeHTMLTagClose, util.StrToBytes("</strong>")));
        } else {
          node.AppendChild(new ast.Node(ast.NodeStrongA6kCloseMarker, util.StrToBytes("**")));
        }
        appendSpace(n, tree, lute);
        break;
      }
      case atom.A: {
        node.AppendChild(new ast.Node(ast.NodeCloseBracket));
        node.AppendChild(new ast.Node(ast.NodeOpenParen));
        node.AppendChild(new ast.Node(ast.NodeLinkDest, util.StrToBytes(util.DomAttrValue(n, "href"))));
        const linkTitle = util.DomAttrValue(n, "title");
        if ("" !== linkTitle) {
          node.AppendChild(new ast.Node(ast.NodeLinkSpace));
          node.AppendChild(new ast.Node(ast.NodeLinkTitle, util.StrToBytes(linkTitle)));
        }
        node.AppendChild(new ast.Node(ast.NodeCloseParen));
        break;
      }
      case atom.Del:
      case atom.S:
      case atom.Strike: {
        if (!lute.ParseOptions.GFMStrikethrough && !lute.ParseOptions.HTMLTag2TextMark) {
          node.AppendChild(new ast.Node(ast.NodeHTMLTagClose, util.StrToBytes("</s>")));
        } else {
          node.AppendChild(new ast.Node(ast.NodeStrikethrough2CloseMarker, util.StrToBytes("~~")));
        }
        appendSpace(n, tree, lute);
        break;
      }
      case atom.U: {
        if (node.Type === ast.NodeUnderline) {
          node.AppendChild(new ast.Node(ast.NodeUnderlineCloseMarker));
        } else {
          node.AppendChild(new ast.Node(ast.NodeHTMLTagClose, util.StrToBytes("</u>")));
        }
        break;
      }
      case atom.Mark: {
        if (!lute.ParseOptions.Mark && !lute.ParseOptions.HTMLTag2TextMark) {
          node.AppendChild(new ast.Node(ast.NodeHTMLTagClose, util.StrToBytes("</mark>")));
        } else {
          node.AppendChild(new ast.Node(ast.NodeMark2CloseMarker, util.StrToBytes("==")));
        }
        appendSpace(n, tree, lute);
        break;
      }
      case atom.Sup: {
        if (!lute.ParseOptions.Sup && !lute.ParseOptions.HTMLTag2TextMark) {
          node.AppendChild(new ast.Node(ast.NodeHTMLTagClose, util.StrToBytes("</sup>")));
        } else {
          node.AppendChild(new ast.Node(ast.NodeSupCloseMarker));
        }
        appendSpace(n, tree, lute);
        break;
      }
      case atom.Sub: {
        if (!lute.ParseOptions.Sub && !lute.ParseOptions.HTMLTag2TextMark) {
          node.AppendChild(new ast.Node(ast.NodeHTMLTagClose, util.StrToBytes("</sub>")));
        } else {
          node.AppendChild(new ast.Node(ast.NodeSubCloseMarker));
        }
        appendSpace(n, tree, lute);
        break;
      }
      case atom.Details: {
        context.ParentTip();
        break;
      }
      case atom.Summary: {
        context.ParentTip();
        break;
      }
    }
  } finally {
    for (let i = defers.length - 1; i >= 0; i--) {
      defers[i]();
    }
  }
};

Lute.prototype.genASTByCalloutDOM = function (this: Lute, n: html.Node, tree: parse.Tree): boolean {
  const lute = this;
  if (!lute.ParseOptions.Callout || atom.Div !== n.DataAtom || !domClassContains(n, "callout")) {
    return false;
  }

  const typ = strings.TrimSpace(util.DomAttrValue(n, "data-subtype"));
  if ("" === typ || strings.ContainsAny(typ, "]\r\n")) {
    return false;
  }

  const info = directDomChildByClass(n, "callout-info");
  const content = directDomChildByClass(n, "callout-content");
  if (null === info || null === content) {
    return false;
  }

  const callout = new ast.Node(ast.NodeCallout);
  callout.CalloutType = typ;
  const icon = directDomChildByClass(info, "callout-icon");
  if (null !== icon) {
    const images = util.DomChildrenByType(icon, atom.Img);
    if (0 < images.length) {
      const src = strings.TrimSpace(util.DomAttrValue(images[0], "src"));
      if (ast.IsValidCalloutImageSrc(src)) {
        callout.CalloutIcon = src;
        callout.CalloutIconType = 1;
      }
    } else {
      callout.CalloutIcon = strings.TrimSpace(util.DomText(icon));
    }
  }
  const title = directDomChildByClass(info, "callout-title");
  if (null !== title) {
    callout.CalloutTitle = strings.TrimSpace(lute.HTML2Md(conv.StringFromBytes(util.DomHTML(title))));
    callout.CalloutTitleExplicit = true;
  }

  tree.Context!.Tip!.AppendChild(callout);
  tree.Context!.Tip = callout;
  for (let child = content.FirstChild; null !== child; child = child.NextSibling) {
    lute.genASTByDOM(child, tree);
  }
  tree.Context!.ParentTip();
  return true;
};

function directDomChildByClass(n: html.Node, cls: string): html.Node | null {
  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    if (domClassContains(child, cls)) {
      return child;
    }
  }
  return null;
}

export function domClassContains(n: html.Node, cls: string): boolean {
  return strings.Fields(util.DomAttrValue(n, "class")).includes(cls);
}

function normalizeCodeMirrorPre(n: html.Node): void {
  const content = domDescendantByClass(n, "cm-content");
  if (null === content) {
    return;
  }

  const lines: string[] = [];
  for (let child = content.FirstChild; null !== child; child = child.NextSibling) {
    if (domClassContains(child, "cm-line")) {
      lines.push(strings.TrimSuffix(util.DomText(child), "\n"));
    }
  }
  if (0 === lines.length) {
    return;
  }

  const code = new html.Node();
  code.Data = "code";
  code.DataAtom = atom.Code;
  code.Type = html.ElementNode;
  const text = strings.Join(lines, "\n");
  if ("" !== text) {
    const textNode = new html.Node();
    textNode.Data = text;
    textNode.Type = html.TextNode;
    code.AppendChild(textNode);
  }
  const language = strings.TrimSpace(util.DomAttrValue(content, "data-language"));
  if ("" !== language) {
    util.SetDomAttrValue(code, "class", "language-" + language);
  }
  while (null !== n.FirstChild) {
    n.FirstChild.Unlink();
  }
  // CodeMirror 使用 cm-line 元素表示代码行，规范化为 pre.code 以保留换行和语言。
  // CodeMirror uses cm-line elements for the code lines; normalize them to pre.code to keep the line breaks and the language.
  n.AppendChild(code);
}

function domDescendantByClass(n: html.Node, cls: string): html.Node | null {
  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    if (domClassContains(child, cls)) {
      return child;
    }
    const descendant = domDescendantByClass(child, cls);
    if (null !== descendant) {
      return descendant;
    }
  }
  return null;
}

function codeTextOnly(n: html.Node): boolean {
  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    if (html.TextNode === child.Type) {
      continue;
    }
    if (html.ElementNode !== child.Type) {
      return false;
    }
    const dataRender = util.DomAttrValue(child, "data-render");
    if ("1" === dataRender || "2" === dataRender) {
      return false;
    }
    switch (child.DataAtom) {
      case atom.Abbr:
      case atom.B:
      case atom.Br:
      case atom.Del:
      case atom.Em:
      case atom.I:
      case atom.Kbd:
      case atom.Mark:
      case atom.P:
      case atom.Q:
      case atom.S:
      case atom.Samp:
      case atom.Small:
      case atom.Span:
      case atom.Strike:
      case atom.Strong:
      case atom.Sub:
      case atom.Sup:
      case atom.Time:
      case atom.U:
      case atom.Var:
        break;
      default:
        return false;
    }
    if (!codeTextOnly(child)) {
      return false;
    }
  }
  return true;
}

function removeDOMComments(n: html.Node): void {
  for (let child = n.FirstChild; null !== child; ) {
    const next: html.Node | null = child.NextSibling;
    if (html.CommentNode === child.Type) {
      child.Unlink();
    } else {
      removeDOMComments(child);
    }
    child = next;
  }
}

function appendInlineMath(tree: parse.Tree, tex: string): void {
  tex = strings.TrimSpace(tex);
  tex = strings.TrimPrefix(tex, "\\(");
  tex = strings.TrimSuffix(tex, "\\)");
  tex = strings.TrimPrefix(tex, "\\[");
  tex = strings.TrimSuffix(tex, "\\]");
  if ("" === tex) {
    return;
  }

  const inlineMath = new ast.Node(ast.NodeInlineMath);
  inlineMath.AppendChild(new ast.Node(ast.NodeInlineMathOpenMarker, conv.BytesFromString("$")));
  inlineMath.AppendChild(new ast.Node(ast.NodeInlineMathContent, util.StrToBytes(tex)));
  inlineMath.AppendChild(new ast.Node(ast.NodeInlineMathCloseMarker, conv.BytesFromString("$")));
  tree.Context!.Tip!.AppendChild(inlineMath);
  tree.Context!.Tip = inlineMath;
  // Go: defer tree.Context.ParentTip(), the last statement of the function body
  tree.Context!.ParentTip();
}

function appendMathBlock(tree: parse.Tree, tex: string): void {
  tex = strings.TrimSpace(tex);
  tex = strings.TrimPrefix(tex, "\\(");
  tex = strings.TrimSuffix(tex, "\\)");
  tex = strings.TrimPrefix(tex, "\\[");
  tex = strings.TrimSuffix(tex, "\\]");
  if ("" === tex) {
    return;
  }

  const mathBlock = new ast.Node(ast.NodeMathBlock);
  mathBlock.AppendChild(new ast.Node(ast.NodeMathBlockOpenMarker, conv.BytesFromString("$$")));
  mathBlock.AppendChild(new ast.Node(ast.NodeMathBlockContent, util.StrToBytes(tex)));
  mathBlock.AppendChild(new ast.Node(ast.NodeMathBlockCloseMarker, conv.BytesFromString("$$")));

  if (ast.NodeParagraph === tree.Context!.Tip!.Type) {
    tree.Context!.Tip!.InsertAfter(mathBlock);
    if (null === tree.Context!.Tip!.FirstChild) {
      tree.Context!.Tip!.Unlink();
    }
  } else {
    tree.Context!.Tip!.AppendChild(mathBlock);
  }
  tree.Context!.Tip = mathBlock;
  // Go: defer tree.Context.ParentTip(), the last statement of the function body
  tree.Context!.ParentTip();
}

function appendSpace(n: html.Node, tree: parse.Tree, lute: Lute): void {
  if (null !== n.NextSibling) {
    const nextText = util.DomText(n.NextSibling);
    if ("" !== nextText) {
      let runes = conv.RunesFromString(nextText);
      if (!unicode.IsSpace(runes[0])) {
        if (unicode.IsPunct(runes[0]) || unicode.IsSymbol(runes[0])) {
          tree.Context!.Tip!.InsertBefore(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp)));
          tree.Context!.Tip!.InsertAfter(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp)));
          return;
        }

        const curText = util.DomText(n);
        if ("" !== curText) {
          runes = conv.RunesFromString(curText);
          const lastC = runes[runes.length - 1];
          if (unicode.IsPunct(lastC) || unicode.IsSymbol(lastC)) {
            const text = tree.Context!.Tip!.ChildByType(ast.NodeText);
            if (null !== text) {
              text.Tokens = slices.Append(conv.BytesFromString(editor.Zwsp), text.Tokens ?? new Uint8Array(0));
              text.Tokens = slices.Append(text.Tokens, conv.BytesFromString(editor.Zwsp));
            }
            return;
          }

          let spaces = lute.prefixSpaces(curText);
          if ("" !== spaces) {
            const previous = tree.Context!.Tip!.Previous;
            if (null !== previous) {
              if (ast.NodeText === previous.Type) {
                previous.Tokens = slices.Append(previous.Tokens ?? new Uint8Array(0), util.StrToBytes(spaces));
              } else {
                previous.InsertAfter(new ast.Node(ast.NodeText, util.StrToBytes(spaces)));
              }
            } else {
              tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(spaces)));
            }

            const text = tree.Context!.Tip!.ChildByType(ast.NodeText);
            if (null !== text) {
              // UPSTREAM-BUG: the cutset " Š" contains U+0160 (S with caron) where U+00A0 (no-break space) was probably meant
              text.Tokens = slices.NilIfEmpty(bytes.TrimLeft(text.Tokens ?? new Uint8Array(0), " Š"));
            }
          }
          spaces = lute.suffixSpaces(curText);
          if ("" !== spaces) {
            const texts = tree.Context!.Tip!.ChildrenByType(ast.NodeText);
            if (0 < texts.length) {
              const text = texts[texts.length - 1];
              // UPSTREAM-BUG: the cutset " Š" contains U+0160 (S with caron) where U+00A0 (no-break space) was probably meant
              text.Tokens = bytes.TrimRight(text.Tokens ?? new Uint8Array(0), " Š");
              if (1 > text.Tokens.length) {
                text.Unlink();
              }
            }
            if (null !== n.NextSibling) {
              if (html.TextNode === n.NextSibling.Type) {
                n.NextSibling.Data = spaces + n.NextSibling.Data;
              } else {
                tree.Context!.Tip!.InsertAfter(new ast.Node(ast.NodeText, util.StrToBytes(spaces)));
              }
            } else {
              tree.Context!.Tip!.InsertAfter(new ast.Node(ast.NodeText, util.StrToBytes(spaces)));
            }
          }
        }
      }
    }
  }
}
