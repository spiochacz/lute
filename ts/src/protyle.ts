// Ported from protyle.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: the methods of h2m.go (HTML2Markdown, genASTByDOM) and vditor_wysiwyg.go (Md2HTML, HTML2Md, adjustVditorDOM, parentIs, domChild, isCaret, hasAttr, startsWithNewline, setDOMAttrValue) are called as Go does; they are attached to Lute by those files.
// PORT-NOTE: `defer` is ported as try/finally around the rest of the function body. A deferred `tree.Context.ParentTip()` (registered conditionally in Go) is a boolean flag that the finally block checks; Go runs deferred calls last-in first-out, so the ParentTip call (registered later) runs before the TipAppendChild of the block IAL.

import * as bytes from "./runtime/bytes.ts";
import * as conv from "./runtime/conv.ts";
import * as slices from "./runtime/slices.ts";
import * as strconv from "./runtime/strconv.ts";
import * as strings from "./runtime/strings.ts";
import * as ast from "./ast/index.ts";
import * as editor from "./editor/index.ts";
import * as html from "./html/index.ts";
import * as atom from "./html/atom/index.ts";
import * as lex from "./lex/index.ts";
import * as parse from "./parse/index.ts";
import * as render from "./render/index.ts";
import * as util from "./util/index.ts";
import { Lute } from "./types.ts";
import { directDOMChildByClass, hasDOMClass, unwrapTabItemFragments, wrapTabItemFragments } from "./protyle_tabs.ts";

// emptyBytes stands in for a nil []byte that is only read.
const emptyBytes: Uint8Array = new Uint8Array(0);

// PORT-NOTE: perf, departs from 1:1 (protyle.go:418, BlockDOM2Tree): nbspBytes and spaceBytes are the two arguments of the text node replacement, converted once instead of once per text node. They are shared by all calls and are only read: bytes.ReplaceAllOrNil copies its replacement into the result and never keeps or writes the array.
const nbspBytes: Uint8Array = conv.BytesFromString(" ");
const spaceBytes: Uint8Array = conv.BytesFromString(" ");

declare module "./types.ts" {
  interface Lute {
    SpinBlockDOM(ivHTML: string): string;
    HTML2BlockDOM(sHTML: string): string;
    BlockDOM2HTML(vHTML: string): string;
    BlockDOM2RichHTML(vHTML: string): string;
    BlockDOM2InlineBlockDOM(vHTML: string): string;
    Md2BlockDOM(markdown: string, reserveEmptyParagraph: boolean): string;
    Md2BlockDOMWithAutoLink(markdown: string, reserveEmptyParagraph: boolean): string;
    Md2BlockDOMTree(markdown: string, reserveEmptyParagraph: boolean): [string, parse.Tree];
    InlineMd2BlockDOM(markdown: string): string;
    BlockDOM2Md(htmlStr: string): string;
    BlockDOM2StdMd(htmlStr: string): string;
    BlockDOM2Text(htmlStr: string): string;
    BlockDOM2TextLen(htmlStr: string): number;
    BlockDOM2Content(htmlStr: string): string;
    BlockDOM2EscapeMarkerContent(htmlStr: string): string;
    Tree2BlockDOM(tree: parse.Tree, options: render.Options, parseOptions: parse.Options): string;
    RenderNodeBlockDOM(node: ast.Node): string;
    BlockDOM2Tree(htmlStr: string): parse.Tree | null;
    MergeSameTextMark(n: ast.Node): void;
    MergeSameSpan(n: ast.Node): void;
    CancelSuperBlock(ivHTML: string): string;
    CancelList(ivHTML: string): string;
    CancelListRecursively(ivHTML: string): string;
    CancelBlockquote(ivHTML: string): string;
    CancelCallout(ivHTML: string): string;
    Blocks2Ps(ivHTML: string): string;
    Blocks2Hs(ivHTML: string, level: string): string;
    ConvertListType(ivHTML: string, targetType: string): string;
    OL2TL(ivHTML: string): string;
    UL2TL(ivHTML: string): string;
    TL2OL(ivHTML: string): string;
    TL2UL(ivHTML: string): string;
    OL2UL(ivHTML: string): string;
    UL2OL(ivHTML: string): string;
    Callout2Blockquote(ivHTML: string): string;
    Blockquote2Callout(ivHTML: string): string;
    blockDOM2Md(htmlStr: string): string;
    blockDOMTree2Md(tree: parse.Tree): string;
    genASTByBlockDOM(n: html.Node, tree: parse.Tree): void;
    genASTContenteditable(n: html.Node, tree: parse.Tree): void;
    setBlockIAL(n: html.Node, node: ast.Node): Uint8Array;
    setBlockIAL2(n: html.Node, node: ast.Node): Uint8Array;
    removeInnerMarker(n: html.Node, marker: string): void;
    removeInnerMarker0(n: html.Node | null, marker: string): void;
    removeTempMark(dataType: string): string;
  }
}

// htmlTextNode is the port of the literal &html.Node{Type: html.TextNode, Data: data}.
function htmlTextNode(data: string): html.Node {
  const ret = new html.Node();
  ret.Type = html.TextNode;
  ret.Data = data;
  return ret;
}

Lute.prototype.SpinBlockDOM = function (this: Lute, ivHTML: string): string {
  const lute = this;
  let ovHTML: string = "";
  //fmt.Println(ivHTML)

  const keepEscaped = lute.ParseOptions.KeepEscaped;
  lute.ParseOptions.KeepEscaped = true;
  try {
    const blockDOMTree = lute.BlockDOM2Tree(ivHTML)!;
    const mindmapTypes = new Map<string, ast.NodeType>();
    ast.Walk(blockDOMTree.Root!, (node: ast.Node, entering: boolean): ast.WalkStatus => {
      if (entering && "" !== node.ID && (node.Type === ast.NodeMindmap || node.Type === ast.NodeMindmapItem)) {
        mindmapTypes.set(node.ID, node.Type);
      }
      return ast.WalkContinue;
    });
    const tabFragments = wrapTabItemFragments(blockDOMTree);
    normalizeSpinCaretNewline(blockDOMTree);
    let markdown = lute.blockDOMTree2Md(blockDOMTree);
    markdown = strings.ReplaceAll(markdown, editor.Zwsp, "");
    const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
    ast.Walk(tree.Root!, (node: ast.Node, entering: boolean): ast.WalkStatus => {
      if (entering && "" !== node.ID) {
        const typ = mindmapTypes.get(node.ID);
        if (undefined !== typ &&
          ((typ === ast.NodeMindmap && node.Type === ast.NodeList) || (typ === ast.NodeMindmapItem && node.Type === ast.NodeListItem))) {
          node.Type = typ;
        }
      }
      return ast.WalkContinue;
    });
    unwrapTabItemFragments(tree, tabFragments);

    const firstChild = tree.Root!.FirstChild!;
    const lastChildMaybeIAL = tree.Root!.LastChild!.Previous;
    if (ast.NodeParagraph === firstChild.Type && "" === firstChild.ID && null !== lastChildMaybeIAL && firstChild !== lastChildMaybeIAL.Previous &&
      ast.NodeKramdownBlockIAL === lastChildMaybeIAL.Type) {
      // After a soft line break several blocks are generated, the old ID must be moved to the first block
      const previousID = lastChildMaybeIAL.Previous!.ID;
      const previousIAL = lastChildMaybeIAL.Previous!.KramdownIAL;
      firstChild.ID = previousID;
      lastChildMaybeIAL.Previous!.ID = "";
      firstChild.KramdownIAL = previousIAL;
      lastChildMaybeIAL.Previous!.KramdownIAL = null;
      firstChild.InsertAfter(lastChildMaybeIAL);
    }
    if (ast.NodeKramdownBlockIAL === firstChild.Type && null !== firstChild.Next && ast.NodeKramdownBlockIAL === firstChild.Next.Type && util.IsDocIAL(firstChild.Next.Tokens ?? emptyBytes)) {
      // Restore the empty paragraph block
      const ialArray = parse.Tokens2IAL(firstChild.Tokens);
      const ial = parse.IAL2Map(ialArray);
      const p = new ast.Node(ast.NodeParagraph);
      p.ID = ial.get("id") ?? "";
      p.KramdownIAL = ialArray;
      firstChild.InsertBefore(p);
    }

    // Parse the Markdown inline syntax in text marks, so that the preset style is inherited by the newly generated inline elements.
    // https://github.com/siyuan-note/siyuan/issues/19186
    parse.TextMarks2InlinesWithNestedSyntax(tree);

    // Inline elements nested with Markdown markers are restored to plain text https://github.com/siyuan-note/siyuan/issues/7637
    // Here the mixed nested inline elements (for example <strong><span a></span></strong>) are split into several flat inline elements (<span strong> and <span strong a>)
    parse.NestedInlines2FlattedSpansHybrid(tree, false);

    ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
    return ovHTML;
  } finally {
    lute.ParseOptions.KeepEscaped = keepEscaped;
  }
};

Lute.prototype.HTML2BlockDOM = function (this: Lute, sHTML: string): string {
  const lute = this;
  let vHTML: string = "";
  //fmt.Println(sHTML)
  const [markdown, err] = lute.HTML2Markdown(sHTML);
  if (null !== err) {
    vHTML = err.message;
    return vHTML;
  }

  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewProtyleRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.HTML2BlockDOMRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const output = renderer.Render();
  vHTML = util.BytesToStr(output);
  return vHTML;
};

Lute.prototype.BlockDOM2HTML = function (this: Lute, vHTML: string): string {
  const lute = this;
  const markdown = lute.blockDOM2Md(vHTML);
  const sHTML = lute.Md2HTML(markdown);
  return sHTML;
};

Lute.prototype.BlockDOM2RichHTML = function (this: Lute, vHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(vHTML)!;
  const renderer = render.NewHtmlRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  renderer.SetTextMarkStandardTag();
  const sHTML = util.BytesToStr(renderer.Render());
  return sHTML;
};

Lute.prototype.BlockDOM2InlineBlockDOM = function (this: Lute, vHTML: string): string {
  const lute = this;
  const markdown = lute.blockDOM2Md(vHTML);
  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const inlines: ast.Node[] = [];
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if (ast.NodeTableCell === n.Type) {
      n.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
      return ast.WalkContinue;
    }

    if (!n.IsBlock()) {
      if (ast.NodeCodeBlockCode !== n.Type && ast.NodeMathBlockContent !== n.Type && ast.NodeTaskListItemMarker !== n.Type &&
        ast.NodeTableHead !== n.Type && ast.NodeTableRow !== n.Type && ast.NodeTableCell !== n.Type) {
        if (ast.NodeBlockquoteMarker === n.Type) {
          inlines.push(new ast.Node(ast.NodeText, conv.BytesFromString(">")));
          return ast.WalkSkipChildren;
        }

        inlines.push(n);
        return ast.WalkSkipChildren;
      }
    } else if (ast.NodeHTMLBlock === n.Type) {
      inlines.push(new ast.Node(ast.NodeText, n.Tokens));
      return ast.WalkSkipChildren;
    }
    return ast.WalkContinue;
  });

  const unlinks: ast.Node[] = [];
  for (let n = tree.Root!.FirstChild; null !== n; n = n.Next) {
    unlinks.push(n);
  }
  for (const n of unlinks) {
    n.Unlink();
  }

  for (const n of inlines) {
    tree.Root!.AppendChild(n);
  }

  const renderer = render.NewProtyleRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  const output = renderer.Render();
  let vIHTML = util.BytesToStr(output);
  vIHTML = strings.TrimSpace(vIHTML);
  return vIHTML;
};

Lute.prototype.Md2BlockDOM = function (this: Lute, markdown: string, reserveEmptyParagraph: boolean): string {
  const lute = this;
  const [vHTML] = lute.Md2BlockDOMTree(markdown, reserveEmptyParagraph);
  return vHTML;
};

Lute.prototype.Md2BlockDOMWithAutoLink = function (this: Lute, markdown: string, reserveEmptyParagraph: boolean): string {
  const lute = this;
  const protyleAutoLink = lute.ParseOptions.ProtyleWYSIWYGAutoLink;
  try {
    lute.ParseOptions.ProtyleWYSIWYGAutoLink = true;
    const [vHTML] = lute.Md2BlockDOMTree(markdown, reserveEmptyParagraph);
    return vHTML;
  } finally {
    lute.ParseOptions.ProtyleWYSIWYGAutoLink = protyleAutoLink;
  }
};

Lute.prototype.Md2BlockDOMTree = function (this: Lute, markdown: string, reserveEmptyParagraph: boolean): [string, parse.Tree] {
  const lute = this;
  const keepEscaped = lute.ParseOptions.KeepEscaped;
  lute.ParseOptions.KeepEscaped = true;
  try {
    const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);

    parse.TextMarks2Inlines(tree); // Convert TextMark to Inlines first https://github.com/siyuan-note/siyuan/issues/13056
    parse.NestedInlines2FlattedSpansHybrid(tree, false);
    if (reserveEmptyParagraph) {
      ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
        if (!entering) {
          return ast.WalkContinue;
        }

        if (n.IsEmptyBlockIAL()) {
          const p = new ast.Node(ast.NodeParagraph);
          p.KramdownIAL = parse.Tokens2IAL(n.Tokens);
          p.ID = p.IALAttr("id");
          n.InsertBefore(p);
          return ast.WalkContinue;
        }
        return ast.WalkContinue;
      });
    }

    const renderer = render.NewProtyleRenderer(tree, lute.RenderOptions, lute.ParseOptions);
    for (const [nodeType, rendererFunc] of lute.Md2BlockDOMRendererFuncs) {
      renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
    }
    const output = renderer.Render();
    const vHTML = util.BytesToStr(output);
    return [vHTML, tree];
  } finally {
    lute.ParseOptions.KeepEscaped = keepEscaped;
  }
};

