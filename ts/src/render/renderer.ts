// Ported from render/renderer.go @ 8e7896b6
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
import * as strings from "../runtime/strings.ts";
import * as unicode from "../runtime/unicode.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as lex from "../lex/index.ts";
import * as parse from "../parse/index.ts";
import * as util from "../util/index.ts";
import { BaseRenderer } from "./types.ts";
import { allowSpace } from "./space.ts";
import { NewTerms } from "./term_typographer.ts";
import { TableCellRichHTML, tableCellRichInlineHTML } from "./table_rich.ts";

// RendererFunc describes the renderer function signature.
export type RendererFunc = (n: ast.Node, entering: boolean) => ast.WalkStatus;

// ExtRendererFunc describes the user-defined renderer function signature.
export type ExtRendererFunc = (n: ast.Node, entering: boolean) => [string, ast.WalkStatus];

// Renderer describes the renderer interface.
export interface Renderer {
  // Render renders the output.
  Render(): Uint8Array;
}

// PORT-NOTE: Go treats a nil []byte as empty everywhere in the render package, while ast.Node.Tokens is nullable here
// (a hand-built node may have no tokens). nodeTokens returns the tokens, or an empty array for null.
// It is not in Go; call sites that compare the tokens with nil keep reading node.Tokens directly.
const emptyBytes: Uint8Array = new Uint8Array(0);
export function nodeTokens(n: ast.Node): Uint8Array {
  return n.Tokens ?? emptyBytes;
}

// Options describes the render options.
export class Options {
  TabsMarkdown: boolean; // The clipboard keeps the tabs structure, file export flattens it by default.
  // SoftBreak2HardBreak sets whether to render a soft line break (\n) as a hard line break (<br />).
  SoftBreak2HardBreak: boolean;
  // AutoSpace sets whether to insert spaces automatically between Chinese and Western text in plain text.
  // https://github.com/sparanoid/chinese-copywriting-guidelines
  AutoSpace: boolean;
  // RenderListStyle sets whether to add the data-style attribute when rendering OL and UL https://github.com/88250/lute/issues/48
  RenderListStyle: boolean;
  // CodeSyntaxHighlight sets whether to highlight code blocks.
  CodeSyntaxHighlight: boolean;
  // CodeSyntaxHighlightDetectLang bool
  CodeSyntaxHighlightDetectLang: boolean;
  // CodeSyntaxHighlightInlineStyle sets whether the syntax highlight uses inline styles, not inline by default.
  CodeSyntaxHighlightInlineStyle: boolean;
  // CodeSyntaxHighlightLineNum sets whether the syntax highlight shows line numbers, off by default.
  CodeSyntaxHighlightLineNum: boolean;
  // CodeSyntaxHighlightStyleName specifies the syntax highlight style name, "github" by default.
  CodeSyntaxHighlightStyleName: string;
  // Vditor WYSIWYG support.
  VditorWYSIWYG: boolean;
  // Vditor instant rendering support.
  VditorIR: boolean;
  // Vditor split-screen preview support.
  VditorSV: boolean;
  // Protyle WYSIWYG support.
  ProtyleWYSIWYG: boolean;
  // KramdownBlockIAL sets whether to turn on kramdown block-level inline attribute list support. https://kramdown.gettalong.org/syntax.html#inline-attribute-lists
  KramdownBlockIAL: boolean;
  // KramdownSpanIAL sets whether to turn on kramdown inline-level inline attribute list support.
  KramdownSpanIAL: boolean;
  // OmitTableCellIAL omits the cell attributes of pipe tables in standard Markdown output.
  OmitTableCellIAL: boolean;
  // SuperBlock sets whether to support super blocks. https://github.com/88250/lute/issues/111
  SuperBlock: boolean;
  // ImageLazyLoading sets the image path used while an image is lazily loaded; setting this field turns on image lazy loading.
  // The value of the image src is copied to the new attribute data-src, and this parameter is then used as the value of src https://github.com/88250/lute/issues/55
  ImageLazyLoading: string;
  // ChineseParagraphBeginningSpace sets whether to use the traditional Chinese typesetting of "indenting the beginning of a paragraph by two characters".
  ChineseParagraphBeginningSpace: boolean;
  // Sanitize sets whether to turn on XSS safe filtering https://github.com/88250/lute/issues/51
  // Note: the current Lute implementation has some loopholes, do not rely on it to defend against XSS attacks.
  Sanitize: boolean;
  // FixTermTypo sets whether to fix the terms that appear in plain text.
  // https://github.com/sparanoid/chinese-copywriting-guidelines
  // Note: turning on term fixing inserts spaces between Chinese and Western text by default.
  FixTermTypo: boolean;
  // Terms merges the passed terms into the existing Terms dictionary, overriding them.
  Terms: Map<string, string>;
  // ToC sets whether to turn on the "table of contents" support.
  ToC: boolean;
  // HeadingID sets whether to turn on the "custom heading ID" support.
  HeadingID: boolean;
  // KramdownIALIDRenderName sets the name (key) used to render the id attribute when it appears in the kramdown inline attribute list, "id" by default.
  // Only supported in the HTML renderer HtmlRenderer.
  KramdownIALIDRenderName: string;
  // HeadingAnchor sets whether to generate link anchors for headings.
  HeadingAnchor: boolean;
  // GFMTaskListItemClass is the class name of GFM task list items, "vditor-task" by default.
  GFMTaskListItemClass: string;
  // DataTask sets whether to render the data-task attribute of task list items, used by multi-state task lists.
  DataTask: boolean;
  // VditorCodeBlockPreview sets whether a Vditor code block needs to render its preview part
  VditorCodeBlockPreview: boolean;
  // VditorMathBlockPreview sets whether a Vditor math block needs to render its preview part
  VditorMathBlockPreview: boolean;
  // VditorHTMLBlockPreview sets whether a Vditor HTML block needs to render its preview part
  VditorHTMLBlockPreview: boolean;
  // LinkBase sets the base path of links, images and footnotes. If the user uses a relative path (no protocol prefix and not starting with /) in a link or image address and LinkBase is not empty, this value is used as the prefix.
  // For example LinkBase is set to http://domain.com/, then ![foo](bar.png) is rendered as <img src="http://domain.com/bar.png" alt="foo" />
  LinkBase: string;
  // LinkPrefix sets the path prefix of links and images. Once this value is set, link rendering forcibly adds it as the link prefix, which is different from LinkBase.
  // For example LinkPrefix is set to http://domain.com, then ![foo](/local/path/bar.png) using an absolute path is rendered as <img src="http://domain.com/local/path/bar.png" alt="foo" />;
  // When both LinkBase and LinkPrefix are set, the LinkBase logic is handled first, and LinkPrefix is added to the LinkBase result at last.
  LinkPrefix: string;
  // NodeIndexStart sets the starting value of the block-level node numbers.
  NodeIndexStart: number;
  // ProtyleContenteditable sets the contenteditable attribute of the tags when Protyle renders.
  ProtyleContenteditable: boolean;
  // KeepParagraphBeginningSpace sets whether to keep the spaces at the beginning of a paragraph
  KeepParagraphBeginningSpace: boolean;
  // NetImgMarker sets whether Protyle marks network images
  ProtyleMarkNetImg: boolean;
  // Spellcheck sets whether to enable spell checking
  Spellcheck: boolean;
  // UnorderedListMarker sets the marker of unordered lists and task lists, * by default
  UnorderedListMarker: string;
  // ImgTag sets whether to render images with the <img> tag
  ImgTag: boolean;
  // PreventEncodeLinkSpace sets whether to prevent encoding the spaces in links as %20
  PreventEncodeLinkSpace: boolean;
  // ExportNormalizeTaskListMarker sets whether to export non-standard task list markers (such as [/], [>], [!]) uniformly as the done marker [X].
  // When on, [ ] and [X] stay unchanged and all the other markers are converted to [X], for compatibility with Markdown parsers that do not support custom markers.
  ExportNormalizeTaskListMarker: boolean;

