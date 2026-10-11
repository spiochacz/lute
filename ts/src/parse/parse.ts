// Ported from parse/parse.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as conv from "../runtime/conv.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as lex from "../lex/index.ts";
import type { delimiter } from "./delimiter.ts";
// PORT-NOTE: lazy emoji tables. Go's NewOptions copies the package-level maps EmojiAliasUnicode and EmojiUnicodeAlias (emoji_map.go) into every Options.
// The port of emoji_map.go must export these two accessor functions, which build the maps on first call and return the SAME Map object on every call:
//   export function EmojiAliasUnicodeMap(): Map<string, string>;  // Go: var EmojiAliasUnicode (alias -> unicode)
//   export function EmojiUnicodeAliasMap(): Map<string, string>;  // Go: var EmojiUnicodeAlias (unicode -> alias), built from EmojiAliasUnicode
// Options.AliasEmoji and Options.EmojiAlias are accessor properties that call them on first read; see the class.
import { EmojiAliasUnicodeMap, EmojiUnicodeAliasMap } from "./emoji_map.ts";
import { IAL2Tokens, Tokens2IAL } from "./inline_attribute_list.ts";
import { paragraphFinalize } from "./paragraph.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    finalParseBlockIAL(): void;
  }
  interface Context {
    advanceOffset(count: number, columns: boolean): void;
    advanceNextNonspace(): void;
    findNextNonspace(): void;
    closeUnmatchedBlocks(): void;
    closeSuperBlockChildren(): void;
    finalize(block: ast.Node): void;
    addChildMarker(nodeType: ast.NodeType, tokens: Uint8Array | null): ast.Node;
    addChild(nodeType: ast.NodeType): ast.Node;
    listsMatch(listData: ast.ListData, itemData: ast.ListData): boolean;
    ParentTip(): void;
    TipAppendChild(child: ast.Node): void;
  }
}

// PORT-NOTE: Go's ID[:14] slices bytes. IDs made by ast.NewNodeID() are ASCII, so a UTF-16 slice is the same. An ID that comes from a user's IAL (`id="..."`) is arbitrary:
// UPSTREAM-BUG: Go panics when such an ID is shorter than 14 bytes (e.g. protyle option on, markdown `{: id="abc"}` after a block), and cuts bytes (maybe inside a rune) when it is longer.
// idHead14 reproduces both for those IDs.
function idHead14(id: string): string {
  const n = utf8.ByteLen(id);
  if (14 > n) {
    // PORT-NOTE: Go panics here (slice bounds out of range)
    throw new Error("runtime error: slice bounds out of range [:14] with length " + n);
  }
  if (n === id.length) {
    return id.slice(0, 14);
  }
  // PORT-NOTE: byte offset
  return conv.StringFromBytes(conv.BytesFromString(id).subarray(0, 14));
}

// Parse parses the raw Markdown text bytes into a syntax tree.
export function Parse(name: string, markdown: Uint8Array, options: Options): Tree {
  return parse(name, markdown, options, false);
}

// The task list probe mode of parse skips the inline parsing only when the first block is a plain non-empty paragraph.
export function parse(name: string, markdown: Uint8Array, options: Options, taskListProbe: boolean): Tree {
  const tree = new Tree();
  tree.Name = name;
  tree.Context = new Context(options);
  tree.Context.Tree = tree;
  tree.lexer = lex.NewLexer(markdown);
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.parseBlocks();
  const first = tree.Root.FirstChild;
  if (taskListProbe && null !== first && ast.NodeParagraph === first.Type && null !== first.Tokens && 0 < first.Tokens.length) {
    tree.lexer = null;
    return tree;
  }
  tree.parseInlines();
  tree.finalParseBlockIAL();
  tree.finalParseTabs();
  tree.finalParseTableCellRich();
  tree.lexer = null;
  return tree;
}

