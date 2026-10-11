// Ported from render/vditor_wysiwyg_renderer.go @ 8e7896b6
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
import { calloutDisplayTitle, calloutInlineTree } from "./callout.ts";
import { EChartsMindmap } from "./mindmap.ts";
import { sanitize } from "./sanitizer.ts";
// PORT-NOTE: the following files only attach methods to BaseRenderer (see PORTING.md); importing them here makes sure the methods exist
// whenever vditor_wysiwyg_renderer.ts is imported on its own.
import "./link.ts";
import "./term_typographer.ts";
import "./tabs.ts";

const zwspBytes: Uint8Array = conv.BytesFromString(editor.Zwsp);
const emptyBytes: Uint8Array = new Uint8Array(0);
const backslashPipeBytes: Uint8Array = conv.BytesFromString("\\|");
const pipeBytes: Uint8Array = conv.BytesFromString("|");
const caretZwspBytes: Uint8Array = conv.BytesFromString(editor.Caret + editor.Zwsp);
const imgSrcPrefix: Uint8Array = conv.BytesFromString("<img src=");
const javascriptColonBytes: Uint8Array = conv.BytesFromString("javascript:");
const brBytes: Uint8Array = conv.BytesFromString("<br />");
const commentSpanBytes: Uint8Array = conv.BytesFromString("<span class=\"vditor-comment");
const closeSpanBytes: Uint8Array = conv.BytesFromString("</span>");
const fenceMarkerBytes: Uint8Array = conv.BytesFromString("```");

