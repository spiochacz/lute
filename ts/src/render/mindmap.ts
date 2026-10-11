// Ported from render/mindmap.go @ 8e7896b6
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
import * as strings from "../runtime/strings.ts";
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as ast from "../ast/index.ts";
import * as parse from "../parse/index.ts";
import * as util from "../util/index.ts";
import { nodeTokens } from "./renderer.ts";

export function EChartsMindmapStr(listContent: string): string {
  return util.BytesToStr(echartsMindmap(util.StrToBytes(listContent)));
}

export function EChartsMindmap(listContent: Uint8Array): Uint8Array {
  return html.EncodeDestination(echartsMindmap(listContent));
}

// echartsMindmap converts the Markdown source of a list into an ECharts tree structure, for the frontend to render the mind map.
export function echartsMindmap(listContent: Uint8Array): Uint8Array {
  listContent = bytes.ReplaceAll(listContent, editor.CaretTokens, new Uint8Array(0));
  const tree = parse.Parse("", listContent, parse.NewOptions());
  if (null === tree.Root!.FirstChild || ast.NodeList !== tree.Root!.FirstChild.Type) {
    // If the first node is not a list, return directly
    return util.StrToBytes("{}");
  }

  // Remove the non-list nodes
  const toRemoved: ast.Node[] = [];
  for (let c: ast.Node | null = tree.Root!.FirstChild; null !== c; c = c.Next) {
    if (ast.NodeList !== c.Type) {
      toRemoved.push(c);
    }
  }
  for (const c of toRemoved) {
    c.Unlink();
  }

  const buf = new bytes.Buffer();
  ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    switch (n.Type) {
      case ast.NodeDocument:
        if (entering) {
          if (needRoot(n)) {
            // If the first list under the root node contains multiple list items, generate a root node automatically and hang these list items on it
            buf.WriteString("{\"name\": \"Root\", \"children\": [");
          }
        } else {
          if (needRoot(n)) {
            buf.WriteString("]}");
          }
        }
        return ast.WalkContinue;
      case ast.NodeList:
        return ast.WalkContinue;
      case ast.NodeListItem: {
        const children = null !== n.ChildByType(ast.NodeList);
        if (entering) {
          buf.WriteString("{\"name\": \"" + text(n.FirstChild) + "\"");
          if (children) {
            buf.WriteString(", \"children\": [");
          }
        } else {
          if (children) {
            buf.WriteString("]");
          }
          buf.WriteString("}");
          if (null !== n.Next || null !== n.Parent!.Next) {
            buf.WriteString(", ");
          }
        }
        break;
      }
      default:
        return ast.WalkContinue;
    }
    return ast.WalkContinue;
  });
  return buf.Bytes();
}

// text returns the text content of the first child node of a list item.
export function text(listItemFirstChild: ast.Node | null): string {
  let ret = "";
  if (null === listItemFirstChild) {
    return "";
  }

  const buf = new bytes.Buffer();
  ast.Walk(listItemFirstChild, (n: ast.Node, entering: boolean): ast.WalkStatus => {
    if (ast.NodeList === n.Type || ast.NodeListItem === n.Type) { // Exit when the next list or list item is reached
      return ast.WalkContinue;
    }

    if ((ast.NodeText === n.Type || ast.NodeLinkText === n.Type) && entering) {
      buf.Write(nodeTokens(n));
    }
    return ast.WalkContinue;
  });

  ret = buf.String();
  ret = strings.ReplaceAll(ret, "\\", "\\\\");
  ret = strings.ReplaceAll(ret, "\"", "\\\"");
  ret = strings.ReplaceAll(ret, editor.Caret, "");
  return ret;
}

export function needRoot(root: ast.Node): boolean {
  let count = 0;

  // Check whether the root node contains multiple lists
  for (let c = root.FirstChild; null !== c; c = c.Next) {
    if (ast.NodeList === c.Type) {
      count++;
    }
  }
  if (1 < count) {
    // If it contains multiple lists, a Root node needs to be built
    return true;
  }
  if (0 === count) {
    // If there is no list, a Root node is also needed
    return true;
  }

  count = 0;

  // If there is only one list, check whether the list contains multiple list items
  for (let c = root.FirstChild!.FirstChild; null !== c; c = c.Next) {
    if (ast.NodeListItem === c.Type) {
      count++;
    }
  }
  if (1 < count) {
    // If it contains multiple list items, a Root node needs to be built
    return true;
  }
  return false;
}