  constructor() {
    this.TabsMarkdown = false;
    this.SoftBreak2HardBreak = false;
    this.AutoSpace = false;
    this.RenderListStyle = false;
    this.CodeSyntaxHighlight = false;
    this.CodeSyntaxHighlightDetectLang = false;
    this.CodeSyntaxHighlightInlineStyle = false;
    this.CodeSyntaxHighlightLineNum = false;
    this.CodeSyntaxHighlightStyleName = "";
    this.VditorWYSIWYG = false;
    this.VditorIR = false;
    this.VditorSV = false;
    this.ProtyleWYSIWYG = false;
    this.KramdownBlockIAL = false;
    this.KramdownSpanIAL = false;
    this.OmitTableCellIAL = false;
    this.SuperBlock = false;
    this.ImageLazyLoading = "";
    this.ChineseParagraphBeginningSpace = false;
    this.Sanitize = false;
    this.FixTermTypo = false;
    this.Terms = new Map<string, string>();
    this.ToC = false;
    this.HeadingID = false;
    this.KramdownIALIDRenderName = "";
    this.HeadingAnchor = false;
    this.GFMTaskListItemClass = "";
    this.DataTask = false;
    this.VditorCodeBlockPreview = false;
    this.VditorMathBlockPreview = false;
    this.VditorHTMLBlockPreview = false;
    this.LinkBase = "";
    this.LinkPrefix = "";
    this.NodeIndexStart = 0;
    this.ProtyleContenteditable = false;
    this.KeepParagraphBeginningSpace = false;
    this.ProtyleMarkNetImg = false;
    this.Spellcheck = false;
    this.UnorderedListMarker = "";
    this.ImgTag = false;
    this.PreventEncodeLinkSpace = false;
    this.ExportNormalizeTaskListMarker = false;
  }

  // Copy returns a shallow copy, as Go's `opt := *options` does (the Terms map is shared, not cloned).
  // PORT-NOTE: not in Go; it stands for the by-value struct copy at render/table_rich.go.
  Copy(): Options {
    const ret = new Options();
    ret.TabsMarkdown = this.TabsMarkdown;
    ret.SoftBreak2HardBreak = this.SoftBreak2HardBreak;
    ret.AutoSpace = this.AutoSpace;
    ret.RenderListStyle = this.RenderListStyle;
    ret.CodeSyntaxHighlight = this.CodeSyntaxHighlight;
    ret.CodeSyntaxHighlightDetectLang = this.CodeSyntaxHighlightDetectLang;
    ret.CodeSyntaxHighlightInlineStyle = this.CodeSyntaxHighlightInlineStyle;
    ret.CodeSyntaxHighlightLineNum = this.CodeSyntaxHighlightLineNum;
    ret.CodeSyntaxHighlightStyleName = this.CodeSyntaxHighlightStyleName;
    ret.VditorWYSIWYG = this.VditorWYSIWYG;
    ret.VditorIR = this.VditorIR;
    ret.VditorSV = this.VditorSV;
    ret.ProtyleWYSIWYG = this.ProtyleWYSIWYG;
    ret.KramdownBlockIAL = this.KramdownBlockIAL;
    ret.KramdownSpanIAL = this.KramdownSpanIAL;
    ret.OmitTableCellIAL = this.OmitTableCellIAL;
    ret.SuperBlock = this.SuperBlock;
    ret.ImageLazyLoading = this.ImageLazyLoading;
    ret.ChineseParagraphBeginningSpace = this.ChineseParagraphBeginningSpace;
    ret.Sanitize = this.Sanitize;
    ret.FixTermTypo = this.FixTermTypo;
    ret.Terms = this.Terms;
    ret.ToC = this.ToC;
    ret.HeadingID = this.HeadingID;
    ret.KramdownIALIDRenderName = this.KramdownIALIDRenderName;
    ret.HeadingAnchor = this.HeadingAnchor;
    ret.GFMTaskListItemClass = this.GFMTaskListItemClass;
    ret.DataTask = this.DataTask;
    ret.VditorCodeBlockPreview = this.VditorCodeBlockPreview;
    ret.VditorMathBlockPreview = this.VditorMathBlockPreview;
    ret.VditorHTMLBlockPreview = this.VditorHTMLBlockPreview;
    ret.LinkBase = this.LinkBase;
    ret.LinkPrefix = this.LinkPrefix;
    ret.NodeIndexStart = this.NodeIndexStart;
    ret.ProtyleContenteditable = this.ProtyleContenteditable;
    ret.KeepParagraphBeginningSpace = this.KeepParagraphBeginningSpace;
    ret.ProtyleMarkNetImg = this.ProtyleMarkNetImg;
    ret.Spellcheck = this.Spellcheck;
    ret.UnorderedListMarker = this.UnorderedListMarker;
    ret.ImgTag = this.ImgTag;
    ret.PreventEncodeLinkSpace = this.PreventEncodeLinkSpace;
    ret.ExportNormalizeTaskListMarker = this.ExportNormalizeTaskListMarker;
    return ret;
  }
}