Lute.prototype.InlineMd2BlockDOM = function (this: Lute, markdown: string): string {
  const lute = this;
  const keepEscaped = lute.ParseOptions.KeepEscaped;
  lute.ParseOptions.KeepEscaped = true;
  try {
    const tree = parse.Inline("", conv.BytesFromString(markdown), lute.ParseOptions);
    parse.NestedInlines2FlattedSpansHybrid(tree, false);
    const renderer = render.NewProtyleRenderer(tree, lute.RenderOptions, lute.ParseOptions);
    for (const [nodeType, rendererFunc] of lute.Md2BlockDOMRendererFuncs) {
      renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
    }
    const output = renderer.Render();
    const vHTML = util.BytesToStr(output);
    return vHTML;
  } finally {
    lute.ParseOptions.KeepEscaped = keepEscaped;
  }
};

Lute.prototype.BlockDOM2Md = function (this: Lute, htmlStr: string): string {
  const lute = this;
  // The text marks of Kramdown keep the HTML entities, so that the text does not become a tag when it is parsed again.
  const keepEscaped = lute.ParseOptions.KeepEscaped;
  lute.ParseOptions.KeepEscaped = true;
  try {
    let kramdown = lute.blockDOM2Md(htmlStr);
    kramdown = strings.ReplaceAll(kramdown, editor.Zwsp, "");
    return kramdown;
  } finally {
    lute.ParseOptions.KeepEscaped = keepEscaped;
  }
};

Lute.prototype.BlockDOM2StdMd = function (this: Lute, htmlStr: string): string {
  const lute = this;
  const keepEscaped = lute.ParseOptions.KeepEscaped;
  lute.ParseOptions.KeepEscaped = false;
  try {
    // DOM to AST
    const tree = lute.BlockDOM2Tree(htmlStr)!;
    wrapTabItemFragments(tree);
    removeBlockDOMZwsp(tree);

    // Empty the content of the kramdown IAL nodes
    ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
      if (!entering) {
        return ast.WalkContinue;
      }

      if (ast.NodeKramdownBlockIAL === n.Type || ast.NodeKramdownSpanIAL === n.Type) {
        n.Tokens = null;
      }
      return ast.WalkContinue;
    });

    const options = render.NewOptions();
    options.AutoSpace = false;
    options.FixTermTypo = false;
    options.KramdownBlockIAL = true;
    options.KramdownSpanIAL = true;
    options.KeepParagraphBeginningSpace = true;
    options.OmitTableCellIAL = true;
    options.TabsMarkdown = true;
    options.UnorderedListMarker = lute.RenderOptions.UnorderedListMarker;
    options.ExportNormalizeTaskListMarker = lute.RenderOptions.ExportNormalizeTaskListMarker;
    const renderer = render.NewProtyleExportMdRenderer(tree, options, lute.ParseOptions);
    const formatted = renderer.Render();
    const markdown = util.BytesToStr(formatted);
    return markdown;
  } finally {
    lute.ParseOptions.KeepEscaped = keepEscaped;
  }
};

Lute.prototype.BlockDOM2Text = function (this: Lute, htmlStr: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(htmlStr)!;
  return tree.Root!.Text();
};

Lute.prototype.BlockDOM2TextLen = function (this: Lute, htmlStr: string): number {
  const lute = this;
  const tree = lute.BlockDOM2Tree(htmlStr)!;
  return tree.Root!.TextLen();
};

Lute.prototype.BlockDOM2Content = function (this: Lute, htmlStr: string): string {
  const lute = this;
  const keepEscaped = lute.ParseOptions.KeepEscaped;
  lute.ParseOptions.KeepEscaped = true;
  try {
    const tree = lute.BlockDOM2Tree(htmlStr)!;
    return tree.Root!.Content();
  } finally {
    lute.ParseOptions.KeepEscaped = keepEscaped;
  }
};

Lute.prototype.BlockDOM2EscapeMarkerContent = function (this: Lute, htmlStr: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(htmlStr)!;
  return tree.Root!.EscapeMarkerContent();
};

Lute.prototype.Tree2BlockDOM = function (this: Lute, tree: parse.Tree, options: render.Options, parseOptions: parse.Options): string {
  const lute = this;
  const renderer = render.NewProtyleRenderer(tree, options, parseOptions);
  for (const [nodeType, rendererFunc] of lute.Md2BlockDOMRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const output = renderer.Render();
  let vHTML = util.BytesToStr(output);
  vHTML = strings.ReplaceAll(vHTML, editor.Caret, "<wbr>");
  return vHTML;
};

Lute.prototype.RenderNodeBlockDOM = function (this: Lute, node: ast.Node): string {
  const lute = this;
  const root = new ast.Node(ast.NodeDocument);
  const tree = new parse.Tree();
  tree.Root = root;
  tree.Context = new parse.Context(lute.ParseOptions);
  const renderer = render.NewProtyleRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.Md2BlockDOMRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  renderer.Writer = new bytes.Buffer();
  ast.Walk(node, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    const rendererFunc = renderer.RendererFuncs.get(n.Type)!;
    return rendererFunc(n, entering);
  });
  return renderer.Writer.String();
};

Lute.prototype.BlockDOM2Tree = function (this: Lute, htmlStr: string): parse.Tree | null {
  const lute = this;
  let ret: parse.Tree | null = null;
  htmlStr = strings.ReplaceAll(htmlStr, "\n<wbr>\n</strong>", "</strong>\n<wbr>\n");
  htmlStr = strings.ReplaceAll(htmlStr, "\n<wbr>\n</em>", "</em>\n<wbr>\n");
  htmlStr = strings.ReplaceAll(htmlStr, "\n<wbr>\n</s>", "</s>\n<wbr>\n");
  htmlStr = strings.ReplaceAll(htmlStr, "\n<wbr>\n</u>", "</u>\n<wbr>\n");
  htmlStr = strings.ReplaceAll(htmlStr, "\n<wbr>\n</span>", "</span>\n<wbr>\n");

  htmlStr = strings.ReplaceAll(htmlStr, "<wbr>", editor.Caret);

  let startSpaces = 0;
  let endSpaces = 0;
  for (let i = 0; i < htmlStr.length; i++) {
    if (0x20 /* space */ === htmlStr.charCodeAt(i)) {
      startSpaces++;
    } else {
      break;
    }
  }
  for (let i = htmlStr.length - 1; i >= 0; i--) {
    if (0x20 /* space */ === htmlStr.charCodeAt(i)) {
      endSpaces++;
    } else {
      break;
    }
  }
  htmlStr = strings.TrimSpace(htmlStr);
  htmlStr = strings.Repeat("&nbsp;", startSpaces) + htmlStr + strings.Repeat("&nbsp;", endSpaces);

  // Replace the trailing whitespace, otherwise the HTML parsing produces redundant nodes that lead to empty code blocks
  while (strings.HasSuffix(htmlStr, "\t\n")) {
    htmlStr = strings.TrimSuffix(htmlStr, "\t\n") + "\n";
  }
  while (strings.HasSuffix(htmlStr, "    \n")) {
    htmlStr = strings.TrimSuffix(htmlStr, "    \n") + "\n";
  }

  // Parse the string into a DOM tree
  const htmlRoot = util.ParseHTML(htmlStr);
  if (null === htmlRoot) {
    return ret;
  }
  normalizeProtyleInlineCodeCaret(htmlRoot);
  normalizeProtyleInlineCaretPlaceholders(htmlRoot);

  // Adjust the DOM structure
  lute.adjustVditorDOM(htmlRoot);

  // Convert the HTML tree into the Markdown AST
  ret = new parse.Tree();
  ret.Name = "";
  ret.Root = new ast.Node(ast.NodeDocument);
  ret.Context = new parse.Context(lute.ParseOptions);
  ret.Context.Tip = ret.Root;
  for (let c = htmlRoot.FirstChild; null !== c; c = c.NextSibling) {
    lute.genASTByBlockDOM(c, ret);
  }

  // Adjust the tree structure
  ast.Walk(ret.Root, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering) {
      switch (n.Type) {
        case ast.NodeInlineHTML:
        case ast.NodeHTMLBlock:
        case ast.NodeCodeSpanContent:
        case ast.NodeCodeBlockCode:
        case ast.NodeInlineMathContent:
        case ast.NodeMathBlockContent:
        case ast.NodeCodeSpan:
        case ast.NodeInlineMath:
          if (null !== n.Next && ast.NodeCodeSpan === n.Next.Type && n.CodeMarkerLen === n.Next.CodeMarkerLen && null !== n.FirstChild && null !== n.FirstChild.Next) {
            // Merge the code nodes https://github.com/Vanessa219/vditor/issues/167
            n.FirstChild.Next.AppendTokens(n.Next.FirstChild!.Next!.Tokens ?? emptyBytes);
            n.Next.Unlink();
          }
          break;
        case ast.NodeStrong:
        case ast.NodeEmphasis:
        case ast.NodeStrikethrough:
        case ast.NodeUnderline:
          lute.MergeSameSpan(n);
          break;
        case ast.NodeTextMark:
          lute.MergeSameTextMark(n);
          break;
        case ast.NodeText:
          n.Tokens = bytes.ReplaceAllOrNil(n.Tokens ?? emptyBytes, nbspBytes, spaceBytes);
          break;
      }
    }
    return ast.WalkContinue;
  });
  return ret;
};

Lute.prototype.MergeSameTextMark = function (this: Lute, n: ast.Node): void {
  if (null === n.Previous) {
    return;
  }

  let mergeWithIAL = false;
  let mergeWithZwsp = false;
  if (ast.NodeKramdownSpanIAL === n.Previous.Type) {
    if (null === n.Next || ast.NodeKramdownSpanIAL !== n.Next.Type || null === n.Previous.Previous) {
      return;
    }

    if (!bytes.Equal(n.Previous.Tokens ?? emptyBytes, n.Next.Tokens ?? emptyBytes)) {
      return;
    }

    if (!n.IsSameTextMarkType(n.Previous.Previous)) {
      return;
    }

    mergeWithIAL = true;
  } else {
    const previewText = n.Previous.TokensStr();
    if (ast.NodeText === n.Previous.Type &&
      !strings.Contains(previewText, "　") && !strings.Contains(previewText, " ") && !strings.Contains(previewText, "\n") && !strings.Contains(previewText, "\t") &&
      "" === strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(previewText, editor.Zwsp, ""), editor.Caret, "")) &&
      null !== n.Previous.Previous && n.IsSameTextMarkType(n.Previous.Previous)) {
      // If there is no caret (cursor position) between adjacent tags, do not merge them across ZWSP, keep two independent tags https://github.com/siyuan-note/siyuan/issues/18191
      if (!strings.Contains(n.TextMarkType, "tag") || strings.Contains(previewText, editor.Caret)) {
        mergeWithZwsp = true;
      }
    } else {
      if (n.Type !== n.Previous.Type || !n.IsSameTextMarkType(n.Previous)) {
        return;
      }
    }
  }

  const types = strings.Split(n.TextMarkType, " ");
  const m = new Map<string, boolean>();
  for (const t of types) {
    m.set(t, true);
  }
  const allowMerge: string[] = [];
  for (const k of m.keys()) {
    switch (k) {
      case "code":
      case "em":
      case "strong":
      case "s":
      case "mark":
      case "u":
      case "sub":
      case "sup":
      case "kbd":
      case "text":
      case "tag":
      case "block-ref":
      case "a":
      case "inline-memo":
        allowMerge.push(k);
        break;
    }
  }
  for (const k of allowMerge) {
    m.delete(k);
  }
  if (0 < m.size) {
    return;
  }

  if (mergeWithIAL || mergeWithZwsp) {
    const content = n.TextMarkTextContent;
    n.TextMarkTextContent = n.Previous.Previous!.TextMarkTextContent;
    if (strings.Contains(n.Previous.TokensStr(), editor.Caret)) {
      n.TextMarkTextContent += editor.Caret;
    }
    n.TextMarkTextContent += content;
    n.Previous.Previous!.Unlink();
  } else {
    n.TextMarkTextContent = n.Previous.TextMarkTextContent + n.TextMarkTextContent;
  }
  n.Previous!.Unlink();
  n.SortTextMarkDataTypes();
};

Lute.prototype.MergeSameSpan = function (this: Lute, n: ast.Node): void {
  if (null === n.Next || n.Type !== n.Next.Type) {
    return;
  }
  if (null !== n.Next.Next && ast.NodeKramdownSpanIAL === n.Next.Next.Type) {
    return;
  }

  const spanChildren: ast.Node[] = [];
  n.Next.FirstChild!.Unlink(); // open marker
  n.Next.LastChild!.Unlink(); // close marker
  for (let c = n.Next.FirstChild; null !== c; c = c.Next) {
    spanChildren.push(c);
  }
  for (const c of spanChildren) {
    n.LastChild!.InsertBefore(c);
  }
  n.Next.Unlink();
};

Lute.prototype.CancelSuperBlock = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  if (ast.NodeSuperBlock !== tree.Root!.FirstChild!.Type) {
    return ivHTML;
  }

  const sb = tree.Root!.FirstChild!;

  const blocks: ast.Node[] = [];
  for (let b = sb.FirstChild; null !== b; b = b.Next) {
    blocks.push(b);
  }
  for (const b of blocks) {
    tree.Root!.AppendChild(b);
  }
  sb.Unlink();

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.CancelList = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  if (ast.NodeList !== tree.Root!.FirstChild!.Type) {
    return ivHTML;
  }

  const list = tree.Root!.FirstChild!;

  const appends: ast.Node[] = [];
  const unlinks: ast.Node[] = [];
  for (let li = list.FirstChild; null !== li; li = li.Next) {
    for (let c = li.FirstChild; null !== c; c = c.Next) {
      if (ast.NodeTaskListItemMarker !== c.Type) {
        appends.push(c);
      }
    }
    unlinks.push(li);
  }
  for (const c of appends) {
    tree.Root!.AppendChild(c);
  }
  for (const n of unlinks) {
    n.Unlink();
  }
  list.Unlink();

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.CancelListRecursively = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const list = tree.Root!.FirstChild;
  if (null === list || ast.NodeList !== list.Type || null === list.ListData) {
    return ivHTML;
  }

  const sourceTyp = list.ListData.Typ;
  const lists: ast.Node[] = [];
  ast.Walk(list, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering && ast.NodeList === n.Type && null !== n.ListData && sourceTyp === n.ListData.Typ) {
      lists.push(n);
    }
    return ast.WalkContinue;
  });
  for (let i = lists.length - 1; 0 <= i; i--) {
    cancelList(lists[i]);
  }

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

