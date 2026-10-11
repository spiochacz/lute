// Ported from lute.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// Package lute provides a structured Markdown engine, supporting Go and JavaScript.

// PORT-NOTE: only the methods of lute.go are attached here. The methods of h2m.go, protyle.go, protyle_tabs.go, vditor_ir.go, vditor_sv.go and vditor_wysiwyg.go are attached in their own files.
// PORT-NOTE: Go's map[string]string arguments and results (emojis, terms) are Map<string, string> here, as in parse.Options and render.Options.

import * as conv from "./runtime/conv.ts";
import * as strings from "./runtime/strings.ts";
import * as ast from "./ast/index.ts";
import * as lex from "./lex/index.ts";
import * as parse from "./parse/index.ts";
import * as render from "./render/index.ts";
import * as util from "./util/index.ts";
import { Lute } from "./types.ts";

export { Lute };

export const Version = "1.7.6";

declare module "./types.ts" {
  interface Lute {
    Markdown(name: string, markdown: Uint8Array): Uint8Array;
    MarkdownStr(name: string, markdown: string): string;
    Format(name: string, markdown: Uint8Array): Uint8Array;
    FormatStr(name: string, markdown: string): string;
    TextBundle(name: string, markdown: Uint8Array, linkPrefixes: string[]): [Uint8Array, string[] | null];
    TextBundleStr(name: string, markdown: string, linkPrefixes: string[]): [string, string[] | null];
    RenderJSON(markdown: string): string;
    Space(text: string): string;
    IsValidLinkDest(str: string): boolean;
    GetLinkDest(str: string): string;
    GetEmojis(): Map<string, string>;
    PutEmojis(emojiMap: Map<string, string>): void;
    RemoveEmoji(str: string): string;
    GetTerms(): Map<string, string>;
    PutTerms(termMap: Map<string, string>): void;
    ProtylePreview(tree: parse.Tree, options: render.Options, parseOptions: parse.Options): string;
    ProtylePreviewStr(name: string, markdown: string): string;
    Tree2HTML(tree: parse.Tree, options: render.Options, parseOptions: parse.Options): string;
    trimLinkPath(path: string): string;
    GetLinkBase(): string;
    SetJSRenderers(options: JSRendererOptions | null | undefined): void;
    SetGFMTable(b: boolean): void;
    SetGFMTaskListItem(b: boolean): void;
    SetArbitraryTaskListItemMarker(b: boolean): void;
    SetGFMTaskListItemClass(cls: string): void;
    SetDataTask(b: boolean): void;
    SetExportNormalizeTaskListMarker(b: boolean): void;
    SetGFMStrikethrough(b: boolean): void;
    SetGFMStrikethrough1(b: boolean): void;
    SetFullWidthStrikethrough(b: boolean): void;
    SetGFMAutoLink(b: boolean): void;
    SetSoftBreak2HardBreak(b: boolean): void;
    SetCodeSyntaxHighlight(b: boolean): void;
    SetCodeSyntaxHighlightDetectLang(b: boolean): void;
    SetCodeSyntaxHighlightInlineStyle(b: boolean): void;
    SetCodeSyntaxHighlightLineNum(b: boolean): void;
    SetCodeSyntaxHighlightStyleName(name: string): void;
    SetFootnotes(b: boolean): void;
    SetToC(b: boolean): void;
    SetHeadingID(b: boolean): void;
    SetAutoSpace(b: boolean): void;
    SetFixTermTypo(b: boolean): void;
    SetEmoji(b: boolean): void;
    SetEmojis(emojis: Map<string, string>): void;
    SetEmojiSite(emojiSite: string): void;
    SetHeadingAnchor(b: boolean): void;
    SetTerms(terms: Map<string, string>): void;
    SetVditorWYSIWYG(b: boolean): void;
    SetProtyleWYSIWYG(b: boolean): void;
    SetVditorIR(b: boolean): void;
    SetVditorSV(b: boolean): void;
    SetInlineMath(b: boolean): void;
    SetInlineMathAllowDigitAfterOpenMarker(b: boolean): void;
    SetLinkPrefix(linkPrefix: string): void;
    SetLinkBase(linkBase: string): void;
    SetVditorCodeBlockPreview(b: boolean): void;
    SetVditorMathBlockPreview(b: boolean): void;
    SetVditorHTMLBlockPreview(b: boolean): void;
    SetRenderListStyle(b: boolean): void;
    SetSanitize(b: boolean): void;
    SetImageLazyLoading(dataSrc: string): void;
    SetChineseParagraphBeginningSpace(b: boolean): void;
    SetYamlFrontMatter(b: boolean): void;
    SetSetext(b: boolean): void;
    SetBlockRef(b: boolean): void;
    SetFileAnnotationRef(b: boolean): void;
    SetMark(b: boolean): void;
    SetKramdownIAL(b: boolean): void;
    SetKramdownBlockIAL(b: boolean): void;
    SetKramdownSpanIAL(b: boolean): void;
    SetKramdownIALIDRenderName(name: string): void;
    SetTag(b: boolean): void;
    SetImgPathAllowSpace(b: boolean): void;
    SetSuperBlock(b: boolean): void;
    SetCustomBlock(b: boolean): void;
    SetSup(b: boolean): void;
    SetSub(b: boolean): void;
    SetInlineAsterisk(b: boolean): void;
    SetInlineUnderscore(b: boolean): void;
    SetGitConflict(b: boolean): void;
    SetLinkRef(b: boolean): void;
    SetIndentCodeBlock(b: boolean): void;
    SetDataImage(b: boolean): void;
    SetTextMark(b: boolean): void;
    SetSpin(b: boolean): void;
    SetHTML2MarkdownAttrs(attrs: string[]): void;
    SetHTMLTag2TextMark(b: boolean): void;
    SetParagraphBeginningSpace(b: boolean): void;
    SetProtyleMarkNetImg(b: boolean): void;
    SetSpellcheck(b: boolean): void;
    SetUnorderedListMarker(marker: string): void;
    SetImgTag(b: boolean): void;
    SetPreventEncodeLinkSpace(b: boolean): void;
    SetCallout(b: boolean): void;
    SetTabs(b: boolean): void;
    SetEnsureListItemParagraph(b: boolean): void;
  }
}

