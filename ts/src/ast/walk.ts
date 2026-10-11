// Ported from ast/walk.go @ 8e7896b6
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import type { Node } from "./node.ts";

// WalkStatus describes the walk state.
export type WalkStatus = number;

// Go's const block uses an untyped iota, so these are plain numbers.

// WalkStop means stop walking.
export const WalkStop = 0;
// WalkSkipChildren means do not walk the children.
export const WalkSkipChildren = 1;
// WalkContinue means keep walking.
export const WalkContinue = 2;

// Walker is the function run on each node n during a walk. It is called with entering true when the walk enters n, and false when it leaves.
// Returning WalkStop ends the walk.
export type Walker = (n: Node, entering: boolean) => WalkStatus;

// Walk walks the tree rooted at n depth-first.
export function Walk(n: Node, walker: Walker): void {
  walk(n, walker);
}

function walk(n: Node, walker: Walker): WalkStatus {
  let ret: WalkStatus = 0;
  // Enter the node.
  ret = walker(n, true);
  if (ret === WalkStop) {
    return ret;
  }

  if (ret !== WalkSkipChildren) {
    // Walk the children recursively.
    for (let c = n.FirstChild; null !== c; c = c.Next) {
      ret = walk(c, walker);
      if (WalkStop === ret) {
        return WalkStop;
      }
    }
  }

  // Leave the node.
  ret = walker(n, false);
  return ret;
}