function cancelList(list: ast.Node): void {
  const children: ast.Node[] = [];
  for (let li = list.FirstChild; null !== li; li = li.Next) {
    if (ast.NodeListItem !== li.Type) {
      continue;
    }
    for (let child = li.FirstChild; null !== child; child = child.Next) {
      if (ast.NodeTaskListItemMarker !== child.Type) {
        children.push(child);
      }
    }
  }
  for (const child of children) {
    list.InsertBefore(child);
  }
  list.Unlink();
}

Lute.prototype.CancelBlockquote = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  if (ast.NodeBlockquote !== tree.Root!.FirstChild!.Type) {
    return ivHTML;
  }

  const bq = tree.Root!.FirstChild!;

  const appends: ast.Node[] = [];
  const unlinks: ast.Node[] = [];
  for (let sub = bq.FirstChild; null !== sub; sub = sub.Next) {
    if (ast.NodeBlockquoteMarker !== sub.Type) {
      appends.push(sub);
    }
    unlinks.push(sub);
  }
  for (const c of appends) {
    tree.Root!.AppendChild(c);
  }
  bq.Unlink();

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.CancelCallout = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  if (ast.NodeCallout !== tree.Root!.FirstChild!.Type) {
    return ivHTML;
  }

  const co = tree.Root!.FirstChild!;
  const appends: ast.Node[] = [];
  const unlinks: ast.Node[] = [];

  const p = new ast.Node(ast.NodeParagraph);
  if (null !== co.KramdownIAL) {
    for (const kv of co.KramdownIAL) {
      p.SetIALAttr(kv[0], kv[1]);
    }
  }
  const text = new ast.Node(ast.NodeText);
  if ("" !== co.CalloutIcon) {
    if (0 === co.CalloutIconType) {
      text.Tokens = conv.BytesFromString(`${co.CalloutIcon} ${co.CalloutTitle}`);
    } else {
      const img = new ast.Node(ast.NodeImage);
      img.AppendChild(new ast.Node(ast.NodeBang));
      img.AppendChild(new ast.Node(ast.NodeOpenBracket));
      img.AppendChild(new ast.Node(ast.NodeCloseBracket));
      img.AppendChild(new ast.Node(ast.NodeOpenParen));
      img.AppendChild(new ast.Node(ast.NodeLinkDest, conv.BytesFromString(co.CalloutIcon)));
      img.AppendChild(new ast.Node(ast.NodeCloseParen));
      p.AppendChild(img);
      text.Tokens = conv.BytesFromString(co.CalloutTitle);
    }
  }
  p.AppendChild(text);
  appends.push(p);
  for (let sub = co.FirstChild; null !== sub; sub = sub.Next) {
    appends.push(sub);
    unlinks.push(sub);
  }
  for (const c of appends) {
    tree.Root!.AppendChild(c);
  }
  co.Unlink();

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.Blocks2Ps = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const node = tree.Root!.FirstChild;

  const appends: ast.Node[] = [];
  const unlinks: ast.Node[] = [];
  for (let n = node; null !== n; n = n.Next) {
    switch (n.Type) {
      case ast.NodeHeading:
        n.Type = ast.NodeParagraph;
        appends.push(n);
        unlinks.push(n);
        break;
      case ast.NodeBlockquote:
        for (let c = n.FirstChild; null !== c; c = c.Next) {
          if (ast.NodeBlockquoteMarker === c.Type) {
            unlinks.push(c);
            continue;
          }
          appends.push(c);
        }
        unlinks.push(n);
        break;
      case ast.NodeList:
        for (let li = n.FirstChild; null !== li; li = li.Next) {
          for (let c = li.FirstChild; null !== c; c = c.Next) {
            if (ast.NodeTaskListItemMarker !== c.Type) {
              appends.push(c);
            }
          }
          unlinks.push(li);
        }
        unlinks.push(n);
        break;
      default:
        appends.push(n);
        unlinks.push(n);
    }
  }
  for (const n of unlinks) {
    n.Unlink();
  }
  for (const c of appends) {
    tree.Root!.AppendChild(c);
  }
  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.Blocks2Hs = function (this: Lute, ivHTML: string, level: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const node = tree.Root!.FirstChild;

  for (let p = node; null !== p; p = p.Next) {
    if (ast.NodeParagraph === p.Type || ast.NodeHeading === p.Type) {
      p.Type = ast.NodeHeading;
      if (null !== p.FirstChild) {
        p.FirstChild.Tokens = bytes.ReplaceAllOrNil(p.FirstChild.Tokens ?? emptyBytes, conv.BytesFromString("\n"), emptyBytes);
        p.FirstChild.Tokens = slices.NilIfEmpty(bytes.TrimLeft(p.FirstChild.Tokens ?? emptyBytes, " \t\n"));
      }
      p.HeadingLevel = strconv.Atoi(level)[0];
    }
  }
  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.ConvertListType = function (this: Lute, ivHTML: string, targetType: string): string {
  const lute = this;
  let targetTyp = -1;
  switch (targetType) {
    case "u":
      targetTyp = 0;
      break;
    case "o":
      targetTyp = 1;
      break;
    case "t":
      targetTyp = 3;
      break;
    default:
      return ivHTML;
  }

  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const list = tree.Root!.FirstChild;
  if (null === list || ast.NodeList !== list.Type || null === list.ListData) {
    return ivHTML;
  }

  const lists: ast.Node[] = [];
  ast.Walk(list, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering && ast.NodeList === n.Type && null !== n.ListData && targetTyp !== n.ListData.Typ) {
      lists.push(n);
    }
    return ast.WalkContinue;
  });
  if (0 === lists.length) {
    return ivHTML;
  }
  for (const item of lists) {
    convertListType(item, targetTyp);
  }

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

function convertListType(list: ast.Node, targetTyp: number): void {
  list.ListData!.Typ = targetTyp;
  let num = 1;
  for (let li = list.FirstChild; null !== li; li = li.Next) {
    if (ast.NodeListItem !== li.Type) {
      continue;
    }
    if (null === li.ListData) {
      li.ListData = new ast.ListData();
    }
    li.ListData.Typ = targetTyp;
    if (1 === targetTyp) {
      li.ListData.Num = num;
      num++;
    }

    const taskMarker = li.ChildByType(ast.NodeTaskListItemMarker);
    if (3 === targetTyp) {
      if (null === taskMarker) {
        li.PrependChild(new ast.Node(ast.NodeTaskListItemMarker));
      }
    } else if (null !== taskMarker) {
      taskMarker.Unlink();
    }
  }
}

Lute.prototype.OL2TL = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;

  tree.Root!.FirstChild!.ListData!.Typ = 3;
  for (let li = tree.Root!.FirstChild!.FirstChild; null !== li; li = li.Next) {
    if (ast.NodeListItem === li.Type) {
      li.ListData!.Typ = 3;
      li.PrependChild(new ast.Node(ast.NodeTaskListItemMarker));
    }
  }
  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.UL2TL = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;

  tree.Root!.FirstChild!.ListData!.Typ = 3;
  for (let li = tree.Root!.FirstChild!.FirstChild; null !== li; li = li.Next) {
    if (ast.NodeListItem === li.Type) {
      li.ListData!.Typ = 3;
      li.PrependChild(new ast.Node(ast.NodeTaskListItemMarker));
    }
  }
  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.TL2OL = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const list = tree.Root!.FirstChild!;
  if (ast.NodeList !== list.Type || 3 !== list.ListData!.Typ) {
    return ivHTML;
  }

  let num = 1;
  list.ListData!.Typ = 1;
  const unlinks: ast.Node[] = [];
  for (let li = list.FirstChild; null !== li; li = li.Next) {
    if (ast.NodeKramdownBlockIAL === li.Type) {
      continue;
    }
    unlinks.push(li.FirstChild!); // task marker
    li.ListData!.Typ = 1;
    li.ListData!.Num = num;
    num++;
  }
  for (const n of unlinks) {
    n.Unlink();
  }

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.TL2UL = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const list = tree.Root!.FirstChild!;
  if (ast.NodeList !== list.Type || 3 !== list.ListData!.Typ) {
    return ivHTML;
  }

  list.ListData!.Typ = 0;
  const unlinks: ast.Node[] = [];
  for (let li = list.FirstChild; null !== li; li = li.Next) {
    if (ast.NodeKramdownBlockIAL === li.Type) {
      continue;
    }
    unlinks.push(li.FirstChild!); // task marker
    li.ListData!.Typ = 0;
  }
  for (const n of unlinks) {
    n.Unlink();
  }

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.OL2UL = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const list = tree.Root!.FirstChild!;
  if (ast.NodeList !== list.Type) {
    return ivHTML;
  }

  list.ListData!.Typ = 0;
  for (let li = list.FirstChild; null !== li; li = li.Next) {
    if (ast.NodeKramdownBlockIAL === li.Type) {
      continue;
    }
    li.ListData!.Typ = 0;
  }

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.UL2OL = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const list = tree.Root!.FirstChild!;
  if (ast.NodeList !== list.Type) {
    return ivHTML;
  }

  let num = 1;
  list.ListData!.Typ = 1;
  for (let li = list.FirstChild; null !== li; li = li.Next) {
    if (ast.NodeKramdownBlockIAL === li.Type) {
      continue;
    }
    li.ListData!.Typ = 1;
    li.ListData!.Num = num;
    num++;
  }

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.Callout2Blockquote = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const co = tree.Root!.FirstChild!;

  if (ast.NodeCallout !== co.Type) {
    return ivHTML;
  }

  let title = co.CalloutTitle;
  if (0 === co.CalloutIconType) {
    title = co.CalloutIcon + " " + title;
  }

  co.Type = ast.NodeBlockquote;
  const p = new ast.Node(ast.NodeParagraph);
  if (1 === co.CalloutIconType) {
    const emoji = new ast.Node(ast.NodeEmoji);
    // PORT-NOTE: byte offset: strings.Index is a UTF-16 index here and "/emojis/" is ASCII, so the slice start is consistent.
    const altStart = strings.Index(co.CalloutIcon, "/emojis/") + "/emojis/".length;
    // PORT-NOTE: Go panics when altStart exceeds the length, the oracle (GopherJS) does not; the port follows the oracle.
    const alt = co.CalloutIcon.slice(altStart);
    const emojiImg = new ast.Node(ast.NodeEmojiImg, tree.EmojiImgTokens(alt, co.CalloutIcon));
    emojiImg.AppendChild(new ast.Node(ast.NodeEmojiAlias, conv.BytesFromString(":" + alt + ":")));
    emoji.AppendChild(emojiImg);
    p.AppendChild(emoji);
  }

  title = strings.TrimSpace(title);
  if (1 === co.CalloutIconType) {
    title = " " + title;
  }
  const text = new ast.Node(ast.NodeText, conv.BytesFromString(title));
  p.AppendChild(text);
  co.PrependChild(p);
  co.PrependChild(new ast.Node(ast.NodeBlockquoteMarker));

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.Blockquote2Callout = function (this: Lute, ivHTML: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(ivHTML)!;
  const bq = tree.Root!.FirstChild!;

  if (ast.NodeBlockquote !== bq.Type) {
    return ivHTML;
  }

  const firstChild = bq.FirstChild!.Next;
  if (null === firstChild) {
    const id = ast.NewNodeID();
    const ialTokens = conv.BytesFromString("{: id=\"" + id + "\"}");
    const newP = new ast.Node(ast.NodeParagraph);
    newP.ID = id;
    newP.KramdownIAL = [["id", id], ["updated", id.slice(0, 14)]];
    newP.ID = id;
    bq.AppendChild(newP);
    bq.AppendChild(new ast.Node(ast.NodeKramdownBlockIAL, ialTokens));
  }

  let content: string = "";
  if (null !== firstChild && ast.NodeParagraph === firstChild.Type) {
    const text = firstChild.FirstChild;
    if (null === text) {
      firstChild.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString("")));
    }
    // UPSTREAM-BUG: when the paragraph has no child, a text node is appended but `text` stays nil and text.Text() is called on it (nil dereference).
    content = strings.TrimSpace(text!.Text());
    content = strings.TrimPrefix(content, editor.Caret);
  }

  let firstIsType = false;
  let typ = "NOTE";
  if (strings.HasPrefix(content, "[!") && strings.Contains(content, "]")) {
    typ = content.slice(2, strings.Index(content, "]"));
    firstIsType = true;
  }

  bq.FirstChild!.Unlink(); // marker >
  bq.Type = ast.NodeCallout;
  bq.CalloutType = typ;
  bq.CalloutTitle = ast.GetCalloutTitle(bq.CalloutType);
  bq.CalloutIcon = ast.GetCalloutIcon(bq.CalloutType);
  if (firstIsType) {
    if (null === firstChild!.Next!.Next) {
      const id = ast.NewNodeID();
      const ialTokens = conv.BytesFromString("{: id=\"" + id + "\"}");
      const newP = new ast.Node(ast.NodeParagraph);
      newP.ID = id;
      newP.KramdownIAL = [["id", id], ["updated", id.slice(0, 14)]];
      newP.ID = id;
      bq.AppendChild(newP);
      bq.AppendChild(new ast.Node(ast.NodeKramdownBlockIAL, ialTokens));
    }

    const title = strings.TrimSpace(content.slice(strings.Index(content, "]") + 1));
    bq.CalloutTitle = title;
    bq.FirstChild!.Unlink(); // the first paragraph [!TYPE]
    bq.FirstChild!.Unlink(); // the IAL of the first paragraph
  }

  const ovHTML = lute.Tree2BlockDOM(tree, lute.RenderOptions, lute.ParseOptions);
  return ovHTML;
};

Lute.prototype.blockDOM2Md = function (this: Lute, htmlStr: string): string {
  const lute = this;
  const tree = lute.BlockDOM2Tree(htmlStr)!;
  const markdown = lute.blockDOMTree2Md(tree);
  return markdown;
};