// New creates a new Lute engine.
//
// Parse options enabled by default:
//   - GFM support
//   - Footnotes
//   - Custom heading IDs
//   - Emoji alias replacement, for example :heart: becomes ❤️
//   - YAML Front Matter
//
// Render options enabled by default:
//   - Soft break to hard break
//   - Code block syntax highlighting
//   - Insert spaces between Chinese and Western text
//   - Fix term typos
//   - Custom heading IDs
export function New(...opts: ParseOption[]): Lute {
  const ret = new Lute(parse.NewOptions(), render.NewOptions());
  for (const opt of opts) {
    opt(ret);
  }

  ret.HTML2MdRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  ret.HTML2VditorDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  ret.HTML2VditorIRDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  ret.HTML2BlockDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  ret.HTML2VditorSVDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  ret.Md2HTMLRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  ret.Md2VditorDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  ret.Md2VditorIRDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  ret.Md2BlockDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  ret.Md2VditorSVDOMRendererFuncs = new Map<ast.NodeType, render.ExtRendererFunc>();
  return ret;
}

// Markdown processes the markdown byte array into the corresponding html byte array. The name parameter only identifies the text, for example an id or a title, or "".
Lute.prototype.Markdown = function (this: Lute, name: string, markdown: Uint8Array): Uint8Array {
  const lute = this;
  const tree = parse.Parse(name, markdown, lute.ParseOptions);
  const renderer = render.NewHtmlRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  for (const [nodeType, rendererFunc] of lute.Md2HTMLRendererFuncs) {
    renderer.ExtRendererFuncs.set(nodeType, rendererFunc);
  }
  const html = renderer.Render();
  return html;
};

// MarkdownStr takes a string markdown and calls Markdown directly.
Lute.prototype.MarkdownStr = function (this: Lute, name: string, markdown: string): string {
  const lute = this;
  const htmlBytes = lute.Markdown(name, conv.BytesFromString(markdown));
  const html = util.BytesToStr(htmlBytes);
  return html;
};

// Format formats the markdown byte array.
Lute.prototype.Format = function (this: Lute, name: string, markdown: Uint8Array): Uint8Array {
  const lute = this;
  const tree = parse.Parse(name, markdown, lute.ParseOptions);
  const renderer = render.NewFormatRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  const formatted = renderer.Render();
  return formatted;
};

