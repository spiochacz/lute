// Ported from render/format_renderer.go @ 8e7896b6
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
import { BaseRenderer, FormatRenderer } from "./types.ts";
import { nodeTokens, setWriterFromOwn } from "./renderer.ts";
import type { Options } from "./renderer.ts";
import { calloutTitle } from "./callout.ts";
import { escapeSetextHeadingMarkersInListParagraph } from "./setext.ts";
import { escapeTabsParagraphMarkers } from "./tabs.ts";
// PORT-NOTE: the following files only attach methods to BaseRenderer (see PORTING.md); importing them here makes sure the methods exist
// whenever format_renderer.ts is imported on its own. tabs.ts (FormatRenderer.renderTabs, tabsFenceLength) is imported above.
import "./link.ts";
import "./space.ts";
import "./term_typographer.ts";

const spaceBytes: Uint8Array = conv.BytesFromString(" ");
const caretSpaceBytes: Uint8Array = conv.BytesFromString(editor.Caret + " ");
const apostropheBytes: Uint8Array = conv.BytesFromString("'");
const apos: Uint8Array = conv.BytesFromString("&apos;");
const escapedPipeBytes: Uint8Array = conv.BytesFromString("\\|");
const pipeBytes: Uint8Array = conv.BytesFromString("|");
const br1Bytes: Uint8Array = conv.BytesFromString("<br/>");
const newlineBytes: Uint8Array = conv.BytesFromString("\n");
const superBlockOpen: Uint8Array = conv.BytesFromString("{{{");
const superBlockClose: Uint8Array = conv.BytesFromString("}}}");
const blankTrimChars = " \t\n";
const newlineTrimChars = "\n";
const hyphenBytes: Uint8Array = new Uint8Array([lex.ItemHyphen]);
const backtickBytes: Uint8Array = new Uint8Array([lex.ItemBacktick]);
const crosshatchBytes: Uint8Array = new Uint8Array([lex.ItemCrosshatch]);

