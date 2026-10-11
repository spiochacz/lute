// Ported from parse/html_text_style_inline.go @ 8e7896b6
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
import * as unicode from "../runtime/unicode.ts";
import * as ast from "../ast/index.ts";
import * as html from "../html/index.ts";
import * as atom from "../html/atom/index.ts";
import * as util from "../util/index.ts";
import { ApplyHTMLTextSemantics, ApplyHTMLTextStyle, ensureHTMLTextMark, HTMLTextStyle, ResolveHTMLTextStyle } from "./html_text_style.ts";
import { NestedInlines2FlattedSpansHybrid } from "./transform.ts";
import { Tree } from "./types.ts";

// htmlStyleFrame is a struct with a positional constructor (node, dom, style, protected) for the struct literals of the Go code; omitted arguments are the Go zero values.
class htmlStyleFrame {
  node: ast.Node | null;
  dom: html.Node | null;
  style: HTMLTextStyle;
  protected: boolean;

  constructor(node: ast.Node | null = null, dom: html.Node | null = null, style: HTMLTextStyle = new HTMLTextStyle(), protected_: boolean = false) {
    this.node = node;
    this.dom = dom;
    this.style = style;
    // PORT-NOTE: protected is a reserved word in strict mode, so the parameter is protected_; the field keeps the Go name
    this.protected = protected_;
  }
}

// PORT-NOTE: Go builds this lookup table inside the loop on every call; it is module-level here.
const inlineStyleTagTypes: Map<atom.Atom, string> = new Map([
  [atom.Strong, "strong"], [atom.B, "strong"], [atom.Em, "em"], [atom.I, "em"], [atom.S, "s"], [atom.Del, "s"], [atom.Strike, "s"],
  [atom.U, "u"], [atom.Code, "code"], [atom.A, "a"], [atom.Sub, "sub"], [atom.Sup, "sup"], [atom.Mark, "mark"], [atom.Kbd, "kbd"],
]);

function inlineStyleTag(n: ast.Node): [html.Node | null, boolean] {
  let dom: html.Node | null = null;
  let closing = false;
  if (n.Type !== ast.NodeInlineHTML) {
    return [dom, closing];
  }
  // PORT-NOTE: Go reads n.TokensStr() through strings.NewReader; the tokenizer takes the bytes here, which keeps bytes that are not valid UTF-8.
  const z = html.NewTokenizer(n.Tokens ?? new Uint8Array(0));
  const typ = z.Next();
  if (typ !== html.StartTagToken && typ !== html.EndTagToken) {
    return [dom, closing];
  }
  const tag = z.Token();
  switch (tag.DataAtom) {
    case atom.Span:
    case atom.Small:
    case atom.Font:
    case atom.Strong:
    case atom.B:
    case atom.Em:
    case atom.I:
    case atom.S:
    case atom.Del:
    case atom.Strike:
    case atom.U:
    case atom.Code:
    case atom.A:
    case atom.Sub:
    case atom.Sup:
    case atom.Mark:
    case atom.Kbd: {
      const node = new html.Node();
      node.Type = html.ElementNode;
      node.Data = tag.Data;
      node.DataAtom = tag.DataAtom;
      node.Attr = tag.Attr;
      return [node, typ === html.EndTagToken];
    }
  }
  return [dom, closing];
}

// NormalizeInlineHTMLTextStyles only converts paired inline tags, code blocks and unclosed tags are left as they are.
export function NormalizeInlineHTMLTextStyles(tree: Tree): void {
  const blocks: ast.Node[] = [];
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering && (n.Type === ast.NodeParagraph || n.Type === ast.NodeHeading || n.Type === ast.NodeTableCell)) {
      blocks.push(n);
      return ast.WalkSkipChildren;
    }
    return ast.WalkContinue;
  });
  for (const block of blocks) {
    normalizeInlineHTMLTextStyleBlock(tree, block);
  }
}

