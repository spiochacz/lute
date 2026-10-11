// Ported from vditor_wysiwyg.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: methods of other root files that this file calls, with the signatures assumed here:
//   lute.HTML2Markdown(htmlStr: string): [string, Error | null]   (h2m.go)
//   lute.HTMLNode2Tree(n: html.Node): parse.Tree | null            (h2m.go)

import * as bytes from "./runtime/bytes.ts";
import * as conv from "./runtime/conv.ts";
import * as slices from "./runtime/slices.ts";
import * as strconv from "./runtime/strconv.ts";
import * as strings from "./runtime/strings.ts";
import * as utf8 from "./runtime/utf8.ts";
import * as ast from "./ast/index.ts";
import * as editor from "./editor/index.ts";
import * as html from "./html/index.ts";
import * as atom from "./html/atom/index.ts";
import * as parse from "./parse/index.ts";
import * as render from "./render/index.ts";
import * as util from "./util/index.ts";
import { FormatNodeSync } from "./lute.ts";
import { Lute } from "./types.ts";

declare module "./types.ts" {
  interface Lute {
    Md2HTML(markdown: string): string;
    SpinVditorDOM(ivHTML: string): string;
    HTML2VditorDOM(sHTML: string): string;
    VditorDOM2HTML(vhtml: string): string;
    Md2VditorDOM(markdown: string): string;
    VditorDOM2Md(htmlStr: string): string;
    RenderEChartsJSON(markdown: string): string;
    RenderKityMinderJSON(markdown: string): string;
    HTML2Md(htmlStr: string): string;
    vditorDOM2Md(htmlStr: string): string;
    adjustVditorDOM(root: html.Node): void;
    adjustBlockInTable(n: html.Node): void;
    adjustTag(n: html.Node): void;
    adjustNoscriptImg(n: html.Node): void;
    adjustMath(n: html.Node): void;
    adjustTableCode(n: html.Node): void;
    mergeSameStrong(n: html.Node): void;
    adjustVditorDOMListList(n: html.Node): void;
    removeHighlightJSSpans(node: html.Node): void;
    hljsSpans(n: html.Node, spans: html.Node[]): void;
    removeEmptyNodes(node: html.Node): void;
    searchEmptyNodes(n: html.Node, emptyNodes: html.Node[]): void;
    removeWbr(n: html.Node): void;
    searchWbr(n: html.Node, wbrNodes: html.Node[]): void;
    mergeVditorDOMList0(n: html.Node): void;
    adjustVditorDOMListTight0(n: html.Node): void;
    adjustVditorDOMListItemInP(n: html.Node): void;
    removeCodeCode(n: html.Node): void;
    adjustVditorDOMCodeA(n: html.Node): void;
    forwardNextBlock(spanNode: html.Node): [html.Node[], html.Node | null];
    listItemEnter(li: html.Node): boolean;
    isTightList(list: html.Node): string;
    genASTByVditorDOM(n: html.Node, tree: parse.Tree): void;
    hasAttr(n: html.Node, attrName: string): boolean;
    domParent(n: html.Node | null, dataAtom: atom.Atom): html.Node | null;
    domChild(n: html.Node | null, dataAtom: atom.Atom): html.Node | null;
    domChild0(n: html.Node, dataAtom: atom.Atom): html.Node | null;
    setDOMAttrValue(n: html.Node | null, attrName: string, attrVal: string): void;
    removeDOMAttr(n: html.Node | null, attrName: string): void;
    domCode(n: html.Node | null): string;
    domCode0(n: html.Node | null, buffer: bytes.Buffer): void;
    parentIs(n: html.Node, ...parentTypes: atom.Atom[]): boolean;
    getParent(n: html.Node, parentType: atom.Atom): html.Node | null;
    isCaret(n: html.Node): [boolean, boolean];
    isEmptyText(n: html.Node): boolean;
    startsWithNewline(n: html.Node): boolean;
    isInline(n: html.Node | null): boolean;
    prefixSpaces(text: string): string;
    suffixSpaces(text: string): string;
  }
}

// PORT-NOTE: stands for the Go literals &html.Node{Type: t, DataAtom: a, Data: d}.
function newHTMLNode(type: html.NodeType, dataAtom: atom.Atom, data: string): html.Node {
  const ret = new html.Node();
  ret.Type = type;
  ret.DataAtom = dataAtom;
  ret.Data = data;
  return ret;
}

const emptyBytes: Uint8Array = new Uint8Array(0);

// Md2HTML converts markdown to standard HTML, used by the source-code mode preview.
Lute.prototype.Md2HTML = function (this: Lute, markdown: string): string {
  const lute = this;
  let sHTML = "";
  sHTML = lute.MarkdownStr("", markdown);
  return sHTML;
};

// SpinVditorDOM spins the Vditor DOM, used for editing in WYSIWYG mode.
Lute.prototype.SpinVditorDOM = function (this: Lute, ivHTML: string): string {
  const lute = this;
  let ovHTML = "";
  ivHTML = strings.ReplaceAll(ivHTML, editor.FrontEndCaret, editor.Caret);
  const markdown = lute.vditorDOM2Md(ivHTML);
  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewVditorRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  const output = renderer.Render();
  ovHTML = strings.ReplaceAll(conv.StringFromBytes(output), editor.Caret, editor.FrontEndCaret);
  return ovHTML;
};

// HTML2VditorDOM converts HTML to Vditor DOM, used for pasting in WYSIWYG mode.
Lute.prototype.HTML2VditorDOM = function (this: Lute, sHTML: string): string {
  const lute = this;
  let vHTML = "";
  const [markdown, err] = lute.HTML2Markdown(sHTML);
  if (null !== err) {
    vHTML = err.message;
    return vHTML;
  }

  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewVditorRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.HTML2VditorDOMRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const output = renderer.Render();
  vHTML = conv.StringFromBytes(output);
  return vHTML;
};

// VditorDOM2HTML converts Vditor DOM to HTML, used by the Vditor.getHTML() interface.
Lute.prototype.VditorDOM2HTML = function (this: Lute, vhtml: string): string {
  const lute = this;
  let sHTML = "";
  const markdown = lute.vditorDOM2Md(vhtml);
  sHTML = lute.Md2HTML(markdown);
  return sHTML;
};

// Md2VditorDOM converts markdown to Vditor DOM, used when switching from source-code mode to WYSIWYG mode.
Lute.prototype.Md2VditorDOM = function (this: Lute, markdown: string): string {
  const lute = this;
  let vHTML = "";
  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewVditorRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.Md2VditorDOMRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const output = renderer.Render();
  vHTML = conv.StringFromBytes(output);
  return vHTML;
};

// VditorDOM2Md converts Vditor DOM to markdown, used when switching from WYSIWYG mode to source-code mode.
Lute.prototype.VditorDOM2Md = function (this: Lute, htmlStr: string): string {
  const lute = this;
  let markdown = "";
  htmlStr = strings.ReplaceAll(htmlStr, editor.Zwsp, "");
  markdown = lute.vditorDOM2Md(htmlStr);
  markdown = strings.ReplaceAll(markdown, editor.Zwsp, "");
  return markdown;
};

// RenderEChartsJSON renders ECharts JSON data.
Lute.prototype.RenderEChartsJSON = function (this: Lute, markdown: string): string {
  const lute = this;
  let json = "";
  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewEChartsJSONRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  const output = renderer.Render();
  json = conv.StringFromBytes(output);
  return json;
};

// RenderKityMinderJSON renders KityMinder JSON data.
Lute.prototype.RenderKityMinderJSON = function (this: Lute, markdown: string): string {
  const lute = this;
  let json = "";
  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewKityMinderJSONRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  const output = renderer.Render();
  json = conv.StringFromBytes(output);
  return json;
};

// HTML2Md converts HTML to markdown.
// PORT-NOTE: Go's parameter is named html, which would shadow the html package here.
Lute.prototype.HTML2Md = function (this: Lute, htmlStr: string): string {
  const lute = this;
  let [markdown, err] = lute.HTML2Markdown(htmlStr);
  if (null !== err) {
    markdown = err.message;
    return markdown;
  }
  return markdown;
};

// vditorDOM2MdPrepare is the first stage of vditorDOM2Md: it removes the caret, normalises the trailing white space, parses the string into a DOM tree
// and adjusts the DOM. It returns null where vditorDOM2Md returns its empty result before any rendering.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the stages of vditorDOM2Md are functions of their own, so that the
// recording renderer (render/recording_format_renderer.ts) runs the same stages; they are exported for tests and are not methods of Lute.
export function vditorDOM2MdPrepare(lute: Lute, htmlStr: string): html.Node | null {
  // Remove the caret
  htmlStr = strings.ReplaceAll(htmlStr, editor.FrontEndCaret, "");

  // Replace trailing white space, otherwise the HTML parse produces redundant nodes that lead to an empty code block
  htmlStr = strings.ReplaceAll(htmlStr, "\t\n", "\n");
  htmlStr = strings.ReplaceAll(htmlStr, "    \n", "  \n");

  // Parse the string into a DOM tree
  const htmlRoot = util.ParseHTML(htmlStr);
  if (null === htmlRoot) {
    return null;
  }

  // Adjust the DOM structure
  lute.adjustVditorDOM(htmlRoot);

  return htmlRoot;
}

