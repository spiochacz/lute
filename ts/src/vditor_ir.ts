// Ported from vditor_ir.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: the helpers adjustVditorDOM, hasAttr, parentIs, isEmptyText, startsWithNewline and isInline are Lute methods of vditor_wysiwyg.go, HTML2Markdown is a Lute method of h2m.go and Md2HTML one of vditor_wysiwyg.go.
// They are called as in Go; they are declared in the files that define them.
// PORT-NOTE: Go's `defer f()` statements of genASTByVditorIRDOM are registered at different places of one long function body (inside a switch case) and run when the function returns, in reverse order.
// They are ported as a list of deferred closures run by one try/finally that wraps the whole body, which covers exactly what the defers cover.

import * as bytes from "./runtime/bytes.ts";
import * as conv from "./runtime/conv.ts";
import * as strconv from "./runtime/strconv.ts";
import * as strings from "./runtime/strings.ts";
import * as ast from "./ast/index.ts";
import * as editor from "./editor/index.ts";
import * as html from "./html/index.ts";
import * as atom from "./html/atom/index.ts";
import * as parse from "./parse/index.ts";
import * as render from "./render/index.ts";
import * as util from "./util/index.ts";
import { Lute } from "./types.ts";
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the only import of src/incremental/.
import { incrementalActive, incrementalAuto, tryIncrementalDom2Md } from "./incremental/dispatch.ts";

declare module "./types.ts" {
  interface Lute {
    SpinVditorIRDOM(ivHTML: string): string;
    HTML2VditorIRDOM(sHTML: string): string;
    VditorIRDOM2HTML(vhtml: string): string;
    Md2VditorIRDOM(markdown: string): string;
    VditorIRDOM2Md(htmlStr: string): string;
    vditorIRDOM2Md(htmlStr: string): string;
    genASTByVditorIRDOM(n: html.Node, tree: parse.Tree): void;
  }
}

const fenceTokens: Uint8Array = conv.BytesFromString("```");
const gtTokens: Uint8Array = conv.BytesFromString(">");
const brTokens: Uint8Array = conv.BytesFromString("<br />");
const zwspTokens: Uint8Array = conv.BytesFromString(editor.Zwsp);
const zwspNewlineTokens: Uint8Array = conv.BytesFromString(editor.Zwsp + "\n");
const backtickTokens: Uint8Array = conv.BytesFromString("`");
const detailsCloseTokens: Uint8Array = conv.BytesFromString("</details>");
const summaryCloseTokens: Uint8Array = conv.BytesFromString("</summary>");

// SpinVditorIRDOM spins the Vditor Instant-Rendering DOM, used for editing in the instant-rendering mode.
Lute.prototype.SpinVditorIRDOM = function (this: Lute, ivHTML: string): string {
  const lute = this;
  let ovHTML = "";
  // Replace the caret
  ivHTML = strings.ReplaceAll(ivHTML, "<wbr>", editor.Caret);
  const markdown = lute.vditorIRDOM2Md(ivHTML);
  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewVditorIRRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  const output = renderer.Render();
  // Replace the caret
  ovHTML = strings.ReplaceAll(conv.StringFromBytes(output), editor.Caret, "<wbr>");
  return ovHTML;
};

// HTML2VditorIRDOM converts HTML to Vditor Instant-Rendering DOM, used for pasting in the instant-rendering mode.
Lute.prototype.HTML2VditorIRDOM = function (this: Lute, sHTML: string): string {
  const lute = this;
  let vHTML = "";
  const [markdown, err] = lute.HTML2Markdown(sHTML);
  if (null !== err) {
    vHTML = err.message;
    return vHTML;
  }

  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewVditorIRRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.HTML2VditorIRDOMRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const output = renderer.Render();
  vHTML = conv.StringFromBytes(output);
  return vHTML;
};

// VditorIRDOM2HTML converts Vditor Instant-Rendering DOM to HTML, used by the Vditor.getHTML() interface.
Lute.prototype.VditorIRDOM2HTML = function (this: Lute, vhtml: string): string {
  const lute = this;
  let sHTML = "";
  const markdown = lute.vditorIRDOM2Md(vhtml);
  sHTML = lute.Md2HTML(markdown);
  return sHTML;
};

// Md2VditorIRDOM converts markdown to Vditor Instant-Rendering DOM, used for switching from the source mode to the instant-rendering mode.
Lute.prototype.Md2VditorIRDOM = function (this: Lute, markdown: string): string {
  const lute = this;
  let vHTML = "";
  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewVditorIRRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.Md2VditorIRDOMRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const output = renderer.Render();
  vHTML = conv.StringFromBytes(output);
  return vHTML;
};