export function NewOptions(): Options {
  const ret = new Options();
  ret.SoftBreak2HardBreak = true;
  ret.AutoSpace = false;
  ret.RenderListStyle = false;
  ret.CodeSyntaxHighlight = true;
  ret.CodeSyntaxHighlightInlineStyle = false;
  ret.CodeSyntaxHighlightLineNum = false;
  ret.CodeSyntaxHighlightStyleName = "github";
  ret.VditorWYSIWYG = false;
  ret.VditorIR = false;
  ret.VditorSV = false;
  ret.ProtyleWYSIWYG = false;
  ret.KramdownBlockIAL = false;
  ret.ChineseParagraphBeginningSpace = false;
  ret.FixTermTypo = false;
  ret.ToC = false;
  ret.HeadingID = false;
  ret.KramdownIALIDRenderName = "id";
  ret.GFMTaskListItemClass = "vditor-task";
  ret.DataTask = false;
  ret.ExportNormalizeTaskListMarker = true;
  ret.VditorCodeBlockPreview = true;
  ret.VditorMathBlockPreview = true;
  ret.VditorHTMLBlockPreview = true;
  ret.LinkBase = "";
  ret.LinkPrefix = "";
  ret.NodeIndexStart = 1;
  ret.ProtyleContenteditable = true;
  ret.ProtyleMarkNetImg = true;
  ret.Spellcheck = false;
  ret.Terms = NewTerms();
  return ret;
}

// PORT-NOTE: BaseRenderer is declared in types.ts (its methods live in several files); the methods defined in this file follow.
declare module "./types.ts" {
  interface BaseRenderer {
    renderTableByHTML(node: ast.Node): void;
    renderTableByHTMLRows(thead: ast.Node): void;
    renderTableByHTMLRow(row: ast.Node): void;
    NormalizedTaskListItemMarker(node: ast.Node): number;
    NormalizedTaskListItemChecked(node: ast.Node): boolean;
    Render(): Uint8Array;
    renderDefault(n: ast.Node, entering: boolean): ast.WalkStatus;
    WriteByte(c: number): void;
    Write(content: Uint8Array): void;
    WriteString(content: string): void;
    Newline(): void;
    TextAutoSpacePrevious(node: ast.Node): void;
    TextAutoSpaceNext(node: ast.Node): void;
    LinkTextAutoSpacePrevious(node: ast.Node): void;
    LinkTextAutoSpaceNext(node: ast.Node): void;
    renderToC(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderToC0(heading: Heading): void;
    Tag(name: string, attrs: string[][] | null, selfclosing: boolean): void;
    headings(): Heading[];
    setextHeadingLen(node: ast.Node): number;
    renderListStyle(node: ast.Node, attrs: string[][]): void;
    tagSrc(tokens: Uint8Array): Uint8Array | null;
    replaceSrc(tokens: Uint8Array, src: string): Uint8Array;
    tagSrcPath(tokens: Uint8Array): Uint8Array;
    isLastNode(treeRoot: ast.Node, node: ast.Node | null): boolean;
    NodeID(node: ast.Node): string;
    NodeAttrs(node: ast.Node): string[][];
    NodeAttrsStr(node: ast.Node): string;
    Text(node: ast.Node): string;
    ParagraphContainImgOnly(paragraph: ast.Node): boolean;
    needUseHTMLTable(table: ast.Node): boolean;
  }
}

// renderTableByHTML renders the HTML structure of a table with merged cells (table/colgroup/thead/tbody/tr/td + colspan/rowspan/class).
// The inline elements inside a cell are walked and rendered by each renderer's own RendererFuncs (renderTextMark and so on) through ast.Walk,
// so the cell content outputs Markdown markers when exporting MD, and HTML tags when previewing or exporting HTML.
BaseRenderer.prototype.renderTableByHTML = function (this: BaseRenderer, node: ast.Node): void {
  const r = this;
  // <table>
  const ials = parse.IAL2Map(node.KramdownIAL);
  ials.delete("id");
  ials.delete("caption");
  ials.delete("updated");
  ials.delete("colgroup");
  ials.delete("custom-sy-table-rich");
  r.Tag("table", parse.Map2IAL(ials), false);
  BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
  let caption = node.IALAttr("caption");
  if ("" !== caption) {
    caption = html.UnescapeHTMLStr(caption);
    caption = strings.ReplaceAll(caption, "contenteditable=\"false\" ", "");
    BaseRenderer.prototype.WriteString.call(r, caption); // PORT-NOTE: Go embedding, base method
  }
  BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method

  // <colgroup>
  r.Tag("colgroup", null, false);
  const colgroup = node.IALAttr("colgroup");
  if ("" === colgroup) {
    const head = node.ChildByType(ast.NodeTableHead);
    if (null !== head && null !== head.FirstChild) {
      for (let th = head.FirstChild.FirstChild; null !== th; th = th.Next) {
        if (ast.NodeTableCell === th.Type) {
          const style = th.IALAttr("style");
          if ("" !== style) {
            r.Tag("col", [["style", style]], true);
          } else {
            r.Tag("col", null, true);
          }
        }
      }
    }
  } else {
    const cols = strings.Split(colgroup, "|");
    for (const style of cols) {
      if ("" !== style) {
        r.Tag("col", [["style", style]], true);
      } else {
        r.Tag("col", null, true);
      }
    }
  }
  r.Tag("/colgroup", null, false);

  // Walk the rows of thead and tbody
  let hasThead = false;
  let hasTbody = false;
  for (let child = node.FirstChild; null !== child; child = child.Next) {
    if (ast.NodeTableHead === child.Type) {
      // <thead>
      r.Tag("thead", null, false);
      r.renderTableByHTMLRows(child);
      r.Tag("/thead", null, false);
      hasThead = true;
    } else if (ast.NodeTableRow === child.Type) {
      // tbody rows (rows attached directly under the table)
      if (!hasTbody) {
        if (hasThead) {
          // tbody directly follows thead (output even if empty, consistent with the behavior of ProtylePreviewRenderer)
        }
        r.Tag("tbody", null, false);
        BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
        hasTbody = true;
      }
      r.renderTableByHTMLRow(child);
    }
  }
  // If there is a thead but no tbody rows, still output an empty <tbody> (not closed, consistent with the behavior of ProtylePreviewRenderer)
  if (hasThead && !hasTbody) {
    r.Tag("tbody", null, false);
    BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
  }
  if (hasTbody) {
    r.Tag("/tbody", null, false);
    BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
  }
  r.Tag("/table", null, false);
  BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
};

// renderTableByHTMLRows renders all the rows under thead
BaseRenderer.prototype.renderTableByHTMLRows = function (this: BaseRenderer, thead: ast.Node): void {
  const r = this;
  for (let row = thead.FirstChild; null !== row; row = row.Next) {
    if (ast.NodeTableRow === row.Type) {
      r.renderTableByHTMLRow(row);
    }
  }
};

// appendTableCellAlignStyle merges the alignment of an old-format cell into the inline style, keeping the other style declarations.
// PORT-NOTE: Go takes *[][]string; the array is passed as is and only modified with push and element assignment.
export function appendTableCellAlignStyle(node: ast.Node, attrs: string[][]): void {
  let align = "";
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
    default:
      return;
  }
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if ("style" !== attr[0]) {
      continue;
    }
    for (const declaration of strings.Split(attr[1], ";")) {
      const [property, , found] = strings.Cut(declaration, ":");
      if (found && strings.EqualFold(strings.TrimSpace(property), "text-align")) {
        return;
      }
    }
    let style = strings.TrimSpace(attr[1]);
    if ("" !== style && !strings.HasSuffix(style, ";")) {
      style += ";";
    }
    if ("" !== style) {
      style += " ";
    }
    attrs[i] = ["style", style + "text-align: " + align + ";"];
    return;
  }
  attrs.push(["style", "text-align: " + align + ";"]);
}