Tree.prototype.finalParseBlockIAL = function (this: Tree): void {
  const t = this;
  if (!t.Context!.ParseOption.KramdownBlockIAL) {
    return;
  }

  // Fill in empty paragraphs
  const appends: ast.Node[] = [];

  ast.Walk(t.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering || !n.IsBlock() || ast.NodeKramdownBlockIAL === n.Type) {
      return ast.WalkContinue;
    }

    if (ast.NodeBlockquote === n.Type && null !== n.FirstChild && null === n.FirstChild.Next) {
      appends.push(n);
    }

    if ("" === n.ID) {
      let id = n.IALAttr("id");
      if ("" === id) {
        id = ast.NewNodeID();
      }
      n.ID = id;

      if (t.Context!.ParseOption.ProtyleWYSIWYG && t.Context!.ParseOption.Spin &&
        ast.NodeDocument !== n.Type && null !== n.Next && ast.NodeKramdownBlockIAL !== n.Next.Type && "" !== n.Next.ID) {
        // This node was newly generated after the spin: give it the ID and attributes of n.Next and treat n.Next as the new node https://github.com/siyuan-note/siyuan/issues/5723
        n.ID = n.Next.ID;
        n.KramdownIAL = n.Next.KramdownIAL;
        if ("" === n.IALAttr("updated")) {
          n.SetIALAttr("updated", idHead14(n.ID));
        }
        n.Next.ID = ast.NewNodeID();
        n.Next.KramdownIAL = null;
        n.Next.SetIALAttr("id", n.Next.ID);
        n.Next.SetIALAttr("updated", n.Next.ID.slice(0, 14)); // PORT-NOTE: ASCII, made by ast.NewNodeID()
        if (null !== n.Next.Next && ast.NodeKramdownBlockIAL === n.Next.Next.Type) {
          n.Next.Next.Tokens = IAL2Tokens(n.Next.KramdownIAL);
        }
        n.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, IAL2Tokens(n.KramdownIAL)));
        return ast.WalkContinue;
      }
    }

    const ial = n.Next;
    if (null === ial || ast.NodeKramdownBlockIAL !== ial.Type) {
      if (t.Context!.ParseOption.ProtyleWYSIWYG) {
        n.SetIALAttr("id", n.ID);
        n.SetIALAttr("updated", idHead14(n.ID));
      }
      return ast.WalkContinue;
    }

    n.KramdownIAL = Tokens2IAL(ial.Tokens);
    if ("" === n.IALAttr("updated") && t.Context!.ParseOption.ProtyleWYSIWYG) {
      n.SetIALAttr("updated", idHead14(n.ID));
      ial.Tokens = IAL2Tokens(n.KramdownIAL);
    }
    return ast.WalkContinue;
  });

  for (const n of appends) {
    const id = ast.NewNodeID();
    const ialTokens = conv.BytesFromString("{: id=\"" + id + "\"}");
    const p = new ast.Node(ast.NodeParagraph);
    p.ID = id;
    p.KramdownIAL = [["id", id], ["updated", id.slice(0, 14)]]; // PORT-NOTE: ASCII, made by ast.NewNodeID()
    p.ID = id;
    p.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, ialTokens));
    if (null !== n.Next && ast.NodeKramdownBlockIAL === n.Next.Type &&
      ast.NodeBlockquote === n.Type && null !== n.FirstChild && ast.NodeBlockquoteMarker === n.FirstChild.Type &&
      null === n.FirstChild.Next) {
      const text = new ast.Node(ast.NodeText, editor.CaretTokens);
      p.AppendChild(text);
    }
    n.AppendChild(p);
  }

  let docIAL: ast.Node;
  let id = "";
  if (null !== t.Context!.rootIAL) {
    docIAL = t.Context!.rootIAL;
  } else {
    id = ast.NewNodeID();
    docIAL = new ast.Node(ast.NodeKramdownBlockIAL, conv.BytesFromString("{: id=\"" + id + "\" updated=\"" + id.slice(0, 14) + "\" type=\"doc\"}")); // PORT-NOTE: ASCII, made by ast.NewNodeID()
    t.Root!.ID = id;
    t.ID = id;
  }
  t.Root!.AppendChild(docIAL);
};

