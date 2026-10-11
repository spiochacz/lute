// Ported from render/vditor_ir_renderer.go @ 8e7896b6
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
import * as util from "../util/index.ts";
import { BaseRenderer } from "./types.ts";
import { headingLevel } from "./html_renderer.ts";
import { HeadingID, NoHighlight, SubStr, nodeTokens } from "./renderer.ts";
import type { Options } from "./renderer.ts";
import { calloutDisplayTitle, calloutEditableIcon, calloutInlineTree } from "./callout.ts";
import { EChartsMindmap } from "./mindmap.ts";
import { sanitize } from "./sanitizer.ts";
// PORT-NOTE: these files only attach methods to BaseRenderer (see PORTING.md); importing them here makes sure the methods exist whenever this file is imported on its own.
import "./link.ts";
import "./term_typographer.ts";
import "./tabs.ts";

const emptyBytes: Uint8Array = new Uint8Array(0);
const caretZwsp: Uint8Array = conv.BytesFromString(editor.Caret + editor.Zwsp);
const zwspBytes: Uint8Array = conv.BytesFromString(editor.Zwsp);
const escapedPipeBytes: Uint8Array = conv.BytesFromString("\\|");
const pipeBytes: Uint8Array = conv.BytesFromString("|");
const imgSrcOpen: Uint8Array = conv.BytesFromString("<img src=");
const javascriptColon: Uint8Array = conv.BytesFromString("javascript:");
const backtickBytes: Uint8Array = conv.BytesFromString("`");
const kbdOpen: Uint8Array = conv.BytesFromString("<kbd>");
const kbdClose: Uint8Array = conv.BytesFromString("</kbd>");
const brTag1: Uint8Array = conv.BytesFromString("<br>");
const brTag2: Uint8Array = conv.BytesFromString("<br/>");
const brTag3: Uint8Array = conv.BytesFromString("<br />");