// renderTableByHTMLRow renders a row (tr + td/th), the cell content is walked through ast.Walk + RendererFuncs
BaseRenderer.prototype.renderTableByHTMLRow = function (this: BaseRenderer, row: ast.Node): void {
  const r = this;
  r.Tag("tr", null, false);
  BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
  for (let cell = row.FirstChild; null !== cell; cell = cell.Next) {
    if (ast.NodeTableCell !== cell.Type && ast.NodeKramdownSpanIAL !== cell.Type) {
      continue;
    }
    if (ast.NodeKramdownSpanIAL === cell.Type) {
      continue;
    }
    // Skip the fn__none placeholder cells
    let fnNone = false;
    for (const kv of cell.KramdownIAL ?? []) { // PORT-NOTE: nil slice, KramdownIAL is nullable
      if ("class" === kv[0] && strings.Contains(kv[1], "fn__none")) {
        fnNone = true;
        break;
      }
    }
    if (fnNone) {
      continue;
    }

    let tag = "td";
    if (null !== cell.Parent && null !== cell.Parent.Parent && ast.NodeTableHead === cell.Parent.Parent.Type) {
      tag = "th";
    }
    const attrs: string[][] = [];
    // IAL attributes such as colspan/rowspan/style
    for (const kv of cell.KramdownIAL ?? []) {
      if ("colspan" === kv[0] || "rowspan" === kv[0] || "style" === kv[0]) {
        attrs.push(kv);
      }
    }
    appendTableCellAlignStyle(cell, attrs);
    r.Tag(tag, attrs, false);
    if (null !== cell.TableCellRich) {
      if (r.tableCellRichInline) {
        BaseRenderer.prototype.Write.call(r, tableCellRichInlineHTML(cell, r.Options, r.ParseOptions)); // PORT-NOTE: Go embedding, base method
      } else {
        const [content, err] = TableCellRichHTML(cell.TableCellRich, r.Options);
        if (null === err) {
          BaseRenderer.prototype.Write.call(r, content!); // PORT-NOTE: Go embedding, base method
        }
      }
      r.Tag("/" + tag, null, false);
      BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
      continue;
    }
    // Walk the child nodes of the cell, the inline elements are handled by the RendererFuncs of each renderer
    for (let c = cell.FirstChild; null !== c; c = c.Next) {
      ast.Walk(c, (n: ast.Node, entering: boolean): ast.WalkStatus => {
        const rendererFunc = r.RendererFuncs.get(n.Type);
        if (undefined === rendererFunc) {
          return ast.WalkContinue;
        }
        return rendererFunc(n, entering);
      });
    }
    r.Tag("/" + tag, null, false);
    BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
  }
  r.Tag("/tr", null, false);
  BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method
};

// NormalizedTaskListItemMarker returns the normalized task list item marker.
// When the ExportNormalizeTaskListMarker option is on, non-standard markers (such as /, >, !) are converted to X.
// Only used for Markdown text output (format, export_md), not for the data-task attribute.
BaseRenderer.prototype.NormalizedTaskListItemMarker = function (this: BaseRenderer, node: ast.Node): number {
  const r = this;
  let marker = node.EffectiveTaskListItemMarker();
  if (r.Options.ExportNormalizeTaskListMarker) {
    if (marker !== " " && marker !== "X") {
      marker = "X";
    }
  }
  // PORT-NOTE: byte offset, Go takes the first byte of the string. Go panics on an empty string; here it yields undefined.
  return conv.BytesFromString(html.UnescapeHTMLStr(marker))[0];
};

// NormalizedTaskListItemChecked returns the normalized checked state of a task list item.
BaseRenderer.prototype.NormalizedTaskListItemChecked = function (this: BaseRenderer, node: ast.Node): boolean {
  const r = this;
  const marker = r.NormalizedTaskListItemMarker(node);
  return marker !== 0x20 /* space */;
};

// NewBaseRenderer constructs a BaseRenderer.
export function NewBaseRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): BaseRenderer {
  // PORT-NOTE: the BaseRenderer constructor (types.ts) does the work of Go's NewBaseRenderer: tables, output buffer, Grow(4096)
  const ret = new BaseRenderer(tree, options, parseOptions);
  return ret;
}

// Render walks from the root node and renders.
// PORT-NOTE: Go embedding, HtmlRenderer.Render calls this one explicitly as BaseRenderer.prototype.Render.call(this).
BaseRenderer.prototype.Render = function (this: BaseRenderer): Uint8Array {
  const r = this;
  let output: Uint8Array = new Uint8Array(0);
  r.LastOut = lex.ItemNewline;
  r.Writer = new bytes.Buffer();
  r.Writer.Grow(4096);

  ast.Walk(r.Tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    const extRender = r.ExtRendererFuncs.get(n.Type);
    if (undefined !== extRender) {
      const [output, status] = extRender(n, entering);
      BaseRenderer.prototype.WriteString.call(r, output); // PORT-NOTE: Go embedding, base method
      return status;
    }

    const render = r.RendererFuncs.get(n.Type);
    if (undefined === render) {
      if (null !== r.DefaultRendererFunc) {
        return r.DefaultRendererFunc(n, entering);
      }
      return BaseRenderer.prototype.renderDefault.call(r, n, entering); // PORT-NOTE: Go embedding, base method
    }
    return render(n, entering);
  });

  output = r.Writer.Bytes();
  return output;
};

BaseRenderer.prototype.renderDefault = function (this: BaseRenderer, n: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  BaseRenderer.prototype.WriteString.call(r, "not found render function for node [type=" + ast.NodeTypeString(n.Type) + ", Tokens=" + util.BytesToStr(nodeTokens(n)) + "]"); // PORT-NOTE: Go embedding, base method
  return ast.WalkContinue;
};