// Block parses the raw Markdown text bytes into a syntax tree whose first block-level child is a paragraph node.
export function Block(name: string, markdown: Uint8Array, options: Options): Tree {
  const tree = new Tree();
  tree.Name = name;
  tree.Context = new Context(options);
  tree.Context.Tree = tree;
  tree.lexer = lex.NewLexer(markdown);
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.parseBlocks();
  tree.finalParseBlockIAL();
  tree.finalParseTabs();
  tree.lexer = null;
  return tree;
}

// Inline parses the raw Markdown text bytes into a syntax tree whose first block-level child is a paragraph node.
export function Inline(name: string, markdown: Uint8Array, options: Options): Tree {
  const tree = new Tree();
  tree.Name = name;
  tree.Context = new Context(options);
  tree.Context.Tree = tree;
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.Root.AppendChild(new ast.Node(ast.NodeParagraph, markdown));
  tree.parseInlines();
  tree.lexer = null;
  return tree;
}

// PORT-NOTE: `type Context struct` is declared in types.ts (see PORTING.md). Fields, in Go's order:
// Tree, ParseOption, Tip, oldtip, currentLine, currentLineLen, offset, column, nextNonspace, nextNonspaceColumn, indent, indented, blank, partiallyConsumedTab, allClosed, lastMatchedContainer, rootIAL, tabs, tabsItemIAL.

// InlineContext describes the inline-level parse context.
export class InlineContext {
  tokens: Uint8Array; // Tokens being parsed
  tokensLen: number; // Length of the tokens being parsed
  pos: number; // Current token position
  delimiters: delimiter | null; // Delimiter stack, for emphasis parsing
  brackets: delimiter | null; // Bracket stack, for image and link parsing

  constructor() {
    this.tokens = new Uint8Array(0);
    this.tokensLen = 0;
    this.pos = 0;
    this.delimiters = null;
    this.brackets = null;
  }
}

// advanceOffset moves count characters forward; columns says whether a tab needs space compensation.
Context.prototype.advanceOffset = function (this: Context, count: number, columns: boolean): void {
  const context = this;
  const currentLine = context.currentLine;
  let charsToTab = 0;
  let charsToAdvance = 0;
  let c = 0;
  for (; 0 < count;) {
    c = currentLine[context.offset];
    if (lex.ItemTab === c) {
      charsToTab = 4 - (context.column % 4);
      if (columns) {
        context.partiallyConsumedTab = charsToTab > count;
        if (context.partiallyConsumedTab) {
          charsToAdvance = count;
        } else {
          charsToAdvance = charsToTab;
          context.offset++;
        }
        context.column += charsToAdvance;
        count -= charsToAdvance;
      } else {
        context.partiallyConsumedTab = false;
        context.column += charsToTab;
        context.offset++;
        count--;
      }
    } else {
      context.partiallyConsumedTab = false;
      context.offset++;
      context.column++; // Assume ASCII, because block start markers are all ASCII
      count--;
    }
  }
};

// advanceNextNonspace moves ahead to the next non-space position.
Context.prototype.advanceNextNonspace = function (this: Context): void {
  const context = this;
  context.offset = context.nextNonspace;
  context.column = context.nextNonspaceColumn;
  context.partiallyConsumedTab = false;
};

// findNextNonspace finds the next non-space character.
Context.prototype.findNextNonspace = function (this: Context): void {
  const context = this;
  let i = context.offset;
  let cols = context.column;

  let token = 0;
  for (;;) {
    token = context.currentLine[i];
    if (lex.ItemSpace === token) {
      i++;
      cols++;
    } else if (lex.ItemTab === token) {
      i++;
      cols += 4 - (cols % 4);
    } else {
      break;
    }
  }

  context.blank = lex.ItemNewline === token;
  context.nextNonspace = i;
  context.nextNonspaceColumn = cols;
  context.indent = context.nextNonspaceColumn - context.column;
  context.indented = 4 <= context.indent;
};

