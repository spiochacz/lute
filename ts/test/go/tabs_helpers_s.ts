// Shared helpers of the ported Go tabs tests (tabsEngine and tabNodes of test/tabs_test.go).
import { New, ast } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";

export function tabsEngine(): Lute {
  const l = New();
  l.SetTabs(true);
  l.SetKramdownBlockIAL(true);
  l.SetBlockRef(true);
  l.SetSuperBlock(true);
  l.SetTextMark(true);
  l.SetProtyleWYSIWYG(true);
  return l;
}

export function tabNodes(root: ast.Node): { tabs: ast.Node[]; items: ast.Node[] } {
  const tabs: ast.Node[] = [];
  const items: ast.Node[] = [];
  ast.Walk(root, (n, entering) => {
    if (entering) {
      if (n.Type === ast.NodeTabs) {
        tabs.push(n);
      }
      if (n.Type === ast.NodeTabItem) {
        items.push(n);
      }
    }
    return ast.WalkContinue;
  });
  return { tabs, items };
}

// strings.Count(s, sub) for a non-empty sub.
export function count(s: string, sub: string): number {
  return s.split(sub).length - 1;
}