// VditorIRRenderer describes the Vditor Instant-Rendering DOM renderer.
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance.
export class VditorIRRenderer extends BaseRenderer {
  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
  }

  renderLinkRefDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<div data-block=\"0\" data-type=\"link-ref-defs-block\">");
    } else {
      r.WriteString("</div>");
    }
    return ast.WalkContinue;
  }

  renderLinkRefDef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const dest = nodeTokens(node.FirstChild!.ChildByType(ast.NodeLinkDest)!);
      const destStr = util.BytesToStr(dest);
      r.WriteString("[" + util.BytesToStr(nodeTokens(node)) + "]:");
      if (editor.Caret !== destStr) {
        r.WriteString(" ");
      }
      r.WriteString(destStr + "\n");
    }
    return ast.WalkSkipChildren;
  }

  renderKramdownBlockIAL(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderMark(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderSpanNode(node);
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderMark1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("=");
      r.Tag("/span", null, false);
      r.Tag("mark", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderMark1CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/mark", null, false);
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("=");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderMark2OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("==");
      r.Tag("/span", null, false);
      r.Tag("mark", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderMark2CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/mark", null, false);
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("==");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderSup(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderSpanNode(node);
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderSupOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("^");
      r.Tag("/span", null, false);
      r.Tag("sup", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderSupCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/sup", null, false);
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("^");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderSub(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderSpanNode(node);
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderSubOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("~");
      r.Tag("/span", null, false);
      r.Tag("sub", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderSubCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/sub", null, false);
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("~");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "yaml-front-matter-close-marker"]], false);
      r.Write(parse.YamlFrontMatterMarker);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      node.Tokens = slices.NilIfEmpty(bytes.TrimSpace(nodeTokens(node)));
      const codeLen = nodeTokens(node).length;
      const codeIsEmpty = 1 > codeLen || (editor.CaretTokens.length === codeLen && editor.Caret === util.BytesToStr(nodeTokens(node)));
      r.Tag("pre", [["class", "vditor-ir__marker--pre"]], false);
      r.Tag("code", [["data-type", "yaml-front-matter"], ["class", "language-yaml"]], false);
      if (codeIsEmpty) {
        r.WriteString(editor.FrontEndCaret + "\n");
      } else {
        r.Write(html.EscapeHTML(nodeTokens(node)));
      }
      r.WriteString("</code></pre>");
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "yaml-front-matter-open-marker"]], false);
      r.Write(parse.YamlFrontMatterMarker);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatter(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderDivNode(node);
    } else {
      r.WriteString("</div>");
    }
    return ast.WalkContinue;
  }

  renderHtmlEntity(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderSpanNode(node);
      r.Tag("code", [["data-newline", "1"], ["class", "vditor-ir__marker vditor-ir__marker--pre"], ["data-type", "html-entity"]], false);
      r.Write(html.EscapeHTML(node.HtmlEntityTokens));
      r.Tag("/code", null, false);
      r.Tag("span", [["class", "vditor-ir__preview"], ["data-render", "2"]], false);
      r.Tag("code", null, false);
      r.Write(node.HtmlEntityTokens);
      r.Tag("/code", null, false);
      r.Tag("/span", null, false);
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
      r.renderSpanNode(node);
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bi"]], false);
      r.WriteByte(lex.ItemBackslash);
      r.WriteString("</span>");
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderToC(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return BaseRenderer.prototype.renderToC.call(r, node, entering); // PORT-NOTE: Go embedding, r.BaseRenderer.renderToC
  }

  renderFootnotesDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<div data-block=\"0\" data-type=\"footnotes-block\">");
    } else {
      r.WriteString("</div>");
    }
    return ast.WalkContinue;
  }

  renderFootnotesDef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (r.RenderingFootnotes) {
        return ast.WalkContinue;
      }

      r.WriteString("<div data-type=\"footnotes-def\">");
      r.WriteString("[" + conv.StringFromBytes(nodeTokens(node)) + "]: ");
      for (let c = node.FirstChild; null !== c; c = c.Next) {
        ast.Walk(c, (n: ast.Node, entering: boolean): ast.WalkStatus => {
          return r.RendererFuncs.get(n.Type)!(n, entering); // PORT-NOTE: Go calls a nil function and panics when no renderer is registered; calling undefined throws here
        });
      }
      r.WriteString("</div>");
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
    if ("" === previousNodeText) {
      r.WriteString(editor.Zwsp);
    }
    const [idx, def] = r.Tree.FindFootnotesDef(nodeTokens(node));
    if (null === def) {
      return ast.WalkContinue;
    }
    const idxStr = strconv.Itoa(idx);
    const label = def.Text();
    const attrs: string[][] = [["data-type", "footnotes-ref"]];
    const text = node.Text();
    const expand = strings.Contains(text, editor.Caret);
    if (expand) {
      attrs.push(["class", "vditor-ir__node vditor-ir__node--expand vditor-tooltipped vditor-tooltipped__s"]);
    } else {
      attrs.push(["class", "vditor-ir__node vditor-tooltipped vditor-tooltipped__s"]);
    }
    attrs.push(["aria-label", SubStr(html.EscapeString(label), 24)]);
    attrs.push(["data-footnotes-label", conv.StringFromBytes(node.FootnotesRefLabel)]);
    r.Tag("sup", attrs, false);
    r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bracket"]], false);
    r.WriteByte(lex.ItemOpenBracket);
    r.Tag("/span", null, false);
    r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--link"]], false);
    r.Write(nodeTokens(node));
    r.Tag("/span", null, false);
    r.Tag("span", [["class", "vditor-ir__marker--hide"], ["data-render", "1"]], false);
    r.WriteString(idxStr);
    r.Tag("/span", null, false);
    r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bracket"]], false);
    r.WriteByte(lex.ItemCloseBracket);
    r.Tag("/span", null, false);
    r.WriteString("</sup>" + editor.Zwsp);
    return ast.WalkContinue;
  }

  renderCodeBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "code-block-close-marker"]], false);
      r.Write(nodeTokens(node));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCodeBlockInfoMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--info"], ["data-type", "code-block-info"]], false);
      r.WriteString(editor.Zwsp);
      r.Write(node.CodeBlockInfo);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCodeBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "code-block-open-marker"]], false);
      r.Write(nodeTokens(node));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderDivNode(node);
    } else {
      r.WriteString("</div>");
    }
    return ast.WalkContinue;
  }

  renderCodeBlockCode(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    const codeLen = nodeTokens(node).length;
    const codeIsEmpty = 1 > codeLen || (editor.CaretTokens.length === codeLen && editor.Caret === util.BytesToStr(nodeTokens(node)));
    const isFenced = node.Parent!.IsFencedCodeBlock;
    let caretInInfo = false;
    let language = "";
    if (isFenced) {
      caretInInfo = bytes.Contains(node.Previous!.CodeBlockInfo, editor.CaretTokens);
      node.Previous!.CodeBlockInfo = bytes.ReplaceAll(node.Previous!.CodeBlockInfo, editor.CaretTokens, emptyBytes);
    }
    const attrs: string[][] = [];
    if (isFenced && 0 < node.Previous!.CodeBlockInfo.length) {
      const infoWords = lex.Split(node.Previous!.CodeBlockInfo, lex.ItemSpace);
      language = conv.StringFromBytes(infoWords[0]);
      attrs.push(["class", "language-" + language]);
      if ("mindmap" === language) {
        const dataCode = EChartsMindmap(nodeTokens(node));
        attrs.push(["data-code", conv.StringFromBytes(dataCode)]);
      }
    }

    let clazz = "vditor-ir__marker--pre";
    if (r.Options.VditorCodeBlockPreview) {
      clazz += " vditor-ir__marker";
    }
    r.Tag("pre", [["class", clazz]], false);
    r.Tag("code", attrs, false);
    if (codeIsEmpty) {
      if (!caretInInfo) {
        r.WriteString(editor.FrontEndCaret);
      }
      r.WriteByte(lex.ItemNewline);
    } else {
      r.Write(html.EscapeHTML(nodeTokens(node)));
      r.Newline();
    }
    r.WriteString("</code></pre>");

    if (r.Options.VditorCodeBlockPreview) {
      r.Tag("pre", [["class", "vditor-ir__preview"], ["data-render", "2"]], false);
      const preDiv = NoHighlight(language);
      if (preDiv) {
        r.Tag("div", attrs, false);
      } else {
        r.Tag("code", attrs, false);
      }
      let tokens = nodeTokens(node);
      tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
      r.Write(html.EscapeHTML(tokens));
      if (preDiv) {
        r.WriteString("</div></pre>");
      } else {
        r.WriteString("</code></pre>");
      }
    }
    return ast.WalkContinue;
  }

  renderEmojiAlias(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderEmojiImg(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<span data-render=\"2\">");
      r.Write(nodeTokens(node));
      r.WriteString("</span>");
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.Write(nodeTokens(node.FirstChild!));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderEmojiUnicode(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<span data-render=\"2\">");
      r.Write(nodeTokens(node));
      r.WriteString("</span>");
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.Write(nodeTokens(node.FirstChild!));
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderEmoji(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let previousNodeText = node.PreviousNodeText();
      previousNodeText = strings.ReplaceAll(previousNodeText, editor.Caret, "");
      if ("" === previousNodeText) {
        r.WriteString(editor.Zwsp);
      }
      r.renderSpanNode(node);
    } else {
      r.WriteString("</span>");
    }
    return ast.WalkContinue;
  }

  renderInlineMathCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteByte(lex.ItemDollar);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderInlineMathContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let tokens = nodeTokens(node);
      tokens = html.EscapeHTML(tokens);
      r.Write(tokens);
      r.Tag("/code", null, false);
      r.Tag("span", [["class", "vditor-ir__preview"], ["data-render", "2"]], false);
      r.Tag("span", [["class", "language-math"]], false);
      tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
      if (node.ParentIs(ast.NodeTableCell)) {
        // Improve the `|` render in the inline math in the table https://github.com/Vanessa219/vditor/issues/1550
        tokens = bytes.ReplaceAll(tokens, escapedPipeBytes, pipeBytes);
      }
      r.Write(tokens);
      r.Tag("/span", null, false);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderInlineMathOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteByte(lex.ItemDollar);
      r.Tag("/span", null, false);
      r.Tag("code", [["data-newline", "1"], ["class", "vditor-ir__marker vditor-ir__marker--pre"], ["data-type", "math-inline"]], false);
    }
    return ast.WalkContinue;
  }

  renderInlineMath(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderSpanNode(node);
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderMathBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "math-block-close-marker"]], false);
      r.Write(parse.MathBlockMarker);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderMathBlockContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    node.Tokens = slices.NilIfEmpty(bytes.TrimSpace(nodeTokens(node)));
    const codeLen = nodeTokens(node).length;
    const codeIsEmpty = 1 > codeLen || (editor.CaretTokens.length === codeLen && editor.Caret === util.BytesToStr(nodeTokens(node)));
    let clazz = "vditor-ir__marker--pre";
    if (r.Options.VditorMathBlockPreview) {
      clazz += " vditor-ir__marker";
    }
    r.Tag("pre", [["class", clazz]], false);
    r.Tag("code", [["data-type", "math-block"], ["class", "language-math"]], false);
    if (codeIsEmpty) {
      r.WriteString(editor.FrontEndCaret + "\n");
    } else {
      r.Write(html.EscapeHTML(nodeTokens(node)));
    }
    r.WriteString("</code></pre>");

    if (r.Options.VditorMathBlockPreview) {
      r.Tag("pre", [["class", "vditor-ir__preview"], ["data-render", "2"]], false);
      r.Tag("div", [["data-type", "math-block"], ["class", "language-math"]], false);
      let tokens = nodeTokens(node);
      tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
      r.Write(html.EscapeHTML(tokens));
      r.WriteString("</div></pre>");
    }
    return ast.WalkContinue;
  }

  renderMathBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "math-block-open-marker"]], false);
      r.Write(parse.MathBlockMarker);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderDivNode(node);
    } else {
      r.WriteString("</div>");
    }
    return ast.WalkContinue;
  }

  renderTableCell(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    let tag = "td";
    if (ast.NodeTableHead === node.Parent!.Parent!.Type) {
      tag = "th";
    }
    if (entering) {
      const attrs: string[][] = [];
      switch (node.TableCellAlign) {
        case 1:
          attrs.push(["align", "left"]);
          break;
        case 2:
          attrs.push(["align", "center"]);
          break;
        case 3:
          attrs.push(["align", "right"]);
          break;
      }
      r.Tag(tag, attrs, false);
      if (null === node.FirstChild) {
        node.AppendChild(new ast.Node(ast.NodeText, conv.BytesFromString(" ")));
      } else if (bytes.Equal(nodeTokens(node.FirstChild), editor.CaretTokens)) {
        node.FirstChild.Tokens = conv.BytesFromString(editor.Caret + " ");
      }
    } else {
      r.Tag("/" + tag, null, false);
    }
    return ast.WalkContinue;
  }

  renderTableRow(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("tr", null, false);
    } else {
      r.Tag("/tr", null, false);
    }
    return ast.WalkContinue;
  }

  renderTableHead(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("thead", null, false);
    } else {
      r.Tag("/thead", null, false);
      if (null !== node.Next) {
        r.Tag("tbody", null, false);
      }
    }
    return ast.WalkContinue;
  }

  renderTable(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("table", [["data-block", "0"], ["data-type", "table"]], false);
    } else {
      if (null !== node.FirstChild!.Next) {
        r.Tag("/tbody", null, false);
      }
      r.Tag("/table", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderSpanNode(node);
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("~");
      r.Tag("/span", null, false);
      r.Tag("s", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough1CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/s", null, false);
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("~");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough2OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("~~");
      r.Tag("/span", null, false);
      r.Tag("s", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough2CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/s", null, false);
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
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

      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--title"]], false);
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

      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--link"]], false);
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
        r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bracket"]], false);
      } else {
        if (3 === node.Parent!.LinkType) {
          r.Tag("span", null, false);
        } else {
          r.Tag("span", [["class", "vditor-ir__link"]], false);
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

      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--paren"]], false);
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

      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--paren"]], false);
      r.WriteByte(lex.ItemOpenParen);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCloseBrace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--brace"]], false);
      r.WriteByte(lex.ItemCloseBrace);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderOpenBrace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--brace"]], false);
      r.WriteByte(lex.ItemOpenBrace);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCloseBracket(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bracket"]], false);
      r.WriteByte(lex.ItemCloseBracket);
      r.Tag("/span", null, false);

      if (3 === node.Parent!.LinkType) {
        const linkText = node.Parent!.ChildByType(ast.NodeLinkText);
        if (null === linkText || !bytes.EqualFold(node.Parent!.LinkRefLabel, nodeTokens(linkText))) {
          r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--link"]], false);
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
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bracket"]], false);
      r.WriteByte(lex.ItemOpenBracket);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderBang(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteByte(lex.ItemBang);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderImage(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    const needResetCaret = null !== node.Next && ast.NodeText === node.Next.Type && bytes.HasPrefix(nodeTokens(node.Next), editor.CaretTokens);

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

      const text = r.Text(node);
      let clazz = "vditor-ir__node";
      if (strings.Contains(text, editor.Caret) || needResetCaret) {
        clazz += " vditor-ir__node--expand";
      }
      r.Tag("span", [["class", clazz], ["data-type", "img"]], false);
    } else {
      if (needResetCaret) {
        r.WriteString(editor.Caret);
        node.Next!.Tokens = bytes.ReplaceAllOrNil(nodeTokens(node.Next!), editor.CaretTokens, emptyBytes);
      }

      let link: ast.Node | null = node;
      if (3 === node.LinkType) {
        link = r.Tree.FindLinkRefDefLink(node.LinkRefLabel);
      }
      let destTokens = nodeTokens(link!.ChildByType(ast.NodeLinkDest)!);
      destTokens = r.LinkPath(destTokens);
      destTokens = bytes.ReplaceAll(destTokens, editor.CaretTokens, emptyBytes);
      const attrs: string[][] = [["src", conv.StringFromBytes(destTokens)]];
      const alt = node.ChildByType(ast.NodeLinkText);
      if (null !== alt && 0 < nodeTokens(alt).length) {
        const altTokens = bytes.ReplaceAll(nodeTokens(alt), editor.CaretTokens, emptyBytes);
        attrs.push(["alt", conv.StringFromBytes(altTokens)]);
      }
      r.Tag("img", attrs, true);

      // XSS filtering
      const buf = r.Writer.Bytes();
      const idx = bytes.LastIndex(buf, imgSrcOpen);
      // PORT-NOTE: Go panics here when idx is -1 (buf[idx:]); idx is always found, the <img src= was written above (DisableTags stays 0 in this renderer)
      let imgBuf: Uint8Array = buf.subarray(idx);
      if (r.Options.Sanitize) {
        imgBuf = sanitize(imgBuf);
      }
      r.Writer.Truncate(idx);
      r.Writer.Write(imgBuf);

      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderLink(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderSpanNode(node);
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderDivNode(node);
      let tokens = bytes.TrimSpace(nodeTokens(node));
      r.WriteString("<pre class=\"vditor-ir__marker--pre vditor-ir__marker\">");
      r.Tag("code", [["data-type", "html-block"]], false);
      r.Write(html.EscapeHTML(tokens));
      r.WriteString("</code></pre>");

      r.Tag("pre", [["class", "vditor-ir__preview"], ["data-render", "2"]], false);
      tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
      if (r.Options.Sanitize) {
        tokens = sanitize(tokens);
      }
      tokens = r.tagSrcPath(tokens);
      r.Write(tokens);
      r.WriteString("</pre></div>");
    }
    return ast.WalkContinue;
  }

  renderInlineHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }
    if (isVditorTableCellBr(node)) {
      ensureVditorTableCellBrPlaceholder(node);
      r.Tag("br", null, true);
      return ast.WalkContinue;
    }

    const openKbd = bytes.Equal(nodeTokens(node), kbdOpen);
    const closeKbd = bytes.Equal(nodeTokens(node), kbdClose);
    if (openKbd || closeKbd) {
      if (openKbd) {
        if (r.tagMatchClose("kbd", node)) {
          r.renderSpanNode(node);
          r.Tag("code", [["class", "vditor-ir__marker"]], false);
          r.Write(html.EscapeHTML(nodeTokens(node)));
          r.Tag("/code", null, false);
          r.Tag("/span", null, false);
          r.Tag("kbd", null, false);
        } else {
          r.renderSpanNode(node);
          r.Tag("code", [["class", "vditor-ir__marker"]], false);
          r.Write(html.EscapeHTML(nodeTokens(node)));
          r.Tag("/code", null, false);
          r.Tag("/span", null, false);
        }
      } else {
        if (r.tagMatchOpen("kbd", node)) {
          r.Tag("/kbd", null, false);
          r.renderSpanNode(node);
          r.Tag("code", [["class", "vditor-ir__marker"]], false);
          r.Write(html.EscapeHTML(nodeTokens(node)));
          r.Tag("/code", null, false);
          r.Tag("/span", null, false);
        } else {
          r.renderSpanNode(node);
          r.Tag("code", [["class", "vditor-ir__marker"]], false);
          r.Write(html.EscapeHTML(nodeTokens(node)));
          r.Tag("/code", null, false);
          r.Tag("/span", null, false);
        }
      }
    } else {
      r.renderSpanNode(node);
      r.Tag("code", [["class", "vditor-ir__marker"]], false);
      r.Write(html.EscapeHTML(nodeTokens(node)));
      r.Tag("/code", null, false);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  tagMatchClose(tag: string, node: ast.Node): boolean {
    for (let n = node.Next; null !== n; n = n.Next) {
      if (ast.NodeInlineHTML === n.Type && "</" + tag + ">" === n.TokensStr()) {
        return true;
      }
    }
    return false;
  }

  tagMatchOpen(tag: string, node: ast.Node): boolean {
    for (let n = node.Previous; null !== n; n = n.Previous) {
      if (ast.NodeInlineHTML === n.Type && "<" + tag + ">" === n.TokensStr()) {
        return true;
      }
    }
    return false;
  }

  renderDocument(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderParagraph(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    const grandparent = node.Parent!.Parent;
    if (null !== grandparent && ast.NodeList === grandparent.Type && grandparent.ListData!.Tight) { // List.ListItem.Paragraph
      return ast.WalkContinue;
    }

    if (entering) {
      r.Tag("p", [["data-block", "0"]], false);
    } else {
      r.Tag("/p", null, false);
    }
    return ast.WalkContinue;
  }

  renderText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let tokens = nodeTokens(node);
      if (r.Options.FixTermTypo) {
        tokens = r.FixTermTypo(tokens);
      }

      // Some scenes need a zero width space to hold the line open, but if there is other text content the zero width space has to be removed
      if (!bytes.EqualFold(tokens, caretZwsp)) {
        tokens = bytes.ReplaceAll(tokens, zwspBytes, emptyBytes);
      }
      r.Write(html.EscapeHTML(tokens));
    }
    return ast.WalkContinue;
  }

  renderCodeSpan(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderSpanNode(node);
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderCodeSpanOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString(strings.Repeat("`", node.Parent!.CodeMarkerLen));
      if (bytes.HasPrefix(nodeTokens(node.Next!), backtickBytes)) {
        r.WriteByte(lex.ItemSpace);
      }
      r.Tag("/span", null, false);
      r.Tag("code", [["data-newline", "1"]], false);
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
      r.Tag("/code", null, false);
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
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
      r.renderSpanNode(node);
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderEmAsteriskOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bi"]], false);
      r.WriteByte(lex.ItemAsterisk);
      r.Tag("/span", null, false);
      r.Tag("em", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderEmAsteriskCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/em", null, false);
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bi"]], false);
      r.WriteByte(lex.ItemAsterisk);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderEmUnderscoreOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bi"]], false);
      r.WriteByte(lex.ItemUnderscore);
      r.Tag("/span", null, false);
      r.Tag("em", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderEmUnderscoreCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/em", null, false);
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bi"]], false);
      r.WriteByte(lex.ItemUnderscore);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrong(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.renderSpanNode(node);
    } else {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrongA6kOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bi"]], false);
      r.WriteString("**");
      r.Tag("/span", null, false);
      r.Tag("strong", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderStrongA6kCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/strong", null, false);
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bi"]], false);
      r.WriteString("**");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrongU8eOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bi"]], false);
      r.WriteString("__");
      r.Tag("/span", null, false);
      r.Tag("strong", [["data-newline", "1"]], false);
    }
    return ast.WalkContinue;
  }

  renderStrongU8eCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/strong", null, false);
      r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--bi"]], false);
      r.WriteString("__");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderBlockquote(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<blockquote data-block=\"0\">");
    } else {
      r.WriteString("</blockquote>");
    }
    return ast.WalkContinue;
  }

  renderBlockquoteMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderCallout(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("blockquote", [
        ["data-block", "0"],
        ["data-type", "callout"],
        ["data-subtype", html.EscapeHTMLStr(node.CalloutType)],
        ["class", "callout"],
      ], false);
      let clazz = "callout-info vditor-ir__node";
      if (strings.Contains(node.CalloutType + node.CalloutIcon + node.CalloutTitle, editor.Caret)) {
        clazz += " vditor-ir__node--expand";
      }
      r.Tag("p", [["data-block", "0"], ["class", clazz]], false);
      r.Tag("span", [["class", "vditor-ir__marker"]], false);
      r.WriteString("[!" + html.EscapeHTMLStr(node.CalloutType) + "] ");
      r.Tag("/span", null, false);
      if ("" !== node.CalloutIcon) {
        if (1 === node.CalloutIconType) {
          r.Tag("span", [["data-render", "2"]], false);
          r.Tag("img", [
            ["src", html.EscapeHTMLStr(node.CalloutIcon)],
            ["alt", ast.CalloutIconImageAlt],
            ["class", "callout-img"],
          ], true);
          r.Tag("/span", null, false);
          r.Tag("span", [["class", "vditor-ir__marker"]], false);
          r.WriteString(html.EscapeHTMLStr(calloutEditableIcon(node)));
          r.Tag("/span", null, false);
        } else {
          r.WriteString(html.EscapeHTMLStr(node.CalloutIcon));
        }
        r.WriteByte(lex.ItemSpace);
      }
      const titleTree = calloutInlineTree(calloutDisplayTitle(node), r.ParseOptions);
      if (null !== titleTree) {
        r.Write(NewVditorIRRenderer(titleTree, r.Options, r.ParseOptions).Render());
      }
      r.Tag("/p", null, false);
    } else {
      r.Tag("/blockquote", null, false);
    }
    return ast.WalkContinue;
  }

  renderHeading(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const text = r.Text(node);
      const headingID = node.ChildByType(ast.NodeHeadingID);
      if (strings.Contains(text, editor.Caret) || (null !== headingID && bytes.Contains(nodeTokens(headingID), editor.CaretTokens))) {
        r.WriteString("<h" + headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1) + " data-block=\"0\" class=\"vditor-ir__node vditor-ir__node--expand\"");
      } else {
        r.WriteString("<h" + headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1) + " data-block=\"0\" class=\"vditor-ir__node\"");
      }

      let id = "";
      if (null !== headingID) {
        id = conv.StringFromBytes(nodeTokens(headingID));
      }
      if ("" === id) {
        id = HeadingID(node);
      }
      r.WriteString(" id=\"ir-" + id + "\"");
      if (!node.HeadingSetext) {
        r.WriteString(" data-marker=\"#\">");
      } else {
        if (1 === node.HeadingLevel) {
          r.WriteString(" data-marker=\"=\">");
        } else {
          r.WriteString(" data-marker=\"-\">");
        }
      }
      if (r.Options.HeadingAnchor) {
        const id = HeadingID(node);
        r.Tag("a", [["id", "vditorAnchor-" + id], ["class", "vditor-anchor"], ["href", "#" + id]], false);
        r.WriteString("<svg viewBox=\"0 0 16 16\" version=\"1.1\" width=\"16\" height=\"16\"><path fill-rule=\"evenodd\" d=\"M4 9h1v1H4c-1.5 0-3-1.69-3-3.5S2.55 3 4 3h4c1.45 0 3 1.69 3 3.5 0 1.41-.91 2.72-2 3.25V8.59c.58-.45 1-1.27 1-2.09C10 5.22 8.98 4 8 4H4c-.98 0-2 1.22-2 2.5S3 9 4 9zm9-3h-1v1h1c1 0 2 1.22 2 2.5S13.98 12 13 12H9c-.98 0-2-1.22-2-2.5 0-.83.42-1.64 1-2.09V6.25c-1.09.53-2 1.84-2 3.25C6 11.31 7.55 13 9 13h4c1.45 0 3-1.69 3-3.5S14.5 6 13 6z\"></path></svg>");
        r.Tag("/a", null, false);
      }

      if (!node.HeadingSetext) {
        r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--heading"], ["data-type", "heading-marker"]], false);
        r.WriteString(strings.Repeat("#", node.HeadingLevel) + " ");
        r.Tag("/span", null, false);
      }
    } else {
      if (node.HeadingSetext) {
        r.Tag("span", [["class", "vditor-ir__marker vditor-ir__marker--heading"], ["data-type", "heading-marker"], ["data-render", "2"]], false);
        r.Newline();
        const contentLen = r.setextHeadingLen(node);
        if (1 === node.HeadingLevel) {
          r.WriteString(strings.Repeat("=", contentLen));
        } else {
          r.WriteString(strings.Repeat("-", contentLen));
        }
        r.Tag("/span", null, false);
      }
      r.WriteString("</h" + headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1) + ">");
    }
    return ast.WalkContinue;
  }

  renderHeadingC8hMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    return ast.WalkContinue;
  }

  renderHeadingID(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("span", [["data-type", "heading-id"], ["class", "vditor-ir__marker"]], false);
      r.WriteString(" {" + conv.StringFromBytes(nodeTokens(node)) + "}");
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderList(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    const listData = node.ListData!;
    let tag = "ul";
    if (1 === listData.Typ || (3 === listData.Typ && 0 === listData.BulletChar)) {
      tag = "ol";
    }
    if (entering) {
      const attrs: string[][] = [];
      if (listData.Tight) {
        attrs.push(["data-tight", "true"]);
      }
      if (0 === listData.BulletChar) {
        if (1 !== listData.Start) {
          attrs.push(["start", strconv.Itoa(listData.Start)]);
        }
      }
      switch (listData.Typ) {
        case 0:
          attrs.push(["data-marker", conv.StringFromBytes(listData.Marker)]);
          break;
        case 1:
          attrs.push(["data-marker", strconv.Itoa(listData.Num) + conv.StringFromRune(listData.Delimiter)]);
          break;
        case 3:
          if (0 === listData.BulletChar) {
            attrs.push(["data-marker", strconv.Itoa(listData.Num) + conv.StringFromRune(listData.Delimiter)]);
          } else {
            attrs.push(["data-marker", conv.StringFromBytes(listData.Marker)]);
          }
          break;
      }
      attrs.push(["data-block", "0"]);
      r.renderListStyle(node, attrs);
      r.Tag(tag, attrs, false);
    } else {
      r.Tag("/" + tag, null, false);
    }
    return ast.WalkContinue;
  }

  renderListItem(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const listData = node.ListData!;
      const attrs: string[][] = [];
      switch (listData.Typ) {
        case 0:
          attrs.push(["data-marker", conv.StringFromBytes(listData.Marker)]);
          break;
        case 1:
          attrs.push(["data-marker", strconv.Itoa(listData.Num) + conv.StringFromRune(listData.Delimiter)]);
          break;
        case 3:
          if (0 === listData.BulletChar) {
            attrs.push(["data-marker", strconv.Itoa(listData.Num) + conv.StringFromRune(listData.Delimiter)]);
          } else {
            attrs.push(["data-marker", conv.StringFromBytes(listData.Marker)]);
          }
          if (null !== node.FirstChild && null !== node.FirstChild.FirstChild && ast.NodeTaskListItemMarker === node.FirstChild.FirstChild.Type) { // li.p.task
            attrs.push(["class", r.Options.GFMTaskListItemClass]);
          }
          break;
      }
      r.Tag("li", attrs, false);
    } else {
      r.Tag("/li", null, false);
    }
    return ast.WalkContinue;
  }

  renderTaskListItemMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const attrs: string[][] = [];
      if (node.TaskListItemChecked) {
        attrs.push(["checked", ""]);
      }
      attrs.push(["type", "checkbox"]);
      if (r.Options.DataTask) {
        const marker = node.EffectiveTaskListItemMarker();
        attrs.push(["data-task", marker]);
      }
      r.Tag("input", attrs, true);
    }
    return ast.WalkContinue;
  }

  renderThematicBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("hr", [["data-block", "0"]], true);
    }
    return ast.WalkContinue;
  }

  renderHardBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("br", null, true);
    }
    return ast.WalkContinue;
  }

  renderSoftBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteByte(lex.ItemNewline);
    }
    return ast.WalkContinue;
  }

  renderSpanNode(node: ast.Node): void {
    const r = this;
    const text = r.Text(node);
    const attrs: string[][] = [];

    switch (node.Type) {
      case ast.NodeEmphasis:
        attrs.push(["data-type", "em"]);
        break;
      case ast.NodeStrong:
        attrs.push(["data-type", "strong"]);
        break;
      case ast.NodeStrikethrough:
        attrs.push(["data-type", "s"]);
        break;
      case ast.NodeMark:
        attrs.push(["data-type", "mark"]);
        break;
      case ast.NodeSup:
        attrs.push(["data-type", "sup"]);
        break;
      case ast.NodeSub:
        attrs.push(["data-type", "sub"]);
        break;
      case ast.NodeLink:
        if (3 !== node.LinkType) {
          attrs.push(["data-type", "a"]);
        } else {
          attrs.push(["data-type", "link-ref"]);
        }
        break;
      case ast.NodeImage:
        attrs.push(["data-type", "img"]);
        break;
      case ast.NodeCodeSpan:
        attrs.push(["data-type", "code"]);
        break;
      case ast.NodeEmoji:
        attrs.push(["data-type", "emoji"]);
        break;
      case ast.NodeInlineHTML:
        attrs.push(["data-type", "html-inline"]);
        break;
      case ast.NodeHTMLEntity:
        attrs.push(["data-type", "html-entity"]);
        break;
      case ast.NodeBackslash:
        attrs.push(["data-type", "backslash"]);
        break;
      default:
        attrs.push(["data-type", "inline-node"]);
        break;
    }

    if (strings.Contains(text, editor.Caret)) {
      attrs.push(["class", "vditor-ir__node vditor-ir__node--expand"]);
      r.Tag("span", attrs, false);
      return;
    }

    const preText = node.PreviousNodeText();
    if (strings.HasSuffix(preText, editor.Caret)) {
      attrs.push(["class", "vditor-ir__node vditor-ir__node--expand"]);
      r.Tag("span", attrs, false);
      return;
    }

    const nexText = node.NextNodeText();
    if (strings.HasPrefix(nexText, editor.Caret)) {
      attrs.push(["class", "vditor-ir__node vditor-ir__node--expand"]);
      r.Tag("span", attrs, false);
      return;
    }

    attrs.push(["class", "vditor-ir__node"]);
    r.Tag("span", attrs, false);
    return;
  }

  renderDivNode(node: ast.Node): void {
    const r = this;
    const text = r.Text(node);
    const attrs: string[][] = [["data-block", "0"]];
    switch (node.Type) {
      case ast.NodeCodeBlock:
        attrs.push(["data-type", "code-block"]);
        break;
      case ast.NodeHTMLBlock:
        attrs.push(["data-type", "html-block"]);
        break;
      case ast.NodeMathBlock:
        attrs.push(["data-type", "math-block"]);
        break;
      case ast.NodeYamlFrontMatter:
        attrs.push(["data-type", "yaml-front-matter"]);
        break;
    }

    if (strings.Contains(text, editor.Caret)) {
      attrs.push(["class", "vditor-ir__node vditor-ir__node--expand"]);
      r.Tag("div", attrs, false);
      return;
    }

    attrs.push(["class", "vditor-ir__node"]);
    r.Tag("div", attrs, false);
    return;
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
          case ast.NodeYamlFrontMatterContent:
          case ast.NodeHTMLBlock:
          case ast.NodeInlineHTML:
          case ast.NodeEmojiAlias:
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

function isVditorTableCellBr(node: ast.Node | null): boolean {
  if (null === node || null === node.Parent || ast.NodeTableCell !== node.Parent.Type || ast.NodeInlineHTML !== node.Type) {
    return false;
  }

  const tokens = bytes.TrimSpace(nodeTokens(node));
  return bytes.EqualFold(tokens, brTag1) || bytes.EqualFold(tokens, brTag2) ||
    bytes.EqualFold(tokens, brTag3);
}

// A line break at the end of a table cell needs an extra placeholder, otherwise it is discarded as a placeholder when converting back to Markdown.
function ensureVditorTableCellBrPlaceholder(node: ast.Node): void {
  let last = node.Parent!.LastChild;
  if (null !== last && ast.NodeText === last.Type &&
    0 === bytes.TrimSpace(bytes.ReplaceAll(nodeTokens(last), editor.CaretTokens, emptyBytes)).length) {
    last = last.Previous;
  }
  if (node !== last) {
    return;
  }

  const placeholder = new ast.Node(ast.NodeHardBreak);
  const next = node.Next;
  if (null !== next && ast.NodeText === next.Type &&
    0 === bytes.TrimSpace(bytes.ReplaceAll(nodeTokens(next), editor.CaretTokens, emptyBytes)).length) {
    next.InsertAfter(placeholder);
  } else {
    node.InsertAfter(placeholder);
  }
}

// NewVditorIRRenderer creates a Vditor Instant-Rendering DOM renderer.
export function NewVditorIRRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): VditorIRRenderer {
  const ret = new VditorIRRenderer(tree, options, parseOptions);
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
  ret.RendererFuncs.set(ast.NodeSup, ret.renderSup.bind(ret));
  ret.RendererFuncs.set(ast.NodeSupOpenMarker, ret.renderSupOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeSupCloseMarker, ret.renderSupCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeSub, ret.renderSub.bind(ret));
  ret.RendererFuncs.set(ast.NodeSubOpenMarker, ret.renderSubOpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeSubCloseMarker, ret.renderSubCloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeMark2OpenMarker, ret.renderMark2OpenMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeMark2CloseMarker, ret.renderMark2CloseMarker.bind(ret));
  ret.RendererFuncs.set(ast.NodeKramdownBlockIAL, ret.renderKramdownBlockIAL.bind(ret));
  ret.RendererFuncs.set(ast.NodeLinkRefDefBlock, ret.renderLinkRefDefBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeLinkRefDef, ret.renderLinkRefDef.bind(ret));
  return ret;
}
