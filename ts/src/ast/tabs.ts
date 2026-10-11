// Ported from ast/tabs.go @ 8e7896b6
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import type { Node } from "./node.ts";
import { NodeKramdownBlockIAL, NodeParagraph, NodeTabItem } from "./node.ts";

// PORT-NOTE: Go declares these as methods on *Node. A class method cannot live in another file, so they are free functions taking the
// receiver first, and Node.TabTitleBlock and Node.IsTabTitleBlock in node.ts delegate to them.
// PORT-NOTE: this file imports constants from node.ts and node.ts imports these functions. The cycle is safe: nothing runs at module load.

// TabTitleBlockOf returns the paragraph saved as the tab title (Go: (n *Node) TabTitleBlock). The paragraph keeps its own block identity.
export function TabTitleBlockOf(n: Node | null): Node | null {
  if (null === n || NodeTabItem !== n.Type) {
    return null;
  }
  for (let child = n.FirstChild; null !== child; child = child.Next) {
    if (NodeKramdownBlockIAL === child.Type) {
      continue;
    }
    if (NodeParagraph === child.Type && "true" === child.IALAttr("tabs-title")) {
      return child;
    }
    break;
  }
  return null;
}

// IsTabTitleBlockOf reports whether n is the title block of its parent tab item (Go: (n *Node) IsTabTitleBlock).
export function IsTabTitleBlockOf(n: Node): boolean {
  return null !== n.Parent && TabTitleBlockOf(n.Parent) === n;
}