// vditorDOM2MdBuildTree is the second stage of vditorDOM2Md: it converts the adjusted DOM tree into a Markdown syntax tree and adjusts the tree.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: see vditorDOM2MdPrepare.
export function vditorDOM2MdBuildTree(lute: Lute, htmlRoot: html.Node): parse.Tree {
  // Convert the HTML tree into a Markdown AST
  const tree = new parse.Tree();
  tree.Name = "";
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.Context = new parse.Context(lute.ParseOptions);
  tree.Context.Tip = tree.Root;
  for (let c = htmlRoot.FirstChild; null !== c; c = c.NextSibling) {
    lute.genASTByVditorDOM(c, tree);
  }

  // Adjust the tree structure
  ast.Walk(tree.Root, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering) {
      switch (n.Type) {
        case ast.NodeInlineHTML:
        case ast.NodeCodeSpan:
        case ast.NodeInlineMath:
        case ast.NodeHTMLBlock:
        case ast.NodeCodeBlockCode:
        case ast.NodeMathBlockContent:
          // PORT-NOTE: html.UnescapeHTML never returns nil; Go passes a possibly nil Tokens.
          n.Tokens = html.UnescapeHTML(n.Tokens ?? emptyBytes);
          if (null !== n.Next && ast.NodeCodeSpan === n.Next.Type && n.CodeMarkerLen === n.Next.CodeMarkerLen) {
            // Merge code nodes https://github.com/Vanessa219/vditor/issues/167
            n.FirstChild!.Next!.Tokens = slices.Append(n.FirstChild!.Next!.Tokens!, n.Next.FirstChild!.Next!.Tokens!);
            n.Next.Unlink();
          }
          break;
        case ast.NodeList:
          // The sub-list generated by the browser is in the ul.ul form, adjust it to ul.li.ul
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

  return tree;
}

// vditorDOM2MdRenderOptions returns the options of the Markdown formatter that vditorDOM2Md renders with.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: see vditorDOM2MdPrepare.
export function vditorDOM2MdRenderOptions(): render.Options {
  const options = render.NewOptions();
  options.AutoSpace = false;
  options.FixTermTypo = false;
  return options;
}

// vditorDOM2MdRender is the render stage of vditorDOM2Md: the Markdown formatter renders the tree.
// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: see vditorDOM2MdPrepare.
export function vditorDOM2MdRender(lute: Lute, tree: parse.Tree): Uint8Array {
  const renderer = render.NewFormatRenderer(tree, vditorDOM2MdRenderOptions(), lute.ParseOptions);
  return renderer.Render();
}

Lute.prototype.vditorDOM2Md = function (this: Lute, htmlStr: string): string {
  const lute = this;
  let markdown = "";
  const htmlRoot = vditorDOM2MdPrepare(lute, htmlStr);
  if (null === htmlRoot) {
    return markdown;
  }
  const tree = vditorDOM2MdBuildTree(lute, htmlRoot);
  // Render the AST as formatted Markdown
  const formatted = vditorDOM2MdRender(lute, tree);
  markdown = conv.StringFromBytes(formatted);
  return markdown;
};

Lute.prototype.adjustVditorDOM = function (this: Lute, root: html.Node): void {
  const lute = this;
  lute.removeEmptyNodes(root);
  lute.removeHighlightJSSpans(root);

  // PORT-NOTE: perf, departs from vditor_wysiwyg.go:179-181: one call instead of a loop over the siblings.
  // removeWbr(c) already collects the matching wbr nodes of c and of all its following siblings (and their
  // descendants) and only then unlinks them; a later call would only walk the same nodes again and find
  // nothing, and the loop ends after a matching FirstChild anyway because Unlink clears NextSibling.
  // So a single call on root.FirstChild unlinks exactly the same nodes.
  if (null !== root.FirstChild) {
    lute.removeWbr(root.FirstChild);
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.mergeVditorDOMList0(c);
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustVditorDOMListTight0(c);
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustVditorDOMListList(c);
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustVditorDOMListItemInP(c);
  }

  for (let c = root.FirstChild; null !== c;) {
    const next = c.NextSibling;
    lute.removeCodeCode(c);
    c = next;
  }

  for (let c = root.FirstChild; null !== c;) {
    const next = c.NextSibling;
    lute.adjustVditorDOMCodeA(c);
    c = next;
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustTag(c);
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.mergeSameStrong(c);
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustTableCode(c);
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustMath(c);
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustNoscriptImg(c);
  }

  for (let c = root.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustBlockInTable(c);
  }
};

Lute.prototype.adjustBlockInTable = function (this: Lute, n: html.Node): void {
  const lute = this;
  if (lute.parentIs(n, atom.Td) || lute.parentIs(n, atom.Th)) {
    if (n.DataAtom === atom.Ul || n.DataAtom === atom.Ol) {
      const div = newHTMLNode(html.ElementNode, atom.Div, "");
      const text = newHTMLNode(html.TextNode, 0, "");
      n.InsertBefore(text);
      n.Unlink();
      div.AppendChild(n);
      const tree = lute.HTMLNode2Tree(n);
      if (null !== tree) {
        const [md] = FormatNodeSync(tree.Root!, lute.ParseOptions, lute.RenderOptions);
        text.Data = strings.ReplaceAll(md, "\n", "<br />");
      }
    }
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustBlockInTable(c);
  }
};

Lute.prototype.adjustTag = function (this: Lute, n: html.Node): void {
  const lute = this;
  if ((atom.Div === n.DataAtom && "NodeCodeBlock" === util.DomAttrValue(n, "data-type")) ||
    (atom.Span === n.DataAtom && "code" === util.DomAttrValue(n, "data-type"))) {
    return;
  }

  if (html.ElementNode === n.Type && 0 === n.DataAtom) {
    // Convert some custom tags to standard tags
    if ("ucapcontent" === n.Data) {
      n.DataAtom = atom.Div;
    } else if ("ucaptitle" === n.Data) {
      n.DataAtom = atom.H2;
      n.Data = "h2";
    } else if ("markerow8" === n.Data) {
      n.DataAtom = atom.Span;
    } else if ("app-document-text" === n.Data) {
      n.DataAtom = atom.Div;
    } else if ("ms-cmark-node" === n.Data) {
      n.DataAtom = atom.Span;
    }
  } else if (html.TextNode === n.Type && 0 === n.DataAtom && !lute.parentIs(n, atom.Table)) {
    if (lute.ParseOptions.ProtyleWYSIWYG) {
      // Convert <br> in text nodes outside tables to \n https://github.com/siyuan-note/siyuan/issues/15373
      n.Data = strings.ReplaceAll(n.Data, "<br>", "\n");
      n.Data = strings.ReplaceAll(n.Data, "<br/>", "\n");
      n.Data = strings.ReplaceAll(n.Data, "<br />", "\n");
    }
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustTag(c);
  }
};

Lute.prototype.adjustNoscriptImg = function (this: Lute, n: html.Node): void {
  const lute = this;
  if (null !== n.Parent && atom.Figure === n.Parent.DataAtom &&
    atom.Noscript === n.DataAtom && null !== n.FirstChild && strings.HasPrefix(n.FirstChild.Data, "<img ")) {
    let img = n.FirstChild;
    img.Unlink();
    img.DataAtom = atom.Img;
    const [fragment, err] = html.ParseFragment(conv.BytesFromString(img.Data), newHTMLNode(html.ElementNode, 0, ""));
    if (null !== err || 1 > fragment.length) {
      return;
    }
    img = fragment[0];
    n.InsertBefore(img);
    const unlinks: html.Node[] = [];
    for (let c: html.Node | null = n; null !== c; c = c.NextSibling) {
      if (atom.Figcaption === c.DataAtom) {
        continue;
      }
      unlinks.push(c);
    }
    for (const unlink of unlinks) {
      unlink.Unlink();
    }
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustNoscriptImg(c);
  }
};

Lute.prototype.adjustMath = function (this: Lute, n: html.Node): void {
  const lute = this;
  const cls = util.DomAttrValue(n, "class");
  if (strings.Contains(cls, "katex--display") || strings.Contains(cls, "katex--inline")) {
    const span = util.DomChildByTypeAndClass(n, atom.Span, "katex-mathml");
    if (null !== span) {
      let tex = util.DomText(span.FirstChild);
      if ("" !== tex) {
        tex = strings.TrimSpace(tex);
        while (strings.Contains(tex, "\n ")) {
          tex = strings.ReplaceAll(tex, "\n ", "\n");
        }

        const idx = strings.LastIndex(tex, "\n\n\n\n");
        if (0 < idx) {
          // Split the formula content by the last 4 newlines, to adapt to CSDN formula clipping
          tex = tex.slice(idx + 4);
        }

        tex = strings.TrimSpace(tex);
        util.SetDomAttrValue(n, "data-tex", tex);
      }
    }
  }

  if (((atom.Span === n.DataAtom || atom.Div === n.DataAtom) && strings.Contains(cls, "mwe-math-element")) || (strings.Contains(cls, "tex") && !strings.Contains(cls, "text"))) {
    const annos = util.DomChildrenByType(n, atom.Annotation);
    if (0 < annos.length) {
      const anno = annos[0];
      if ("application/x-tex" === util.DomAttrValue(anno, "encoding")) {
        util.SetDomAttrValue(n, "data-tex", util.DomText(anno));
        return;
      }
    }

    const imgs = util.DomChildrenByType(n, atom.Img);
    if (0 < imgs.length) {
      const img = imgs[0];
      const mathContent = util.DomAttrValue(img, "alt");
      if ("" !== mathContent) {
        util.SetDomAttrValue(n, "data-tex", mathContent);
        return;
      }
    }
  }

  if (atom.Img === n.DataAtom && strings.Contains(cls, "ma-tex-img")) {
    const mathContent = util.DomAttrValue(n, "alt");
    if ("" !== mathContent) {
      n.DataAtom = atom.Span;
      util.SetDomAttrValue(n, "data-tex", mathContent);
    }
    return;
  }

  const formula = util.DomAttrValue(n, "data-formula");
  if ("" !== formula) {
    if (null !== n.NextSibling && atom.Script === n.NextSibling.DataAtom && strings.Contains(util.DomAttrValue(n.NextSibling, "type"), "math/tex")) {
      n.NextSibling.Unlink();
    }
    if (html.ElementNode === n.Type && "mjx-container" === n.Data) {
      n.DataAtom = atom.Span;
    }

    util.SetDomAttrValue(n, "data-tex", formula);
    return;
  }

  if (strings.Contains(cls, "texhtml")) {
    const mathContent = util.DomTexhtml(n);
    if ("" !== mathContent) {
      util.SetDomAttrValue(n, "data-tex", mathContent);
      return;
    }
  }

  if (strings.Contains(cls, "math")) {
    const scripts = util.DomChildrenByType(n, atom.Script);
    if (0 < scripts.length) {
      const script = scripts[0];
      if ("math/tex" === util.DomAttrValue(script, "type")) {
        const mathContent = util.DomText(script);
        if ("" !== mathContent) {
          util.SetDomAttrValue(n, "data-tex", mathContent);
          return;
        }
      }
    }

    {
      const mathContent = util.DomAttrValue(n, "data-custom-copy-text");
      if ("" !== mathContent) {
        util.SetDomAttrValue(n, "data-tex", mathContent);
        return;
      }
    }

    {
      const mathContent = util.DomAttrValue(n, "data-math");
      if ("" !== mathContent) {
        util.SetDomAttrValue(n, "data-tex", mathContent);
        return;
      }
    }
  }

  if (strings.Fields(cls).includes("language-math")) {
    {
      const mathContent = util.DomAttrValue(n, "data-math");
      if ("" !== mathContent) {
        util.SetDomAttrValue(n, "data-tex", mathContent);
        return;
      }
    }

    {
      const mathContent = util.DomText(n);
      if ("" !== mathContent) {
        util.SetDomAttrValue(n, "data-tex", mathContent);
        return;
      }
    }
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustMath(c);
  }
};

Lute.prototype.adjustTableCode = function (this: Lute, n: html.Node): void {
  const lute = this;
  if (atom.Table === n.DataAtom) {
    // Preprocess table-type code blocks https://github.com/siyuan-note/siyuan/issues/11540
    // Remove <td class="gutter">
    // Change <div class="container"> under <td class="code"> to <pre>

    const tds = util.DomChildrenByType(n, atom.Td);
    const unlinks: html.Node[] = [];
    for (const td of tds) {
      const tdClass = util.DomAttrValue(td, "class");
      if (strings.Contains(tdClass, "gutter")) {
        unlinks.push(td);
        continue;
      }

      // Remove the line numbers in <span class="lnt"> https://github.com/siyuan-note/siyuan/issues/13242
      const spans = util.DomChildrenByType(td, atom.Span);
      let removed = false;
      for (const span of spans) {
        if ("lnt" === util.DomAttrValue(span, "class")) {
          removed = true;
          break;
        }
      }
      if (removed) {
        unlinks.push(td);
        continue;
      }

      if (strings.Contains(tdClass, "code")) {
        const c = td.FirstChild;
        if (null !== c && atom.Div === c.DataAtom) {
          c.DataAtom = atom.Pre;
          c.Data = "pre";
          let lang = util.DomAttrValue(n, "class");
          lang = strings.ReplaceAll(lang, "syntaxhighlighter", "");
          lang = strings.TrimSpace(lang);
          if ("" !== lang) {
            util.SetDomAttrValue(c, "class", lang);
          }
          for (let div = c.FirstChild; null !== div; div = div.NextSibling) {
            div.DataAtom = atom.Code;
            div.Data = "code";
          }
        }
      }
    }

    for (const unlink of unlinks) {
      unlink.Unlink();
    }
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    lute.adjustTableCode(c);
  }
};

Lute.prototype.mergeSameStrong = function (this: Lute, n: html.Node): void {
  const lute = this;
  for (let c = n.FirstChild; null !== c;) {
    let next = c.NextSibling;
    if (null !== next && atom.Strong === c.DataAtom && atom.Strong === next.DataAtom) {
      for (let cc = next.FirstChild; null !== cc;) {
        const nextChild = cc.NextSibling;
        cc.Unlink();
        c.AppendChild(cc);
        cc = nextChild;
      }
      next.Unlink();
      next = c.NextSibling;
    }
    c = next;
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    lute.mergeSameStrong(c);
  }
};

// adjustVditorDOMListList adjusts ul.ul to ul.li.ul.
Lute.prototype.adjustVditorDOMListList = function (this: Lute, n: html.Node): void {
  const lute = this;
  if (atom.Ul !== n.DataAtom && atom.Ol !== n.DataAtom && atom.Li !== n.DataAtom) {
    return;
  }

  if (atom.Li === n.DataAtom) {
    if (null !== n.FirstChild && atom.Br === n.FirstChild.DataAtom) {
      // Normalize the structure of li on newline, swap the positions of the ZWSP and <br>
      n.FirstChild.DataAtom = 0;
      n.FirstChild.Data = editor.Zwsp;
      const nextLi = n.NextSibling;
      if (null !== n.NextSibling && atom.Li === n.NextSibling.DataAtom) {
        const caret = nextLi!.FirstChild;
        if (null !== caret && editor.Caret + editor.Zwsp === caret.Data) {
          caret.Data = editor.Caret + "\n";
        }
      }
    }
  } else {
    if (null !== n.Parent && (atom.Ul === n.Parent.DataAtom || atom.Ol === n.Parent.DataAtom)) {
      const prevLi = n.PrevSibling;
      if (null !== prevLi) {
        n.Unlink();
        prevLi.AppendChild(n);
      }
    }
  }

  for (let c = n.FirstChild; c !== null;) {
    const next = c.NextSibling;
    lute.adjustVditorDOMListList(c);
    c = next;
  }
};

Lute.prototype.removeHighlightJSSpans = function (this: Lute, node: html.Node): void {
  const lute = this;
  const spans: html.Node[] = [];
  for (let c: html.Node | null = node; null !== c; c = c.NextSibling) {
    lute.hljsSpans(c, spans);
  }
  for (const span of spans) {
    span.Unlink();
  }
};

Lute.prototype.hljsSpans = function (this: Lute, n: html.Node, spans: html.Node[]): void {
  const lute = this;
  if (atom.Span === n.DataAtom && strings.HasPrefix(util.DomAttrValue(n, "class"), "hljs-")) {
    spans.push(n);
    const text = util.DomText(n);
    n.InsertBefore(newHTMLNode(html.TextNode, 0, text));
  }

  for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
    lute.hljsSpans(c, spans);
  }
};

Lute.prototype.removeEmptyNodes = function (this: Lute, node: html.Node): void {
  const lute = this;
  const emptyNodes: html.Node[] = [];
  for (let c: html.Node | null = node; null !== c; c = c.NextSibling) {
    lute.searchEmptyNodes(c, emptyNodes);
  }
  for (const emptyNode of emptyNodes) {
    emptyNode.Unlink();
  }
};

Lute.prototype.searchEmptyNodes = function (this: Lute, n: html.Node, emptyNodes: html.Node[]): void {
  const lute = this;
  switch (n.DataAtom) {
    case 0: {
      if (lute.isInline(n.PrevSibling) || lute.isInline(n.NextSibling) || lute.isInline(n.Parent)) {
        // Keep the blank if the previous or the next node is an inline node
        if (html.TextNode === n.Type && null !== n.PrevSibling && atom.Strong === n.PrevSibling.DataAtom) {
          // Remove the ZWSP if the previous node is a strong node https://github.com/siyuan-note/siyuan/issues/16896
          let data = strings.TrimPrefix(n.Data, editor.Zwsp);
          data = strings.TrimSuffix(data, editor.Zwsp);
          n.Data = data;
        }
        break;
      }

      if (html.TextNode === n.Type) {
        let data = strings.TrimLeft(n.Data, " ");
        data = strings.TrimRight(data, " ");
        while (strings.Contains(data, "\n\n")) {
          // The paragraph indented below the list in a browser clipping extension becomes a child block https://github.com/siyuan-note/siyuan/issues/6289
          data = strings.ReplaceAll(data, "\n\n", "");
        }
        if ("" === data) {
          emptyNodes.push(n);
          return;
        }
      }

      const parent = n.Parent;
      if (null !== parent && (atom.Ol === parent.DataAtom || atom.Ul === parent.DataAtom || atom.Li === parent.DataAtom)) {
        if (null === n.NextSibling || (html.TextNode === n.NextSibling.Type || atom.Ul === n.NextSibling.DataAtom) || "" === strings.TrimSpace(n.Data)) {
          n.Data = strings.TrimRight(n.Data, "\n\t ");
        }
      }
      if (null !== parent && (atom.Table === parent.DataAtom || atom.Thead === parent.DataAtom || atom.Tbody === parent.DataAtom || atom.Tr === parent.DataAtom)) {
        n.Data = strings.TrimSpace(n.Data);
      }

      if ("" === n.Data) {
        emptyNodes.push(n);
      }

      if (html.CommentNode === n.Type) {
        emptyNodes.push(n);
      }
      break;
    }
    case atom.Span: {
      const lc = n.LastChild;
      if (null !== lc && atom.Br === lc.DataAtom) {
        // If the last child of the inline mark node is <br>, move the <br> after the inline mark node
        // Multiple consecutive hyperlinks in a table cannot wrap https://github.com/siyuan-note/siyuan/issues/5966
        n.InsertAfter(lc);
      }

      if (util.IsTempMarkSpan(n)) {
        // Promote the nodes nested in the temporary mark before the temporary mark node
        emptyNodes.push(n);
        const children: html.Node[] = [];
        for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
          children.push(c);
        }
        for (const c of children) {
          n.InsertBefore(c);
        }
        return;
      }
      break;
    }
    case atom.Strong:
    case atom.B:
    case atom.Em:
    case atom.I:
    case atom.Del:
    case atom.S:
    case atom.Strike:
    case atom.Mark: {
      if (null !== n.FirstChild) {
        if (atom.Br === n.FirstChild.DataAtom) {
          emptyNodes.push(n.FirstChild);
          n.InsertBefore(newHTMLNode(html.ElementNode, atom.Br, "br"));
        }
        if (html.TextNode === n.FirstChild.Type) {
          const text = n.FirstChild.Data;
          const spaces = lute.prefixSpaces(text);
          if ("" !== spaces) {
            n.FirstChild.Data = editor.Zwsp + n.FirstChild.Data;
          }
        }
      }
      if (null !== n.LastChild) {
        if (atom.Br === n.LastChild.DataAtom) {
          emptyNodes.push(n.LastChild);
          n.InsertAfter(newHTMLNode(html.ElementNode, atom.Br, "br"));
        }
        if (html.TextNode === n.LastChild.Type) {
          const text = n.LastChild.Data;
          const spaces = lute.suffixSpaces(text);
          if ("" !== spaces) {
            // UPSTREAM-BUG: appends the ZWSP to the first child, not to the last child that the check is about
            n.FirstChild!.Data = n.FirstChild!.Data + editor.Zwsp;
          }
        }
      }
      break;
    }
    default: {
      if ("katex" === util.DomAttrValue(n, "class")) {
        emptyNodes.push(n);
      }
    }
  }

  for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
    lute.searchEmptyNodes(c, emptyNodes);
  }

  switch (n.DataAtom) {
    case atom.Ol:
    case atom.Ul: {
      const dataType = util.DomAttrValue(n, "data-type");
      if ("footnotes-defs-ol" === dataType) {
        return;
      }
      if (null !== n.FirstChild && null !== n.FirstChild.FirstChild && atom.Input !== n.FirstChild.FirstChild.DataAtom) {
        return;
      }

      const text = util.DomText(n);
      if ("" === text) {
        emptyNodes.push(n);
      }
      break;
    }
  }
};