// FormatStr takes a string markdown and calls Format directly.
Lute.prototype.FormatStr = function (this: Lute, name: string, markdown: string): string {
  const lute = this;
  const formattedBytes = lute.Format(name, conv.BytesFromString(markdown));
  const formatted = util.BytesToStr(formattedBytes);
  return formatted;
};

// TextBundle processes the markdown byte array as a TextBundle.
// PORT-NOTE: the two results become a tuple, as GopherJS hands them to JavaScript (an array [textbundle, originalLinks]). originalLinks is null where Go leaves the slice nil (no link was replaced).
Lute.prototype.TextBundle = function (this: Lute, name: string, markdown: Uint8Array, linkPrefixes: string[]): [Uint8Array, string[] | null] {
  const lute = this;
  const tree = parse.Parse(name, markdown, lute.ParseOptions);
  const renderer = render.NewTextBundleRenderer(tree, linkPrefixes, lute.RenderOptions, lute.ParseOptions);
  const [textbundle, originalLinks] = renderer.Render();
  return [textbundle, originalLinks];
};

// TextBundleStr takes a string markdown and calls TextBundle directly.
Lute.prototype.TextBundleStr = function (this: Lute, name: string, markdown: string, linkPrefixes: string[]): [string, string[] | null] {
  const lute = this;
  const [textbundleBytes, originalLinks] = lute.TextBundle(name, conv.BytesFromString(markdown), linkPrefixes);
  const textbundle = util.BytesToStr(textbundleBytes);
  return [textbundle, originalLinks];
};

declare module "./types.ts" {
  interface Lute {
    HTML2Text(dom: string): string;
  }
}

// HTML2Text 将指定的 HTMl dom 转换为文本。
// Converts the given HTML dom to text.
Lute.prototype.HTML2Text = function (this: Lute, dom: string): string {
  const lute = this;
  const tree = lute.HTML2Tree(dom);
  if (null === tree) {
    return "";
  }
  return tree.Root!.Text();
};

// RenderJSON renders JSON format data.
Lute.prototype.RenderJSON = function (this: Lute, markdown: string): string {
  const lute = this;
  const tree = parse.Parse("", conv.BytesFromString(markdown), lute.ParseOptions);
  const renderer = render.NewJSONRenderer(tree, lute.RenderOptions, lute.ParseOptions);
  const output = renderer.Render();
  const json = util.BytesToStr(output);
  return json;
};

// Space inserts spaces between Chinese and Western characters in text.
Lute.prototype.Space = function (this: Lute, text: string): string {
  return render.Space0(text);
};

// IsValidLinkDest reports whether str is a valid link destination.
Lute.prototype.IsValidLinkDest = function (this: Lute, str: string): boolean {
  str = strings.TrimSpace(str);
  if (strings.HasPrefix(str, "[")) {
    return false;
  }

  const luteEngine = New();
  luteEngine.ParseOptions.GFMAutoLink = true;
  const tree = parse.Parse("", conv.BytesFromString(str), luteEngine.ParseOptions);
  if (null === tree.Root!.FirstChild || null === tree.Root!.FirstChild!.FirstChild) {
    return false;
  }
  if (tree.Root!.LastChild !== tree.Root!.FirstChild) {
    return false;
  }
  if (ast.NodeLink !== tree.Root!.FirstChild!.FirstChild!.Type) {
    return false;
  }
  return true;
};

Lute.prototype.GetLinkDest = function (this: Lute, str: string): string {
  str = strings.TrimSpace(str);
  if (strings.HasPrefix(str, "file://")) {
    return str;
  }

  const luteEngine = New();
  luteEngine.ParseOptions.GFMAutoLink = true;
  const tree = parse.Parse("", conv.BytesFromString(str), luteEngine.ParseOptions);
  if (null === tree.Root!.FirstChild || null === tree.Root!.FirstChild!.FirstChild) {
    return "";
  }
  if (tree.Root!.LastChild !== tree.Root!.FirstChild) {
    return "";
  }
  if (ast.NodeLink !== tree.Root!.FirstChild!.FirstChild!.Type) {
    return "";
  }
  return tree.Root!.FirstChild!.FirstChild!.ChildByType(ast.NodeLinkDest)!.TokensStr();
};

