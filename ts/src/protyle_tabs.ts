// Ported from protyle_tabs.go @ 8e7896b6

import * as bytes from "./runtime/bytes.ts";
import * as strings from "./runtime/strings.ts";
import * as ast from "./ast/index.ts";
import * as html from "./html/index.ts";
import * as parse from "./parse/index.ts";
import * as util from "./util/index.ts";
import { Lute } from "./types.ts";

declare module "./types.ts" {
  interface Lute {
    tabTitleMarkdown(title: html.Node, standardHTML: boolean): string;
    genASTByTabsDOM(dom: html.Node, tree: parse.Tree): boolean;
  }
}

// tabTitleMarkdown protects the title whitespace with boundary text, and keeps the leading and trailing spaces of the Markdown as character entities.
Lute.prototype.tabTitleMarkdown = function (this: Lute, title: html.Node, standardHTML: boolean): string {
  const lute = this;
  const dom = new bytes.Buffer();
  dom.WriteString("LuteTabTitleStart");
  for (let child = title.FirstChild; null !== child; child = child.NextSibling) {
    dom.Write(util.DomHTML(child));
  }
  dom.WriteString("LuteTabTitleEnd");
  let markdown: string;
  if (standardHTML) {
    markdown = lute.HTML2Md(dom.String());
  } else {
    markdown = lute.BlockDOM2Md(dom.String());
  }
  markdown = strings.TrimSpace(markdown);
  markdown = strings.TrimPrefix(markdown, "LuteTabTitleStart");
  markdown = strings.TrimSuffix(markdown, "LuteTabTitleEnd");
  // PORT-NOTE: the lengths below are only subtracted from each other and used as offsets into the same string, so UTF-16 lengths are consistent.
  const leading = markdown.length - strings.TrimLeft(markdown, " ").length;
  const trailing = markdown.length - strings.TrimRight(markdown, " ").length;
  if (leading === markdown.length) {
    return strings.Repeat("&#32;", leading);
  }
  return strings.Repeat("&#32;", leading) + markdown.slice(leading, markdown.length - trailing) + strings.Repeat("&#32;", trailing);
};

export function hasDOMClass(node: html.Node, name: string): boolean {
  for (const cls of strings.Fields(util.DomAttrValue(node, "class"))) {
    if (cls === name) {
      return true;
    }
  }
  return false;
}

export function directDOMChildByClass(node: html.Node, name: string): html.Node | null {
  for (let child = node.FirstChild; null !== child; child = child.NextSibling) {
    if (hasDOMClass(child, name)) {
      return child;
    }
  }
  return null;
}

Lute.prototype.genASTByTabsDOM = function (this: Lute, dom: html.Node, tree: parse.Tree): boolean {
  const lute = this;
  if (!lute.ParseOptions.Tabs || (!hasDOMClass(dom, "tabs") && !hasDOMClass(dom, "tab-item"))) {
    return false;
  }
  const node = new ast.Node(ast.NodeTabs);
  if (hasDOMClass(dom, "tab-item")) {
    node.Type = ast.NodeTabItem;
    const info = directDOMChildByClass(dom, "tab-item-info");
    if (null !== info) {
      const title = directDOMChildByClass(info, "tab-item-title");
      if (null !== title) {
        node.TabItemTitle = lute.tabTitleMarkdown(title, true);
      }
    }
  }
  for (const name of ["tabs-active-id", "tabs-position", "tabs-task"]) {
    const value = util.DomAttrValue(dom, name);
    if ("" !== value) {
      node.SetIALAttr(name, value);
    }
  }
  node.ID = util.DomAttrValue(dom, "data-node-id");
  if ("" !== node.ID) {
    node.SetIALAttr("id", node.ID);
  }
  tree.Context!.Tip!.AppendChild(node);
  tree.Context!.Tip = node;
  if (ast.NodeTabItem === node.Type) {
    const info = directDOMChildByClass(dom, "tab-item-info");
    if (null !== info) {
      for (let child = info.FirstChild; null !== child; child = child.NextSibling) {
        if ("true" === util.DomAttrValue(child, "tabs-title")) {
          lute.genASTByBlockDOM(child, tree);
          break;
        }
      }
    }
    const content = directDOMChildByClass(dom, "tab-item-content");
    if (null !== content) {
      for (let child = content.FirstChild; null !== child; child = child.NextSibling) {
        lute.genASTByDOM(child, tree);
      }
    }
  } else {
    for (let child = dom.FirstChild; null !== child; child = child.NextSibling) {
      if (hasDOMClass(child, "tab-item")) {
        lute.genASTByTabsDOM(child, tree);
      }
    }
  }
  tree.Context!.ParentTip();
  if (null !== node.KramdownIAL && 0 < node.KramdownIAL.length) {
    node.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, parse.IAL2Tokens(node.KramdownIAL)));
  }
  return true;
};

// wrapTabItemFragments adds a temporary syntax container for tab items that are edited alone, so that the inner Markdown can still be parsed completely.
export function wrapTabItemFragments(tree: parse.Tree): Map<string, boolean> {
  const wrappers = new Map<string, boolean>();
  for (let node: ast.Node | null = tree.Root!.FirstChild; null !== node;) {
    let next: ast.Node | null = node.Next;
    if (ast.NodeTabItem === node.Type) {
      if ("" === node.ID) {
        node.ID = ast.NewNodeID();
        node.SetIALAttr("id", node.ID);
      }
      const wrapper = new ast.Node(ast.NodeTabs);
      wrapper.ID = ast.NewNodeID();
      wrapper.SetIALAttr("id", wrapper.ID);
      node.InsertBefore(wrapper);
      wrapper.AppendChild(node);
      if (null !== next && ast.NodeKramdownBlockIAL === next.Type) {
        const ial: ast.Node = next;
        next = ial.Next;
        wrapper.AppendChild(ial);
      } else {
        wrapper.AppendChild(new ast.Node(ast.NodeKramdownBlockIAL, parse.IAL2Tokens(node.KramdownIAL)));
      }
      wrapper.InsertAfter(new ast.Node(ast.NodeKramdownBlockIAL, parse.IAL2Tokens(wrapper.KramdownIAL)));
      wrappers.set(wrapper.ID, true);
    }
    node = next;
  }
  return wrappers;
}

export function unwrapTabItemFragments(tree: parse.Tree, wrappers: Map<string, boolean>): void {
  for (let node: ast.Node | null = tree.Root!.FirstChild; null !== node;) {
    let next: ast.Node | null = node.Next;
    if (ast.NodeTabs === node.Type && true === wrappers.get(node.ID)) {
      for (let child: ast.Node | null = node.FirstChild; null !== child;) {
        const childNext: ast.Node | null = child.Next;
        node.InsertBefore(child);
        child = childNext;
      }
      if (null !== next && ast.NodeKramdownBlockIAL === next.Type) {
        const ial: ast.Node = next;
        next = next.Next;
        ial.Unlink();
      }
      node.Unlink();
    }
    node = next;
  }
}