Lute.prototype.removeWbr = function (this: Lute, n: html.Node): void {
  const lute = this;
  const wbrNodes: html.Node[] = [];
  for (let c: html.Node | null = n; null !== c; c = c.NextSibling) {
    lute.searchWbr(c, wbrNodes);
  }
  for (const wbrNode of wbrNodes) {
    wbrNode.Unlink();
  }
};

Lute.prototype.searchWbr = function (this: Lute, n: html.Node, wbrNodes: html.Node[]): void {
  const lute = this;
  if (atom.Wbr === n.DataAtom) {
    const dataAttrs = util.DomAttrValuesWithPrefix(n, "data-v-");
    // PORT-NOTE: the length of a nil map is 0 in Go.
    if (null !== dataAttrs && 0 < dataAttrs.size) {
      wbrNodes.push(n);
    }
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    lute.searchWbr(c, wbrNodes);
  }
};

Lute.prototype.mergeVditorDOMList0 = function (this: Lute, n: html.Node): void {
  const lute = this;
  switch (n.DataAtom) {
    case atom.Ul:
    case atom.Ol:
      if (null !== n.NextSibling && n.DataAtom === n.NextSibling.DataAtom && 1 === n.NextSibling.Attr.length) {
        for (let c = n.NextSibling.FirstChild; null !== c;) {
          const next = c.NextSibling;
          c.Unlink();
          n.AppendChild(c);
          c = next;
        }
        n.NextSibling.Unlink();
      }
      break;
  }

  for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
    lute.mergeVditorDOMList0(c);
  }
};