// closeUnmatchedBlocks finalizes all unmatched block nodes.
Context.prototype.closeUnmatchedBlocks = function (this: Context): void {
  const context = this;
  if (!context.allClosed) {
    for (; context.oldtip !== context.lastMatchedContainer;) {
      const parent = context.oldtip!.Parent;
      context.finalize(context.oldtip!);
      context.oldtip = parent;
    }
    context.allClosed = true;
  }
};

// closeSuperBlockChildren finalizes the child nodes under a super block.
Context.prototype.closeSuperBlockChildren = function (this: Context): void {
  const context = this;
  for (let n = context.Tip; null !== n && ast.NodeSuperBlock !== n.Type; n = n.Parent) {
    context.finalize(n);
  }
};

// finalize runs the finalization of block. Calling it sets context.Tip to the parent of block.
Context.prototype.finalize = function (this: Context, block: ast.Node): void {
  const context = this;
  const parent = block.Parent;
  block.Close = true;

  // Node finalization. For example a fenced code block extracts its info part; an HTML block trims trailing spaces; a paragraph parses link reference definitions.
  switch (block.Type) {
    case ast.NodeCodeBlock:
      context.codeBlockFinalize(block);
      break;
    case ast.NodeHTMLBlock:
    case ast.NodeIFrame:
    case ast.NodeVideo:
    case ast.NodeAudio:
    case ast.NodeWidget:
      context.htmlBlockFinalize(block);
      break;
    case ast.NodeParagraph: {
      const insertTable = paragraphFinalize(block, context);
      if (insertTable) {
        return;
      }
      break;
    }
    case ast.NodeMathBlock:
      context.mathBlockFinalize(block);
      break;
    case ast.NodeYamlFrontMatter:
      context.yamlFrontMatterFinalize(block);
      break;
    case ast.NodeList:
      context.listFinalize(block);
      break;
    case ast.NodeSuperBlock:
      context.superBlockFinalize(block);
      break;
    case ast.NodeGitConflict:
      context.gitConflictFinalize(block);
      break;
    case ast.NodeCustomBlock:
      context.customBlockFinalize(block);
      break;
    case ast.NodeCallout:
      context.calloutFinalize(block);
      break;
    case ast.NodeTabs:
    case ast.NodeTabItem:
      context.tabsFinalize(block);
      break;
    case ast.NodeBlockquote:
      context.blockquoteFinalize(block);
      break;
  }

  context.Tip = parent;
};

// addChildMarker builds a node of type nodeType and adds it as a child to the tip node context.Tip.
Context.prototype.addChildMarker = function (this: Context, nodeType: ast.NodeType, tokens: Uint8Array | null): ast.Node {
  const context = this;
  const ret = new ast.Node(nodeType, tokens);
  ret.Close = true;
  context.Tip!.AppendChild(ret);
  return ret;
};

// addChild builds a node of type nodeType and adds it as a child to the tip node context.Tip. If the tip cannot accept it (a non-container block cannot have children),
// the tip is finalized and the search goes up through the parents until one accepts the child. The child then becomes the new tip.
Context.prototype.addChild = function (this: Context, nodeType: ast.NodeType): ast.Node {
  const context = this;
  if (ast.NodeTabs === context.Tip!.Type && !context.Tip!.CanContain(nodeType)) {
    // Body without a tab item marker goes into an empty-title tab, so the tolerant parse does not move the content out of the container.
    const item = new ast.Node(ast.NodeTabItem);
    context.Tip!.AppendChild(item);
    context.Tip = item;
  }
  for (; !context.Tip!.CanContain(nodeType);) {
    context.finalize(context.Tip!); // Note that finalize iterates towards the parent
  }

  const ret = new ast.Node(nodeType);
  context.Tip!.AppendChild(ret);
  context.Tip = ret;
  return ret;
};

// listsMatch reports whether the given listData and itemData can belong to the same list.
Context.prototype.listsMatch = function (this: Context, listData: ast.ListData, itemData: ast.ListData): boolean {
  return listData.Typ === itemData.Typ &&
    ((0 === listData.Delimiter && 0 === itemData.Delimiter) || listData.Delimiter === itemData.Delimiter) &&
    listData.BulletChar === itemData.BulletChar;
};