Lute.prototype.blockDOMTree2Md = function (this: Lute, tree: parse.Tree): string {
  const lute = this;
  wrapTabItemFragments(tree);

  // Render the AST as formatted Markdown
  const options = render.NewOptions();
  options.AutoSpace = false;
  options.FixTermTypo = false;
  options.KramdownBlockIAL = true;
  options.KramdownSpanIAL = true;
  options.KeepParagraphBeginningSpace = true;
  options.ProtyleWYSIWYG = true;
  options.SuperBlock = true;
  options.UnorderedListMarker = lute.RenderOptions.UnorderedListMarker;
  options.ExportNormalizeTaskListMarker = false;
  const renderer = render.NewFormatRenderer(tree, options, lute.ParseOptions);
  const formatted = renderer.Render();
  const markdown = conv.StringFromBytes(formatted);
  return markdown;
};

function normalizeProtyleInlineCodeCaret(n: html.Node): void {
  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    normalizeProtyleInlineCodeCaret(child);
  }
  // The backtick at the end of an inline element is moved out of the element, while the input in a heading container stays inside the heading.
  if (atom.Span !== n.DataAtom || hasDOMClass(n, "callout-title") || null === n.LastChild ||
    html.TextNode !== n.LastChild.Type || !strings.HasSuffix(n.LastChild.Data, "`" + editor.Caret)) {
    return;
  }
  n.LastChild.Data = strings.TrimSuffix(n.LastChild.Data, "`" + editor.Caret);
  n.InsertAfter(htmlTextNode("`" + editor.Caret));
}

function normalizeProtyleInlineCaretPlaceholders(n: html.Node): void {
  if (isProtyleInlineCaretContainer(n)) {
    trimProtyleInlineCaretPlaceholder(n);
  }

  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    normalizeProtyleInlineCaretPlaceholders(child);
  }
}

function isProtyleInlineCaretContainer(n: html.Node): boolean {
  if (atom.Code === n.DataAtom || atom.Kbd === n.DataAtom) {
    return true;
  }
  if (atom.Span !== n.DataAtom) {
    return false;
  }

  for (const typ of strings.Fields(util.DomAttrValue(n, "data-type"))) {
    if ("code" === typ || "kbd" === typ || "tag" === typ) {
      return true;
    }
  }
  return false;
}

function trimProtyleInlineCaretPlaceholder(n: html.Node): void {
  const firstChild = n.FirstChild;
  if (null === firstChild || html.TextNode !== firstChild.Type) {
    return;
  }
  for (const placeholder of [editor.Zwsp, "﻿", editor.WordJoiner]) {
    if (strings.HasPrefix(firstChild.Data, placeholder)) {
      firstChild.Data = strings.TrimPrefix(firstChild.Data, placeholder);
      break;
    }
  }
}

function removeBlockDOMZwsp(tree: parse.Tree): void {
  // Clean up the zero width spaces in the BlockDOM text before rendering, so that the actual word joiner right after an old placeholder is not removed by mistake.
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering) {
      n.Tokens = bytes.ReplaceAllOrNil(n.Tokens ?? emptyBytes, conv.BytesFromString(editor.Zwsp), emptyBytes);
      n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, editor.Zwsp, "");
    }
    return ast.WalkContinue;
  });
}

function normalizeSpinCaretNewline(tree: parse.Tree): void {
  // When the browser breaks a line at an existing soft line break, it puts the caret between the two line breaks, the actual paragraph position of the caret must be restored first
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering || ast.NodeParagraph !== n.Type) {
      return ast.WalkContinue;
    }

    for (let child = n.FirstChild; null !== child; child = child.Next) {
      if (ast.NodeText !== child.Type) {
        continue;
      }

      // PORT-NOTE: byte offset: Go's len(editor.Caret) is 3 (bytes), here every offset is a UTF-16 offset of the same string, so editor.Caret.length (1) is used throughout this function.
      let content = child.TokensStr();
      if (null === child.Previous && strings.HasPrefix(content, editor.Caret + "\n") &&
        spinHasContentAfter(child, content, editor.Caret.length + 1) &&
        !spinStartsTabsFence(content.slice(editor.Caret.length + 1))) {
        content = editor.Caret + content.slice(editor.Caret.length + 1);
      }

      for (let offset = 0; ;) {
        let index = strings.Index(content.slice(offset), "\n" + editor.Caret + "\n");
        if (0 > index) {
          break;
        }
        index += offset;
        const after = index + ("\n" + editor.Caret + "\n").length;
        if (spinHasContentAfter(child, content, after) && !spinStartsTabsFence(content.slice(after))) {
          content = content.slice(0, index) + "\n\n" + editor.Caret + content.slice(after);
          offset = index + ("\n\n" + editor.Caret).length;
        } else {
          offset = after;
        }
      }
      child.Tokens = conv.BytesFromString(content);
    }
    return ast.WalkSkipChildren;
  });
}

function spinStartsTabsFence(content: string): boolean {
  const index = strings.IndexByte(content, 0x0a /* \n */);
  if (0 <= index) {
    content = content.slice(0, index);
  }
  content = strings.TrimSpace(content);
  for (const marker of ["@tab", "@tab:active"]) {
    if (content === marker || strings.HasPrefix(content, marker + " ") || strings.HasPrefix(content, marker + "\t")) {
      return true;
    }
  }
  let count = 0;
  while (count < content.length && 0x3a /* : */ === content.charCodeAt(count)) {
    count++;
  }
  if (count < 3) {
    return false;
  }
  if (count === content.length) {
    return true;
  }
  return (0x20 /* space */ === content.charCodeAt(count) || 0x09 /* \t */ === content.charCodeAt(count)) && "tabs" === strings.TrimSpace(content.slice(count));
}

function spinHasContentAfter(node: ast.Node, content: string, offset: number): boolean {
  if (spinHasContent(content.slice(offset))) {
    return true;
  }
  for (let next = node.Next; null !== next; next = next.Next) {
    if (spinHasContent(next.Text())) {
      return true;
    }
  }
  return false;
}

function spinHasContent(content: string): boolean {
  content = strings.ReplaceAll(content, editor.Caret, "");
  content = strings.ReplaceAll(content, editor.Zwsp, "");
  return "" !== strings.TrimSpace(content);
}

