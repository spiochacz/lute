// Ported from parse/tabs.go @ 8e7896b6

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as strings from "../runtime/strings.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import { IAL2Tokens } from "./inline_attribute_list.ts";
import { Context, Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    finalParseTabs(): void;
  }
  interface Context {
    tabsContinue(node: ast.Node): number;
    tabsFinalize(node: ast.Node): void;
  }
}

const tabsTokens: Uint8Array = conv.BytesFromString("tabs");

export class tabsParseState {
  fenceLen: number;
  indent: number;
  active: ast.Node | null;

  constructor() {
    this.fenceLen = 0;
    this.indent = 0;
    this.active = null;
  }
}

// TabsStart parses tab fences and separators; leaf blocks such as code are protected by the block parsing flow.
export function TabsStart(t: Tree, container: ast.Node): number {
  const context = t.Context!;
  if (!context.ParseOption.Tabs) {
    return 0;
  }
  const line: Uint8Array = lex.TrimWhitespace(context.currentLine.subarray(context.nextNonspace)) ?? new Uint8Array(0);
  let fenceLen = 0;
  for (; fenceLen < line.length && 0x3a /* : */ === line[fenceLen];) {
    fenceLen++;
  }
  if (3 <= fenceLen) {
    if (fenceLen === line.length) {
      if (context.indented) {
        return 0;
      }
      for (let target = tabsContainer(container); null !== target; target = tabsContainer(target.Parent)) {
        const state = context.tabs?.get(target) ?? null;
        if (null !== state && state.fenceLen === fenceLen) {
          context.closeUnmatchedBlocks();
          for (; context.Tip !== target;) {
            context.finalize(context.Tip!);
          }
          context.finalize(target);
          return 3;
        }
      }
      return 0;
    }
    if ((0x20 /* space */ === line[fenceLen] || 0x09 /* \t */ === line[fenceLen]) &&
      bytes.Equal(bytes.TrimSpace(line.subarray(fenceLen)), tabsTokens)) {
      let nested = false;
      // Includes sub groups inside block quotes and lists; all descendant fences must be shorter than the outer one.
      for (let parent: ast.Node | null = container; null !== parent; parent = parent.Parent) {
        const state = context.tabs?.get(parent) ?? null;
        if (null !== state) {
          nested = true;
          if (fenceLen >= state.fenceLen) {
            return 0;
          }
        }
      }
      if (context.indented && !nested) {
        return 0;
      }
      context.closeUnmatchedBlocks();
      const node = context.addChild(ast.NodeTabs);
      if (null === context.tabs) {
        context.tabs = new Map<ast.Node, tabsParseState>();
      }
      const newState = new tabsParseState();
      newState.fenceLen = fenceLen;
      newState.indent = context.indent;
      context.tabs.set(node, newState);
      return 3;
    }
    return 0;
  }
  if (context.indented) {
    return 0;
  }
  let marker = "@tab";
  const active = bytes.HasPrefix(line, conv.BytesFromString("@tab:active"));
  if (active) {
    marker = "@tab:active";
  }
  if (!bytes.Equal(line, conv.BytesFromString(marker)) && !bytes.HasPrefix(line, conv.BytesFromString(marker + " ")) &&
    !bytes.HasPrefix(line, conv.BytesFromString(marker + "\t"))) {
    return 0;
  }
  const tabs = tabsContainer(container);
  if (null === tabs) {
    return 0;
  }
  context.closeUnmatchedBlocks();
  for (; context.Tip !== tabs;) {
    context.finalize(context.Tip!);
  }
  const item = context.addChild(ast.NodeTabItem);
  item.TabItemTitle = strings.TrimSpace(conv.StringFromBytes(line.subarray(marker.length))); // marker is ASCII, so its length is the same in bytes and UTF-16
  context.tabsItemIAL = item;
  const state = context.tabs?.get(tabs) ?? null;
  if (active && null !== state && null === state.active) {
    state.active = item;
  }
  return 3;
}

// tabsContainer recognizes tab separators without crossing explicit container prefixes inside the body.
function tabsContainer(container: ast.Node | null): ast.Node | null {
  for (let parent = container; null !== parent; parent = parent.Parent) {
    switch (parent.Type) {
      case ast.NodeTabs:
        return parent;
      case ast.NodeParagraph:
      case ast.NodeTabItem:
      case ast.NodeList:
      case ast.NodeKramdownBlockIAL:
        continue;
      default:
        return null;
    }
  }
  return null;
}

Context.prototype.tabsContinue = function (this: Context, node: ast.Node): number {
  const context = this;
  const state = context.tabs?.get(node) ?? null;
  if (null !== state) {
    // Each level only consumes the relative indent of its own opening fence; the extra four spaces of indent in the body still mean code.
    let indent = state.indent;
    if (context.indent < indent) {
      indent = context.indent;
    }
    context.advanceOffset(indent, true);
  }
  return 0;
};

Tree.prototype.finalParseTabs = function (this: Tree): void {
  const t = this;
  if (null === t.Context!.tabs) {
    return;
  }
  for (const [tabs, state] of t.Context!.tabs) {
    let active = state.active;
    if (null === active) {
      for (let item = tabs.FirstChild; null !== item; item = item.Next) {
        if (ast.NodeTabItem === item.Type && "" !== item.ID && item.ID === tabs.IALAttr("tabs-active-id")) {
          active = item;
          break;
        }
      }
    }
    if (null === active) {
      for (let item = tabs.FirstChild; null !== item; item = item.Next) {
        if (ast.NodeTabItem === item.Type) {
          active = item;
          break;
        }
      }
    }
    if (null === active) {
      continue;
    }
    if ("" === active.ID) {
      active.ID = ast.NewNodeID();
      active.SetIALAttr("id", active.ID);
    }
    tabs.SetIALAttr("tabs-active-id", active.ID);
    if (null !== tabs.Next && ast.NodeKramdownBlockIAL === tabs.Next.Type) {
      tabs.Next.Tokens = IAL2Tokens(tabs.KramdownIAL);
    }
  }
};

Context.prototype.tabsFinalize = function (this: Context, node: ast.Node): void {
  if (ast.NodeTabs === node.Type) {
    for (let child = node.FirstChild; null !== child; child = child.Next) {
      if (ast.NodeTabItem === child.Type) {
        return;
      }
    }
    const item = new ast.Node(ast.NodeTabItem);
    item.Close = true;
    const para = new ast.Node(ast.NodeParagraph);
    para.Close = true;
    item.AppendChild(para);
    node.AppendChild(item);
    return;
  }
  if (null !== node.KramdownIAL && 0 < node.KramdownIAL.length && (null === node.Next || ast.NodeKramdownBlockIAL !== node.Next.Type)) {
    // The attributes after the title are attached as the successor only when the tab is finalized, to avoid blocking the open body container.
    const ialNode = new ast.Node(ast.NodeKramdownBlockIAL, IAL2Tokens(node.KramdownIAL));
    ialNode.Close = true;
    node.InsertAfter(ialNode);
  }
  for (let child = node.FirstChild; null !== child; child = child.Next) {
    if (child.IsBlock() && ast.NodeKramdownBlockIAL !== child.Type && !child.IsTabTitleBlock()) {
      return;
    }
  }
  const para = new ast.Node(ast.NodeParagraph);
  para.Close = true;
  node.AppendChild(para);
};