// WriteByte outputs one byte c.
BaseRenderer.prototype.WriteByte = function (this: BaseRenderer, c: number): void {
  const r = this;
  r.Writer.WriteByte(c);
  r.LastOut = c;
};

// Write outputs the specified byte array content.
BaseRenderer.prototype.Write = function (this: BaseRenderer, content: Uint8Array): void {
  const r = this;
  const length = content.length;
  if (0 < length) {
    r.Writer.Write(content);
    r.LastOut = content[length - 1];
  }
};

// WriteString outputs the specified string content.
BaseRenderer.prototype.WriteString = function (this: BaseRenderer, content: string): void {
  const r = this;
  const length = content.length; // PORT-NOTE: byte offset, only used as a non-empty test here; the last byte is computed below
  if (0 < length) {
    r.Writer.WriteString(content);
    // PORT-NOTE: byte offset, Go reads content[len(content)-1], the last UTF-8 byte. For a non-ASCII rune that byte is 0x80 | (r & 0x3f).
    const c = content.charCodeAt(length - 1);
    if (c < 0x80) {
      r.LastOut = c;
    } else {
      const lastRune = utf8.DecodeLastRuneInString(content)[0];
      r.LastOut = 0x80 | (lastRune & 0x3f);
    }
  }
};

// Newline outputs a newline \n when the latest content is not a newline.
BaseRenderer.prototype.Newline = function (this: BaseRenderer): void {
  const r = this;
  if (lex.ItemNewline !== r.LastOut) {
    r.Writer.WriteByte(lex.ItemNewline);
    r.LastOut = lex.ItemNewline;
  }
};

BaseRenderer.prototype.TextAutoSpacePrevious = function (this: BaseRenderer, node: ast.Node): void {
  const r = this;
  if (!r.Options.AutoSpace) {
    return;
  }

  const text = node.ChildByType(ast.NodeText);
  let tokens: Uint8Array = new Uint8Array(0);
  if (null !== text) {
    tokens = nodeTokens(text);
  }
  if (ast.NodeTextMark === node.Type) {
    tokens = conv.BytesFromString(node.TextMarkTextContent);
  }
  if (1 > tokens.length) {
    return;
  }

  const previous = node.Previous;
  if (null !== previous && ast.NodeText === previous.Type) {
    const prevLast = utf8.DecodeLastRune(nodeTokens(previous))[0];
    const first = utf8.DecodeRune(tokens)[0];
    if (allowSpace(prevLast, first)) {
      r.Writer.WriteByte(lex.ItemSpace);
    }
  }
};

BaseRenderer.prototype.TextAutoSpaceNext = function (this: BaseRenderer, node: ast.Node): void {
  const r = this;
  if (!r.Options.AutoSpace) {
    return;
  }

  const text = node.ChildByType(ast.NodeText);
  let tokens: Uint8Array = new Uint8Array(0);
  if (null !== text) {
    tokens = nodeTokens(text);
  }
  if (ast.NodeTextMark === node.Type) {
    tokens = conv.BytesFromString(node.TextMarkTextContent);
  }
  if (1 > tokens.length) {
    return;
  }

  let next = node.Next;
  if (null !== next) {
    if (ast.NodeText === next.Type) {
      const nextFirst = utf8.DecodeRune(nodeTokens(next))[0];
      const last = utf8.DecodeLastRune(tokens)[0];
      if (allowSpace(last, nextFirst)) {
        r.Writer.WriteByte(lex.ItemSpace);
      }
    } else if (ast.NodeKramdownSpanIAL === next.Type) {
      // Optimize the typesetting of unprocessed styled text https://github.com/siyuan-note/siyuan/issues/6305
      next = next.Next;
      if (null !== next && ast.NodeText === next.Type) {
        const nextFirst = utf8.DecodeRune(nodeTokens(next))[0];
        const last = utf8.DecodeLastRune(tokens)[0];
        if (allowSpace(last, nextFirst)) {
          next.Tokens = slices.Append(new Uint8Array([lex.ItemSpace]), nodeTokens(next));
        }
      }
    }
  }
};

BaseRenderer.prototype.LinkTextAutoSpacePrevious = function (this: BaseRenderer, node: ast.Node): void {
  const r = this;
  if (!r.Options.AutoSpace) {
    return;
  }

  const text = node.ChildByType(ast.NodeLinkText);
  if (null !== text && null !== text.Tokens) {
    const previous = node.Previous;
    if (null !== previous && ast.NodeText === previous.Type) {
      const prevLast = utf8.DecodeLastRune(nodeTokens(previous))[0];
      const first = utf8.DecodeRune(text.Tokens)[0];
      if (allowSpace(prevLast, first)) {
        r.Writer.WriteByte(lex.ItemSpace);
      }
    }
  }
};

BaseRenderer.prototype.LinkTextAutoSpaceNext = function (this: BaseRenderer, node: ast.Node): void {
  const r = this;
  if (!r.Options.AutoSpace) {
    return;
  }

  const text = node.ChildByType(ast.NodeLinkText);
  if (null !== text && null !== text.Tokens) {
    const next = node.Next;
    if (null !== next && ast.NodeText === next.Type) {
      const nextFirst = utf8.DecodeRune(nodeTokens(next))[0];
      const last = utf8.DecodeLastRune(text.Tokens)[0];
      if (allowSpace(last, nextFirst)) {
        r.Writer.WriteByte(lex.ItemSpace);
      }
    }
  }
};

export function SubStr(str: string, length: number): string {
  let ret = "";
  let count = 0;
  for (let i = 0; i < str.length; ) {
    const v = utf8.DecodeRuneInStringPacked(str, i);
    i += v >>> 24;
    // PERF-TODO: Go builds the result with string concatenation per rune; ported as written
    ret += conv.StringFromRune(v & 0xffffff);
    count++;
    if (length <= count) {
      break;
    }
  }
  return ret;
}

export function HeadingID(heading: ast.Node): string {
  if (0 === heading.HeadingNormalizedID.length) { // PORT-NOTE: Go tests len(util.StrToBytes(...)), zero length either way
    headingID0(heading);
  }
  return heading.HeadingNormalizedID;
}

// HeadingIDRaw returns the raw text inside the braces of the heading ID syntax.
export function HeadingIDRaw(heading: ast.Node): string {
  let ret = "";
  const headingID = heading.ChildByType(ast.NodeHeadingID);
  if (null !== headingID) {
    ret = util.BytesToStr(nodeTokens(headingID));
  }
  return ret;
}