Lute.prototype.adjustVditorDOMListTight0 = function (this: Lute, n: html.Node): void {
  const lute = this;
  switch (n.DataAtom) {
    case atom.Ul:
      if (!lute.parentIs(n, atom.Pre)) {
        lute.setDOMAttrValue(n, "data-tight", lute.isTightList(n));
      }
      break;
    case atom.Ol:
      if (!lute.parentIs(n, atom.Pre)) {
        lute.setDOMAttrValue(n, "data-tight", lute.isTightList(n));
      }
      break;
  }

  for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
    lute.adjustVditorDOMListTight0(c);
  }
};

Lute.prototype.adjustVditorDOMListItemInP = function (this: Lute, n: html.Node): void {
  const lute = this;
  switch (n.DataAtom) {
    case atom.Li: {
      // The li id is duplicated on newline, regenerate it
      if (null !== n.PrevSibling && util.DomAttrValue(n.PrevSibling, "data-node-id") === util.DomAttrValue(n, "data-node-id")) {
        lute.setDOMAttrValue(n, "data-node-id", ast.NewNodeID());
      }
      // A loose li duplicates the id of the last child of the previous li on newline
      if (null !== n.PrevSibling && null !== n.FirstChild) {
        const id = util.DomAttrValue(n.FirstChild, "data-node-id"); // An empty id means an inline node, the list item inline typesetting newline issue https://github.com/siyuan-note/siyuan/issues/379
        if ("" !== id && null !== n.PrevSibling.LastChild && util.DomAttrValue(n.PrevSibling.LastChild, "data-node-id") === id) {
          lute.setDOMAttrValue(n.FirstChild, "data-node-id", ast.NewNodeID());
        }
      }

      // Wrap every non-container block node under li with p
      for (let c: html.Node | null = n.FirstChild; null !== c; c = c.NextSibling) {
        if (lute.listItemEnter(n)) {
          const p = newHTMLNode(html.ElementNode, atom.P, "p");
          p.AppendChild(newHTMLNode(html.TextNode, 0, editor.Caret));
          p.AppendChild(newHTMLNode(html.ElementNode, atom.Br, "br"));
          n.FirstChild!.Unlink();
          n.FirstChild!.Unlink();
          n.AppendChild(p);
          c = p;
          continue;
        }

        if (atom.P !== c.DataAtom && atom.Blockquote !== c.DataAtom && atom.Ul !== c.DataAtom && atom.Ol !== c.DataAtom && atom.Div !== c.DataAtom && atom.Table !== c.DataAtom) {
          const [spans, nextBlock] = lute.forwardNextBlock(c);
          const p = newHTMLNode(html.ElementNode, atom.P, "p");
          c.InsertBefore(p);
          for (const span of spans) {
            span.Unlink();
            p.AppendChild(span);
          }
          c = nextBlock;
          if (null === c) {
            break;
          }
        }
      }
      break;
    }
  }

  for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
    lute.adjustVditorDOMListItemInP(c);
  }
};

Lute.prototype.removeCodeCode = function (this: Lute, n: html.Node): void {
  const lute = this;
  if (atom.Code === n.DataAtom && null !== n.FirstChild && atom.Code === n.FirstChild.DataAtom) {
    // code.code is nested repeatedly, do not process the outer code
    for (let c: html.Node | null = n.FirstChild; null !== c;) {
      const next: html.Node | null = c.NextSibling;
      c.Unlink();
      n.InsertBefore(c);
      c = next;
    }
    n.Unlink();
    return;
  }

  for (let c = n.FirstChild; c !== null;) {
    const next = c.NextSibling;
    lute.removeCodeCode(c);
    c = next;
  }
};

