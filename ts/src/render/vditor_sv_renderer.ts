// Ported from render/vditor_sv_renderer.go @ 8e7896b6
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
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import * as parse from "../parse/index.ts";
import { BaseRenderer } from "./types.ts";
import { headingLevel } from "./html_renderer.ts";
import { SubStr, nodeTokens } from "./renderer.ts";
import type { Options } from "./renderer.ts";
import { calloutEditableInfo } from "./callout.ts";
import { escapeSetextHeadingMarkersInListParagraph } from "./setext.ts";
// PORT-NOTE: these files only attach methods to BaseRenderer (see PORTING.md); importing them here makes sure the methods exist whenever this file is imported on its own.
import "./link.ts";
import "./term_typographer.ts";
import "./tabs.ts";

const emptyBytes: Uint8Array = new Uint8Array(0);
const newlineByte: Uint8Array = conv.BytesFromString("\n");
const backtickBytes: Uint8Array = conv.BytesFromString("`");
const spaceBytes: Uint8Array = conv.BytesFromString(" ");
const javascriptColon: Uint8Array = conv.BytesFromString("javascript:");
const paddingSpan: string = "<span data-type=\"padding\"></span>";

export const NewlineSV: Uint8Array = conv.BytesFromString("<span data-type=\"newline\"><br /><span style=\"display: none\">\n</span></span>");

