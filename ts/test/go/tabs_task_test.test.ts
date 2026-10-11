// Port of test/tabs_task_test.go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, parse } from "../../src/index.ts";
import { BytesFromString } from "../../src/runtime/conv.ts";
import { tabNodes, tabsEngine } from "./tabs_helpers_s.ts";

// strings.Replace(s, old, new, 1)
function replaceFirst(s: string, old: string, rep: string): string {
  const i = s.indexOf(old);
  return i < 0 ? s : s.slice(0, i) + rep + s.slice(i + old.length);
}

test("TestTabsTaskRoundTrip", () => {
  for (const marker of [" ", "X", "x", "/", "-", "?", "!", '"', "&", "<"]) {
    const l = tabsEngine();
    let dom = l.Md2BlockDOM("::: tabs\n@tab **Task**\nBody\n:::\n", false);
    dom = replaceFirst(dom, `class="tab-item"`, `class="tab-item" tabs-task="` + html.EscapeAttrVal(marker) + `"`);
    dom = replaceFirst(dom, `class="tabs"`, `class="tabs" tabs-task="true"`);
    for (let round = 0; round < 3; round++) {
      const tree = l.BlockDOM2Tree(dom)!;
      let { tabs: groups, items } = tabNodes(tree.Root!);
      assert.ok(!(groups.length !== 1 || groups[0].IALAttr("tabs-task") !== "true"), `group task lost in AST: ${dom}`);
      assert.ok(!(items.length !== 1 || items[0].IALAttr("tabs-task") !== marker), `marker ${JSON.stringify(marker)} round ${round} lost in AST: ${dom}`);
      const exported = l.BlockDOM2HTML(dom);
      const h = tabNodes(l.BlockDOM2Tree(l.HTML2BlockDOM(exported))!.Root!);
      assert.ok(!(h.tabs.length !== 1 || h.tabs[0].IALAttr("tabs-task") !== "true"), `group task lost in HTML: ${exported}`);
      assert.ok(!(h.items.length !== 1 || h.items[0].IALAttr("tabs-task") !== marker), `marker ${JSON.stringify(marker)} lost in HTML: ${exported}`);
      const md = l.BlockDOM2StdMd(dom);
      ({ tabs: groups, items } = tabNodes(parse.Parse("", BytesFromString(md), l.ParseOptions).Root!));
      assert.ok(!(groups.length !== 1 || groups[0].IALAttr("tabs-task") !== "true"), `group task lost in Markdown: ${md}`);
      assert.ok(!(items.length !== 1 || items[0].IALAttr("tabs-task") !== marker), `marker ${JSON.stringify(marker)} lost in Markdown: ${md}`);
      dom = l.Md2BlockDOM(md, false);
    }
  }
});

test("TestCustomTaskStatusSpinRoundTrip", () => {
  const l = tabsEngine();
  l.SetDataTask(true);
  l.SetArbitraryTaskListItemMarker(true);
  l.SetExportNormalizeTaskListMarker(true);
  for (const marker of [" ", "X", "x", "/", "-", "?", "!", '"', "&", "<"]) {
    let dom = l.Md2BlockDOM("* [ ] Task\n", false);
    dom = replaceFirst(dom, `data-task=" "`, `data-task="` + html.EscapeAttrVal(marker) + `"`);
    for (let round = 0; round < 3; round++) {
      dom = l.SpinBlockDOM(dom);
      let expected = marker;
      if ("x" === marker) {
        expected = "X";
      }
      assert.ok(dom.includes(`data-task="` + html.EscapeAttrVal(expected) + `"`), `marker ${JSON.stringify(marker)} lost after editing: ${dom}`);
    }
  }
});