function normalizeInlineHTMLTextStyleBlock(tree: Tree, block: ast.Node): void {
  const pairs = new Map<ast.Node, ast.Node>();
  let stack: htmlStyleFrame[] = [];
  let hasStyle = false;
  ast.Walk(block, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }
    const [dom, closing] = inlineStyleTag(n);
    if (dom === null) {
      return ast.WalkContinue;
    }
    if (!closing) {
      stack.push(new htmlStyleFrame(n, dom));
    } else if (stack.length > 0 && stack[stack.length - 1].dom!.DataAtom === dom.DataAtom) {
      const open = stack[stack.length - 1];
      stack.pop();
      pairs.set(open.node!, n);
      pairs.set(n, open.node!);
      if (ResolveHTMLTextStyle(open.dom!, new HTMLTextStyle()).CSS() !== "") {
        hasStyle = true;
      }
    }
    return ast.WalkContinue;
  });
  if (!hasStyle) {
    return;
  }
  // First expand the Markdown combined formats, so the HTML style can cover every separate text fragment.
  const flatTree = new Tree();
  flatTree.Root = block;
  flatTree.Context = tree.Context;
  NestedInlines2FlattedSpansHybrid(flatTree, false);
  stack = [];
  const unlinks: ast.Node[] = [];
  ast.Walk(block, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (!entering) {
      return ast.WalkContinue;
    }
    if ((pairs.get(n) ?? null) !== null) {
      const [dom0, closing] = inlineStyleTag(n);
      const dom = dom0!;
      let protected_ = false;
      if (stack.length > 0) {
        protected_ = stack[stack.length - 1].protected;
      }
      if (closing) {
        if (stack.length > 0 && stack[stack.length - 1].node === pairs.get(n)) {
          stack.pop();
        }
      } else {
        // Native text marks and inline memos are still handled by their own parsers.
        protected_ = protected_ || util.DomAttrValue(dom, "data-type") !== "" || (dom.DataAtom === atom.Span && util.DomAttrValue(dom, "title") !== "");
        let parent = new HTMLTextStyle();
        if (stack.length > 0) {
          parent = stack[stack.length - 1].style;
          dom.Parent = stack[stack.length - 1].dom;
        }
        stack.push(new htmlStyleFrame(n, dom, ResolveHTMLTextStyle(dom, parent), protected_));
      }
      if (!protected_) {
        unlinks.push(n);
      }
      return ast.WalkContinue;
    }
    if (stack.length === 0 || stack[stack.length - 1].protected) {
      return ast.WalkContinue;
    }
    let style = stack[stack.length - 1].style;
    if (n.Type !== ast.NodeText && n.Type !== ast.NodeLinkText && n.Type !== ast.NodeTextMark && n.Type !== ast.NodeHTMLEntity) {
      return ast.WalkContinue;
    }
    const ownStyle = n.IALAttr("style");
    if (ownStyle !== "") {
      const ownNode = new html.Node();
      const ownAttr = new html.Attribute();
      ownAttr.Key = "style";
      ownAttr.Val = ownStyle;
      ownNode.Attr = [ownAttr];
      style = ResolveHTMLTextStyle(ownNode, style);
    }
    ApplyHTMLTextStyle(n, style.CSS());
    if (n.Type === ast.NodeTextMark) {
      ApplyHTMLTextSemantics(n, stack[stack.length - 1].dom!);
    }
    for (const frame of stack) {
      const typ = inlineStyleTagTypes.get(frame.dom!.DataAtom) ?? "";
      if (typ === "") {
        continue;
      }
      if (typ === "a") {
        let unsafe = false;
        for (const attr of frame.dom!.Attr) {
          if (attr.Key !== "href") {
            continue;
          }
          const href = strings.ToLower(strings.Map((r: number): number => {
            if (unicode.IsSpace(r) || unicode.IsControl(r)) {
              return -1;
            }
            return r;
          }, attr.Val));
          unsafe = strings.HasPrefix(href, "javascript:") || strings.HasPrefix(href, "vbscript:") || strings.HasPrefix(href, "data:");
        }
        if (unsafe) {
          continue;
        }
      }
      if (n.Type !== ast.NodeTextMark) {
        ensureHTMLTextMark(n);
      }
      if (!n.ContainTextMarkTypes(typ)) {
        n.TextMarkType = strings.TrimSpace(strings.TrimSuffix(n.TextMarkType, "text") + " " + typ);
      }
      if (typ === "a") {
        for (const attr of frame.dom!.Attr) {
          if (attr.Key === "href") {
            n.TextMarkAHref = attr.Val;
          }
          if (attr.Key === "title") {
            n.TextMarkATitle = attr.Val;
          }
        }
      }
    }
    return ast.WalkContinue;
  });
  for (const n of unlinks) {
    n.Unlink();
  }
}