// VditorSVRenderer describes the Vditor Split-View DOM renderer.
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance. The struct has its own field LastOut ([]byte) that
// shadows the embedded BaseRenderer.LastOut (a byte); both exist in Go and are used by different methods (the SV
// Write* methods and Newline use the SV one, the BaseRenderer methods the embedded one). TypeScript cannot redeclare
// a field with another type, so the SV field is named LastOutSV and BaseRenderer.LastOut stays the embedded one.
export class VditorSVRenderer extends BaseRenderer {
  nodeWriterStack: bytes.Buffer[]; // Node output buffer stack
  LastOutSV: Uint8Array; // The latest output, a few bytes of newline length (shadows the embedded LastOut in Go)

  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
    this.nodeWriterStack = [];
    this.LastOutSV = new Uint8Array(0); // nil
  }

  WriteByte(c: number): void {
    const r = this;
    r.Writer.WriteByte(c);
    r.LastOutSV = slices.AppendByte(r.LastOutSV, c);
    if (1024 < r.LastOutSV.length) {
      r.LastOutSV = r.LastOutSV.subarray(512);
    }
  }

  Write(content: Uint8Array): void {
    const r = this;
    const length = content.length;
    if (0 < length) {
      r.Writer.Write(content);
      r.LastOutSV = slices.Append(r.LastOutSV, content);
      if (1024 < r.LastOutSV.length) {
        r.LastOutSV = r.LastOutSV.subarray(512);
      }
    }
  }

  WriteString(content: string): void {
    const r = this;
    // PORT-NOTE: byte offset, the length is only tested against 0 here
    const length = content.length;
    if (0 < length) {
      r.Writer.WriteString(content);
      r.LastOutSV = slices.AppendString(r.LastOutSV, content);
      if (1024 < r.LastOutSV.length) {
        r.LastOutSV = r.LastOutSV.subarray(512);
      }
    }
  }

  Newline(): void {
    const r = this;
    if (!bytes.HasSuffix(r.LastOutSV, NewlineSV)) {
      r.Writer.Write(NewlineSV);
      r.LastOutSV = NewlineSV;
    }
  }

  // setLastOutSVFromCopy updates LastOutSV as Write(content) does, for a container close that used to write the parent buffer back
  // into itself through Write. The buffer itself is no longer copied.
  // PORT-NOTE: perf, departs from 1:1 (render/vditor_sv_renderer.go:881, 1091, 1131, 1266): Go and the first port rewrite the whole
  // parent buffer at every container close (Reset, then Write of the same bytes), which is quadratic in the number of list items.
  // Only LastOutSV is observable from that copy, and it is read only by HasSuffix(LastOutSV, NewlineSV) with NewlineSV of 75 bytes.
  // Up to 1024 bytes the new value is exact. Above that, Write keeps the last total-512 bytes of the stream and this keeps the last
  // 1024 bytes of the same stream; both hold at least 513 trailing bytes, so every later HasSuffix check gives the same answer.
  setLastOutSVFromCopy(content: Uint8Array): void {
    const r = this;
    const length = content.length;
    if (0 < length) {
      const prev = r.LastOutSV;
      if (prev.length + length <= 1024) {
        r.LastOutSV = slices.Append(prev, content);
      } else {
        const out = new Uint8Array(1024);
        const fromContent = Math.min(length, 1024);
        out.set(content.subarray(length - fromContent), 1024 - fromContent);
        if (fromContent < 1024) {
          out.set(prev.subarray(prev.length - (1024 - fromContent)), 0);
        }
        r.LastOutSV = out;
      }
    }
  }

  renderLinkRefDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderLinkRefDef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const dest = nodeTokens(node.FirstChild!.ChildByType(ast.NodeLinkDest)!);
      const destStr = conv.StringFromBytes(dest);
      r.Tag("span", [["class", "vditor-sv__marker--bracket"]], false);
      r.WriteByte(lex.ItemOpenBracket);
      r.Tag("/span", null, false);
      r.Tag("span", [["class", "vditor-sv__marker--link"], ["data-type", "link-ref-defs-block"]], false);
      r.Write(nodeTokens(node));
      r.Tag("/span", null, false);
      r.Tag("span", [["class", "vditor-sv__marker--bracket"]], false);
      r.WriteByte(lex.ItemCloseBracket);
      r.Tag("/span", null, false);
      r.WriteString("<span>:");
      if (editor.Caret !== destStr) {
        r.WriteString(" ");
      }
      r.WriteString("</span>");
      r.WriteString(destStr);
      r.Newline();
      r.Write(NewlineSV);
    }
    return ast.WalkSkipChildren;
  }

  renderKramdownBlockIAL(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      r.Tag("span", [["data-type", "kramdown-ial"], ["class", "vditor-sv__marker"]], false);
      r.Write(nodeTokens(node));
      r.Tag("/span", null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderMark(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      r.popWriteClass(node, "mark");
    }
    return ast.WalkContinue;
  }

  renderMark1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("=");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderMark1CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("=");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderMark2OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("==");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderMark2CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("==");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderSup(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      r.popWriteClass(node, "sup");
    }
    return ast.WalkContinue;
  }

  renderSupOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("^");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderSupCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("^");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderSub(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      r.popWriteClass(node, "sub");
    }
    return ast.WalkContinue;
  }

  renderSubOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("~");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderSubCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("~");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      r.Tag("span", [["data-type", "yaml-front-matter-close-marker"], ["class", "vditor-sv__marker"]], false);
      r.Write(parse.YamlFrontMatterMarker);
      r.Tag("/span", null, false);
      r.Newline();
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "text"]], false);
      let tokens = html.EscapeHTML(bytes.TrimSpace(nodeTokens(node)));
      const newline = slices.Append(conv.BytesFromString(paddingSpan), NewlineSV);
      tokens = bytes.ReplaceAll(tokens, newlineByte, newline);
      r.Write(tokens);
      r.WriteString("</span>");
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "yaml-front-matter-open-marker"], ["class", "vditor-sv__marker"]], false);
      r.Write(parse.YamlFrontMatterMarker);
      r.Tag("/span", null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatter(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderHtmlEntity(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--pre"], ["data-type", "html-entity"]], false);
      r.Write(html.EscapeHTML(node.HtmlEntityTokens));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderBackslashContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(html.EscapeHTML(nodeTokens(node)));
    }
    return ast.WalkContinue;
  }

  renderBackslash(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<span data-type=\"backslash\">");
      r.WriteString("<span class=\"vditor-sv__marker\">");
      r.WriteByte(lex.ItemBackslash);
      r.WriteString("</span>");
    } else {
      r.WriteString("</span>");
    }
    return ast.WalkContinue;
  }

  renderToC(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<span class=\"vditor-toc\" data-type=\"toc-block\" contenteditable=\"false\">");
      r.WriteString("[toc]");
      r.WriteString("</span>");
      r.Newline();
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderFootnotesDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderFootnotesDef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (r.RenderingFootnotes) {
        return ast.WalkContinue;
      }

      r.Tag("span", [["class", "vditor-sv__marker--bracket"]], false);
      r.WriteByte(lex.ItemOpenBracket);
      r.Tag("/span", null, false);
      r.Tag("span", [["class", "vditor-sv__marker--link"], ["data-type", "footnotes-link"]], false);
      r.Write(nodeTokens(node));
      r.Tag("/span", null, false);
      r.Tag("span", [["class", "vditor-sv__marker--bracket"]], false);
      r.WriteByte(lex.ItemCloseBracket);
      r.Tag("/span", null, false);
      r.WriteString("<span>: </span>");
      for (let c = node.FirstChild; null !== c; c = c.Next) {
        ast.Walk(c, (n: ast.Node, entering: boolean): ast.WalkStatus => {
          if (entering && n !== node.FirstChild && (n.IsBlock() || ast.NodeCodeBlockCode === n.Type || ast.NodeCodeBlockFenceCloseMarker === n.Type)) {
            const indentSpacesStr = "<span data-type=\"padding\">    </span>";
            if (ast.NodeCodeBlockFenceCloseMarker === n.Type) {
              n.Tokens = slices.Append(conv.BytesFromString(indentSpacesStr), nodeTokens(n));
            } else {
              r.WriteString(indentSpacesStr);
            }
          }
          return r.RendererFuncs.get(n.Type)!(n, entering); // PORT-NOTE: Go calls a nil function and panics when no renderer is registered; calling undefined throws here
        });
      }
      return ast.WalkSkipChildren;
    }
    return ast.WalkContinue;
  }

  renderFootnotesRef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    let previousNodeText = node.PreviousNodeText();
    previousNodeText = strings.ReplaceAll(previousNodeText, editor.Caret, "");
    const [, def] = r.Tree.FindFootnotesDef(nodeTokens(node));
    if (null === def) {
      return ast.WalkContinue;
    }
    const label = def.Text();
    // UPSTREAM-BUG: attrs (and previousNodeText above) is built but never used; the span below is written without these attributes
    const attrs: string[][] = [["data-type", "footnotes-ref"]];
    attrs.push(["class", "b3-tooltips b3-tooltips__s"]);
    attrs.push(["aria-label", SubStr(html.EscapeString(label), 24)]);
    attrs.push(["data-footnotes-label", conv.StringFromBytes(node.FootnotesRefLabel)]);
    r.Tag("span", [["class", "sup"]], false);
    r.Tag("span", [["class", "vditor-sv__marker--bracket"]], false);
    r.WriteByte(lex.ItemOpenBracket);
    r.Tag("/span", null, false);
    r.Tag("span", [["class", "vditor-sv__marker--link"]], false);
    r.Write(nodeTokens(node));
    r.Tag("/span", null, false);
    r.Tag("span", [["class", "vditor-sv__marker--bracket"]], false);
    r.WriteByte(lex.ItemCloseBracket);
    r.Tag("/span", null, false);
    r.Tag("/span", null, false);
    return ast.WalkContinue;
  }

  renderCodeBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      r.Tag("span", [["data-type", "code-block-close-marker"], ["class", "vditor-sv__marker"]], false);
      r.Write(nodeTokens(node));
      r.Tag("/span", null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderCodeBlockInfoMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--info"], ["data-type", "code-block-info"]], false);
      r.Write(node.CodeBlockInfo);
      r.Tag("/span", null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderCodeBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "code-block-open-marker"], ["class", "vditor-sv__marker"]], false);
      r.Write(nodeTokens(node));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (!node.IsFencedCodeBlock) {
        r.Tag("span", [["data-type", "code-block-open-marker"], ["class", "vditor-sv__marker"]], false);
        r.WriteString("```");
        r.Tag("/span", null, false);
        r.Newline();
      }
    } else {
      if (!node.IsFencedCodeBlock) {
        r.Newline();
        r.Tag("span", [["class", "vditor-sv__marker--info"], ["data-type", "code-block-info"]], false);
        r.WriteString("```");
        r.Tag("/span", null, false);
      }
      r.Newline();
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderCodeBlockCode(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "text"]], false);
      let tokens = html.EscapeHTML(bytes.TrimSpace(nodeTokens(node)));
      const newline = slices.Append(conv.BytesFromString(paddingSpan), NewlineSV);
      tokens = bytes.ReplaceAll(tokens, newlineByte, newline);
      r.Write(tokens);
      r.WriteString("</span>");
    }
    return ast.WalkContinue;
  }

  renderEmojiAlias(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(nodeTokens(node));
    }
    return ast.WalkContinue;
  }

  renderEmojiImg(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderEmojiUnicode(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderEmoji(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderInlineMathCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteByte(lex.ItemDollar);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderInlineMathContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const tokens = html.EscapeHTML(nodeTokens(node));
      r.Write(tokens);
      r.Tag("/code", null, false);
    }
    return ast.WalkContinue;
  }

  renderInlineMathOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteByte(lex.ItemDollar);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderInlineMath(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderMathBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      r.Tag("span", [["data-type", "math-block-close-marker"], ["class", "vditor-sv__marker"]], false);
      r.WriteString("$$");
      r.Tag("/span", null, false);
      r.Newline();
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderMathBlockContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "text"]], false);
      let tokens = html.EscapeHTML(bytes.TrimSpace(nodeTokens(node)));
      const newline = slices.Append(conv.BytesFromString(paddingSpan), NewlineSV);
      tokens = bytes.ReplaceAll(tokens, newlineByte, newline);
      r.Write(tokens);
      r.WriteString("</span>");
    }
    return ast.WalkContinue;
  }

  renderMathBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "math-block-open-marker"], ["class", "vditor-sv__marker"]], false);
      r.WriteString("$$");
      r.Tag("/span", null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderTableCell(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderTableRow(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderTableHead(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderTable(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "table"]], false);
      r.Write(nodeTokens(node));
      r.Newline();
      r.Write(NewlineSV);
      r.Tag("/span", null, false);
    }
    return ast.WalkSkipChildren; // Inline rendering inside tables is not supported
  }

  renderStrikethrough(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      r.popWriteClass(node, "s");
    }
    return ast.WalkContinue;
  }

  renderStrikethrough1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("~");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough1CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("~");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough2OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("~~");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough2CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("~~");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderLinkTitle(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (ast.NodeLink === node.Parent!.Type && 3 === node.Parent!.LinkType) {
        return ast.WalkContinue;
      }
      r.Tag("span", [["class", "vditor-sv__marker--title"]], false);
      r.WriteByte(lex.ItemDoublequote);
      r.Write(nodeTokens(node));
      r.WriteByte(lex.ItemDoublequote);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderLinkDest(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (ast.NodeLink === node.Parent!.Type && 3 === node.Parent!.LinkType) {
        return ast.WalkContinue;
      }
      r.Tag("span", [["class", "vditor-sv__marker--link"]], false);
      let dest = nodeTokens(node);
      if (r.Options.Sanitize) {
        let tokens = bytes.TrimSpace(dest);
        tokens = bytes.ToLower(tokens);
        if (bytes.HasPrefix(tokens, javascriptColon)) {
          dest = emptyBytes; // PORT-NOTE: Go sets nil, which behaves as empty
        }
      }
      dest = html.EscapeHTML(dest);
      r.Write(dest);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderLinkSpace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (ast.NodeLink === node.Parent!.Type && 3 === node.Parent!.LinkType) {
        return ast.WalkContinue;
      }
      r.WriteByte(lex.ItemSpace);
    }
    return ast.WalkContinue;
  }

  renderLinkText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (ast.NodeImage === node.Parent!.Type) {
        r.Tag("span", [["class", "vditor-sv__marker--bracket"]], false);
      } else {
        if (3 === node.Parent!.LinkType) {
          r.Tag("span", null, false);
        } else {
          r.Tag("span", [["class", "vditor-sv__marker--bracket"], ["data-type", "link-text"]], false);
        }
      }
      r.Write(nodeTokens(node));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCloseParen(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (ast.NodeLink === node.Parent!.Type && 3 === node.Parent!.LinkType) {
        return ast.WalkContinue;
      }
      r.Tag("span", [["class", "vditor-sv__marker--paren"]], false);
      r.WriteByte(lex.ItemCloseParen);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderOpenParen(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (ast.NodeLink === node.Parent!.Type && 3 === node.Parent!.LinkType) {
        return ast.WalkContinue;
      }

      r.Tag("span", [["class", "vditor-sv__marker--paren"]], false);
      r.WriteByte(lex.ItemOpenParen);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCloseBrace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (ast.NodeLink === node.Parent!.Type && 3 === node.Parent!.LinkType) {
        return ast.WalkContinue;
      }
      r.Tag("span", [["class", "vditor-sv__marker--brace"]], false);
      r.WriteByte(lex.ItemCloseBrace);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderOpenBrace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (ast.NodeLink === node.Parent!.Type && 3 === node.Parent!.LinkType) {
        return ast.WalkContinue;
      }

      r.Tag("span", [["class", "vditor-sv__marker--brace"]], false);
      r.WriteByte(lex.ItemOpenBrace);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCloseBracket(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bracket"]], false);
      r.WriteByte(lex.ItemCloseBracket);
      r.Tag("/span", null, false);

      if (3 === node.Parent!.LinkType) {
        const linkText = node.Parent!.ChildByType(ast.NodeLinkText);
        if (null === linkText || !bytes.EqualFold(node.Parent!.LinkRefLabel, nodeTokens(linkText))) {
          r.Tag("span", [["class", "vditor-sv__marker--link"]], false);
          r.WriteByte(lex.ItemOpenBracket);
          r.Write(node.Parent!.LinkRefLabel);
          r.WriteByte(lex.ItemCloseBracket);
          r.Tag("/span", null, false);
        }
      }
    }
    return ast.WalkContinue;
  }

  renderOpenBracket(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bracket"]], false);
      r.WriteByte(lex.ItemOpenBracket);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderBang(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteByte(lex.ItemBang);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderImage(node: ast.Node, entering: boolean): ast.WalkStatus {
    if (entering) {
      if (3 === node.LinkType) {
        node.ChildByType(ast.NodeOpenParen)!.Unlink();
        node.ChildByType(ast.NodeLinkDest)!.Unlink();
        const linkSpace = node.ChildByType(ast.NodeLinkSpace);
        if (null !== linkSpace) {
          linkSpace.Unlink();
          node.ChildByType(ast.NodeLinkTitle)!.Unlink();
        }
        node.ChildByType(ast.NodeCloseParen)!.Unlink();
      }
    }
    return ast.WalkContinue;
  }

  renderLink(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      let tokens = html.EscapeHTML(bytes.TrimSpace(nodeTokens(node)));
      const newline = slices.Append(conv.BytesFromString(paddingSpan), NewlineSV);
      tokens = bytes.ReplaceAll(tokens, newlineByte, newline);
      r.Write(tokens);
      r.WriteString("</span>");
      r.Newline();
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderInlineHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.Write(html.EscapeHTML(nodeTokens(node)));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderDocument(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      r.nodeWriterStack = r.nodeWriterStack.slice(0, r.nodeWriterStack.length - 1);
      // PORT-NOTE: perf, departs from 1:1 (render/vditor_sv_renderer.go:881): the trimmed text is moved to the start of the same
      // storage and the length is cut, instead of Reset and Write of the same bytes. The content is the same; LastOutSV as in Write.
      const all = r.Writer.Bytes();
      const buf = bytes.Trim(all, " \t\n");
      const lead = 0 < buf.length ? buf.byteOffset - all.byteOffset : 0;
      if (0 < lead) {
        all.copyWithin(0, lead, lead + buf.length);
      }
      r.Writer.Truncate(buf.length);
      r.setLastOutSVFromCopy(r.Writer.Bytes());
    }
    return ast.WalkContinue;
  }

  renderParagraph(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      r.Newline();
      const grandparent = node.Parent!.Parent;
      const inTightList = null !== grandparent && ast.NodeList === grandparent.Type && grandparent.ListData!.Tight;
      if (!inTightList) {
        // Outside a tight list a newline is output to separate the paragraphs
        r.Write(NewlineSV);
      }

      r.popWriter(node);
    }
    return ast.WalkContinue;
  }

  inListItem(node: ast.Node): boolean {
    const grandparent = node.Parent!.Parent;
    return null !== grandparent && ast.NodeList === grandparent.Type;
  }

  renderText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (node.ParentIs(ast.NodeTableCell)) {
      return ast.WalkContinue;
    }

    if (entering) {
      let tokens = nodeTokens(node);
      if (r.Options.FixTermTypo) {
        tokens = r.FixTermTypo(tokens);
      }
      tokens = escapeSetextHeadingMarkersInListParagraph(node, tokens);

      r.Tag("span", [["data-type", "text"]], false);
      tokens = bytes.TrimRight(tokens, "\n");
      r.Write(html.EscapeHTML(tokens));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCodeSpan(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderCodeSpanOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString(strings.Repeat("`", node.Parent!.CodeMarkerLen));
      if (bytes.HasPrefix(nodeTokens(node.Next!), backtickBytes)) {
        r.WriteByte(lex.ItemSpace);
      }
      r.Tag("/span", null, false);
      r.Tag("span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCodeSpanContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(html.EscapeHTML(nodeTokens(node)));
    }
    return ast.WalkContinue;
  }

  renderCodeSpanCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/span", null, false);
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      if (bytes.HasSuffix(nodeTokens(node.Previous!), backtickBytes)) {
        r.WriteByte(lex.ItemSpace);
      }
      r.WriteString(strings.Repeat("`", node.Parent!.CodeMarkerLen));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderEmphasis(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      r.popWriteClass(node, "em");
    }
    return ast.WalkContinue;
  }

  popWriteClass(node: ast.Node, clazz: string): void {
    const r = this;
    r.nodeWriterStack = r.nodeWriterStack.slice(0, r.nodeWriterStack.length - 1);
    r.renderClass(node, clazz);
    r.nodeWriterStack[r.nodeWriterStack.length - 1].Write(r.Writer.Bytes());
    r.Writer = r.nodeWriterStack[r.nodeWriterStack.length - 1];
  }

  popWriter(node: ast.Node): void {
    const r = this;
    r.nodeWriterStack = r.nodeWriterStack.slice(0, r.nodeWriterStack.length - 1);
    r.nodeWriterStack[r.nodeWriterStack.length - 1].Write(r.Writer.Bytes());
    r.Writer = r.nodeWriterStack[r.nodeWriterStack.length - 1];
  }

  renderEmAsteriskOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bi"]], false);
      r.WriteByte(lex.ItemAsterisk);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderEmAsteriskCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bi"]], false);
      r.WriteByte(lex.ItemAsterisk);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderEmUnderscoreOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bi"]], false);
      r.WriteByte(lex.ItemUnderscore);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderEmUnderscoreCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bi"]], false);
      r.WriteByte(lex.ItemUnderscore);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrong(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      r.popWriteClass(node, "strong");
    }
    return ast.WalkContinue;
  }

  renderStrongA6kOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bi"]], false);
      r.WriteString("**");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrongA6kCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bi"]], false);
      r.WriteString("**");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrongU8eOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bi"]], false);
      r.WriteString("__");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrongU8eCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker--bi"]], false);
      r.WriteString("__");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderBlockquote(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      const writer = r.nodeWriterStack[r.nodeWriterStack.length - 1];
      r.nodeWriterStack = r.nodeWriterStack.slice(0, r.nodeWriterStack.length - 1);

      let buf: Uint8Array = writer.Bytes();
      const marker: Uint8Array = conv.BytesFromString("<span data-type=\"blockquote-marker\" class=\"vditor-sv__marker\">&gt; </span>");
      buf = slices.Append(marker, buf);
      while (bytes.HasSuffix(buf, NewlineSV)) {
        buf = bytes.TrimSuffix(buf, NewlineSV);
      }
      buf = bytes.ReplaceAll(buf, NewlineSV, slices.Append(NewlineSV, marker));
      // PORT-NOTE: perf, departs from 1:1 (render/vditor_sv_renderer.go:1091 and 1131): the item is appended to the parent once, without
      // the self-copy of the parent buffer; see setLastOutSVFromCopy. The bytes of the parent are the same.
      r.nodeWriterStack[r.nodeWriterStack.length - 1].Write(buf);
      r.Writer = r.nodeWriterStack[r.nodeWriterStack.length - 1];
      r.setLastOutSVFromCopy(r.Writer.Bytes());
      r.Newline();
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderBlockquoteMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderCallout(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
      r.Tag("span", [["data-type", "text"], ["class", "vditor-sv__marker--callout"]], false);
      r.WriteString("[!" + html.EscapeHTMLStr(node.CalloutType) + "]");
      const title = calloutEditableInfo(node);
      if ("" !== title) {
        r.WriteByte(lex.ItemSpace);
        r.Write(html.EscapeHTML(conv.BytesFromString(title)));
      }
      r.Tag("/span", null, false);
      r.Newline();
    } else {
      const writer = r.nodeWriterStack[r.nodeWriterStack.length - 1];
      r.nodeWriterStack = r.nodeWriterStack.slice(0, r.nodeWriterStack.length - 1);

      let buf: Uint8Array = writer.Bytes();
      const marker: Uint8Array = conv.BytesFromString("<span data-type=\"blockquote-marker\" class=\"vditor-sv__marker\">&gt; </span>");
      buf = slices.Append(marker, buf);
      while (bytes.HasSuffix(buf, NewlineSV)) {
        buf = bytes.TrimSuffix(buf, NewlineSV);
      }
      buf = bytes.ReplaceAll(buf, NewlineSV, slices.Append(NewlineSV, marker));
      // PORT-NOTE: perf, departs from 1:1 (render/vditor_sv_renderer.go:1091 and 1131): the item is appended to the parent once, without
      // the self-copy of the parent buffer; see setLastOutSVFromCopy. The bytes of the parent are the same.
      r.nodeWriterStack[r.nodeWriterStack.length - 1].Write(buf);
      r.Writer = r.nodeWriterStack[r.nodeWriterStack.length - 1];
      r.setLastOutSVFromCopy(r.Writer.Bytes());
      r.Newline();
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderHeading(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);

      if (!node.HeadingSetext) {
        r.Tag("span", [["class", "vditor-sv__marker--heading"], ["data-type", "heading-marker"]], false);
        r.WriteString(strings.Repeat("#", node.HeadingLevel) + " ");
        r.Tag("/span", null, false);
      }
    } else {
      if (node.HeadingSetext) {
        r.Newline();
        r.Tag("span", [["class", "vditor-sv__marker--heading"], ["data-type", "heading-marker"]], false);
        const contentLen = r.setextHeadingLen(node);
        if (1 === node.HeadingLevel) {
          r.WriteString(strings.Repeat("=", contentLen));
        } else {
          r.WriteString(strings.Repeat("-", contentLen));
        }
        r.Tag("/span", null, false);
      }

      const clazz = "h" + headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1);
      r.renderClass(node, clazz);
      r.Newline();
      r.Write(NewlineSV);

      r.popWriter(node);
    }
    return ast.WalkContinue;
  }

  renderClass(node: ast.Node, clazz: string): void {
    const r = this;
    const buf = r.Writer.Bytes();
    const htmlRoot = new html.Node();
    htmlRoot.Type = html.ElementNode;
    const [nodes] = html.ParseFragment(buf, htmlRoot);
    r.Writer.Reset();
    for (let i = 0; i < nodes.length; i++) {
      const c = nodes[i];
      let clazzAttr = r.domAttrValue(c, "class");
      if ("" === clazzAttr) {
        clazzAttr = clazz;
      } else {
        clazzAttr += " " + clazz;
      }
      r.domSetAttrValue(c, "class", clazzAttr);
      html.Render(r.Writer, c);
    }
  }

  domAttrValue(n: html.Node | null, attrName: string): string {
    if (null === n) {
      return "";
    }

    for (const attr of n.Attr) {
      if (attr.Key === attrName) {
        return attr.Val;
      }
    }
    return "";
  }

  domSetAttrValue(n: html.Node | null, attrName: string, attrVal: string): void {
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
  }

  renderHeadingC8hMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderHeadingID(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString(" {" + conv.StringFromBytes(nodeTokens(node)) + "}");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderList(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderListItem(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Writer = new bytes.Buffer();
      r.nodeWriterStack.push(r.Writer);
    } else {
      const writer = r.nodeWriterStack[r.nodeWriterStack.length - 1];
      r.nodeWriterStack = r.nodeWriterStack.slice(0, r.nodeWriterStack.length - 1);

      const listData = node.ListData!;
      let buf: Uint8Array = writer.Bytes();
      let markerStr = "";
      if (1 === listData.Typ || (3 === listData.Typ && 0 === listData.BulletChar)) {
        markerStr = strconv.Itoa(listData.Num) + conv.StringFromRune(listData.Delimiter);
      } else {
        markerStr = conv.StringFromBytes(listData.Marker);
      }
      const marker: Uint8Array = conv.BytesFromString("<span data-type=\"li-marker\" class=\"vditor-sv__marker\">" + markerStr + " </span>");
      buf = slices.Append(marker, buf);
      while (bytes.HasSuffix(buf, NewlineSV)) {
        buf = bytes.TrimSuffix(buf, NewlineSV);
      }
      const padding: Uint8Array = conv.BytesFromString("<span data-type=\"padding\">" + strings.Repeat(" ", listData.Padding) + "</span>");
      buf = bytes.ReplaceAll(buf, NewlineSV, slices.Append(NewlineSV, padding));
      // PORT-NOTE: perf, departs from 1:1 (render/vditor_sv_renderer.go:1266): the item is appended to the parent once, without the
      // self-copy of the parent buffer, which made list rendering quadratic; see setLastOutSVFromCopy. The bytes of the parent are the same.
      r.nodeWriterStack[r.nodeWriterStack.length - 1].Write(buf);
      r.Writer = r.nodeWriterStack[r.nodeWriterStack.length - 1];
      r.setLastOutSVFromCopy(r.Writer.Bytes());
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderTaskListItemMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    const marker = node.EffectiveTaskListItemMarker();
    r.Tag("span", [["data-type", "task-marker"], ["class", "vditor-sv__marker--bi"]], false);
    r.WriteByte(lex.ItemOpenBracket);
    r.Tag("/span", null, false);
    if (node.TaskListItemChecked) {
      r.Tag("span", [["data-type", "task-marker"], ["class", "vditor-sv__marker--strong"]], false);
      r.WriteString(marker);
      r.Tag("/span", null, false);
    } else {
      r.Tag("span", [["data-type", "task-marker"], ["class", "vditor-sv__marker--bi"]], false);
      r.WriteString(marker);
      r.Tag("/span", null, false);
    }
    r.Tag("span", [["data-type", "task-marker"], ["class", "vditor-sv__marker--bi"]], false);
    r.WriteString("] ");
    r.Tag("/span", null, false);
    node.Next!.Tokens = slices.KeepNil(node.Next!.Tokens, (t: Uint8Array): Uint8Array => bytes.TrimPrefix(t, spaceBytes));
    return ast.WalkContinue;
  }

  renderThematicBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-sv__marker"]], false);
      r.WriteString("***");
      r.Tag("/span", null, false);
      r.Newline();
      r.Write(NewlineSV);
    }
    return ast.WalkContinue;
  }

  renderHardBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderSoftBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
    }
    return ast.WalkContinue;
  }

  Text(node: ast.Node): string {
    let ret = "";
    ast.Walk(node, (n: ast.Node, entering: boolean): ast.WalkStatus => {
      if (entering) {
        switch (n.Type) {
          case ast.NodeText:
          case ast.NodeLinkText:
          case ast.NodeLinkDest:
          case ast.NodeLinkTitle:
          case ast.NodeCodeBlockCode:
          case ast.NodeCodeSpanContent:
          case ast.NodeInlineMathContent:
          case ast.NodeMathBlockContent:
          case ast.NodeHTMLBlock:
          case ast.NodeInlineHTML:
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
  }
}

// NewVditorSVRenderer creates a Vditor Split-View DOM renderer.
export function NewVditorSVRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): VditorSVRenderer {
  const ret = new VditorSVRenderer(tree, options, parseOptions);
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
  ret.RendererFuncs.set(ast.NodeCallout, ret.renderCallout.bind(ret));
  ret.RendererFuncs.set(ast.NodeTabs, ret.renderTabsHTML.bind(ret));
  ret.RendererFuncs.set(ast.NodeTabItem, ret.renderTabsHTML.bind(ret));
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
  ret.RendererFuncs.set(ast.NodeLinkRefDefBlock, ret.renderLinkRefDefBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeLinkRefDef, ret.renderLinkRefDef.bind(ret));
  return ret;
}