// PORT-NOTE: `type Tree struct` is declared in types.ts (see PORTING.md). Fields, in Go's order:
// Root, Context, lexer, inlineContext, Name, ID, Box, Path, HPath, Marks, Created, Updated, Hash, linkRefDefs, linkRefDefsFolded, linkRefDefIndexed, footnotesDefs, footnotesDefsIndex.

// Options describes the parse options.
export class Options {
  // DisableTableCellRich forbids recursively expanding the rich text of cells inside a rich text fragment.
  DisableTableCellRich: boolean;
  // GFMTable sets whether "GFM table" support is on.
  GFMTable: boolean;
  // GFMTaskListItem sets whether "GFM task list item" support is on.
  GFMTaskListItem: boolean;
  // GFMStrikethrough sets whether "GFM strikethrough" support is on.
  GFMStrikethrough: boolean;
  // GFMStrikethrough1 sets whether "GFM strikethrough" with a single marker ~ is supported.
  // GFM strikethrough supports two markers ~~, this option adds support for a single-marker strikethrough.
  GFMStrikethrough1: boolean;
  // FullWidthStrikethrough sets whether two full-width tildes are supported as the strikethrough marker.
  FullWidthStrikethrough: boolean;
  // GFMAutoLink sets whether "GFM autolink" support is on.
  GFMAutoLink: boolean;
  // Footnotes sets whether "footnotes" support is on.
  Footnotes: boolean;
  // HeadingID sets whether "custom heading ID" support is on.
  HeadingID: boolean;
  // ToC sets whether "table of contents" support is on.
  ToC: boolean;
  // Emoji sets whether Emoji aliases are replaced with native Unicode characters.
  Emoji: boolean;
  // AliasEmoji stores the mapping from ASCII alias to emoji Unicode.
  // PORT-NOTE: lazy emoji tables. AliasEmoji is an accessor property over this backing field (declared here, at Go's field position). Read: when nothing was assigned,
  // the map from EmojiAliasUnicodeMap() is returned (the same object every time). Write: keeps the assigned map, as Go's `options.AliasEmoji = m`.
  _AliasEmoji: Map<string, string> | null;
  // EmojiAlias stores the mapping from emoji Unicode to ASCII alias.
  // PORT-NOTE: lazy emoji tables. Same as AliasEmoji, over EmojiUnicodeAliasMap().
  _EmojiAlias: Map<string, string> | null;
  // EmojiSite sets the path prefix of image Emoji URLs.
  EmojiSite: string;
  // Vditor WYSIWYG support.
  VditorWYSIWYG: boolean;
  // Vditor instant rendering support.
  VditorIR: boolean;
  // Vditor split view preview support.
  VditorSV: boolean;
  // Protyle WYSIWYG support.
  ProtyleWYSIWYG: boolean;
  // ProtyleWYSIWYGAutoLink sets whether autolink parsing is enabled in Protyle WYSIWYG mode.
  ProtyleWYSIWYGAutoLink: boolean;
  // InlineMath sets whether inline math $foo$ support is on.
  InlineMath: boolean;
  // InlineMathAllowDigitAfterOpenMarker sets whether a digit may directly follow the opening $ of inline math https://github.com/b3log/lute/issues/38
  InlineMathAllowDigitAfterOpenMarker: boolean;
  // Setext sets whether Setext headings are parsed https://github.com/88250/lute/issues/50
  Setext: boolean;
  // YamlFrontMatter sets whether YAML Front Matter support is on.
  YamlFrontMatter: boolean;
  // BlockRef sets whether content block reference support is on.
  BlockRef: boolean;
  // FileAnnotationRef sets whether file annotation reference support is on.
  FileAnnotationRef: boolean;
  // Mark sets whether ==mark== support is on.
  Mark: boolean;
  // KramdownBlockIAL sets whether kramdown block-level inline attribute lists are supported. https://kramdown.gettalong.org/syntax.html#inline-attribute-lists
  KramdownBlockIAL: boolean;
  // KramdownSpanIAL sets whether kramdown span-level inline attribute lists are supported.
  KramdownSpanIAL: boolean;
  // Tag sets whether #tag# support is on.
  Tag: boolean;
  // ImgPathAllowSpace sets whether image paths may contain spaces.
  ImgPathAllowSpace: boolean;
  // SuperBlock sets whether super blocks are supported. https://github.com/88250/lute/issues/111
  SuperBlock: boolean;
  // CustomBlock sets whether custom blocks are supported. https://github.com/siyuan-note/siyuan/issues/8418
  CustomBlock: boolean;
  // Sup sets whether ^superscript^ support is on.
  Sup: boolean;
  // Sub sets whether ~subscript~ support is on.
  Sub: boolean;
  // InlineAsterisk sets whether the inline * syntax (*foo* and **foo**) is supported.
  InlineAsterisk: boolean;
  // InlineUnderscore sets whether the inline _ syntax (_foo_ and __foo__) is supported.
  InlineUnderscore: boolean;
  // GitConflict sets whether Git conflict markers are supported.
  GitConflict: boolean;
  // LinkRef sets whether "link reference" support is on.
  LinkRef: boolean;
  // IndentCodeBlock sets whether "indented code block" support is on.
  IndentCodeBlock: boolean;
  // ParagraphBeginningSpace sets whether "paragraph beginning space" support is on.
  ParagraphBeginningSpace: boolean;
  // DataImage sets whether images of the form ![foo](data:image...) are supported.
  DataImage: boolean;
  // TextMark sets whether the generic inline node parsing is supported.
  TextMark: boolean;
  // HTMLTag2TextMark sets whether some HTML tags are parsed into TextMark nodes.
  // Only <u>, <kbd>, <sub>, <sup>, <strong>/<b>, <em>/<i>, <s>/<del>/<strike> and <mark> are supported for now.
  //
  // * In h2m, even when inline syntax is disabled, HTMLTag2TextMark still converts to Markdown markers, because h2m does not go through parse
  // * In parse, when an HTML tag is met and HTMLTag2TextMark is on, it is converted to a TextMark node
  // So in both cases it amounts to enabling inline syntax when rendering Protyle DOM
  HTMLTag2TextMark: boolean;
  // Spin sets whether spin parsing is on. This option is only for the spin internals, mind the scenario when setting it.
  //
  // The option was introduced to decide whether finalParseBlockIAL has to move IAL nodes: only during a spin do IAL nodes need moving.
  // Other scenarios, such as splitting a heading block at a soft line break https://github.com/siyuan-note/siyuan/issues/5723 and splitting blocks at a soft-break blank line https://ld246.com/article/1703839312585
  // need the IAL node moved, but Markdown input through the API https://github.com/siyuan-note/siyuan/issues/6725) does not
  Spin: boolean;
  // HTML2MarkdownAttrs sets the list of attributes kept when converting HTML to Markdown
  HTML2MarkdownAttrs: string[];
  // Callout sets whether callouts are supported.
  Callout: boolean;