Lute.prototype.adjustVditorDOMCodeA = function (this: Lute, n: html.Node): void {
  const lute = this;
  // https://github.com/siyuan-note/siyuan/issues/11370
  if (atom.Code === n.DataAtom && null !== n.FirstChild && atom.A === n.FirstChild.DataAtom && n.FirstChild === n.LastChild) {
    // In the code.a case move a outside of code, that is a.code
    const prev = n.PrevSibling;
    const next = n.NextSibling;
    const parent = n.Parent;
    const a = n.FirstChild;
    a.Unlink();
    n.Unlink();

    const anchorTexts: html.Node[] = [];
    for (let c = a.FirstChild; null !== c; c = c.NextSibling) {
      anchorTexts.push(c);
      c.Unlink();
    }
    for (const anchorText of anchorTexts) {
      n.AppendChild(anchorText);
    }
    a.AppendChild(n);

    if (null !== prev) {
      prev.InsertAfter(a);
    } else if (null !== next) {
      next.InsertBefore(a);
    } else if (null !== parent) {
      parent.AppendChild(a);
    }
    return;
  }

  for (let c = n.FirstChild; c !== null;) {
    const next = c.NextSibling;
    lute.adjustVditorDOMCodeA(c);
    c = next;
  }
};

// forwardNextBlock moves forward to the next block-level node, that is, skips inline nodes.
Lute.prototype.forwardNextBlock = function (this: Lute, spanNode: html.Node): [html.Node[], html.Node | null] {
  const spans: html.Node[] = [];
  // PORT-NOTE: Go returns the named results; nextBlock is the zero value (nil) on every return path.
  const nextBlock: html.Node | null = null;
  for (let next: html.Node | null = spanNode; null !== next; next = next.NextSibling) {
    switch (next.DataAtom) {
      case atom.Ol:
      case atom.Ul:
      case atom.Div:
      case atom.Blockquote:
      case atom.Table:
        return [spans, nextBlock];
    }
    spans.push(next);
  }
  return [spans, nextBlock];
};

Lute.prototype.listItemEnter = function (this: Lute, li: html.Node): boolean {
  if (null === li.FirstChild) {
    return false;
  }
  if (editor.Caret === li.FirstChild.Data && "br" === li.LastChild!.Data) {
    return true;
  }
  return false;
};

Lute.prototype.isTightList = function (this: Lute, list: html.Node): string {
  for (let li = list.FirstChild; null !== li; li = li.NextSibling) {
    let subLists = 0;
    let subDivs = 0;
    let subBlockquotes = 0;
    let subParagraphs = 0;
    for (let c = li.FirstChild; null !== c; c = c.NextSibling) {
      switch (c.DataAtom) {
        case atom.Ul:
        case atom.Ol:
          subLists++;
          break;
        case atom.Div:
          subDivs++;
          break;
        case atom.Blockquote:
          subBlockquotes++;
          break;
        case atom.P:
          subParagraphs++;
          break;
      }
    }
    if (1 < subParagraphs || 1 < subBlockquotes || 1 < subDivs || 1 < subLists) {
      return "false";
    }

    if (1 < subParagraphs + subDivs || 1 < subParagraphs + subBlockquotes || 1 < subParagraphs + subLists) {
      return "false";
    }
  }
  return "true";
};

