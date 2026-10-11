// Ported from render/protyle_export_md_renderer.go @ 8e7896b6
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
import { BaseRenderer, ProtyleExportMdRenderer } from "./types.ts";
import { NoHighlight, nodeTokens, setWriterFromOwn } from "./renderer.ts";
import type { Options } from "./renderer.ts";
import { calloutTitle } from "./callout.ts";
import { isCJK } from "./space.ts";
import { tableCellRichInlineHTML } from "./table_rich.ts";
import { escapeTabsParagraphMarkers } from "./tabs.ts";
import { isTableCellIALNode, tableCellFullIALTokens, tableCellStructIALTokens } from "./format_renderer.ts";
// PORT-NOTE: the following files only attach methods to BaseRenderer (see PORTING.md); importing them here makes sure the methods exist
// whenever this file is imported on its own.
import "./link.ts";
import "./space.ts";
import "./term_typographer.ts";

// PORT-NOTE: Go's ast.Node.Tokens is a nil-able slice; here it is `Uint8Array | null`. Reads where Go only uses the length or the content
// go through nodeTokens; comparisons with nil read node.Tokens directly.

const zwspBytes: Uint8Array = conv.BytesFromString(editor.Zwsp);
const spaceBytes: Uint8Array = conv.BytesFromString(" ");
const caretSpaceBytes: Uint8Array = conv.BytesFromString(editor.Caret + " ");
const apostropheBytes: Uint8Array = conv.BytesFromString("'");
const aposEntityBytes: Uint8Array = conv.BytesFromString("&apos;");
const quoteBytes: Uint8Array = conv.BytesFromString("\"");
const quotEntityBytes: Uint8Array = conv.BytesFromString("&quot;");
const escapedPipeBytes: Uint8Array = conv.BytesFromString("\\|");
const pipeBytes: Uint8Array = conv.BytesFromString("|");
const brSlashBytes: Uint8Array = conv.BytesFromString("<br/>");
const newlineBytes: Uint8Array = conv.BytesFromString("\n");
const emptyBytes: Uint8Array = new Uint8Array(0);
const starSpaceBytes: Uint8Array = conv.BytesFromString("* ");
const emptyItemPrefixBytes: Uint8Array = conv.BytesFromString(" \n\n");
const superBlockOpenBytes: Uint8Array = conv.BytesFromString("{{{");
const superBlockCloseBytes: Uint8Array = conv.BytesFromString("}}}");
const hyphenBytes: Uint8Array = new Uint8Array([lex.ItemHyphen]);
const backtick3Bytes: Uint8Array = bytes.Repeat(new Uint8Array([lex.ItemBacktick]), 3);
const crosshatchBytes: Uint8Array = new Uint8Array([lex.ItemCrosshatch]);

