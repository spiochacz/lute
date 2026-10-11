// Ported from render/kityminder_json_renderer.go @ 8e7896b6
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
import * as strconv from "../runtime/strconv.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import * as parse from "../parse/index.ts";
import { BaseRenderer } from "./types.ts";
import { SubStr, nodeTokens } from "./renderer.ts";
import type { Options, Renderer } from "./renderer.ts";

// KityMinderJSONRenderer describes the KityMinder JSON renderer.
// PORT-NOTE: Go embedding, `*BaseRenderer` becomes inheritance. The methods renderDefault and renderToC are also defined by BaseRenderer;
// BaseRenderer.Render calls renderDefault only when DefaultRendererFunc is null, and it is set in NewKityMinderJSONRenderer.
export class KityMinderJSONRenderer extends BaseRenderer {
  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
  }

  renderDefault(n: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkContinue;
  }

  renderBlockQueryEmbed(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkSkipChildren;
  }

  renderYamlFrontMatter(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkSkipChildren;
  }

  renderToC(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkSkipChildren;
  }

  renderMathBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkSkipChildren;
  }

  renderTable(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkContinue;
  }

  renderHTML(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkSkipChildren;
  }

  renderParagraph(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    const grandparent = node.Parent!.Parent;
    if (null !== grandparent && ast.NodeList === grandparent.Type && grandparent.ListData!.Tight) { // List.ListItem.Paragraph
      if (node.Parent!.FirstChild === node && node.Parent!.LastChild === node) { // Do not render the paragraph when it is the only child of a ListItem
        return ast.WalkContinue;
      }
    }

    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkSkipChildren;
  }

  renderBlockquote(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkContinue;
  }

  renderSuperBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkContinue;
  }

  renderHeading(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);

      // UPSTREAM-BUG: c.Unlink() clears c.Next, so the loop ends after the first child; the other children stay under the heading
      for (let c = node.FirstChild; null !== c; c = c.Next) {
        c.Unlink();
      }

      const children = headingChildren(node);
      for (const c of children) {
        node.AppendChild(c);
      }
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkContinue;
  }

  renderList(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkContinue;
  }

  renderListItem(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkContinue;
  }

  renderThematicBreak(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkSkipChildren;
  }

  renderCodeBlock(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.comma(node);
    }
    return ast.WalkSkipChildren;
  }

  renderKramdownBlockIAL(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    return ast.WalkSkipChildren;
  }

  renderDocument(node: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    if (entering) {
      r.WriteByte(lex.ItemOpenBrace);
      r.WriteString("\"root\":");
      r.openObj();
      r.data(node);
      r.openChildren(node);
    } else {
      r.closeChildren(node);
      r.closeObj();
      r.WriteByte(lex.ItemCloseBrace);
    }
    return ast.WalkContinue;
  }

  data(node: ast.Node): void {
    const r = this;
    r.WriteString("\"data\":");
    r.openObj();

    let text = "";
    switch (node.Type) {
      case ast.NodeDocument:
        text = r.Tree.Name;
        break;
      case ast.NodeList:
        if (0 === node.ListData!.Typ) {
          r.WriteString("\"priority\": \"iconList\",");
        } else if (1 === node.ListData!.Typ) {
          r.WriteString("\"priority\": \"iconOrderedList\",");
        } else {
          r.WriteString("\"priority\": \"iconCheck\",");
        }
        break;
      case ast.NodeBlockquote:
        r.WriteString("\"priority\": \"iconQuote\",");
        break;
      case ast.NodeSuperBlock:
        r.WriteString("\"priority\": \"iconSuper\",");
        break;
      default: {
        const buf = new bytes.Buffer();
        ast.Walk(node, (n: ast.Node, entering: boolean): ast.WalkStatus => {
          if (!entering) {
            return ast.WalkContinue;
          }

          if (ast.NodeTag === n.Type) {
            buf.WriteString("#" + n.Text() + "#");
            return ast.WalkSkipChildren;
          }

          if (ast.NodeText === n.Type || ast.NodeLinkText === n.Type || ast.NodeBlockRefText === n.Type || ast.NodeBlockRefDynamicText === n.Type ||
            ast.NodeCodeSpanContent === n.Type || ast.NodeCodeBlockCode === n.Type || ast.NodeLinkTitle === n.Type || ast.NodeMathBlockContent === n.Type ||
            ast.NodeInlineMathContent === n.Type || ast.NodeYamlFrontMatterContent === n.Type) {
            buf.Write(nodeTokens(n));
          }
          return ast.WalkContinue;
        });
        text = conv.StringFromBytes(buf.Bytes());
        break;
      }
    }

    // strings.NewReplacer("\\", "", "\n", "", "\"", "", "\t", "", "'", "") removes these single characters.
    text = text.replace(/[\\\n"\t']/g, "");

    text = text.replaceAll("'", ""); // no-op after the replacer above, as in Go
    if (16 < utf8.RuneCountInString(text)) {
      text = SubStr(text, 16) + "...";
    }
    if (ast.NodeDocument === node.Type) {
      r.WriteString("\"layout\":\"right\",");
    }
    r.WriteString("\"text\":\"" + text + "\",");
    r.WriteString("\"id\":\"" + node.IALAttr("id") + "\",");
    r.WriteString("\"type\":\"" + ast.NodeTypeString(node.Type) + "\",");
    r.WriteString("\"isContainer\":" + strconv.FormatBool(node.IsContainerBlock()));
    r.closeObj();
  }

  openObj(): void {
    const r = this;
    r.WriteByte(0x7b /* { */);
  }

  closeObj(): void {
    const r = this;
    r.WriteByte(0x7d /* } */);
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

  comma(node: ast.Node): void {
    const r = this;
    let next = node.Next;
    if (null !== next) {
      for (; null !== next; next = next.Next) {
        if (ast.NodeKramdownBlockIAL !== next.Type) {
          break;
        }
      }
      if (null !== next && next.IsBlock()) {
        r.WriteString(",");
      }
    }
  }
}

const typeDocBytes: Uint8Array = conv.BytesFromString("type=\"doc\"");

function headingChildren(heading: ast.Node): ast.Node[] {
  const ret: ast.Node[] = [];
  let start: ast.Node | null = heading;
  if (null !== heading.Next && ast.NodeKramdownBlockIAL === heading.Next.Type) {
    start = heading.Next.Next;
  }
  const currentLevel = heading.HeadingLevel;
  for (let n = start; null !== n; n = n.Next) {
    if (ast.NodeHeading === n.Type) {
      if (currentLevel >= n.HeadingLevel) {
        break;
      }
    }
    if (ast.NodeKramdownBlockIAL === n.Type) {
      if (!bytes.Contains(nodeTokens(n), typeDocBytes)) {
        ret.push(n);
      }
    } else {
      ret.push(n);
    }
  }
  return ret;
}

// NewKityMinderJSONRenderer creates a KityMinder JSON renderer.
export function NewKityMinderJSONRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): Renderer {
  const ret = new KityMinderJSONRenderer(tree, options, parseOptions);
  ret.RendererFuncs.set(ast.NodeDocument, ret.renderDocument.bind(ret));
  ret.RendererFuncs.set(ast.NodeParagraph, ret.renderParagraph.bind(ret));
  ret.RendererFuncs.set(ast.NodeCodeBlock, ret.renderCodeBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeMathBlock, ret.renderMathBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockquote, ret.renderBlockquote.bind(ret));
  ret.RendererFuncs.set(ast.NodeSuperBlock, ret.renderSuperBlock.bind(ret));
  ret.RendererFuncs.set(ast.NodeHeading, ret.renderHeading.bind(ret));
  ret.RendererFuncs.set(ast.NodeList, ret.renderList.bind(ret));
  ret.RendererFuncs.set(ast.NodeListItem, ret.renderListItem.bind(ret));
  ret.RendererFuncs.set(ast.NodeMindmap, ret.renderList.bind(ret));
  ret.RendererFuncs.set(ast.NodeMindmapItem, ret.renderListItem.bind(ret));
  ret.RendererFuncs.set(ast.NodeThematicBreak, ret.renderThematicBreak.bind(ret));
  ret.RendererFuncs.set(ast.NodeHTMLBlock, ret.renderHTML.bind(ret));
  ret.RendererFuncs.set(ast.NodeTable, ret.renderTable.bind(ret));
  ret.RendererFuncs.set(ast.NodeToC, ret.renderToC.bind(ret));
  ret.RendererFuncs.set(ast.NodeYamlFrontMatter, ret.renderYamlFrontMatter.bind(ret));
  ret.RendererFuncs.set(ast.NodeBlockQueryEmbed, ret.renderBlockQueryEmbed.bind(ret));
  ret.RendererFuncs.set(ast.NodeKramdownBlockIAL, ret.renderKramdownBlockIAL.bind(ret));
  ret.DefaultRendererFunc = ret.renderDefault.bind(ret);
  return ret;
}