// VditorIRDOM2Md converts Vditor Instant-Rendering DOM to markdown, used for switching from the instant-rendering mode to the source mode.
Lute.prototype.VditorIRDOM2Md = function (this: Lute, htmlStr: string): string {
  const lute = this;
  let markdown = "";
  htmlStr = strings.ReplaceAll(htmlStr, editor.Zwsp, "");
  // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: with no engine having the cache enabled this is one integer test.
  if (0 !== incrementalActive.count || htmlStr.length >= incrementalAuto.minLength) {
    const composed = tryIncrementalDom2Md(lute, "ir", htmlStr);
    if (null !== composed) {
      markdown = strings.ReplaceAll(composed, editor.Zwsp, "");
      return markdown;
    }
  }
  markdown = lute.vditorIRDOM2Md(htmlStr);
  markdown = strings.ReplaceAll(markdown, editor.Zwsp, "");
  return markdown;
};

// vditorIRDOM2MdPreprocess removes the caret and normalises the trailing white space of the input string.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: see vditorIRDOM2MdPrepare.
export function vditorIRDOM2MdPreprocess(htmlStr: string): string {
  // Remove the caret
  htmlStr = strings.ReplaceAll(htmlStr, "<wbr>", "");

  // Replace trailing whitespace, otherwise the HTML parsing produces redundant nodes that lead to empty code blocks
  htmlStr = strings.ReplaceAll(htmlStr, "\t\n", "\n");
  htmlStr = strings.ReplaceAll(htmlStr, "    \n", "  \n");
  return htmlStr;
}

// vditorIRDOM2MdPrepare is the first stage of vditorIRDOM2Md: it removes the caret, normalises the trailing white space, parses the string into a DOM tree
// and adjusts the DOM. It returns null where vditorIRDOM2Md returns its empty result before any rendering.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the stages of vditorIRDOM2Md are functions of their own, so that the
// recording renderer (render/recording_format_renderer.ts) runs the same stages; they are exported for tests and are not methods of Lute.
export function vditorIRDOM2MdPrepare(lute: Lute, htmlStr: string): html.Node | null {
  htmlStr = vditorIRDOM2MdPreprocess(htmlStr);

  // Parse the string into a DOM tree
  const htmlRoot = util.ParseHTML(htmlStr);
  if (null === htmlRoot) {
    return null;
  }

  // Adjust the DOM structure
  lute.adjustVditorDOM(htmlRoot);

  return htmlRoot;
}

// vditorIRDOM2MdBuildTree is the second stage of vditorIRDOM2Md: it converts the adjusted DOM tree into a Markdown syntax tree and adjusts the tree.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: see vditorIRDOM2MdPrepare.
export function vditorIRDOM2MdBuildTree(lute: Lute, htmlRoot: html.Node): parse.Tree {
  // Convert the HTML tree to a Markdown AST
  const tree = new parse.Tree();
  tree.Name = "";
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.Context = new parse.Context(lute.ParseOptions);
  tree.Context.Tip = tree.Root;
  for (let c = htmlRoot.FirstChild; null !== c; c = c.NextSibling) {
    lute.genASTByVditorIRDOM(c, tree);
  }

  // Adjust the tree structure
  vditorIRDOM2MdAdjustTree(tree);

  return tree;
}

// vditorIRDOM2MdAdjustTree adjusts the structure of the Markdown syntax tree built by vditorIRDOM2MdBuildTree.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: see vditorIRDOM2MdPrepare.
export function vditorIRDOM2MdAdjustTree(tree: parse.Tree): void {
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering) {
      switch (n.Type) {
        case ast.NodeInlineHTML:
        case ast.NodeCodeSpan:
        case ast.NodeInlineMath:
        case ast.NodeHTMLBlock:
        case ast.NodeCodeBlockCode:
        case ast.NodeMathBlockContent:
          n.Tokens = html.UnescapeHTML(n.Tokens ?? new Uint8Array(0)); // PORT-NOTE: Go converts a nil slice to "" and the result is never nil
          if (null !== n.Next && ast.NodeCodeSpan === n.Next.Type && n.CodeMarkerLen === n.Next.CodeMarkerLen) {
            // Merge code nodes https://github.com/Vanessa219/vditor/issues/167
            n.FirstChild!.Next!.AppendTokens(n.Next.FirstChild!.Next!.Tokens ?? new Uint8Array(0));
            n.Next.Unlink();
          }
          break;
        case ast.NodeList:
          // The sub-lists generated by the browser are in the form ul.ul, they need to be adjusted to ul.li.ul
          if (null !== n.Parent && ast.NodeList === n.Parent.Type) {
            const previousLi = n.Previous;
            if (null !== previousLi) {
              previousLi.AppendChild(n);
            }
          }
          break;
      }
    }
    return ast.WalkContinue;
  });
}