// GetEmojis returns the dictionary of Emoji aliases and the corresponding Unicode characters.
Lute.prototype.GetEmojis = function (this: Lute): Map<string, string> {
  const lute = this;
  // PORT-NOTE: parse.EmojiLock is dropped (no mutexes).
  const ret = new Map<string, string>();
  const placeholder = util.BytesToStr(parse.EmojiSitePlaceholder);
  for (const [k, v0] of lute.ParseOptions.AliasEmoji) {
    let v = v0;
    if (strings.Contains(v, placeholder)) {
      v = strings.ReplaceAll(v, placeholder, lute.ParseOptions.EmojiSite);
    }
    ret.set(k, v);
  }
  return ret;
};

// PutEmojis merges the given emojiMap over the existing Emoji dictionary.
Lute.prototype.PutEmojis = function (this: Lute, emojiMap: Map<string, string>): void {
  const lute = this;
  // PORT-NOTE: parse.EmojiLock is dropped (no mutexes).
  for (const [k, v] of emojiMap) {
    lute.ParseOptions.AliasEmoji.set(k, v);
    lute.ParseOptions.EmojiAlias.set(v, k);
  }
};

// RemoveEmoji removes the Emoji Unicode in str.
Lute.prototype.RemoveEmoji = function (this: Lute, str: string): string {
  const lute = this;
  // PORT-NOTE: parse.EmojiLock is dropped (no mutexes).
  for (const u of lute.ParseOptions.EmojiAlias.keys()) {
    str = strings.ReplaceAll(str, u, "");
  }
  return strings.TrimSpace(str);
};

// GetTerms returns the term dictionary.
Lute.prototype.GetTerms = function (this: Lute): Map<string, string> {
  const lute = this;
  return lute.RenderOptions.Terms;
};

// PutTerms merges the given termMap over the existing term dictionary.
Lute.prototype.PutTerms = function (this: Lute, termMap: Map<string, string>): void {
  const lute = this;
  for (const [k, v] of termMap) {
    lute.RenderOptions.Terms.set(k, v);
  }
};

// PORT-NOTE: Go creates this package-level renderer with a nil tree and nil options and guards it with a mutex; the single shared renderer is kept and the mutex is dropped.
// The null values stand for Go's nil (Tree and Options are non-null types in the port).
const formatRendererSync = render.NewFormatRenderer(null!, null!, null!);

export function FormatNodeSync(node: ast.Node, parseOptions: parse.Options, renderOptions: render.Options): [string, Error | null] {
  // PORT-NOTE: Go's `defer util.RecoverPanic(&err)` is a no-op in this build, so panics propagate as exceptions.
  let ret = "";
  let err: Error | null = null;

  const root = new ast.Node(ast.NodeDocument);
  const tree = new parse.Tree();
  tree.Root = root;
  tree.Context = new parse.Context(parseOptions);
  formatRendererSync.Tree = tree;
  formatRendererSync.Options = renderOptions;
  formatRendererSync.ParseOptions = parseOptions;
  formatRendererSync.LastOut = lex.ItemNewline;
  formatRendererSync.NodeWriterStack = [formatRendererSync.Writer];

  ast.Walk(node, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    const rendererFunc = formatRendererSync.RendererFuncs.get(n.Type);
    if (undefined === rendererFunc) {
      err = new Error("not found renderer for node [type=" + ast.NodeTypeString(n.Type) + "]");
      return ast.WalkStop;
    }
    return rendererFunc(n, entering);
  });

  ret = strings.TrimSpace(formatRendererSync.Writer.String());
  formatRendererSync.Tree = null!;
  formatRendererSync.Options = null!;
  formatRendererSync.Writer.Reset();
  formatRendererSync.NodeWriterStack = [];
  return [ret, err];
}

// PORT-NOTE: Go creates this package-level renderer with a nil tree and nil options and guards it with a mutex; the single shared renderer is kept and the mutex is dropped.
// The null values stand for Go's nil (Tree and Options are non-null types in the port).
const protyleExportMdRendererSync = render.NewProtyleExportMdRenderer(null!, null!, null!);