  // Tabs sets whether tab containers are supported.
  Tabs: boolean;
  // KeepEscaped sets whether escaped content is kept (not unescaped).
  KeepEscaped: boolean;
  // ArbitraryTaskListItemMarker sets whether "arbitrary task list markers" are supported.
  // By default only [ ], [x] and [X] are supported; when on, arbitrary markers such as [/], [>], [-] and [!] are supported.
  ArbitraryTaskListItemMarker: boolean;
  // EnsureListItemParagraph, when true, adds an empty paragraph before a sublist is created under an empty list item,
  // so a list is not attached directly under the list item https://github.com/siyuan-note/siyuan/issues/17890
  EnsureListItemParagraph: boolean;

  constructor() {
    this.DisableTableCellRich = false;
    this.GFMTable = false;
    this.GFMTaskListItem = false;
    this.GFMStrikethrough = false;
    this.GFMStrikethrough1 = false;
    this.FullWidthStrikethrough = false;
    this.GFMAutoLink = false;
    this.Footnotes = false;
    this.HeadingID = false;
    this.ToC = false;
    this.Emoji = false;
    this._AliasEmoji = null;
    this._EmojiAlias = null;
    this.EmojiSite = "";
    this.VditorWYSIWYG = false;
    this.VditorIR = false;
    this.VditorSV = false;
    this.ProtyleWYSIWYG = false;
    this.ProtyleWYSIWYGAutoLink = false;
    this.InlineMath = false;
    this.InlineMathAllowDigitAfterOpenMarker = false;
    this.Setext = false;
    this.YamlFrontMatter = false;
    this.BlockRef = false;
    this.FileAnnotationRef = false;
    this.Mark = false;
    this.KramdownBlockIAL = false;
    this.KramdownSpanIAL = false;
    this.Tag = false;
    this.ImgPathAllowSpace = false;
    this.SuperBlock = false;
    this.CustomBlock = false;
    this.Sup = false;
    this.Sub = false;
    this.InlineAsterisk = false;
    this.InlineUnderscore = false;
    this.GitConflict = false;
    this.LinkRef = false;
    this.IndentCodeBlock = false;
    this.ParagraphBeginningSpace = false;
    this.DataImage = false;
    this.TextMark = false;
    this.HTMLTag2TextMark = false;
    this.Spin = false;
    this.HTML2MarkdownAttrs = [];
    this.Callout = false;
    this.Tabs = false;
    this.KeepEscaped = false;
    this.ArbitraryTaskListItemMarker = false;
    this.EnsureListItemParagraph = false;
  }

