// Ported from render/protyle_renderer.go @ 8e7896b6
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
import { BaseRenderer, ProtyleRenderer } from "./types.ts";
import { headingLevel } from "./html_renderer.ts";
import { NoHighlight, appendTableCellAlignStyle, nodeTokens } from "./renderer.ts";
import type { Options } from "./renderer.ts";
import { calloutDisplayTitle } from "./callout.ts";
import { customBlockDataAttrs } from "./custom_block_renderer.ts";
import { Sanitize, sanitize } from "./sanitizer.ts";
import { TableCellRichHTML } from "./table_rich.ts";
// PORT-NOTE: the following files only attach methods to BaseRenderer; importing them makes sure the methods exist whenever this file is imported on its own.
// tabs.ts attaches ProtyleRenderer.renderTabs.
import "./link.ts";
import "./space.ts";
import "./term_typographer.ts";
import "./tabs.ts";

const zwspBytes: Uint8Array = conv.BytesFromString(editor.Zwsp);
const spaceZwspBytes: Uint8Array = conv.BytesFromString(" " + editor.Zwsp);
const spaceBytes: Uint8Array = conv.BytesFromString(" ");
const javascriptColonBytes: Uint8Array = conv.BytesFromString("javascript:");
const imgSrcPrefix: Uint8Array = conv.BytesFromString("<img src=");
const assetsPrefix: Uint8Array = conv.BytesFromString("assets/");
const apiIconPrefix: Uint8Array = conv.BytesFromString("api/icon/");
const brBytes: Uint8Array = conv.BytesFromString("<br />");
const uOpenBytes: Uint8Array = conv.BytesFromString("<u>");
const uCloseBytes: Uint8Array = conv.BytesFromString("</u>");
const pipeBytes: Uint8Array = conv.BytesFromString("|");
const escapedPipeBytes: Uint8Array = conv.BytesFromString("\\|");
const pipeEntityBytes: Uint8Array = conv.BytesFromString("&#124;");
const searchMarkOpenBytes: Uint8Array = conv.BytesFromString("__@mark__");
const searchMarkCloseBytes: Uint8Array = conv.BytesFromString("__mark@__");
const searchMarkOpenSpanBytes: Uint8Array = conv.BytesFromString("<span data-type=\"search-mark\">");
const spanCloseBytes: Uint8Array = conv.BytesFromString("</span>");
const noBytes: Uint8Array = new Uint8Array(0);