declare module "./types.ts" {
  interface ProtyleExportMdRenderer {
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
    renderTabs(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderMdMarker(node: ast.Node, entering: boolean): string;
    renderMdMarker0(node: ast.Node, currentTextmarkType: string, entering: boolean): string;
    renderMdMarker1(node: ast.Node, currentTextmarkType: string, entering: boolean): string;
    withoutKramdownBlockIAL(node: ast.Node): boolean;
  }
}

export function NewProtyleExportMdRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): ProtyleExportMdRenderer {
  const ret = new ProtyleExportMdRenderer(tree, options, parseOptions);
  ret.tableCellRichInline = true;
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

ProtyleExportMdRenderer.prototype.renderCallout = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.renderBlockquote(node, entering);
    r.WriteString("[!");
    r.WriteString(node.CalloutType);
    r.WriteByte(lex.ItemCloseBracket);
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

ProtyleExportMdRenderer.prototype.renderCustomBlock = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderAttributeView = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderTextMark = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  const isStrongEm = node.ContainTextMarkTypes("strong", "em", "s") && !node.IsTextMarkType("inline-math");
  if (entering) {
    const marker = r.renderMdMarker(node, entering);
    if (!node.IsTextMarkType("a") && !node.IsTextMarkType("inline-memo") && !node.IsTextMarkType("block-ref") && !node.IsTextMarkType("file-annotation-ref") && !node.IsTextMarkType("inline-math")) {
      let textContent = node.TextMarkTextContent;
      if (node.IsTextMarkType("code")) {
        textContent = html.UnescapeString(textContent);
        if (node.ParentIs(ast.NodeTableCell)) {
          // Add one more escape character Improve the handling of inline-code containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9252
          textContent = lex.RepeatBackslashBeforePipe(textContent);
        }
      }

      if (isStrongEm) {
        // Pad a space to satisfy the Markdown syntax https://ld246.com/article/1597581380183
        // https://github.com/siyuan-note/siyuan/issues/6472
        // https://github.com/siyuan-note/siyuan/issues/9542
        // A zero-width space cannot be used here, only a space, otherwise the Pandoc export has problems
        const firstRune = utf8.DecodeRuneInString(textContent)[0];
        const beforeIsWhitespace = lex.IsUnicodeWhitespace(firstRune);
        const beforeIsPunct = unicode.IsPunct(firstRune) || unicode.IsSymbol(firstRune);
        if (beforeIsWhitespace || beforeIsPunct) {
          r.WriteByte(lex.ItemSpace);
        }
      }
      r.WriteString(marker);
      if (strings.Contains(node.TextMarkTextContent, "`")) {
        r.WriteByte(0x20 /* space */);
      }
      r.WriteString(textContent);
    } else {
      r.WriteString(marker);
      if (strings.Contains(node.TextMarkTextContent, "`")) {
        r.WriteByte(0x20 /* space */);
      }
    }
  } else {
    const marker = r.renderMdMarker(node, entering);
    if (strings.Contains(node.TextMarkTextContent, "`")) {
      r.WriteByte(0x20 /* space */);
    }
    r.WriteString(marker);
    if (null !== node.Next) {
      if (ast.NodeTextMark === node.Next.Type) {
        r.WriteString(editor.Zwsp); // Separate adjacent Markdown markers with a zero-width space
      } else {
        if (isStrongEm) {
          const textContent = node.TextMarkTextContent;
          const lastRune = utf8.DecodeLastRuneInString(textContent)[0];
          const afterIsWhitespace = lex.IsUnicodeWhitespace(lastRune);
          const afterIsPunct = unicode.IsPunct(lastRune) || unicode.IsSymbol(lastRune);
          if (afterIsWhitespace || afterIsPunct) {
            r.WriteByte(lex.ItemSpace);
          }
        }
      }
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMdMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): string {
  const r = this;
  let ret = "";
  let types = strings.Split(node.TextMarkType, " ");

  if (1 === types.length) {
    return r.renderMdMarker0(node, types[0], entering);
  }

  // Reorder: put a, inline-memo, block-ref, file-annotation-ref and inline-math first, and code last
  let tmp: string[] = [];
  let code = "";
  for (let i = 0; i < types.length; i++) {
    const typ = types[i];
    if ("a" === typ || "inline-memo" === typ || "block-ref" === typ || "file-annotation-ref" === typ || "inline-math" === typ) {
      tmp.push(typ);
      types = types.slice(0, i).concat(types.slice(i + 1));
      break;
    }

    if ("code" === typ) {
      code = typ;
      types = types.slice(0, i).concat(types.slice(i + 1));
      break;
    }

    if ("text" === typ) {
      continue;
    }
  }
  types = tmp.concat(types);
  if ("" !== code) {
    types.push(code);
  }

  tmp = [];
  // Filter out the text type
  for (const typ of types) {
    if ("text" !== typ) {
      tmp.push(typ);
    }
  }
  types = tmp;

  if (1 > types.length) {
    return ret;
  }

  const typ = types[0];
  if ("a" === typ || "inline-memo" === typ || "block-ref" === typ || "file-annotation-ref" === typ || "inline-math" === typ) {
    const rest = types.slice(1);

    if (entering) {
      for (const t of rest) {
        if ("code" !== t) {
          ret += r.renderMdMarker1(node, t, entering);
        }
      }

      switch (typ) {
        case "a": {
          let href = node.TextMarkAHref;
          href = conv.StringFromBytes(r.LinkPath(conv.BytesFromString(href)));
          href = html.UnescapeHTMLStr(href);
          href = r.EncodeLinkSpace(href);
          ret += "[";
          for (const t of rest) {
            if ("code" === t) {
              ret += r.renderMdMarker1(node, t, entering);
            }
          }
          return ret;
        }
        case "block-ref":
          node.TextMarkTextContent = strings.ReplaceAll(node.TextMarkTextContent, "'", "&apos;");
          ret += "((" + node.TextMarkBlockRefID;
          if ("s" === node.TextMarkBlockRefSubtype) {
            ret += " \"" + node.TextMarkTextContent + "\"";
          } else {
            ret += " '" + node.TextMarkTextContent + "'";
          }
          ret += "))";
          break;
        case "file-annotation-ref":
          node.TextMarkTextContent = strings.ReplaceAll(node.TextMarkTextContent, "'", "&apos;");
          ret += "<<" + node.TextMarkFileAnnotationRefID;
          ret += " \"" + node.TextMarkTextContent + "\"";
          ret += ">>";
          break;
        case "inline-memo": {
          ret += node.TextMarkTextContent;

          if (node.IsNextSameInlineMemo()) {
            return ret;
          }

          let content = node.TextMarkInlineMemoContent;
          content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
          if ("" !== content) {
            const lastRune = utf8.DecodeLastRuneInString(node.TextMarkTextContent)[0];
            if (isCJK(lastRune)) {
              ret += "<sup>（" + content + "）</sup>";
            } else {
              ret += "<sup>(" + content + ")</sup>";
            }
          }
          break;
        }
        case "inline-math": {
          let content = node.TextMarkInlineMathContent;
          if (node.ParentIs(ast.NodeTableCell)) {
            // Improve the handling of inline-math containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9227
            content = lex.RepeatBackslashBeforePipe(content);
            content = strings.ReplaceAll(content, "\n", "<br/>");
          }
          content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
          ret += "$" + content + "$";
          break;
        }
      }
    } else {
      switch (typ) {
        case "a": {
          let href = node.TextMarkAHref;
          href = conv.StringFromBytes(r.LinkPath(conv.BytesFromString(href)));
          href = html.UnescapeHTMLStr(href);
          href = r.EncodeLinkSpace(href);
          ret += conv.StringFromBytes(lex.EscapeProtyleMarkers(conv.BytesFromString(node.TextMarkTextContent)));
          for (const t of rest) {
            if ("code" === t) {
              ret += r.renderMdMarker1(node, t, entering);
            }
          }
          ret += "](" + href;
          if ("" !== node.TextMarkATitle) {
            ret += " \"" + html.UnescapeHTMLStr(node.TextMarkATitle) + "\"";
          }
          ret += ")";
          break;
        }
      }

      for (const t of rest) {
        if ("code" !== t) {
          ret += r.renderMdMarker1(node, t, entering);
        }
      }
    }
  } else {
    if (!entering) {
      reverse(types);
    }
    for (let i = 0; i < types.length; i++) {
      ret += r.renderMdMarker1(node, types[i], entering);
      if (entering) {
        if ("" !== code && types.length - 2 === i) { // When the innermost is code, add a zero-width space before rendering code, then render the code marker
          ret += editor.Zwsp; // Improve exporting inline code markdown element https://github.com/siyuan-note/siyuan/issues/10988
        }
      }

      if (!entering) {
        if ("" !== code && 0 === i) { // When the innermost is code, add a zero-width space after rendering the code marker, then render the other markers
          ret += editor.Zwsp;
        }
      }
    }
  }
  return ret;
};

export function reverse(ss: string[]): void {
  const last = ss.length - 1;
  for (let i = 0; i < Math.trunc(ss.length / 2); i++) {
    const tmp = ss[i];
    ss[i] = ss[last - i];
    ss[last - i] = tmp;
  }
}

ProtyleExportMdRenderer.prototype.renderMdMarker0 = function (this: ProtyleExportMdRenderer, node: ast.Node, currentTextmarkType: string, entering: boolean): string {
  const r = this;
  let ret = "";
  switch (currentTextmarkType) {
    case "a": {
      let href = node.TextMarkAHref;
      href = conv.StringFromBytes(r.LinkPath(conv.BytesFromString(href)));
      if (strings.Contains(href, "&amp;")) {
        href = html.UnescapeHTMLStr(href);
      }
      href = r.EncodeLinkSpace(href);
      if (entering) {
        let content = strings.ReplaceAll(node.TextMarkTextContent, "[", "\\[");
        content = strings.ReplaceAll(content, "]", "\\]");
        content = html.UnescapeHTMLStr(content);
        ret += "[" + content + "](" + href;
        if ("" !== node.TextMarkATitle) {
          let title = html.UnescapeHTMLStr(node.TextMarkATitle);
          // The < and > symbols need no escaping, which conforms to the Markdown spec https://github.com/siyuan-note/siyuan/issues/15023
          title = strings.ReplaceAll(title, "&lt;", "<");
          title = strings.ReplaceAll(title, "&gt;", ">");
          ret += " \"" + title + "\"";
        }
        ret += ")";
      }
      break;
    }
    case "block-ref":
      if (entering) {
        node.TextMarkTextContent = strings.ReplaceAll(node.TextMarkTextContent, "'", "&apos;");
        ret += "((" + node.TextMarkBlockRefID;
        if ("s" === node.TextMarkBlockRefSubtype) {
          ret += " \"" + node.TextMarkTextContent + "\"";
        } else {
          ret += " '" + node.TextMarkTextContent + "'";
        }
        ret += "))";
      }
      break;
    case "file-annotation-ref":
      if (entering) {
        node.TextMarkTextContent = strings.ReplaceAll(node.TextMarkTextContent, "'", "&apos;");
        ret += "<<" + node.TextMarkFileAnnotationRefID;
        ret += " \"" + node.TextMarkTextContent + "\"";
        ret += ">>";
      }
      break;
    case "inline-memo":
      if (entering) {
        ret += node.TextMarkTextContent;

        if (node.IsNextSameInlineMemo()) {
          return ret;
        }

        let content = node.TextMarkInlineMemoContent;
        content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
        if ("" !== content) {
          const lastRune = utf8.DecodeLastRuneInString(node.TextMarkTextContent)[0];
          if (isCJK(lastRune)) {
            ret += "<sup>（" + content + "）</sup>";
          } else {
            ret += "<sup>(" + content + ")</sup>";
          }
        }
      }
      break;
    case "inline-math":
      if (entering) {
        let content = node.TextMarkInlineMathContent;
        if (node.ParentIs(ast.NodeTableCell)) {
          // Improve the handling of inline-math containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9227
          content = lex.RepeatBackslashBeforePipe(content);
          content = strings.ReplaceAll(content, "\n", "<br/>");
        }
        content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
        ret += "$" + content;
      } else {
        ret += "$";
      }
      break;
    default:
      ret += r.renderMdMarker1(node, currentTextmarkType, entering);
  }
  return ret;
};

ProtyleExportMdRenderer.prototype.renderMdMarker1 = function (this: ProtyleExportMdRenderer, node: ast.Node, currentTextmarkType: string, entering: boolean): string {
  const r = this;
  let ret = "";
  switch (currentTextmarkType) {
    case "strong":
      ret += "**";
      break;
    case "em":
      ret += "*";
      break;
    case "code":
      if (strings.Contains(node.TextMarkTextContent, "``")) {
        ret += "`";
      } else if (strings.Contains(node.TextMarkTextContent, "`")) {
        ret += "``";
      } else {
        ret += "`";
      }
      break;
    case "tag":
      ret += "#";
      break;
    case "s":
      ret += "~~";
      break;
    case "mark":
      ret += "==";
      break;
    case "u":
      if (entering) {
        ret += "<u>";
      } else {
        ret += "</u>";
      }
      break;
    case "sup":
      if (entering) {
        ret += "<sup>";
      } else {
        ret += "</sup>";
      }
      break;
    case "sub":
      if (entering) {
        ret += "<sub>";
      } else {
        ret += "</sub>";
      }
      break;
    case "kbd":
      if (entering) {
        ret += "<kbd>";
      } else {
        ret += "</kbd>";
      }
      break;
    case "text":
      if (entering) {
        ret += "<span data-type=\"text\"";
        const ial = parse.IAL2Map(node.KramdownIAL);
        for (const [k, v] of ial) {
          ret += " " + k + "=\"" + v + "\"";
        }
        ret += ">";
      } else {
        ret += "</span>";
      }
      break;
  }
  return ret;
};

ProtyleExportMdRenderer.prototype.renderBr = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<br />");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderUnderline = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderUnderlineOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<u>");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderUnderlineCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</u>");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderKbd = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderKbdOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<kbd>");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderKbdCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</kbd>");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderVideo = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens = nodeTokens(node);
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderAudio = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens = nodeTokens(node);
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderIFrame = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens = nodeTokens(node);
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderWidget = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens = nodeTokens(node);
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.Newline();
    if (!r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderGitConflictCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
    r.Newline();
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderGitConflictContent = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    r.Write(nodeTokens(node));
    r.Newline();
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderGitConflictOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
    r.Newline();
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderGitConflict = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSuperBlock = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSuperBlockOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering && r.Options.SuperBlock) {
    r.Write(superBlockOpenBytes);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSuperBlockLayoutMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering && r.Options.SuperBlock) {
    r.Write(nodeTokens(node));
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSuperBlockCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (r.Options.SuperBlock) {
      r.Newline();
      r.Write(superBlockCloseBytes);
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

ProtyleExportMdRenderer.prototype.renderLinkRefDefBlock = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderLinkRefDef = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderTag = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderTagOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCrosshatch);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderTagCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCrosshatch);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderKramdownBlockIAL = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!r.Options.KramdownBlockIAL) {
    return ast.WalkContinue;
  }

  if (null !== node.Previous && ast.NodeListItem === node.Previous.Type) {
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
    if (ast.NodeListItem === node.Parent!.Type || ast.NodeList === node.Parent!.Type) {
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

ProtyleExportMdRenderer.prototype.renderKramdownSpanIAL = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!r.Options.KramdownSpanIAL) {
    return ast.WalkContinue;
  }
  if (isTableCellIALNode(node)) {
    return ast.WalkContinue;
  }

  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMark = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMark1OpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("=");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMark1CloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("=");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMark2OpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("==");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMark2CloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("==");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSup = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSupOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<sup>");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSupCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</sup>");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSub = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSubOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("<sub>");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderSubCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("</sub>");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBlockQueryEmbedScript = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBlockQueryEmbed = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
  } else {
    r.Newline();
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBlockRef = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBlockRefID = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBlockRefSpace = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemSpace);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBlockRefText = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDoublequote);
    let tokens = html.EscapeHTML(nodeTokens(node));
    tokens = bytes.ReplaceAll(tokens, apostropheBytes, aposEntityBytes);
    r.Write(tokens);
    r.WriteByte(lex.ItemDoublequote);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBlockRefDynamicText = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemSinglequote);
    let tokens = html.EscapeHTML(nodeTokens(node));
    tokens = bytes.ReplaceAll(tokens, apostropheBytes, aposEntityBytes);
    r.Write(tokens);
    r.WriteByte(lex.ItemSinglequote);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderFileAnnotationRef = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderFileAnnotationRefID = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderFileAnnotationRefSpace = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemSpace);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderFileAnnotationRefText = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDoublequote);
    let tokens = html.EscapeHTML(nodeTokens(node));
    tokens = bytes.ReplaceAll(tokens, apostropheBytes, aposEntityBytes);
    r.Write(tokens);
    r.WriteByte(lex.ItemDoublequote);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderYamlFrontMatterCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(parse.YamlFrontMatterMarker);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderYamlFrontMatterContent = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderYamlFrontMatterOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(parse.YamlFrontMatterMarker);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderYamlFrontMatter = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    // UPSTREAM-BUG: `!entering` is always false inside `if entering`, so the newline after the front matter below is dead code
    if (!entering && !r.isLastNode(r.Tree.Root!, node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderHtmlEntity = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(node.HtmlEntityTokens);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBackslashContent = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBackslash = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemBackslash);
  }
  return ast.WalkContinue;
};