export function ProtyleExportMdNodeSync(node: ast.Node, parseOptions: parse.Options, renderOptions: render.Options): [string, Error | null] {
  // PORT-NOTE: Go's `defer util.RecoverPanic(&err)` is a no-op in this build, so panics propagate as exceptions.
  let ret = "";
  let err: Error | null = null;

  const root = new ast.Node(ast.NodeDocument);
  const tree = new parse.Tree();
  tree.Root = root;
  tree.Context = new parse.Context(parseOptions);
  protyleExportMdRendererSync.Tree = tree;
  protyleExportMdRendererSync.Options = renderOptions;
  protyleExportMdRendererSync.ParseOptions = parseOptions;
  protyleExportMdRendererSync.LastOut = lex.ItemNewline;
  protyleExportMdRendererSync.NodeWriterStack = [protyleExportMdRendererSync.Writer];

  ast.Walk(node, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    const rendererFunc = protyleExportMdRendererSync.RendererFuncs.get(n.Type);
    if (undefined === rendererFunc) {
      err = new Error("not found renderer for node [type=" + ast.NodeTypeString(n.Type) + "]");
      return ast.WalkStop;
    }
    return rendererFunc(n, entering);
  });

  ret = strings.TrimSpace(protyleExportMdRendererSync.Writer.String());
  protyleExportMdRendererSync.Tree = null!;
  protyleExportMdRendererSync.Options = null!;
  protyleExportMdRendererSync.Writer.Reset();
  protyleExportMdRendererSync.NodeWriterStack = [];
  return [ret, err];
}

// ProtylePreview renders tree as Protyle preview HTML with the given options.
Lute.prototype.ProtylePreview = function (this: Lute, tree: parse.Tree, options: render.Options, parseOptions: parse.Options): string {
  const renderer = render.NewProtylePreviewRenderer(tree, options, parseOptions);
  const output = renderer.Render();
  return util.BytesToStr(output);
};

// ProtylePreviewStr takes a string markdown, parses it internally and calls ProtylePreview to render the preview HTML.
// It is equivalent to the backend export preview chain markdown → parse → ProtylePreview, for the front end's lute.min.js to call directly.
Lute.prototype.ProtylePreviewStr = function (this: Lute, name: string, markdown: string): string {
  const lute = this;
  const tree = parse.Parse(name, conv.BytesFromString(markdown), lute.ParseOptions);
  return lute.ProtylePreview(tree, lute.RenderOptions, lute.ParseOptions);
};

// Tree2HTML renders tree as standard HTML with the given options.
Lute.prototype.Tree2HTML = function (this: Lute, tree: parse.Tree, options: render.Options, parseOptions: parse.Options): string {
  const renderer = render.NewHtmlRenderer(tree, options, parseOptions);
  const output = renderer.Render();
  return util.BytesToStr(output);
};

// ParseOption describes the signature of a parse option setter function.
export type ParseOption = (lute: Lute) => void;

// The following Setters mainly serve the methods exported to JavaScript.

Lute.prototype.SetGFMTable = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.GFMTable = b;
};

Lute.prototype.SetGFMTaskListItem = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.GFMTaskListItem = b;
};

Lute.prototype.SetArbitraryTaskListItemMarker = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.ArbitraryTaskListItemMarker = b;
};

// PORT-NOTE: the parameter `class` is renamed `cls` (reserved word).
Lute.prototype.SetGFMTaskListItemClass = function (this: Lute, cls: string): void {
  const lute = this;
  lute.RenderOptions.GFMTaskListItemClass = cls;
};

Lute.prototype.SetDataTask = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.DataTask = b;
};

Lute.prototype.SetExportNormalizeTaskListMarker = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.ExportNormalizeTaskListMarker = b;
};

Lute.prototype.SetGFMStrikethrough = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.GFMStrikethrough = b;
};

Lute.prototype.SetGFMStrikethrough1 = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.GFMStrikethrough1 = b;
};

Lute.prototype.SetFullWidthStrikethrough = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.FullWidthStrikethrough = b;
};

Lute.prototype.SetGFMAutoLink = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.GFMAutoLink = b;
};

Lute.prototype.SetSoftBreak2HardBreak = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.SoftBreak2HardBreak = b;
};

Lute.prototype.SetCodeSyntaxHighlight = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.CodeSyntaxHighlight = b;
};