Lute.prototype.genASTByBlockDOM = function (this: Lute, n: html.Node, tree: parse.Tree): void {
  const lute = this;
  const cls = util.DomAttrValue(n, "class");

  // Custom dom, which will be omitted when build tree https://github.com/88250/lute/issues/206
  if (strings.Contains(cls, "protyle-custom")) {
    return;
  }

  if ("protyle-attr" === cls || "callout-info" === cls || hasDOMClass(n, "tab-item-info") ||
    strings.Contains(cls, "__copy") ||
    strings.Contains(cls, "sb__resize") ||
    strings.Contains(cls, "protyle-linenumber__rows") ||
    strings.Contains(cls, "hljs")) {
    return;
  }

  if ("1" === util.DomAttrValue(n, "spin")) {
    return;
  }

  if (strings.Contains(cls, "protyle-action")) {
    if (ast.NodeCodeBlock === tree.Context!.Tip!.Type) {
      const languageNode = n.FirstChild!;
      let language = "";
      if (null !== languageNode.FirstChild) {
        language = languageNode.FirstChild.Data;
      }
      tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeCodeBlockFenceInfoMarker));
      tree.Context!.Tip!.LastChild!.CodeBlockInfo = util.StrToBytes(language);
      let code = util.DomText(n.NextSibling!.LastChild);
      if (strings.HasSuffix(code, "\n\n" + editor.Caret)) {
        code = strings.TrimSuffix(code, "\n\n" + editor.Caret);
        code += "\n" + editor.Caret + "\n";
      }
      const lines = strings.Split(code, "\n");
      const buf = new bytes.Buffer();
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (strings.Contains(line, "```")) {
          line = strings.ReplaceAll(line, editor.Zwj + "```", "```");
          line = strings.ReplaceAll(line, "```", editor.Zwj + "```");
        }
        buf.WriteString(line);
        if (i < lines.length - 1) {
          buf.WriteByte(0x0a /* \n */);
        }
      }
      tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeCodeBlockCode, buf.Bytes()));
    } else if (ast.NodeListItem === tree.Context!.Tip!.Type || ast.NodeMindmapItem === tree.Context!.Tip!.Type) {
      if (3 === tree.Context!.Tip!.ListData!.Typ) { // Task list
        const checked = strings.Contains(util.DomAttrValue(n.Parent, "class"), "protyle-task--done");
        const markerNode = new ast.Node(ast.NodeTaskListItemMarker);
        markerNode.ReviveFromDataTask(util.DomAttrValue(n.Parent, "data-task"), checked);
        tree.Context!.Tip!.AppendChild(markerNode);
      }
    }
    return;
  }

  if ("true" === util.DomAttrValue(n, "contenteditable")) {
    lute.genASTContenteditable(n, tree);
    return;
  }

  const dataType = ast.Str2NodeType(util.DomAttrValue(n, "data-type"));

  const nodeID = util.DomAttrValue(n, "data-node-id");
  const node = new ast.Node();
  node.ID = nodeID;
  // The deferred calls of Go: `defer tree.Context.TipAppendChild(ial)` is registered first and `defer tree.Context.ParentTip()` later, so the latter runs first.
  let ial: ast.Node | null = null;
  let deferParentTip = false;
  try {
    if ("" !== node.ID && !lute.parentIs(n, atom.Table)) {
      node.KramdownIAL = [["id", node.ID]];
      const ialTokens = lute.setBlockIAL(n, node);
      ial = new ast.Node(ast.NodeKramdownBlockIAL, ialTokens);
    }

    switch (dataType) {
      case ast.NodeTabs:
      case ast.NodeTabItem: {
        node.Type = dataType;
        if (ast.NodeTabItem === dataType) {
          const info = directDOMChildByClass(n, "tab-item-info");
          if (null !== info) {
            const title = directDOMChildByClass(info, "tab-item-title");
            if (null !== title) {
              node.TabItemTitle = lute.tabTitleMarkdown(title, false);
            }
          }
        }
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        if (ast.NodeTabItem === dataType) {
          const info = directDOMChildByClass(n, "tab-item-info");
          if (null !== info) {
            for (let child = info.FirstChild; null !== child; child = child.NextSibling) {
              if ("NodeParagraph" === util.DomAttrValue(child, "data-type") && "true" === util.DomAttrValue(child, "tabs-title")) {
                lute.genASTByBlockDOM(child, tree);
                break;
              }
            }
          }
        }
        break;
      }
      case ast.NodeBlockQueryEmbed: {
        node.Type = ast.NodeBlockQueryEmbed;
        node.AppendChild(new ast.Node(ast.NodeOpenBrace));
        node.AppendChild(new ast.Node(ast.NodeOpenBrace));
        let content = util.DomAttrValue(n, "data-content");
        // A SQL statement with line breaks in an embed block is converted to paragraph text https://github.com/siyuan-note/siyuan/issues/5728
        content = strings.ReplaceAll(content, "\n", editor.IALValEscNewLine);
        node.AppendChild(new ast.Node(ast.NodeBlockQueryEmbedScript, util.StrToBytes(content)));
        node.AppendChild(new ast.Node(ast.NodeCloseBrace));
        node.AppendChild(new ast.Node(ast.NodeCloseBrace));
        tree.Context!.Tip!.AppendChild(node);
        return;
      }
      case ast.NodeTable: {
        node.Type = ast.NodeTable;
        const tableAligns: number[] = [];
        if (null === n.FirstChild) {
          node.Type = ast.NodeParagraph;
          tree.Context!.Tip!.AppendChild(node);
          tree.Context!.Tip = node;
          tree.Context!.ParentTip();
          return;
        }

        if (lute.parentIs(n, atom.Table)) {
          const text = util.DomText(n);
          node.Tokens = conv.BytesFromString(strings.TrimSpace(text));
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        const tableDiv = n.FirstChild;
        let table = lute.domChild(tableDiv, atom.Table);
        if (null === table) {
          node.Type = ast.NodeParagraph;
          tree.Context!.Tip!.AppendChild(node);
          tree.Context!.Tip = node;
          tree.Context!.ParentTip();
          return;
        }

        const thead = lute.domChild(table, atom.Thead);
        if (null === thead || null === thead.FirstChild || null === thead.FirstChild.FirstChild) {
          node.Type = ast.NodeParagraph;
          tree.Context!.Tip!.AppendChild(node);
          tree.Context!.Tip = node;
          tree.Context!.ParentTip();
          return;
        }
        for (let th: html.Node | null = thead.FirstChild.FirstChild; null !== th; th = th.NextSibling) {
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
        node.TableAligns = tableAligns;
        const caption = util.DomAttrValue(n, "caption");
        table = lute.domChild(tableDiv, atom.Table);
        if ("" !== caption && null !== table && atom.Caption === table.FirstChild!.DataAtom) {
          node.SetIALAttr("caption", caption);
          table.FirstChild!.Unlink();
        }
        node.Tokens = null;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;

        lute.genASTContenteditable(table!, tree);
        ast.Walk(node, (n: ast.Node, entering: boolean): ast.WalkStatus => {
          if (entering && null !== n.TableCellRich) {
            node.SetIALAttr("custom-sy-table-rich", "1");
            return ast.WalkStop;
          }
          return ast.WalkContinue;
        });
        return;
      }
      case ast.NodeParagraph:
        node.Type = ast.NodeParagraph;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      case ast.NodeHeading: {
        const text = util.DomText(n);
        if (lute.parentIs(n, atom.Table)) {
          node.Tokens = conv.BytesFromString(strings.TrimSpace(text));
          while (bytes.HasPrefix(node.Tokens, conv.BytesFromString("#"))) {
            node.Tokens = bytes.TrimPrefix(node.Tokens, conv.BytesFromString("#"));
          }
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        const subtype = util.DomAttrValue(n, "data-subtype");
        // PORT-NOTE: Go panics on an empty subtype, the oracle (GopherJS) does not check string slice bounds; the port follows the oracle.
        let level = subtype.slice(1);
        let tmp = strings.TrimPrefix(text, " ");
        if (strings.HasPrefix(tmp, "#")) {
          // Allow changing headings with `#` https://github.com/siyuan-note/siyuan/issues/7924
          const idx = strings.Index(tmp, " " + editor.Caret);
          if (0 < idx) {
            tmp = tmp.slice(0, idx);
            if (null !== n.FirstChild && null !== n.FirstChild.FirstChild) {
              const headingContent = strings.TrimPrefix(strings.TrimPrefix(n.FirstChild.FirstChild.Data, tmp), " ");
              n.FirstChild.FirstChild.Data = headingContent;
            }
            level = strconv.Itoa(strings.Count(tmp, "#"));
          }
        }

        node.Type = ast.NodeHeading;
        node.HeadingLevel = strconv.Atoi(level)[0];
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case ast.NodeBlockquote: {
        const content = strings.TrimSpace(util.DomText(n));
        if (editor.Caret === content) {
          node.Type = ast.NodeText;
          node.Tokens = conv.BytesFromString(content);
          tree.Context!.Tip!.AppendChild(node);
        }

        // UPSTREAM-BUG: when the content is only the caret, `node` was already appended above as a text node and is appended again below as the blockquote.
        node.Type = ast.NodeBlockquote;
        node.AppendChild(new ast.Node(ast.NodeBlockquoteMarker, conv.BytesFromString(">")));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case ast.NodeList:
      case ast.NodeMindmap: {
        node.Type = dataType;
        const marker = util.DomAttrValue(n, "data-marker");
        node.ListData = new ast.ListData();
        const subType = util.DomAttrValue(n, "data-subtype");
        if ("u" === subType) {
          node.ListData.Typ = 0;
        } else if ("o" === subType) {
          node.ListData.Typ = 1;
        } else if ("t" === subType) {
          node.ListData.Typ = 3;
        }
        node.ListData.Marker = conv.BytesFromString(marker);
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case ast.NodeListItem:
      case ast.NodeMindmapItem: {
        const marker = util.DomAttrValue(n, "data-marker");
        let containerType = ast.NodeList;
        if (ast.NodeMindmapItem === dataType) {
          containerType = ast.NodeMindmap;
        }
        if (containerType !== tree.Context!.Tip!.Type) {
          const parent = new ast.Node();
          parent.Type = containerType;
          parent.ListData = new ast.ListData();
          const subType = util.DomAttrValue(n, "data-subtype");
          if ("u" === subType) {
            parent.ListData.Typ = 0;
            parent.ListData.BulletChar = 0x2a /* * */;
          } else if ("o" === subType) {
            parent.ListData.Typ = 1;
            parent.ListData.Num = strconv.Atoi(markerWithoutLastByte(marker))[0];
            parent.ListData.Delimiter = 0x2e /* . */;
          } else if ("t" === subType) {
            parent.ListData.Typ = 3;
            parent.ListData.BulletChar = 0x2a /* * */;
          }
          tree.Context!.Tip!.AppendChild(parent);
          tree.Context!.Tip = parent;
        }

        node.Type = dataType;
        node.ListData = new ast.ListData();
        const subType = util.DomAttrValue(n, "data-subtype");
        if ("u" === subType) {
          node.ListData.Typ = 0;
          node.ListData.BulletChar = 0x2a /* * */;
        } else if ("o" === subType) {
          node.ListData.Typ = 1;
          node.ListData.Num = strconv.Atoi(markerWithoutLastByte(marker))[0];
          node.ListData.Delimiter = 0x2e /* . */;
        } else if ("t" === subType) {
          node.ListData.Typ = 3;
          node.ListData.BulletChar = 0x2a /* * */;
        }
        node.ListData.Marker = conv.BytesFromString(marker);
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case ast.NodeGitConflict:
        node.Type = ast.NodeGitConflict;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      case ast.NodeSuperBlock: {
        node.Type = ast.NodeSuperBlock;
        tree.Context!.Tip!.AppendChild(node);
        node.AppendChild(new ast.Node(ast.NodeSuperBlockOpenMarker));
        const layout = util.DomAttrValue(n, "data-sb-layout");
        node.AppendChild(new ast.Node(ast.NodeSuperBlockLayoutMarker, conv.BytesFromString(layout)));
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case ast.NodeMathBlock: {
        node.Type = ast.NodeMathBlock;
        node.AppendChild(new ast.Node(ast.NodeMathBlockOpenMarker));
        const content = util.DomAttrValue(n, "data-content");
        node.AppendChild(new ast.Node(ast.NodeMathBlockContent, util.StrToBytes(content)));
        node.AppendChild(new ast.Node(ast.NodeMathBlockCloseMarker));
        tree.Context!.Tip!.AppendChild(node);
        return;
      }
      case ast.NodeCodeBlock: {
        node.Type = ast.NodeCodeBlock;
        node.IsFencedCodeBlock = true;
        node.AppendChild(new ast.Node(ast.NodeCodeBlockFenceOpenMarker, util.StrToBytes("```")));
        const language = util.DomAttrValue(n, "data-subtype");
        if ("" !== language) {
          const infoMarker = new ast.Node(ast.NodeCodeBlockFenceInfoMarker);
          infoMarker.CodeBlockInfo = util.StrToBytes(language);
          node.AppendChild(infoMarker);
          const content = util.DomAttrValue(n, "data-content");
          node.AppendChild(new ast.Node(ast.NodeCodeBlockCode, util.StrToBytes(content)));
          node.AppendChild(new ast.Node(ast.NodeCodeBlockFenceCloseMarker, util.StrToBytes("```")));
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case ast.NodeHTMLBlock: {
        node.Type = ast.NodeHTMLBlock;
        // DomAttrValue has already decoded the attributes in the HTML parser, keep the literal entities of the source.
        const content = util.DomAttrValue(n.FirstChild!.NextSibling!.FirstChild, "data-content");
        node.Tokens = util.StrToBytes(content);
        tree.Context!.Tip!.AppendChild(node);
        return;
      }
      case ast.NodeYamlFrontMatter:
        node.Type = ast.NodeYamlFrontMatter;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      case ast.NodeThematicBreak:
        node.Type = ast.NodeThematicBreak;
        tree.Context!.Tip!.AppendChild(node);
        return;
      case ast.NodeIFrame:
        node.Type = ast.NodeIFrame;
        n = lute.domChild(n.FirstChild, atom.Iframe)!;
        node.Tokens = util.DomHTML(n);
        tree.Context!.Tip!.AppendChild(node);
        return;
      case ast.NodeWidget:
        node.Type = ast.NodeWidget;
        n = lute.domChild(n.FirstChild, atom.Iframe)!;
        node.Tokens = util.DomHTML(n);
        tree.Context!.Tip!.AppendChild(node);
        return;
      case ast.NodeVideo:
        node.Type = ast.NodeVideo;
        n = lute.domChild(n.FirstChild, atom.Video)!;
        node.Tokens = util.DomHTML(n);
        tree.Context!.Tip!.AppendChild(node);
        return;
      case ast.NodeAudio:
        node.Type = ast.NodeAudio;
        n = lute.domChild(n.FirstChild, atom.Audio)!;
        node.Tokens = util.DomHTML(n);
        tree.Context!.Tip!.AppendChild(node);
        return;
      case ast.NodeAttributeView:
        node.Type = ast.NodeAttributeView;
        node.AttributeViewID = util.DomAttrValue(n, "data-av-id");
        if ("" === node.AttributeViewID) {
          node.AttributeViewID = ast.NewNodeID();
        }
        node.AttributeViewType = util.DomAttrValue(n, "data-av-type");
        tree.Context!.Tip!.AppendChild(node);
        return;
      case ast.NodeCustomBlock:
        node.Type = ast.NodeCustomBlock;
        node.CustomBlockInfo = util.DomAttrValue(n, "data-info");
        node.Tokens = conv.BytesFromString(util.DomAttrValue(n, "data-content"));
        tree.Context!.Tip!.AppendChild(node);
        return;
      case ast.NodeCallout: {
        node.Type = ast.NodeCallout;
        node.CalloutType = util.DomAttrValue(n, "data-subtype");
        const icon = util.DomChildByTypeAndClass(n, atom.Span, "callout-icon")!.FirstChild;
        if (null === icon) {
          node.CalloutIcon = ast.GetCalloutIcon(node.CalloutType);
        } else {
          if (atom.Img === icon.DataAtom) {
            node.CalloutIcon = util.DomAttrValue(icon, "src");
            node.CalloutIconType = 1;
          } else {
            node.CalloutIcon = util.DomText(icon);
          }
        }

        const titleDom = new bytes.Buffer();
        const first = util.DomChildByTypeAndClass(n, atom.Span, "callout-title")!.FirstChild;
        for (let c = first; null !== c; c = c.NextSibling) {
          titleDom.Write(util.DomHTML(c));
        }
        node.CalloutTitle = strings.TrimSpace(lute.BlockDOM2Md(titleDom.String()));
        node.CalloutTitleExplicit = true;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      default: {
        if ("callout-content" === cls || hasDOMClass(n, "tab-item-content")) {
          break;
        }

        switch (n.DataAtom) {
          case 0:
            node.Type = ast.NodeText;
            node.Tokens = util.StrToBytes(n.Data);
            if (ast.NodeDocument === tree.Context!.Tip!.Type) {
              const p = new ast.Node(ast.NodeParagraph);
              tree.Context!.Tip!.AppendChild(p);
              tree.Context!.Tip = p;
            }
            lute.genASTContenteditable(n, tree);
            return;
          case atom.U:
          case atom.Code:
          case atom.Strong:
          case atom.Em:
          case atom.Kbd:
          case atom.Mark:
          case atom.S:
          case atom.Sub:
          case atom.Sup:
          case atom.Span:
            if (ast.NodeDocument === tree.Context!.Tip!.Type) {
              const p = new ast.Node(ast.NodeParagraph);
              tree.Context!.Tip!.AppendChild(p);
              tree.Context!.Tip = p;
            }
            lute.genASTContenteditable(n, tree);
            return;
        }

        if (ast.NodeListItem === tree.Context!.Tip!.Type && atom.Input === n.DataAtom) {
          node.Type = ast.NodeTaskListItemMarker;
          node.ReviveFromDataTask(util.DomAttrValue(n, "data-task"), lute.hasAttr(n, "checked"));
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        node.Type = ast.NodeInlineHTML;
        node.Tokens = util.DomHTML(n);
        tree.Context!.Tip!.AppendChild(node);
        return;
      }
    }

    for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
      lute.genASTByBlockDOM(c, tree);
    }

    switch (dataType) {
      case ast.NodeSuperBlock:
        node.AppendChild(new ast.Node(ast.NodeSuperBlockCloseMarker));
        break;
      case ast.NodeCodeBlock:
        node.AppendChild(new ast.Node(ast.NodeCodeBlockFenceCloseMarker, util.StrToBytes("```")));
        break;
    }
  } finally {
    if (deferParentTip) {
      tree.Context!.ParentTip();
    }
    if (null !== ial) {
      tree.Context!.TipAppendChild(ial);
    }
  }
};

// markerWithoutLastByte is the port of `marker[:len(marker)-1]`.
function markerWithoutLastByte(marker: string): string {
  const b = conv.BytesFromString(marker);
  if (0 === b.length) {
    throw new Error("slice bounds out of range [:-1]"); // PORT-NOTE: Go panics here (the oracle throws too)
  }
  return conv.StringFromBytes(b.subarray(0, b.length - 1));
}

Lute.prototype.genASTContenteditable = function (this: Lute, n: html.Node, tree: parse.Tree): void {
  const lute = this;
  if (ast.NodeCodeBlock === tree.Context!.Tip!.Type || ast.NodeCustomBlock === tree.Context!.Tip!.Type) {
    return;
  }

  if (atom.Colgroup === n.DataAtom) {
    return;
  }

  const cls = util.DomAttrValue(n, "class");
  if ("svg" === cls) {
    return;
  }

  let deferParentTip = false;
  try {
    let content = n.Data;
    const node = new ast.Node(ast.NodeText, util.StrToBytes(content));
    switch (n.DataAtom) {
      case 0: {
        if ("" === content) {
          return;
        }

        if (html.ElementNode === n.Type) {
          node.Tokens = util.StrToBytes("<" + content + ">");
        }

        if (ast.NodeLink === tree.Context!.Tip!.Type) {
          node.Type = ast.NodeLinkText;
        } else if (ast.NodeHeading === tree.Context!.Tip!.Type) {
          content = strings.ReplaceAll(content, "\n", "");
          node.Tokens = util.StrToBytes(content);
        } else if (ast.NodeStrong === tree.Context!.Tip!.Type) {
          content = strings.ReplaceAll(content, "**", "");
          content = strings.ReplaceAll(content, "*" + editor.Caret, editor.Caret);
          content = strings.ReplaceAll(content, editor.Caret + "*", editor.Caret);
          node.Tokens = util.StrToBytes(content);
        }

        if (lute.parentIs(n, atom.Table)) {
          content = strings.TrimSuffix(content, "\n");
          if ((null === n.NextSibling && !strings.Contains(content, "\n")) /* After pasting external content into a table, editing loses the line break  https://github.com/siyuan-note/siyuan/issues/7501 */ ||
            (null !== n.NextSibling && atom.Br === n.NextSibling.DataAtom && strings.HasPrefix(content, "\n")) /* Editing produces a line break when an inline formula exists in the table https://github.com/siyuan-note/siyuan/issues/2279 */) {
            content = strings.ReplaceAll(content, "\n", "");
          }

          if (strings.Contains(content, "\\")) {
            // After entering `\` in the table, the next column is merged incorrectly https://github.com/siyuan-note/siyuan/issues/7817
            let tmp = strings.ReplaceAll(content, "\\", "");
            tmp = strings.TrimSpace(tmp);
            if ("" === tmp) {
              // Only escape characters, escape the backslash itself
              content = strings.ReplaceAll(content, "\\", "\\\\");
            }
          }

          node.Tokens = util.StrToBytes(strings.ReplaceAll(content, "\n", "<br />"));
          const array = lex.SplitWithoutBackslashEscape(node.Tokens, 0x7c /* | */);
          node.Tokens = null;
          for (let i = 0; i < array.length; i++) {
            node.AppendTokens(array[i]);
            if (i < array.length - 1) {
              node.AppendTokens(conv.BytesFromString("\\|"));
            }
          }
        }
        if (ast.NodeCodeSpan === tree.Context!.Tip!.Type || ast.NodeInlineMath === tree.Context!.Tip!.Type) {
          if (null !== tree.Context!.Tip!.Previous && tree.Context!.Tip!.Type === tree.Context!.Tip!.Previous.Type) { // Merge adjacent code
            tree.Context!.Tip!.FirstChild!.Next!.Tokens = util.StrToBytes(content);
          } else { // Stack code
            if (null !== tree.Context!.Tip!.FirstChild!.Next!.Next && ast.NodeBackslash === tree.Context!.Tip!.FirstChild!.Next!.Next!.Type) {
              // The problem of using code and `|` in a table cell https://github.com/siyuan-note/siyuan/issues/4717
              content = util.BytesToStr(tree.Context!.Tip!.FirstChild!.Next!.Next!.FirstChild!.Tokens ?? emptyBytes) + content;
              tree.Context!.Tip!.FirstChild!.Next!.Next!.Unlink();
            }
            tree.Context!.Tip!.FirstChild!.Next!.AppendTokens(util.StrToBytes(content));
          }
          return;
        }
        if (ast.NodeTextMark === tree.Context!.Tip!.Type) {
          if ("code" === tree.Context!.Tip!.TokensStr()) {
            if (null !== tree.Context!.Tip!.FirstChild && null !== tree.Context!.Tip!.FirstChild.Next && null !== tree.Context!.Tip!.FirstChild.Next.Next && ast.NodeBackslash === tree.Context!.Tip!.FirstChild.Next.Next.Type) {
              // The problem of using code and `|` in a table cell https://github.com/siyuan-note/siyuan/issues/4717
              content = util.BytesToStr(tree.Context!.Tip!.FirstChild.Next.Next.FirstChild!.Tokens ?? emptyBytes) + content;
              tree.Context!.Tip!.FirstChild.Next.Next.Unlink();
              tree.Context!.Tip!.FirstChild.Next.AppendTokens(util.StrToBytes(content));
              return;
            }
          }
        }

        if (ast.NodeKbd === tree.Context!.Tip!.Type) {
          // The problem of backslash escaping in `<kbd>` https://github.com/siyuan-note/siyuan/issues/2242
          node.Tokens = bytes.ReplaceAllOrNil(node.Tokens ?? emptyBytes, conv.BytesFromString("\\\\"), conv.BytesFromString("\\"));
          node.Tokens = bytes.ReplaceAllOrNil(node.Tokens ?? emptyBytes, conv.BytesFromString("\\"), conv.BytesFromString("\\\\"));

          if (bytes.Equal(node.Tokens ?? emptyBytes, editor.CaretTokens)) {
            // `<kbd>` cannot be deleted https://github.com/siyuan-note/siyuan/issues/4162
            const parent = tree.Context!.Tip!.Parent;
            tree.Context!.Tip!.Unlink();
            tree.Context!.Tip = parent;
          }
        }
        tree.Context!.Tip!.AppendChild(node);
        break;
      }
      case atom.Thead: {
        if (lute.parentIs(n.Parent!.Parent!, atom.Table)) {
          let text = util.DomText(n.Parent!.Parent);
          text = strings.ReplaceAll(text, editor.Caret, "");
          node.Tokens = conv.BytesFromString(strings.TrimSpace(text));
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        node.Type = ast.NodeTableHead;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Tbody:
        break;
      case atom.Tr:
        node.Type = ast.NodeTableRow;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      case atom.Th:
      case atom.Td:
        node.Type = ast.NodeTableCell;
        node.TableCellAlign = parse.TableCellAlignValue(util.DomAttrValue(n, "align"), util.DomAttrValue(n, "style"));
        tree.Context!.Tip!.AppendChild(node);
        parse.SetSpanIAL(node, n);
        tree.Context!.Tip = node;
        deferParentTip = true;
        for (const attr of n.Attr) {
          if (ast.TableCellRichAttribute === attr.Key) {
            node.TableCellRich = ast.DecodeTableCellRich(attr.Val);
            parse.ApplyTableCellRichProjection(node);
            return;
          }
        }
        break;
      case atom.Code: {
        const [isCaret, isEmpty] = lute.isCaret(n);
        if (isCaret) {
          node.Type = ast.NodeText;
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (isEmpty) {
          return;
        }

        if (lute.ParseOptions.TextMark) {
          tree.Context!.Tip!.AppendChild(node);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }

        node.Type = ast.NodeCodeSpan;
        node.AppendChild(new ast.Node(ast.NodeCodeSpanOpenMarker));
        node.AppendChild(new ast.Node(ast.NodeCodeSpanContent));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Span: {
        let dataType = util.DomAttrValue(n, "data-type");
        if ("" === dataType) {
          dataType = "text";
        }
        if (strings.Contains(dataType, "span")) {
          // In some cases the copied DOM is like this, parse it as plain text here
          node.Type = ast.NodeText;
          node.Tokens = util.StrToBytes(util.DomText(n));
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        if (strings.Contains(dataType, "img")) {
          // After setting the font format for text and image at the same time the image is lost https://github.com/siyuan-note/siyuan/issues/6297
          dataType = "img";
        }

        if (null !== tree.Context!.Tip && null !== tree.Context!.Tip.LastChild) {
          // Typing the escape character `\` before an inline element leads to an exception https://github.com/siyuan-note/siyuan/issues/6237
          let previousEndText = tree.Context!.Tip.LastChild.Text();
          const backslashCaret = strings.HasSuffix(previousEndText, "\\" + editor.Caret);
          if (backslashCaret) {
            previousEndText = strings.TrimSuffix(previousEndText, editor.Caret);
          }
          if (strings.HasSuffix(previousEndText, "\\")) {
            let backslashCount = 0;
            for (let i = previousEndText.length - 1; i >= 0; i--) {
              if (0x5c /* \ */ === previousEndText.charCodeAt(i)) {
                backslashCount++;
              } else {
                break;
              }
            }
            if (0 !== backslashCount % 2) {
              if (backslashCaret) {
                tree.Context!.Tip.LastChild.Tokens = slices.KeepNil(tree.Context!.Tip.LastChild.Tokens, (b) => bytes.TrimSuffix(b, conv.BytesFromString(editor.Caret)));
                tree.Context!.Tip.LastChild.AppendTokens(conv.BytesFromString("\\"));
                tree.Context!.Tip.LastChild.AppendTokens(conv.BytesFromString(editor.Caret));
              } else {
                tree.Context!.Tip.LastChild.AppendTokens(conv.BytesFromString("\\"));
              }
            }
          }
        }

        if ("tag" === dataType) {
          const [isCaret, isEmpty] = lute.isCaret(n);
          if (isCaret) {
            node.Type = ast.NodeText;
            node.Tokens = editor.CaretTokens;
            tree.Context!.Tip!.AppendChild(node);
            return;
          }
          if (isEmpty) {
            return;
          }

          if (lute.ParseOptions.TextMark) {
            tree.Context!.Tip!.AppendChild(node);
            parse.SetTextMarkNode(node, n, lute.ParseOptions);
            return;
          }

          n.FirstChild!.Data = strings.ReplaceAll(n.FirstChild!.Data, editor.Zwsp, "");
          node.Type = ast.NodeTag;
          node.AppendChild(new ast.Node(ast.NodeTagOpenMarker));
          // Spaces at the start or end form * foo *, which invalidates the emphasis, strong and strikethrough markers, so the spaces are moved around the closing marker _*foo*_
          processSpanMarkerSpace(n, node);
          tree.Context!.Tip!.AppendChild(node);
          tree.Context!.Tip = node;
          deferParentTip = true;
        } else if ("inline-math" === dataType) {
          const inlineMathContent = util.GetTextMarkInlineMathData(n);
          if ("" === inlineMathContent) {
            return;
          }

          if (lute.ParseOptions.TextMark) {
            tree.Context!.Tip!.AppendChild(node);
            parse.SetTextMarkNode(node, n, lute.ParseOptions);
            return;
          }

          node.Type = ast.NodeInlineMath;
          node.AppendChild(new ast.Node(ast.NodeInlineMathOpenMarker));
          node.AppendChild(new ast.Node(ast.NodeInlineMathContent, util.StrToBytes(inlineMathContent)));
          node.AppendChild(new ast.Node(ast.NodeInlineMathCloseMarker));
          tree.Context!.Tip!.AppendChild(node);
          return;
        } else if ("inline-memo" === dataType) {
          const [isCaret, isEmpty] = lute.isCaret(n);
          if (isCaret) {
            node.Type = ast.NodeText;
            node.Tokens = editor.CaretTokens;
            tree.Context!.Tip!.AppendChild(node);
            return;
          }
          if (isEmpty) {
            return;
          }

          if (lute.ParseOptions.TextMark) {
            tree.Context!.Tip!.AppendChild(node);
            parse.SetTextMarkNode(node, n, lute.ParseOptions);
            return;
          }

          node.Type = ast.NodeText;
          node.Tokens = util.StrToBytes(util.DomText(n));
          tree.Context!.Tip!.AppendChild(node);
          return;
        } else if ("a" === dataType) {
          if (null === n.FirstChild) {
            // Discard links without anchor text
            return;
          }

          if (ast.NodeLink === tree.Context!.Tip!.Type) {
            break;
          }

          const [isCaret, isEmpty] = lute.isCaret(n);
          if (isCaret) {
            node.Type = ast.NodeText;
            node.Tokens = editor.CaretTokens;
            tree.Context!.Tip!.AppendChild(node);
            return;
          }
          if (isEmpty) {
            return;
          }

          if (lute.ParseOptions.TextMark) {
            tree.Context!.Tip!.AppendChild(node);
            parse.SetTextMarkNode(node, n, lute.ParseOptions);
            return;
          }

          node.Type = ast.NodeLink;
          node.AppendChild(new ast.Node(ast.NodeOpenBracket));
          tree.Context!.Tip!.AppendChild(node);
          tree.Context!.Tip = node;
          deferParentTip = true;
        } else if ("block-ref" === dataType) {
          let refText = util.DomText(n);
          refText = strings.TrimSpace(refText);
          if ("" === refText) {
            return;
          }
          if (refText === editor.Caret) {
            tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
            return;
          }

          if (lute.ParseOptions.TextMark) {
            tree.Context!.Tip!.AppendChild(node);
            parse.SetTextMarkNode(node, n, lute.ParseOptions);
            return;
          }

          node.Type = ast.NodeBlockRef;
          node.AppendChild(new ast.Node(ast.NodeOpenParen));
          node.AppendChild(new ast.Node(ast.NodeOpenParen));
          const id = util.DomAttrValue(n, "data-id");
          node.AppendChild(new ast.Node(ast.NodeBlockRefID, util.StrToBytes(id)));

          node.AppendChild(new ast.Node(ast.NodeBlockRefSpace));
          let refTextNode: ast.Node;
          const subtype = util.DomAttrValue(n, "data-subtype");
          if ("s" === subtype || "" === subtype) {
            refTextNode = new ast.Node(ast.NodeBlockRefText, util.StrToBytes(refText));
          } else {
            refTextNode = new ast.Node(ast.NodeBlockRefDynamicText, util.StrToBytes(refText));
          }
          if (lute.parentIs(n, atom.Table)) {
            refTextNode.Tokens = bytes.ReplaceAllOrNil(refTextNode.Tokens ?? emptyBytes, conv.BytesFromString("|"), conv.BytesFromString("&#124;"));
          }
          node.AppendChild(refTextNode);
          node.AppendChild(new ast.Node(ast.NodeCloseParen));
          node.AppendChild(new ast.Node(ast.NodeCloseParen));
          tree.Context!.Tip!.AppendChild(node);
          return;
        } else if ("file-annotation-ref" === dataType) {
          let refText = util.DomText(n);
          refText = strings.TrimSpace(refText);
          if ("" === refText) {
            return;
          }
          if (refText === editor.Caret) {
            tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
            return;
          }

          if (lute.ParseOptions.TextMark) {
            tree.Context!.Tip!.AppendChild(node);
            parse.SetTextMarkNode(node, n, lute.ParseOptions);
            return;
          }

          node.Type = ast.NodeFileAnnotationRef;
          node.AppendChild(new ast.Node(ast.NodeLess));
          node.AppendChild(new ast.Node(ast.NodeLess));
          const id = util.DomAttrValue(n, "data-id");
          node.AppendChild(new ast.Node(ast.NodeFileAnnotationRefID, util.StrToBytes(id)));
          node.AppendChild(new ast.Node(ast.NodeFileAnnotationRefSpace));
          const refTextNode = new ast.Node(ast.NodeFileAnnotationRefText, util.StrToBytes(refText));
          node.AppendChild(refTextNode);
          node.AppendChild(new ast.Node(ast.NodeGreater));
          node.AppendChild(new ast.Node(ast.NodeGreater));
          tree.Context!.Tip!.AppendChild(node);
          return;
        } else if ("img" === dataType) {
          const img = lute.domChild(n, atom.Img); //n.FirstChild.NextSibling.FirstChild.NextSibling
          if (null === img) {
            return;
          }

          node.Type = ast.NodeImage;
          node.AppendChild(new ast.Node(ast.NodeBang));
          node.AppendChild(new ast.Node(ast.NodeOpenBracket));
          let alt = util.DomAttrValue(img, "alt");
          alt = strings.ReplaceAll(alt, editor.Caret, "");
          node.AppendChild(new ast.Node(ast.NodeLinkText, util.StrToBytes(alt)));
          node.AppendChild(new ast.Node(ast.NodeCloseBracket));
          node.AppendChild(new ast.Node(ast.NodeOpenParen));
          const src = strings.TrimSpace(util.DomAttrValue(img, "data-src"));
          node.AppendChild(new ast.Node(ast.NodeLinkDest, util.StrToBytes(src)));
          let title = util.DomAttrValue(img, "title");
          // The editor keeps the title in a data attribute, to avoid triggering the native browser tooltip at the same time.
          for (const attr of img.Attr) {
            if ("data-title" === attr.Key) {
              title = attr.Val;
              break;
            }
          }
          if ("" !== title) {
            node.AppendChild(new ast.Node(ast.NodeLinkSpace));
            // < and > are not escaped, which conforms to the Markdown specification https://github.com/siyuan-note/siyuan/issues/15023
            title = strings.ReplaceAll(title, "\"", "&quot;");
            title = strings.ReplaceAll(title, "&lt;", "<");
            title = strings.ReplaceAll(title, "&gt;", ">");
            node.AppendChild(new ast.Node(ast.NodeLinkTitle, util.StrToBytes(title)));
          }
          node.AppendChild(new ast.Node(ast.NodeCloseParen));
          tree.Context!.Tip!.AppendChild(node);
          parse.SetSpanIAL(tree.Context!.Tip!.LastChild, img);
          return;
        } else if ("backslash" === dataType) {
          node.Type = ast.NodeBackslash;
          if (null === n.FirstChild) {
            return;
          }
          if (n.FirstChild === n.LastChild && null !== n.FirstChild.FirstChild) {
            // After adding an inline style to the escape character, continuing to type shows the marker https://github.com/siyuan-note/siyuan/issues/6134
            return;
          }
          if (null === n.FirstChild.NextSibling && html.TextNode === n.FirstChild.Type) {
            node.AppendChild(new ast.Node(ast.NodeText, util.StrToBytes(n.FirstChild.Data)));
            tree.Context!.Tip!.AppendChild(node);
            return;
          }
          if (null !== n.FirstChild.NextSibling) {
            let data = n.FirstChild.NextSibling.Data;
            data = strings.ReplaceAll(data, "\\\\", "\\");
            node.AppendChild(new ast.Node(ast.NodeBackslashContent, util.StrToBytes(data)));
          }
          tree.Context!.Tip!.AppendChild(node);
          return;
        } else {
          // TextMark node
          const [isCaret, isEmpty] = lute.isCaret(n);
          if (isCaret) {
            node.Type = ast.NodeText;
            node.Tokens = editor.CaretTokens;
            tree.Context!.Tip!.AppendChild(node);
            return;
          }
          if (isEmpty) {
            return;
          }

          dataType = lute.removeTempMark(dataType);
          let tmpDataType = strings.ReplaceAll(dataType, "backslash", "");
          tmpDataType = strings.TrimSpace(tmpDataType);
          tree.Context!.Tip!.AppendChild(node);
          if ("" === tmpDataType) {
            node.Type = ast.NodeText;
            node.Tokens = conv.BytesFromString(util.DomText(n));
            return;
          }
          lute.setDOMAttrValue(n, "data-type", dataType);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }
        break;
      }
      case atom.Sub: {
        const [isCaret, isEmpty] = lute.isCaret(n);
        if (isCaret) {
          node.Type = ast.NodeText;
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (isEmpty) {
          return;
        }

        if (lute.ParseOptions.TextMark) {
          tree.Context!.Tip!.AppendChild(node);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }

        node.Type = ast.NodeSub;
        node.AppendChild(new ast.Node(ast.NodeSubOpenMarker));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Sup: {
        const [isCaret, isEmpty] = lute.isCaret(n);
        if (isCaret) {
          node.Type = ast.NodeText;
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (isEmpty) {
          return;
        }

        if (lute.ParseOptions.TextMark) {
          tree.Context!.Tip!.AppendChild(node);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }

        node.Type = ast.NodeSup;
        node.AppendChild(new ast.Node(ast.NodeSupOpenMarker));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.U: {
        const [isCaret, isEmpty] = lute.isCaret(n);
        if (isCaret) {
          node.Type = ast.NodeText;
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (isEmpty) {
          return;
        }

        if (lute.ParseOptions.TextMark) {
          tree.Context!.Tip!.AppendChild(node);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }

        node.Type = ast.NodeUnderline;
        node.AppendChild(new ast.Node(ast.NodeUnderlineOpenMarker));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Kbd: {
        const [isCaret, isEmpty] = lute.isCaret(n);
        if (isCaret) {
          node.Type = ast.NodeText;
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (isEmpty) {
          return;
        }

        if (lute.ParseOptions.TextMark) {
          tree.Context!.Tip!.AppendChild(node);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }

        node.Type = ast.NodeKbd;
        node.AppendChild(new ast.Node(ast.NodeKbdOpenMarker));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Br:
        if (ast.NodeHeading === tree.Context!.Tip!.Type) {
          return;
        }
        if (null !== n.PrevSibling && "\n" === n.PrevSibling.Data && lute.parentIs(n, atom.Table)) {
          return;
        }
        if (ast.NodeParagraph === tree.Context!.Tip!.Type) {
          // Convert hard line breaks to soft line breaks https://github.com/siyuan-note/siyuan/issues/14481
          node.Type = ast.NodeText;
          node.Tokens = conv.BytesFromString("\n");
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        node.Type = ast.NodeBr;
        tree.Context!.Tip!.AppendChild(node);
        return;
      case atom.Em:
      case atom.I: {
        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp + "\n")));
        }
        const [isCaret, isEmpty] = lute.isCaret(n);
        if (isCaret) {
          node.Type = ast.NodeText;
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (isEmpty) {
          return;
        }

        if (lute.ParseOptions.TextMark) {
          tree.Context!.Tip!.AppendChild(node);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }

        node.Type = ast.NodeEmphasis;
        let marker = util.DomAttrValue(n, "data-marker");
        if ("" === marker) {
          marker = "*";
        }
        if ("_" === marker) {
          node.AppendChild(new ast.Node(ast.NodeEmU8eOpenMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeEmA6kOpenMarker, conv.BytesFromString(marker)));
        }
        tree.Context!.Tip!.AppendChild(node);

        if (null !== n.FirstChild && editor.Caret === n.FirstChild.Data && null !== n.LastChild && "br" === n.LastChild.Data) {
          // Handle the line break at the end
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          if ("_" === marker) {
            node.AppendChild(new ast.Node(ast.NodeEmU8eCloseMarker, conv.BytesFromString(marker)));
          } else {
            node.AppendChild(new ast.Node(ast.NodeEmA6kCloseMarker, conv.BytesFromString(marker)));
          }
          return;
        }

        n.FirstChild.Data = strings.ReplaceAll(n.FirstChild.Data, editor.Zwsp, "");

        // Spaces at the start or end form * foo *, which invalidates the emphasis, strong and strikethrough markers, so the spaces are moved around the closing marker _*foo*_
        processSpanMarkerSpace(n, node);
        lute.removeInnerMarker(n, "__");
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Strong:
      case atom.B: {
        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (null !== tree.Context!.Tip!.LastChild) {
          // The style attributes of the inline element are exposed because of the escape character https://github.com/siyuan-note/siyuan/issues/2969
          if (bytes.HasSuffix(tree.Context!.Tip!.LastChild.Tokens ?? emptyBytes, conv.BytesFromString("\\" + editor.Caret))) {
            // foo\‸**bar**
            tree.Context!.Tip!.LastChild.Tokens = bytes.ReplaceAllOrNil(tree.Context!.Tip!.LastChild.Tokens ?? emptyBytes, conv.BytesFromString("\\" + editor.Caret), conv.BytesFromString("\\\\" + editor.Caret));
          }
          if (bytes.HasSuffix(tree.Context!.Tip!.LastChild.Tokens ?? emptyBytes, conv.BytesFromString("\\"))) {
            // foo\**bar**
            tree.Context!.Tip!.LastChild.Tokens = bytes.ReplaceAllOrNil(tree.Context!.Tip!.LastChild.Tokens ?? emptyBytes, conv.BytesFromString("\\"), conv.BytesFromString("\\\\"));
          }
        }

        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp + "\n")));
        }
        const [isCaret, isEmpty] = lute.isCaret(n);
        if (isCaret) {
          node.Type = ast.NodeText;
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (isEmpty) {
          return;
        }

        if (lute.ParseOptions.TextMark) {
          tree.Context!.Tip!.AppendChild(node);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }

        node.Type = ast.NodeStrong;
        let marker = util.DomAttrValue(n, "data-marker");
        if ("" === marker) {
          marker = "**";
        }
        if ("__" === marker) {
          node.AppendChild(new ast.Node(ast.NodeStrongU8eOpenMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeStrongA6kOpenMarker, conv.BytesFromString(marker)));
        }
        tree.Context!.Tip!.AppendChild(node);

        if (null !== n.FirstChild && editor.Caret === n.FirstChild.Data && null !== n.LastChild && "br" === n.LastChild.Data) {
          // Handle the line break at the end
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          if ("__" === marker) {
            node.AppendChild(new ast.Node(ast.NodeStrongU8eCloseMarker, conv.BytesFromString(marker)));
          } else {
            node.AppendChild(new ast.Node(ast.NodeStrongA6kCloseMarker, conv.BytesFromString(marker)));
          }
          return;
        }

        processSpanMarkerSpace(n, node);
        lute.removeInnerMarker(n, "**");
        parse.SetSpanIAL(node, n);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Del:
      case atom.S:
      case atom.Strike: {
        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp + "\n")));
        }
        const [isCaret, isEmpty] = lute.isCaret(n);
        if (isCaret) {
          node.Type = ast.NodeText;
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (isEmpty) {
          return;
        }

        if (lute.ParseOptions.TextMark) {
          tree.Context!.Tip!.AppendChild(node);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }

        node.Type = ast.NodeStrikethrough;
        const marker = util.DomAttrValue(n, "data-marker");
        if ("~" === marker) {
          node.AppendChild(new ast.Node(ast.NodeStrikethrough1OpenMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeStrikethrough2OpenMarker, conv.BytesFromString(marker)));
        }
        tree.Context!.Tip!.AppendChild(node);

        if (null !== n.FirstChild && editor.Caret === n.FirstChild.Data && null !== n.LastChild && "br" === n.LastChild.Data) {
          // Handle the line break at the end
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          if ("~" === marker) {
            node.AppendChild(new ast.Node(ast.NodeStrikethrough1CloseMarker, conv.BytesFromString(marker)));
          } else {
            node.AppendChild(new ast.Node(ast.NodeStrikethrough2CloseMarker, conv.BytesFromString(marker)));
          }
          return;
        }

        processSpanMarkerSpace(n, node);
        lute.removeInnerMarker(n, "~~");
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Mark: {
        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp + "\n")));
        }
        const [isCaret, isEmpty] = lute.isCaret(n);
        if (isCaret) {
          node.Type = ast.NodeText;
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (isEmpty) {
          return;
        }

        if (lute.ParseOptions.TextMark) {
          tree.Context!.Tip!.AppendChild(node);
          parse.SetTextMarkNode(node, n, lute.ParseOptions);
          return;
        }

        node.Type = ast.NodeMark;
        const marker = util.DomAttrValue(n, "data-marker");
        if ("=" === marker) {
          node.AppendChild(new ast.Node(ast.NodeMark1OpenMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeMark2OpenMarker, conv.BytesFromString(marker)));
        }
        tree.Context!.Tip!.AppendChild(node);

        if (null !== n.FirstChild && editor.Caret === n.FirstChild.Data && null !== n.LastChild && "br" === n.LastChild.Data) {
          // Handle the line break at the end
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          if ("=" === marker) {
            node.AppendChild(new ast.Node(ast.NodeMark1CloseMarker, conv.BytesFromString(marker)));
          } else {
            node.AppendChild(new ast.Node(ast.NodeMark2CloseMarker, conv.BytesFromString(marker)));
          }
          return;
        }

        processSpanMarkerSpace(n, node);
        lute.removeInnerMarker(n, "==");
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Img:
        if ("emoji" === cls) {
          const alt = util.DomAttrValue(n, "alt");
          node.Type = ast.NodeEmoji;
          const emojiImg = new ast.Node(ast.NodeEmojiImg, tree.EmojiImgTokens(alt, util.DomAttrValue(n, "src")));
          emojiImg.AppendChild(new ast.Node(ast.NodeEmojiAlias, conv.BytesFromString(":" + alt + ":")));
          node.AppendChild(emojiImg);
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        break;
    }

    for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
      lute.genASTContenteditable(c, tree);
    }

    if (lute.ParseOptions.TextMark) {
      return;
    }

    switch (n.DataAtom) {
      case atom.Code:
        node.AppendChild(new ast.Node(ast.NodeCodeSpanCloseMarker));
        break;
      case atom.Span: {
        const dataType = util.DomAttrValue(n, "data-type");
        if ("tag" === dataType) {
          node.AppendChild(new ast.Node(ast.NodeTagCloseMarker));
        } else if ("a" === dataType) {
          node.AppendChild(new ast.Node(ast.NodeCloseBracket));
          node.AppendChild(new ast.Node(ast.NodeOpenParen));
          const href = lute.trimLinkPath(util.DomAttrValue(n, "data-href"));
          node.AppendChild(new ast.Node(ast.NodeLinkDest, conv.BytesFromString(href)));
          let linkTitle = util.DomAttrValue(n, "data-title");
          if ("" !== linkTitle) {
            node.AppendChild(new ast.Node(ast.NodeLinkSpace));
            // < and > are not escaped, which conforms to the Markdown specification https://github.com/siyuan-note/siyuan/issues/15023
            linkTitle = strings.ReplaceAll(linkTitle, "&lt;", "<");
            linkTitle = strings.ReplaceAll(linkTitle, "&gt;", ">");
            node.AppendChild(new ast.Node(ast.NodeLinkTitle, conv.BytesFromString(linkTitle)));
          }
          node.AppendChild(new ast.Node(ast.NodeCloseParen));
        }
        break;
      }
      case atom.Sub:
        node.AppendChild(new ast.Node(ast.NodeSubCloseMarker));
        break;
      case atom.Sup:
        node.AppendChild(new ast.Node(ast.NodeSupCloseMarker));
        break;
      case atom.U:
        node.AppendChild(new ast.Node(ast.NodeUnderlineCloseMarker));
        break;
      case atom.Kbd:
        node.AppendChild(new ast.Node(ast.NodeKbdCloseMarker));
        break;
      case atom.Em:
      case atom.I: {
        let marker = util.DomAttrValue(n, "data-marker");
        if ("" === marker) {
          marker = "*";
        }
        if ("_" === marker) {
          node.AppendChild(new ast.Node(ast.NodeEmU8eCloseMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeEmA6kCloseMarker, conv.BytesFromString(marker)));
        }
        break;
      }
      case atom.Strong:
      case atom.B: {
        let marker = util.DomAttrValue(n, "data-marker");
        if ("" === marker) {
          marker = "**";
        }
        if ("__" === marker) {
          node.AppendChild(new ast.Node(ast.NodeStrongU8eCloseMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeStrongA6kCloseMarker, conv.BytesFromString(marker)));
        }
        break;
      }
      case atom.Del:
      case atom.S:
      case atom.Strike: {
        const marker = util.DomAttrValue(n, "data-marker");
        if ("~" === marker) {
          node.AppendChild(new ast.Node(ast.NodeStrikethrough1CloseMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeStrikethrough2CloseMarker, conv.BytesFromString(marker)));
        }
        break;
      }
      case atom.Mark: {
        const marker = util.DomAttrValue(n, "data-marker");
        if ("=" === marker) {
          node.AppendChild(new ast.Node(ast.NodeMark1CloseMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeMark2CloseMarker, conv.BytesFromString(marker)));
        }
        break;
      }
    }
  } finally {
    if (deferParentTip) {
      tree.Context!.ParentTip();
    }
  }
};

Lute.prototype.setBlockIAL = function (this: Lute, n: html.Node, node: ast.Node): Uint8Array {
  const lute = this;
  let ialTokens: Uint8Array = new Uint8Array(0);
  node.SetIALAttr("id", node.ID);
  for (const name of ["tabs-active-id", "tabs-position", "tabs-title", "tabs-placeholder", "tabs-task"]) {
    const value = util.DomAttrValue(n, name);
    if ("" !== value) {
      node.SetIALAttr(name, value);
      ialTokens = slices.AppendString(ialTokens, " " + name + "=\"" + html.EscapeAttrVal(value) + "\"");
    }
  }

  {
    let caption = util.DomAttrValue(n, "caption");
    if ("" !== caption) {
      node.SetIALAttr("caption", caption);
      ialTokens = slices.AppendString(ialTokens, " caption=\"" + caption + "\"");
    }
  }

  {
    let icon = util.DomAttrValue(n, "icon");
    if ("" !== icon) {
      node.SetIALAttr("icon", icon);
      ialTokens = slices.AppendString(ialTokens, " icon=\"" + icon + "\"");
    }
  }

  {
    let refcount = util.DomAttrValue(n, "refcount");
    if ("" !== refcount) {
      node.SetIALAttr("refcount", refcount);
      ialTokens = slices.AppendString(ialTokens, " refcount=\"" + refcount + "\"");
    }
  }

  {
    let avNames = util.DomAttrValue(n, "av-names");
    if ("" !== avNames) {
      node.SetIALAttr("av-names", avNames);
      ialTokens = slices.AppendString(ialTokens, " av-names=\"" + avNames + "\"");
    }
  }

  {
    let bookmark = util.DomAttrValue(n, "bookmark");
    if ("" !== bookmark) {
      bookmark = html.UnescapeHTMLStr(bookmark);
      node.SetIALAttr("bookmark", bookmark);
      ialTokens = slices.AppendString(ialTokens, " bookmark=\"" + bookmark + "\"");
    }
  }

  {
    let style = util.DomAttrValue(n, "style");
    if ("" !== style) {
      style = html.UnescapeHTMLStr(style);
      style = parse.StyleValue(style);
      node.SetIALAttr("style", style);
      ialTokens = slices.AppendString(ialTokens, " style=\"" + style + "\"");
    }
  }

  {
    let name = util.DomAttrValue(n, "name");
    if ("" !== name) {
      name = html.UnescapeHTMLStr(name);
      node.SetIALAttr("name", name);
      ialTokens = slices.AppendString(ialTokens, " name=\"" + name + "\"");
    }
  }

  {
    let memo = util.DomAttrValue(n, "memo");
    if ("" !== memo) {
      memo = html.UnescapeHTMLStr(memo);
      node.SetIALAttr("memo", memo);
      ialTokens = slices.AppendString(ialTokens, " memo=\"" + memo + "\"");
    }
  }

  {
    let alias = util.DomAttrValue(n, "alias");
    if ("" !== alias) {
      alias = html.UnescapeHTMLStr(alias);
      node.SetIALAttr("alias", alias);
      ialTokens = slices.AppendString(ialTokens, " alias=\"" + alias + "\"");
    }
  }

  {
    let fold = util.DomAttrValue(n, "fold");
    if ("" !== fold) {
      node.SetIALAttr("fold", fold);
      ialTokens = slices.AppendString(ialTokens, " fold=\"" + fold + "\"");
    }
  }

  {
    let headingFold = util.DomAttrValue(n, "heading-fold");
    if ("" !== headingFold) {
      node.SetIALAttr("heading-fold", headingFold);
      ialTokens = slices.AppendString(ialTokens, " heading-fold=\"" + headingFold + "\"");
    }
  }

  {
    let parentFold = util.DomAttrValue(n, "parent-fold");
    if ("" !== parentFold) {
      node.SetIALAttr("parent-fold", parentFold);
      ialTokens = slices.AppendString(ialTokens, " parent-fold=\"" + parentFold + "\"");
    }
  }

  {
    let updated = util.DomAttrValue(n, "updated");
    if ("" !== updated) {
      node.SetIALAttr("updated", updated);
      ialTokens = slices.AppendString(ialTokens, " updated=\"" + updated + "\"");
    }
  }

  {
    let linewrap = util.DomAttrValue(n, "linewrap");
    if ("" !== linewrap) {
      node.SetIALAttr("linewrap", linewrap);
      ialTokens = slices.AppendString(ialTokens, " linewrap=\"" + linewrap + "\"");
    }
  }

  {
    let ligatures = util.DomAttrValue(n, "ligatures");
    if ("" !== ligatures) {
      node.SetIALAttr("ligatures", ligatures);
      ialTokens = slices.AppendString(ialTokens, " ligatures=\"" + ligatures + "\"");
    }
  }

  {
    let linenumber = util.DomAttrValue(n, "linenumber");
    if ("" !== linenumber) {
      node.SetIALAttr("linenumber", linenumber);
      ialTokens = slices.AppendString(ialTokens, " linenumber=\"" + linenumber + "\"");
    }
  }

  {
    let breadcrumb = util.DomAttrValue(n, "breadcrumb");
    if ("" !== breadcrumb) {
      node.SetIALAttr("breadcrumb", breadcrumb);
      ialTokens = slices.AppendString(ialTokens, " breadcrumb=\"" + breadcrumb + "\"");
    }
  }

  {
    let dataExportMd = util.DomAttrValue(n, "data-export-md");
    if ("" !== dataExportMd) {
      dataExportMd = html.UnescapeHTMLStr(dataExportMd);
      node.SetIALAttr("data-export-md", dataExportMd);
      ialTokens = slices.AppendString(ialTokens, " data-export-md=\"" + dataExportMd + "\"");
    }
  }

  {
    let dataExportHtml = util.DomAttrValue(n, "data-export-html");
    if ("" !== dataExportHtml) {
      dataExportHtml = html.UnescapeHTMLStr(dataExportHtml);
      node.SetIALAttr("data-export-html", dataExportHtml);
      ialTokens = slices.AppendString(ialTokens, " data-export-html=\"" + dataExportHtml + "\"");
    }
  }

  {
    const customAttrs = util.DomCustomAttrs(n);
    if (null !== customAttrs) {
      for (let [k, v] of customAttrs) {
        v = html.UnescapeHTMLStr(v);
        node.SetIALAttr(k, v);
        ialTokens = slices.AppendString(ialTokens, " " + k + "=\"" + v + "\"");
      }
    }
  }

  if ("NodeTable" === util.DomAttrValue(n, "data-type")) {
    const colgroup = lute.domChild(n, atom.Colgroup);
    let colgroupAttrVal: string = "";
    if (null !== colgroup) {
      for (let col = colgroup.FirstChild; null !== col; col = col.NextSibling) {
        const colStyle = util.DomAttrValue(col, "style");
        colgroupAttrVal += colStyle;
        if (null !== col.NextSibling) {
          colgroupAttrVal += "|";
        }
      }
      node.SetIALAttr("colgroup", colgroupAttrVal);
      ialTokens = slices.AppendString(ialTokens, " colgroup=\"" + colgroupAttrVal + "\"");
    }
  }

  ialTokens = parse.IAL2Tokens(node.KramdownIAL);
  return ialTokens;
};

// setBlockIAL2 sets the block IAL, only used in h2m.
Lute.prototype.setBlockIAL2 = function (this: Lute, n: html.Node, node: ast.Node): Uint8Array {
  const lute = this;
  let ialTokens: Uint8Array = new Uint8Array(0);
  {
    let bookmark = util.DomAttrValue(n, "bookmark");
    if ("" !== bookmark) {
      bookmark = html.UnescapeHTMLStr(bookmark);
      node.SetIALAttr("bookmark", bookmark);
      ialTokens = slices.AppendString(ialTokens, " bookmark=\"" + bookmark + "\"");
    }
  }

  {
    let style = util.DomAttrValue(n, "style");
    if ("" !== style) {
      style = html.UnescapeHTMLStr(style);
      style = parse.StyleValue(style);
      node.SetIALAttr("style", style);
      ialTokens = slices.AppendString(ialTokens, " style=\"" + style + "\"");
    }
  }

  {
    let name = util.DomAttrValue(n, "name");
    if ("" !== name) {
      name = html.UnescapeHTMLStr(name);
      node.SetIALAttr("name", name);
      ialTokens = slices.AppendString(ialTokens, " name=\"" + name + "\"");
    }
  }

  {
    let memo = util.DomAttrValue(n, "memo");
    if ("" !== memo) {
      memo = html.UnescapeHTMLStr(memo);
      node.SetIALAttr("memo", memo);
      ialTokens = slices.AppendString(ialTokens, " memo=\"" + memo + "\"");
    }
  }

  {
    let alias = util.DomAttrValue(n, "alias");
    if ("" !== alias) {
      alias = html.UnescapeHTMLStr(alias);
      node.SetIALAttr("alias", alias);
      ialTokens = slices.AppendString(ialTokens, " alias=\"" + alias + "\"");
    }
  }

  {
    let fold = util.DomAttrValue(n, "fold");
    if ("" !== fold) {
      node.SetIALAttr("fold", fold);
      ialTokens = slices.AppendString(ialTokens, " fold=\"" + fold + "\"");
    }
  }

  {
    let headingFold = util.DomAttrValue(n, "heading-fold");
    if ("" !== headingFold) {
      node.SetIALAttr("heading-fold", headingFold);
      ialTokens = slices.AppendString(ialTokens, " heading-fold=\"" + headingFold + "\"");
    }
  }

  {
    let parentFold = util.DomAttrValue(n, "parent-fold");
    if ("" !== parentFold) {
      node.SetIALAttr("parent-fold", parentFold);
      ialTokens = slices.AppendString(ialTokens, " parent-fold=\"" + parentFold + "\"");
    }
  }

  {
    const customAttrs = util.DomCustomAttrs(n);
    if (null !== customAttrs) {
      for (let [k, v] of customAttrs) {
        v = html.UnescapeHTMLStr(v);
        node.SetIALAttr(k, v);
        ialTokens = slices.AppendString(ialTokens, " " + k + "=\"" + v + "\"");
      }
    }
  }

  ialTokens = parse.IAL2Tokens(node.KramdownIAL);
  return ialTokens;
};


function processSpanMarkerSpace(n: html.Node, node: ast.Node): void {
  if (strings.HasPrefix(n.FirstChild!.Data, " ") && null === n.FirstChild!.PrevSibling) {
    n.FirstChild!.Data = strings.TrimLeft(n.FirstChild!.Data, " ");
    node.InsertBefore(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
  }
  if (strings.HasSuffix(n.FirstChild!.Data, " ") && null === n.FirstChild!.NextSibling) {
    n.FirstChild!.Data = strings.TrimRight(n.FirstChild!.Data, " ");
    n.InsertAfter(htmlTextNode(" "));
  }
  if (strings.HasSuffix(n.FirstChild!.Data, " " + editor.Caret) && null === n.FirstChild!.NextSibling) {
    n.FirstChild!.Data = strings.TrimRight(n.FirstChild!.Data, " " + editor.Caret);
    n.InsertAfter(htmlTextNode(" " + editor.Caret));
  }
  if (strings.HasSuffix(n.FirstChild!.Data, "\n") && null === n.FirstChild!.NextSibling) {
    n.FirstChild!.Data = strings.TrimRight(n.FirstChild!.Data, "\n");
    n.InsertAfter(htmlTextNode("\n"));
  }
}

Lute.prototype.removeInnerMarker = function (this: Lute, n: html.Node, marker: string): void {
  const lute = this;
  if (html.TextNode === n.Type) {
    n.Data = strings.ReplaceAll(n.Data, marker, "");
  }
  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    lute.removeInnerMarker0(child, marker);
  }
};

Lute.prototype.removeInnerMarker0 = function (this: Lute, n: html.Node | null, marker: string): void {
  const lute = this;
  if (null === n) {
    return;
  }
  const dataRender = util.DomAttrValue(n, "data-render");
  if ("1" === dataRender || "2" === dataRender) {
    return;
  }

  if ("svg" === n.Namespace) {
    return;
  }

  if (0 === n.DataAtom && html.ElementNode === n.Type) { // Custom tag
    return;
  }

  switch (n.DataAtom) {
    case 0:
      n.Data = strings.ReplaceAll(n.Data, marker, "");
      break;
  }

  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    lute.removeInnerMarker0(child, marker);
  }
};

Lute.prototype.removeTempMark = function (this: Lute, dataType: string): string {
  let ret = strings.ReplaceAll(dataType, "search-mark", "");
  ret = strings.ReplaceAll(ret, "virtual-block-ref", "");
  ret = strings.TrimSpace(ret);
  return ret;
};