// PORT-NOTE: Go embedding, BaseRenderer also defines renderToC; the base class does not call it (it is only registered by renderers), so no explicit-base rewrite is needed.
ProtyleExportMdRenderer.prototype.renderToC = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("[toc]\n\n");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderFootnotesRef = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("[" + util.BytesToStr(nodeTokens(node)) + "]");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderFootnotesDefBlock = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderFootnotesDef = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Writer = new bytes.Buffer();
    r.NodeWriterStack.push(r.Writer);
    r.WriteString("[" + util.BytesToStr(nodeTokens(node)) + "]: ");
  } else {
    const writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    r.NodeWriterStack = r.NodeWriterStack.slice(0, r.NodeWriterStack.length - 1);
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

ProtyleExportMdRenderer.prototype.renderEmojiAlias = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderEmojiImg = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderEmojiUnicode = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderEmoji = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderTableCell = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  const padding = node.TableCellContentMaxWidth - node.TableCellContentWidth;
  if (entering) {
    r.WriteByte(lex.ItemPipe);
    if (!r.Options.OmitTableCellIAL && !r.Options.KramdownSpanIAL && null === node.TableCellRich) {
      const ialTokens = tableCellStructIALTokens(node);
      if (null !== ialTokens) {
        r.Write(ialTokens);
      }
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
    if (!r.Options.OmitTableCellIAL && r.Options.KramdownSpanIAL && null === node.TableCellRich) {
      r.Write(tableCellFullIALTokens(node));
    }
    if (null !== node.TableCellRich) {
      r.Write(tableCellRichInlineHTML(node, r.Options, r.ParseOptions));
      return ast.WalkSkipChildren;
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
      }
      r.WriteByte(lex.ItemSpace);
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderTableRow = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (!entering) {
    r.WriteString("|\n");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderTableHead = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderTable = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (r.needUseHTMLTable(node)) {
    if (entering) {
      r.renderTableByHTML(node);
      return ast.WalkSkipChildren;
    }
    return ast.WalkContinue;
  }

  if (entering) {
    // Walk the cells to work out the maximum width

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
        // Adding spaces automatically changes the cell width
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

ProtyleExportMdRenderer.prototype.renderStrikethrough = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderStrikethrough1OpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemTilde);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderStrikethrough1CloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemTilde);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderStrikethrough2OpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("~~");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderStrikethrough2CloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("~~");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderLinkTitle = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDoublequote);
    // Output without escaping here, only escape the double quote https://github.com/siyuan-note/siyuan/issues/15023
    let tokens = nodeTokens(node);
    tokens = bytes.ReplaceAll(tokens, quoteBytes, quotEntityBytes);
    r.Write(tokens);
    r.WriteByte(lex.ItemDoublequote);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderLinkDest = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens = nodeTokens(node);
    tokens = r.LinkPath(tokens);
    tokens = conv.BytesFromString(r.EncodeLinkSpace(conv.StringFromBytes(tokens)));
    r.Write(tokens);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderLinkSpace = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemSpace);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderLinkText = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens: Uint8Array;
    if (r.Options.AutoSpace) {
      tokens = r.Space(nodeTokens(node));
    } else {
      tokens = nodeTokens(node);
    }
    let altTextContent = util.BytesToStr(tokens);
    altTextContent = strings.ReplaceAll(altTextContent, "[", "\\[");
    altTextContent = strings.ReplaceAll(altTextContent, "]", "\\]");
    r.WriteString(altTextContent);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCloseParen = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCloseParen);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderOpenParen = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemOpenParen);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderGreater = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemGreater);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderLess = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemLess);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCloseBrace = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCloseBrace);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderOpenBrace = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemOpenBrace);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCloseBracket = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemCloseBracket);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderOpenBracket = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemOpenBracket);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBang = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemBang);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderImage = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (r.Options.ImgTag && entering) {
    const attrs: string[][] = [];
    const altText = node.ChildByType(ast.NodeLinkText);
    if (null !== altText) {
      let altTextContent = util.BytesToStr(nodeTokens(altText));
      altTextContent = strings.ReplaceAll(altTextContent, "[", "\\[");
      altTextContent = strings.ReplaceAll(altTextContent, "]", "\\]");
      attrs.push(["alt", altTextContent]);
    }
    const link = node.ChildByType(ast.NodeLinkDest);
    if (null !== link) {
      let dest = nodeTokens(link);
      dest = r.LinkPath(dest);
      dest = conv.BytesFromString(r.EncodeLinkSpace(conv.StringFromBytes(dest)));
      attrs.push(["src", util.BytesToStr(dest)]);
    }
    const title = node.ChildByType(ast.NodeLinkTitle);
    if (null !== title) {
      let titleTokens = nodeTokens(title);
      titleTokens = bytes.ReplaceAll(titleTokens, quoteBytes, quotEntityBytes);
      attrs.push(["title", util.BytesToStr(titleTokens)]);
    }
    const style = node.IALAttr("style");
    if ("" !== style) {
      attrs.push(["style", style]);
    }
    r.Tag("img", attrs, true);
    return ast.WalkSkipChildren;
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderLink = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderHTML = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    let tokens = nodeTokens(node);
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

ProtyleExportMdRenderer.prototype.renderInlineHTML = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderDocument = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Writer = new bytes.Buffer();
    r.NodeWriterStack.push(r.Writer);
  } else {
    r.NodeWriterStack = r.NodeWriterStack.slice(0, r.NodeWriterStack.length - 1);
    let buf: Uint8Array;
    if (r.Options.KeepParagraphBeginningSpace) {
      buf = bytes.TrimRight(r.Writer.Bytes(), " \t\n");
      buf = bytes.TrimLeft(buf, "\n");
    } else {
      buf = bytes.Trim(r.Writer.Bytes(), " \t\n");
    }
    // PORT-NOTE: perf, departs from 1:1 (render/protyle_export_md_renderer.go:1520): setWriterFromOwn moves buf to the start of
    // r.Writer's storage and cuts the length, instead of Reset and Write of the same bytes. The content and LastOut are the same.
    setWriterFromOwn(r, buf);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderParagraph = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (r.Options.TabsMarkdown && node !== r.Tree.Root && node.IsTabTitleBlock()) {
    return ast.WalkSkipChildren;
  }
  if (entering) {
    if (r.Options.ChineseParagraphBeginningSpace && ast.NodeDocument === node.Parent!.Type) {
      if (!r.ParagraphContainImgOnly(node)) {
        r.WriteString("　　");
      }
    }
  } else {
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
      if (ast.NodeListItem === parent.Type) { // ListItem.Paragraph
        const listItem = parent;
        if (null !== listItem.Parent && null !== listItem.Parent.ListData) {
          // Must be decided by the tight flag on the list (not the list item), because only List.Tight is set when the flag is set
          // See the function List.Finalize() for the implementation that sets the tight flag
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

ProtyleExportMdRenderer.prototype.renderText = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    // Remove the leading zero-width space Exported Markdown inline code no longer contains zero-width spaces after it https://github.com/siyuan-note/siyuan/issues/15328
    // When exporting inline code to Markdown, try to remove the trailing zero-width space https://github.com/siyuan-note/siyuan/issues/15854
    while (bytes.HasPrefix(nodeTokens(node), zwspBytes) && "" === node.NextNodeText()) {
      node.Tokens = slices.KeepNil(node.Tokens, (b: Uint8Array): Uint8Array => bytes.TrimPrefix(b, zwspBytes));
    }
    if (null === node.Previous) {
      node.Tokens = slices.KeepNil(node.Tokens, (b: Uint8Array): Uint8Array => bytes.CutPrefix(b, zwspBytes)[0]);
    }
    if (1 > nodeTokens(node).length) {
      return ast.WalkContinue;
    }

    let tokens: Uint8Array;
    if (r.Options.AutoSpace) {
      tokens = r.Space(nodeTokens(node));
    } else {
      tokens = nodeTokens(node);
    }

    if (r.Options.FixTermTypo) {
      tokens = r.FixTermTypo(tokens);
    }
    if ((null === node.Previous || ast.NodeTaskListItemMarker === node.Previous.Type) &&
      null !== node.Parent!.Parent && null !== node.Parent!.Parent!.ListData && 3 === node.Parent!.Parent!.ListData!.Typ) {
      if (0x20 /* space */ === r.LastOut) {
        tokens = bytes.TrimPrefix(tokens, spaceBytes);
        if (bytes.HasPrefix(tokens, caretSpaceBytes)) {
          tokens = bytes.TrimPrefix(tokens, caretSpaceBytes);
          tokens = slices.Append(editor.CaretTokens, tokens);
        }
      }
    }

    // Remove the zero-width spaces on both sides of an image node when exporting Markdown https://github.com/siyuan-note/siyuan/issues/14263
    if (null !== node.Previous && ast.NodeImage === node.Previous.Type && editor.Zwsp === conv.StringFromBytes(nodeTokens(node))) {
      return ast.WalkContinue;
    }
    if (null !== node.Next && ast.NodeImage === node.Next.Type && editor.Zwsp === conv.StringFromBytes(nodeTokens(node))) {
      return ast.WalkContinue;
    }

    if (r.ParseOptions.Tabs) {
      tokens = escapeTabsParagraphMarkers(node, tokens, false);
    }
    r.Write(tokens);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCodeSpan = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderCodeSpanOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemBacktick);
    if (1 < node.Parent!.CodeMarkerLen) {
      r.WriteByte(lex.ItemBacktick);
      const text = util.BytesToStr(nodeTokens(node.Next!));
      const firstc = utf8.DecodeRuneInString(text)[0];
      if (0x60 /* ` */ === firstc) {
        r.WriteByte(lex.ItemSpace);
      }
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCodeSpanContent = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens = nodeTokens(node);
    if (node.ParentIs(ast.NodeTableCell)) {
      tokens = bytes.ReplaceAll(tokens, escapedPipeBytes, pipeBytes);
      tokens = bytes.ReplaceAll(tokens, pipeBytes, escapedPipeBytes);
      tokens = bytes.ReplaceAll(tokens, brSlashBytes, emptyBytes);
    }
    r.Write(tokens);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCodeSpanCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    if (1 < node.Parent!.CodeMarkerLen) {
      const text = util.BytesToStr(nodeTokens(node.Previous!));
      const lastc = utf8.DecodeLastRuneInString(text)[0];
      if (0x60 /* ` */ === lastc) {
        r.WriteByte(lex.ItemSpace);
      }
      r.WriteByte(lex.ItemBacktick);
    }
    r.WriteByte(lex.ItemBacktick);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderInlineMath = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderInlineMathOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDollar);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderInlineMathContent = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const tokens = html.UnescapeHTML(nodeTokens(node));
    let content = conv.StringFromBytes(tokens);
    if (node.ParentIs(ast.NodeTableCell)) {
      // Improve the handling of inline-math containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9227
      content = lex.RepeatBackslashBeforePipe(content);
      content = strings.ReplaceAll(content, "\n", "<br/>");
    }
    content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
    r.WriteString(content);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderInlineMathCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemDollar);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMathBlockCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(parse.MathBlockMarker);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMathBlockContent = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    const tokens = html.UnescapeHTML(nodeTokens(node));
    r.Write(tokens);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMathBlockOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(parse.MathBlockMarker);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderMathBlock = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  r.Newline();
  if (!entering && !r.isLastNode(r.Tree.Root!, node)) {
    if (r.withoutKramdownBlockIAL(node)) {
      r.WriteByte(lex.ItemNewline);
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCodeBlockCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderCodeBlockCode = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    let tokens = nodeTokens(node);
    const info = node.Parent!.ChildByType(ast.NodeCodeBlockFenceInfoMarker);
    if (null !== info && conv.StringFromBytes(info.CodeBlockInfo) !== "mindmap" && NoHighlight(conv.StringFromBytes(info.CodeBlockInfo))) {
      tokens = html.UnescapeHTML(tokens);
    }
    r.Write(tokens);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCodeBlockInfoMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(node.CodeBlockInfo);
    r.WriteByte(lex.ItemNewline);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCodeBlockOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Write(nodeTokens(node));
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderCodeBlock = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
    if (!node.IsFencedCodeBlock) {
      r.Write(backtick3Bytes);
      r.WriteByte(lex.ItemNewline);
      r.Write(nodeTokens(node.FirstChild!));
      r.Write(backtick3Bytes);
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

ProtyleExportMdRenderer.prototype.renderEmphasis = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderEmAsteriskOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemAsterisk);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderEmAsteriskCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemAsterisk);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderEmUnderscoreOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemUnderscore);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderEmUnderscoreCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteByte(lex.ItemUnderscore);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderStrong = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.TextAutoSpacePrevious(node);
  } else {
    r.TextAutoSpaceNext(node);
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderStrongA6kOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("**");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderStrongA6kCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("**");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderStrongU8eOpenMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("__");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderStrongU8eCloseMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString("__");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBlockquote = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Writer = new bytes.Buffer();
    r.NodeWriterStack.push(r.Writer);
  } else {
    const writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    r.NodeWriterStack = r.NodeWriterStack.slice(0, r.NodeWriterStack.length - 1);

    const blockquoteLines = new bytes.Buffer();
    let buf = writer.Bytes();
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
    // PORT-NOTE: perf, departs from 1:1 (render/protyle_export_md_renderer.go:1963): setWriterFromOwn, see renderDocument; the content and LastOut are the same.
    setWriterFromOwn(r, buf);
    if (!node.ParentIs(ast.NodeTableCell)) { // A line break is not allowed in a table, otherwise the table layout breaks https://github.com/Vanessa219/vditor/issues/368
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteString("\n\n");
      }
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderBlockquoteMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderHeading = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
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

ProtyleExportMdRenderer.prototype.renderHeadingC8hMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderHeadingID = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.WriteString(" {" + util.BytesToStr(nodeTokens(node)) + "}");
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderList = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Writer = new bytes.Buffer();
    r.NodeWriterStack.push(r.Writer);
  } else {
    const writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    r.NodeWriterStack = r.NodeWriterStack.slice(0, r.NodeWriterStack.length - 1);
    r.NodeWriterStack[r.NodeWriterStack.length - 1].Write(writer.Bytes());
    r.Writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    const buf = bytes.TrimSpace(r.Writer.Bytes());
    // PORT-NOTE: perf, departs from 1:1 (render/protyle_export_md_renderer.go:2026): setWriterFromOwn, see renderDocument; the content and LastOut are the same.
    setWriterFromOwn(r, buf);
    if (!node.ParentIs(ast.NodeTableCell)) {
      if (r.withoutKramdownBlockIAL(node)) {
        r.WriteString("\n\n");
      }
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderListItem = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Writer = new bytes.Buffer();
    r.NodeWriterStack.push(r.Writer);
    if (r.Options.KramdownBlockIAL && null !== node.Next && ast.NodeKramdownBlockIAL === node.Next.Type) {
      const liIAL = node.Next;
      r.Write(nodeTokens(liIAL));
    }
    if (null !== node.FirstChild && ast.NodeList === node.FirstChild.Type) {
      r.Newline();
    }
  } else {
    const writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    r.NodeWriterStack = r.NodeWriterStack.slice(0, r.NodeWriterStack.length - 1);
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
    let buf = writer.Bytes();
    if (bytes.HasPrefix(buf, starSpaceBytes)) {
      // The list item is empty https://github.com/siyuan-note/siyuan/issues/6206
      buf = slices.Append(slices.Clone(emptyItemPrefixBytes), buf);
    }
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
      listItemBuf.WriteString(strconv.Itoa(node.ListData!.Num) + conv.StringFromRune(node.ListData!.Delimiter));
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
      buf = bytes.ReplaceAll(buf, newlineBytes, emptyBytes);
    }
    writer.Reset();
    writer.Write(buf);
    buf = writer.Bytes();
    if (node.ParentIs(ast.NodeTableCell)) {
      buf = bytes.ReplaceAll(buf, newlineBytes, emptyBytes);
    }
    r.NodeWriterStack[r.NodeWriterStack.length - 1].Write(buf);
    r.Writer = r.NodeWriterStack[r.NodeWriterStack.length - 1];
    buf = bytes.TrimSpace(r.Writer.Bytes());
    // PORT-NOTE: perf, departs from 1:1 (render/protyle_export_md_renderer.go:2106): setWriterFromOwn, see renderDocument; the content and LastOut are the same.
    setWriterFromOwn(r, buf);
    if (!node.ParentIs(ast.NodeTableCell)) {
      r.WriteString("\n");
    }
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.renderTaskListItemMarker = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderThematicBreak = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderHardBreak = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
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

ProtyleExportMdRenderer.prototype.renderSoftBreak = function (this: ProtyleExportMdRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  if (entering) {
    r.Newline();
  }
  return ast.WalkContinue;
};

ProtyleExportMdRenderer.prototype.withoutKramdownBlockIAL = function (this: ProtyleExportMdRenderer, node: ast.Node): boolean {
  const r = this;
  return !r.Options.KramdownBlockIAL || 0 === (node.KramdownIAL ?? []).length || null === node.Next || ast.NodeKramdownBlockIAL !== node.Next.Type;
};