Lute.prototype.SetCodeSyntaxHighlightDetectLang = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.CodeSyntaxHighlightDetectLang = b;
};

Lute.prototype.SetCodeSyntaxHighlightInlineStyle = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.CodeSyntaxHighlightInlineStyle = b;
};

Lute.prototype.SetCodeSyntaxHighlightLineNum = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.CodeSyntaxHighlightLineNum = b;
};

Lute.prototype.SetCodeSyntaxHighlightStyleName = function (this: Lute, name: string): void {
  const lute = this;
  lute.RenderOptions.CodeSyntaxHighlightStyleName = name;
};

Lute.prototype.SetFootnotes = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Footnotes = b;
};

Lute.prototype.SetToC = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.ToC = b;
  lute.RenderOptions.ToC = b;
};

Lute.prototype.SetHeadingID = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.HeadingID = b;
  lute.RenderOptions.HeadingID = b;
};

Lute.prototype.SetAutoSpace = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.AutoSpace = b;
};

Lute.prototype.SetFixTermTypo = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.FixTermTypo = b;
};

Lute.prototype.SetEmoji = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Emoji = b;
};

Lute.prototype.SetEmojis = function (this: Lute, emojis: Map<string, string>): void {
  const lute = this;
  lute.ParseOptions.AliasEmoji = emojis;
};

Lute.prototype.SetEmojiSite = function (this: Lute, emojiSite: string): void {
  const lute = this;
  lute.ParseOptions.EmojiSite = emojiSite;
};

Lute.prototype.SetHeadingAnchor = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.HeadingAnchor = b;
};

Lute.prototype.SetTerms = function (this: Lute, terms: Map<string, string>): void {
  const lute = this;
  lute.RenderOptions.Terms = terms;
};

Lute.prototype.SetVditorWYSIWYG = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.VditorWYSIWYG = b;
  lute.RenderOptions.VditorWYSIWYG = b;
};

Lute.prototype.SetProtyleWYSIWYG = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.ProtyleWYSIWYG = b;
  lute.RenderOptions.ProtyleWYSIWYG = b;
};

Lute.prototype.SetVditorIR = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.VditorIR = b;
  lute.RenderOptions.VditorIR = b;
};

Lute.prototype.SetVditorSV = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.VditorSV = b;
  lute.RenderOptions.VditorSV = b;
};

Lute.prototype.SetInlineMath = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.InlineMath = b;
};

Lute.prototype.SetInlineMathAllowDigitAfterOpenMarker = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.InlineMathAllowDigitAfterOpenMarker = b;
};

Lute.prototype.SetLinkPrefix = function (this: Lute, linkPrefix: string): void {
  const lute = this;
  lute.RenderOptions.LinkPrefix = linkPrefix;
};

Lute.prototype.trimLinkPath = function (this: Lute, path: string): string {
  const lute = this;
  const linkPrefix = lute.RenderOptions.LinkPrefix;
  if ("" !== linkPrefix) {
    path = strings.TrimPrefix(path, linkPrefix);
  }

  let linkBase = lute.RenderOptions.LinkBase;
  if ("" !== linkBase) {
    if (!strings.HasSuffix(linkBase, "/")) {
      linkBase += "/";
    }
    path = strings.TrimPrefix(path, linkBase);
  }
  return path;
};

Lute.prototype.SetLinkBase = function (this: Lute, linkBase: string): void {
  const lute = this;
  lute.RenderOptions.LinkBase = linkBase;
};

Lute.prototype.GetLinkBase = function (this: Lute): string {
  const lute = this;
  return lute.RenderOptions.LinkBase;
};

Lute.prototype.SetVditorCodeBlockPreview = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.VditorCodeBlockPreview = b;
};

Lute.prototype.SetVditorMathBlockPreview = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.VditorMathBlockPreview = b;
};

Lute.prototype.SetVditorHTMLBlockPreview = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.VditorHTMLBlockPreview = b;
};

Lute.prototype.SetRenderListStyle = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.RenderListStyle = b;
};

// SetSanitize set to true filters the output for XSS.
// Note: Lute's current implementation has some loopholes, do not rely on it to defend against XSS attacks.
Lute.prototype.SetSanitize = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.Sanitize = b;
};