// vditorIRDOM2MdRenderOptions returns the options of the Markdown formatter that vditorIRDOM2Md renders with.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: see vditorIRDOM2MdPrepare.
export function vditorIRDOM2MdRenderOptions(): render.Options {
  const options = render.NewOptions();
  options.AutoSpace = false;
  options.FixTermTypo = false;
  return options;
}

// vditorIRDOM2MdRender is the render stage of vditorIRDOM2Md: the Markdown formatter renders the tree.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: see vditorIRDOM2MdPrepare.
export function vditorIRDOM2MdRender(lute: Lute, tree: parse.Tree): Uint8Array {
  const renderer = render.NewFormatRenderer(tree, vditorIRDOM2MdRenderOptions(), lute.ParseOptions);
  return renderer.Render();
}

Lute.prototype.vditorIRDOM2Md = function (this: Lute, htmlStr: string): string {
  const lute = this;
  let markdown = "";
  const htmlRoot = vditorIRDOM2MdPrepare(lute, htmlStr);
  if (null === htmlRoot) {
    return markdown;
  }
  const tree = vditorIRDOM2MdBuildTree(lute, htmlRoot);
  // Render the AST with the Markdown formatter
  const formatted = vditorIRDOM2MdRender(lute, tree);
  markdown = conv.StringFromBytes(formatted);
  return markdown;
};