export function headingID0(heading: ast.Node): void {
  let root: ast.Node = heading.Parent!;
  for (; ast.NodeDocument !== root.Type; root = root.Parent!) {
    // empty
  }

  const idOccurs: Map<string, number> = new Map<string, number>();
  ast.Walk(root, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering) {
      if (ast.NodeHeading === n.Type) {
        let id = normalizeHeadingID(n);
        for (; 0 < (idOccurs.get(id) ?? 0); id += "-") {
          // empty
        }
        n.HeadingNormalizedID = id;
        idOccurs.set(id, 1);
      }
    }
    return ast.WalkContinue;
  });
}

export function normalizeHeadingID(heading: ast.Node): string {
  const headingID = heading.ChildByType(ast.NodeHeadingID);
  let id = "";
  if (null !== headingID) {
    id = util.BytesToStr(nodeTokens(headingID));
  }
  if ("" === id) {
    id = heading.Text();
  }

  id = strings.TrimLeft(id, "#");
  id = strings.ReplaceAll(id, editor.Caret, "");
  // PERF-TODO: Go uses a strings.Builder; here the result is built with string concatenation per rune
  let buf = "";
  for (let i = 0; i < id.length; ) {
    const v = utf8.DecodeRuneInStringPacked(id, i);
    i += v >>> 24;
    const r = v & 0xffffff;
    if (unicode.IsLetter(r) || unicode.IsDigit(r)) {
      buf += conv.StringFromRune(r);
    } else {
      buf += "-";
    }
  }
  return buf;
}

export class Heading {
  ID: string; // json:"id"
  Box: string; // json:"box"
  Path: string; // json:"path"
  HPath: string; // json:"hPath"
  Content: string; // json:"content"
  Level: number; // json:"level"
  Children: Heading[]; // json:"children"
  parent: Heading | null;

  constructor() {
    this.ID = "";
    this.Box = "";
    this.Path = "";
    this.HPath = "";
    this.Content = "";
    this.Level = 0;
    this.Children = [];
    this.parent = null;
  }
}

BaseRenderer.prototype.renderToC = function (this: BaseRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const headings = r.headings();
    const length = headings.length;
    BaseRenderer.prototype.WriteString.call(r, "<div class=\"vditor-toc\" data-block=\"0\" data-type=\"toc-block\" contenteditable=\"false\">"); // PORT-NOTE: Go embedding, base method
    if (0 < length) {
      BaseRenderer.prototype.WriteString.call(r, "<ul>"); // PORT-NOTE: Go embedding, base method
      for (const child of headings) {
        r.renderToC0(child);
      }
      BaseRenderer.prototype.WriteString.call(r, "</ul>"); // PORT-NOTE: Go embedding, base method
    } else {
      BaseRenderer.prototype.WriteString.call(r, "[toc]<br>"); // PORT-NOTE: Go embedding, base method
    }
    BaseRenderer.prototype.WriteString.call(r, "</div>"); // PORT-NOTE: Go embedding, base method
  }
  return ast.WalkContinue;
};

BaseRenderer.prototype.renderToC0 = function (this: BaseRenderer, heading: Heading): void {
  const r = this;
  BaseRenderer.prototype.WriteString.call(r, "<li>"); // PORT-NOTE: Go embedding, base method
  r.Tag("span", [["data-target-id", heading.ID]], false);
  BaseRenderer.prototype.WriteString.call(r, heading.Content); // PORT-NOTE: Go embedding, base method
  r.Tag("/span", null, false);
  if (0 < heading.Children.length) {
    BaseRenderer.prototype.WriteString.call(r, "<ul>"); // PORT-NOTE: Go embedding, base method
    for (const child of heading.Children) {
      r.renderToC0(child);
    }
    BaseRenderer.prototype.WriteString.call(r, "</ul>"); // PORT-NOTE: Go embedding, base method
  }
  BaseRenderer.prototype.WriteString.call(r, "</li>"); // PORT-NOTE: Go embedding, base method
};

BaseRenderer.prototype.Tag = function (this: BaseRenderer, name: string, attrs: string[][] | null, selfclosing: boolean): void {
  const r = this;
  if (r.DisableTags > 0) {
    return;
  }

  BaseRenderer.prototype.WriteString.call(r, "<"); // PORT-NOTE: Go embedding, base method
  BaseRenderer.prototype.WriteString.call(r, name); // PORT-NOTE: Go embedding, base method
  if (null !== attrs && 0 < attrs.length) {
    for (const attr of attrs) {
      BaseRenderer.prototype.WriteString.call(r, " " + attr[0] + "=\"" + attr[1] + "\""); // PORT-NOTE: Go embedding, base method
    }
  }
  if (selfclosing) {
    BaseRenderer.prototype.WriteString.call(r, " /"); // PORT-NOTE: Go embedding, base method
  }
  BaseRenderer.prototype.WriteString.call(r, ">"); // PORT-NOTE: Go embedding, base method
};

BaseRenderer.prototype.headings = function (this: BaseRenderer): Heading[] {
  const r = this;
  const ret: Heading[] = [];
  const headings = r.Tree.Root!.ChildrenByType(ast.NodeHeading);
  let tip: Heading | null = null;
  for (const heading of headings) {
    if (r.Tree.Root !== heading.Parent) {
      continue;
    }

    let id = HeadingID(heading);
    if (r.Options.VditorWYSIWYG) {
      id = "wysiwyg-" + id;
    } else if (r.Options.VditorIR) {
      id = "ir-" + id;
    }

    if (r.Options.KramdownBlockIAL) {
      for (const kv of heading.KramdownIAL ?? []) { // PORT-NOTE: nil slice, KramdownIAL is nullable
        if ("id" === kv[0]) {
          id = kv[1];
          break;
        }
      }
    }

    const h = new Heading();
    h.ID = id;
    h.Box = r.Tree.Box;
    h.Path = r.Tree.Path;
    h.HPath = r.Tree.HPath;
    h.Content = headingText(heading);
    h.Level = heading.HeadingLevel;

    if (null === tip) {
      ret.push(h);
    } else {
      if (tip.Level < h.Level) {
        tip.Children.push(h);
        h.parent = tip;
      } else {
        const parent = parentTip(h, tip);
        if (null === parent) {
          ret.push(h);
        } else {
          parent.Children.push(h);
          h.parent = tip.parent;
        }
      }
    }
    tip = h;
  }
  return ret;
};

export function parentTip(currentHeading: Heading, tip: Heading): Heading | null {
  if (null === tip.parent) {
    return null;
  }

  for (let parent: Heading | null = tip.parent; null !== parent; parent = parent.parent) {
    if (parent.Level < currentHeading.Level) {
      return parent;
    }
  }
  return null;
}

const fontOpenPrefix: Uint8Array = conv.BytesFromString("<font ");
const fontClose: Uint8Array = conv.BytesFromString("</font>");
const closeTagPrefix: Uint8Array = conv.BytesFromString("</");