declare module "./types.ts" {
  interface ProtyleRenderer {
    renderCallout(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCustomBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderAttributeView(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTextMark(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBr(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderUnderline(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderUnderlineOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderUnderlineCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderKbd(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderKbdOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderKbdCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockQueryEmbed(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockQueryEmbedScript(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderVideo(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderAudio(node: ast.Node, entering: boolean): ast.WalkStatus;
    mediaControls(tokens: Uint8Array, tag: string): Uint8Array;
    renderWidget(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderIFrame(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockRef(node: ast.Node, entering: boolean): ast.WalkStatus;
    escapeRefText(refText: string): string;
    renderBlockRefID(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockRefSpace(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockRefText(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockRefDynamicText(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFileAnnotationRef(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFileAnnotationRefID(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFileAnnotationRefSpace(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFileAnnotationRefText(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGitConflictCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGitConflictContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGitConflictOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGitConflict(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTag(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTagOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTagCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSuperBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSuperBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSuperBlockLayoutMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSuperBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLinkRefDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLinkRefDef(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderKramdownBlockIAL(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderKramdownSpanIAL(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMark(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMark1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMark1CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMark2OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMark2CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSup(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSupOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSupCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSub(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSubOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSubCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderYamlFrontMatterCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderYamlFrontMatterContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderYamlFrontMatterOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderYamlFrontMatter(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHtmlEntity(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBackslashContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBackslash(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderToC(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFootnotesDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFootnotesDef(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFootnotesRef(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockInfoMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockCode(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmojiAlias(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmojiImg(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmojiUnicode(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmoji(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMath(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMathOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMathContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMathCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlockContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTableCell(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTableRow(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTableHead(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTable(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrikethrough(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrikethrough1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrikethrough1CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrikethrough2OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrikethrough2CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLinkTitle(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLinkDest(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLinkSpace(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLinkText(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCloseParen(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderOpenParen(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLess(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGreater(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCloseBrace(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderOpenBrace(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCloseBracket(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderOpenBracket(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBang(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderImage(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLink(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHTML(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineHTML(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderDocument(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderParagraph(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderText(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeSpan(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeSpanOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeSpanContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeSpanCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmphasis(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmAsteriskOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmAsteriskCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmUnderscoreOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmUnderscoreCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrong(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrongA6kOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrongA6kCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrongU8eOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderStrongU8eCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockquote(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockquoteMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHeading(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHeadingC8hMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHeadingID(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderList(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderListItem(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTaskListItemMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderThematicBreak(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHardBreak(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSoftBreak(node: ast.Node, entering: boolean): ast.WalkStatus;
    spanNodeAttrs(node: ast.Node, attrs: string[][]): void;
    blockNodeAttrs(node: ast.Node, attrs: string[][], class_: string): void;
    nodeClass(node: ast.Node, attrs: string[][], class_: string): void;
    nodeDataType(node: ast.Node, attrs: string[][]): void;
    nodeID(node: ast.Node, attrs: string[][]): void;
    nodeIndex(node: ast.Node, attrs: string[][]): void;
    spellcheck(attrs: string[][]): void;
    contenteditable(node: ast.Node, attrs: string[][]): void;
    renderIAL(node: ast.Node): void;
    ensureInlineBoundaryZwsp(): void;
    renderTextMarkAttrs(node: ast.Node): string[][];
    tokensStyle(tokens: Uint8Array): string;
  }
}

ProtyleRenderer.prototype.renderCallout = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [
      ["data-subtype", html.EscapeHTMLStr(node.CalloutType)],
    ];
    r.blockNodeAttrs(node, attrs, "callout");
    r.Tag("div", attrs, false);
    r.WriteString("<div class=\"callout-info\" contenteditable=\"false\"><span class=\"callout-icon\">");
    if (0 === node.CalloutIconType) {
      r.WriteString(node.CalloutIcon);
    } else if (1 === node.CalloutIconType) {
      r.WriteString("<img class=\"callout-img\" src=\"");
      r.WriteString(html.EscapeHTMLStr(node.CalloutIcon));
      r.WriteString("\" />");
    }

    r.WriteString("</span><span contenteditable=\"true\" spellcheck=\"");
    r.WriteString(strconv.FormatBool(r.Options.Spellcheck));
    r.WriteString("\" class=\"callout-title\">");
    const title = calloutDisplayTitle(node);

    const titleTree = parse.Inline("", conv.BytesFromString(title), r.ParseOptions);
    if (null !== titleTree && null !== titleTree.Root && null !== titleTree.Root.FirstChild) {
      const inlines: ast.Node[] = [];
      for (let child = titleTree.Root.FirstChild.FirstChild; null !== child; child = child.Next) {
        inlines.push(child);
      }
      titleTree.Root.FirstChild.Unlink();
      for (const inline of inlines) {
        titleTree.Root.AppendChild(inline);
      }
      const data = NewProtyleRenderer(titleTree, r.Options, r.ParseOptions).Render();
      r.Write(data);
    } else {
      r.WriteString(title);
    }
    r.WriteString("</span></div>");
    r.WriteString("<div class=\"callout-content\">");
  } else {
    r.WriteString("</div>");
    r.renderIAL(node);
    r.WriteString("</div>");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCustomBlock = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [["contenteditable", "false"]].concat(customBlockDataAttrs(node));
    r.blockNodeAttrs(node, attrs, "custom-block");
    r.Tag("div", attrs, false);
    r.Tag("div", [["class", "custom-block__content"]], false);
    r.renderCustomBlockFallback(node);
    r.WriteString("</div>");
    r.renderIAL(node);
    r.WriteString("</div>");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderAttributeView = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let attrs: string[][] = [
      ["contenteditable", "false"],
      ["data-av-id", node.AttributeViewID],
      ["data-av-type", node.AttributeViewType],
    ];
    r.blockNodeAttrs(node, attrs, "av");
    r.Tag("div", attrs, false);
    attrs = [];
    r.spellcheck(attrs);
    r.Tag("div", attrs, false);
    r.WriteString("</div>");
    r.renderIAL(node);
    r.WriteString("</div>");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTextMark = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (parse.ContainTextMark(node, "code", "inline-math", "kbd")) {
      if (r.Options.AutoSpace) {
        const text = node.PreviousNodeText();
        if ("" !== text) {
          const lastc = utf8.DecodeLastRuneInString(text)[0];
          if (unicode.IsLetter(lastc) || unicode.IsDigit(lastc)) {
            r.WriteByte(lex.ItemSpace);
          }
        }
      }
    } else {
      r.TextAutoSpacePrevious(node);
    }
    const attrs = r.renderTextMarkAttrs(node);
    r.spanNodeAttrs(node, attrs);
    if (parse.ContainTextMark(node, "tag") && null !== node.Previous) {
      const prevIsTag = node.Previous.IsTextMarkType("tag");
      const prevIsCaretBeforeTag = editor.Caret === node.Previous.TokensStr() &&
        null !== node.Previous.Previous && node.Previous.Previous.IsTextMarkType("tag");
      if (prevIsTag || prevIsCaretBeforeTag) {
        // Adjacent tags are separated by a normal space so that they do not look joined https://github.com/siyuan-note/siyuan/issues/18191
        r.WriteByte(lex.ItemSpace);
      }
    }
    if (parse.ContainTextMark(node, "code", "kbd", "tag")) {
      r.ensureInlineBoundaryZwsp();
    }

    if (node.IsTextMarkType("code")) {
      if (r.Options.Spellcheck) {
        // Spell check should be disabled inside inline and block code https://github.com/siyuan-note/siyuan/issues/9672
        attrs.push(["spellcheck", "false"]);
      }
    }

    r.Tag("span", attrs, false);
    if (parse.ContainTextMark(node, "code", "kbd", "tag")) {
      r.WriteString(editor.WordJoiner);
    }
    let textContent = node.TextMarkTextContent;
    if (node.ParentIs(ast.NodeTableCell)) {
      if (node.IsTextMarkType("code")) {
        textContent = strings.ReplaceAll(textContent, "|", "&#124;");
      } else {
        textContent = strings.ReplaceAll(textContent, "\\|", "|");
      }
      textContent = strings.ReplaceAll(textContent, "\n", "<br />");
    }
    r.WriteString(textContent);
  } else {
    r.WriteString("</span>");
    if (parse.ContainTextMark(node, "code", "kbd", "tag")) {
      const text = node.NextNodeText();
      if ("" !== text) {
        if (!strings.HasPrefix(text, editor.Zwsp)) {
          r.WriteString(editor.Zwsp);
        }
      } else {
        r.WriteString(editor.Zwsp);
      }
    }
    if (parse.ContainTextMark(node, "code", "inline-math", "kbd")) {
      if (r.Options.AutoSpace) {
        const text = node.NextNodeText();
        if ("" !== text) {
          const firstc = utf8.DecodeRuneInString(text)[0];
          if (unicode.IsLetter(firstc) || unicode.IsDigit(firstc)) {
            r.WriteByte(lex.ItemSpace);
          }
        }
      }
    } else {
      r.TextAutoSpaceNext(node);
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBr = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (node.ParentIs(ast.NodeParagraph, ast.NodeHeading)) {
      r.WriteByte(lex.ItemNewline);
    } else {
      r.WriteString("<br />");
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderUnderline = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderUnderlineOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "u"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderUnderlineCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</span>");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderKbd = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderKbdOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.ensureInlineBoundaryZwsp();
    r.Tag("span", [["data-type", "kbd"]], false);
    r.WriteString(editor.WordJoiner);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderKbdCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</span>");
    r.WriteString(editor.Zwsp);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBlockQueryEmbed = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const script = node.ChildByType(ast.NodeBlockQueryEmbedScript);
    if (null === script) {
      return ast.WalkContinue;
    }
    const attrs: string[][] = [];
    let tokens = nodeTokens(script);
    tokens = html.EscapeHTML(bytes.ReplaceAll(tokens, editor.CaretTokens, noBytes));
    let content = util.BytesToStr(tokens);
    // A multi-line SQL statement in an embed block is converted to paragraph text https://github.com/siyuan-note/siyuan/issues/5728
    content = strings.ReplaceAll(content, editor.IALValEscNewLine, "\n");
    attrs.push(["data-content", content]);
    r.blockNodeAttrs(node, attrs, "render-node");
    r.Tag("div", attrs, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBlockQueryEmbedScript = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderVideo = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "iframe");
    r.Tag("div", attrs, false);
    r.Tag("div", [["class", "iframe-content"]], false);
    r.WriteString(editor.Zwsp);
    let tokens = bytes.ReplaceAll(nodeTokens(node), editor.CaretTokens, noBytes);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    tokens = r.mediaControls(tokens, "video");
    r.Write(tokens);
  } else {
    r.Tag("span", [["class", "protyle-action__drag"], ["contenteditable", "false"]], false);
    r.Tag("/span", null, false);
    r.Tag("/div", null, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderAudio = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "iframe");
    r.Tag("div", attrs, false);
    r.Tag("div", [["class", "iframe-content"]], false);
    let tokens = bytes.ReplaceAll(nodeTokens(node), editor.CaretTokens, noBytes);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    tokens = r.mediaControls(tokens, "audio");
    r.Write(tokens);
    r.WriteString(editor.Zwsp);
  } else {
    r.Tag("/div", null, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

// mediaControls adds the playback controls to audio and video blocks, keeping the children and the other playback attributes.
ProtyleRenderer.prototype.mediaControls = function (this: ProtyleRenderer, tokens: Uint8Array, tag: string): Uint8Array {
  const r = this;
  const fragment = util.ParseHTML(conv.StringFromBytes(tokens));
  if (null === fragment || null === fragment.FirstChild || tag !== fragment.FirstChild.Data) {
    return tokens;
  }
  const media = fragment.FirstChild;
  let hasControls = false;
  let hasSrc = false;
  for (const attr of media.Attr) {
    hasControls = hasControls || "controls" === attr.Key;
    hasSrc = hasSrc || "src" === attr.Key;
  }
  if (!hasControls) {
    util.SetDomAttrValue(media, "controls", "controls");
  }
  if (hasSrc) {
    const src = r.LinkPath(conv.BytesFromString(util.DomAttrValue(media, "src")));
    util.SetDomAttrValue(media, "src", conv.StringFromBytes(src));
  }
  return util.DomHTML(media);
};

ProtyleRenderer.prototype.renderWidget = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens = bytes.ReplaceAll(nodeTokens(node), editor.CaretTokens, noBytes);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    const dataSrc = r.tagSrc(tokens);
    const src = r.LinkPath(dataSrc ?? noBytes);
    tokens = r.replaceSrc(tokens, conv.StringFromBytes(src));

    const attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "iframe");
    const oldStyle = r.tokensStyle(tokens);
    const style = node.IALAttr("style");
    if ("" === style) {
      if ("" !== oldStyle) {
        const os = strings.ReplaceAll(oldStyle, "pointer-events: none;", "");
        attrs.push(["style", os]);
      }
    }
    tokens = bytes.ReplaceAll(tokens, conv.BytesFromString("style=\"" + oldStyle + "\""), noBytes);

    attrs.push(["data-subtype", "widget"]);
    r.Tag("div", attrs, false);
    r.Tag("div", [["class", "iframe-content"]], false);
    r.Write(tokens);
  } else {
    r.Tag("span", [["class", "protyle-action__drag"], ["contenteditable", "false"]], false);
    r.Tag("/span", null, false);
    r.Tag("/div", null, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderIFrame = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens = bytes.ReplaceAll(nodeTokens(node), editor.CaretTokens, noBytes);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    const dataSrc = r.tagSrc(tokens);
    const src = r.LinkPath(dataSrc ?? noBytes);
    tokens = r.replaceSrc(tokens, conv.StringFromBytes(src));

    const attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "iframe");
    const oldStyle = r.tokensStyle(tokens);
    const style = node.IALAttr("style");
    if ("" === style) {
      if ("" !== oldStyle) {
        const os = strings.ReplaceAll(oldStyle, "pointer-events: none;", "");
        attrs.push(["style", os]);
      }
    }
    tokens = bytes.ReplaceAll(tokens, conv.BytesFromString("style=\"" + oldStyle + "\""), noBytes);

    attrs.push(["loading", "lazy"]);
    r.Tag("div", attrs, false);
    r.Tag("div", [["class", "iframe-content"]], false);
    r.Write(tokens);
  } else {
    r.Tag("span", [["class", "protyle-action__drag"], ["contenteditable", "false"]], false);
    r.Tag("/span", null, false);
    r.Tag("/div", null, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBlockRef = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const idNode = node.ChildByType(ast.NodeBlockRefID);
    let refText = "";
    let subtype = "";
    let refTextNode = node.ChildByType(ast.NodeBlockRefText);
    subtype = "s";
    if (null === refTextNode) {
      refTextNode = node.ChildByType(ast.NodeBlockRefDynamicText);
      subtype = "d";
    }
    if (null !== refTextNode) {
      refText = refTextNode.Text();
    }
    refText = r.escapeRefText(refText);
    const attrs: string[][] = [["data-type", "block-ref"], ["data-subtype", subtype], ["data-id", idNode!.TokensStr()]];
    r.Tag("span", attrs, false);
    refText = strings.ReplaceAll(refText, "&amp;#124;", "|");
    r.WriteString(refText);
    r.Tag("/span", null, false);
    return ast.WalkSkipChildren;
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.escapeRefText = function (this: ProtyleRenderer, refText: string): string {
  refText = strings.ReplaceAll(refText, ">", "&gt;");
  refText = strings.ReplaceAll(refText, "<", "&lt;");
  refText = strings.ReplaceAll(refText, "\"", "&quot;");
  refText = strings.ReplaceAll(refText, "'", "&apos;");
  return refText;
};

ProtyleRenderer.prototype.renderBlockRefID = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBlockRefSpace = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBlockRefText = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBlockRefDynamicText = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderFileAnnotationRef = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const idNode = node.ChildByType(ast.NodeFileAnnotationRefID);
    const id = idNode!.TokensStr();
    let refText = id;
    const refTextNode = node.ChildByType(ast.NodeFileAnnotationRefText);
    if (null !== refTextNode) {
      refText = refTextNode.Text();
    }
    refText = r.escapeRefText(refText);
    const attrs: string[][] = [["data-type", "file-annotation-ref"], ["data-subtype", "s"], ["data-id", html.EscapeHTMLStr(id)]];
    r.Tag("span", attrs, false);
    r.WriteString(refText);
    r.Tag("/span", null, false);
    return ast.WalkSkipChildren;
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderFileAnnotationRefID = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderFileAnnotationRefSpace = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderFileAnnotationRefText = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderGitConflictCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderGitConflictContent = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "git-conflict");
    r.Tag("div", attrs, false);
    attrs = [["contenteditable", "false"], ["spellcheck", "false"]];
    r.Tag("div", attrs, false);

    const tokens = bytes.TrimSpace(nodeTokens(node));
    r.Write(html.EscapeHTML(tokens));
  } else {
    r.Tag("/div", null, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }

  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderGitConflictOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderGitConflict = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTag = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
    const prevIsTag = null !== node.Previous && ast.NodeTag === node.Previous.Type;
    const prevIsCaretBeforeTag = null !== node.Previous && editor.Caret === node.Previous.TokensStr() &&
      null !== node.Previous.Previous && ast.NodeTag === node.Previous.Previous.Type;
    if (prevIsTag || prevIsCaretBeforeTag) {
      // Adjacent tags are separated by a normal space so that they do not look joined https://github.com/siyuan-note/siyuan/issues/18191
      r.WriteByte(lex.ItemSpace);
    }
    r.ensureInlineBoundaryZwsp();
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTagOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let content = node.Parent!.Text();
    content = strings.ReplaceAll(content, editor.Caret, "");
    r.Tag("span", [["data-type", "tag"], ["data-content", html.EscapeHTMLStr(content)]], false);
    r.WriteString(editor.WordJoiner);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTagCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
    r.WriteString(editor.Zwsp);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSuperBlock = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (null === node.FirstChild) {
      return ast.WalkContinue;
    }

    const attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "sb");
    let layout = node.FirstChild.Next!.TokensStr();
    if ("" === layout) {
      layout = "row";
    }
    attrs.push(["data-sb-layout", layout]);
    r.Tag("div", attrs, false);

    // In the col layout, walk the real child blocks by hand and insert a handle after every block node except the last, so that the width of the child blocks can be dragged
    // https://github.com/siyuan-note/siyuan/issues/9521
    if ("col" === layout) {
      // Count the real block nodes first (IAL and markers excluded), to tell whether a block is the last one
      let blockCount = 0;
      for (let c = node.FirstChild.Next!.Next; null !== c && ast.NodeSuperBlockCloseMarker !== c.Type; c = c.Next) {
        if (ast.NodeKramdownBlockIAL !== c.Type) {
          blockCount++;
        }
      }
      let blockIdx = 0;
      for (let c = node.FirstChild.Next!.Next; null !== c && ast.NodeSuperBlockCloseMarker !== c.Type; c = c.Next) {
        ast.Walk(c, (n: ast.Node, entering: boolean): ast.WalkStatus => {
          let render = r.RendererFuncs.get(n.Type);
          if (undefined === render) {
            render = r.renderDefault.bind(r);
          }
          return render(n, entering);
        });
        // Insert the handle only after a block node (not IAL) that is not the last block; IAL nodes are rendered as usual but are not handle anchors
        if (ast.NodeKramdownBlockIAL !== c.Type) {
          if (blockIdx < blockCount - 1) {
            r.Tag("span", [["class", "sb__resize"], ["contenteditable", "false"]], false);
            r.Tag("/span", null, false);
          }
          blockIdx++;
        }
      }
      return ast.WalkSkipChildren;
    }
  } else {
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSuperBlockOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSuperBlockLayoutMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSuperBlockCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderLinkRefDefBlock = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<div data-block=\"0\" data-type=\"link-ref-defs-block\">");
  } else {
    r.WriteString("</div>");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderLinkRefDef = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (null === node.FirstChild) {
      return ast.WalkContinue;
    }

    // UPSTREAM-BUG: ChildByType returns nil when the first child has no link destination child, so reading .Tokens panics (nil pointer dereference), e.g. `[r]: /u` with SetLinkRef(true)
    const dest = nodeTokens(node.FirstChild.ChildByType(ast.NodeLinkDest)!);
    const destStr = util.BytesToStr(dest);
    r.WriteString("[" + util.BytesToStr(nodeTokens(node)) + "]:");
    if (editor.Caret !== destStr) {
      r.WriteString(" ");
    }
    r.WriteString(destStr + "\n");
  }
  return ast.WalkSkipChildren;
};

ProtyleRenderer.prototype.renderKramdownBlockIAL = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderKramdownSpanIAL = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    if (null !== node.Previous && ast.NodeImage === node.Previous.Type && null !== node.Next && ast.NodeImage === node.Next.Type) {
      r.WriteString(editor.Zwsp);
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderMark = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderMark1OpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "mark"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderMark1CloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderMark2OpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "mark"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderMark2CloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSup = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSupOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "sup"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSupCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSub = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSubOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "sub"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderSubCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderYamlFrontMatterCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderYamlFrontMatterContent = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const previewTokens = bytes.TrimSpace(nodeTokens(node));
    const codeLen = previewTokens.length;
    const codeIsEmpty = 1 > codeLen || (utf8.ByteLen(editor.Caret) === codeLen && editor.Caret === conv.StringFromBytes(nodeTokens(node)));
    r.Tag("pre", null, false);
    r.Tag("code", [["data-type", "yaml-front-matter"]], false);
    if (codeIsEmpty) {
      r.WriteString(editor.FrontEndCaret + "\n");
    } else {
      r.Write(html.EscapeHTML(previewTokens));
    }
    r.WriteString("</code></pre>");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderYamlFrontMatterOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderYamlFrontMatter = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<div class=\"protyle-wysiwyg__block\" data-type=\"yaml-front-matter\" data-block=\"0\">");
  } else {
    r.WriteString("</div>");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderHtmlEntity = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    return ast.WalkContinue;
  }
  r.Write(html.EscapeHTML(nodeTokens(node)));
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBackslashContent = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(html.EscapeHTML(nodeTokens(node)));
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBackslash = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<span data-type=\"backslash\">");
  } else {
    r.WriteString("</span>");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderToC = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  // PORT-NOTE: Go embedding, base method
  return BaseRenderer.prototype.renderToC.call(r, node, entering);
};

ProtyleRenderer.prototype.renderFootnotesDefBlock = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<div class=\"footnotes-defs-div\">");
    r.WriteString("<hr class=\"footnotes-defs-hr\" />\n");
    r.WriteString("<ol class=\"footnotes-defs-ol\">");
  } else {
    r.WriteString("</ol></div>");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderFootnotesDef = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    // r.WriteString("<li id=\"footnotes-def-" + node.FootnotesRefId + "\">")
    // With an id on li, the Pandoc HTML to Docx conversion has problems
    r.WriteString("<li>");
    if (0 < node.FootnotesRefs.length) {
      const refId = node.FootnotesRefs[0].FootnotesRefId;
      node.FirstChild!.PrependChild(new ast.Node(ast.NodeInlineHTML, conv.BytesFromString("<span id=\"footnotes-def-" + refId + "\"></span>")));
    }
  } else {
    r.WriteString("</li>\n");
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderFootnotesRef = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const [idx, def] = r.Tree.FindFootnotesDef(nodeTokens(node));
    if (null === def) {
      return ast.WalkContinue;
    }

    const idxStr = strconv.Itoa(idx);
    r.Tag("sup", [["class", "footnotes-ref"], ["id", "footnotes-ref-" + node.FootnotesRefId]], false);
    r.Tag("a", [["href", r.Options.LinkBase + "#footnotes-def-" + idxStr]], false);
    r.WriteString(idxStr);
    r.Tag("/a", null, false);
    r.Tag("/sup", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCodeBlock = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  let noHighlight = false;
  let language = "";
  if (null !== node.FirstChild && null !== node.FirstChild.Next && 0 < node.FirstChild.Next.CodeBlockInfo.length) {
    language = util.BytesToStr(node.FirstChild.Next.CodeBlockInfo);
    language = strings.ReplaceAll(language, editor.Caret, "");
    noHighlight = language !== "mindmap" && NoHighlight(language);
  }

  if (entering) {
    if (noHighlight) {
      if (null === node.FirstChild) {
        return ast.WalkContinue;
      }

      const attrs: string[][] = [];
      r.blockNodeAttrs(node, attrs, "render-node");
      let tokens = html.EscapeHTML(nodeTokens(node.FirstChild.Next!.Next!));
      tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, noBytes);
      tokens = bytes.TrimSpace(tokens);
      attrs.push(["data-content", util.BytesToStr(tokens)]);
      attrs.push(["data-subtype", language]);
      r.Tag("div", attrs, false);
      r.Tag("div", [["spin", "1"]], false);
      r.Tag("/div", null, false);
      r.renderIAL(node);
      r.Tag("/div", null, false);
      return ast.WalkSkipChildren;
    }

    const attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "code-block");
    r.Tag("div", attrs, false);
  } else {
    if (noHighlight) {
      return ast.WalkSkipChildren;
    }
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCodeBlockOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCodeBlockInfoMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCodeBlockCode = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    return ast.WalkContinue;
  }

  r.Tag("div", [["class", "protyle-action"]], false);
  const codeLen = nodeTokens(node).length;
  const codeIsEmpty = 1 > codeLen || (utf8.ByteLen(editor.Caret) === codeLen && editor.Caret === conv.StringFromBytes(nodeTokens(node)));
  let language = "";
  let caretInInfo = false;
  if (null !== node.Previous) {
    caretInInfo = bytes.Contains(node.Previous.CodeBlockInfo, editor.CaretTokens);
    node.Previous.CodeBlockInfo = bytes.ReplaceAll(node.Previous.CodeBlockInfo, editor.CaretTokens, noBytes);
  }

  let attrs: string[][] = [["class", "protyle-action--first protyle-action__language"], ["contenteditable", "false"]];
  if (null !== node.Previous && 0 < node.Previous.CodeBlockInfo.length) {
    const infoWords = lex.Split(node.Previous.CodeBlockInfo, lex.ItemSpace);
    language = conv.StringFromBytes(infoWords[0]);
  }

  r.Tag("span", attrs, false);
  r.WriteString(language);
  r.Tag("/span", null, false);
  r.WriteString("<span class=\"fn__flex-1\"></span>");
  r.Tag("span", [["class", "ariaLabel protyle-icon protyle-icon--first protyle-action__copy"], ["data-position", "4north"]], false);
  r.WriteString("<svg><use xlink:href=\"#iconCopy\"></use></svg>");
  r.Tag("/span", null, false);
  r.WriteString("<span class=\"ariaLabel protyle-icon protyle-icon--last protyle-action__menu\" data-position=\"4north\"><svg><use xlink:href=\"#iconMore\"></use></svg></span>");
  r.Tag("/div", null, false);

  attrs = [["class", "hljs"]];
  r.Tag("div", attrs, false);
  r.Tag("div", null, false);
  r.Tag("/div", null, false);
  attrs = [];
  r.contenteditable(node, attrs);
  attrs.push(["style", "flex: 1"]);
  attrs.push(["spellcheck", "false"]);
  r.Tag("div", attrs, false);
  if (codeIsEmpty) {
    if (caretInInfo) {
      r.WriteString(editor.FrontEndCaret);
    }
  } else {
    let tokens = html.EscapeHTML(nodeTokens(node));
    // Support locating search results in code blocks https://github.com/siyuan-note/siyuan/issues/5520
    tokens = bytes.ReplaceAll(tokens, searchMarkOpenBytes, searchMarkOpenSpanBytes);
    tokens = bytes.ReplaceAll(tokens, searchMarkCloseBytes, spanCloseBytes);
    r.Write(tokens);
  }
  r.Tag("/div", null, false);
  r.Tag("/div", null, false);
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCodeBlockCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderEmojiAlias = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderEmojiImg = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderEmojiUnicode = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderEmoji = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderInlineMath = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (r.Options.AutoSpace) {
      const text = node.PreviousNodeText();
      if ("" !== text) {
        const lastc = utf8.DecodeLastRuneInString(text)[0];
        if (unicode.IsLetter(lastc) || unicode.IsDigit(lastc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
    }
  } else {
    if (r.Options.AutoSpace) {
      const text = node.NextNodeText();
      if ("" !== text) {
        const firstc = utf8.DecodeRuneInString(text)[0];
        if (unicode.IsLetter(firstc) || unicode.IsDigit(firstc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderInlineMathOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens = html.EscapeHTML(nodeTokens(node.Next!));
    tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, noBytes);
    r.Tag("span", [["data-type", "inline-math"], ["data-subtype", "math"], ["data-content", util.BytesToStr(tokens)], ["contenteditable", "false"], ["class", "render-node"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderInlineMathContent = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderInlineMathCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
    if (bytes.Contains(nodeTokens(node.Previous!), editor.CaretTokens)) {
      r.WriteString(editor.Caret);
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderMathBlock = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    return ast.WalkContinue;
  }

  if (null === node.FirstChild) {
    return ast.WalkContinue;
  }

  const attrs: string[][] = [];
  r.blockNodeAttrs(node, attrs, "render-node");
  let tokens = html.EscapeHTML(nodeTokens(node.FirstChild.Next!));
  tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, noBytes);
  tokens = bytes.TrimSpace(tokens);
  attrs.push(["data-content", util.BytesToStr(tokens)]);
  attrs.push(["data-subtype", "math"]);
  r.Tag("div", attrs, false);
  r.Tag("div", [["spin", "1"]], false);
  r.Tag("/div", null, false);
  r.renderIAL(node);
  r.Tag("/div", null, false);
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderMathBlockOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderMathBlockContent = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderMathBlockCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTableCell = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  let tag = "td";
  if (ast.NodeTableHead === node.Parent!.Parent!.Type) {
    tag = "th";
  }
  if (entering) {
    const attrs: string[][] = [];
    r.spanNodeAttrs(node, attrs);
    appendTableCellAlignStyle(node, attrs);
    if (null !== node.TableCellRich) {
      attrs.push([ast.TableCellRichAttribute, node.TableCellRich.Encode()], ["contenteditable", "false"]);
    }
    r.Tag(tag, attrs, false);
    if (null !== node.TableCellRich) {
      r.Tag("div", [["class", "table__cell-rich"], ["contenteditable", "false"]], false);
      const [content, err] = TableCellRichHTML(node.TableCellRich, r.Options);
      if (null === err) {
        r.Write(content!);
      }
      r.Tag("/div", null, false);
      return ast.WalkSkipChildren;
    }
  } else {
    r.Tag("/" + tag, null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTableRow = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("tr", null, false);
  } else {
    r.Tag("/tr", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTableHead = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("colgroup", null, false);
    const colgroup = node.Parent!.IALAttr("colgroup");
    if ("" === colgroup) {
      if (null !== node.FirstChild) {
        for (let th = node.FirstChild.FirstChild; null !== th; th = th.Next) {
          if (ast.NodeTableCell === th.Type) {
            const style = tableCellWidthStyle(th.IALAttr("style"));
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

    r.Tag("thead", null, false);
  } else {
    r.Tag("/thead", null, false);
    if (null !== node.Next) {
      r.Tag("tbody", null, false);
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTable = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (null === node.FirstChild) {
    return ast.WalkSkipChildren;
  }

  if (entering) {
    let attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "table");
    r.Tag("div", attrs, false);
    attrs = [["contenteditable", "false"]];
    r.Tag("div", attrs, false);
    attrs = [];
    r.contenteditable(node, attrs);
    r.spellcheck(attrs);
    r.Tag("table", attrs, false);
    let caption = node.IALAttr("caption");
    if ("" !== caption) {
      if (r.Options.Sanitize) {
        caption = Sanitize(caption);
      }
      r.WriteString(html.UnescapeHTMLStr(caption));
    }
  } else {
    if (null !== node.FirstChild.Next) {
      r.Tag("/tbody", null, false);
    }
    r.Tag("/table", null, false);
    r.WriteString("<div class=\"protyle-action__table\"><div class=\"table__resize\"></div><div class=\"table__select\"></div></div>");
    r.Tag("/div", null, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrikethrough = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrikethrough1OpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "s"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrikethrough1CloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrikethrough2OpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "s"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrikethrough2CloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderLinkTitle = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderLinkDest = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderLinkSpace = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderLinkText = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (ast.NodeImage !== node.Parent!.Type) {
      r.Write(html.EscapeHTML(nodeTokens(node)));
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCloseParen = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderOpenParen = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderLess = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderGreater = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCloseBrace = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderOpenBrace = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCloseBracket = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderOpenBracket = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBang = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderImage = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (null === node.Previous || editor.Caret === node.Previous.Text() ||
      (node.ParentIs(ast.NodeTableCell) && null !== node.Previous && null === node.Previous.Previous)) {
      r.WriteString(editor.Zwsp);
    }

    let attrs: string[][] = [["contenteditable", "false"], ["data-type", "img"], ["class", "img"]];
    let parentStyle = node.IALAttr("parent-style");
    if ("" !== parentStyle) { // The position was set manually
      parentStyle = strings.ReplaceAll(parentStyle, "display: block;", "");
      parentStyle = strings.TrimSpace(parentStyle);
      if ("" !== parentStyle) {
        attrs.push(["style", parentStyle]);
      }
    }
    if (r.LastOut === 0x0a /* \n */) {
      r.WriteString(editor.Zwsp);
    }
    r.Tag("span", attrs, false);
    r.Tag("span", null, false);
    r.WriteString(" ");
    r.Tag("/span", null, false);
    attrs = [];
    const style = node.IALAttr("style");
    if ("" !== style) {
      const styles = strings.Split(style, ";");
      let width = "";
      for (const s of styles) {
        if (strings.Contains(s, "width")) {
          width = s;
          break;
        }
      }
      width = strings.ReplaceAll(width, "vw", "%");
      width = strings.TrimSpace(width);
      if ("" !== width) {
        width += ";";
        attrs.push(["style", width]);
      }
    }
    r.Tag("span", attrs, false);
    r.Tag("span", [["class", "protyle-action protyle-icons"]], false);
    r.WriteString("<span class=\"protyle-icon protyle-icon--only\"><svg class=\"svg\"><use xlink:href=\"#iconMore\"></use></svg></span>");
    r.Tag("/span", null, false);
  } else {
    let destTokens = nodeTokens(node.ChildByType(ast.NodeLinkDest)!);
    if (r.Options.Sanitize) {
      destTokens = sanitize(destTokens);
    }
    destTokens = bytes.ReplaceAll(destTokens, editor.CaretTokens, noBytes);
    const dataSrcTokens = destTokens;
    const dataSrc = util.BytesToStr(dataSrcTokens);
    const src = util.BytesToStr(r.LinkPath(destTokens));
    let attrs: string[][] = [["src", src], ["data-src", dataSrc], ["loading", "lazy"]];
    const alt = node.ChildByType(ast.NodeLinkText);
    if (null !== alt && 0 < nodeTokens(alt).length) {
      attrs.push(["alt", util.BytesToStr(nodeTokens(alt))]);
    }

    const title = node.ChildByType(ast.NodeLinkTitle);
    let titleTokens: Uint8Array = new Uint8Array(0);
    if (null !== title && 0 < nodeTokens(title).length) {
      titleTokens = nodeTokens(title);
      titleTokens = conv.BytesFromString(r.escapeRefText(conv.StringFromBytes(titleTokens)));
      attrs.push(["title", conv.StringFromBytes(titleTokens)]);
    }
    let style = node.IALAttr("style");
    if ("" !== style) {
      const styles = strings.Split(style, ";");
      let width = "";
      for (const s of styles) {
        if (strings.Contains(s, "width")) {
          width = s;
        }
      }
      style = strings.ReplaceAll(style, width + ";", "");
      style = strings.ReplaceAll(style, "flex: 0 0 auto;", "");
      style = strings.ReplaceAll(style, "display: block;", "");
      style = strings.TrimSpace(style);
      if ("" !== style) {
        attrs.push(["style", style]);
      }
    }
    r.Tag("img", attrs, true);

    const buf = r.Writer.Bytes();
    const idx = bytes.LastIndex(buf, imgSrcPrefix);
    // PORT-NOTE: Go panics here when idx is -1 (buf[idx:]); idx is always found, the <img src= was written above
    let imgBuf: Uint8Array = buf.subarray(idx);
    if (r.Options.Sanitize) {
      imgBuf = sanitize(imgBuf);
    }
    imgBuf = r.tagSrcPath(imgBuf);
    r.Writer.Truncate(idx);
    r.Writer.Write(imgBuf);

    r.Tag("span", [["class", "protyle-action__drag"]], false);
    r.Tag("/span", null, false);

    if (r.Options.ProtyleMarkNetImg && !bytes.HasPrefix(dataSrcTokens, assetsPrefix) && !bytes.HasPrefix(dataSrcTokens, apiIconPrefix)) {
      r.WriteString("<span class=\"img__net\"><svg><use xlink:href=\"#iconLanguage\"></use></svg></span>");
    }

    attrs = [["class", "protyle-action__title"]];
    r.Tag("span", attrs, false);
    r.Tag("span", null, false);
    r.Writer.Write(titleTokens);
    r.Tag("/span", null, false);
    r.Tag("/span", null, false);
    r.Tag("/span", null, false);
    r.Tag("span", null, false);
    r.WriteString(" ");
    r.Tag("/span", null, false);
    r.Tag("/span", null, false);
    if (null === node.Next || editor.Caret === node.Next.Text() || ast.NodeImage === node.Next.Type) {
      r.WriteString(editor.Zwsp);
      return ast.WalkContinue;
    }
    if (ast.NodeKramdownSpanIAL === node.Next.Type && (null === node.Next.Next || editor.Caret === node.Next.Next.Text())) {
      r.WriteString(editor.Zwsp);
      return ast.WalkContinue;
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderLink = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const dest = node.ChildByType(ast.NodeLinkDest);
    let destTokens = nodeTokens(dest!);
    if (r.Options.Sanitize) {
      destTokens = bytes.TrimSpace(destTokens);
      destTokens = sanitize(destTokens);
      const tokens = bytes.ToLower(destTokens);
      if (bytes.HasPrefix(tokens, javascriptColonBytes)) {
        destTokens = noBytes; // PORT-NOTE: Go sets nil, which behaves as empty
      }
    }
    destTokens = r.LinkPath(destTokens);

    const caretInDest = bytes.Contains(destTokens, editor.CaretTokens);
    if (caretInDest) {
      const text = node.ChildByType(ast.NodeLinkText);
      text!.Tokens = slices.Append(nodeTokens(text!), editor.CaretTokens);
      destTokens = bytes.ReplaceAll(destTokens, editor.CaretTokens, noBytes);
    }
    const attrs: string[][] = [["data-type", "a"], ["data-href", conv.StringFromBytes(destTokens)]];
    const title = node.ChildByType(ast.NodeLinkTitle);
    if (null !== title && null !== title.Tokens) {
      attrs.push(["data-title", r.escapeRefText(conv.StringFromBytes(title.Tokens))]);
    }
    r.Tag("span", attrs, false);
  } else {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderHTML = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    return ast.WalkContinue;
  }

  let attrs: string[][] = [];
  r.blockNodeAttrs(node, attrs, "render-node");
  let tokens = nodeTokens(node);
  tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, noBytes);
  attrs.push(["data-subtype", "block"]);
  r.Tag("div", attrs, false);
  r.WriteString("<div class=\"protyle-icons\">");
  r.WriteString("<span class=\"ariaLabel protyle-icon protyle-icon--first protyle-action__edit\" data-position=\"4north\"><svg><use xlink:href=\"#iconEdit\"></use></svg></span><span class=\"ariaLabel protyle-icon protyle-action__menu protyle-icon--last\" data-position=\"4north\"><svg><use xlink:href=\"#iconMore\"></use></svg></span>");
  r.WriteString("</div><div>");
  attrs = [["data-content", util.BytesToStr(html.EscapeHTML(tokens))]];
  r.Tag("protyle-html", attrs, false);
  r.Tag("/protyle-html", null, false);
  r.WriteString("<span style=\"position: absolute\">" + editor.Zwsp + "</span>");
  r.WriteString("</div>");
  r.renderIAL(node);
  r.Tag("/div", null, false);
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderInlineHTML = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    return ast.WalkContinue;
  }

  if (bytes.Equal(nodeTokens(node), brBytes) && node.ParentIs(ast.NodeTableCell)) {
    r.Write(nodeTokens(node));
    return ast.WalkContinue;
  }

  if (bytes.Equal(nodeTokens(node), uOpenBytes) || bytes.Equal(nodeTokens(node), uCloseBytes)) {
    r.Write(nodeTokens(node));
    return ast.WalkContinue;
  }

  // There is no inline HTML in Protyle, it is converted to an HTML block here
  node.Type = ast.NodeHTMLBlock;
  return r.renderHTML(node, entering);
};

ProtyleRenderer.prototype.renderDocument = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderParagraph = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (node !== r.Tree.Root && node.IsTabTitleBlock()) {
    return ast.WalkSkipChildren;
  }
  if (entering) {
    let attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "p");
    r.Tag("div", attrs, false);
    attrs = [];
    if ("true" === node.IALAttr("tabs-title")) {
      attrs.push(["class", "tab-item-title callout-title"]);
    }
    r.contenteditable(node, attrs);
    r.spellcheck(attrs);
    r.Tag("div", attrs, false);
  } else {
    r.Tag("/div", null, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderText = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens: Uint8Array = noBytes;
    if (r.Options.AutoSpace && ast.NodeKbd !== node.Parent!.Type) {
      tokens = r.Space(nodeTokens(node));
    } else {
      tokens = nodeTokens(node);
    }

    if (bytes.HasPrefix(tokens, spaceZwspBytes) && bytes.HasSuffix(r.Writer.Bytes(), zwspBytes)) {
      tokens = bytes.Replace(tokens, spaceZwspBytes, spaceBytes, 1);
    }

    if (node.ParentIs(ast.NodeTextMark)) {
      if ("code" === node.Parent!.TokensStr()) {
        if (node.ParentIs(ast.NodeTableCell)) {
          tokens = bytes.ReplaceAll(tokens, escapedPipeBytes, pipeBytes);
        }
        tokens = html.EscapeHTML(tokens);
      }
      r.Write(tokens);
    } else {
      tokens = html.EscapeHTML(tokens);
      if (node.ParentIs(ast.NodeTableCell)) {
        tokens = bytes.ReplaceAll(tokens, pipeBytes, pipeEntityBytes);
      }
      r.Write(tokens);
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCodeSpan = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (r.Options.AutoSpace) {
      const text = node.PreviousNodeText();
      if ("" !== text) {
        const lastc = utf8.DecodeLastRuneInString(text)[0];
        if (unicode.IsLetter(lastc) || unicode.IsDigit(lastc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
    }

    r.ensureInlineBoundaryZwsp();
  } else {
    if (r.Options.AutoSpace) {
      const text = node.NextNodeText();
      if ("" !== text) {
        const firstc = utf8.DecodeRuneInString(text)[0];
        if (unicode.IsLetter(firstc) || unicode.IsDigit(firstc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCodeSpanOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "code"]], false);
    r.WriteString(editor.WordJoiner);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCodeSpanContent = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const tokens = html.EscapeHTML(nodeTokens(node));
    r.Write(tokens);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderCodeSpanCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</span>");
    r.WriteString(editor.Zwsp);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderEmphasis = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderEmAsteriskOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "em"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderEmAsteriskCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderEmUnderscoreOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("span", [["data-type", "em"]], false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderEmUnderscoreCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrong = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrongA6kOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [["data-type", "strong"]];
    r.spanNodeAttrs(node.Parent!, attrs);
    r.Tag("span", attrs, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrongA6kCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrongU8eOpenMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [["data-type", "strong"]];
    r.spanNodeAttrs(node.Parent!, attrs);
    r.Tag("span", attrs, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderStrongU8eCloseMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBlockquote = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "bq");
    r.Tag("div", attrs, false);
  } else {
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderBlockquoteMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderHeading = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let attrs: string[][] = [];
    if (6 < node.HeadingLevel) {
      node.HeadingLevel = 6;
    }
    if (0 > node.HeadingLevel) {
      // PORT-NOTE: Go panics here (slice bounds out of range)
      // UPSTREAM-BUG: headingLevel[node.HeadingLevel:node.HeadingLevel+1] panics for a negative level; Blocks2Hs(html, "-1") reaches it (levels above 6 are clamped just before)
      throw new Error("runtime error: slice bounds out of range");
    }
    const level = headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1);
    attrs.push(["data-subtype", "h" + level]);
    r.blockNodeAttrs(node, attrs, "h" + level);
    r.Tag("div", attrs, false);
    attrs = [];
    r.contenteditable(node, attrs);
    r.spellcheck(attrs);
    r.Tag("div", attrs, false);
  } else {
    r.Tag("/div", null, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderHeadingC8hMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderHeadingID = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderList = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [];
    switch (node.ListData!.Typ) {
      case 0:
        attrs.push(["data-subtype", "u"]);
        break;
      case 1:
        attrs.push(["data-subtype", "o"]);
        break;
      case 3:
        attrs.push(["data-subtype", "t"]);
        break;
    }
    let class_ = "list"; // PORT-NOTE: `class` is a reserved word
    if (ast.NodeMindmap === node.Type) {
      class_ = "mindmap";
    }
    r.blockNodeAttrs(node, attrs, class_);
    r.Tag("div", attrs, false);
  } else {
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderListItem = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let class_ = "li"; // PORT-NOTE: `class` is a reserved word
    if (ast.NodeMindmapItem === node.Type) {
      class_ = "mindmap-item";
    }
    const attrs: string[][] = [];
    switch (node.ListData!.Typ) {
      case 0:
        attrs.push(["data-marker", "*"]);
        attrs.push(["data-subtype", "u"]);
        break;
      case 1:
        attrs.push(["data-marker", strconv.Itoa(node.ListData!.Num) + "."]);
        attrs.push(["data-subtype", "o"]);
        break;
      case 3:
        attrs.push(["data-marker", "*"]);
        attrs.push(["data-subtype", "t"]);
        if (node.FirstChild !== null && ast.NodeTaskListItemMarker === node.FirstChild.Type) {
          if (node.FirstChild.TaskListItemChecked) {
            class_ += " protyle-task--done";
          }

          if (r.Options.DataTask) {
            const marker = node.FirstChild.EffectiveTaskListItemMarker();
            attrs.push(["data-task", marker]);
          }
        }
        break;
    }
    r.blockNodeAttrs(node, attrs, class_);
    r.Tag("div", attrs, false);

    let draggable = "true";
    if (!r.Options.ProtyleContenteditable) {
      draggable = "false";
    }
    if (0 === node.ListData!.Typ) {
      const attr: string[][] = [["class", "protyle-action"], ["draggable", draggable]];
      r.Tag("div", attr, false);
      r.WriteString("<svg><use xlink:href=\"#iconDot\"></use></svg>");
      r.Tag("/div", null, false);
    } else if (1 === node.ListData!.Typ) {
      const attr: string[][] = [["class", "protyle-action protyle-action--order"], ["contenteditable", "false"], ["draggable", draggable]];
      r.Tag("div", attr, false);
      r.WriteString(strconv.Itoa(node.ListData!.Num) + ".");
      r.Tag("/div", null, false);
    }
  } else {
    r.renderIAL(node);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderTaskListItemMarker = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let draggable = "true";
    if (!r.Options.ProtyleContenteditable) {
      draggable = "false";
    }

    if (r.NormalizedTaskListItemChecked(node)) {
      r.WriteString("<div class=\"protyle-action protyle-action--task\" draggable=\"" + draggable + "\"><svg><use xlink:href=\"#iconCheck\"></use></svg></div>");
    } else {
      r.WriteString("<div class=\"protyle-action protyle-action--task\" draggable=\"" + draggable + "\"><svg><use xlink:href=\"#iconUncheck\"></use></svg></div>");
    }
    if (null === node.Next) {
      const paragraph = new ast.Node(ast.NodeParagraph);
      paragraph.ID = ast.NewNodeID();
      node.InsertAfter(paragraph);
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderThematicBreak = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "hr");
    r.Tag("div", attrs, false);
    r.Tag("div", null, false);
  } else {
    r.Tag("/div", null, false);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.renderHardBreak = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return r.renderBr(node, entering);
};

ProtyleRenderer.prototype.renderSoftBreak = function (this: ProtyleRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemNewline);
    if (null !== node.Previous && (ast.NodeStrong === node.Previous.Type ||
      ast.NodeEmphasis === node.Previous.Type ||
      ast.NodeTag === node.Previous.Type ||
      ast.NodeStrikethrough === node.Previous.Type ||
      ast.NodeUnderline === node.Previous.Type ||
      ast.NodeKramdownSpanIAL === node.Previous.Type) &&
      null !== node.Next && bytes.Equal(editor.CaretTokens, nodeTokens(node.Next))) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

ProtyleRenderer.prototype.spanNodeAttrs = function (this: ProtyleRenderer, node: ast.Node, attrs: string[][]): void {
  attrs.push(...(node.KramdownIAL ?? []));
};

ProtyleRenderer.prototype.blockNodeAttrs = function (this: ProtyleRenderer, node: ast.Node, attrs: string[][], class_: string): void {
  const r = this;
  r.nodeID(node, attrs);
  r.nodeIndex(node, attrs);
  r.nodeDataType(node, attrs);
  r.nodeClass(node, attrs, class_);

  for (const ial of node.KramdownIAL ?? []) {
    if ("id" === ial[0]) {
      continue;
    }
    attrs.push([ial[0], strings.ReplaceAll(ial[1], editor.IALValEscNewLine, "\n")]);
  }
};

ProtyleRenderer.prototype.nodeClass = function (this: ProtyleRenderer, node: ast.Node, attrs: string[][], class_: string): void {
  attrs.push(["class", class_]);
};

ProtyleRenderer.prototype.nodeDataType = function (this: ProtyleRenderer, node: ast.Node, attrs: string[][]): void {
  attrs.push(["data-type", ast.NodeTypeString(node.Type)]);
};

ProtyleRenderer.prototype.nodeID = function (this: ProtyleRenderer, node: ast.Node, attrs: string[][]): void {
  const r = this;
  attrs.push(["data-node-id", r.NodeID(node)]);
};

ProtyleRenderer.prototype.nodeIndex = function (this: ProtyleRenderer, node: ast.Node, attrs: string[][]): void {
  const r = this;
  if (null === node.Parent || ast.NodeDocument !== node.Parent.Type) {
    return;
  }

  attrs.push(["data-node-index", strconv.Itoa(r.NodeIndex)]);
  r.NodeIndex++;
  return;
};

ProtyleRenderer.prototype.spellcheck = function (this: ProtyleRenderer, attrs: string[][]): void {
  const r = this;
  attrs.push(["spellcheck", strconv.FormatBool(r.Options.Spellcheck)]);
  return;
};

ProtyleRenderer.prototype.contenteditable = function (this: ProtyleRenderer, node: ast.Node, attrs: string[][]): void {
  const r = this;
  const contenteditable = node.IALAttr("contenteditable");
  if ("" !== contenteditable) {
    attrs.push(["contenteditable", contenteditable]);
  } else {
    attrs.push(["contenteditable", strconv.FormatBool(r.Options.ProtyleContenteditable)]);
  }
  return;
};

ProtyleRenderer.prototype.renderIAL = function (this: ProtyleRenderer, node: ast.Node): void {
  const r = this;
  const attrs: string[][] = [["class", "protyle-attr"], ["contenteditable", "false"]];
  r.Tag("div", attrs, false);

  let bookmark = node.IALAttr("bookmark");
  if ("" !== bookmark) {
    bookmark = strings.ReplaceAll(bookmark, editor.IALValEscNewLine, "\n");
    bookmark = html.EscapeHTMLStr(bookmark);
    r.Tag("div", [["class", "protyle-attr--bookmark"]], false);
    r.WriteString(bookmark);
    r.Tag("/div", null, false);
  }

  let name = node.IALAttr("name");
  if ("" !== name) {
    name = strings.ReplaceAll(name, editor.IALValEscNewLine, "\n");
    name = html.EscapeHTMLStr(name);
    r.Tag("div", [["class", "protyle-attr--name"]], false);
    r.WriteString("<svg><use xlink:href=\"#iconN\"></use></svg>");
    r.WriteString(name);
    r.Tag("/div", null, false);
  }

  let alias = node.IALAttr("alias");
  if ("" !== alias) {
    alias = strings.ReplaceAll(alias, editor.IALValEscNewLine, "\n");
    alias = html.EscapeHTMLStr(alias);
    r.Tag("div", [["class", "protyle-attr--alias"]], false);
    r.WriteString("<svg><use xlink:href=\"#iconA\"></use></svg>");
    r.WriteString(alias);
    r.Tag("/div", null, false);
  }

  let memo = node.IALAttr("memo");
  if ("" !== memo) {
    memo = strings.ReplaceAll(memo, editor.IALValEscNewLine, "\n");
    memo = html.EscapeHTMLStr(memo);
    r.Tag("div", [["class", "protyle-attr--memo ariaLabel"], ["aria-label", memo], ["data-position", "4north"]], false);
    r.WriteString("<svg><use xlink:href=\"#iconM\"></use></svg>");
    r.Tag("/div", null, false);
  }

  let avs = node.IALAttr("custom-avs");
  if ("" !== avs) {
    avs = strings.ReplaceAll(avs, editor.IALValEscNewLine, "\n");
    avs = html.EscapeHTMLStr(avs);
    r.Tag("div", [["class", "protyle-attr--av"]], false);
    r.WriteString("<svg><use xlink:href=\"#iconDatabase\"></use></svg>");
    r.WriteString(node.IALAttr("av-names"));
    r.Tag("/div", null, false);
  }

  let refCount = node.IALAttr("refcount");
  if ("" !== refCount) {
    refCount = strings.ReplaceAll(refCount, editor.IALValEscNewLine, "\n");
    refCount = html.EscapeHTMLStr(refCount);
    r.Tag("div", [["class", "protyle-attr--refcount popover__block"]], false);
    r.WriteString(refCount);
    r.Tag("/div", null, false);
  }

  r.WriteString(editor.Zwsp);
  r.Tag("/div", null, false);
};

ProtyleRenderer.prototype.ensureInlineBoundaryZwsp = function (this: ProtyleRenderer): void {
  const r = this;
  // The zero-width space on the left of an editable inline element provides a line-break and caret boundary.
  if (!bytes.HasSuffix(r.Writer.Bytes(), zwspBytes)) {
    r.WriteString(editor.Zwsp);
  }
};

ProtyleRenderer.prototype.renderTextMarkAttrs = function (this: ProtyleRenderer, node: ast.Node): string[][] {
  const r = this;
  let attrs: string[][] = [];
  attrs = [["data-type", node.TextMarkType]];
  if ("" !== node.TextMarkFlashcardOcclusionID) {
    attrs.push(["data-occlusion-id", node.TextMarkFlashcardOcclusionID]);
  }

  const types = strings.Split(node.TextMarkType, " ");
  for (const typ of types) {
    if ("block-ref" === typ) {
      attrs.push(["data-subtype", node.TextMarkBlockRefSubtype]);
      attrs.push(["data-id", node.TextMarkBlockRefID]);
      if ("" === strings.TrimSpace(strings.ReplaceAll(node.TextMarkTextContent, editor.Zwsp, ""))) {
        node.TextMarkTextContent = node.TextMarkBlockRefID;
      }
    } else if ("a" === typ) {
      let href = node.TextMarkAHref;
      if (r.Options.Sanitize) {
        if (strings.HasPrefix(strings.ToLower(href), "javascript:")) {
          href = "";
        }
      }
      href = conv.StringFromBytes(r.LinkPath(conv.BytesFromString(href)));
      if (node.ParentIs(ast.NodeTableCell)) {
        href = strings.ReplaceAll(href, "\\|", "|");
      }
      // Pasting does not parse correctly when the hyperlink address contains the `"` character https://github.com/siyuan-note/siyuan/issues/11385
      href = strings.ReplaceAll(href, "\"", "&amp;quot;");

      attrs.push(["data-href", href]);
      if ("" !== node.TextMarkATitle) {
        // Pasting does not parse correctly when the hyperlink title contains the `"` character https://github.com/siyuan-note/siyuan/issues/5974
        let title = strings.ReplaceAll(node.TextMarkATitle, "\"", "&amp;quot;");
        if (node.ParentIs(ast.NodeTableCell)) {
          title = strings.ReplaceAll(title, "\\|", "|");
        }
        attrs.push(["data-title", title]);
      }
    } else if ("inline-math" === typ) {
      attrs.push(["data-subtype", "math"]);
      let content = node.TextMarkInlineMathContent;
      if (node.ParentIs(ast.NodeTableCell)) {
        // Improve the handling of inline-math containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9227
        content = strings.ReplaceAll(content, "|", "&#124;");
        content = strings.ReplaceAll(content, "\n", "<br/>");
      }
      content = strings.ReplaceAll(content, editor.IALValEscNewLine, "\n");
      // Improve inline formulas input https://github.com/siyuan-note/siyuan/issues/8972
      //content = strings.ReplaceAll(inlineMathContent, editor.Caret, "")
      content = strings.ReplaceAll(content, "\"", "&amp;quot;");
      attrs.push(["data-content", content]);
      attrs.push(["contenteditable", "false"]);
      attrs.push(["class", "render-node"]);
    } else if ("file-annotation-ref" === typ) {
      attrs.push(["data-id", html.EscapeHTMLStr(node.TextMarkFileAnnotationRefID)]);
    } else if ("inline-memo" === typ) {
      let content = node.TextMarkInlineMemoContent;
      content = strings.ReplaceAll(content, editor.IALValEscNewLine, "\n");
      attrs.push(["data-inline-memo-content", content]);
    }
  }
  return attrs;
};

ProtyleRenderer.prototype.tokensStyle = function (this: ProtyleRenderer, tokens: Uint8Array): string {
  const tokensStr = util.BytesToStr(tokens);
  const styleIndex = strings.Index(tokensStr, "style=");
  if (styleIndex !== -1) {
    // PORT-NOTE: Go panics (slice bounds out of range) when the tokens end with `style=`; a JS slice would return "" instead
    if (styleIndex + 7 > tokensStr.length) {
      throw new Error("slice bounds out of range [" + (styleIndex + 7) + ":" + tokensStr.length + "]");
    }
    const quoteChar = tokensStr.slice(styleIndex + 6, styleIndex + 7);
    const endIndex = strings.Index(tokensStr.slice(styleIndex + 7), quoteChar);
    if (endIndex !== -1) {
      return tokensStr.slice(styleIndex + 7, styleIndex + 7 + endIndex);
    }
  }
  return "";
};


function tableCellWidthStyle(style: string): string {
  const ret: string[] = [];
  for (let declaration of strings.Split(style, ";")) {
    declaration = strings.TrimSpace(declaration);
    let [property, , found] = strings.Cut(declaration, ":");
    property = strings.TrimSpace(property);
    if (found && ("width" === property || strings.HasSuffix(property, "-width"))) {
      ret.push(declaration + ";");
    }
  }
  return strings.Join(ret, "");
}

// NewProtyleRenderer creates a WYSIWYG Block DOM renderer.
export function NewProtyleRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): ProtyleRenderer {
  const ret = new ProtyleRenderer(tree, options, parseOptions);
  ret.RendererFuncs.set(ast.NodeDocument, ret.renderDocument.bind(ret));
  ret.RendererFuncs.set(ast.NodeParagraph, ret.renderParagraph.bind(ret));
  ret.RendererFuncs.set(ast.NodeText, ret.renderText.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeSpan, ret.renderCodeSpan.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeSpanOpenMarker, ret.renderCodeSpanOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeSpanContent, ret.renderCodeSpanContent.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeSpanCloseMarker, ret.renderCodeSpanCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeBlock, ret.renderCodeBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeBlockFenceOpenMarker, ret.renderCodeBlockOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeBlockFenceInfoMarker, ret.renderCodeBlockInfoMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeBlockCode, ret.renderCodeBlockCode.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeBlockFenceCloseMarker, ret.renderCodeBlockCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeMathBlock, ret.renderMathBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeMathBlockOpenMarker, ret.renderMathBlockOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeMathBlockContent, ret.renderMathBlockContent.bind(ret));
  ret.RendererFuncs.set(ast.NodeMathBlockCloseMarker, ret.renderMathBlockCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeInlineMath, ret.renderInlineMath.bind(ret));
  ret.RendererFuncs.set(ast.NodeInlineMathOpenMarker, ret.renderInlineMathOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeInlineMathContent, ret.renderInlineMathContent.bind(ret));
  ret.RendererFuncs.set(ast.NodeInlineMathCloseMarker, ret.renderInlineMathCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmphasis, ret.renderEmphasis.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmA6kOpenMarker, ret.renderEmAsteriskOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmA6kCloseMarker, ret.renderEmAsteriskCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmU8eOpenMarker, ret.renderEmUnderscoreOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmU8eCloseMarker, ret.renderEmUnderscoreCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrong, ret.renderStrong.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrongA6kOpenMarker, ret.renderStrongA6kOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrongA6kCloseMarker, ret.renderStrongA6kCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrongU8eOpenMarker, ret.renderStrongU8eOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrongU8eCloseMarker, ret.renderStrongU8eCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockquote, ret.renderBlockquote.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockquoteMarker, ret.renderBlockquoteMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeHeading, ret.renderHeading.bind(ret));
  ret.RendererFuncs.set(ast.NodeHeadingC8hMarker, ret.renderHeadingC8hMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeHeadingID, ret.renderHeadingID.bind(ret));
  ret.RendererFuncs.set(ast.NodeList, ret.renderList.bind(ret));
  ret.RendererFuncs.set(ast.NodeListItem, ret.renderListItem.bind(ret));
  ret.RendererFuncs.set(ast.NodeMindmap, ret.renderList.bind(ret));
  ret.RendererFuncs.set(ast.NodeMindmapItem, ret.renderListItem.bind(ret));
  ret.RendererFuncs.set(ast.NodeThematicBreak, ret.renderThematicBreak.bind(ret));
  ret.RendererFuncs.set(ast.NodeHardBreak, ret.renderHardBreak.bind(ret));
  ret.RendererFuncs.set(ast.NodeSoftBreak, ret.renderSoftBreak.bind(ret));
  ret.RendererFuncs.set(ast.NodeHTMLBlock, ret.renderHTML.bind(ret));
  ret.RendererFuncs.set(ast.NodeInlineHTML, ret.renderInlineHTML.bind(ret));
  ret.RendererFuncs.set(ast.NodeLink, ret.renderLink.bind(ret));
  ret.RendererFuncs.set(ast.NodeImage, ret.renderImage.bind(ret));
  ret.RendererFuncs.set(ast.NodeBang, ret.renderBang.bind(ret));
  ret.RendererFuncs.set(ast.NodeOpenBracket, ret.renderOpenBracket.bind(ret));
  ret.RendererFuncs.set(ast.NodeCloseBracket, ret.renderCloseBracket.bind(ret));
  ret.RendererFuncs.set(ast.NodeOpenParen, ret.renderOpenParen.bind(ret));
  ret.RendererFuncs.set(ast.NodeCloseParen, ret.renderCloseParen.bind(ret));
  ret.RendererFuncs.set(ast.NodeLess, ret.renderLess.bind(ret));
  ret.RendererFuncs.set(ast.NodeGreater, ret.renderGreater.bind(ret));
  ret.RendererFuncs.set(ast.NodeOpenBrace, ret.renderOpenBrace.bind(ret));
  ret.RendererFuncs.set(ast.NodeCloseBrace, ret.renderCloseBrace.bind(ret));
  ret.RendererFuncs.set(ast.NodeLinkText, ret.renderLinkText.bind(ret));
  ret.RendererFuncs.set(ast.NodeLinkSpace, ret.renderLinkSpace.bind(ret));
  ret.RendererFuncs.set(ast.NodeLinkDest, ret.renderLinkDest.bind(ret));
  ret.RendererFuncs.set(ast.NodeLinkTitle, ret.renderLinkTitle.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrikethrough, ret.renderStrikethrough.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrikethrough1OpenMarker, ret.renderStrikethrough1OpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrikethrough1CloseMarker, ret.renderStrikethrough1CloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrikethrough2OpenMarker, ret.renderStrikethrough2OpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrikethrough2CloseMarker, ret.renderStrikethrough2CloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeTaskListItemMarker, ret.renderTaskListItemMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeTable, ret.renderTable.bind(ret));
  ret.RendererFuncs.set(ast.NodeTableHead, ret.renderTableHead.bind(ret));
  ret.RendererFuncs.set(ast.NodeTableRow, ret.renderTableRow.bind(ret));
  ret.RendererFuncs.set(ast.NodeTableCell, ret.renderTableCell.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmoji, ret.renderEmoji.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmojiUnicode, ret.renderEmojiUnicode.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmojiImg, ret.renderEmojiImg.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmojiAlias, ret.renderEmojiAlias.bind(ret));
  ret.RendererFuncs.set(ast.NodeFootnotesDefBlock, ret.renderFootnotesDefBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeFootnotesDef, ret.renderFootnotesDef.bind(ret));
  ret.RendererFuncs.set(ast.NodeFootnotesRef, ret.renderFootnotesRef.bind(ret));
  ret.RendererFuncs.set(ast.NodeToC, ret.renderToC.bind(ret));
  ret.RendererFuncs.set(ast.NodeBackslash, ret.renderBackslash.bind(ret));
  ret.RendererFuncs.set(ast.NodeBackslashContent, ret.renderBackslashContent.bind(ret));
  ret.RendererFuncs.set(ast.NodeHTMLEntity, ret.renderHtmlEntity.bind(ret));
  ret.RendererFuncs.set(ast.NodeYamlFrontMatter, ret.renderYamlFrontMatter.bind(ret));
  ret.RendererFuncs.set(ast.NodeYamlFrontMatterOpenMarker, ret.renderYamlFrontMatterOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeYamlFrontMatterContent, ret.renderYamlFrontMatterContent.bind(ret));
  ret.RendererFuncs.set(ast.NodeYamlFrontMatterCloseMarker, ret.renderYamlFrontMatterCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockRef, ret.renderBlockRef.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockRefID, ret.renderBlockRefID.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockRefSpace, ret.renderBlockRefSpace.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockRefText, ret.renderBlockRefText.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockRefDynamicText, ret.renderBlockRefDynamicText.bind(ret));
  ret.RendererFuncs.set(ast.NodeFileAnnotationRef, ret.renderFileAnnotationRef.bind(ret));
  ret.RendererFuncs.set(ast.NodeFileAnnotationRefID, ret.renderFileAnnotationRefID.bind(ret));
  ret.RendererFuncs.set(ast.NodeFileAnnotationRefSpace, ret.renderFileAnnotationRefSpace.bind(ret));
  ret.RendererFuncs.set(ast.NodeFileAnnotationRefText, ret.renderFileAnnotationRefText.bind(ret));
  ret.RendererFuncs.set(ast.NodeMark, ret.renderMark.bind(ret));
  ret.RendererFuncs.set(ast.NodeMark1OpenMarker, ret.renderMark1OpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeMark1CloseMarker, ret.renderMark1CloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeMark2OpenMarker, ret.renderMark2OpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeMark2CloseMarker, ret.renderMark2CloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeSup, ret.renderSup.bind(ret));
  ret.RendererFuncs.set(ast.NodeSupOpenMarker, ret.renderSupOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeSupCloseMarker, ret.renderSupCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeSub, ret.renderSub.bind(ret));
  ret.RendererFuncs.set(ast.NodeSubOpenMarker, ret.renderSubOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeSubCloseMarker, ret.renderSubCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeKramdownBlockIAL, ret.renderKramdownBlockIAL.bind(ret));
  ret.RendererFuncs.set(ast.NodeKramdownSpanIAL, ret.renderKramdownSpanIAL.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockQueryEmbed, ret.renderBlockQueryEmbed.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockQueryEmbedScript, ret.renderBlockQueryEmbedScript.bind(ret));
  ret.RendererFuncs.set(ast.NodeTag, ret.renderTag.bind(ret));
  ret.RendererFuncs.set(ast.NodeTagOpenMarker, ret.renderTagOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeTagCloseMarker, ret.renderTagCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeLinkRefDefBlock, ret.renderLinkRefDefBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeLinkRefDef, ret.renderLinkRefDef.bind(ret));
  ret.RendererFuncs.set(ast.NodeSuperBlock, ret.renderSuperBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeSuperBlockOpenMarker, ret.renderSuperBlockOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeSuperBlockLayoutMarker, ret.renderSuperBlockLayoutMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeSuperBlockCloseMarker, ret.renderSuperBlockCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeGitConflict, ret.renderGitConflict.bind(ret));
  ret.RendererFuncs.set(ast.NodeGitConflictOpenMarker, ret.renderGitConflictOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeGitConflictContent, ret.renderGitConflictContent.bind(ret));
  ret.RendererFuncs.set(ast.NodeGitConflictCloseMarker, ret.renderGitConflictCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeIFrame, ret.renderIFrame.bind(ret));
  ret.RendererFuncs.set(ast.NodeWidget, ret.renderWidget.bind(ret));
  ret.RendererFuncs.set(ast.NodeVideo, ret.renderVideo.bind(ret));
  ret.RendererFuncs.set(ast.NodeAudio, ret.renderAudio.bind(ret));
  ret.RendererFuncs.set(ast.NodeKbd, ret.renderKbd.bind(ret));
  ret.RendererFuncs.set(ast.NodeKbdOpenMarker, ret.renderKbdOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeKbdCloseMarker, ret.renderKbdCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeUnderline, ret.renderUnderline.bind(ret));
  ret.RendererFuncs.set(ast.NodeUnderlineOpenMarker, ret.renderUnderlineOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeUnderlineCloseMarker, ret.renderUnderlineCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeBr, ret.renderBr.bind(ret));
  ret.RendererFuncs.set(ast.NodeTextMark, ret.renderTextMark.bind(ret));
  ret.RendererFuncs.set(ast.NodeAttributeView, ret.renderAttributeView.bind(ret));
  ret.RendererFuncs.set(ast.NodeCustomBlock, ret.renderCustomBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeCallout, ret.renderCallout.bind(ret));
  ret.RendererFuncs.set(ast.NodeTabs, ret.renderTabs.bind(ret));
  ret.RendererFuncs.set(ast.NodeTabItem, ret.renderTabs.bind(ret));
  return ret;
}