// genASTByVditorDOM traverses the specified Vditor DOM node n depth-first and builds the Markdown syntax tree tree step by step.
Lute.prototype.genASTByVditorDOM = function (this: Lute, n: html.Node, tree: parse.Tree): void {
  const lute = this;
  const dataRender = util.DomAttrValue(n, "data-render");
  if ("1" === dataRender || "2" === dataRender) { // 1: floating toolbar, 2: preview code block, math block
    return;
  }

  const dataType = util.DomAttrValue(n, "data-type");

  if (atom.Div === n.DataAtom) {
    if ("code-block" === dataType || "html-block" === dataType || "math-block" === dataType || "yaml-front-matter" === dataType) {
      for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
        lute.genASTByVditorDOM(c, tree);
      }
    } else if ("link-ref-defs-block" === dataType) {
      const text = util.DomText(n);
      const node = new ast.Node(ast.NodeText, conv.BytesFromString(text));
      tree.Context!.Tip!.AppendChild(node);
    } else if ("footnotes-block" === dataType) {
      const ol = n.FirstChild;
      if (atom.Ol !== ol!.DataAtom) {
        return;
      }

      for (let li = ol!.FirstChild; null !== li; li = li.NextSibling) {
        if ("\n" === li.Data) {
          continue;
        }

        const originalHTML = new bytes.Buffer();
        const err = html.Render(originalHTML, li);
        if (null === err) {
          let md = lute.vditorDOM2Md("<ol data-type=\"footnotes-defs-ol\">" + originalHTML.String() + "</ol>");
          const label = util.DomAttrValue(li, "data-marker");
          // PORT-NOTE: byte offset
          // UPSTREAM-BUG: md[3:] panics in Go when len(md) < 3 (for example for a <p> or text child of the footnotes <ol>); the GopherJS reference bundle evaluates s[low:] with low > len(s) to "" without a panic, and the port follows the bundle
          md = conv.StringFromBytes(conv.BytesFromString(md).subarray(3)); // Remove the list item marker 1.
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
          md = "[" + label + "]: " + md;
          const node = new ast.Node(ast.NodeText, conv.BytesFromString(md));
          tree.Context!.Tip!.AppendChild(node);
        } else {
          throw err;
        }
      }
    } else if ("toc-block" === dataType) {
      const node = new ast.Node(ast.NodeToC);
      tree.Context!.Tip!.AppendChild(node);
    }
    return;
  }

  // PORT-NOTE: stands for the `defer tree.Context.ParentTip()` statements of Go's switch cases; at most one of them is registered per call.
  let deferParentTip = false;
  try {
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
          const openMarker = new ast.Node(ast.NodeCodeBlockFenceOpenMarker, conv.BytesFromString("```"));
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
          const codeNode = new ast.Node(ast.NodeCodeBlockCode, conv.BytesFromString(content));
          node.AppendChild(codeNode);
          const closeMarker = new ast.Node(ast.NodeCodeBlockFenceCloseMarker, conv.BytesFromString("```"));
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
      case atom.Div:
        node.Type = ast.NodeParagraph;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      case atom.H1:
      case atom.H2:
      case atom.H3:
      case atom.H4:
      case atom.H5:
      case atom.H6: {
        if ("" === strings.TrimSpace(util.DomText(n))) {
          return;
        }
        node.Type = ast.NodeHeading;
        node.HeadingLevel = node.Tokens![1] - 0x30 /* 0 */;
        const marker = util.DomAttrValue(n, "data-marker");
        const id = util.DomAttrValue(n, "data-id");
        if ("" !== id) {
          n.LastChild!.InsertAfter(newHTMLNode(html.TextNode, 0, " {" + id + "}"));
        }
        node.HeadingSetext = "=" === marker || "-" === marker;
        if (!node.HeadingSetext) {
          const headingC8hMarker = new ast.Node(ast.NodeHeadingC8hMarker);
          headingC8hMarker.Tokens = conv.BytesFromString(strings.Repeat("#", node.HeadingLevel));
          node.AppendChild(headingC8hMarker);
        }
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Hr:
        node.Type = ast.NodeThematicBreak;
        tree.Context!.Tip!.AppendChild(node);
        break;
      case atom.Blockquote: {
        const bqContent = strings.TrimSpace(util.DomText(n));
        if ("" === bqContent || "&gt;" === bqContent || editor.Caret === bqContent) {
          return;
        }

        node.Type = ast.NodeBlockquote;
        node.AppendChild(new ast.Node(ast.NodeBlockquoteMarker, conv.BytesFromString(">")));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
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
        deferParentTip = true;
        break;
      }
      case atom.Li: {
        node.Type = ast.NodeListItem;
        let marker = util.DomAttrValue(n, "data-marker");
        let bullet = 0;
        // PORT-NOTE: byte offset; marker[0], marker[len-1] and firstLiMarker[len-1:] are bytes of the UTF-8 string, so they are taken from its bytes
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
              const firstLiMarkerBytes = conv.BytesFromString(firstLiMarker);
              marker += conv.StringFromBytes(firstLiMarkerBytes.subarray(firstLiMarkerBytes.length - 1));
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
          const markerBytes = conv.BytesFromString(marker);
          [node.ListData.Num] = strconv.Atoi(conv.StringFromRune(markerBytes[0]));
          node.ListData.Delimiter = markerBytes[markerBytes.length - 1];
        }

        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Pre: {
        if (atom.Code === n.FirstChild!.DataAtom) {
          let marker = util.DomAttrValue(n.Parent, "data-marker");
          if ("" === marker) {
            marker = "```";
          }

          let codeTokens: Uint8Array | null = null;
          if (null !== n.FirstChild!.FirstChild) {
            codeTokens = conv.BytesFromString(n.FirstChild!.FirstChild!.Data);
          }

          const divDataType = util.DomAttrValue(n.Parent, "data-type");
          switch (divDataType) {
            case "math-block":
              node.Type = ast.NodeMathBlock;
              node.AppendChild(new ast.Node(ast.NodeMathBlockOpenMarker));
              node.AppendChild(new ast.Node(ast.NodeMathBlockContent, codeTokens));
              node.AppendChild(new ast.Node(ast.NodeMathBlockCloseMarker));
              tree.Context!.Tip!.AppendChild(node);
              break;
            case "yaml-front-matter":
              node.Type = ast.NodeYamlFrontMatter;
              node.AppendChild(new ast.Node(ast.NodeYamlFrontMatterOpenMarker));
              node.AppendChild(new ast.Node(ast.NodeYamlFrontMatterContent, codeTokens));
              node.AppendChild(new ast.Node(ast.NodeYamlFrontMatterCloseMarker));
              tree.Context!.Tip!.AppendChild(node);
              break;
            case "html-block":
              node.Type = ast.NodeHTMLBlock;
              node.Tokens = codeTokens;
              tree.Context!.Tip!.AppendChild(node);
              break;
            default: {
              node.Type = ast.NodeCodeBlock;
              node.IsFencedCodeBlock = true;
              const openMarker = new ast.Node(ast.NodeCodeBlockFenceOpenMarker, conv.BytesFromString(marker));
              openMarker.CodeBlockFenceLen = conv.BytesFromString(marker).length;
              node.AppendChild(openMarker);
              node.AppendChild(new ast.Node(ast.NodeCodeBlockFenceInfoMarker));
              const codeClass = util.DomAttrValue(n.FirstChild, "class");
              if (strings.Contains(codeClass, "language-")) {
                // PORT-NOTE: byte offset; Go slices class from byte 9 whatever the position of "language-" is
                node.LastChild!.CodeBlockInfo = conv.BytesFromString(codeClass).subarray("language-".length);
              }

              const codeNode = new ast.Node(ast.NodeCodeBlockCode, codeTokens);
              node.AppendChild(codeNode);
              const closeMarker = new ast.Node(ast.NodeCodeBlockFenceCloseMarker, conv.BytesFromString(marker));
              closeMarker.CodeBlockFenceLen = conv.BytesFromString(marker).length;
              node.AppendChild(closeMarker);
              tree.Context!.Tip!.AppendChild(node);
            }
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
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp + "\n")));
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
          // Handle the trailing newline
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          if ("_" === marker) {
            node.AppendChild(new ast.Node(ast.NodeEmU8eCloseMarker, conv.BytesFromString(marker)));
          } else {
            node.AppendChild(new ast.Node(ast.NodeEmA6kCloseMarker, conv.BytesFromString(marker)));
          }
          return;
        }

        n.FirstChild.Data = strings.ReplaceAll(n.FirstChild.Data, editor.Zwsp, "");

        // Leading and trailing spaces form * foo * which invalidates emphasis, bold and strikethrough marks, so move the spaces before and after the right marker _*foo*_
        if (strings.HasPrefix(n.FirstChild.Data, " ") && null === n.FirstChild.PrevSibling) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, " ");
          node.InsertBefore(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
        }
        if (strings.HasSuffix(n.FirstChild.Data, " ") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, " ");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, " "));
        }
        if (strings.HasSuffix(n.FirstChild.Data, "\n") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, "\n");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, "\n"));
        }

        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Strong:
      case atom.B: {
        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp + "\n")));
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
          // Handle the trailing newline
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          if ("__" === marker) {
            node.AppendChild(new ast.Node(ast.NodeStrongU8eCloseMarker, conv.BytesFromString(marker)));
          } else {
            node.AppendChild(new ast.Node(ast.NodeStrongA6kCloseMarker, conv.BytesFromString(marker)));
          }
          return;
        }

        n.FirstChild.Data = strings.ReplaceAll(n.FirstChild.Data, editor.Zwsp, "");
        if (strings.HasPrefix(n.FirstChild.Data, " ") && null === n.FirstChild.PrevSibling) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, " ");
          node.InsertBefore(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
        }
        if (strings.HasSuffix(n.FirstChild.Data, " ") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, " ");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, " "));
        }
        if (strings.HasSuffix(n.FirstChild.Data, "\n") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, "\n");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, "\n"));
        }

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
        const marker = util.DomAttrValue(n, "data-marker");
        if ("~" === marker) {
          node.AppendChild(new ast.Node(ast.NodeStrikethrough1OpenMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeStrikethrough2OpenMarker, conv.BytesFromString(marker)));
        }
        tree.Context!.Tip!.AppendChild(node);

        if (null !== n.FirstChild && editor.Caret === n.FirstChild.Data && null !== n.LastChild && "br" === n.LastChild.Data) {
          // Handle the trailing newline
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          if ("~" === marker) {
            node.AppendChild(new ast.Node(ast.NodeStrikethrough1CloseMarker, conv.BytesFromString(marker)));
          } else {
            node.AppendChild(new ast.Node(ast.NodeStrikethrough2CloseMarker, conv.BytesFromString(marker)));
          }
          return;
        }

        n.FirstChild.Data = strings.ReplaceAll(n.FirstChild.Data, editor.Zwsp, "");
        if (strings.HasPrefix(n.FirstChild.Data, " ") && null === n.FirstChild.PrevSibling) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, " ");
          node.InsertBefore(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
        }
        if (strings.HasSuffix(n.FirstChild.Data, " ") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, " ");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, " "));
        }
        if (strings.HasSuffix(n.FirstChild.Data, "\n") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, "\n");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, "\n"));
        }

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
        const marker = util.DomAttrValue(n, "data-marker");
        if ("=" === marker) {
          node.AppendChild(new ast.Node(ast.NodeMark1OpenMarker, conv.BytesFromString(marker)));
        } else {
          node.AppendChild(new ast.Node(ast.NodeMark2OpenMarker, conv.BytesFromString(marker)));
        }
        tree.Context!.Tip!.AppendChild(node);

        if (null !== n.FirstChild && editor.Caret === n.FirstChild.Data && null !== n.LastChild && "br" === n.LastChild.Data) {
          // Handle the trailing newline
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          if ("=" === marker) {
            node.AppendChild(new ast.Node(ast.NodeMark1CloseMarker, conv.BytesFromString(marker)));
          } else {
            node.AppendChild(new ast.Node(ast.NodeMark2CloseMarker, conv.BytesFromString(marker)));
          }
          return;
        }

        n.FirstChild.Data = strings.ReplaceAll(n.FirstChild.Data, editor.Zwsp, "");
        if (strings.HasPrefix(n.FirstChild.Data, " ") && null === n.FirstChild.PrevSibling) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, " ");
          node.InsertBefore(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
        }
        if (strings.HasSuffix(n.FirstChild.Data, " ") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, " ");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, " "));
        }
        if (strings.HasSuffix(n.FirstChild.Data, "\n") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, "\n");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, "\n"));
        }

        tree.Context!.Tip = node;
        deferParentTip = true;
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
        let codeTokens: Uint8Array = conv.BytesFromString(contentStr);
        if ("html-inline" === dataType) {
          // WYSIWYG inline HTML parsing https://github.com/Vanessa219/vditor/issues/1156
          node.Type = ast.NodeInlineHTML;
          node.Tokens = codeTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        let marker = util.DomAttrValue(n, "data-marker");
        if ("" === marker) {
          marker = "`";
        }
        if (bytes.HasPrefix(codeTokens, conv.BytesFromString("`"))) {
          codeTokens = slices.Append(conv.BytesFromString(" "), codeTokens);
          codeTokens = slices.AppendByte(codeTokens, 0x20 /*   */);
        }
        node.Type = ast.NodeCodeSpan;
        node.CodeMarkerLen = conv.BytesFromString(marker).length;
        node.AppendChild(new ast.Node(ast.NodeCodeSpanOpenMarker));
        node.AppendChild(new ast.Node(ast.NodeCodeSpanContent, codeTokens));
        node.AppendChild(new ast.Node(ast.NodeCodeSpanCloseMarker));
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
            node.Tokens = conv.BytesFromString("<br />");
            tree.Context!.Tip!.AppendChild(node);
            return;
          }
          if (atom.P === n.Parent.DataAtom) {
            if (null !== n.Parent.NextSibling && (atom.Ul === n.Parent.NextSibling.DataAtom || atom.Ol === n.Parent.NextSibling.DataAtom || atom.Blockquote === n.Parent.NextSibling.DataAtom)) {
              tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp)));
              return;
            }
            if (null !== n.Parent.Parent && null !== n.Parent.Parent.NextSibling && atom.Li === n.Parent.Parent.NextSibling.DataAtom) {
              tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp)));
              return;
            }
          }
        }

        node.Type = ast.NodeHardBreak;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.A: {
        if (n.FirstChild === null || n.FirstChild.Type === html.TextNode) {
          const text = util.DomText(n);
          if ("" === text || editor.Zwsp === text) {
            return;
          }
        }

        node.Type = ast.NodeLink;
        node.AppendChild(new ast.Node(ast.NodeOpenBracket));
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Img: {
        const imgClass = cls;
        const imgAlt = util.DomAttrValue(n, "alt");
        if ("emoji" === imgClass) {
          node.Type = ast.NodeEmoji;
          const emojiImg = new ast.Node(ast.NodeEmojiImg, tree.EmojiImgTokens(imgAlt, util.DomAttrValue(n, "src")));
          emojiImg.AppendChild(new ast.Node(ast.NodeEmojiAlias, conv.BytesFromString(":" + imgAlt + ":")));
          node.AppendChild(emojiImg);
        } else {
          if ("link-ref" === dataType) {
            node.Type = ast.NodeText;
            const refContent = "![" + util.DomAttrValue(n, "alt") + "][" + util.DomAttrValue(n, "data-link-label") + "]";
            node.Tokens = conv.BytesFromString(refContent);
            tree.Context!.Tip!.AppendChild(node);
            return;
          }

          node.Type = ast.NodeImage;
          node.AppendChild(new ast.Node(ast.NodeBang));
          node.AppendChild(new ast.Node(ast.NodeOpenBracket));
          if ("" !== imgAlt) {
            node.AppendChild(new ast.Node(ast.NodeLinkText, conv.BytesFromString(imgAlt)));
          }
          node.AppendChild(new ast.Node(ast.NodeCloseBracket));
          node.AppendChild(new ast.Node(ast.NodeOpenParen));
          const src = lute.trimLinkPath(util.DomAttrValue(n, "src"));
          node.AppendChild(new ast.Node(ast.NodeLinkDest, conv.BytesFromString(src)));
          const linkTitle = util.DomAttrValue(n, "title");
          if ("" !== linkTitle) {
            node.AppendChild(new ast.Node(ast.NodeLinkSpace));
            node.AppendChild(new ast.Node(ast.NodeLinkTitle, conv.BytesFromString(linkTitle)));
          }
          node.AppendChild(new ast.Node(ast.NodeCloseParen));
        }
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Input: {
        if (null === n.Parent || null === n.Parent.Parent || (atom.P !== n.Parent.DataAtom && atom.Li !== n.Parent.DataAtom)) {
          // Only allow input in a task list
          return;
        }
        if (null !== n.NextSibling && atom.Span === n.NextSibling.DataAtom) {
          // Backspace before the task list
          n.NextSibling.FirstChild!.Data = strings.TrimSpace(n.NextSibling.FirstChild!.Data);
          break;
        }
        node.Type = ast.NodeTaskListItemMarker;
        node.ReviveFromDataTask(util.DomAttrValue(n, "data-task"), lute.hasAttr(n, "checked"));
        tree.Context!.Tip!.AppendChild(node);
        if (null !== node.Parent!.Parent && null !== node.Parent!.Parent!.ListData) { // ul.li.input
          node.Parent!.Parent!.ListData!.Typ = 3;
        }
        if (null !== node.Parent!.Parent!.Parent && null !== node.Parent!.Parent!.Parent!.ListData) { // ul.li.p.input
          node.Parent!.Parent!.Parent!.ListData!.Typ = 3;
        }
        break;
      }
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
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Thead:
        node.Type = ast.NodeTableHead;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      case atom.Tbody:
        break;
      case atom.Tr:
        node.Type = ast.NodeTableRow;
        tree.Context!.Tip!.AppendChild(node);
        tree.Context!.Tip = node;
        deferParentTip = true;
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
        deferParentTip = true;
        break;
      }
      case atom.Sup: {
        if (null === n.FirstChild) {
          break;
        }
        if ("footnotes-ref" === dataType) {
          node.Type = ast.NodeText;
          node.Tokens = conv.BytesFromString("[" + util.DomAttrValue(n, "data-footnotes-label") + "]");
          if (strings.Contains(n.FirstChild.Data, editor.Caret)) {
            node.Tokens = slices.Append(node.Tokens, editor.CaretTokens);
          }
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp + "\n")));
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

        node.Type = ast.NodeSup;
        let marker = util.DomAttrValue(n, "data-marker");
        if ("" === marker) {
          marker = "^";
        }

        node.AppendChild(new ast.Node(ast.NodeSupOpenMarker, conv.BytesFromString(marker)));
        tree.Context!.Tip!.AppendChild(node);

        if (null !== n.FirstChild && editor.Caret === n.FirstChild.Data && null !== n.LastChild && "br" === n.LastChild.Data) {
          // Handle the trailing newline
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          node.AppendChild(new ast.Node(ast.NodeSupCloseMarker, conv.BytesFromString(marker)));
          return;
        }

        n.FirstChild.Data = strings.ReplaceAll(n.FirstChild.Data, editor.Zwsp, "");
        if (strings.HasPrefix(n.FirstChild.Data, " ") && null === n.FirstChild.PrevSibling) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, " ");
          node.InsertBefore(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
        }
        if (strings.HasSuffix(n.FirstChild.Data, " ") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, " ");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, " "));
        }
        if (strings.HasSuffix(n.FirstChild.Data, "\n") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, "\n");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, "\n"));
        }

        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Sub: {
        if (null === n.FirstChild || atom.Br === n.FirstChild.DataAtom) {
          return;
        }
        if (lute.startsWithNewline(n.FirstChild)) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, editor.Zwsp + "\n");
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(editor.Zwsp + "\n")));
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

        node.Type = ast.NodeSub;
        let marker = util.DomAttrValue(n, "data-marker");
        if ("" === marker) {
          marker = "~";
        }

        node.AppendChild(new ast.Node(ast.NodeSubOpenMarker, conv.BytesFromString(marker)));
        tree.Context!.Tip!.AppendChild(node);

        if (null !== n.FirstChild && editor.Caret === n.FirstChild.Data && null !== n.LastChild && "br" === n.LastChild.Data) {
          // Handle the trailing newline
          node.AppendChild(new ast.Node(ast.NodeText, editor.CaretTokens));
          node.AppendChild(new ast.Node(ast.NodeSubCloseMarker, conv.BytesFromString(marker)));
          return;
        }

        n.FirstChild.Data = strings.ReplaceAll(n.FirstChild.Data, editor.Zwsp, "");
        if (strings.HasPrefix(n.FirstChild.Data, " ") && null === n.FirstChild.PrevSibling) {
          n.FirstChild.Data = strings.TrimLeft(n.FirstChild.Data, " ");
          node.InsertBefore(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
        }
        if (strings.HasSuffix(n.FirstChild.Data, " ") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, " ");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, " "));
        }
        if (strings.HasSuffix(n.FirstChild.Data, "\n") && null === n.FirstChild.NextSibling) {
          n.FirstChild.Data = strings.TrimRight(n.FirstChild.Data, "\n");
          n.InsertAfter(newHTMLNode(html.TextNode, 0, "\n"));
        }

        tree.Context!.Tip = node;
        deferParentTip = true;
        break;
      }
      case atom.Span: {
        if (null === n.FirstChild) {
          break;
        }

        if (strings.Contains(cls, "vditor-comment")) {
          node.Type = ast.NodeInlineHTML;
          const buf = new bytes.Buffer();
          buf.WriteString("<span ");
          for (let i = 0; i < n.Attr.length; i++) {
            const attr = n.Attr[i];
            buf.WriteString(attr.Key);
            if ("" !== attr.Val) {
              buf.WriteString("=\"");
              buf.WriteString(attr.Val);
              buf.WriteString("\"");
            }
            if (i < n.Attr.length - 1) {
              buf.WriteString(" ");
            }
          }
          buf.WriteString(">");
          node.Tokens = buf.Bytes();
          tree.Context!.Tip!.AppendChild(node);
          break;
        }

        if ("link-ref" === dataType) {
          node.Type = ast.NodeText;
          let refContent = "[" + n.FirstChild.Data + "][" + util.DomAttrValue(n, "data-link-label") + "]";
          if (null !== n.NextSibling && "2" === util.DomAttrValue(n.NextSibling, "data-render")) {
            // Image reference style ![text][label]
            refContent = "!" + refContent;
          }
          node.Tokens = conv.BytesFromString(refContent);
          tree.Context!.Tip!.AppendChild(node);
          return;
        }

        let codeTokens: Uint8Array | null = null;
        if (editor.Zwsp === n.FirstChild.Data && "" === util.DomAttrValue(n, "style") && null !== n.FirstChild.NextSibling) {
          codeTokens = conv.BytesFromString(n.FirstChild.NextSibling.FirstChild!.Data);
        } else if (atom.Code === n.FirstChild.DataAtom) {
          codeTokens = conv.BytesFromString(n.FirstChild.FirstChild!.Data);
          if (editor.Zwsp === conv.StringFromBytes(codeTokens)) {
            break;
          }
        }
        if ("math-inline" === dataType) {
          node.Type = ast.NodeInlineMath;
          node.AppendChild(new ast.Node(ast.NodeInlineMathOpenMarker));
          node.AppendChild(new ast.Node(ast.NodeInlineMathContent, codeTokens));
          node.AppendChild(new ast.Node(ast.NodeInlineMathCloseMarker));
          tree.Context!.Tip!.AppendChild(node);
          return;
        } else if ("html-inline" === dataType) {
          node.Type = ast.NodeInlineHTML;
          node.Tokens = codeTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        } else if ("code-inline" === dataType) {
          node.Tokens = codeTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        } else if ("html-entity" === dataType) {
          node.Type = ast.NodeText;
          node.Tokens = codeTokens;
          tree.Context!.Tip!.AppendChild(node);
          return;
        }
        break;
      }
      case atom.Font:
        node.Type = ast.NodeText;
        node.Tokens = conv.BytesFromString(util.DomText(n));
        tree.Context!.Tip!.AppendChild(node);
        return;
      case atom.Details:
        node.Type = ast.NodeHTMLBlock;
        node.Tokens = util.DomHTML(n);
        node.Tokens = bytes.SplitAfter(node.Tokens, conv.BytesFromString("</summary>"))[0];
        tree.Context!.Tip!.AppendChild(node);
        break;
      case atom.Kbd:
        node.Type = ast.NodeInlineHTML;
        node.Tokens = util.DomHTML(n);
        tree.Context!.Tip!.AppendChild(node);
        return;
      case atom.Summary:
        return;
      default:
        node.Type = ast.NodeHTMLBlock;
        node.Tokens = util.DomHTML(n);
        tree.Context!.Tip!.AppendChild(node);
        return;
    }

    for (let c = n.FirstChild; c !== null; c = c.NextSibling) {
      lute.genASTByVditorDOM(c, tree);
    }

    switch (n.DataAtom) {
      case atom.Span:
        if (strings.Contains(cls, "vditor-comment")) {
          tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeInlineHTML, conv.BytesFromString("</span>")));
        }
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
      case atom.Sup: {
        const marker = util.DomAttrValue(n, "data-marker");
        if ("" !== marker && "footnotes-ref" !== dataType) {
          node.AppendChild(new ast.Node(ast.NodeSupCloseMarker, conv.BytesFromString(marker)));
        }
        break;
      }
      case atom.Sub:
        node.AppendChild(new ast.Node(ast.NodeSubCloseMarker, conv.BytesFromString("~")));
        break;
      case atom.Details:
        tree.Context!.Tip!.AppendChild(new ast.Node(ast.NodeHTMLBlock, conv.BytesFromString("</details>")));
        break;
    }
  } finally {
    if (deferParentTip) {
      tree.Context!.ParentTip();
    }
  }
};