export function headingText(n: ast.Node): string {
  const buf = new bytes.Buffer();
  ast.Walk(n, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    switch (n.Type) {
      case ast.NodeLinkText:
      case ast.NodeBlockRefText:
      case ast.NodeBlockRefDynamicText:
      case ast.NodeFileAnnotationRefText:
      case ast.NodeBackslashContent:
        buf.Write(nodeTokens(n));
        break;
      case ast.NodeInlineMathContent:
        buf.WriteString("<span class=\"language-math\">");
        buf.Write(html.EscapeHTML(nodeTokens(n)));
        buf.WriteString("</span>");
        break;
      case ast.NodeCodeSpanContent:
        buf.WriteString("<code>");
        buf.Write(html.EscapeHTML(nodeTokens(n)));
        buf.WriteString("</code>");
        break;
      case ast.NodeText:
        if (n.ParentIs(ast.NodeStrong)) {
          buf.WriteString("<strong>");
          buf.Write(html.EscapeHTML(nodeTokens(n)));
          buf.WriteString("</strong>");
        } else if (n.ParentIs(ast.NodeEmphasis)) {
          buf.WriteString("<em>");
          buf.Write(html.EscapeHTML(nodeTokens(n)));
          buf.WriteString("</em>");
        } else {
          if (null !== n.Previous && ast.NodeInlineHTML === n.Previous.Type) {
            if (bytes.HasPrefix(nodeTokens(n.Previous), fontOpenPrefix)) {
              buf.Write(nodeTokens(n.Previous));
              buf.Write(nodeTokens(n));
            }
            if (null !== n.Next && bytes.Equal(nodeTokens(n.Next), fontClose)) {
              buf.Write(nodeTokens(n.Next));
            }
          } else {
            buf.Write(html.EscapeHTML(nodeTokens(n)));
          }
        }
        break;
    }
    return ast.WalkContinue;
  });
  return buf.String();
}

BaseRenderer.prototype.setextHeadingLen = function (this: BaseRenderer, node: ast.Node): number {
  const r = this;
  let ret = 0;
  const buf = new bytes.Buffer();
  ast.Walk(node, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if ((ast.NodeText === n.Type || ast.NodeLinkText === n.Type || ast.NodeSoftBreak === n.Type) && entering) {
      buf.Write(nodeTokens(n));
    }
    return ast.WalkContinue;
  });
  let content = buf.String();
  content = strings.ReplaceAll(content, editor.Caret, "");
  const lines = strings.Split(content, "\n");
  const lastLine = lines[lines.length - 1];
  for (let i = 0; i < lastLine.length; ) {
    const v = utf8.DecodeRuneInStringPacked(lastLine, i);
    i += v >>> 24;
    const rn = v & 0xffffff;
    if (utf8.RuneSelf <= rn) {
      ret += 2;
    } else {
      ret++;
    }
  }
  if (0 === ret) {
    ret = 3;
  }
  return ret;
};

BaseRenderer.prototype.renderListStyle = function (this: BaseRenderer, node: ast.Node, attrs: string[][]): void {
  const r = this;
  if (r.Options.RenderListStyle) {
    const listData = node.ListData!;
    switch (listData.Typ) {
      case 0:
        attrs.push(["data-style", conv.StringFromBytes(listData.Marker)]);
        break;
      case 1:
        attrs.push(["data-style", strconv.Itoa(listData.Num) + conv.StringFromRune(listData.Delimiter)]);
        break;
      case 3:
        if (0 === listData.BulletChar) {
          attrs.push(["data-style", strconv.Itoa(listData.Num) + conv.StringFromRune(listData.Delimiter)]);
        } else {
          attrs.push(["data-style", conv.StringFromBytes(listData.Marker)]);
        }
        break;
    }
  }
};

const srcAttrPrefix: Uint8Array = conv.BytesFromString("src=\"");
const quoteBytes: Uint8Array = conv.BytesFromString("\"");
const ampEntityBytes: Uint8Array = conv.BytesFromString("&amp;");
const ampBytes: Uint8Array = conv.BytesFromString("&");
const doubleSlashBytes: Uint8Array = conv.BytesFromString("//");

BaseRenderer.prototype.tagSrc = function (this: BaseRenderer, tokens: Uint8Array): Uint8Array | null {
  const r = this;
  const srcIndex = bytes.Index(tokens, srcAttrPrefix);
  if (0 > srcIndex) {
    return null;
  } else {
    let src: Uint8Array = tokens.subarray(srcIndex + srcAttrPrefix.length);
    const quoteIndex = bytes.Index(src, quoteBytes);
    if (0 > quoteIndex) {
      // UPSTREAM-BUG: src[:-1] panics (slice bounds out of range) when the src attribute value has no closing quote, e.g. `<img src="a`
      // PORT-NOTE: Go panics here
      throw new Error("slice bounds out of range [:-1]");
    }
    src = src.subarray(0, quoteIndex);
    return bytes.ReplaceAllOrNil(src, ampEntityBytes, ampBytes); // nil for an empty src
  }
};

BaseRenderer.prototype.replaceSrc = function (this: BaseRenderer, tokens: Uint8Array, src: string): Uint8Array {
  const r = this;
  let h = util.ParseHTML(conv.StringFromBytes(tokens));
  if (null === h) {
    return tokens;
  }

  h = h.FirstChild;
  util.SetDomAttrValue(h, "src", src);
  return util.DomHTML(h);
};

BaseRenderer.prototype.tagSrcPath = function (this: BaseRenderer, tokens: Uint8Array): Uint8Array {
  const r = this;
  const srcIndex = bytes.Index(tokens, srcAttrPrefix);
  if (0 < srcIndex) {
    const src: Uint8Array = tokens.subarray(srcIndex + srcAttrPrefix.length);
    if (1 > bytes.ReplaceAll(src, editor.CaretTokens, new Uint8Array(0)).length) {
      return tokens;
    }
    const targetSrc = r.LinkPath(src);
    let originSrc = conv.StringFromBytes(targetSrc);
    if (bytes.HasPrefix(targetSrc, doubleSlashBytes)) {
      originSrc = "https:" + originSrc;
    }
    tokens = bytes.ReplaceAll(tokens, src, conv.BytesFromString(originSrc));
  }
  return tokens;
};

BaseRenderer.prototype.isLastNode = function (this: BaseRenderer, treeRoot: ast.Node, node: ast.Node | null): boolean {
  const r = this;
  if (treeRoot === node || null === node || null === node.Parent) {
    return true;
  }
  if (null !== node.Next) {
    return false;
  }
  if (ast.NodeDocument === node.Parent.Type) {
    return treeRoot.LastChild === node;
  }

  let n: ast.Node | null;
  for (n = node.Parent; ; n = n.Parent) {
    if (null === n || null === n.Parent) {
      return true;
    }
    if (ast.NodeDocument === n.Parent.Type) {
      break;
    }
  }
  return treeRoot.LastChild === n;
};

