// Ported from render/protyle_export_docx_renderer.go @ 8e7896b6
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
import { BaseRenderer } from "./types.ts";
import { headingLevel } from "./html_renderer.ts";
import { reverse } from "./protyle_export_md_renderer.ts";
import { HeadingID, NoHighlight, appendTableCellAlignStyle, nodeTokens } from "./renderer.ts";
import type { Options } from "./renderer.ts";
import { calloutDisplayTitle } from "./callout.ts";
import { customBlockAttrs } from "./custom_block_renderer.ts";
import { sanitize } from "./sanitizer.ts";
import { isCJK } from "./space.ts";
import { TableCellRichHTML } from "./table_rich.ts";
// PORT-NOTE: the files below only attach methods to BaseRenderer (see PORTING.md); importing them makes sure the methods exist
// whenever this file is imported on its own.
import "./link.ts";
import "./term_typographer.ts";
import "./tabs.ts";
import "./space.ts";
import "./custom_block_renderer.ts";

const emptyBytes: Uint8Array = new Uint8Array(0);
const imgSrcPrefix: Uint8Array = conv.BytesFromString("<img src=");
const javascriptColonBytes: Uint8Array = conv.BytesFromString("javascript:");
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance.
export class ProtyleExportDocxRenderer extends BaseRenderer {
  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
  }

  Render(): Uint8Array {
    const r = this;
    // PORT-NOTE: Go embedding, the explicit call of the base method
    const output = BaseRenderer.prototype.Render.call(r);
    return output;
  }

  renderCallout(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      r.Tag("blockquote", node.KramdownIAL, false);
      r.Newline();
      const title = node.CalloutIcon + " " + node.CalloutTitle;
      if (strings.TrimSpace(title) !== "") {
        r.WriteByte(lex.ItemSpace);
        r.WriteString(title);
      }
      r.Newline();
    } else {
      r.Newline();
      r.WriteString("</blockquote>");
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderCustomBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      r.Tag("div", customBlockAttrs(node), false);
      r.renderCustomBlockFallback(node);
      r.WriteString("</div>");
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderAttributeView(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderTextMark(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    const types = strings.Split(node.TextMarkType, " ");
    for (const typ of types) {
      r.renderHTMLTag0(node, typ, true);
    }

    r.WriteString(r.getTextMarkTextContent(node));

    reverse(types);
    for (const typ of types) {
      r.renderHTMLTag0(node, typ, false);
    }
    return ast.WalkContinue;
  }

  renderHTMLTag0(node: ast.Node, currentTextMarkType: string, entering: boolean): void {
    const r = this;
    const attrs: string[][] = [];
    const style = node.IALAttr("style");
    if ("" !== style) {
      attrs.push(["style", style]);
    }

    switch (currentTextMarkType) {
      case "a":
        if (entering) {
          const attrs = [["href", node.TextMarkAHref]];
          if ("" !== node.TextMarkATitle) {
            attrs.push(["title", node.TextMarkATitle]);
          }
          r.Tag("a", attrs, false);

        } else {
          r.WriteString("</a>");
        }
        break;
      case "inline-memo":
        if (entering) {
          r.WriteString(node.TextMarkTextContent);
        }

        if (node.IsNextSameInlineMemo()) {
          return;
        }

        if ("" !== node.TextMarkInlineMemoContent) {
          const lastRune = utf8.DecodeLastRuneInString(node.TextMarkTextContent)[0];
          if (isCJK(lastRune)) {
            if (entering) {
              r.WriteString("<sup>（");
            } else {
              r.WriteString("）</sup>");
            }
          } else {
            if (entering) {
              r.WriteString("<sup>(");
            } else {
              r.WriteString(")</sup>");
            }
          }
        }
        break;
      case "inline-math":
        if (entering) {
          r.WriteString("<span>$");
        } else {
          r.WriteString("$</span>");
        }
        break;
      case "strong":
        if (entering) {
          r.Tag("strong", attrs, false);
        } else {
          r.WriteString("</strong>");
        }
        break;
      case "em":
        if (entering) {
          r.WriteString("<em>");
        } else {
          r.WriteString("</em>");
        }
        break;
      case "code":
        if (entering) {
          r.WriteString("<code>");
        } else {
          r.WriteString("</code>");
        }
        break;
      case "tag":
        if (entering) {
          r.WriteString("<mark>#");
        } else {
          r.WriteString("#</mark>");
        }
        break;
      case "s":
        if (entering) {
          r.WriteString("<s>");
        } else {
          r.WriteString("</s>");
        }
        break;
      case "mark":
        if (entering) {
          r.WriteString("<mark>");
        } else {
          r.WriteString("</mark>");
        }
        break;
      case "u":
        if (entering) {
          r.WriteString("<u>");
        } else {
          r.WriteString("</u>");
        }
        break;
      case "sup":
        if (entering) {
          r.WriteString("<sup>");
        } else {
          r.WriteString("</sup>");
        }
        break;
      case "sub":
        if (entering) {
          r.WriteString("<sub>");
        } else {
          r.WriteString("</sub>");
        }
        break;
      case "kbd":
        if (entering) {
          r.WriteString("<kbd>");
        } else {
          r.WriteString("</kbd>");
        }
        break;
      case "text":
        if (entering) {
          r.Tag("span", attrs, false);
        } else {
          r.WriteString("</span>");
        }
        break;
    }
    return;
  }

  getTextMarkTextContent(node: ast.Node): string {
    const r = this;
    let ret = node.TextMarkTextContent;
    if (node.IsTextMarkType("a") || node.IsTextMarkType("block-ref") || node.IsTextMarkType("file-annotation-ref")) {
      if ("" === node.TextMarkInlineMemoContent) {
        let content = node.TextMarkTextContent;
        content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
        ret = content;
      } else {
        let content = node.TextMarkInlineMemoContent;
        content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
        ret = content;
      }
    } else if (node.IsTextMarkType("inline-memo")) {
      let content = node.TextMarkInlineMemoContent;
      content = strings.ReplaceAll(content, editor.IALValEscNewLine, " ");
      ret = content;
    } else if (node.IsTextMarkType("inline-math")) {
      ret = node.TextMarkInlineMathContent;
    }

    if (node.ParentIs(ast.NodeTableCell)) {
      // Improve the handling of inline-math containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9227
      ret = strings.ReplaceAll(ret, "|", "&#124;");
      ret = strings.ReplaceAll(ret, "\n", "<br />");
    }
    return ret;
  }

  renderBr(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<br />");
    }
    return ast.WalkContinue;
  }

  renderUnderline(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderUnderlineOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<u>");
    }
    return ast.WalkContinue;
  }

  renderUnderlineCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("</u>");
    }
    return ast.WalkContinue;
  }

  renderKbd(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderKbdOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<kbd>");
    }
    return ast.WalkContinue;
  }

  renderKbdCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("</kbd>");
    }
    return ast.WalkContinue;
  }

  renderVideo(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderAudio(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderIFrame(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderWidget(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderGitConflictCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(nodeTokens(node));
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderGitConflictContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(html.EscapeHTML(nodeTokens(node)));
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderGitConflictOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(nodeTokens(node));
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderGitConflict(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    r.Newline();
    if (entering) {
      const attrs = [["class", "language-git-conflict"]];
      attrs.push(...(node.KramdownIAL ?? []));
      r.Tag("div", attrs, false);
    } else {
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderSuperBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderSuperBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkSkipChildren;
  }

  renderSuperBlockLayoutMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkSkipChildren;
  }

  renderSuperBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkSkipChildren;
  }

  renderLinkRefDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkSkipChildren;
  }

  renderLinkRefDef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkSkipChildren;
  }

  renderTag(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.TextAutoSpacePrevious(node);
    } else {
      r.TextAutoSpaceNext(node);
    }
    return ast.WalkContinue;
  }

  renderTagOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("em", node.Parent!.KramdownIAL, false);
      r.WriteByte(lex.ItemCrosshatch);
    }
    return ast.WalkContinue;
  }

  renderTagCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteByte(lex.ItemCrosshatch);
      r.Tag("/em", null, false);
    }
    return ast.WalkContinue;
  }

  renderKramdownBlockIAL(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderKramdownSpanIAL(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderMark(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.TextAutoSpacePrevious(node);
    } else {
      r.TextAutoSpaceNext(node);
    }
    return ast.WalkContinue;
  }

  renderMark1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("mark", node.Parent!.KramdownIAL, false);
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
      r.Tag("mark", node.Parent!.KramdownIAL, false);
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
      r.Tag("sup", null, false);
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
      r.Tag("sub", null, false);
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

  renderBlockQueryEmbed(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      r.Tag("div", null, false);
    } else {
      r.Tag("/div", null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderBlockQueryEmbedScript(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteByte(lex.ItemDoublequote);
      r.Write(nodeTokens(node));
      r.WriteByte(lex.ItemDoublequote);
    }
    return ast.WalkContinue;
  }

  renderBlockRef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderBlockRefID(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderBlockRefSpace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderBlockRefText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteByte(lex.ItemDoublequote);
      r.Write(nodeTokens(node));
    } else {
      r.WriteByte(lex.ItemDoublequote);
    }
    return ast.WalkContinue;
  }

  renderBlockRefDynamicText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteByte(lex.ItemSinglequote);
      r.Write(nodeTokens(node));
    } else {
      r.WriteByte(lex.ItemSinglequote);
    }
    return ast.WalkContinue;
  }

  renderFileAnnotationRef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderFileAnnotationRefID(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderFileAnnotationRefSpace(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderFileAnnotationRefText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteByte(lex.ItemDoublequote);
      r.Write(nodeTokens(node));
    } else {
      r.WriteByte(lex.ItemDoublequote);
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("</code></pre>");
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(html.EscapeHTML(nodeTokens(node)));
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatterOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const attrs = [["class", "vditor-yml-front-matter"]];
      attrs.push(...(node.Parent!.KramdownIAL ?? []));
      r.Tag("pre", attrs, false);
      r.WriteString("<code class=\"language-yaml\">");
    }
    return ast.WalkContinue;
  }

  renderYamlFrontMatter(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    r.Newline();
    return ast.WalkContinue;
  }

  renderHtmlEntity(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(html.EscapeHTML(nodeTokens(node)));
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
    return ast.WalkContinue;
  }

  renderToC(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return BaseRenderer.prototype.renderToC.call(r, node, entering);
  }

  renderFootnotesRef(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderFootnotesDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("<div class=\"footnotes-defs-div\">");
      r.WriteString("<hr class=\"footnotes-defs-hr\" />\n");
      r.WriteString("<ol class=\"footnotes-defs-ol\">");
    } else {
      r.WriteString("</ol></div>");
    }
    return ast.WalkContinue;
  }

  renderFootnotesDef(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      // r.WriteString("<li id=\"footnotes-def-" + node.FootnotesRefId + "\">")
      // With an id on the li, the Pandoc conversion from HTML to Docx has problems
      r.WriteString("<li>");
      if (0 < node.FootnotesRefs.length && null !== node.FirstChild) {
        const refId = node.FootnotesRefs[0].FootnotesRefId;
        const inlineHTML = new ast.Node();
        inlineHTML.Type = ast.NodeInlineHTML;
        inlineHTML.Tokens = conv.BytesFromString("<span id=\"footnotes-def-" + refId + "\"></span>");
        node.FirstChild!.PrependChild(inlineHTML);
      }
    } else {
      r.WriteString("</li>\n");
    }
    return ast.WalkContinue;
  }

  renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    r.Newline();

    let noHighlight = false;
    let language = "";
    if (null !== node.FirstChild!.Next && 0 < node.FirstChild!.Next!.CodeBlockInfo.length) {
      language = util.BytesToStr(node.FirstChild!.Next!.CodeBlockInfo);
      noHighlight = language !== "mindmap" && NoHighlight(language);
    }

    if (entering) {
      if (noHighlight) {
        let attrs: string[][] = [];
        let tokens = html.EscapeHTML(nodeTokens(node.FirstChild!.Next!.Next!));
        tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
        tokens = bytes.TrimSpace(tokens);
        attrs.push(["data-content", util.BytesToStr(tokens)]);
        attrs.push(["data-subtype", language]);
        r.Tag("div", attrs, false);
        r.Tag("div", [["spin", "1"]], false);
        r.Tag("/div", null, false);
        r.Tag("/div", null, false);
        return ast.WalkSkipChildren;
      }

      let cls = "code-block"; // PORT-NOTE: Go identifier `class` is a reserved word
      if ("" !== language) {
        cls += " " + language;
      }
      const attrs = [["class", cls], ["data-language", language]];
      r.Tag("pre", attrs, false);
      r.WriteString("<code class=\"hljs\">");
    } else {
      if (noHighlight) {
        return ast.WalkSkipChildren;
      }

      r.Tag("/code", null, false);
      r.Tag("/pre", null, false);
    }
    return ast.WalkContinue;
  }

  renderCodeBlockCode(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Write(html.EscapeHTML(nodeTokens(node)));
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
    if (entering) {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderInlineMathContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderInlineMathOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const tokens = html.EscapeHTML(nodeTokens(node.Next!));
      const content = util.BytesToStr(tokens);
      r.Tag("span", null, false);
      r.WriteString("$" + content + "$");
    }
    return ast.WalkContinue;
  }

  renderInlineMath(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.TextAutoSpacePrevious(node);
    } else {
      r.TextAutoSpaceNext(node);
    }
    return ast.WalkContinue;
  }

  renderMathBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderMathBlockContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderMathBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    r.Newline();
    if (entering) {
      let tokens = html.EscapeHTML(nodeTokens(node.FirstChild!.Next!));
      tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
      tokens = bytes.TrimSpace(tokens);
      const content = util.BytesToStr(tokens);
      r.Tag("div", null, false);
      r.WriteString("$$\n" + content + "\n$$");
      r.Tag("/div", null, false);
      r.Newline();
    }
    return ast.WalkSkipChildren;
  }

  renderTableCell(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    let tag = "td";
    if (ast.NodeTableHead === node.Parent!.Parent!.Type) {
      tag = "th";
    }
    if (entering) {
      const attrs: string[][] = [];
      r.spanNodeAttrs(node, attrs);
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
      r.Tag("/"+tag, null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderTableRow(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("tr", null, false);
      r.Newline();
    } else {
      r.Tag("/tr", null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderTableHead(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderTable(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (r.needUseHTMLTable(node)) {
      if (entering) {
        r.renderTableByHTML(node);
        return ast.WalkSkipChildren;
      }
      return ast.WalkContinue;
    }

    if (entering) {
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
  }

  renderStrikethrough(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.TextAutoSpacePrevious(node);
    } else {
      r.TextAutoSpaceNext(node);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough1OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("del", node.Parent!.KramdownIAL, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough1CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/del", null, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough2OpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("del", node.Parent!.KramdownIAL, false);
    }
    return ast.WalkContinue;
  }

  renderStrikethrough2CloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/del", null, false);
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
      let tokens: Uint8Array = new Uint8Array(0);
      if (r.Options.AutoSpace) {
        tokens = r.Space(nodeTokens(node));
      } else {
        tokens = nodeTokens(node);
      }
      r.Write(html.EscapeHTML(tokens));
    }
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

  renderCloseParen(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderOpenParen(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderLess(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderGreater(node: ast.Node, entering: boolean): ast.WalkStatus {
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
      if (0 === r.DisableTags) {
        r.WriteString("<figure>");
        const attrs = [["class", "img"]];
        const style = node.IALAttr("parent-style");
        if ("" !== style) {
          attrs.push(["style", style]);
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
      let title = node.ChildByType(ast.NodeLinkTitle);
      let titleTokens: Uint8Array = new Uint8Array(0);
      if (null !== title && null !== title.Tokens) {
        titleTokens = html.EscapeHTML(nodeTokens(title));
        r.WriteString(" title=\"");
        r.Write(titleTokens);
        r.WriteByte(lex.ItemDoublequote);
      }
      const ial = r.NodeAttrsStr(node);
      if ("" !== ial) {
        r.WriteString(" " + ial);
      }
      r.WriteString(" />");
      if (0 < titleTokens.length) {
        r.WriteString("<figcaption>");
        r.Write(titleTokens);
        r.WriteString("</figcaption>");
      }
      r.WriteString("</figure>");

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
    return ast.WalkContinue;
  }

  renderLink(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.LinkTextAutoSpacePrevious(node);

      const dest = node.ChildByType(ast.NodeLinkDest);
      let destTokens = nodeTokens(dest!);
      if (r.Options.Sanitize) {
        let tokens = bytes.TrimSpace(destTokens);
        tokens = bytes.ToLower(tokens);
        if (bytes.HasPrefix(tokens, javascriptColonBytes)) {
          destTokens = emptyBytes; // Go: nil
        }
      }
      destTokens = r.LinkPath(destTokens);
      const attrs = [["href", util.BytesToStr(html.EscapeHTML(destTokens))]];
      const title = node.ChildByType(ast.NodeLinkTitle);
      if (null !== title && null !== title.Tokens) {
        attrs.push(["title", util.BytesToStr(html.EscapeHTML(nodeTokens(title)))]);
      }
      r.Tag("a", attrs, false);
    } else {
      r.Tag("/a", null, false);

      r.LinkTextAutoSpaceNext(node);
    }
    return ast.WalkContinue;
  }

  renderHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderInlineHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let tokens = nodeTokens(node);
      if (r.Options.Sanitize) {
        tokens = sanitize(tokens);
      }
      r.Write(tokens);
    }
    return ast.WalkContinue;
  }

  renderDocument(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderParagraph(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      const attrs: string[][] = [];
      attrs.push(...(node.KramdownIAL ?? []));
      r.Tag("p", attrs, false);
      if (r.Options.ChineseParagraphBeginningSpace && ast.NodeDocument === node.Parent!.Type) {
        if (!r.ParagraphContainImgOnly(node)) {
          r.WriteString("　　");
        }
      }
    } else {
      r.Tag("/p", null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderText(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderCodeSpan(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderCodeSpanOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("code", node.Parent!.KramdownIAL, false);
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
    }
    return ast.WalkContinue;
  }

  renderEmphasis(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.TextAutoSpacePrevious(node);
    } else {
      r.TextAutoSpaceNext(node);
    }
    return ast.WalkContinue;
  }

  renderEmAsteriskOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("em", node.Parent!.KramdownIAL, false);
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
      r.Tag("em", node.Parent!.KramdownIAL, false);
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
    if (entering) {
      r.TextAutoSpacePrevious(node);
    } else {
      r.TextAutoSpaceNext(node);
    }
    return ast.WalkContinue;
  }

  renderStrongA6kOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("strong", node.Parent!.KramdownIAL, false);
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
      r.Tag("strong", node.Parent!.KramdownIAL, false);
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
      r.Newline();
      r.Tag("blockquote", node.KramdownIAL, false);
      r.Newline();
    } else {
      r.Newline();
      r.WriteString("</blockquote>");
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderBlockquoteMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderHeading(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      const level = headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1);
      r.WriteString("<h" + level);
      for (const attr of node.KramdownIAL ?? []) {
        r.WriteString(" " + attr[0] + "=\"" + attr[1] + "\"");
      }
      r.WriteString(">");
    } else {
      if (r.Options.HeadingAnchor) {
        const id = HeadingID(node);
        r.Tag("a", [["id", "vditorAnchor-" + id], ["class", "vditor-anchor"], ["href", "#" + id]], false);
        r.WriteString(`<svg viewBox="0 0 16 16" version="1.1" width="16" height="16"><path fill-rule="evenodd" d="M4 9h1v1H4c-1.5 0-3-1.69-3-3.5S2.55 3 4 3h4c1.45 0 3 1.69 3 3.5 0 1.41-.91 2.72-2 3.25V8.59c.58-.45 1-1.27 1-2.09C10 5.22 8.98 4 8 4H4c-.98 0-2 1.22-2 2.5S3 9 4 9zm9-3h-1v1h1c1 0 2 1.22 2 2.5S13.98 12 13 12H9c-.98 0-2-1.22-2-2.5 0-.83.42-1.64 1-2.09V6.25c-1.09.53-2 1.84-2 3.25C6 11.31 7.55 13 9 13h4c1.45 0 3-1.69 3-3.5S14.5 6 13 6z"></path></svg>`);
        r.Tag("/a", null, false);
      }
      r.WriteString("</h" + headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1) + ">");
      r.Newline();
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
    let tag = "ul";
    if (1 === node.ListData!.Typ) {
      tag = "ol";
    } else if (3 === node.ListData!.Typ) {
      tag = "ul";
    }

    if (entering) {
      r.Newline();
      const attrs: string[][] = [];
      r.renderListStyle(node, attrs);
      if (0 === node.ListData!.BulletChar && 1 !== node.ListData!.Start) {
        attrs.push(["start", strconv.Itoa(node.ListData!.Start)]);
      }
      attrs.push(...(node.KramdownIAL ?? []));
      r.Tag(tag, attrs, false);
      r.Newline();
    } else {
      r.Newline();
      r.Tag("/"+tag, null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderListItem(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const attrs: string[][] = [];
      attrs.push(...(node.KramdownIAL ?? []));
      r.Tag("li", attrs, false);
    } else {
      r.Tag("/li", null, false);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderTaskListItemMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (r.NormalizedTaskListItemChecked(node)) {
        const text = new ast.Node();
        text.Type = ast.NodeText;
        text.Tokens = conv.BytesFromString("☑ ");
        node.Next!.PrependChild(text);
      } else {
        const text = new ast.Node();
        text.Type = ast.NodeText;
        text.Tokens = conv.BytesFromString("☐ ");
        node.Next!.PrependChild(text);
      }
    }
    return ast.WalkContinue;
  }

  renderThematicBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Newline();
      r.Tag("hr", null, true);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderHardBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("br", null, true);
      r.Newline();
    }
    return ast.WalkContinue;
  }

  renderSoftBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  spanNodeAttrs(node: ast.Node, attrs: string[][]): void {
    const r = this;
    attrs.push(...(node.KramdownIAL ?? []));
  }
}

export function NewProtyleExportDocxRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): ProtyleExportDocxRenderer {
  const ret = new ProtyleExportDocxRenderer(tree, options, parseOptions);
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
  ret.RendererFuncs.set(ast.NodeTabs, ret.renderTabsDocx.bind(ret));
  ret.RendererFuncs.set(ast.NodeTabItem, ret.renderTabsDocx.bind(ret));
  return ret;
}