declare module "./types.ts" {
  interface FormatRenderer {
    // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: newBuffer and trimWriterTo are the only ways the
    // writer of a container is created and the root writer is trimmed. The default is the statement they replace.
    newBuffer(): bytes.Buffer;
    trimWriterTo(buf: Uint8Array): void;
    renderCallout(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHTMLTag(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHTMLTagOpen(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHTMLTagClose(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCustomBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderAttributeView(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTextMark(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTextMarkAttrs(node: ast.Node): string[][];
    renderBr(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderUnderline(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderUnderlineOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderUnderlineCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderKbd(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderKbdOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderKbdCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderVideo(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderAudio(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderIFrame(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderWidget(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGitConflictCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGitConflictContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGitConflictOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGitConflict(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSuperBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSuperBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSuperBlockLayoutMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderSuperBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLinkRefDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLinkRefDef(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTag(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTagOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTagCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
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
    renderBlockQueryEmbedScript(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockQueryEmbed(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockRef(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockRefID(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockRefSpace(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockRefText(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockRefDynamicText(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFileAnnotationRef(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFileAnnotationRefID(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFileAnnotationRefSpace(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFileAnnotationRefText(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderYamlFrontMatterCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderYamlFrontMatterContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderYamlFrontMatterOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderYamlFrontMatter(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderHtmlEntity(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBackslashContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBackslash(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderToC(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFootnotesRef(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFootnotesDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderFootnotesDef(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmojiAlias(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmojiImg(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmojiUnicode(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmoji(node: ast.Node, entering: boolean): ast.WalkStatus;
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
    renderGreater(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLess(node: ast.Node, entering: boolean): ast.WalkStatus;
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
    renderInlineMath(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMathOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMathContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMathCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlockContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockCode(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockInfoMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
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
    withoutKramdownBlockIAL(node: ast.Node): boolean;
    newlineBeforeBlock(node: ast.Node): void;
  }
}

FormatRenderer.prototype.renderCallout = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.renderBlockquote(node, entering);
    r.WriteString("[!");
    r.WriteString(node.CalloutType);
    r.WriteByte(0x5d /* ] */);
    const title = calloutTitle(node);
    if ("" !== title) {
      r.WriteByte(lex.ItemSpace);
      r.WriteString(title);
    }
    r.Newline();
  } else {
    r.renderBlockquote(node, entering);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderHTMLTag = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderHTMLTagOpen = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderHTMLTagClose = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCustomBlock = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    r.WriteString(";;;");
    r.WriteString(node.CustomBlockInfo);
    r.Newline();
    r.Write(nodeTokens(node));
    r.Newline();
    r.WriteString(";;;");
    if (!r.isLastNode(r.Tree.Root!, node)) {
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderAttributeView = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    r.Tag("div", [
      ["data-type", "NodeAttributeView"],
      ["data-av-id", node.AttributeViewID],
      ["data-av-type", node.AttributeViewType],
    ], false);
    r.WriteString("</div>");
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderTextMark = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (parse.ContainTextMark(node, "code", "inline-math", "kbd")) {
      if (r.Options.AutoSpace) {
        let text = node.PreviousNodeText();
        if ("" !== text) {
          let [lastc] = utf8.DecodeLastRuneInString(text);
          if (editor.Zwsp === conv.StringFromRune(lastc)) {
            text = strings.TrimSuffix(text, editor.Zwsp);
            [lastc] = utf8.DecodeLastRuneInString(text);
          }
          if (unicode.IsLetter(lastc) || unicode.IsDigit(lastc)) {
            r.WriteByte(lex.ItemSpace);
          }
        }
      }
    } else {
      r.TextAutoSpacePrevious(node);
    }

    const attrs = r.renderTextMarkAttrs(node);
    r.Tag("span", attrs, false);
    let textContent = node.TextMarkTextContent;
    if (node.ParentIs(ast.NodeTableCell)) {
      textContent = strings.ReplaceAll(textContent, "\\|", "|");
      if (!node.IsTextMarkType("code")) {
        textContent = strings.ReplaceAll(textContent, "|", "\\|");
      } else {
        textContent = strings.ReplaceAll(textContent, "|", "&#124;");
      }
      textContent = strings.ReplaceAll(textContent, "\n", "<br/>");
      if (strings.Contains(node.TextMarkType, "code")) {
        textContent = strings.ReplaceAll(textContent, "<br/>", "");
      }
    }

    if (r.Options.AutoSpace && !parse.ContainTextMark(node, "block-ref", "code", "inline-math", "kbd", "tag")) {
      // `Optimize typesetting` supports bold, italic, etc. of inline elements https://github.com/siyuan-note/siyuan/issues/6800
      textContent = conv.StringFromBytes(r.Space(conv.BytesFromString(textContent)));
    }

    r.WriteString(textContent);
  } else {
    r.WriteString("</span>");
    if (parse.ContainTextMark(node, "code", "inline-math", "kbd")) {
      if (r.Options.AutoSpace) {
        let text = node.NextNodeText();
        if ("" !== text) {
          let [firstc] = utf8.DecodeRuneInString(text);
          if (editor.Zwsp === conv.StringFromRune(firstc)) {
            text = strings.TrimPrefix(text, editor.Zwsp);
            [firstc] = utf8.DecodeRuneInString(text);
          }
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

FormatRenderer.prototype.renderTextMarkAttrs = function (this: FormatRenderer, node: ast.Node): string[][] {
  const r = this;
  let attrs: string[][] = [["data-type", node.TextMarkType]];
  if ("" !== node.TextMarkFlashcardOcclusionID) {
    attrs.push(["data-occlusion-id", node.TextMarkFlashcardOcclusionID]);
  }

  const types = strings.Split(node.TextMarkType, " ");
  for (const typ of types) {
    if ("block-ref" === typ) {
      attrs.push(["data-subtype", node.TextMarkBlockRefSubtype]);
      attrs.push(["data-id", node.TextMarkBlockRefID]);
    } else if ("a" === typ) {
      let href = node.TextMarkAHref;
      href = conv.StringFromBytes(r.LinkPath(conv.BytesFromString(href)));

      if (node.ParentIs(ast.NodeTableCell)) {
        href = strings.ReplaceAll(href, "\\|", "|");
        href = strings.ReplaceAll(href, "|", "\\|");
      }

      attrs.push(["data-href", href]);
      if ("" !== node.TextMarkATitle) {
        let title = node.TextMarkATitle;
        if (node.ParentIs(ast.NodeTableCell)) {
          title = strings.ReplaceAll(title, "\\|", "|");
          title = strings.ReplaceAll(title, "|", "\\|");
        }
        attrs.push(["data-title", title]);
      }
    } else if ("inline-math" === typ) {
      attrs.push(["data-subtype", "math"]);
      let inlineMathContent = node.TextMarkInlineMathContent;
      if (node.ParentIs(ast.NodeTableCell)) {
        // Improve the handling of inline-math containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9227
        inlineMathContent = strings.ReplaceAll(inlineMathContent, "|", "&#124;");
        inlineMathContent = strings.ReplaceAll(inlineMathContent, "\n", "<br/>");
      }
      inlineMathContent = html.EscapeHTMLStr(inlineMathContent);
      attrs.push(["data-content", inlineMathContent]);
      attrs.push(["contenteditable", "false"]);
      attrs.push(["class", "render-node"]);
    } else if ("file-annotation-ref" === typ) {
      attrs.push(["data-id", html.EscapeHTMLStr(node.TextMarkFileAnnotationRefID)]);
    } else if ("inline-memo" === typ) {
      const inlineMemoContent = node.TextMarkInlineMemoContent;
      attrs.push(["data-inline-memo-content", inlineMemoContent]);
    }
  }
  return attrs;
};

FormatRenderer.prototype.renderBr = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (node.ParentIs(ast.NodeTableCell)) {
      r.WriteString("<br />");
    } else {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderUnderline = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderUnderlineOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<u>");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderUnderlineCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</u>");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderKbd = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderKbdOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<kbd>");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderKbdCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</kbd>");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderVideo = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens: Uint8Array = nodeTokens(node);
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderAudio = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens: Uint8Array = nodeTokens(node);
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderIFrame = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens: Uint8Array = nodeTokens(node);
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderWidget = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens: Uint8Array = nodeTokens(node);
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderGitConflictCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
    r.Newline();
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderGitConflictContent = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    r.Write(nodeTokens(node));
    r.Newline();
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderGitConflictOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
    r.Newline();
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderGitConflict = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSuperBlock = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSuperBlockOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering && r.Options.SuperBlock) {
    r.Write(superBlockOpen);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSuperBlockLayoutMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering && r.Options.SuperBlock) {
    r.Write(nodeTokens(node));
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSuperBlockCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (r.Options.SuperBlock) {
      r.Newline();
      r.Write(superBlockClose);
      r.Newline();
    }
    if (!r.isLastNode(r.Tree.Root!, node)) {
      if (r.withoutKramdownBlockIAL(node.Parent!)) {
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderLinkRefDefBlock = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderLinkRefDef = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemOpenBracket);
    r.Write(nodeTokens(node));
    r.WriteString("]: ");
  } else {
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderTag = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderTagOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCrosshatch);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderTagCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCrosshatch);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderKramdownBlockIAL = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!r.Options.KramdownBlockIAL) {
    return ast.WalkContinue;
  }

  if (null !== node.Previous && (ast.NodeListItem === node.Previous.Type || ast.NodeMindmapItem === node.Previous.Type || ast.NodeTabItem === node.Previous.Type)) {
    return ast.WalkContinue;
  }
  if (entering) {
    r.Newline();
    if (r.Options.KramdownBlockIAL) {
      if (util.IsDocIAL(nodeTokens(node))) {
        r.WriteByte(lex.ItemNewline);
      }
      r.Write(nodeTokens(node));
    }
  } else {
    if (ast.NodeListItem === node.Parent!.Type || ast.NodeMindmapItem === node.Parent!.Type || ast.NodeList === node.Parent!.Type || ast.NodeMindmap === node.Parent!.Type) {
      if (!node.Parent!.ListData!.Tight) {
        r.Newline();
      }
    } else {
      r.Newline();
    }
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderKramdownSpanIAL = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!r.Options.KramdownSpanIAL) {
    return ast.WalkContinue;
  }
  if (isTableCellIALNode(node)) {
    return ast.WalkContinue;
  }

  if (entering) {
    r.Write(nodeTokens(node));
  } else {
    const previous = node.Previous;
    if (null !== previous && parse.ContainTextMark(previous, "code", "inline-math", "kbd") && r.Options.AutoSpace) {
      let text = node.NextNodeText();
      if ("" !== text) {
        let [firstc] = utf8.DecodeRuneInString(text);
        if (editor.Zwsp === conv.StringFromRune(firstc)) {
          text = strings.TrimPrefix(text, editor.Zwsp);
          [firstc] = utf8.DecodeRuneInString(text);
        }
        if (unicode.IsLetter(firstc) || unicode.IsDigit(firstc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderMark = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderMark1OpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("=");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderMark1CloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("=");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderMark2OpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("==");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderMark2CloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("==");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSup = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSupOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("^");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSupCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("^");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSub = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSubOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("~");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSubCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("~");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBlockQueryEmbedScript = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBlockQueryEmbed = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
  } else {
    r.Newline();
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBlockRef = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBlockRefID = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBlockRefSpace = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemSpace);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBlockRefText = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDoublequote);
    let tokens: Uint8Array = html.EscapeHTML(nodeTokens(node));
    tokens = bytes.ReplaceAll(tokens, apostropheBytes, apos);
    r.Write(tokens);
    r.WriteByte(lex.ItemDoublequote);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBlockRefDynamicText = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemSinglequote);
    let tokens: Uint8Array = html.EscapeHTML(nodeTokens(node));
    tokens = bytes.ReplaceAll(tokens, apostropheBytes, apos);
    r.Write(tokens);
    r.WriteByte(lex.ItemSinglequote);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderFileAnnotationRef = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderFileAnnotationRefID = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderFileAnnotationRefSpace = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemSpace);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderFileAnnotationRefText = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDoublequote);
    let tokens: Uint8Array = html.EscapeHTML(nodeTokens(node));
    tokens = bytes.ReplaceAll(tokens, apostropheBytes, apos);
    r.Write(tokens);
    r.WriteByte(lex.ItemDoublequote);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderYamlFrontMatterCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(parse.YamlFrontMatterMarker);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderYamlFrontMatterContent = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderYamlFrontMatterOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(parse.YamlFrontMatterMarker);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderYamlFrontMatter = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    // UPSTREAM-BUG: `!entering` is always false inside `if entering`, so the blank line after the front matter is never written here (dead code)
    if (!entering && !r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderHtmlEntity = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(node.HtmlEntityTokens);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBackslashContent = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBackslash = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemBackslash);
  }
  return ast.WalkContinue;
};

// PORT-NOTE: Go embedding, BaseRenderer also defines renderToC; no base-class method calls it.
FormatRenderer.prototype.renderToC = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("[toc]\n\n");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderFootnotesRef = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("[" + util.BytesToStr(nodeTokens(node)) + "]");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderFootnotesDefBlock = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderFootnotesDef = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Writer = r.newBuffer(); // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the default is new bytes.Buffer()
    r.NodeWriterStack.push(r.Writer);
    r.WriteString("[" + util.BytesToStr(nodeTokens(node)) + "]: ");
  } else {
    const writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    r.NodeWriterStack.length = r.NodeWriterStack.length - 1;
    const buf = writer.String();
    const lines = strings.Split(buf, "\n");
    const contentBuf = new bytes.Buffer();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (0 === i) {
        contentBuf.WriteString(line + "\n");
      } else {
        if ("" === line) {
          contentBuf.WriteString("\n");
        } else {
          contentBuf.WriteString("    " + line + "\n");
        }
      }
    }
    r.NodeWriterStack[r.NodeWriterStack.length - 1].Write(contentBuf.Bytes());
    r.Writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderEmojiAlias = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderEmojiImg = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderEmojiUnicode = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderEmoji = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderTableCell = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  const padding = node.TableCellContentMaxWidth - node.TableCellContentWidth;
  if (entering) {
    r.WriteByte(lex.ItemPipe);
    if (null !== node.TableCellRich) {
      const ial: string[][] = [...(node.KramdownIAL ?? [])];
      ial.push([ast.TableCellRichIAL, node.TableCellRich.Encode()]);
      r.Write(parse.IAL2Tokens(ial));
    }
    if (!r.Options.ProtyleWYSIWYG) {
      r.WriteByte(lex.ItemSpace);
      switch (node.TableCellAlign) {
        case 2:
          r.Write(bytes.Repeat(spaceBytes, Math.trunc(padding / 2)));
          break;
        case 3:
          r.Write(bytes.Repeat(spaceBytes, padding));
          break;
      }
    }
    if (r.Options.KramdownSpanIAL && null === node.TableCellRich) {
      r.Write(tableCellFullIALTokens(node));
    }
    // The colspan/rowspan/fn__none of merged table cells are structural attributes and must survive the Markdown round trip.
    // When the KramdownSpanIAL render option is off (for example SiYuan html2BlockDOM), renderKramdownSpanIAL does not output
    // the NodeKramdownSpanIAL child nodes, so they are written here from KramdownIAL to avoid losing the merge information.
    // When the option is on, renderKramdownSpanIAL outputs them uniformly and this is skipped to avoid duplicates.
    if (!r.Options.KramdownSpanIAL && null === node.TableCellRich) {
      const ialTokens = tableCellStructIALTokens(node);
      if (null !== ialTokens) {
        r.Write(ialTokens);
      }
    }
  } else {
    if (!r.Options.ProtyleWYSIWYG) {
      switch (node.TableCellAlign) {
        case 2:
          r.Write(bytes.Repeat(spaceBytes, Math.trunc(padding / 2)));
          break;
        case 3:
          break;
        default:
          r.Write(bytes.Repeat(spaceBytes, padding));
          break;
      }
      r.WriteByte(lex.ItemSpace);
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderTableRow = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    r.WriteString("|\n");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderTableHead = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    const headRow = node.FirstChild!;
    for (let th = headRow.FirstChild; null !== th; th = th.Next) {
      if (ast.NodeKramdownSpanIAL === th.Type) {
        continue;
      }

      const align = th.TableCellAlign;
      switch (align) {
        case 0: {
          r.WriteString("| -");
          const padding = th.TableCellContentMaxWidth - 1;
          if (0 < padding) {
            r.Write(bytes.Repeat(hyphenBytes, padding));
          }
          if (!r.Options.ProtyleWYSIWYG) {
            r.WriteByte(lex.ItemSpace);
          }
          break;
        }
        case 1: {
          r.WriteString("| :-");
          const padding = th.TableCellContentMaxWidth - 2;
          if (0 < padding) {
            r.Write(bytes.Repeat(hyphenBytes, padding));
          }
          if (!r.Options.ProtyleWYSIWYG) {
            r.WriteByte(lex.ItemSpace);
          }
          break;
        }
        case 2: {
          r.WriteString("| :-");
          const padding = th.TableCellContentMaxWidth - 3;
          if (0 < padding) {
            r.Write(bytes.Repeat(hyphenBytes, padding));
          }
          r.WriteString(": ");
          break;
        }
        case 3: {
          r.WriteString("| -");
          const padding = th.TableCellContentMaxWidth - 2;
          if (0 < padding) {
            r.Write(bytes.Repeat(hyphenBytes, padding));
          }
          r.WriteString(": ");
          break;
        }
      }
    }
    r.WriteString("|\n");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderTable = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    // Traverse the cells to work out the maximum widths

    const cells: ast.Node[][] = [];
    cells.push([]);

    const headRow = node.ChildByType(ast.NodeTableHead);
    if (null === headRow || null === headRow.FirstChild || null === node.FirstChild) {
      return ast.WalkSkipChildren;
    }

    for (let n = headRow.FirstChild.FirstChild; null !== n; n = n.Next) {
      cells[0].push(n);
    }

    let i = 1;
    for (let tableRow = node.FirstChild.Next; null !== tableRow; tableRow = tableRow.Next) {
      cells.push([]);
      for (let n = tableRow.FirstChild; null !== n; n = n.Next) {
        cells[i].push(n);
      }
      i++;
    }

    let maxWidth = 0;
    for (let col = 0; col < cells[0].length; col++) {
      for (let row = 0; row < cells.length && col < cells[row].length; row++) {
        cells[row][col].TableCellContentWidth = cells[row][col].TokenLen();
        // Automatically adding spaces changes the cell width
        if (r.Options.AutoSpace) {
          let ret = 0;
          // Walk the child nodes and work out the spaces that may be added
          ast.Walk(cells[row][col], (n: ast.Node, entering: boolean): ast.WalkStatus => {
            if (!entering) {
              return ast.WalkContinue;
            }
            // A space is a single byte, so the length can be computed directly
            ret += r.Space(nodeTokens(n)).length - nodeTokens(n).length;
            return ast.WalkContinue;
          });
          cells[row][col].TableCellContentWidth += ret;
        }
        if (maxWidth < cells[row][col].TableCellContentWidth) {
          maxWidth = cells[row][col].TableCellContentWidth;
        }
      }
      for (let row = 0; row < cells.length && col < cells[row].length; row++) {
        cells[row][col].TableCellContentMaxWidth = maxWidth;
      }
      maxWidth = 0;
    }
  } else {
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrikethrough = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrikethrough1OpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemTilde);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrikethrough1CloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemTilde);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrikethrough2OpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("~~");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrikethrough2CloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("~~");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderLinkTitle = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDoublequote);
    r.Write(html.EscapeHTML(nodeTokens(node)));
    r.WriteByte(lex.ItemDoublequote);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderLinkDest = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens: Uint8Array = nodeTokens(node);
    tokens = r.LinkPath(tokens);
    r.Write(tokens);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderLinkSpace = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemSpace);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderLinkText = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens: Uint8Array;
    if (r.Options.AutoSpace) {
      tokens = r.Space(nodeTokens(node));
    } else {
      tokens = nodeTokens(node);
    }
    r.Write(tokens);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCloseParen = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCloseParen);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderOpenParen = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemOpenParen);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderGreater = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemGreater);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderLess = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemLess);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCloseBrace = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCloseBrace);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderOpenBrace = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemOpenBrace);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCloseBracket = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCloseBracket);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderOpenBracket = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemOpenBracket);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBang = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemBang);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderImage = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderLink = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.LinkTextAutoSpacePrevious(node);
    if (3 === node.LinkType) {
      const text = nodeTokens(node.ChildByType(ast.NodeLinkText)!);
      if (bytes.Equal(text, node.LinkRefLabel)) {
        r.WriteString("[" + util.BytesToStr(text) + "]");
      } else {
        r.WriteString("[" + util.BytesToStr(text) + "][" + util.BytesToStr(node.LinkRefLabel) + "]");
      }
      return ast.WalkSkipChildren;
    }
    if (1 === node.LinkType) {
      const dest = nodeTokens(node.ChildByType(ast.NodeLinkDest)!);
      r.Write(dest);
      return ast.WalkSkipChildren;
    }
  } else {
    r.LinkTextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderHTML = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.newlineBeforeBlock(node);
    let tokens: Uint8Array = nodeTokens(node);
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderInlineHTML = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

// newBuffer and trimWriterTo: see the PORT-NOTE in the declaration of FormatRenderer at the top of this file.
FormatRenderer.prototype.newBuffer = function (this: FormatRenderer): bytes.Buffer {
  return new bytes.Buffer();
};

FormatRenderer.prototype.trimWriterTo = function (this: FormatRenderer, buf: Uint8Array): void {
  setWriterFromOwn(this, buf);
};

// closeDocumentWriter is the close of the document: it trims the root writer of the surrounding blanks and ends it with a newline.
// It is the exit of renderDocument, and the replay of the recording renderer (recording_format_renderer.ts) runs this same function.
// PORT-NOTE: the function is shared by renderDocument and the replay of the recording renderer (tasks/004); no behaviour change.
export function closeDocumentWriter(r: FormatRenderer): void {
  let buf: Uint8Array;
  if (r.Options.KeepParagraphBeginningSpace) {
    buf = bytes.TrimRight(r.Writer.Bytes(), blankTrimChars);
    buf = bytes.TrimLeft(buf, newlineTrimChars);
  } else {
    buf = bytes.Trim(r.Writer.Bytes(), blankTrimChars);
  }
  // PORT-NOTE: perf, departs from 1:1 (render/format_renderer.go:1414): setWriterFromOwn moves buf to the start of r.Writer's storage
  // and cuts the length, instead of Reset and Write of the same bytes. The content and LastOut are the same, and the newline follows.
  r.trimWriterTo(buf); // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the default is setWriterFromOwn
  r.WriteByte(lex.ItemNewline);
}

FormatRenderer.prototype.renderDocument = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Writer = r.newBuffer(); // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the default is new bytes.Buffer()
    r.NodeWriterStack.push(r.Writer);
  } else {
    r.NodeWriterStack.length = r.NodeWriterStack.length - 1;
    closeDocumentWriter(r);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderParagraph = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    if (!r.Options.KeepParagraphBeginningSpace && null !== node.FirstChild) {
      node.FirstChild.Tokens = slices.NilIfEmpty(bytes.TrimSpace(nodeTokens(node.FirstChild)));
    }

    if (node.ParentIs(ast.NodeTableCell)) {
      if (null !== node.Next && ast.NodeText !== node.Next.Type) {
        r.WriteString("<br /><br />");
      }
      return ast.WalkContinue;
    }

    if (r.withoutKramdownBlockIAL(node)) {
      r.Newline();
    }

    let inTightList = false;
    let lastListItemLastPara = false;
    const parent = node.Parent;
    if (null !== parent) {
      if (ast.NodeListItem === parent.Type || ast.NodeMindmapItem === parent.Type) { // ListItem.Paragraph
        const listItem = parent;
        if (null !== listItem.Parent && null !== listItem.Parent.ListData) {
          // Must be decided by the tight flag on the list (not the list item), because only List.Tight is set when the flag is set
          // See the function List.Finalize() for how the tight flag is set
          inTightList = listItem.Parent.ListData.Tight;

          const nextItem = listItem.Next;
          if (null === nextItem) {
            const nextPara = node.Next;
            lastListItemLastPara = null === nextPara;
          }
        } else {
          inTightList = true;
        }
      }
    }

    if (!inTightList || (lastListItemLastPara)) {
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderText = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens: Uint8Array;
    if (r.Options.AutoSpace) {
      tokens = r.Space(nodeTokens(node));
    } else {
      tokens = nodeTokens(node);
    }

    if (r.Options.FixTermTypo) {
      tokens = r.FixTermTypo(tokens);
    }
    tokens = escapeSetextHeadingMarkersInListParagraph(node, tokens);
    if (r.ParseOptions.Tabs) {
      tokens = escapeTabsParagraphMarkers(node, tokens, true);
    }
    if ((null === node.Previous || ast.NodeTaskListItemMarker === node.Previous.Type) &&
      null !== node.Parent!.Parent && null !== node.Parent!.Parent.ListData && 3 === node.Parent!.Parent.ListData.Typ) {
      if (0x20 /* space */ === r.LastOut) {
        tokens = bytes.TrimPrefix(tokens, spaceBytes);
        if (bytes.HasPrefix(tokens, caretSpaceBytes)) {
          tokens = bytes.TrimPrefix(tokens, caretSpaceBytes);
          tokens = slices.Append(editor.CaretTokens, tokens);
        }
      }
    }

    r.Write(tokens);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCodeSpan = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (r.Options.AutoSpace) {
      const text = node.PreviousNodeText();
      if ("" !== text) {
        const [lastc] = utf8.DecodeLastRuneInString(text);
        if (unicode.IsLetter(lastc) || unicode.IsDigit(lastc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
    }
  } else {
    if (r.Options.AutoSpace) {
      const text = node.NextNodeText();
      if ("" !== text) {
        const [firstc] = utf8.DecodeRuneInString(text);
        if (unicode.IsLetter(firstc) || unicode.IsDigit(firstc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCodeSpanOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemBacktick);
    if (1 < node.Parent!.CodeMarkerLen) {
      r.WriteByte(lex.ItemBacktick);
      const text = util.BytesToStr(nodeTokens(node.Next!));
      const [firstc] = utf8.DecodeRuneInString(text);
      if (0x60 /* ` */ === firstc) {
        r.WriteByte(lex.ItemSpace);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCodeSpanContent = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens: Uint8Array = nodeTokens(node);
    if (node.ParentIs(ast.NodeTableCell)) {
      tokens = bytes.ReplaceAll(tokens, escapedPipeBytes, pipeBytes);
      tokens = bytes.ReplaceAll(tokens, pipeBytes, escapedPipeBytes);
      tokens = bytes.ReplaceAll(tokens, br1Bytes, new Uint8Array(0));
    }
    r.Write(tokens);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCodeSpanCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (1 < node.Parent!.CodeMarkerLen) {
      const text = util.BytesToStr(nodeTokens(node.Previous!));
      const [lastc] = utf8.DecodeLastRuneInString(text);
      if (0x60 /* ` */ === lastc) {
        r.WriteByte(lex.ItemSpace);
      }
      r.WriteByte(lex.ItemBacktick);
    }
    r.WriteByte(lex.ItemBacktick);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderInlineMath = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (r.Options.AutoSpace) {
      const text = node.PreviousNodeText();
      if ("" !== text) {
        const [lastc] = utf8.DecodeLastRuneInString(text);
        if (unicode.IsLetter(lastc) || unicode.IsDigit(lastc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
    }
  } else {
    if (r.Options.AutoSpace) {
      const text = node.NextNodeText();
      if ("" !== text) {
        const [firstc] = utf8.DecodeRuneInString(text);
        if (unicode.IsLetter(firstc) || unicode.IsDigit(firstc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderInlineMathOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDollar);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderInlineMathContent = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderInlineMathCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDollar);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderMathBlockCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(parse.MathBlockMarker);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderMathBlockContent = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderMathBlockOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(parse.MathBlockMarker);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderMathBlock = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  r.Newline();
  if (!entering && !r.isLastNode(r.Tree.Root!, node)) {
    if (r.withoutKramdownBlockIAL(node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCodeBlockCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    r.Write(nodeTokens(node));
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      if (r.withoutKramdownBlockIAL(node.Parent!)) {
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCodeBlockCode = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCodeBlockInfoMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(node.CodeBlockInfo);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCodeBlockOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderCodeBlock = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    if (!node.IsFencedCodeBlock) {
      r.Write(bytes.Repeat(backtickBytes, 3));
      r.WriteByte(lex.ItemNewline);
      r.Write(nodeTokens(node.FirstChild!));
      r.Write(bytes.Repeat(backtickBytes, 3));
      r.Newline();
      if (!r.isLastNode(r.Tree.Root!, node)) {
        if (r.withoutKramdownBlockIAL(node)) {
          r.WriteByte(lex.ItemNewline);
        }
      }
      return ast.WalkSkipChildren;
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderEmphasis = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderEmAsteriskOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemAsterisk);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderEmAsteriskCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemAsterisk);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderEmUnderscoreOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemUnderscore);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderEmUnderscoreCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemUnderscore);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrong = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrongA6kOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("**");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrongA6kCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("**");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrongU8eOpenMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("__");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderStrongU8eCloseMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("__");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBlockquote = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.newlineBeforeBlock(node);
    r.Writer = r.newBuffer(); // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the default is new bytes.Buffer()
    r.NodeWriterStack.push(r.Writer);
  } else {
    const writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    r.NodeWriterStack.length = r.NodeWriterStack.length - 1;

    const blockquoteLines = new bytes.Buffer();
    let buf: Uint8Array = writer.Bytes();
    let lines = bytes.Split(buf, newlineBytes);
    let length = lines.length;
    if (2 < length && lex.IsBlank(lines[length - 1]) && lex.IsBlank(lines[length - 2])) {
      lines = lines.slice(0, length - 1);
    }
    if (1 === r.NodeWriterStack.length) { // Already at the root level
      length = lines.length;
      if (1 < length && lex.IsBlank(lines[length - 1])) {
        lines = lines.slice(0, length - 1);
      }
    }

    length = lines.length;
    for (const line of lines) {
      if (0 === line.length) {
        blockquoteLines.WriteString(">\n");
        continue;
      }

      if (lex.ItemGreater === line[0]) {
        blockquoteLines.WriteString(">");
      } else {
        blockquoteLines.WriteString("> ");
      }
      blockquoteLines.Write(line);
      blockquoteLines.WriteByte(lex.ItemNewline);
    }
    buf = bytes.TrimSpace(blockquoteLines.Bytes());
    writer.Reset();
    writer.Write(buf);
    r.NodeWriterStack[r.NodeWriterStack.length - 1].Write(writer.Bytes());
    r.Writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    buf = bytes.TrimSpace(r.Writer.Bytes());
    // PORT-NOTE: perf, departs from 1:1 (render/format_renderer.go:1816): setWriterFromOwn, see renderDocument; the content and LastOut are the same.
    r.trimWriterTo(buf); // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the default is setWriterFromOwn
    if (!node.ParentIs(ast.NodeTableCell)) { // Line breaks are not allowed in a table, or the table layout breaks https://github.com/Vanessa219/vditor/issues/368
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteString("\n\n");
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderBlockquoteMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderHeading = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.newlineBeforeBlock(node);
    if (!node.HeadingSetext) {
      r.Write(bytes.Repeat(crosshatchBytes, node.HeadingLevel));
      r.WriteByte(lex.ItemSpace);
    }
  } else {
    if (node.HeadingSetext) {
      r.WriteByte(lex.ItemNewline);
      const contentLen = r.setextHeadingLen(node);
      if (1 === node.HeadingLevel) {
        r.WriteString(strings.Repeat("=", contentLen));
      } else if (2 === node.HeadingLevel) {
        r.WriteString(strings.Repeat("-", contentLen));
      }
    }

    if (!node.ParentIs(ast.NodeTableCell)) {
      if (r.withoutKramdownBlockIAL(node)) {
        r.Newline();
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderHeadingC8hMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderHeadingID = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString(" {" + util.BytesToStr(nodeTokens(node)) + "}");
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderList = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.newlineBeforeBlock(node);
    r.Writer = r.newBuffer(); // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the default is new bytes.Buffer()
    r.NodeWriterStack.push(r.Writer);
  } else {
    const writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    r.NodeWriterStack.length = r.NodeWriterStack.length - 1;
    r.NodeWriterStack[r.NodeWriterStack.length - 1].Write(writer.Bytes());
    r.Writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    const buf = bytes.TrimSpace(r.Writer.Bytes());
    // PORT-NOTE: perf, departs from 1:1 (render/format_renderer.go:1881): setWriterFromOwn, see renderDocument; the content and LastOut are the same.
    r.trimWriterTo(buf); // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the default is setWriterFromOwn
    if (!node.ParentIs(ast.NodeTableCell)) {
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteString("\n\n");
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderListItem = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Writer = r.newBuffer(); // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the default is new bytes.Buffer()
    r.NodeWriterStack.push(r.Writer);
    if (r.Options.KramdownBlockIAL && null !== node.Next && ast.NodeKramdownBlockIAL === node.Next.Type) {
      const liIAL = node.Next;
      r.Write(nodeTokens(liIAL));
    }
    if (null !== node.FirstChild && (ast.NodeList === node.FirstChild.Type || ast.NodeMindmap === node.FirstChild.Type)) {
      r.Newline();
    }
  } else {
    const writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    r.NodeWriterStack.length = r.NodeWriterStack.length - 1;
    let indent = node.ListData!.Marker.length + 1;
    if (1 === node.ListData!.Typ && 3 > indent) {
      indent++;
    }
    if (3 === node.ListData!.Typ) {
      if (0 === node.ListData!.BulletChar || ((0x2a /* * */ === node.ListData!.BulletChar || 0x2d /* - */ === node.ListData!.BulletChar) && null !== node.FirstChild!.Next && ast.NodeCallout === node.FirstChild!.Next.Type)) {
        indent += 4;
      }
    }

    const indentSpaces = bytes.Repeat(spaceBytes, indent);
    const indentedLines = new bytes.Buffer();
    let buf: Uint8Array = writer.Bytes();
    // PORT-NOTE: Split element capacity, the elements are only read, never appended to.
    const lines = bytes.Split(buf, newlineBytes);
    for (const line of lines) {
      if (0 === line.length) {
        indentedLines.WriteByte(lex.ItemNewline);
        continue;
      }
      indentedLines.Write(indentSpaces);
      indentedLines.Write(line);
      indentedLines.WriteByte(lex.ItemNewline);
    }
    buf = indentedLines.Bytes();
    if (indent < buf.length) {
      buf = buf.subarray(indent);
    }

    const listItemBuf = new bytes.Buffer();
    if (1 === node.ListData!.Typ || (3 === node.ListData!.Typ && 0 === node.ListData!.BulletChar)) {
      if (0 === node.ListData!.Num && 0 === node.ListData!.Delimiter) {
        listItemBuf.Write(node.ListData!.Marker);
      } else {
        listItemBuf.WriteString(strconv.Itoa(node.ListData!.Num) + conv.StringFromRune(node.ListData!.Delimiter));
      }
    } else {
      if ("" !== r.Options.UnorderedListMarker) {
        listItemBuf.WriteString(r.Options.UnorderedListMarker);
      } else {
        listItemBuf.Write(node.ListData!.Marker);
      }
    }
    listItemBuf.WriteByte(lex.ItemSpace);
    buf = slices.Append(listItemBuf.Bytes(), buf);
    if (node.ParentIs(ast.NodeTableCell)) {
      buf = bytes.ReplaceAll(buf, newlineBytes, new Uint8Array(0));
    }
    writer.Reset();
    writer.Write(buf);
    buf = writer.Bytes();
    if (node.ParentIs(ast.NodeTableCell)) {
      buf = bytes.ReplaceAll(buf, newlineBytes, new Uint8Array(0));
    }
    r.NodeWriterStack[r.NodeWriterStack.length - 1].Write(buf);
    r.Writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    buf = bytes.TrimSpace(r.Writer.Bytes());
    // PORT-NOTE: perf, departs from 1:1 (render/format_renderer.go:1962): setWriterFromOwn, see renderDocument; the content and LastOut are the same.
    r.trimWriterTo(buf); // PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: the default is setWriterFromOwn
    if (!node.ParentIs(ast.NodeTableCell)) {
      r.WriteString("\n");
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderTaskListItemMarker = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const marker = r.NormalizedTaskListItemMarker(node);
    r.WriteByte(lex.ItemOpenBracket);
    r.WriteByte(marker);
    r.WriteByte(lex.ItemCloseBracket);
  } else {
    r.WriteByte(0x20 /* space */);
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderThematicBreak = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (node.ParentIs(ast.NodeTableCell)) {
      r.WriteString("<hr/>");
    } else {
      r.WriteString("---");
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteByte(lex.ItemNewline);
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderHardBreak = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (!r.Options.SoftBreak2HardBreak) {
      r.WriteString("\\\n");
    } else {
      if (node.ParentIs(ast.NodeTableCell)) {
        r.WriteString("<br/>");
      } else {
        r.WriteByte(lex.ItemNewline);
      }
    }
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.renderSoftBreak = function (this: FormatRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
  }
  return ast.WalkContinue;
};

FormatRenderer.prototype.withoutKramdownBlockIAL = function (this: FormatRenderer, node: ast.Node): boolean {
  const r = this;
  return !r.Options.KramdownBlockIAL || 0 === (node.KramdownIAL ?? []).length || null === node.Next || ast.NodeKramdownBlockIAL !== node.Next.Type;
};

FormatRenderer.prototype.newlineBeforeBlock = function (this: FormatRenderer, node: ast.Node): void {
  const r = this;
  if (!node.ParentIs(ast.NodeTableCell) && null !== node.Previous && (!node.Previous.IsBlock() && ast.NodeKramdownBlockIAL !== node.Previous.Type && ast.NodeTaskListItemMarker !== node.Previous.Type)) {
    r.Newline();
  }
};


// NewFormatRenderer creates a formatting renderer.
export function NewFormatRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): FormatRenderer {
  const ret = new FormatRenderer(tree, options, parseOptions);
  registerFormatRendererFuncs(ret);
  return ret;
}

// registerFormatRendererFuncs does the function table registration of Go's NewFormatRenderer.
// PORT-NOTE: Go embedding, TextBundleRenderer needs the same registrations on its own instance (its constructor cannot call NewFormatRenderer), so they are a separate function.
export function registerFormatRendererFuncs(ret: FormatRenderer): void {
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
  ret.RendererFuncs.set(ast.NodeHTMLTag, ret.renderHTMLTag.bind(ret));
  ret.RendererFuncs.set(ast.NodeHTMLTagOpen, ret.renderHTMLTagOpen.bind(ret));
  ret.RendererFuncs.set(ast.NodeHTMLTagClose, ret.renderHTMLTagClose.bind(ret));
  ret.RendererFuncs.set(ast.NodeCallout, ret.renderCallout.bind(ret));
  ret.RendererFuncs.set(ast.NodeTabs, ret.renderTabs.bind(ret));
  ret.RendererFuncs.set(ast.NodeTabItem, ret.renderTabs.bind(ret));
}

// isTableCellIALNode reports whether the node is the IAL of a table cell.
export function isTableCellIALNode(node: ast.Node): boolean {
  if (null !== node.Parent && ast.NodeTableCell === node.Parent.Type && node === node.Parent.FirstChild && 0 < (node.Parent.KramdownIAL ?? []).length) {
    return true;
  }
  return null !== node.Previous && ast.NodeTableCell === node.Previous.Type && 0 < (node.Previous.KramdownIAL ?? []).length &&
    bytes.Equal(nodeTokens(node), parse.IAL2Tokens(node.Previous.KramdownIAL));
}

// tableCellStructIALTokens extracts the merge structure and alignment style of a cell, so that they survive the Markdown round trip.
export function tableCellStructIALTokens(node: ast.Node): Uint8Array | null {
  let structural: string[][] = [];
  let hasTextAlign = false;
  let styleIndex = -1;
  for (const kv of node.KramdownIAL ?? []) {
    if ("colspan" === kv[0] || "rowspan" === kv[0] || ("class" === kv[0] && "fn__none" === kv[1])) {
      structural.push(kv);
    } else if ("style" === kv[0]) {
      let keepStyle = false;
      for (const declaration of strings.Split(kv[1], ";")) {
        let [property, , found] = strings.Cut(declaration, ":");
        if (!found) {
          continue;
        }
        property = strings.TrimSpace(property);
        if (strings.EqualFold(property, "text-align")) {
          hasTextAlign = true;
          keepStyle = true;
        } else if (strings.EqualFold(property, "vertical-align")) {
          keepStyle = true;
        }
      }
      if (keepStyle) {
        styleIndex = structural.length;
        structural.push(kv);
      }
    }
  }
  if (!hasTextAlign && node.TableCellAlign !== tableHeadColumnAlign(node)) {
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
    if (0 <= styleIndex) {
      let style = strings.TrimSpace(structural[styleIndex][1]);
      if ("" !== style && !strings.HasSuffix(style, ";")) {
        style += ";";
      }
      structural[styleIndex] = ["style", style + " text-align: " + align + ";"];
    } else {
      structural.push(["style", "text-align: " + align + ";"]);
    }
  }
  if (0 === structural.length) {
    return null;
  }
  return parse.IAL2Tokens(structural);
}

// tableCellFullIALTokens outputs the attributes of a cell, and adds styles for the per-cell alignment of the old format.
export function tableCellFullIALTokens(node: ast.Node): Uint8Array {
  const ial: string[][] = new Array<string[]>((node.KramdownIAL ?? []).length);
  const kramdownIAL = node.KramdownIAL ?? [];
  for (let i = 0; i < kramdownIAL.length; i++) {
    ial[i] = [...kramdownIAL[i]];
  }
  if (node.TableCellAlign !== tableHeadColumnAlign(node)) {
    let styleIndex = -1;
    let hasTextAlign = false;
    for (let i = 0; i < ial.length; i++) {
      const kv = ial[i];
      if ("style" !== kv[0]) {
        continue;
      }
      styleIndex = i;
      for (const declaration of strings.Split(kv[1], ";")) {
        const [property, , found] = strings.Cut(declaration, ":");
        if (found && strings.EqualFold(strings.TrimSpace(property), "text-align")) {
          hasTextAlign = true;
        }
      }
    }
    if (!hasTextAlign) {
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
      if (0 <= styleIndex) {
        let style = strings.TrimSpace(ial[styleIndex][1]);
        if ("" !== style && !strings.HasSuffix(style, ";")) {
          style += ";";
        }
        ial[styleIndex][1] = style + " text-align: " + align + ";";
      } else {
        ial.push(["style", "text-align: " + align + ";"]);
      }
    }
  }
  if (0 === ial.length) {
    // PORT-NOTE: Go returns nil; the only caller passes the result to Write, which ignores empty input, so an empty array is the same.
    return new Uint8Array(0);
  }
  return parse.IAL2Tokens(ial);
}

// tableHeadColumnAlign returns the alignment of the header cell in the same column of an old-format table.
function tableHeadColumnAlign(node: ast.Node): number {
  if (null === node.Parent || null === node.Parent.Parent) {
    return 0;
  }
  let column = 0;
  for (let previous = node.Previous; null !== previous; previous = previous.Previous) {
    if (ast.NodeTableCell === previous.Type) {
      column++;
    }
  }
  let table: ast.Node | null = node.Parent.Parent;
  if (ast.NodeTableHead === table.Type) {
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