Lute.prototype.SetImageLazyLoading = function (this: Lute, dataSrc: string): void {
  const lute = this;
  lute.RenderOptions.ImageLazyLoading = dataSrc;
};

Lute.prototype.SetChineseParagraphBeginningSpace = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.ChineseParagraphBeginningSpace = b;
};

Lute.prototype.SetYamlFrontMatter = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.YamlFrontMatter = b;
};

Lute.prototype.SetSetext = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Setext = b;
};

Lute.prototype.SetBlockRef = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.BlockRef = b;
};

Lute.prototype.SetFileAnnotationRef = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.FileAnnotationRef = b;
};

Lute.prototype.SetMark = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Mark = b;
};

Lute.prototype.SetKramdownIAL = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.KramdownBlockIAL = b;
  lute.ParseOptions.KramdownSpanIAL = b;
  lute.RenderOptions.KramdownBlockIAL = b;
  lute.RenderOptions.KramdownSpanIAL = b;
};

Lute.prototype.SetKramdownBlockIAL = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.KramdownBlockIAL = b;
  lute.RenderOptions.KramdownBlockIAL = b;
};

Lute.prototype.SetKramdownSpanIAL = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.KramdownSpanIAL = b;
  lute.RenderOptions.KramdownSpanIAL = b;
};

Lute.prototype.SetKramdownIALIDRenderName = function (this: Lute, name: string): void {
  const lute = this;
  lute.RenderOptions.KramdownIALIDRenderName = name;
};

Lute.prototype.SetTag = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Tag = b;
};

Lute.prototype.SetImgPathAllowSpace = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.ImgPathAllowSpace = b;
};

Lute.prototype.SetSuperBlock = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.SuperBlock = b;
  lute.RenderOptions.SuperBlock = b;
};

Lute.prototype.SetCustomBlock = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.CustomBlock = b;
};

Lute.prototype.SetSup = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Sup = b;
};

Lute.prototype.SetSub = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Sub = b;
};

Lute.prototype.SetInlineAsterisk = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.InlineAsterisk = b;
};

Lute.prototype.SetInlineUnderscore = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.InlineUnderscore = b;
};

Lute.prototype.SetGitConflict = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.GitConflict = b;
};

Lute.prototype.SetLinkRef = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.LinkRef = b;
};

Lute.prototype.SetIndentCodeBlock = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.IndentCodeBlock = b;
};

Lute.prototype.SetDataImage = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.DataImage = b;
};

Lute.prototype.SetTextMark = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.TextMark = b;
};

Lute.prototype.SetSpin = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Spin = b;
};

Lute.prototype.SetHTML2MarkdownAttrs = function (this: Lute, attrs: string[]): void {
  const lute = this;
  lute.ParseOptions.HTML2MarkdownAttrs = attrs;
};

Lute.prototype.SetHTMLTag2TextMark = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.HTMLTag2TextMark = b;
};

Lute.prototype.SetParagraphBeginningSpace = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.ParagraphBeginningSpace = b;
  lute.RenderOptions.KeepParagraphBeginningSpace = b;
};

Lute.prototype.SetProtyleMarkNetImg = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.ProtyleMarkNetImg = b;
};

Lute.prototype.SetSpellcheck = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.Spellcheck = b;
};

Lute.prototype.SetUnorderedListMarker = function (this: Lute, marker: string): void {
  const lute = this;
  lute.RenderOptions.UnorderedListMarker = marker;
};

Lute.prototype.SetImgTag = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.ImgTag = b;
};

Lute.prototype.SetPreventEncodeLinkSpace = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.RenderOptions.PreventEncodeLinkSpace = b;
};

Lute.prototype.SetCallout = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Callout = b;
};

Lute.prototype.SetTabs = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.Tabs = b;
};

Lute.prototype.SetEnsureListItemParagraph = function (this: Lute, b: boolean): void {
  const lute = this;
  lute.ParseOptions.EnsureListItemParagraph = b;
};

// JSRendererOptions describes the argument of SetJSRenderers: Go's map[string]map[string]*js.Object, an object whose "renderers" member maps
// renderer type names to objects of render functions.
export type JSRendererOptions = Record<string, unknown>;