// VditorRenderer describes the Vditor WYSIWYG DOM renderer.
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance. renderToC is also defined by BaseRenderer; no BaseRenderer method calls it,
// and the explicit r.BaseRenderer.renderToC call below is written as BaseRenderer.prototype.renderToC.call.
export class VditorRenderer extends BaseRenderer {
  commentStackDepth: number;

  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
    this.commentStackDepth = 0;
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
    const r = this;
    return ast.WalkContinue;
  }

  renderMark(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let previousNodeText = node.PreviousNodeText();
      previousNodeText = strings.ReplaceAll(previousNodeText, editor.Caret, "");
      if ("" === previousNodeText) {
        r.WriteString(editor.Zwsp);
      }
    } else {
      r.WriteString(editor.Zwsp);
    }
    return ast.WalkContinue;
  }

  renderMark1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("mark", [["data-marker", "="]], false);
    }
    return ast.WalkContinue;
  }

  renderMark1CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/mark", null, false);
    }
    return ast.WalkContinue;
  }

  renderMark2OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("mark", [["data-marker", "=="]], false);
    }
    return ast.WalkContinue;
  }

  renderMark2CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/mark", null, false);
    }
    return ast.WalkContinue;
  }

  renderSup(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderSupOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("sup", [["data-marker", "^"]], false);
    }
    return ast.WalkContinue;
  }

  renderSupCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/sup", null, false);
    }
    return ast.WalkContinue;
  }

  renderSub(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderSubOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("sub", [["data-marker", "~"]], false);
    }
    return ast.WalkContinue;
  }

  renderSubCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/sub", null, false);
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderYamlFrontMatterContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const previewTokens = bytes.TrimSpace(nodeTokens(node));
      const codeLen = previewTokens.length;
      const codeIsEmpty = 1 > codeLen || (editor.CaretTokens.length === codeLen && editor.Caret === conv.StringFromBytes(nodeTokens(node)));
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
  }

  renderYamlFrontMatterOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderYamlFrontMatter(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<div class=\"vditor-wysiwyg__block\" data-type=\"yaml-front-matter\" data-block=\"0\">");
    } else {
      r.WriteString("</div>");
    }
    return ast.WalkContinue;
  }

  renderHtmlEntity(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    let previousNodeText = node.PreviousNodeText();
    previousNodeText = strings.ReplaceAll(previousNodeText, editor.Caret, "");
    if ("" === previousNodeText) {
      r.WriteString(editor.Zwsp);
    }

    r.WriteString("<span class=\"vditor-wysiwyg__block\" data-type=\"html-entity\">");
    r.Tag("code", [["data-type", "html-entity"], ["style", "display: none"]], false);
    const tokens = slices.Append(conv.BytesFromString(editor.Zwsp), node.HtmlEntityTokens);
    r.Write(html.EscapeHTML(tokens));
    r.WriteString("</code>");

    r.Tag("span", [["class", "vditor-wysiwyg__preview"], ["data-render", "2"]], false);
    r.Tag("code", null, false);
    const previewTokens = bytes.ReplaceAll(node.HtmlEntityTokens, editor.CaretTokens, emptyBytes);
    r.Write(previewTokens);
    r.Tag("/code", null, false);
    r.Tag("/span", null, false);
    r.WriteString("</span>" + editor.Zwsp);
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
      r.WriteString("<span>");
      r.WriteByte(lex.ItemBackslash);
      r.WriteString("</span>");
    } else {
      r.WriteString("</span>");
    }
    return ast.WalkContinue;
  }

  renderToC(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return BaseRenderer.prototype.renderToC.call(r, node, entering); // PORT-NOTE: Go embedding, base method
  }

  renderFootnotesDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<div data-block=\"0\" data-type=\"footnotes-block\">");
      r.WriteString("<ol data-type=\"footnotes-defs-ol\">");
    } else {
      r.WriteString("</ol></div>");
    }
    return ast.WalkContinue;
  }

  renderFootnotesDef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (r.RenderingFootnotes) {
      return ast.WalkContinue;
    }

    if (entering) {
      if (null !== node.Previous && bytes.EqualFold(nodeTokens(node.Previous), nodeTokens(node))) {
        return ast.WalkContinue;
      }

      r.WriteString("<li data-type=\"footnotes-li\" data-marker=\"" + conv.StringFromBytes(nodeTokens(node)) + "\">");
      for (let c = node.FirstChild; null !== c; c = c.Next) {
        ast.Walk(c, (n: ast.Node, entering: boolean): ast.WalkStatus => {
          // PORT-NOTE: Go panics (nil function call) when no renderer is registered for the node type; the non-null assertion throws a TypeError here
          return r.RendererFuncs.get(n.Type)!(n, entering);
        });
      }
      r.WriteString("</li>");
      return ast.WalkSkipChildren;
    }
    return ast.WalkContinue;
  }

  renderFootnotesRef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
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
      r.Tag("sup", [["data-type", "footnotes-ref"], ["data-footnotes-label", conv.StringFromBytes(node.FootnotesRefLabel)],
        ["class", "vditor-tooltipped vditor-tooltipped__s"], ["aria-label", SubStr(html.EscapeString(label), 24)]], false);
      r.WriteString(idxStr);
      r.WriteString("</sup>" + editor.Zwsp);
    }
    return ast.WalkContinue;
  }

  renderCodeBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderCodeBlockInfoMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderCodeBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderEmojiAlias(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderEmojiImg(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(nodeTokens(node));
    }
    return ast.WalkContinue;
  }

  renderEmojiUnicode(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(nodeTokens(node));
    }
    return ast.WalkContinue;
  }

  renderEmoji(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderInlineMathCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderInlineMathContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    let tokens = bytes.ReplaceAll(nodeTokens(node), zwspBytes, emptyBytes);
    let previewTokens = tokens;
    const codeAttrs: string[][] = [["data-type", "math-inline"]];
    if (!bytes.Contains(previewTokens, editor.CaretTokens)) {
      codeAttrs.push(["style", "display: none"]);
    }
    r.WriteString("<span class=\"vditor-wysiwyg__block\" data-type=\"math-inline\">");
    r.Tag("code", codeAttrs, false);
    tokens = html.EscapeHTML(tokens);
    tokens = slices.Append(conv.BytesFromString(editor.Zwsp), tokens);
    r.Write(tokens);
    r.WriteString("</code>");

    r.Tag("span", [["class", "vditor-wysiwyg__preview"], ["data-render", "2"]], false);
    r.Tag("span", [["class", "language-math"]], false);
    previewTokens = bytes.ReplaceAll(previewTokens, editor.CaretTokens, emptyBytes);
    if (node.ParentIs(ast.NodeTableCell)) {
      // Improve the `|` render in the inline math in the table https://github.com/Vanessa219/vditor/issues/1550
      previewTokens = bytes.ReplaceAll(previewTokens, backslashPipeBytes, pipeBytes);
    }
    r.Write(html.EscapeHTML(previewTokens));
    r.Tag("/span", null, false);
    r.Tag("/span", null, false);
    r.WriteString("</span>" + editor.Zwsp);
    return ast.WalkContinue;
  }

  renderInlineMathOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderInlineMath(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let previousNodeText = node.PreviousNodeText();
      previousNodeText = strings.ReplaceAll(previousNodeText, editor.Caret, "");
      if ("" === previousNodeText) {
        r.WriteString(editor.Zwsp);
      }
    }
    return ast.WalkContinue;
  }

  renderMathBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderMathBlockContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    const previewTokens = bytes.TrimSpace(nodeTokens(node));
    const preAttrs: string[][] = [];
    if (!bytes.Contains(previewTokens, editor.CaretTokens) && r.Options.VditorMathBlockPreview) {
      preAttrs.push(["style", "display: none"]);
    }
    const codeLen = previewTokens.length;
    const codeIsEmpty = 1 > codeLen || (editor.CaretTokens.length === codeLen && editor.Caret === conv.StringFromBytes(nodeTokens(node)));
    r.Tag("pre", preAttrs, false);
    r.Tag("code", [["data-type", "math-block"]], false);
    if (codeIsEmpty) {
      r.WriteString(editor.FrontEndCaret + "\n");
    } else {
      r.Write(html.EscapeHTML(previewTokens));
    }
    r.WriteString("</code></pre>");

    if (r.Options.VditorMathBlockPreview) {
      r.Tag("pre", [["class", "vditor-wysiwyg__preview"], ["data-render", "2"]], false);
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
    return ast.WalkContinue;
  }

  renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<div class=\"vditor-wysiwyg__block\" data-type=\"math-block\" data-block=\"0\">");
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
      r.Tag("table", [["data-block", "0"]], false);
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
    return ast.WalkContinue;
  }

  renderStrikethrough1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("s", [["data-marker", "~"]], false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough1CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/s", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough2OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("s", [["data-marker", "~~"]], false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough2CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/s", null, false);
    }
    return ast.WalkContinue;
  }

  renderLinkTitle(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderLinkDest(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderLinkSpace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderLinkText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(nodeTokens(node));
    }
    return ast.WalkContinue;
  }

  renderCloseParen(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderOpenParen(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderCloseBrace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderOpenBrace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderCloseBracket(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderOpenBracket(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderBang(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderImage(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (3 === node.LinkType) {
        let previousNodeText = node.PreviousNodeText();
        previousNodeText = strings.ReplaceAll(previousNodeText, editor.Caret, "");
        if ("" === previousNodeText) {
          r.WriteString(editor.Zwsp);
        }
        r.WriteString("<img src=\"");
        const link = r.Tree.FindLinkRefDefLink(node.LinkRefLabel)!;
        let destTokens = nodeTokens(link.ChildByType(ast.NodeLinkDest)!);
        destTokens = r.LinkPath(destTokens);
        destTokens = bytes.ReplaceAll(destTokens, editor.CaretTokens, emptyBytes);
        r.Write(destTokens);
        r.WriteString("\" alt=\"");
        const alt = node.ChildByType(ast.NodeLinkText);
        if (null !== alt) {
          alt.Tokens = bytes.ReplaceAllOrNil(nodeTokens(alt), editor.CaretTokens, emptyBytes);
          r.Write(nodeTokens(alt));
        }
        r.WriteByte(lex.ItemDoublequote);
        const title = link.ChildByType(ast.NodeLinkTitle);
        if (null !== title && null !== title.Tokens) {
          r.WriteString(" title=\"");
          title.Tokens = bytes.ReplaceAllOrNil(title.Tokens, editor.CaretTokens, emptyBytes);
          r.Write(nodeTokens(title));
          r.WriteByte(lex.ItemDoublequote);
        }
        r.WriteString(" data-type=\"link-ref\" data-link-label=\"" + conv.StringFromBytes(node.LinkRefLabel) + "\"");
        r.WriteString(" />");

        // XSS filtering
        const buf = r.Writer.Bytes();
        // PORT-NOTE: Go panics here when idx is -1 (buf[idx:]); idx is always found, the <img src= was written above
        const idx = bytes.LastIndex(buf, imgSrcPrefix);
        let imgBuf: Uint8Array = buf.subarray(idx);
        if (r.Options.Sanitize) {
          imgBuf = sanitize(imgBuf);
        }
        r.Writer.Truncate(idx);
        r.Writer.Write(imgBuf);
        return ast.WalkSkipChildren;
      }

      if (0 === r.DisableTags) {
        r.WriteString("<img src=\"");
        let destTokens = nodeTokens(node.ChildByType(ast.NodeLinkDest)!);
        destTokens = r.LinkPath(destTokens);
        destTokens = bytes.ReplaceAll(destTokens, editor.CaretTokens, emptyBytes);
        r.Write(destTokens);
        r.WriteString("\" alt=\"");
        const alt = node.ChildByType(ast.NodeLinkText);
        if (null !== alt && bytes.Contains(nodeTokens(alt), editor.CaretTokens)) {
          alt.Tokens = bytes.ReplaceAllOrNil(nodeTokens(alt), editor.CaretTokens, emptyBytes);
        }
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
        title.Tokens = bytes.ReplaceAllOrNil(title.Tokens, editor.CaretTokens, emptyBytes);
        r.Write(nodeTokens(title));
        r.WriteByte(lex.ItemDoublequote);
      }
      r.WriteString(" />");

      // XSS filtering
      const buf = r.Writer.Bytes();
      // PORT-NOTE: Go panics here when idx is -1 (buf[idx:]); idx is always found, the <img src= was written above
      const idx = bytes.LastIndex(buf, imgSrcPrefix);
      let imgBuf: Uint8Array = buf.subarray(idx);
      if (r.Options.Sanitize) {
        imgBuf = sanitize(imgBuf);
      }
      r.Writer.Truncate(idx);
      r.Writer.Write(imgBuf);
    }
    return ast.WalkContinue;
  }

  renderLink(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (3 === node.LinkType) {
      if (entering) {
        let previousNodeText = node.PreviousNodeText();
        previousNodeText = strings.ReplaceAll(previousNodeText, editor.Caret, "");
        if ("" === previousNodeText) {
          r.WriteString(editor.Zwsp);
        }

        const linkText = node.ChildrenByType(ast.NodeLinkText);
        let text = "";
        if (0 < linkText.length) {
          text = conv.StringFromBytes(nodeTokens(linkText[0]));
        }
        const label = conv.StringFromBytes(node.LinkRefLabel);
        const attrs: string[][] = [["data-type", "link-ref"], ["data-link-label", label]];
        r.Tag("span", attrs, false);
        r.WriteString(text);
        r.Tag("/span", null, false);
        r.WriteString(editor.Zwsp);
        return ast.WalkSkipChildren;
      } else {
        return ast.WalkContinue;
      }
    }

    if (entering) {
      const dest = node.ChildByType(ast.NodeLinkDest)!;
      let destTokens = nodeTokens(dest);
      if (r.Options.Sanitize) {
        let tokens = bytes.TrimSpace(destTokens);
        tokens = bytes.ToLower(tokens);
        if (bytes.HasPrefix(tokens, javascriptColonBytes)) {
          destTokens = emptyBytes; // PORT-NOTE: Go sets nil, which behaves as empty
        }
      }
      destTokens = r.LinkPath(destTokens);
      const caretInDest = bytes.Contains(destTokens, editor.CaretTokens);
      if (caretInDest) {
        // UPSTREAM-BUG: a link whose text is an image has no direct NodeLinkText child, so Go dereferences nil here (nil pointer panic) when the caret is inside the destination
        const text = node.ChildByType(ast.NodeLinkText)!;
        text.Tokens = slices.Append(nodeTokens(text), editor.CaretTokens);
        destTokens = bytes.ReplaceAll(destTokens, editor.CaretTokens, emptyBytes);
      }
      const attrs: string[][] = [["href", conv.StringFromBytes(destTokens)]];
      const title = node.ChildByType(ast.NodeLinkTitle);
      if (null !== title && null !== title.Tokens) {
        title.Tokens = bytes.ReplaceAllOrNil(title.Tokens, editor.CaretTokens, emptyBytes);
        attrs.push(["title", conv.StringFromBytes(nodeTokens(title))]);
      }
      r.Tag("a", attrs, false);
    } else {
      r.Tag("/a", null, false);
    }
    return ast.WalkContinue;
  }

  renderHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    r.WriteString("<div class=\"vditor-wysiwyg__block\" data-type=\"html-block\" data-block=\"0\">");
    let tokens = bytes.TrimSpace(nodeTokens(node));
    r.WriteString("<pre>");
    r.Tag("code", null, false);
    r.Write(html.EscapeHTML(tokens));
    r.WriteString("</code></pre>");

    r.Tag("pre", [["class", "vditor-wysiwyg__preview"], ["data-render", "2"]], false);
    tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
    if (r.Options.Sanitize) {
      tokens = sanitize(tokens);
    }
    tokens = r.tagSrcPath(tokens);
    r.Write(tokens);
    r.WriteString("</pre></div>");
    return ast.WalkContinue;
  }

  renderInlineHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    if (bytes.Equal(nodeTokens(node), brBytes) && node.ParentIs(ast.NodeTableCell)) {
      r.Write(nodeTokens(node));
      return ast.WalkContinue;
    }

    if (bytes.Contains(nodeTokens(node), commentSpanBytes)) {
      r.commentStackDepth++;
      r.Write(nodeTokens(node));
      return ast.WalkContinue;
    }

    if (bytes.Equal(nodeTokens(node), closeSpanBytes)) {
      if (0 < r.commentStackDepth) {
        r.commentStackDepth--;
        r.Write(nodeTokens(node));
        return ast.WalkContinue;
      }
    }

    if (entering) {
      let previousNodeText = node.PreviousNodeText();
      previousNodeText = strings.ReplaceAll(previousNodeText, editor.Caret, "");
      if (editor.Zwsp === previousNodeText || "" === previousNodeText) {
        r.WriteString(editor.Zwsp);
      }
    }

    let tokens = bytes.ReplaceAll(nodeTokens(node), zwspBytes, emptyBytes);
    tokens = slices.Append(conv.BytesFromString(editor.Zwsp), tokens);

    node.Tokens = slices.NilIfEmpty(bytes.TrimSpace(nodeTokens(node)));
    r.Tag("code", [["data-type", "html-inline"]], false);
    tokens = html.EscapeHTML(tokens);
    r.Write(tokens);
    r.WriteString("</code>");
    return ast.WalkContinue;
  }

  renderDocument(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderParagraph(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    const grandparent = node.Parent!.Parent;
    if (null !== grandparent && ast.NodeList === grandparent.Type && grandparent.ListData!.Tight) { // List.ListItem.Paragraph
      return ast.WalkContinue;
    }

    if (entering) {
      let attr: string[][] = [["data-block", "0"]];
      attr = attr.concat(node.KramdownIAL ?? []);
      r.Tag("p", attr, false);
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

      tokens = bytes.TrimRight(tokens, "\n");
      // In some scenarios a zero-width space is needed to hold the line open, but it must be removed when there is other text content
      if (!bytes.EqualFold(tokens, caretZwspBytes)) {
        tokens = bytes.ReplaceAll(tokens, zwspBytes, emptyBytes);
      }
      r.Write(html.EscapeHTML(tokens));
    }
    return ast.WalkContinue;
  }

  renderCodeSpan(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let previousNodeText = node.PreviousNodeText();
      previousNodeText = strings.ReplaceAll(previousNodeText, editor.Caret, "");
      if ("" === previousNodeText) {
        r.WriteString(editor.Zwsp);
      } else {
        const lastc = utf8.DecodeLastRuneInString(previousNodeText)[0];
        if (unicode.IsLetter(lastc) || unicode.IsDigit(lastc)) {
          r.WriteByte(lex.ItemSpace);
        }
      }
      r.Tag("code", [["data-marker", strings.Repeat("`", node.CodeMarkerLen)]], false);
    }
    return ast.WalkContinue;
  }

  renderCodeSpanOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderCodeSpanContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let tokens = bytes.ReplaceAll(nodeTokens(node), zwspBytes, emptyBytes);
      tokens = html.EscapeHTML(tokens);
      tokens = slices.Append(conv.BytesFromString(editor.Zwsp), tokens);
      r.Write(tokens);
    }
    return ast.WalkContinue;
  }

  renderCodeSpanCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("</code>");
      const codeSpan = node.Parent!;
      const codeSpanParent = codeSpan.Parent;
      if (null !== codeSpanParent && ast.NodeLink === codeSpanParent.Type) {
        return ast.WalkContinue;
      }
      r.WriteString(editor.Zwsp);
    }
    return ast.WalkContinue;
  }

  renderEmphasis(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderEmAsteriskOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("em", [["data-marker", "*"]], false);
    }
    return ast.WalkContinue;
  }

  renderEmAsteriskCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/em", null, false);
    }
    return ast.WalkContinue;
  }

  renderEmUnderscoreOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("em", [["data-marker", "_"]], false);
    }
    return ast.WalkContinue;
  }

  renderEmUnderscoreCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/em", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrong(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderStrongA6kOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("strong", [["data-marker", "**"]], false);
    }
    return ast.WalkContinue;
  }

  renderStrongA6kCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/strong", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrongU8eOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("strong", [["data-marker", "__"]], false);
    }
    return ast.WalkContinue;
  }

  renderStrongU8eCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/strong", null, false);
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
    const r = this;
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
      r.Tag("p", [["data-block", "0"], ["class", "callout-info"]], false);
      r.Tag("span", [["class", "vditor-wysiwyg__callout-marker"]], false);
      r.WriteString("[!" + html.EscapeHTMLStr(node.CalloutType) + "] ");
      r.Tag("/span", null, false);
      if ("" !== node.CalloutIcon) {
        if (1 === node.CalloutIconType) {
          r.Tag("img", [
            ["src", html.EscapeHTMLStr(node.CalloutIcon)],
            ["alt", ast.CalloutIconImageAlt],
            ["class", "callout-img"],
          ], true);
        } else {
          r.WriteString(html.EscapeHTMLStr(node.CalloutIcon));
        }
        r.WriteByte(lex.ItemSpace);
      }
      const titleTree: parse.Tree | null = calloutInlineTree(calloutDisplayTitle(node), r.ParseOptions);
      if (null !== titleTree) {
        r.Write(NewVditorRenderer(titleTree, r.Options, r.ParseOptions).Render());
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
      r.WriteString("<h" + headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1) + " data-block=\"0\"");
      let id = "";
      const headingID = node.ChildByType(ast.NodeHeadingID);
      if (null !== headingID) {
        id = conv.StringFromBytes(nodeTokens(headingID));
      }
      if (r.Options.HeadingID && "" !== id) {
        r.WriteString(" data-id=\"" + id + "\"");
      }
      if ("" === id) {
        id = HeadingID(node);
      }
      r.WriteString(" id=\"wysiwyg-" + id + "\"");
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
    } else {
      r.WriteString("</h" + headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1) + ">");
    }
    return ast.WalkContinue;
  }

  renderHeadingC8hMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderHeadingID(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
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
      if (null === node.FirstChild) {
        r.WriteString(editor.Zwsp);
      }
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
      if (null !== node.Tokens) {
        r.Tag("p", [["data-block", "0"]], false);
        r.Write(node.Tokens);
        r.WriteByte(lex.ItemNewline);
        r.Tag("/p", null, false);
      }
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

  renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let marker = "```";
      if (null !== node.FirstChild && bytes.HasPrefix(nodeTokens(node.FirstChild), fenceMarkerBytes)) {
        marker = conv.StringFromBytes(nodeTokens(node.FirstChild));
      }
      r.WriteString("<div class=\"vditor-wysiwyg__block\" data-type=\"code-block\" data-block=\"0\" data-marker=\"" + marker + "\">");
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
    const codeIsEmpty = 1 > codeLen || (editor.CaretTokens.length === codeLen && editor.Caret === conv.StringFromBytes(nodeTokens(node)));
    const isFenced = node.Parent!.IsFencedCodeBlock;
    let language = "";
    let caretInInfo = false;
    let attrs: string[][] = [];
    if (isFenced && 0 < node.Previous!.CodeBlockInfo.length) {
      if (bytes.Contains(node.Previous!.CodeBlockInfo, editor.CaretTokens)) {
        caretInInfo = true;
        node.Previous!.CodeBlockInfo = bytes.ReplaceAll(node.Previous!.CodeBlockInfo, editor.CaretTokens, emptyBytes);
      }
      if (0 < node.Previous!.CodeBlockInfo.length) {
        const infoWords = lex.Split(node.Previous!.CodeBlockInfo, lex.ItemSpace);
        language = conv.StringFromBytes(infoWords[0]);
        attrs.push(["class", "language-" + language]);
        if ("mindmap" === language) {
          const dataCode = EChartsMindmap(nodeTokens(node));
          attrs.push(["data-code", conv.StringFromBytes(dataCode)]);
        }
      }
    }
    const preAttrs: string[][] = [["class", "vditor-wysiwyg__pre"]];
    if (!bytes.Contains(nodeTokens(node), editor.CaretTokens) && !caretInInfo && r.Options.VditorCodeBlockPreview) {
      preAttrs.push(["style", "display: none"]);
    }
    r.Tag("pre", preAttrs, false);
    r.Tag("code", attrs, false);

    if (codeIsEmpty) {
      r.WriteString(editor.FrontEndCaret + "\n");
    } else {
      if (caretInInfo) {
        r.WriteString(editor.FrontEndCaret);
      }
      r.Write(html.EscapeHTML(nodeTokens(node)));
      r.Newline();
    }
    r.WriteString("</code></pre>");

    if (r.Options.VditorCodeBlockPreview) {
      r.Tag("pre", [["class", "vditor-wysiwyg__preview"], ["data-render", "2"]], false);
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
}

// NewVditorRenderer creates a Vditor WYSIWYG DOM renderer.
export function NewVditorRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): VditorRenderer {
  const ret = new VditorRenderer(tree, options, parseOptions);
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
