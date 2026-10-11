// Ported from parse/inlines.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as slices from "../runtime/slices.ts";
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import * as util from "../util/index.ts";
import { IAL2Tokens, Tokens2IAL, mergeIALPreservingOrder } from "./inline_attribute_list.ts";
import { NormalizeInlineHTMLTextStyles } from "./html_text_style_inline.ts";
import { InlineContext } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseInlines(): void;
    walkParseInline(node: ast.Node | null): void;
  }
}

const openBracesTokens: Uint8Array = util.StrToBytes("{{{");

// parseInlines parses and generates inline-level nodes.
Tree.prototype.parseInlines = function (this: Tree): void {
  const t = this;
  t.walkParseInline(t.Root);

  if (t.Context!.ParseOption.KramdownSpanIAL) {
    t.parseKramdownSpanIAL();
  }
  if (t.Context!.ParseOption.ProtyleWYSIWYG) {
    NormalizeInlineHTMLTextStyles(t);
  }
};

// walkParseInline parses and generates the inline-level child nodes of node.
Tree.prototype.walkParseInline = function (this: Tree, node: ast.Node | null): void {
  const t = this;
  if (null === node) {
    return;
  }

  let typ = node.Type;

  if (ast.NodeSuperBlock === typ) {
    if (null !== node.LastChild && ast.NodeSuperBlockLayoutMarker === node.LastChild.Type) {
      node.Type = ast.NodeParagraph;
      node.Tokens = slices.Append(openBracesTokens.slice(), node.LastChild.Tokens ?? new Uint8Array(0));
      node.FirstChild!.Unlink();
      node.LastChild.Unlink();
      typ = ast.NodeParagraph;
    }
  }

  // Only the following block node types need inline-level child nodes
  if (ast.NodeParagraph === typ || ast.NodeHeading === typ || ast.NodeTableCell === typ) {
    const tokens = node.Tokens;
    if (ast.NodeParagraph === typ) {
      if (null === tokens && null === node.FirstChild) {
        if (ast.NodeTabItem !== node.Parent!.Type && (ast.NodeListItem !== node.Parent!.Type ||
          t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV)) {
          // After a GFM table node is parsed the paragraph Tokens may be replaced with empty, see Paragraph.Finalize()
          // Remove the empty paragraph node from the syntax tree here
          const next = node.Next;
          node.Unlink();
          // Unlink clears the next sibling. The tree is modified during the traversal, so keep iterating over the following siblings
          node.Next = next;
        }
        return;
      } else {
        const ial = t.Context!.parseKramdownIALInListItem(tokens);
        if (null !== ial && 0 < ial.length) {
          if (null !== node.Previous) {
            // Parsing a kramdown list or block quote may leave the marker empty (* \n{id:foo} or >\n{: custom-b="info" }), in which case the IAL must be merged
            for (const kv of ial) {
              node.Previous.SetIALAttr(kv[0], html.UnescapeAttrVal(kv[1]));
            }
            const next = node.Next;
            node.Unlink();
            node.Next = next;
            if (null !== node.Next && ast.NodeKramdownBlockIAL === node.Next.Type) {
              node.Next.Tokens = IAL2Tokens(mergeIALPreservingOrder(Tokens2IAL(node.Next.Tokens), ial));
            }
            return;
          }
        }
      }
    }

    const length = null === tokens ? 0 : tokens.length;
    if (1 > length) {
      return;
    }

    const ctx = new InlineContext();
    ctx.tokens = tokens!;
    ctx.tokensLen = length;

    // Generate the inline-level child nodes of this block node
    t.parseInline(node, ctx);

    // Handle emphasis, strong and strikethrough in this block node
    t.processEmphasis(null, ctx);

    // Merge consecutive text nodes.
    // The spec only defines the parse and render rules from the input Markdown text to the output HTML, not the intermediate syntax tree.
    // That is, there is no standard for the node structure of the syntax tree, so it can be shaped freely. Merging text nodes has two main purposes:
    // 1. Reduce the number of nodes and improve the performance of later processing
    // 2. Ease later features, such as GFM autolink parsing
    t.mergeText(node);

    const editorMode = t.Context!.ParseOption.VditorWYSIWYG || t.Context!.ParseOption.VditorIR || t.Context!.ParseOption.VditorSV || t.Context!.ParseOption.ProtyleWYSIWYG;
    const protyleAutoLink = t.Context!.ParseOption.ProtyleWYSIWYG && t.Context!.ParseOption.ProtyleWYSIWYGAutoLink;
    if ((t.Context!.ParseOption.GFMAutoLink && !editorMode) || protyleAutoLink) {
      t.parseGFMAutoEmailLink(node);
      t.parseGFMAutoLink(node);
    }

    if (t.Context!.ParseOption.Emoji) {
      t.emoji(node);
    }
    return;
  } else if (ast.NodeCodeBlock === typ) {
    if (node.IsFencedCodeBlock) {
      // Refine the child nodes of a fenced code block
      const openMarker = new ast.Node(ast.NodeCodeBlockFenceOpenMarker, node.CodeBlockOpenFence);
      openMarker.CodeBlockFenceLen = node.CodeBlockFenceLen;
      node.PrependChild(openMarker);
      const info = new ast.Node(ast.NodeCodeBlockFenceInfoMarker);
      info.CodeBlockInfo = node.CodeBlockInfo;
      node.AppendChild(info);
      const code = new ast.Node(ast.NodeCodeBlockCode, node.Tokens);
      node.AppendChild(code);
      if (null === node.CodeBlockCloseFence) {
        node.CodeBlockCloseFence = node.CodeBlockOpenFence;
      }
      const closeMarker = new ast.Node(ast.NodeCodeBlockFenceCloseMarker, node.CodeBlockCloseFence);
      closeMarker.CodeBlockFenceLen = node.CodeBlockFenceLen;
      node.AppendChild(closeMarker);
    } else {
      // Refine the child nodes of an indented code block
      const code = new ast.Node(ast.NodeCodeBlockCode, node.Tokens);
      node.AppendChild(code);
    }
    node.Tokens = null;
  }

  // Walk and process the child nodes
  for (let child = node.FirstChild; null !== child; child = child.Next) {
    t.walkParseInline(child);
  }
};
