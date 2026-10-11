// Ported from render/html_renderer.go @ 8e7896b6
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
import { BaseRenderer, HtmlRenderer } from "./types.ts";
import { HeadingID, appendTableCellAlignStyle, nodeTokens } from "./renderer.ts";
import type { Options } from "./renderer.ts";
import { calloutDisplayTitle } from "./callout.ts";
import { customBlockAttrs } from "./custom_block_renderer.ts";
import { sanitize } from "./sanitizer.ts";
import { isCJK } from "./space.ts";
import { TableCellRichHTML } from "./table_rich.ts";
// PORT-NOTE: the following files only attach methods to BaseRenderer or HtmlRenderer (see PORTING.md); importing them here makes sure the methods exist
// whenever html_renderer.ts is imported on its own.
import "./link.ts";
import "./term_typographer.ts";
import "./tabs.ts";
import "./code_block_html_render.ts";

// PORT-NOTE: Go's ast.Node.KramdownIAL is a nil-able slice; here it is `string[][] | null`, so every `append(attrs, node.KramdownIAL...)` and `range node.KramdownIAL` reads `node.KramdownIAL ?? []`.

declare module "./types.ts" {
  interface HtmlRenderer {
    Render(): Uint8Array;
    SetTextMarkStandardTag(): void;
    RenderFootnotes(): Uint8Array;
    handleKramdownBlockIAL(node: ast.Node): void;
    renderTextMarkAttrs(node: ast.Node): string[][];
    spanNodeAttrs(node: ast.Node, attrs: string[][]): void;
    renderCallout(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCustomBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderAttributeView(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTextMark(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderTextMarkStandardTag(node: ast.Node, entering: boolean): ast.WalkStatus;
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
    renderBlockQueryEmbed(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderBlockQueryEmbedScript(node: ast.Node, entering: boolean): ast.WalkStatus;
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
    renderCodeBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockInfoMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmojiAlias(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmojiImg(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmojiUnicode(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderEmoji(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMathCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMathContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMathOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderInlineMath(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlockContent(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
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
    renderCloseBrace(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderOpenBrace(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCloseParen(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderOpenParen(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderLess(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderGreater(node: ast.Node, entering: boolean): ast.WalkStatus;
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
  }
}

// NewHtmlRenderer creates an HTML renderer.
export function NewHtmlRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): HtmlRenderer {
  const ret = new HtmlRenderer(tree, options, parseOptions);
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
  ret.RendererFuncs.set(ast.NodeTabs, ret.renderTabsHTML.bind(ret));
  ret.RendererFuncs.set(ast.NodeTabItem, ret.renderTabsHTML.bind(ret));
  return ret;
}

// PORT-NOTE: Go embedding, HtmlRenderer defines Render and renderToC itself, as BaseRenderer does. A BaseRenderer method that calls r.Render() or r.renderToC() runs the base one in Go (no virtual dispatch); see the PORT-NOTEs in renderer.ts.
HtmlRenderer.prototype.Render = function (this: HtmlRenderer): Uint8Array {
  const r = this;
  let output: Uint8Array = new Uint8Array(0);
  // PORT-NOTE: Go embedding, base method
  output = BaseRenderer.prototype.Render.call(r);
  output = slices.Append(output, r.RenderFootnotes());
  return output;
};

// SetTextMarkStandardTag makes text marks render with standard HTML tags.
HtmlRenderer.prototype.SetTextMarkStandardTag = function (this: HtmlRenderer): void {
  const r = this;
  r.RendererFuncs.set(ast.NodeTextMark, r.renderTextMarkStandardTag.bind(r));
};

HtmlRenderer.prototype.renderCallout = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    const attrs: string[][] = [
      ["class", "callout"],
      ["data-subtype", html.EscapeHTMLStr(node.CalloutType)],
    ];
    r.Tag("div", attrs, false);
    r.Newline();
    r.WriteString("<div class=\"callout-info\"><span class=\"callout-icon\">");
    if (0 === node.CalloutIconType) {
      r.WriteString(node.CalloutIcon);
    } else if (1 === node.CalloutIconType) {
      r.WriteString("<img class=\"callout-img\" alt=\"\" src=\"");
      r.WriteString(html.EscapeHTMLStr(node.CalloutIcon));
      r.WriteString("\" />");
    }
    r.WriteString("</span><span class=\"callout-title\">");
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
      const data = NewHtmlRenderer(titleTree, r.Options, r.ParseOptions).Render();
      r.Write(data);
    } else {
      r.WriteString(title);
    }
    r.WriteString("</span></div>");
    r.WriteString("<div class=\"callout-content\">");
  } else {
    r.Newline();
    r.WriteString("</div>");
    r.Newline();
    r.WriteString("</div>");
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCustomBlock = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    r.Tag("div", customBlockAttrs(node), false);
    r.renderCustomBlockFallback(node);
    r.WriteString("</div>");
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderAttributeView = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderTextMark = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let textContent = node.TextMarkTextContent;
    if (node.ParentIs(ast.NodeTableCell)) {
      if (node.IsTextMarkType("code")) {
        textContent = strings.ReplaceAll(textContent, "|", "&#124;");
      } else {
        textContent = strings.ReplaceAll(textContent, "\\|", "|");
      }
      textContent = strings.ReplaceAll(textContent, "\n", "<br />");
    }

    if (node.IsTextMarkType("a")) {
      const attrs: string[][] = [["href", node.TextMarkAHref]];
      if ("" !== node.TextMarkATitle) {
        attrs.push(["title", node.TextMarkATitle]);
      }
      r.spanNodeAttrs(node, attrs);
      r.Tag("a", attrs, false);
      r.WriteString(textContent);
      r.WriteString("</a>");
    } else if (node.IsTextMarkType("inline-memo")) {
      r.WriteString(textContent);
      const lastRune = utf8.DecodeLastRuneInString(node.TextMarkTextContent)[0];
      if ("" !== node.TextMarkInlineMemoContent) {
        if (isCJK(lastRune)) {
          r.WriteString("<sup>（");
          let memo = node.TextMarkInlineMemoContent;
          memo = strings.ReplaceAll(memo, editor.IALValEscNewLine, " ");
          r.WriteString(memo);
          r.WriteString("）</sup>");
        } else {
          r.WriteString("<sup>(");
          r.WriteString(node.TextMarkInlineMemoContent);
          r.WriteString(")</sup>");
        }
      }
    } else {
      const attrs = r.renderTextMarkAttrs(node);
      r.spanNodeAttrs(node, attrs);
      r.Tag("span", attrs, false);
      r.WriteString(textContent);
      r.WriteString("</span>");
    }
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderTextMarkStandardTag = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    return ast.WalkContinue;
  }

  const style = node.IALAttr("style");
  if ("" !== style) {
    r.Tag("span", [["style", html.EscapeAttrVal(style)]], false);
  }

  const types = strings.Fields(node.TextMarkType);
  for (const typ of types) {
    switch (typ) {
      case "a": {
        const attrs: string[][] = [["href", conv.StringFromBytes(r.LinkPath(conv.BytesFromString(node.TextMarkAHref)))]];
        if ("" !== node.TextMarkATitle) {
          attrs.push(["title", node.TextMarkATitle]);
        }
        r.Tag("a", attrs, false);
        break;
      }
      case "strong":
      case "em":
      case "code":
      case "s":
      case "mark":
      case "u":
      case "sup":
      case "sub":
      case "kbd":
        r.Tag(typ, null, false);
        break;
      case "tag":
        r.WriteString("<mark>#");
        break;
      case "inline-math":
        r.WriteString("<span class=\"language-math\">$");
        break;
    }
  }

  let textContent = node.TextMarkTextContent;
  if (node.IsTextMarkType("inline-math")) {
    textContent = node.TextMarkInlineMathContent;
  }
  if (node.ParentIs(ast.NodeTableCell)) {
    if (node.IsTextMarkType("code")) {
      textContent = strings.ReplaceAll(textContent, "|", "&#124;");
    } else {
      textContent = strings.ReplaceAll(textContent, "\\|", "|");
    }
    textContent = strings.ReplaceAll(textContent, "\n", "<br />");
  }
  r.WriteString(textContent);

  for (let i = types.length - 1; 0 <= i; i--) {
    switch (types[i]) {
      case "a":
      case "strong":
      case "em":
      case "code":
      case "s":
      case "mark":
      case "u":
      case "sup":
      case "sub":
      case "kbd":
        r.Tag("/" + types[i], null, false);
        break;
      case "tag":
        r.WriteString("#</mark>");
        break;
      case "inline-math":
        r.WriteString("$</span>");
        break;
    }
  }

  if (node.IsTextMarkType("inline-memo") && "" !== node.TextMarkInlineMemoContent) {
    const lastRune = utf8.DecodeLastRuneInString(node.TextMarkTextContent)[0];
    if (isCJK(lastRune)) {
      r.WriteString("<sup>（");
      r.WriteString(strings.ReplaceAll(node.TextMarkInlineMemoContent, editor.IALValEscNewLine, " "));
      r.WriteString("）</sup>");
    } else {
      r.WriteString("<sup>(");
      r.WriteString(strings.ReplaceAll(node.TextMarkInlineMemoContent, editor.IALValEscNewLine, " "));
      r.WriteString(")</sup>");
    }
  }

  if ("" !== style) {
    r.WriteString("</span>");
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBr = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<br />");
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderUnderline = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderUnderlineOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<u>");
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderUnderlineCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</u>");
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderKbd = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderKbdOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<kbd>");
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderKbdCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</kbd>");
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderVideo = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("div", [["class", "iframe"]], false);
    let tokens = nodeTokens(node);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderAudio = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("div", [["class", "iframe"]], false);
    let tokens = nodeTokens(node);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderIFrame = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("div", [["class", "iframe"]], false);
    let tokens = nodeTokens(node);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderWidget = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("div", [["class", "iframe"]], false);
    let tokens = nodeTokens(node);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderGitConflictCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderGitConflictContent = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(html.EscapeHTML(nodeTokens(node)));
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderGitConflictOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderGitConflict = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  r.Newline();
  if (entering) {
    const attrs: string[][] = [["class", "language-git-conflict"]];
    r.handleKramdownBlockIAL(node);
    attrs.push(...(node.KramdownIAL ?? []));
    r.Tag("div", attrs, false);
  } else {
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderSuperBlock = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderSuperBlockOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkSkipChildren;
};

HtmlRenderer.prototype.renderSuperBlockLayoutMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkSkipChildren;
};

HtmlRenderer.prototype.renderSuperBlockCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkSkipChildren;
};

HtmlRenderer.prototype.renderLinkRefDefBlock = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkSkipChildren;
};

HtmlRenderer.prototype.renderLinkRefDef = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkSkipChildren;
};

HtmlRenderer.prototype.renderTag = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderTagOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("em", node.Parent!.KramdownIAL, false);
    r.WriteByte(lex.ItemCrosshatch);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderTagCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCrosshatch);
    r.Tag("/em", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderKramdownBlockIAL = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderKramdownSpanIAL = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderMark = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderMark1OpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("mark", node.Parent!.KramdownIAL, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderMark1CloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/mark", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderMark2OpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("mark", node.Parent!.KramdownIAL, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderMark2CloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/mark", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderSup = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderSupOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("sup", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderSupCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/sup", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderSub = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderSubOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("sub", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderSubCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/sub", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBlockQueryEmbed = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    r.Tag("div", null, false);
  } else {
    r.Tag("/div", null, false);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBlockQueryEmbedScript = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDoublequote);
    r.Write(nodeTokens(node));
    r.WriteByte(lex.ItemDoublequote);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBlockRef = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBlockRefID = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBlockRefSpace = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBlockRefText = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDoublequote);
    r.Write(html.EscapeHTML(nodeTokens(node)));
  } else {
    r.WriteByte(lex.ItemDoublequote);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBlockRefDynamicText = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemSinglequote);
    r.Write(html.EscapeHTML(nodeTokens(node)));
  } else {
    r.WriteByte(lex.ItemSinglequote);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderFileAnnotationRef = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderFileAnnotationRefID = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderFileAnnotationRefSpace = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderFileAnnotationRefText = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDoublequote);
    r.Write(html.EscapeHTML(nodeTokens(node)));
  } else {
    r.WriteByte(lex.ItemDoublequote);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderYamlFrontMatterCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</code></pre>");
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderYamlFrontMatterContent = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(html.EscapeHTML(nodeTokens(node)));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderYamlFrontMatterOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [["class", "vditor-yml-front-matter"]];
    attrs.push(...(node.Parent!.KramdownIAL ?? []));
    r.Tag("pre", attrs, false);
    r.WriteString("<code class=\"language-yaml\">");
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderYamlFrontMatter = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  r.Newline();
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderHtmlEntity = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(html.EscapeHTML(nodeTokens(node)));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBackslashContent = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(html.EscapeHTML(nodeTokens(node)));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBackslash = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderToC = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  // PORT-NOTE: Go embedding, base method
  return BaseRenderer.prototype.renderToC.call(r, node, entering);
};

HtmlRenderer.prototype.renderFootnotesRef = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

HtmlRenderer.prototype.renderFootnotesDefBlock = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.RenderFootnotes = function (this: HtmlRenderer): Uint8Array {
  const r = this;
  if (1 > r.FootnotesDefs.length) {
    // PORT-NOTE: Go returns nil; the only caller appends it, so the empty array stands for nil
    return new Uint8Array(0);
  }

  const buf = new bytes.Buffer();
  buf.WriteString("<div class=\"footnotes-defs-div\">");
  buf.WriteString("<hr class=\"footnotes-defs-hr\" />\n");
  buf.WriteString("<ol class=\"footnotes-defs-ol\">");
  // PORT-NOTE: Go's `for i, def := range` assigns the range variable i on every iteration, so the inner `for i = len(...)` loop below does not disturb the iteration; a separate counter keeps that
  for (let i0 = 0; i0 < r.FootnotesDefs.length; i0++) {
    let i = i0;
    const def = r.FootnotesDefs[i0];
    buf.WriteString("<li id=\"footnotes-def-" + strconv.Itoa(i + 1) + "\">");
    const footnotesTree = new parse.Tree();
    footnotesTree.Name = "";
    footnotesTree.Context = r.Tree.Context;
    footnotesTree.Context!.Tree = footnotesTree;
    footnotesTree.Root = new ast.Node(ast.NodeDocument);
    footnotesTree.Root.AppendChild(def);
    const defRenderer = NewHtmlRenderer(footnotesTree, r.Options, r.ParseOptions);
    const lc = footnotesTree.Root.LastDeepestChild();
    for (i = def.FootnotesRefs.length - 1; 0 <= i; i--) {
      const ref = def.FootnotesRefs[i];
      const gotoRef = " <a href=\"#footnotes-ref-" + ref.FootnotesRefId + "\" class=\"vditor-footnotes__goto-ref\">↩</a>";
      const link = new ast.Node(ast.NodeInlineHTML, util.StrToBytes(gotoRef));
      lc.InsertAfter(link);
    }
    defRenderer.RenderingFootnotes = true;
    const defContent = defRenderer.Render();
    buf.Write(defContent);
    buf.WriteString("</li>\n");
  }
  buf.WriteString("</ol></div>");
  return buf.Bytes();
};

HtmlRenderer.prototype.renderFootnotesDef = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (!r.RenderingFootnotes) {
      let found = false;
      for (const n of r.FootnotesDefs) {
        if (bytes.EqualFold(nodeTokens(node), nodeTokens(n))) {
          found = true;
          break;
        }
      }
      if (!found) {
        r.FootnotesDefs.push(node);
      }
      return ast.WalkSkipChildren;
    }
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCodeBlockCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCodeBlockInfoMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCodeBlockOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderEmojiAlias = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderEmojiImg = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderEmojiUnicode = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderEmoji = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderInlineMathCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/span", null, false);
  }
  return ast.WalkContinue;
};

const escapedPipeBytes: Uint8Array = conv.BytesFromString("\\|");
const pipeBytes: Uint8Array = conv.BytesFromString("|");

HtmlRenderer.prototype.renderInlineMathContent = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens = nodeTokens(node);
    if (node.ParentIs(ast.NodeTableCell)) {
      // Improve the `|` render in the inline math in the table https://github.com/Vanessa219/vditor/issues/1550
      tokens = bytes.ReplaceAll(tokens, escapedPipeBytes, pipeBytes);
    }
    r.Write(html.EscapeHTML(tokens));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderInlineMathOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [["class", "language-math"]];
    r.Tag("span", attrs, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderInlineMath = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderMathBlockCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/div", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderMathBlockContent = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(html.EscapeHTML(nodeTokens(node)));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderMathBlockOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderMathBlock = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  r.Newline();
  if (entering) {
    const attrs: string[][] = [["class", "language-math"]];
    r.handleKramdownBlockIAL(node);
    attrs.push(...(node.KramdownIAL ?? []));
    r.Tag("div", attrs, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderTableCell = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  let tag = "td";
  if (ast.NodeTableHead === node.Parent!.Parent!.Type) {
    tag = "th";
  }
  if (entering) {
    const attrs: string[][] = [];
    for (const kv of node.KramdownIAL ?? []) {
      if (kv[0] === "style") {
        attrs.push(kv);
      }
    }
    appendTableCellAlignStyle(node, attrs);
    r.Tag(tag, attrs, false);
    if (null !== node.TableCellRich) {
      const [content, err] = TableCellRichHTML(node.TableCellRich, r.Options);
      if (null === err) {
        r.Write(content!);
      }
      return ast.WalkSkipChildren;
    }
  } else {
    r.Tag("/" + tag, null, false);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderTableRow = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("tr", null, false);
    r.Newline();
  } else {
    r.Tag("/tr", null, false);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderTableHead = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("thead", null, false);
    r.Newline();
  } else {
    r.Tag("/thead", null, false);
    r.Newline();
    if (null !== node.Next) {
      r.Tag("tbody", null, false);
    }
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderTable = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (r.needUseHTMLTable(node)) {
    if (entering) {
      r.handleKramdownBlockIAL(node);
      r.renderTableByHTML(node);
      return ast.WalkSkipChildren;
    }
    return ast.WalkContinue;
  }

  if (entering) {
    r.handleKramdownBlockIAL(node);
    r.Tag("table", node.KramdownIAL, false);
    r.Newline();
  } else {
    if (null !== node.FirstChild!.Next) {
      r.Tag("/tbody", null, false);
    }
    r.Newline();
    r.Tag("/table", null, false);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrikethrough = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrikethrough1OpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("del", node.Parent!.KramdownIAL, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrikethrough1CloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/del", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrikethrough2OpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("del", node.Parent!.KramdownIAL, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrikethrough2CloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/del", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderLinkTitle = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderLinkDest = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderLinkSpace = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderLinkText = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens: Uint8Array = new Uint8Array(0);
    if (r.Options.AutoSpace) {
      tokens = r.Space(nodeTokens(node));
    } else {
      tokens = nodeTokens(node);
    }
    r.Write(html.EscapeHTML(tokens));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCloseBrace = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderOpenBrace = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCloseParen = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderOpenParen = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderLess = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderGreater = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCloseBracket = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderOpenBracket = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBang = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

const imgSrcPrefix: Uint8Array = conv.BytesFromString("<img src=");

HtmlRenderer.prototype.renderImage = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (0 === r.DisableTags) {
      const style = node.IALAttr("parent-style");
      if ("" !== style) {
        r.Tag("span", [["style", style]], false);
      }

      r.WriteString("<img src=\"");
      let destTokens = nodeTokens(node.ChildByType(ast.NodeLinkDest)!);
      destTokens = r.LinkPath(destTokens);
      if ("" !== r.Options.ImageLazyLoading) {
        r.Write(html.EscapeHTML(util.StrToBytes(r.Options.ImageLazyLoading)));
        r.WriteString("\" data-src=\"");
      }
      r.Write(html.EscapeHTML(destTokens));
      r.WriteString("\" alt=\"");
    }
    r.DisableTags++;
    return ast.WalkContinue;
  }

  r.DisableTags--;
  if (0 === r.DisableTags) {
    r.WriteByte(lex.ItemDoublequote);
    const title = node.ChildByType(ast.NodeLinkTitle);
    if (null !== title && null !== title.Tokens) {
      r.WriteString(" title=\"");
      r.Write(html.EscapeHTML(title.Tokens));
      r.WriteByte(lex.ItemDoublequote);
    }
    const ial = r.NodeAttrsStr(node);
    if ("" !== ial) {
      r.WriteString(" " + ial);
    }
    r.WriteString(" />");
    const style = node.IALAttr("style");
    if ("" !== style) {
      r.Tag("/span", null, false);
    }

    if (r.Options.Sanitize) {
      const buf = r.Writer.Bytes();
      const idx = bytes.LastIndex(buf, imgSrcPrefix);
      // PORT-NOTE: Go panics here when idx is -1 (buf[idx:]); idx is always found, the <img src= was written above
      let imgBuf: Uint8Array = buf.subarray(idx);
      if (r.Options.Sanitize) {
        imgBuf = sanitize(imgBuf);
      }
      r.Writer.Truncate(idx);
      r.Writer.Write(imgBuf);
    }
  }
  return ast.WalkContinue;
};

const javascriptColonBytes: Uint8Array = conv.BytesFromString("javascript:");

HtmlRenderer.prototype.renderLink = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.LinkTextAutoSpacePrevious(node);

    const dest = node.ChildByType(ast.NodeLinkDest)!;
    let destTokens = nodeTokens(dest);
    if (r.Options.Sanitize) {
      let tokens = bytes.TrimSpace(destTokens);
      tokens = bytes.ToLower(tokens);
      if (bytes.HasPrefix(tokens, javascriptColonBytes)) {
        destTokens = new Uint8Array(0); // PORT-NOTE: Go sets nil, which behaves as empty
      }
    }
    destTokens = r.LinkPath(destTokens);
    const attrs: string[][] = [["href", util.BytesToStr(html.EscapeHTML(destTokens))]];
    const title = node.ChildByType(ast.NodeLinkTitle);
    if (null !== title && null !== title.Tokens) {
      attrs.push(["title", util.BytesToStr(html.EscapeHTML(title.Tokens))]);
    }
    r.Tag("a", attrs, false);
  } else {
    r.Tag("/a", null, false);

    r.LinkTextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderHTML = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens = nodeTokens(node);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderInlineHTML = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens = nodeTokens(node);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    r.Write(tokens);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderDocument = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderParagraph = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (node !== r.Tree.Root && node.IsTabTitleBlock()) {
    return ast.WalkSkipChildren;
  }
  const grandparent = node.Parent!.Parent;
  if (null !== grandparent && ast.NodeList === grandparent.Type && grandparent.ListData!.Tight) { // List.ListItem.Paragraph
    return ast.WalkContinue;
  }

  if (entering) {
    r.Newline();
    r.handleKramdownBlockIAL(node);
    const attrs: string[][] = [];
    attrs.push(...(node.KramdownIAL ?? []));
    if (r.Options.ChineseParagraphBeginningSpace && ast.NodeDocument === node.Parent!.Type) {
      if (!r.ParagraphContainImgOnly(node)) {
        attrs.push(["class", "indent--2"]);
      }
    }
    r.Tag("p", attrs, false);
  } else {
    r.Tag("/p", null, false);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderText = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens: Uint8Array = new Uint8Array(0);
    if (r.Options.AutoSpace) {
      tokens = r.Space(nodeTokens(node));
    } else {
      tokens = nodeTokens(node);
    }

    if (r.Options.FixTermTypo) {
      tokens = r.FixTermTypo(tokens);
    }
    r.Write(html.EscapeHTML(tokens));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCodeSpan = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

HtmlRenderer.prototype.renderCodeSpanOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("code", node.Parent!.KramdownIAL, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCodeSpanContent = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(html.EscapeHTML(nodeTokens(node)));
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCodeSpanCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/code", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderEmphasis = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderEmAsteriskOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("em", node.Parent!.KramdownIAL, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderEmAsteriskCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/em", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderEmUnderscoreOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("em", node.Parent!.KramdownIAL, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderEmUnderscoreCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/em", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrong = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrongA6kOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("strong", node.Parent!.KramdownIAL, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrongA6kCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/strong", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrongU8eOpenMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("strong", node.Parent!.KramdownIAL, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderStrongU8eCloseMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("/strong", null, false);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBlockquote = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    r.handleKramdownBlockIAL(node);
    r.Tag("blockquote", node.KramdownIAL, false);
    r.Newline();
  } else {
    r.Newline();
    r.WriteString("</blockquote>");
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderBlockquoteMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

export const headingLevel = " 123456";

HtmlRenderer.prototype.renderHeading = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    if (0 > node.HeadingLevel || 6 < node.HeadingLevel) {
      // PORT-NOTE: Go panics here (slice bounds out of range)
      // UPSTREAM-BUG: headingLevel[node.HeadingLevel:node.HeadingLevel+1] panics when the level is below 0 or above 6; BlockDOM2RichHTML reaches it with data-subtype="h7"
      throw new Error("runtime error: slice bounds out of range");
    }
    const level = headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1);
    r.WriteString("<h" + level);
    const id = HeadingID(node);
    if (r.Options.ToC || r.Options.HeadingID || r.Options.KramdownBlockIAL) {
      r.WriteString(" id=\"" + id + "\"");
      if (r.Options.KramdownBlockIAL) {
        const kramdownIAL = node.KramdownIAL ?? [];
        if ("id" !== r.Options.KramdownIALIDRenderName && 0 < kramdownIAL.length) {
          r.WriteString(" " + r.Options.KramdownIALIDRenderName + "=\"" + kramdownIAL[0][1] + "\"");
        }
        if (1 < kramdownIAL.length) {
          for (const attr of kramdownIAL) {
            if ("id" === attr[0]) {
              continue;
            }
            r.WriteString(" " + attr[0] + "=\"" + attr[1] + "\"");
          }
        }
      }
    }
    r.WriteString(">");
  } else {
    if (r.Options.HeadingAnchor) {
      const id = HeadingID(node);
      r.Tag("a", [["id", "vditorAnchor-" + id], ["class", "vditor-anchor"], ["href", "#" + id]], false);
      r.WriteString("<svg viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" height=\"16\"><path fill-rule=\"evenodd\" d=\"M4 9h1v1H4c-1.5 0-3-1.69-3-3.5S2.55 3 4 3h4c1.45 0 3 1.69 3 3.5 0 1.41-.91 2.72-2 3.25V8.59c.58-.45 1-1.27 1-2.09C10 5.22 8.98 4 8 4H4c-.98 0-2 1.22-2 2.5S3 9 4 9zm9-3h-1v1h1c1 0 2 1.22 2 2.5S13.98 12 13 12H9c-.98 0-2-1.22-2-2.5 0-.83.42-1.64 1-2.09V6.25c-1.09.53-2 1.84-2 3.25C6 11.31 7.55 13 9 13h4c1.45 0 3-1.69 3-3.5S14.5 6 13 6z\"></path></svg>");
      r.Tag("/a", null, false);
    }
    if (0 > node.HeadingLevel || 6 < node.HeadingLevel) {
      // PORT-NOTE: Go panics here (slice bounds out of range)
      // UPSTREAM-BUG: same slice as in the entering branch
      throw new Error("runtime error: slice bounds out of range");
    }
    r.WriteString("</h" + headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1) + ">");
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderHeadingC8hMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderHeadingID = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderList = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  const listData = node.ListData!;
  let tag = "ul";
  if (1 === listData.Typ || (3 === listData.Typ && 0 === listData.BulletChar)) {
    tag = "ol";
  }
  if (entering) {
    r.Newline();
    const attrs: string[][] = [];
    r.renderListStyle(node, attrs);
    if (0 === listData.BulletChar && 1 !== listData.Start) {
      attrs.push(["start", strconv.Itoa(listData.Start)]);
    }
    r.handleKramdownBlockIAL(node);
    attrs.push(...(node.KramdownIAL ?? []));
    r.Tag(tag, attrs, false);
    r.Newline();
  } else {
    r.Newline();
    r.Tag("/" + tag, null, false);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderListItem = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [];
    r.handleKramdownBlockIAL(node);
    attrs.push(...(node.KramdownIAL ?? []));
    if (3 === node.ListData!.Typ && "" !== r.Options.GFMTaskListItemClass && null !== node.FirstChild &&
      ((ast.NodeTaskListItemMarker === node.FirstChild.Type) ||
        (null !== node.FirstChild.FirstChild && ast.NodeTaskListItemMarker === node.FirstChild.FirstChild.Type))) {
      let taskListItemMarker = node.FirstChild.FirstChild;
      if (null === taskListItemMarker) {
        taskListItemMarker = node.FirstChild;
      }
      let taskClass = r.Options.GFMTaskListItemClass;
      if (taskListItemMarker.TaskListItemChecked) {
        taskClass += " vditor-task--done";
      }
      attrs.push(["class", taskClass]);
    }
    r.Tag("li", attrs, false);
  } else {
    r.Tag("/li", null, false);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderTaskListItemMarker = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const attrs: string[][] = [];
    if (r.NormalizedTaskListItemChecked(node)) {
      attrs.push(["checked", ""]);
    }
    attrs.push(["disabled", ""], ["type", "checkbox"]);
    if (r.Options.DataTask) {
      const marker = node.EffectiveTaskListItemMarker();
      attrs.push(["data-task", marker]);
    }
    r.Tag("input", attrs, true);
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderThematicBreak = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    r.Tag("hr", null, true);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderHardBreak = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Tag("br", null, true);
    r.Newline();
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderSoftBreak = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (r.Options.SoftBreak2HardBreak) {
      r.Tag("br", null, true);
      r.Newline();
    } else {
      r.Newline();
    }
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.handleKramdownBlockIAL = function (this: HtmlRenderer, node: ast.Node): void {
  const r = this;
  if (r.Options.KramdownBlockIAL && "id" !== r.Options.KramdownIALIDRenderName && null !== node.KramdownIAL && 0 < node.KramdownIAL.length) {
    // The first item must be the ID
    node.KramdownIAL[0][0] = r.Options.KramdownIALIDRenderName;
  }
};

HtmlRenderer.prototype.renderTextMarkAttrs = function (this: HtmlRenderer, node: ast.Node): string[][] {
  const r = this;
  let attrs: string[][] = [];
  attrs = [["data-type", node.TextMarkType]];

  const types = strings.Split(node.TextMarkType, " ");
  for (const typ of types) {
    if ("block-ref" === typ) {
      attrs.push(["data-subtype", node.TextMarkBlockRefSubtype]);
      attrs.push(["data-id", node.TextMarkBlockRefID]);
    } else if ("a" === typ) {
      let href = node.TextMarkAHref;
      href = conv.StringFromBytes(r.LinkPath(conv.BytesFromString(href)));

      attrs.push(["data-href", href]);
      if ("" !== node.TextMarkATitle) {
        attrs.push(["data-title", node.TextMarkATitle]);
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

HtmlRenderer.prototype.spanNodeAttrs = function (this: HtmlRenderer, node: ast.Node, attrs: string[][]): void {
  const r = this;
  attrs.push(...(node.KramdownIAL ?? []));
};