  // PORT-NOTE: lazy emoji tables
  get AliasEmoji(): Map<string, string> {
    let m = this._AliasEmoji;
    if (null === m) {
      m = EmojiAliasUnicodeMap();
      this._AliasEmoji = m;
    }
    return m;
  }

  // PORT-NOTE: lazy emoji tables
  set AliasEmoji(m: Map<string, string>) {
    this._AliasEmoji = m;
  }

  // PORT-NOTE: lazy emoji tables
  get EmojiAlias(): Map<string, string> {
    let m = this._EmojiAlias;
    if (null === m) {
      m = EmojiUnicodeAliasMap();
      this._EmojiAlias = m;
    }
    return m;
  }

  // PORT-NOTE: lazy emoji tables
  set EmojiAlias(m: Map<string, string>) {
    this._EmojiAlias = m;
  }

  // PORT-NOTE: Go copies this struct by value (`opt := *options`, parse/code_span.go:77, render/table_rich.go). This is that copy: a shallow copy of every field. Maps, slices and the
  // unresolved lazy emoji state (_AliasEmoji/_EmojiAlias) are copied as they are, so the copy shares the same emoji map objects as Go's copy does.
  Copy(): Options {
    const o = new Options();
    o.DisableTableCellRich = this.DisableTableCellRich;
    o.GFMTable = this.GFMTable;
    o.GFMTaskListItem = this.GFMTaskListItem;
    o.GFMStrikethrough = this.GFMStrikethrough;
    o.GFMStrikethrough1 = this.GFMStrikethrough1;
    o.FullWidthStrikethrough = this.FullWidthStrikethrough;
    o.GFMAutoLink = this.GFMAutoLink;
    o.Footnotes = this.Footnotes;
    o.HeadingID = this.HeadingID;
    o.ToC = this.ToC;
    o.Emoji = this.Emoji;
    o._AliasEmoji = this._AliasEmoji;
    o._EmojiAlias = this._EmojiAlias;
    o.EmojiSite = this.EmojiSite;
    o.VditorWYSIWYG = this.VditorWYSIWYG;
    o.VditorIR = this.VditorIR;
    o.VditorSV = this.VditorSV;
    o.ProtyleWYSIWYG = this.ProtyleWYSIWYG;
    o.ProtyleWYSIWYGAutoLink = this.ProtyleWYSIWYGAutoLink;
    o.InlineMath = this.InlineMath;
    o.InlineMathAllowDigitAfterOpenMarker = this.InlineMathAllowDigitAfterOpenMarker;
    o.Setext = this.Setext;
    o.YamlFrontMatter = this.YamlFrontMatter;
    o.BlockRef = this.BlockRef;
    o.FileAnnotationRef = this.FileAnnotationRef;
    o.Mark = this.Mark;
    o.KramdownBlockIAL = this.KramdownBlockIAL;
    o.KramdownSpanIAL = this.KramdownSpanIAL;
    o.Tag = this.Tag;
    o.ImgPathAllowSpace = this.ImgPathAllowSpace;
    o.SuperBlock = this.SuperBlock;
    o.CustomBlock = this.CustomBlock;
    o.Sup = this.Sup;
    o.Sub = this.Sub;
    o.InlineAsterisk = this.InlineAsterisk;
    o.InlineUnderscore = this.InlineUnderscore;
    o.GitConflict = this.GitConflict;
    o.LinkRef = this.LinkRef;
    o.IndentCodeBlock = this.IndentCodeBlock;
    o.ParagraphBeginningSpace = this.ParagraphBeginningSpace;
    o.DataImage = this.DataImage;
    o.TextMark = this.TextMark;
    o.HTMLTag2TextMark = this.HTMLTag2TextMark;
    o.Spin = this.Spin;
    o.HTML2MarkdownAttrs = this.HTML2MarkdownAttrs;
    o.Callout = this.Callout;
    o.Tabs = this.Tabs;
    o.KeepEscaped = this.KeepEscaped;
    o.ArbitraryTaskListItemMarker = this.ArbitraryTaskListItemMarker;
    o.EnsureListItemParagraph = this.EnsureListItemParagraph;
    return o;
  }