Lute.prototype.hasAttr = function (this: Lute, n: html.Node, attrName: string): boolean {
  for (const attr of n.Attr) {
    if (attr.Key === attrName) {
      return true;
    }
  }
  return false;
};

Lute.prototype.domParent = function (this: Lute, n: html.Node | null, dataAtom: atom.Atom): html.Node | null {
  if (null === n) {
    return null;
  }

  for (let p = n.Parent; null !== p; p = p.Parent) {
    if (p.DataAtom === dataAtom) {
      return p;
    }
  }
  return null;
};

Lute.prototype.domChild = function (this: Lute, n: html.Node | null, dataAtom: atom.Atom): html.Node | null {
  const lute = this;
  if (null === n) {
    return null;
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    const ret = lute.domChild0(c, dataAtom);
    if (null !== ret) {
      return ret;
    }
  }
  return null;
};

Lute.prototype.domChild0 = function (this: Lute, n: html.Node, dataAtom: atom.Atom): html.Node | null {
  const lute = this;
  if (n.DataAtom === dataAtom) {
    return n;
  }

  for (let c = n.FirstChild; null !== c; c = c.NextSibling) {
    const ret = lute.domChild0(c, dataAtom);
    if (null !== ret) {
      return ret;
    }
  }
  return null;
};

