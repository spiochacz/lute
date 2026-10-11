// Ported from render/echarts_json_renderer.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import * as parse from "../parse/index.ts";
import * as util from "../util/index.ts";
import { BaseRenderer } from "./types.ts";
import { headingLevel } from "./html_renderer.ts";
import { nodeTokens } from "./renderer.ts";
import type { Options, Renderer } from "./renderer.ts";

// EChartsJSONRenderer describes the ECharts JSON renderer.
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance. The methods renderDefault and renderToC are also defined by BaseRenderer;
// no BaseRenderer method calls them in a way that would change the output (Render calls renderDefault only when DefaultRendererFunc is null, and it is set below).
export class EChartsJSONRenderer extends BaseRenderer {
  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
  }

  renderKramdownBlockIAL(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (null === node.Previous) {
        return ast.WalkContinue;
      }
      let id = r.NodeID(node.Previous);
      if (util.IsDocIAL(nodeTokens(node))) {
        id = r.Tree.ID;
      }
      r.leaf("Block IAL\n{: " + id + "}", node);
    }
    return ast.WalkContinue;
  }

  renderKramdownSpanIAL(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (null === node.Previous) {
        return ast.WalkContinue;
      }
      const id = r.NodeID(node.Previous);
      r.leaf("Span IAL\n{: " + id + "}", node);
    }
    return ast.WalkContinue;
  }

  renderMark(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Mark\nmark", node);
    }
    return ast.WalkSkipChildren;
  }

  renderSup(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Sup\nsup", node);
    }
    return ast.WalkSkipChildren;
  }

  renderSub(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Sub\nsub", node);
    }
    return ast.WalkSkipChildren;
  }

  renderBlockQueryEmbed(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("BlockQueryEmbed\n{{script}}", node);
    }
    return ast.WalkSkipChildren;
  }

  renderBlockRef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("BlockRef\n((id))", node);
    }
    return ast.WalkSkipChildren;
  }

  renderFileAnnotationRef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("FileAnnotationRef\n<<id>>", node);
    }
    return ast.WalkSkipChildren;
  }

  renderDefault(n: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderYamlFrontMatter(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Front Matter\nYAML", node);
    }
    return ast.WalkSkipChildren;
  }

  renderHtmlEntity(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("HTML Entity\nspan", node);
    }
    return ast.WalkSkipChildren;
  }

  renderBackslashContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkSkipChildren;
  }

  renderBackslash(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Blackslash\ndiv", node);
    }
    return ast.WalkSkipChildren;
  }

  renderToC(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("ToC\ndiv", node);
    }
    return ast.WalkSkipChildren;
  }

  renderFootnotesRef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Footnotes Ref\ndiv", node);
    }
    return ast.WalkSkipChildren;
  }

  renderFootnotesDef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.val("Footnotes Def\np", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderInlineMath(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Inline Math\nspan", node);
    }
    return ast.WalkSkipChildren;
  }

  renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Math Block\ndiv", node);
    }
    return ast.WalkSkipChildren;
  }

  renderEmojiImg(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Emoji Img\n", node);
    }
    return ast.WalkSkipChildren;
  }

  renderEmojiUnicode(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Emoji Unicode\n", node);
    }
    return ast.WalkSkipChildren;
  }

  renderEmojiAlias(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkSkipChildren;
  }

  renderEmoji(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderTableCell(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Table Cell\ntd", node);
    }
    return ast.WalkSkipChildren;
  }

  renderTableRow(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Table Row\ntr", node);
    }
    return ast.WalkSkipChildren;
  }

  renderTableHead(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Table Head\nthead", node);
    }
    return ast.WalkSkipChildren;
  }

  renderTable(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.val("Table\ntable", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Strikethrough\ndel", node);
    }
    return ast.WalkSkipChildren;
  }

  renderImage(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.val("Image\nimg", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderLink(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.val("Link\na", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("HTML Block\n", node);
    }
    return ast.WalkSkipChildren;
  }

  renderInlineHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Inline HTML\n", node);
    }
    return ast.WalkSkipChildren;
  }

  renderDocument(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteByte(lex.ItemOpenBracket);
      r.openObj();
      r.val("Document", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
      r.WriteByte(lex.ItemCloseBracket);
    }
    return ast.WalkContinue;
  }

  renderParagraph(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.val("Paragraph\np", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const text = util.BytesToStr(nodeTokens(node));
      let i = 0;
      let summary = "";
      for (const rn of text) { // PORT-NOTE: iterates code points like Go's range over a string; the loop variable is renamed because it shadows the receiver r in Go
        i++;
        summary += rn;
        if (4 < i) {
          summary += "...";
          break;
        }
      }
      r.openObj();
      r.val("Text\n"+summary, node);
      r.closeObj(node);
    }
    return ast.WalkSkipChildren;
  }

  renderCodeSpan(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Code Span\ncode", node);
    }
    return ast.WalkContinue;
  }

  renderEmphasis(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.val("Emphasis\nem", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderStrong(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.val("Strong\nstrong", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderBlockquote(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.val("Blockquote\nblockquote", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderHeading(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      const h = "h" + headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1);
      r.val("Heading\n"+h, node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderList(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      let list = "ul";
      if (1 === node.ListData!.Typ || (3 === node.ListData!.Typ && 0 === node.ListData!.BulletChar)) {
        list = "ol";
      }
      r.val("List\n"+list, node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderListItem(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.val("List Item\nli "+util.BytesToStr(node.ListData!.Marker), node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderTaskListItemMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      const marker = node.EffectiveTaskListItemMarker();
      r.val("Task List Item Marker\n["+marker+"]", node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj(node);
    }
    return ast.WalkContinue;
  }

  renderThematicBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Thematic Break\nhr", node);
    }
    return ast.WalkSkipChildren;
  }

  renderHardBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Hard Break\nbr", node);
    }
    return ast.WalkSkipChildren;
  }

  renderSoftBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Soft Break\n", node);
    }
    return ast.WalkSkipChildren;
  }

  renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.leaf("Code Block\npre.code", node);
    }
    return ast.WalkSkipChildren;
  }

  leaf(val: string, node: ast.Node): void {
    const r = this;
    r.openObj();
    r.val(val, node);
    r.closeObj(node);
  }

  val(val: string, node: ast.Node): void {
    const r = this;
    val = strings.ReplaceAll(val, "\\", "\\\\");
    val = strings.ReplaceAll(val, "\n", "\\n");
    val = strings.ReplaceAll(val, "\"", "");
    val = strings.ReplaceAll(val, "'", "");
    r.WriteString("\"name\":\"" + val + "\"");
  }

  openObj(): void {
    const r = this;
    r.WriteByte(0x7b /* { */);
  }

  closeObj(node: ast.Node): void {
    const r = this;
    r.WriteByte(0x7d /* } */);
    if (!r.ignore(node.Next)) {
      r.comma();
    }
  }

  openChildren(node: ast.Node): void {
    const r = this;
    if (null !== node.FirstChild) {
      r.WriteString(",\"children\":[");
    }
  }

  closeChildren(node: ast.Node): void {
    const r = this;
    if (null !== node.FirstChild) {
      r.WriteByte(0x5d /* ] */);
    }
  }

  comma(): void {
    const r = this;
    r.WriteString(",");
  }

  ignore(node: ast.Node | null): boolean {
    const r = this;
    return null === node ||
      // 以下类型的节点不进行渲染，否则图画出来节点太多;
      ast.NodeBlockquoteMarker === node.Type ||
      ast.NodeEmA6kOpenMarker === node.Type || ast.NodeEmA6kCloseMarker === node.Type ||
      ast.NodeEmU8eOpenMarker === node.Type || ast.NodeEmU8eCloseMarker === node.Type ||
      ast.NodeStrongA6kOpenMarker === node.Type || ast.NodeStrongA6kCloseMarker === node.Type ||
      ast.NodeStrongU8eOpenMarker === node.Type || ast.NodeStrongU8eCloseMarker === node.Type ||
      ast.NodeStrikethrough1OpenMarker === node.Type || ast.NodeStrikethrough1CloseMarker === node.Type ||
      ast.NodeStrikethrough2OpenMarker === node.Type || ast.NodeStrikethrough2CloseMarker === node.Type ||
      ast.NodeMathBlockOpenMarker === node.Type || ast.NodeMathBlockContent === node.Type || ast.NodeMathBlockCloseMarker === node.Type ||
      ast.NodeInlineMathOpenMarker === node.Type || ast.NodeInlineMathContent === node.Type || ast.NodeInlineMathCloseMarker === node.Type ||
      ast.NodeYamlFrontMatterOpenMarker === node.Type || ast.NodeYamlFrontMatterCloseMarker === node.Type || ast.NodeYamlFrontMatterContent === node.Type;
  }
}

// NewEChartsJSONRenderer creates an ECharts JSON renderer.
export function NewEChartsJSONRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): Renderer {
  const ret = new EChartsJSONRenderer(tree, options, parseOptions);
  ret.RendererFuncs.set(ast.NodeDocument, ret.renderDocument.bind(ret));
  ret.RendererFuncs.set(ast.NodeParagraph, ret.renderParagraph.bind(ret));
  ret.RendererFuncs.set(ast.NodeText, ret.renderText.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeSpan, ret.renderCodeSpan.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeBlock, ret.renderCodeBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeMathBlock, ret.renderMathBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeInlineMath, ret.renderInlineMath.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmphasis, ret.renderEmphasis.bind(ret));
  ret.RendererFuncs.set(ast.NodeStrong, ret.renderStrong.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockquote, ret.renderBlockquote.bind(ret));
  ret.RendererFuncs.set(ast.NodeHeading, ret.renderHeading.bind(ret));
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
  ret.RendererFuncs.set(ast.NodeStrikethrough, ret.renderStrikethrough.bind(ret));
  ret.RendererFuncs.set(ast.NodeTaskListItemMarker, ret.renderTaskListItemMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeTable, ret.renderTable.bind(ret));
  ret.RendererFuncs.set(ast.NodeTableHead, ret.renderTableHead.bind(ret));
  ret.RendererFuncs.set(ast.NodeTableRow, ret.renderTableRow.bind(ret));
  ret.RendererFuncs.set(ast.NodeTableCell, ret.renderTableCell.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmoji, ret.renderEmoji.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmojiUnicode, ret.renderEmojiUnicode.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmojiImg, ret.renderEmojiImg.bind(ret));
  ret.RendererFuncs.set(ast.NodeEmojiAlias, ret.renderEmojiAlias.bind(ret));
  ret.RendererFuncs.set(ast.NodeFootnotesDef, ret.renderFootnotesDef.bind(ret));
  ret.RendererFuncs.set(ast.NodeFootnotesRef, ret.renderFootnotesRef.bind(ret));
  ret.RendererFuncs.set(ast.NodeToC, ret.renderToC.bind(ret));
  ret.RendererFuncs.set(ast.NodeBackslash, ret.renderBackslash.bind(ret));
  ret.RendererFuncs.set(ast.NodeBackslashContent, ret.renderBackslashContent.bind(ret));
  ret.RendererFuncs.set(ast.NodeHTMLEntity, ret.renderHtmlEntity.bind(ret));
  ret.RendererFuncs.set(ast.NodeYamlFrontMatter, ret.renderYamlFrontMatter.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockRef, ret.renderBlockRef.bind(ret));
  ret.RendererFuncs.set(ast.NodeFileAnnotationRef, ret.renderFileAnnotationRef.bind(ret));
  ret.RendererFuncs.set(ast.NodeMark, ret.renderMark.bind(ret));
  ret.RendererFuncs.set(ast.NodeSup, ret.renderSup.bind(ret));
  ret.RendererFuncs.set(ast.NodeSub, ret.renderSub.bind(ret));
  ret.RendererFuncs.set(ast.NodeKramdownBlockIAL, ret.renderKramdownBlockIAL.bind(ret));
  ret.RendererFuncs.set(ast.NodeKramdownSpanIAL, ret.renderKramdownSpanIAL.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockQueryEmbed, ret.renderBlockQueryEmbed.bind(ret));
  ret.DefaultRendererFunc = ret.renderDefault.bind(ret);
  return ret;
}
