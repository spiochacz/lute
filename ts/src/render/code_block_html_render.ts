// Ported from render/code_block_html_renderjs.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

// PORT-NOTE: this is the javascript build variant (Go's "+build javascript", no syntax highlighting).
// The !javascript variant, render/code_block_html_render.go (chroma), is not ported.

import * as conv from "../runtime/conv.ts";
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import * as lex from "../lex/index.ts";
import { HtmlRenderer } from "./types.ts";
import { EChartsMindmap } from "./mindmap.ts";
import { NoHighlight, nodeTokens } from "./renderer.ts";

declare module "./types.ts" {
  interface HtmlRenderer {
    renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus;
    renderCodeBlockCode(node: ast.Node, entering: boolean): ast.WalkStatus;
  }
}

// renderCodeBlock renders a code block as HTML, without syntax highlighting.
HtmlRenderer.prototype.renderCodeBlock = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  r.Newline();

  if (!node.IsFencedCodeBlock) {
    if (entering) {
      // Indented code block
      r.WriteString("<pre><code>");
      r.Write(html.EscapeHTML(nodeTokens(node.FirstChild!)));
      r.WriteString("</code></pre>");
      r.Newline();
      return ast.WalkSkipChildren;
    } else {
      return ast.WalkContinue;
    }
  }
  return ast.WalkContinue;
};

HtmlRenderer.prototype.renderCodeBlockCode = function (this: HtmlRenderer, node: ast.Node, entering: boolean): ast.WalkStatus {
  const r = this;
  let language = "";
  if (0 < node.Previous!.CodeBlockInfo.length) {
    const infoWords = lex.Split(node.Previous!.CodeBlockInfo, lex.ItemSpace);
    language = conv.StringFromBytes(infoWords[0]);
  }
  const preDiv = NoHighlight(language) && !(r.Options.ProtyleWYSIWYG && language === "mindmap");

  if (entering) {
    r.Newline();
    const attrs: string[][] = [];
    r.handleKramdownBlockIAL(node);
    attrs.push(...(node.KramdownIAL ?? []));
    if (!preDiv) {
      r.Tag("pre", attrs, false);
    }
    let tokens = nodeTokens(node);
    if (0 < node.Previous!.CodeBlockInfo.length) {
      if ("mindmap" === language && preDiv) {
        const json = EChartsMindmap(tokens);
        r.WriteString("<div data-code=\"");
        r.Write(json);
        r.WriteString("\" class=\"language-mindmap\">");
      } else {
        if (preDiv) {
          r.WriteString("<div class=\"language-" + language + "\">");
        } else {
          r.WriteString("<code class=\"language-" + language + "\">");
        }
      }
      tokens = html.EscapeHTML(tokens);
      r.Write(tokens);
    } else {
      r.WriteString("<code>");
      tokens = html.EscapeHTML(tokens);
      r.Write(tokens);
    }
  } else {
    if (preDiv) {
      r.WriteString("</div>");
    } else {
      r.WriteString("</code></pre>");
    }
    r.Newline();
  }
  return ast.WalkContinue;
};