// genASTByVditorIRDOM walks the Vditor IR DOM node n depth-first and builds the Markdown syntax tree tree step by step.
Lute.prototype.genASTByVditorIRDOM = function (this: Lute, n: html.Node, tree: parse.Tree): void {
  const lute = this;
  // The deferred calls of this function, run in reverse order when it returns (see the PORT-NOTE at the top of the file)
  const deferred: Array<() => void> = [];
  try {
    const dataRender = util.DomAttrValue(n, "data-render");
    if ("1" === dataRender || "2" === dataRender) { // 1: floating toolbar, 2: preview code block, math block or node that is not parsed
      return;
    }

    const dataType = util.DomAttrValue(n, "data-type");

    if (atom.Div === n.DataAtom) {
      if ("code-block" === dataType || "html-block" === dataType || "math-block" === dataType || "yaml-front-matter" === dataType) {
        if (("code-block" === dataType || "math-block" === dataType) &&
          !strings.Contains(util.DomAttrValue(n.FirstChild, "data-type"), "-block-open-marker")) {
          if ("code-block" === dataType && null !== n.FirstChild && atom.Pre === n.FirstChild.DataAtom) {
            // An indented code block has no fence markers in the IR DOM: build a code block and restore the tip
            // (departure from upstream, tasks/002 item 64; oracle patch 0002)
            const tip = tree.Context!.Tip!;
            const node = new ast.Node(ast.NodeCodeBlock);
            tip.AppendChild(node);
            tree.Context!.Tip = node;
            for (let c = n.FirstChild as html.Node | null; c !== null; c = c.NextSibling) {
              lute.genASTByVditorIRDOM(c, tree);
            }
            tree.Context!.Tip = tip;
            if (null === node.FirstChild) {
              node.Unlink();
            }
            return;
          }

          // Handle the line break after the closing ``` or $$
          // TODO: the caret can not appear at this position any more, remove this code after confirming
          const p = new ast.Node(ast.NodeParagraph);
          const text = new ast.Node(ast.NodeText, conv.BytesFromString(util.DomText(n.FirstChild)));
          p.AppendChild(text);
          tree.Context!.Tip!.AppendChild(p);
          return;
        }

        for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
          lute.genASTByVditorIRDOM(c, tree);
        }
      } else if ("link-ref-defs-block" === dataType) {
        let text = util.DomText(n);
        // Deliberate departure from upstream, tasks/002-upstream-bugs.md item 68 (oracle patch 0003): the definitions end their line, so that the next block does not continue it
        if (!strings.HasSuffix(text, "\n")) {
          text += "\n";
        }
        const node = new ast.Node(ast.NodeText, conv.BytesFromString(text));
        tree.Context!.Tip!.AppendChild(node);
      } else if ("footnotes-def" === dataType) {
        for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
          lute.genASTByVditorIRDOM(c, tree);
        }
      } else if ("footnotes-block" === dataType) {
        for (let def = n.FirstChild; null !== def; def = def.NextSibling) {
          const originalHTML = new bytes.Buffer();
          if (null === html.Render(originalHTML, def)) {
            let md = lute.vditorIRDOM2Md(originalHTML.String());
            const lines = strings.Split(md, "\n");
            md = "";
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (0 < i) {
                md += "    " + line;
              } else {
                md = line;
              }
              md += "\n";
            }
            const node = new ast.Node(ast.NodeText, conv.BytesFromString(md));
            tree.Context!.Tip!.AppendChild(node);
          }
        }
      } else if ("toc-block" === dataType) {
        const node = new ast.Node(ast.NodeToC);
        tree.Context!.Tip!.AppendChild(node);
      } else {
        const text = util.DomText(n);
        if (editor.Caret + "\n" === text) { // Handle the paragraph break that FireFox produces in some cases
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Caret + "\n")));
        }
      }
      return;
    }

    const cls = util.DomAttrValue(n, "class");
    let content = strings.ReplaceAll(n.Data, editor.Zwsp, "");
    const node = new ast.Node(ast.NodeText, conv.BytesFromString(content));
    switch (n.DataAtom) {
      case 0: {
        if ("" === content) {
          return;
        }

        let checkIndentCodeBlock = strings.ReplaceAll(content, editor.Caret, "");
        checkIndentCodeBlock = strings.ReplaceAll(checkIndentCodeBlock, "\t", "    ");
        if ((!lute.isInline(n.PrevSibling)) && strings.HasPrefix(checkIndentCodeBlock, "    ")) {
          node.Type = ast.NodeCodeBlock;
          node.IsFencedCodeBlock = true;
          const openMarker = new ast.Node(ast.NodeCodeBlockFenceOpenMarker, fenceTokens);
          openMarker.CodeBlockFenceLen = 3;
          node.AppendChild(openMarker);
          node.AppendChild(new ast.Node(ast.NodeCodeBlockFenceInfoMarker));
          const startCaret = strings.HasPrefix(content, editor.Caret);
          if (startCaret) {
            content = strings.ReplaceAll(content, editor.Caret, "");
          }
          content = strings.TrimSpace(content);
          if (startCaret) {
            content = editor.Caret + content;
          }
          const codeNode = new ast.Node(ast.NodeCodeBlockCode, conv.BytesFromString(content)); // PORT-NOTE: Go shadows content with the node here
          node.AppendChild(codeNode);
          const closeMarker = new ast.Node(ast.NodeCodeBlockFenceCloseMarker, fenceTokens);
          closeMarker.CodeBlockFenceLen = 3;
          node.AppendChild(closeMarker);
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if (null !== n.Parent && atom.A === n.Parent.DataAtom) {
          node.Type = ast.NodeLinkText;
        }
        tree.Context!.Tip!.AppendChild(node);
        break;
      }
      case atom.P:
      case atom.Div: {
        node.Type = ast.NodeParagraph;
        const text = util.DomText(n);
        if ("\n" === text && ast.NodeBlockquote === tree.Context!.Tip!.Type && null === tree.Context!.Tip!.FirstChild!.Next) {
          // Do not allow a line break before the first node of a blockquote
          return;
        } else {
          tree.Context!.Tip!.AppendChild(node);
          tree.Context!.Tip = node;
          deferred.push(() => {
            tree.Context!.ParentTip();
            // Deliberate departure from upstream, tasks/002-upstream-bugs.md item 67 (oracle patch 0003): a paragraph whose only child is a code block
            // (its text began with four spaces) is replaced by that code block, so that the Markdown has no extra blank lines after it
            const c = node.FirstChild;
            if (c !== null && c === node.LastChild && ast.NodeCodeBlock === c.Type && node.Parent !== null) {
              node.InsertBefore(c);
              node.Unlink();
            }
          });
        }
        break;
      }
      case atom.H1:
      case atom.H2:
      case atom.H3:
      case atom.H4:
      case atom.H5:
      case atom.H6: {
        const text = util.DomText(n);
        if ("" === strings.TrimSpace(text)) {
          return;
        }
        node.Type = ast.NodeHeading;
        const marker = util.DomAttrValue(n, "data-marker");
        node.HeadingSetext = "=" === marker || "-" === marker;
        if (!node.HeadingSetext) {
          const headingMarker = util.DomText(n.FirstChild);
          node.HeadingLevel = bytes.Count(conv.BytesFromString(headingMarker), conv.BytesFromString("#"));
        } else {
          if ("" === strings.TrimSpace(strings.ReplaceAll(util.DomText(n.LastChild), editor.Caret, ""))) {
            node.Type = ast.NodeText;
            node.Tokens = conv.BytesFromString(text);
            tree.Context!.Tip!.AppendChild(node);
            tree.Context!.Tip = node;
            break;
          }

          if ("=" === marker) {
            node.HeadingLevel = 1;
          } else {
            node.HeadingLevel = 2;
          }
          if (null !== n.LastChild!.PrevSibling) {
            n.LastChild!.PrevSibling.Data = strings.TrimSuffix(n.LastChild!.PrevSibling.Data, "\n");
          }
        }
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.Hr:
        node.Type = ast.NodeThematicBreak;
        tree.Context!.Tip!.AppendChild(node);
        break;
      case atom.Blockquote: {
        const bqContent = strings.TrimSpace(util.DomText(n)); // PORT-NOTE: Go shadows content here
        if ("" === bqContent || "&gt;" === bqContent) {
          return;
        }
        if (editor.Caret === bqContent) {
          node.Type = ast.NodeText;
          node.Tokens = conv.BytesFromString(bqContent);
          tree.Context!.Tip!.AppendChild(node);
        }

        node.Type = ast.NodeBlockquote;
        node.AppendChild(new ast.Node(ast.NodeBlockquoteMarker, gtTokens));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.Ol:
      case atom.Ul: {
        if (null === n.FirstChild) {
          return;
        }

        node.Type = ast.NodeList;
        node.ListData = new ast.ListData();
        if (atom.Ol === n.DataAtom) {
          node.ListData.Typ = 1;
        }
        const tight = util.DomAttrValue(n, "data-tight");
        if ("true" === tight || "" === tight) {
          node.ListData.Tight = true;
        }
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.Li: {
        const p = n.FirstChild;
        if (null !== p && atom.P === p.DataAtom && null !== p.NextSibling && atom.P === p.NextSibling.DataAtom) {
          tree.Context!.Tip!.ListData!.Tight = false;
        }

        node.Type = ast.NodeListItem;
        let marker = util.DomAttrValue(n, "data-marker");
        let bullet = 0;
        if ("" === marker) {
          if (null !== n.Parent && atom.Ol === n.Parent.DataAtom) {
            const firstLiMarker = util.DomAttrValue(n.Parent.FirstChild, "data-marker");
            const startAttr = util.DomAttrValue(n.Parent, "start");
            if ("" === startAttr) {
              marker = "1";
            } else {
              marker = startAttr;
            }
            if ("" !== firstLiMarker) {
              marker += firstLiMarker.slice(firstLiMarker.length - 1); // PORT-NOTE: byte offset, Go takes the last byte
            } else {
              marker += ".";
            }
          } else {
            marker = util.DomAttrValue(n.Parent, "data-marker");
            if ("" === marker) {
              marker = "*";
            }
            bullet = conv.BytesFromString(marker)[0];
          }
        } else {
          if (null !== n.Parent) {
            if (atom.Ol === n.Parent.DataAtom) {
              if ("*" === marker || "-" === marker || "+" === marker) {
                marker = "1.";
              }
              if ("1." !== marker && "1)" !== marker && null !== n.PrevSibling && atom.Li !== n.PrevSibling.DataAtom &&
                null !== n.Parent.Parent && (atom.Ol === n.Parent.Parent.DataAtom || atom.Ul === n.Parent.Parent.DataAtom)) {
                // The first item of a child ordered list must start from 1
                marker = "1.";
              }
              if ("1." !== marker && "1)" !== marker && atom.Ol === n.Parent.DataAtom && n.Parent.FirstChild === n && "" === util.DomAttrValue(n.Parent, "start")) {
                marker = "1.";
              }
            } else {
              if ("*" !== marker && "-" !== marker && "+" !== marker) {
                marker = "*";
              }
              bullet = conv.BytesFromString(marker)[0];
            }
          } else {
            marker = util.DomAttrValue(n, "data-marker");
            if ("" === marker) {
              marker = "*";
            }
            bullet = conv.BytesFromString(marker)[0];
          }
        }
        node.ListData = new ast.ListData();
        node.ListData.Marker = conv.BytesFromString(marker);
        node.ListData.BulletChar = bullet;
        if (0 === bullet) {
          // PORT-NOTE: byte offset, Go slices off the last byte of marker
          const markerBytes = conv.BytesFromString(marker);
          [node.ListData.Num] = strconv.Atoi(conv.StringFromBytes(markerBytes.subarray(0, markerBytes.length - 1)));
          node.ListData.Delimiter = markerBytes[markerBytes.length - 1];
        }

        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.Pre: {
        // UPSTREAM-BUG: a pre element without children is a nil pointer dereference (vditor_ir.go, case atom.Pre)
        if (atom.Code === n.FirstChild!.DataAtom) {
          let codeTokens: Uint8Array | null = null;
          if (null !== n.FirstChild!.FirstChild) {
            codeTokens = conv.BytesFromString(n.FirstChild!.FirstChild.Data);
          }

          const divDataType = util.DomAttrValue(n.Parent, "data-type");
          switch (divDataType) {
            case "math-block":
              node.Type = ast.NodeMathBlockContent;
              node.Tokens = codeTokens;
              tree.Context!.Tip!.AppendChild(node);
              break;
            case "html-block":
              node.Type = ast.NodeHTMLBlock;
              node.Tokens = codeTokens;
              tree.Context!.Tip!.AppendChild(node);
              break;
            case "yaml-front-matter":
              node.Type = ast.NodeYamlFrontMatter;
              node.AppendChild(new ast.Node(ast.NodeYamlFrontMatterContent, codeTokens));
              tree.Context!.Tip!.AppendChild(node);
              break;
            default:
              node.Type = ast.NodeCodeBlockCode;
              node.Tokens = codeTokens;
              tree.Context!.Tip!.AppendChild(node);
          }
        }
        return;
      }
      case atom.Em:
      case atom.I: {
        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, zwspNewlineTokens));
        }
        const text = strings.TrimSpace(util.DomText(n));
        if (lute.isEmptyText(n)) {
          return;
        }
        if (editor.Caret === text) {
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        node.Type = ast.NodeEmphasis;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.Strong:
      case atom.B: {
        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, zwspNewlineTokens));
        }
        const text = strings.TrimSpace(util.DomText(n));
        if (lute.isEmptyText(n)) {
          return;
        }
        if (editor.Caret === text) {
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        node.Type = ast.NodeStrong;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
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
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, zwspNewlineTokens));
        }
        const text = strings.TrimSpace(util.DomText(n));
        if (lute.isEmptyText(n)) {
          return;
        }
        if (editor.Caret === text) {
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        node.Type = ast.NodeStrikethrough;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.Mark: {
        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, zwspNewlineTokens));
        }
        const text = strings.TrimSpace(util.DomText(n));
        if (lute.isEmptyText(n)) {
          return;
        }
        if (editor.Caret === text) {
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        node.Type = ast.NodeMark;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.Code: {
        if (null === n.FirstChild) {
          return;
        }
        const contentStr = strings.ReplaceAll(n.FirstChild.Data, editor.Zwsp, "");
        if (editor.Caret === contentStr) {
          node.Tokens = editor.CaretTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        if ("" === contentStr) {
          return;
        }
        const codeTokens = conv.BytesFromString(contentStr);
        const contentNode = new ast.Node(ast.NodeCodeSpanContent, codeTokens); // PORT-NOTE: Go shadows content here
        node.Type = ast.NodeCodeSpan;
        node.AppendChild(contentNode);
        tree.Context!.Tip!.AppendChild(node);
        return;
      }
      case atom.Br: {
        if (null !== n.Parent) {
          if (lute.parentIs(n, atom.Td, atom.Th)) {
            if ((null === n.PrevSibling || editor.Caret === n.PrevSibling.Data) && (null === n.NextSibling || editor.Caret === n.NextSibling.Data)) {
              return;
            }
            if (null === n.NextSibling) {
              return; // Remove the trailing br in the table
            }

            node.Type = ast.NodeInlineHTML;
            node.Tokens = brTokens;
            tree.Context!.Tip!.AppendChild(node);
            return;
          }
          if (atom.P === n.Parent.DataAtom) {
            if (null !== n.Parent.NextSibling && (atom.Ul === n.Parent.NextSibling.DataAtom || atom.Ol === n.Parent.NextSibling.DataAtom || atom.Blockquote === n.Parent.NextSibling.DataAtom)) {
              tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, zwspTokens));
              return;
            }
          }
        }

        node.Type = ast.NodeHardBreak;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.A:
        node.Type = ast.NodeLink;
        node.AppendChild(new ast.Node(ast.NodeOpenBracket));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      case atom.Img: {
        const imgClass = cls;
        const imgAlt = util.DomAttrValue(n, "alt");
        if ("emoji" === imgClass) {
          node.Type = ast.NodeEmoji;
          const emojiImg = new ast.Node(ast.NodeEmojiImg, tree.EmojiImgTokens(imgAlt, util.DomAttrValue(n, "src")));
          emojiImg.AppendChild(new ast.Node(ast.NodeEmojiAlias, conv.BytesFromString(":" + imgAlt + ":")));
          node.AppendChild(emojiImg);
          tree.Context!.Tip!.AppendChild(node);
          tree.Context!.Tip = node;
          deferred.push(() => tree.Context!.ParentTip());
        } else {
          return;
        }
        break;
      }
      case atom.Input:
        if (null === n.Parent || null === n.Parent.Parent || (atom.P !== n.Parent.DataAtom && atom.Li !== n.Parent.DataAtom)) {
          // Only allow input in task lists
          return;
        }
        if (null !== n.NextSibling && atom.Span === n.NextSibling.DataAtom) {
          // Backspace before the task list marker
          n.NextSibling.FirstChild!.Data = strings.TrimSpace(n.NextSibling.FirstChild!.Data);
          break;
        }
        node.Type = ast.NodeTaskListItemMarker;
        node.ReviveFromDataTask(util.DomAttrValue(n, "data-task"), lute.hasAttr(n, "checked"));
        tree.Context!.Tip!.AppendChild(node);
        if (null !== node.Parent!.Parent!.Parent && null !== node.Parent!.Parent!.Parent.ListData) { // ul.li.p.input
          node.Parent!.Parent!.Parent.ListData.Typ = 3;
        }
        break;
      case atom.Table: {
        node.Type = ast.NodeTable;
        const tableAligns: number[] = [];
        if (null === n.FirstChild || null === n.FirstChild.FirstChild || null === n.FirstChild.FirstChild.FirstChild) {
          return;
        }

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
        node.TableAligns = tableAligns;
        node.Tokens = null;
        tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeParagraph)); // Typing at the start of a table causes parsing problems, so an empty paragraph is inserted as a separator
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.Thead:
        node.Type = ast.NodeTableHead;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      case atom.Tbody:
        break;
      case atom.Tr:
        node.Type = ast.NodeTableRow;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      case atom.Th:
      case atom.Td: {
        node.Type = ast.NodeTableCell;
        const align = util.DomAttrValue(n, "align");
        let tableAlign: number;
        switch (align) {
          case "left":
            tableAlign = 1;
            break;
          case "center":
            tableAlign = 2;
            break;
          case "right":
            tableAlign = 3;
            break;
          default:
            tableAlign = 0;
        }
        node.TableCellAlign = tableAlign;
        node.Tokens = null;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferred.push(() => tree.Context!.ParentTip());
        break;
      }
      case atom.Sup:
        if (null === n.FirstChild) {
          break;
        }
        if ("footnotes-ref" === dataType) {
          node.Type = ast.NodeText;
          node.Tokens = conv.BytesFromString(util.DomText(n));
          tree.Context!.Tip!.AppendChild(node);
        }
        return;
      case atom.Span: {
        switch (dataType) {
          case "inline-node":
          case "em":
          case "strong":
          case "s":
          case "sup":
          case "sub":
          case "a":
          case "link-ref":
          case "img":
          case "code":
          case "heading-id":
          case "html-inline":
          case "inline-math":
          case "html-entity":
            node.Type = ast.NodeText;
            node.Tokens = conv.BytesFromString(util.DomText(n));
            tree.Context!.Tip!.AppendChild(node);
            return;
          case "math-block-close-marker":
            tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeMathBlockCloseMarker, parse.MathBlockMarker));
            deferred.push(() => tree.Context!.ParentTip());
            return;
          case "math-block-open-marker":
            node.Type = ast.NodeMathBlock;
            node.AppendChild(new ast.Node(ast.NodeMathBlockOpenMarker, parse.MathBlockMarker));
            tree.Context!.Tip!.AppendChild(node);
            tree.Context!.Tip = node;
            return;
          case "yaml-front-matter-close-marker":
            tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeYamlFrontMatterCloseMarker, parse.YamlFrontMatterMarker));
            deferred.push(() => tree.Context!.ParentTip());
            return;
          case "yaml-front-matter-open-marker":
            node.Type = ast.NodeYamlFrontMatter;
            node.AppendChild(new ast.Node(ast.NodeYamlFrontMatterOpenMarker, parse.YamlFrontMatterMarker));
            tree.Context!.Tip!.AppendChild(node);
            tree.Context!.Tip = node;
            return;
          case "code-block-open-marker": {
            // UPSTREAM-BUG: a code-block-open-marker span without a next sibling is a nil pointer dereference (vditor_ir.go, case "code-block-open-marker")
            if (atom.Pre === n.NextSibling!.DataAtom) { // The info span node is missing after the DOM
              const infoSpan = new html.Node();
              infoSpan.DataAtom = atom.Span;
              const infoAttr = new html.Attribute();
              infoAttr.Key = "data-type";
              infoAttr.Val = "code-block-info";
              infoSpan.Attr = [infoAttr];
              n.InsertAfter(infoSpan);
            }
            let marker: Uint8Array = conv.BytesFromString(util.DomText(n));
            const lastBacktick = bytes.LastIndex(marker, backtickTokens) + 1;
            if (0 < lastBacktick) {
              // Move the characters after ` to the info node
              const rest = new html.Node();
              rest.Data = conv.StringFromBytes(marker.subarray(lastBacktick));
              n.NextSibling!.AppendChild(rest);
              marker = marker.subarray(0, lastBacktick);
            }
            node.Type = ast.NodeCodeBlock;
            node.IsFencedCodeBlock = true;
            const openMarker = new ast.Node(ast.NodeCodeBlockFenceOpenMarker, marker);
            openMarker.CodeBlockFenceLen = marker.length;
            node.AppendChild(openMarker);
            tree.Context!.Tip!.AppendChild(node);
            tree.Context!.Tip = node;
            return;
          }
          case "code-block-info": {
            let info: Uint8Array = conv.BytesFromString(util.DomText(n));
            info = bytes.ReplaceAll(info, zwspTokens, new Uint8Array(0));
            const infoMarker = new ast.Node(ast.NodeCodeBlockFenceInfoMarker);
            infoMarker.CodeBlockInfo = info;
            tree.Context!.Tip!.AppendChild(infoMarker);
            return;
          }
          case "code-block-close-marker": {
            let marker: Uint8Array = conv.BytesFromString(util.DomText(n));
            const lastBacktick = bytes.LastIndex(marker, backtickTokens) + 1;
            if (0 < lastBacktick) {
              marker = marker.subarray(0, lastBacktick);
            }
            if (0 === marker.length) {
              marker = conv.BytesFromString("```");
            }
            const closeMarker = new ast.Node(ast.NodeCodeBlockFenceCloseMarker, marker);
            closeMarker.CodeBlockFenceLen = marker.length;
            tree.Context!.Tip!.AppendChild(closeMarker);
            deferred.push(() => tree.Context!.ParentTip());
            return;
          }
          case "heading-marker": {
            let text = util.DomText(n);
            const caretInMarker = strings.Contains(text, editor.Caret);
            if (caretInMarker) {
              const caret = new html.Node();
              caret.Type = html.TextNode;
              caret.Data = editor.Caret;
              n.InsertAfter(caret);
              text = strings.ReplaceAll(text, "#", "");
              text = strings.ReplaceAll(text, editor.Caret, "");
              text = strings.TrimSpace(text);
              if (0 < text.length) {
                caret.Data = text + caret.Data;
              }
            }
            return;
          }
        }

        if (null === n.FirstChild) {
          break;
        }

        let codeTokens: Uint8Array | null = null;
        if (editor.Zwsp === n.FirstChild.Data && "" === util.DomAttrValue(n, "style") && null !== n.FirstChild.NextSibling) {
          codeTokens = conv.BytesFromString(n.FirstChild.NextSibling.FirstChild!.Data);
        } else if (atom.Code === n.FirstChild.DataAtom) {
          codeTokens = conv.BytesFromString(n.FirstChild.FirstChild!.Data);
          if (editor.Zwsp === conv.StringFromBytes(codeTokens)) {
            break;
          }
        } else {
          break;
        }
        if ("math-inline" === dataType) {
          node.Type = ast.NodeInlineMath;
          node.AppendChild(new ast.Node(ast.NodeInlineMathOpenMarker));
          node.AppendChild(new ast.Node(ast.NodeInlineMathContent, codeTokens));
          node.AppendChild(new ast.Node(ast.NodeInlineMathCloseMarker));
          tree.Context!.Tip!.AppendChild(node);
        } else if ("html-inline" === dataType) {
          node.Type = ast.NodeInlineHTML;
          node.Tokens = codeTokens;
          tree.Context!.Tip!.AppendChild(node);
        } else if ("code-inline" === dataType) {
          node.Tokens = codeTokens;
          tree.Context!.Tip!.AppendChild(node);
        } else if ("html-entity" === dataType) {
          node.Type = ast.NodeText;
          node.Tokens = codeTokens;
          tree.Context!.Tip!.AppendChild(node);
        }
        return;
      }
      case atom.Font:
        node.Type = ast.NodeText;
        node.Tokens = conv.BytesFromString(util.DomText(n));
        tree.Context!.Tip!.AppendChild(node);
        return;
      case atom.Details:
        node.Type = ast.NodeHTMLBlock;
        node.Tokens = util.DomHTML(n);
        node.Tokens = bytes.SplitAfter(node.Tokens, summaryCloseTokens)[0];
        tree.Context!.Tip!.AppendChild(node);
        break;
      case atom.Kbd:
        // The kbd tag builds its node from the code tag
        break;
      case atom.Summary:
        return;
      default:
        node.Type = ast.NodeHTMLBlock;
        node.Tokens = util.DomHTML(n);
        tree.Context!.Tip!.AppendChild(node);
        return;
    }

    for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
      lute.genASTByVditorIRDOM(c, tree);
    }

    switch (n.DataAtom) {
      case atom.A: {
        node.AppendChild(new ast.Node(ast.NodeCloseBracket));
        node.AppendChild(new ast.Node(ast.NodeOpenParen));
        const href = lute.trimLinkPath(util.DomAttrValue(n, "href"));
        node.AppendChild(new ast.Node(ast.NodeLinkDest, conv.BytesFromString(href)));
        const linkTitle = util.DomAttrValue(n, "title");
        if ("" !== linkTitle) {
          node.AppendChild(new ast.Node(ast.NodeLinkSpace));
          node.AppendChild(new ast.Node(ast.NodeLinkTitle, conv.BytesFromString(linkTitle)));
        }
        node.AppendChild(new ast.Node(ast.NodeCloseParen));
        break;
      }
      case atom.Details:
        tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeHTMLBlock, detailsCloseTokens));
        break;
    }
  } finally {
    for (let i = deferred.length - 1; i >= 0; i--) {
      deferred[i]();
    }
  }
};