  // IsValidTaskListItemMarker reports whether marker is a valid task list item marker.
  // When ArbitraryTaskListItemMarker is on, any character other than [ and ] is accepted; otherwise only ' ', 'x' and 'X'.
  IsValidTaskListItemMarker(marker: number): boolean {
    const options = this;
    return (0x20 /* space */ === marker || 0x78 /* x */ === marker || 0x58 /* X */ === marker) ||
      (options.ArbitraryTaskListItemMarker && 0x5b /* [ */ !== marker && 0x5d /* ] */ !== marker);
  }
}

// PORT-NOTE: Go's `var EmojiLock = sync.Mutex{}` is dropped (sync usage is removed).

export function NewOptions(): Options {
  const ret = new Options();
  ret.GFMTable = true;
  ret.GFMTaskListItem = true;
  ret.GFMStrikethrough = true;
  ret.GFMStrikethrough1 = true;
  ret.GFMAutoLink = true;
  ret.Footnotes = true;
  ret.Emoji = true;
  // PORT-NOTE: lazy emoji tables. Go sets AliasEmoji: EmojiAliasUnicode and EmojiAlias: EmojiUnicodeAlias here. They are left unset (null) and resolved on first read by the accessors.
  ret.EmojiSite = "https://cdn.jsdelivr.net/npm/vditor/dist/images/emoji";
  ret.InlineMath = true;
  ret.Setext = true;
  ret.YamlFrontMatter = true;
  ret.BlockRef = false;
  ret.FileAnnotationRef = false;
  ret.Mark = false;
  ret.InlineAsterisk = true;
  ret.InlineUnderscore = true;
  ret.KramdownBlockIAL = false;
  ret.HeadingID = true;
  ret.LinkRef = true;
  ret.IndentCodeBlock = true;
  ret.DataImage = true;
  ret.Callout = false;
  ret.CustomBlock = false;
  return ret;
}

Context.prototype.ParentTip = function (this: Context): void {
  const context = this;
  const tip = context.Tip!.Parent;
  if (null !== tip) {
    context.Tip = context.Tip!.Parent;
  }
};

Context.prototype.TipAppendChild = function (this: Context, child: ast.Node): void {
  const context = this;
  context.Tip!.AppendChild(child);
};
