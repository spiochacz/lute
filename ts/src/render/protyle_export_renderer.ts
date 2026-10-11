// Ported from render/protyle_export_renderer.go @ 8e7896b6
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
import { NewProtylePreviewRenderer } from "./protyle_preview_renderer.ts";

const emptyBytes: Uint8Array = new Uint8Array(0);
const imgSrcPrefix: Uint8Array = conv.BytesFromString("<img src=");
const assetsPrefix: Uint8Array = conv.BytesFromString("assets/");
const apiIconPrefix: Uint8Array = conv.BytesFromString("api/icon/");
const footnotesDefsDivBytes: Uint8Array = conv.BytesFromString("<div class=\"footnotes-defs-div\">");
const tbodyTableCloseBytes: Uint8Array = conv.BytesFromString("</tbody>\n</table>");
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance.
export class ProtyleExportRenderer extends BaseRenderer {
  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
  }

  renderCallout(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const attrs = [
        ["contenteditable", "false"],
        ["data-subtype", html.EscapeHTMLStr(node.CalloutType)],
      ];
      r.blockNodeAttrs(node, attrs, "callout");
      r.Tag("div", attrs, false);
      r.WriteString("<div class=\"callout-info\"><span class=\"callout-icon\">");
      if (0 === node.CalloutIconType) {
        r.WriteString(node.CalloutIcon);
      } else if (1 === node.CalloutIconType) {
        r.WriteString("<img class=\"callout-img\" src=\"");
        r.WriteString(html.EscapeHTMLStr(node.CalloutIcon));
        r.WriteString("\" />");
      }

      r.WriteString("</span><span class=\"callout-title\">");
      const title = calloutDisplayTitle(node);
      r.WriteString(title);
      r.WriteString("</span></div>");
      r.WriteString("<div class=\"callout-content\">");
    } else {
      r.WriteString("</div>");
      r.renderIAL(node);
      r.WriteString("</div>");
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
        const strong = node.ContainTextMarkTypes("strong");
        if (strong) {
          r.Tag("strong", null, false);
        }
        const em = node.ContainTextMarkTypes("em");
        if (em) {
          r.Tag("em", null, false);
        }
        const sup = node.ContainTextMarkTypes("sup");
        if (sup) {
          r.Tag("sup", null, false);
        }

        let attrs = [["href", node.TextMarkAHref]];
        if ("" !== node.TextMarkATitle) {
          attrs.push(["title", node.TextMarkATitle]);
        }
        r.spanNodeAttrs(node, attrs);
        if ("" !== node.TextMarkType) {
          attrs.push(["data-type", node.TextMarkType]);
        }
        if ("" !== node.TextMarkBlockRefSubtype) {
          attrs.push(["data-subtype", node.TextMarkBlockRefSubtype]);
        }
        r.Tag("a", attrs, false);
        r.WriteString(textContent);
        r.WriteString("</a>");

        if (sup) {
          r.Tag("/sup", null, false);
        }
        if (em) {
          r.Tag("/em", null, false);
        }
        if (strong) {
          r.Tag("/strong", null, false);
        }

        if ("" !== node.TextMarkInlineMemoContent) {
          const lastRune = utf8.DecodeLastRuneInString(textContent)[0];
          if (isCJK(lastRune)) {
            r.WriteString("<sup>（");
            let memo = node.TextMarkInlineMemoContent;
            memo = strings.ReplaceAll(memo, editor.IALValEscNewLine, " ");
            r.WriteString(memo);
            r.WriteString("）</sup>");
          } else {
            r.WriteString("<sup>(");
            let memo = node.TextMarkInlineMemoContent;
            memo = strings.ReplaceAll(memo, editor.IALValEscNewLine, " ");
            r.WriteString(memo);
            r.WriteString(")</sup>");
          }
        }
      } else {
        const attrs = r.renderTextMarkAttrs(node);
        const justInlineMemo = node.TextMarkType === "inline-memo";
        if (0 < attrs.length && !justInlineMemo) {
          r.spanNodeAttrs(node, attrs);
          r.Tag("span", attrs, false);
        }
        r.WriteString(textContent);
        if (0 < attrs.length && !justInlineMemo) {
          r.WriteString("</span>");
        }
        if ("" !== node.TextMarkInlineMemoContent) {
          const lastRune = utf8.DecodeLastRuneInString(textContent)[0];
          if (isCJK(lastRune)) {
            r.WriteString("<sup>（");
            let memo = node.TextMarkInlineMemoContent;
            memo = strings.ReplaceAll(memo, editor.IALValEscNewLine, " ");
            r.WriteString(memo);
            r.WriteString("）</sup>");
          } else {
            r.WriteString("<sup>(");
            let memo = node.TextMarkInlineMemoContent;
            memo = strings.ReplaceAll(memo, editor.IALValEscNewLine, " ");
            r.WriteString(memo);
            r.WriteString(")</sup>");
          }
        }
      }
    }
    return ast.WalkContinue;
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

  renderBlockQueryEmbed(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const script = node.ChildByType(ast.NodeBlockQueryEmbedScript);
      if (null === script) {
        return ast.WalkContinue;
      }
      const attrs: string[][] = [];
      let tokens = nodeTokens(script);
      tokens = html.EscapeHTML(bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes));
      attrs.push(["data-content", util.BytesToStr(tokens)]);
      r.blockNodeAttrs(node, attrs, "render-node");
      r.Tag("div", attrs, false);
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderBlockQueryEmbedScript(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderVideo(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const attrs: string[][] = [];
      r.blockNodeAttrs(node, attrs, "iframe");
      r.Tag("div", attrs, false);
      r.Tag("div", [["class", "iframe-content"]], false);
      let tokens = bytes.ReplaceAll(nodeTokens(node), editor.CaretTokens, emptyBytes);
      if (r.Options.Sanitize) {
        tokens = sanitize(tokens);
      }
      const dataSrc = r.tagSrc(tokens);
      const src = r.LinkPath(dataSrc ?? emptyBytes);
      tokens = r.replaceSrc(tokens, conv.StringFromBytes(src));
      r.Write(tokens);
    } else {
      r.Tag("span", [["class", "protyle-action__drag"], ["contenteditable", "false"]], false);
      r.Tag("/span", null, false);
      r.WriteString(editor.Zwsp);
      r.Tag("/div", null, false);
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderAudio(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const attrs: string[][] = [];
      r.blockNodeAttrs(node, attrs, "iframe");
      r.Tag("div", attrs, false);
      r.Tag("div", [["class", "iframe-content"]], false);
      let tokens = bytes.ReplaceAll(nodeTokens(node), editor.CaretTokens, emptyBytes);
      if (r.Options.Sanitize) {
        tokens = sanitize(tokens);
      }
      const dataSrc = r.tagSrc(tokens);
      const src = r.LinkPath(dataSrc ?? emptyBytes);
      tokens = r.replaceSrc(tokens, conv.StringFromBytes(src));
      r.Write(tokens);
      r.WriteString(editor.Zwsp);
    } else {
      r.Tag("/div", null, false);
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderWidget(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const attrs: string[][] = [];
      r.blockNodeAttrs(node, attrs, "iframe");
      attrs.push(["data-subtype", "widget"]);
      r.Tag("div", attrs, false);
      r.Tag("div", [["class", "iframe-content"]], false);
      let tokens = bytes.ReplaceAll(nodeTokens(node), editor.CaretTokens, emptyBytes);
      if (r.Options.Sanitize) {
        tokens = sanitize(tokens);
      }
      const dataSrc = r.tagSrc(tokens);
      const src = r.LinkPath(dataSrc ?? emptyBytes);
      tokens = r.replaceSrc(tokens, conv.StringFromBytes(src));
      r.Write(tokens);
    } else {
      r.Tag("span", [["class", "protyle-action__drag"], ["contenteditable", "false"]], false);
      r.Tag("/span", null, false);
      r.Tag("/div", null, false);
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderIFrame(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const attrs: string[][] = [];
      r.blockNodeAttrs(node, attrs, "iframe");
      r.Tag("div", attrs, false);
      r.Tag("div", [["class", "iframe-content"]], false);
      let tokens = bytes.ReplaceAll(nodeTokens(node), editor.CaretTokens, emptyBytes);
      if (r.Options.Sanitize) {
        tokens = sanitize(tokens);
      }
      const dataSrc = r.tagSrc(tokens);
      const src = r.LinkPath(dataSrc ?? emptyBytes);
      tokens = r.replaceSrc(tokens, conv.StringFromBytes(src));
      r.Write(tokens);
    } else {
      r.Tag("span", [["class", "protyle-action__drag"], ["contenteditable", "false"]], false);
      r.Tag("/span", null, false);
      r.Tag("/div", null, false);
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderBlockRef(node: ast.Node, entering: boolean): ast.WalkStatus {
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
      const attrs = [["data-type", "block-ref"], ["data-subtype", subtype], ["data-id", idNode!.TokensStr()]];
      r.Tag("span", attrs, false);
      r.WriteString(refText);
      r.Tag("/span", null, false);
      return ast.WalkSkipChildren;
    }
    return ast.WalkContinue;
  }

  escapeRefText(refText: string): string {
    const r = this;
    refText = strings.ReplaceAll(refText, ">", "&gt;");
    refText = strings.ReplaceAll(refText, "<", "&lt;");
    refText = strings.ReplaceAll(refText, "\"", "&quot;");
    refText = strings.ReplaceAll(refText, "'", "&apos;");
    return refText;
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
    return ast.WalkContinue;
  }

  renderBlockRefDynamicText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderFileAnnotationRef(node: ast.Node, entering: boolean): ast.WalkStatus {
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
      const attrs = [["data-type", "file-annotation-ref"], ["data-subtype", "s"], ["data-id", html.EscapeHTMLStr(id)]];
      r.Tag("span", attrs, false);
      r.WriteString(refText);
      r.Tag("/span", null, false);
      return ast.WalkSkipChildren;
    }
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
    return ast.WalkContinue;
  }

  renderGitConflictCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderGitConflictContent(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderGitConflictOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderGitConflict(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
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
      let content = node.Parent!.Text();
      content = strings.ReplaceAll(content, editor.Caret, "");
      r.Tag("span", [["data-type", "tag"], ["data-content", content]], false);
    }
    return ast.WalkContinue;
  }

  renderTagCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderSuperBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      if (null === node.FirstChild) {
        return ast.WalkContinue;
      }

      const attrs: string[][] = [];
      r.blockNodeAttrs(node, attrs, "sb");
      let layout = node.FirstChild!.Next!.TokensStr();
      if ("" === layout) {
        layout = "row";
      }
      attrs.push(["data-sb-layout", layout]);
      r.Tag("div", attrs, false);
    } else {
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderSuperBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderSuperBlockLayoutMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderSuperBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
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
      if (null === node.FirstChild) {
        return ast.WalkContinue;
      }

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
      r.Tag("mark", null, false);
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
      r.Tag("mark", null, false);
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
    if (entering) {
      r.TextAutoSpacePrevious(node);
    } else {
      r.TextAutoSpaceNext(node);
    }
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
    if (entering) {
      r.TextAutoSpacePrevious(node);
    } else {
      r.TextAutoSpaceNext(node);
    }
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

  renderYamlFrontMatterCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderYamlFrontMatterContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    r.Tag("div", [["class", "protyle-action"]], false);
    let attrs = [["class", "protyle-action--first protyle-action__language"], ["contenteditable", "false"]];
    r.Tag("span", attrs, false);
    r.WriteString("yaml");
    r.Tag("/span", null, false);
    r.WriteString("<span class=\"fn__flex-1\"></span>");
    r.Tag("span", [["class", "protyle-icon protyle-icon--only protyle-action__copy"]], false);
    r.WriteString("<svg><use xlink:href=\"#iconCopy\"></use></svg>");
    r.Tag("/span", null, false);
    r.Tag("/div", null, false);

    attrs = [["class", "hljs"]];
    r.contenteditable(node, attrs);
    r.spellcheck(attrs);
    r.Tag("div", attrs, false);
    r.Write(html.EscapeHTML(nodeTokens(node)));
    r.Tag("/div", null, false);
    return ast.WalkContinue;
  }

  renderYamlFrontMatterOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderYamlFrontMatter(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const attrs = [["linenumber", "false"], ["ligatures", "false"]];
      r.blockNodeAttrs(node, attrs, "code-block");
      r.Tag("div", attrs, false);
    } else {
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderHtmlEntity(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    r.WriteString("<span class=\"protyle-wysiwyg__block\" data-type=\"html-entity\">");
    r.Tag("code", [["data-type", "html-entity"], ["style", "display: none"]], false);
    const tokens = node.HtmlEntityTokens;
    r.Write(html.EscapeHTML(tokens));
    r.WriteString("</code>");

    r.Tag("span", [["class", "protyle-wysiwyg__preview"], ["data-render", "2"]], false);
    r.Tag("code", null, false);
    const previewTokens = bytes.ReplaceAll(node.HtmlEntityTokens, editor.CaretTokens, emptyBytes);
    r.Write(previewTokens);
    r.Tag("/code", null, false);
    r.Tag("/span", null, false);
    r.WriteString("</span>");
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
    } else {
      r.WriteString("</span>");
    }
    return ast.WalkContinue;
  }

  renderToC(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return BaseRenderer.prototype.renderToC.call(r, node, entering);
  }

  renderFootnotesDefBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!r.Tree.ExistFootnotesDef()) {
      return ast.WalkContinue;
    }

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
      const inlineHTML = new ast.Node();
      inlineHTML.Type = ast.NodeInlineHTML;
      inlineHTML.Tokens = conv.BytesFromString("<span id=\"footnotes-def-" + node.FootnotesRefId + "\"></span>");
      node.FirstChild!.PrependChild(inlineHTML);
      // The back-jump ID would be duplicated, so it is left out for now
      //gotoRef := " <a href=\"#footnotes-ref-" + node.FootnotesRefId + "\" class=\"vditor-footnotes__goto-ref\">↩</a>"
      //link := &ast.Node{Type: ast.NodeInlineHTML, Tokens: util.StrToBytes(gotoRef)}
      //node.FirstChild!.AppendChild(link)
    } else {
      r.WriteString("</li>\n");
    }
    return ast.WalkContinue;
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

  renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    let noHighlight = false;
    let language = "";
    if (null !== node.FirstChild && null !== node.FirstChild!.Next && 0 < node.FirstChild!.Next!.CodeBlockInfo.length) {
      language = util.BytesToStr(node.FirstChild!.Next!.CodeBlockInfo);
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
        let tokens = html.EscapeHTML(nodeTokens(node.FirstChild!.Next!.Next!));
        tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
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
  }

  renderCodeBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderCodeBlockInfoMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderCodeBlockCode(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    r.Tag("div", [["class", "protyle-action"]], false);
    const codeLen = nodeTokens(node).length;
    const codeIsEmpty = 1 > codeLen || (editor.Caret.length === codeLen && editor.Caret === conv.StringFromBytes(nodeTokens(node)));
    let language = "";
    let caretInInfo = false;
    if (null !== node.Previous) {
      caretInInfo = bytes.Contains(node.Previous!.CodeBlockInfo, editor.CaretTokens);
      node.Previous!.CodeBlockInfo = bytes.ReplaceAll(node.Previous!.CodeBlockInfo, editor.CaretTokens, emptyBytes);
    }

    let attrs = [["class", "protyle-action--first protyle-action__language"], ["contenteditable", "false"]];
    if (null !== node.Previous && 0 < node.Previous!.CodeBlockInfo.length) {
      const infoWords = lex.Split(node.Previous!.CodeBlockInfo, lex.ItemSpace);
      language = conv.StringFromBytes(infoWords[0]);
    }

    r.Tag("span", attrs, false);
    r.WriteString(language);
    r.Tag("/span", null, false);
    r.WriteString("<span class=\"fn__flex-1\"></span>");
    r.Tag("span", [["class", "protyle-icon protyle-icon--only protyle-action__copy"]], false);
    r.WriteString("<svg><use xlink:href=\"#iconCopy\"></use></svg>");
    r.Tag("/span", null, false);
    r.Tag("/div", null, false);

    attrs = [["class", "hljs"]];
    r.Tag("div", attrs, false);
    r.Tag("div", null, false);
    r.Tag("/div", null, false);
    r.Tag("div", [["contenteditable", "false"], ["style", "flex: 1"], ["spellcheck", "false"]], false);
    if (codeIsEmpty) {
      if (caretInInfo) {
        r.WriteString(editor.FrontEndCaret);
      }
    } else {
      r.Write(html.EscapeHTML(nodeTokens(node)));
    }
    r.Tag("/div", null, false);
    r.Tag("/div", null, false);
    return ast.WalkContinue;
  }

  renderCodeBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
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
      const dataSrc = r.tagSrc(nodeTokens(node));
      const src = r.LinkPath(dataSrc!.subarray(1));
      const tokens = bytes.ReplaceAll(nodeTokens(node), dataSrc!, src);
      r.Write(tokens);
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

  renderInlineMath(node: ast.Node, entering: boolean): ast.WalkStatus {
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

  renderInlineMathOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let tokens = html.EscapeHTML(nodeTokens(node.Next!));
      tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
      r.Tag("span", [["data-type", "inline-math"], ["data-subtype", "math"], ["data-content", util.BytesToStr(tokens)], ["contenteditable", "false"], ["class", "render-node"]], false);
    }
    return ast.WalkContinue;
  }

  renderInlineMathContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderInlineMathCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.Tag("/span", null, false);
      if (bytes.Contains(nodeTokens(node.Previous!), editor.CaretTokens)) {
        r.WriteString(editor.Caret);
      }
    }
    return ast.WalkContinue;
  }

  renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (!entering) {
      return ast.WalkContinue;
    }

    if (null === node.FirstChild) {
      return ast.WalkContinue;
    }

    const attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "render-node");
    let tokens = html.EscapeHTML(nodeTokens(node.FirstChild!.Next!));
    tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
    tokens = bytes.TrimSpace(tokens);
    attrs.push(["data-content", util.BytesToStr(tokens)]);
    attrs.push(["data-subtype", "math"]);
    r.Tag("div", attrs, false);
    r.Tag("div", [["spin", "1"]], false);
    r.Tag("/div", null, false);
    r.renderIAL(node);
    r.Tag("/div", null, false);
    return ast.WalkContinue;
  }

  renderMathBlockOpenMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderMathBlockContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderMathBlockCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
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
      r.Tag("colgroup", null, false);
      const colgroup = node.Parent!.IALAttr("colgroup");
      if ("" === colgroup) {
        for (let th = node.FirstChild!.FirstChild; null !== th; th = th.Next) {
          if (ast.NodeTableCell === th.Type) {
            let style = th.IALAttr("style");
            if ("" !== style) {
              r.Tag("col", [["style", style]], true);
            } else {
              r.Tag("col", null, true);
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
  }

  renderTable(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (null === node.FirstChild) {
      return ast.WalkSkipChildren;
    }

    // PORT-NOTE: Go's `defer stubDefBlock.Unlink()` runs when the function returns, so the body is wrapped in try/finally.
    let stubDefBlock: ast.Node | null = null;
    try {
      const isHtmlTable = r.needUseHTMLTable(node);
      if (entering) {
        let attrs: string[][] = [];
        r.blockNodeAttrs(node, attrs, "table");
        r.Tag("div", attrs, false);
        attrs = [["contenteditable", "false"]];
        r.Tag("div", attrs, false);
        attrs = [];
        r.contenteditable(node, attrs);
        r.spellcheck(attrs);

        if (isHtmlTable) {
          const subTree = new parse.Tree();
          subTree.Root = node;
          subTree.Context = r.Tree.Context;
          const defBlock = r.Tree.Root!.ChildByType(ast.NodeFootnotesDefBlock);
          if (null !== defBlock) {
            // Use a footnotes definition stub that carries only the labels to keep the lookup order, so the real definition block is not moved and the original syntax tree is not damaged.
            const newStubDefBlock = new ast.Node();
            newStubDefBlock.Type = ast.NodeFootnotesDefBlock;
            for (let def = defBlock.FirstChild; null !== def; def = def.Next) {
              if (ast.NodeFootnotesDef !== def.Type) {
                continue;
              }
              const stubDef = new ast.Node();
              stubDef.Type = ast.NodeFootnotesDef;
              // Go: append([]byte(nil), def.Tokens...), which is nil for empty Tokens
              stubDef.Tokens = slices.NilIfEmpty(nodeTokens(def).slice());
              stubDef.FootnotesRefId = def.FootnotesRefId;
              stubDef.FootnotesRefLabel = def.FootnotesRefLabel.slice();
              newStubDefBlock.AppendChild(stubDef);
            }
            subTree.Root!.AppendChild(newStubDefBlock);
            stubDefBlock = newStubDefBlock;
          }
          const previewRenderer = NewProtylePreviewRenderer(subTree, r.Options, r.ParseOptions);
          let output = previewRenderer.Render();
          const idx = bytes.Index(output, footnotesDefsDivBytes);
          if (-1 < idx) {
            output = output.subarray(0, idx);
            output = slices.Append(output, tbodyTableCloseBytes);
          }
          r.Write(output);
          return ast.WalkSkipChildren;
        }

        r.Tag("table", attrs, false);
      } else {
        if (!isHtmlTable) {
          if (null !== node.FirstChild!.Next) {
            r.Tag("/tbody", null, false);
          }
          r.Tag("/table", null, false);
        }

        r.WriteString("<div class=\"protyle-action__table\"><div class=\"table__resize\"></div><div class=\"table__select\"></div></div>");
        r.Tag("/div", null, false);
        r.renderIAL(node);
        r.Tag("/div", null, false);
      }
      return ast.WalkContinue;
    } finally {
      if (null !== stubDefBlock) {
        stubDefBlock.Unlink();
      }
    }
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
      r.Tag("s", null, false);
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
      r.Tag("s", null, false);
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
      if (ast.NodeImage !== node.Parent!.Type) {
        r.Write(html.EscapeHTML(nodeTokens(node)));
      }
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

  renderLess(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderGreater(node: ast.Node, entering: boolean): ast.WalkStatus {
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
      let attrs = [["contenteditable", "false"], ["data-type", "img"], ["class", "img"]];
      let parentStyle = node.IALAttr("parent-style");
      if ("" !== parentStyle) { // position set manually
        parentStyle = strings.ReplaceAll(parentStyle, "display: block;", "");
        parentStyle = strings.TrimSpace(parentStyle);
        if ("" !== parentStyle) {
          attrs.push(["style", parentStyle]);
        }
      }
      if (r.LastOut === lex.ItemNewline) {
        r.WriteString(editor.Zwsp);
      }
      r.Tag("span", attrs, false);
      r.Tag("span", null, false);
      r.WriteString(" ");
      r.Tag("/span", null, false);
      attrs = [];
      let style = node.IALAttr("style");
      if ("" !== style) {
        let styles = strings.Split(style, ";");
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
      destTokens = bytes.ReplaceAll(destTokens, editor.CaretTokens, emptyBytes);
      const dataSrcTokens = destTokens;
      const dataSrc = util.BytesToStr(dataSrcTokens);
      let src = util.BytesToStr(r.LinkPath(destTokens));
      let attrs = [["src", src], ["data-src", dataSrc]];
      const alt = node.ChildByType(ast.NodeLinkText);
      if (null !== alt && 0 < nodeTokens(alt).length) {
        attrs.push(["alt", util.BytesToStr(nodeTokens(alt))]);
      }

      const title = node.ChildByType(ast.NodeLinkTitle);
      let titleTokens: Uint8Array = new Uint8Array(0);
      if (null !== title && 0 < nodeTokens(title).length) {
        titleTokens = nodeTokens(title);
        attrs.push(["title", r.escapeRefText(conv.StringFromBytes(titleTokens))]);
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
        style = strings.ReplaceAll(style, width+";", "");
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
      r.Writer.Write(html.EscapeHTML(titleTokens));
      r.Tag("/span", null, false);
      r.Tag("/span", null, false);
      r.Tag("/span", null, false);
      r.Tag("span", null, false);
      r.WriteString(" ");
      r.Tag("/span", null, false);
      r.Tag("/span", null, false);
    }
    return ast.WalkContinue;
  }

  renderLink(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const dest = node.ChildByType(ast.NodeLinkDest);
      let destTokens = nodeTokens(dest!);
      if (r.Options.Sanitize) {
        destTokens = sanitize(destTokens);
      }

      destTokens = r.LinkPath(destTokens);

      const caretInDest = bytes.Contains(destTokens, editor.CaretTokens);
      if (caretInDest) {
        const text = node.ChildByType(ast.NodeLinkText);
        text!.AppendTokens(editor.CaretTokens);
        destTokens = bytes.ReplaceAll(destTokens, editor.CaretTokens, emptyBytes);
      }
      const attrs = [["target", "_blank"], ["href", conv.StringFromBytes(destTokens)]];
      const title = node.ChildByType(ast.NodeLinkTitle);
      if (null !== title && null !== title.Tokens) {
        attrs.push(["data-title", r.escapeRefText(conv.StringFromBytes(nodeTokens(title)))]);
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

    let attrs: string[][] = [];
    r.blockNodeAttrs(node, attrs, "render-node");
    let tokens = nodeTokens(node);
    tokens = bytes.ReplaceAll(tokens, editor.CaretTokens, emptyBytes);
    attrs.push(["data-subtype", "block"]);
    r.Tag("div", attrs, false);
    r.WriteString("<div>");
    attrs = [["data-content", util.BytesToStr(html.EscapeHTML(tokens))]];
    r.Tag("protyle-html", attrs, false);
    r.Tag("/protyle-html", null, false);
    r.WriteString("<span style=\"position: absolute\">" + editor.Zwsp + "</span>");
    r.WriteString("</div>");
    r.renderIAL(node);
    r.Tag("/div", null, false);
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
    if (node !== r.Tree.Root && node.IsTabTitleBlock()) {
      return ast.WalkSkipChildren;
    }
    if (entering) {
      let attrs: string[][] = [];
      r.blockNodeAttrs(node, attrs, "p");
      r.Tag("div", attrs, false);
      attrs = [];
      r.contenteditable(node, attrs);
      r.spellcheck(attrs);
      r.Tag("div", attrs, false);
      if (r.Options.ChineseParagraphBeginningSpace && ast.NodeDocument === node.Parent!.Type) {
        if (!r.ParagraphContainImgOnly(node)) {
          r.WriteString("　　");
        }
      }
    } else {
      r.Tag("/div", null, false);
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderText(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let tokens: Uint8Array = new Uint8Array(0);
      if (r.Options.AutoSpace && ast.NodeKbd !== node.Parent!.Type) {
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
      r.Tag("code", null, false);
    }
    return ast.WalkContinue;
  }

  renderCodeSpanContent(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      const tokens = html.EscapeHTML(nodeTokens(node));
      r.Write(tokens);
    }
    return ast.WalkContinue;
  }

  renderCodeSpanCloseMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteString("</code>");
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
      r.Tag("em", null, false);
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
      r.Tag("em", null, false);
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
      const attrs: string[][] = [];
      r.spanNodeAttrs(node.Parent!, attrs);
      r.Tag("strong", attrs, false);
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
      r.Tag("strong", null, false);
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
      const attrs: string[][] = [];
      r.blockNodeAttrs(node, attrs, "bq");
      r.Tag("div", attrs, false);
    } else {
      r.renderIAL(node);
      r.Tag("/div", null, false);
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
      let attrs: string[][] = [];
      if (6 < node.HeadingLevel) {
        node.HeadingLevel = 6;
      }
      const level = headingLevel.slice(node.HeadingLevel, node.HeadingLevel + 1);
      attrs.push(["data-subtype", "h" + level]);
      r.blockNodeAttrs(node, attrs, "h"+level);
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
      r.blockNodeAttrs(node, attrs, "list");
      r.Tag("div", attrs, false);
    } else {
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderListItem(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let cls = "li"; // PORT-NOTE: Go identifier `class` is a reserved word
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
          if (node.FirstChild !== null && node.FirstChild!.TaskListItemChecked) {
            cls += " protyle-task--done";
          }
          break;
      }
      r.blockNodeAttrs(node, attrs, cls);
      r.Tag("div", attrs, false);

      if (0 === node.ListData!.Typ) {
        let attr = [["class", "protyle-action"], ["draggable", "false"]];
        r.Tag("div", attr, false);
        r.WriteString("<svg><use xlink:href=\"#iconDot\"></use></svg>");
        r.Tag("/div", null, false);
      } else if (1 === node.ListData!.Typ) {
        const attr = [["class", "protyle-action protyle-action--order"], ["contenteditable", "false"], ["draggable", "false"]];
        r.Tag("div", attr, false);
        r.WriteString(strconv.Itoa(node.ListData!.Num) + ".");
        r.Tag("/div", null, false);
      }
    } else {
      r.renderIAL(node);
      r.Tag("/div", null, false);
    }
    return ast.WalkContinue;
  }

  renderTaskListItemMarker(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      let dataTask = "";
      if (r.Options.DataTask) {
        const marker = node.EffectiveTaskListItemMarker();
        dataTask = " data-task=\"" + marker + "\"";
      }
      if (r.NormalizedTaskListItemChecked(node)) {
        r.WriteString("<div class=\"protyle-action protyle-action--task\"" + dataTask + "><svg><use xlink:href=\"#iconCheck\"></use></svg></div>");
      } else {
        r.WriteString("<div class=\"protyle-action protyle-action--task\"" + dataTask + "><svg><use xlink:href=\"#iconUncheck\"></use></svg></div>");
      }
      if (null === node.Next) {
        const paragraph = new ast.Node();
        paragraph.ID = ast.NewNodeID();
        paragraph.Type = ast.NodeParagraph;
        node.InsertAfter(paragraph);
      }
    }
    return ast.WalkContinue;
  }

  renderThematicBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
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
  }

  renderHardBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return r.renderBr(node, entering);
  }

  renderSoftBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteByte(lex.ItemNewline);
      if (null !== node.Previous && (ast.NodeStrong === node.Previous!.Type ||
        ast.NodeEmphasis === node.Previous!.Type ||
        ast.NodeTag === node.Previous!.Type ||
        ast.NodeStrikethrough === node.Previous!.Type ||
        ast.NodeUnderline === node.Previous!.Type ||
        ast.NodeKramdownSpanIAL === node.Previous!.Type) &&
        null !== node.Next && bytes.Equal(editor.CaretTokens, nodeTokens(node.Next))) {
        r.WriteByte(lex.ItemNewline);
      }
    }
    return ast.WalkContinue;
  }

  spanNodeAttrs(node: ast.Node, attrs: string[][]): void {
    const r = this;
    attrs.push(...(node.KramdownIAL ?? []));
  }

  blockNodeAttrs(node: ast.Node, attrs: string[][], cls: string): void {
    const r = this;
    r.nodeID(node, attrs);
    r.nodeDataType(node, attrs);
    r.nodeClass(node, attrs, cls);

    for (const ial of node.KramdownIAL ?? []) {
      attrs.push([ial[0], strings.ReplaceAll(ial[1], editor.IALValEscNewLine, "\n")]);
    }
  }

  nodeClass(node: ast.Node, attrs: string[][], cls: string): void {
    const r = this;
    attrs.push(["class", cls]);
  }

  nodeDataType(node: ast.Node, attrs: string[][]): void {
    const r = this;
    attrs.push(["data-type", ast.NodeTypeString(node.Type)]);
  }

  nodeID(node: ast.Node, attrs: string[][]): void {
    const r = this;
    attrs.push(["data-node-id", r.NodeID(node)]);
  }

  spellcheck(attrs: string[][]): void {
    const r = this;
    attrs.push(["spellcheck", "false"]);
    return;
  }

  contenteditable(node: ast.Node, attrs: string[][]): void {
    const r = this;
    const contenteditable = node.IALAttr("contenteditable");
    if ("" !== contenteditable) {
      attrs.push(["contenteditable", contenteditable]);
    } else {
      attrs.push(["contenteditable", strconv.FormatBool(r.Options.ProtyleContenteditable)]);
    }
    return;
  }

  renderIAL(node: ast.Node): void {
    const r = this;
    const attrs = [["class", "protyle-attr"], ["contenteditable", "false"]];
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
      r.Tag("div", [["class", "protyle-attr--memo ariaLabel"], ["aria-label", memo], ["data-position", "north"]], false);
      r.WriteString("<svg><use xlink:href=\"#iconM\"></use></svg>");
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

    r.Tag("/div", null, false);
  }

  renderTextMarkAttrs(node: ast.Node): string[][] {
    const r = this;
    const attrs: string[][] = [["data-type", node.TextMarkType]];

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
  }
}

export function NewProtyleExportRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): ProtyleExportRenderer {
  const ret = new ProtyleExportRenderer(tree, options, parseOptions);
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