// PORT-NOTE: Go's SetJSRenderers is written against GopherJS (js.Object); this is the same contract in native JavaScript. The `node` that the user functions
// receive is the port's ast.Node; the GopherJS wrapper (js.MakeWrapper) exposes the Go methods under their Go names, and so does ast.Node here (TokensStr, Text, ...),
// but the wrapper does not expose fields while ast.Node does.
// The error messages are those of Go's panics in the GopherJS build.
Lute.prototype.SetJSRenderers = function (this: Lute, options: JSRendererOptions | null | undefined): void {
  const lute = this;
  const renderers: unknown = null === options || undefined === options ? undefined : options["renderers"];
  if ("object" !== typeof renderers || null === renderers) {
    return; // Ranging over a nil map does nothing
  }
  for (const rendererType of Object.keys(renderers)) {
    const extRendererValue: unknown = (renderers as Record<string, unknown>)[rendererType];
    // A little format validation: only a plain object (Go map[string]interface{}) is accepted
    if ("object" !== typeof extRendererValue || null === extRendererValue || Array.isArray(extRendererValue)) {
      throw new Error("invalid type [" + rendererType + "]");
    }

    let rendererFuncs: Map<ast.NodeType, render.ExtRendererFunc>;
    if ("HTML2Md" === rendererType) {
      rendererFuncs = lute.HTML2MdRendererFuncs;
    } else if ("HTML2VditorDOM" === rendererType) {
      rendererFuncs = lute.HTML2VditorDOMRendererFuncs;
    } else if ("HTML2VditorIRDOM" === rendererType) {
      rendererFuncs = lute.HTML2VditorIRDOMRendererFuncs;
    } else if ("HTML2BlockDOM" === rendererType) {
      rendererFuncs = lute.HTML2BlockDOMRendererFuncs;
    } else if ("HTML2VditorSVDOM" === rendererType) {
      rendererFuncs = lute.HTML2VditorSVDOMRendererFuncs;
    } else if ("Md2HTML" === rendererType) {
      rendererFuncs = lute.Md2HTMLRendererFuncs;
    } else if ("Md2VditorDOM" === rendererType) {
      rendererFuncs = lute.Md2VditorDOMRendererFuncs;
    } else if ("Md2VditorIRDOM" === rendererType) {
      rendererFuncs = lute.Md2VditorIRDOMRendererFuncs;
    } else if ("Md2BlockDOM" === rendererType) {
      rendererFuncs = lute.Md2BlockDOMRendererFuncs;
    } else if ("Md2VditorSVDOM" === rendererType) {
      rendererFuncs = lute.Md2VditorSVDOMRendererFuncs;
    } else {
      throw new Error("unknown ext renderer func [" + rendererType + "]");
    }

    const extRenderer = extRendererValue as Record<string, unknown>;
    const renderFuncs = extRenderer;
    for (let funcName of Object.keys(renderFuncs)) {
      const nodeType = "Node" + funcName.slice("render".length);
      rendererFuncs.set(ast.Str2NodeType(nodeType), (node: ast.Node, entering: boolean): [string, ast.WalkStatus] => {
        // The function is looked up by the CURRENT type name of the node at call time
        funcName = "render" + ast.NodeTypeString(node.Type).slice("Node".length);
        const fn = extRenderer[funcName];
        if ("function" !== typeof fn) {
          throw new TypeError("extRenderer[" + funcName + "] is not a function");
        }
        const ret: unknown = fn.call(extRenderer, node, entering);
        if (!Array.isArray(ret)) {
          throw new Error("interface conversion: interface is " + goTypeName(ret) + ", not []interface {}");
        }
        if ("string" !== typeof ret[0]) {
          throw new Error("interface conversion: interface is " + goTypeName(ret[0]) + ", not string");
        }
        if ("number" !== typeof ret[1]) {
          throw new Error("interface conversion: interface is " + goTypeName(ret[1]) + ", not float64");
        }
        return [ret[0], ret[1]];
      });
    }
  }
};

// goTypeName names the Go dynamic type of a JavaScript value as GopherJS converts it to interface{}, for the messages above.
function goTypeName(v: unknown): string {
  switch (typeof v) {
    case "string":
      return "string";
    case "number":
      return "float64";
    case "boolean":
      return "bool";
    case "object":
      return null === v ? "nil" : Array.isArray(v) ? "[]interface {}" : "map[string]interface {}";
    default:
      return typeof v;
  }
}