Lute.prototype.setDOMAttrValue = function (this: Lute, n: html.Node | null, attrName: string, attrVal: string): void {
  if (null === n) {
    return;
  }

  for (const attr of n.Attr) {
    if (attr.Key === attrName) {
      attr.Val = attrVal;
      return;
    }
  }

  const attribute = new html.Attribute();
  attribute.Key = attrName;
  attribute.Val = attrVal;
  n.Attr.push(attribute);
};

Lute.prototype.removeDOMAttr = function (this: Lute, n: html.Node | null, attrName: string): void {
  if (null === n) {
    return;
  }

  if (1 > n.Attr.length) {
    return;
  }

  const tmp: html.Attribute[] = [];
  for (const attr of n.Attr) {
    if (attr.Key !== attrName) {
      tmp.push(attr);
    }
  }
  n.Attr = tmp;
};

Lute.prototype.domCode = function (this: Lute, n: html.Node | null): string {
  const lute = this;
  const buf = new bytes.Buffer();
  lute.domCode0(n, buf);
  return buf.String();
};

Lute.prototype.domCode0 = function (this: Lute, n: html.Node | null, buffer: bytes.Buffer): void {
  const lute = this;
  if (null === n) {
    return;
  }
  switch (n.DataAtom) {
    case 0:
      buffer.WriteString(n.Data);
      break;
    default:
      buffer.Write(util.DomHTML(n));
      return;
  }

  for (let child = n.FirstChild; null !== child; child = child.NextSibling) {
    lute.domCode0(child, buffer);
  }
};

Lute.prototype.parentIs = function (this: Lute, n: html.Node, ...parentTypes: atom.Atom[]): boolean {
  for (let p = n.Parent; null !== p; p = p.Parent) {
    for (const pt of parentTypes) {
      if (pt === p.DataAtom) {
        return true;
      }
    }
  }
  return false;
};

Lute.prototype.getParent = function (this: Lute, n: html.Node, parentType: atom.Atom): html.Node | null {
  for (let p = n.Parent; null !== p; p = p.Parent) {
    if (parentType === p.DataAtom) {
      return p;
    }
  }
  return null;
};

Lute.prototype.isCaret = function (this: Lute, n: html.Node): [boolean, boolean] {
  let isCaret = false;
  let isEmptyText = false;
  const text = util.DomText(n);
  const trimSpaceText = strings.TrimSpace(text);
  if (1 > utf8.ByteLen(trimSpaceText) && 1 < utf8.ByteLen(text) && strings.Contains(text, editor.Caret)) {
    return [true, false];
  }
  isCaret = editor.Caret === text || editor.Zwsp + editor.Caret === text || editor.Caret + editor.Zwsp === text;
  isEmptyText = "" === text || editor.Zwsp === text;
  if ("" !== util.DomAttrValue(n, "data-content")) {
    isEmptyText = false;
  }
  return [isCaret, isEmptyText];
};

Lute.prototype.isEmptyText = function (this: Lute, n: html.Node): boolean {
  if (null !== n.FirstChild && "block-ref" === util.DomAttrValue(n.FirstChild, "data-type")) {
    return false;
  }

  const text = strings.TrimSpace(util.DomText(n));
  if ("" === text || editor.Zwsp === text) {
    return true;
  }
  if (editor.Zwsp + editor.Caret === text || editor.Caret + editor.Zwsp === text) {
    return true;
  }
  return false;
};

Lute.prototype.startsWithNewline = function (this: Lute, n: html.Node): boolean {
  return strings.HasPrefix(n.Data, "\n") || strings.HasPrefix(n.Data, editor.Zwsp + "\n");
};

Lute.prototype.isInline = function (this: Lute, n: html.Node | null): boolean {
  if (null === n) {
    return false;
  }

  return 0 === n.DataAtom ||
    atom.Code === n.DataAtom ||
    atom.Strong === n.DataAtom || atom.B === n.DataAtom ||
    atom.Em === n.DataAtom || atom.I === n.DataAtom ||
    atom.Mark === n.DataAtom ||
    atom.Sup === n.DataAtom || atom.Sub === n.DataAtom ||
    atom.Del === n.DataAtom || atom.S === n.DataAtom || atom.Strike === n.DataAtom ||
    atom.A === n.DataAtom ||
    atom.Img === n.DataAtom ||
    atom.U === n.DataAtom ||
    atom.Kbd === n.DataAtom ||
    atom.Span === n.DataAtom;
};

Lute.prototype.prefixSpaces = function (this: Lute, text: string): string {
  let ret = "";
  for (let i = 0; i < text.length;) {
    const [c, size] = utf8.DecodeRuneInString(text, i);
    if (0x20 /*   */ === c || 160 === c) {
      ret += " ";
    } else {
      return ret;
    }
    i += size;
  }
  return ret;
};

Lute.prototype.suffixSpaces = function (this: Lute, text: string): string {
  let ret = "";
  // PORT-NOTE: byte offset; Go compares single bytes, and the byte 160 (0xA0) is also a UTF-8 continuation byte
  // UPSTREAM-BUG: text[i] == 160 matches the last byte of any character whose UTF-8 form ends in 0xA0 (for example U+00A0 and U+00E0), not only the non-breaking space
  const b = conv.BytesFromString(text);
  for (let i = b.length - 1; i >= 0; i--) {
    if (0x20 /*   */ === b[i] || 160 === b[i]) {
      ret += " ";
    } else {
      return ret;
    }
  }
  return ret;
};