BaseRenderer.prototype.NodeID = function (this: BaseRenderer, node: ast.Node): string {
  const r = this;
  for (const kv of node.KramdownIAL ?? []) { // PORT-NOTE: nil slice, KramdownIAL is nullable
    if ("id" === kv[0]) {
      return kv[1];
    }
  }
  return ast.NewNodeID();
};

BaseRenderer.prototype.NodeAttrs = function (this: BaseRenderer, node: ast.Node): string[][] {
  const r = this;
  const ret: string[][] = [];
  for (const kv of node.KramdownIAL ?? []) {
    if ("id" === kv[0]) {
      continue;
    }
    ret.push(kv);
  }
  return ret;
};

BaseRenderer.prototype.NodeAttrsStr = function (this: BaseRenderer, node: ast.Node): string {
  const r = this;
  let ret = "";
  for (const kv of node.KramdownIAL ?? []) {
    if ("id" === kv[0]) {
      continue;
    }
    ret += kv[0] + "=\"" + kv[1] + "\" ";
  }
  if ("" !== ret) {
    ret = ret.slice(0, ret.length - 1);
  }
  return ret;
};

// languagesNoHighlight lists the languages that must not get code syntax highlighting. These code blocks are rendered by the frontend, for example the various charts.
export const languagesNoHighlight: string[] = ["mermaid", "echarts", "abc", "graphviz", "mindmap", "flowchart", "plantuml", "infographic"];

export function NoHighlight(language: string): boolean {
  if ("" === language) {
    return false;
  }

  for (const langNoHighlight of languagesNoHighlight) {
    if (language === langNoHighlight) {
      return true;
    }
  }
  return false;
}

BaseRenderer.prototype.Text = function (this: BaseRenderer, node: ast.Node): string {
  const r = this;
  let ret = "";
  ast.Walk(node, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering) {
      switch (n.Type) {
        case ast.NodeText:
        case ast.NodeLinkText:
        case ast.NodeLinkDest:
        case ast.NodeLinkSpace:
        case ast.NodeLinkTitle:
        case ast.NodeCodeBlockCode:
        case ast.NodeCodeSpanContent:
        case ast.NodeInlineMathContent:
        case ast.NodeMathBlockContent:
        case ast.NodeYamlFrontMatterContent:
        case ast.NodeHTMLBlock:
        case ast.NodeInlineHTML:
        case ast.NodeEmojiAlias:
        case ast.NodeFileAnnotationRefText:
        case ast.NodeFileAnnotationRefSpace:
        case ast.NodeBlockRefText:
        case ast.NodeBlockRefDynamicText:
        case ast.NodeBlockRefSpace:
        case ast.NodeKramdownSpanIAL:
          ret += conv.StringFromBytes(nodeTokens(n));
          break;
        case ast.NodeCodeBlockFenceInfoMarker:
          ret += conv.StringFromBytes(n.CodeBlockInfo);
          break;
        case ast.NodeLink:
          if (3 === n.LinkType) {
            ret += conv.StringFromBytes(n.LinkRefLabel);
          }
          break;
      }
    }
    return ast.WalkContinue;
  });
  return ret;
};

BaseRenderer.prototype.ParagraphContainImgOnly = function (this: BaseRenderer, paragraph: ast.Node): boolean {
  const r = this;
  let ret = true;
  let containImg = false;
  ast.Walk(paragraph, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if (ast.NodeText === n.Type) {
      if (!util.IsEmptyStr(conv.StringFromBytes(nodeTokens(n)))) {
        ret = false;
        return ast.WalkStop;
      }
    } else if (ast.NodeTextMark === n.Type) {
      ret = false;
      return ast.WalkStop;
    } else if (ast.NodeImage === n.Type) {
      containImg = true;
    }
    return ast.WalkContinue;
  });

  ret = containImg && ret;
  return ret;
};

BaseRenderer.prototype.needUseHTMLTable = function (this: BaseRenderer, table: ast.Node): boolean {
  const r = this;
  let ret = false;
  ast.Walk(table, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    if (ast.NodeTable === n.Type) {
      if ("" !== n.IALAttr("caption")) {
        ret = true;
        return ast.WalkStop;
      }
    } else if (ast.NodeTableCell === n.Type) {
      for (const kv of n.KramdownIAL ?? []) {
        if (("colspan" === kv[0] || "rowspan" === kv[0]) && "1" !== kv[1]) {
          ret = true;
          return ast.WalkStop;
        }
      }
    }
    return ast.WalkContinue;
  });
  return ret;
};

export function RenderHeadingText(n: ast.Node): string {
  const buf = new bytes.Buffer();
  ast.Walk(n, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }

    switch (n.Type) {
      case ast.NodeLinkText:
      case ast.NodeBlockRefText:
      case ast.NodeBlockRefDynamicText:
      case ast.NodeFileAnnotationRefText:
        buf.Write(nodeTokens(n));
        break;
      case ast.NodeInlineMathContent:
        buf.WriteString("<span class=\"language-math\">");
        buf.Write(html.EscapeHTML(nodeTokens(n)));
        buf.WriteString("</span>");
        break;
      case ast.NodeCodeSpanContent:
        buf.WriteString("<code>");
        buf.Write(html.EscapeHTML(nodeTokens(n)));
        buf.WriteString("</code>");
        break;
      case ast.NodeText:
        if (n.ParentIs(ast.NodeStrong)) {
          buf.WriteString("<strong>");
          buf.Write(html.EscapeHTML(nodeTokens(n)));
          buf.WriteString("</strong>");
        } else if (n.ParentIs(ast.NodeEmphasis)) {
          buf.WriteString("<em>");
          buf.Write(html.EscapeHTML(nodeTokens(n)));
          buf.WriteString("</em>");
        } else {
          if (null !== n.Previous && ast.NodeInlineHTML === n.Previous.Type) {
            if (!bytes.HasPrefix(nodeTokens(n.Previous), closeTagPrefix)) {
              buf.Write(nodeTokens(n.Previous));
              buf.Write(html.EscapeHTML(nodeTokens(n)));
            } else {
              buf.Write(nodeTokens(n.Previous));
              buf.Write(html.EscapeHTML(nodeTokens(n)));
            }
          } else {
            buf.Write(html.EscapeHTML(nodeTokens(n)));
          }
        }
        break;
    }
    return ast.WalkContinue;
  });
  return buf.String();
}
