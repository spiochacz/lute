// Port of test/tabs_test.go (tabsEngine and tabNodes live in tabs_helpers_s.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, parse } from "../../src/index.ts";
import { BytesFromString } from "../../src/runtime/conv.ts";
import { count, tabNodes, tabsEngine } from "./tabs_helpers_s.ts";

const P = (md: string, l: ReturnType<typeof tabsEngine>): ast.Node => parse.Parse("", BytesFromString(md), l.ParseOptions).Root!;

test("TestTabsRoundTrip", () => {
  const l = tabsEngine();
  const md = ":::: tabs\n@tab **First**\n{: id=\"20260905120000-item001\"}\n\nOne\n::: tabs\n@tab Nested\n```\n@tab literal\n:::\n```\n:::\n@tab:active Second\n{: id=\"20260905120000-item002\"}\n\nTwo\n::::\n{: id=\"20260905120000-tabs001\" tabs-active-id=\"20260905120000-item002\" tabs-position=\"left\"}\n";
  let dom = l.Md2BlockDOM(md, false);
  for (let round = 0; round < 3; round++) {
    const tree = l.BlockDOM2Tree(dom)!;
    const { tabs, items } = tabNodes(tree.Root!);
    assert.ok(!(tabs.length !== 2 || items.length !== 3), `round ${round} structure: ${dom}`);
    assert.ok(
      !(!items[0].TabItemTitle.includes(`data-type="strong">First`) || items[2].ID !== "20260905120000-item002" || tabs[0].IALAttr("tabs-active-id") !== items[2].ID || tabs[0].IALAttr("tabs-position") !== "left"),
      `round ${round} metadata: title=${JSON.stringify(items[0].TabItemTitle)} item=${JSON.stringify(items[2].ID)} active=${JSON.stringify(tabs[0].IALAttr("tabs-active-id"))} position=${JSON.stringify(tabs[0].IALAttr("tabs-position"))}`,
    );
    assert.ok(dom.includes("literal") && dom.includes("Two"), dom);
    dom = l.SpinBlockDOM(dom);
  }
});

test("TestTabsContainersAndFences", () => {
  const l = tabsEngine();
  for (const md of [
    "::: tabs\n@tab A\nbody\n:::\n",
    ":::\ttabs\n@tab\tA\nbody\n:::\n",
    "> ::: tabs\n> @tab A\n> body\n> :::\n",
    "- ::: tabs\n  @tab A\n  body\n  :::\n",
    "{{{row\n::: tabs\n@tab A\nbody\n:::\n}}}\n",
    "::: tabs\n@tab A\nbody",
  ]) {
    let r = tabNodes(P(md, l));
    assert.ok(!(r.tabs.length !== 1 || r.items.length !== 1 || r.items[0].Parent !== r.tabs[0]), `invalid structure: ${JSON.stringify(md)}`);
    const formatted = l.FormatStr("", md);
    r = tabNodes(P(formatted, l));
    assert.ok(!(r.tabs.length !== 1 || r.items.length !== 1), `format lost structure: ${JSON.stringify(formatted)}`);
  }
  for (const md of [
    "@tab stray\nbody\n:::\n",
    "@tab:active stray\nbody\n:::\n",
    ":::tabs\n:::tab A\nbody\n:::\n:::\n",
    ":: tabs\n@tab A\nbody\n::\n",
    "::: tabs extra\n@tab A\nbody\n:::\n",
    "```\n::: tabs\n@tab A\n:::\n```\n",
  ]) {
    const { tabs } = tabNodes(P(md, l));
    assert.equal(tabs.length, 0, `unexpected tabs: ${JSON.stringify(md)}`);
  }
});

test("TestTabItemFragmentAndExport", () => {
  const l = tabsEngine();
  const dom = `<div data-node-id="20260905120000-item001" data-type="NodeTabItem" class="tab-item"><div class="tab-item-info callout-info"><span class="tab-item-title callout-title"><span data-type="strong">Title</span></span></div><div class="tab-item-content"><div data-node-id="20260905120000-para001" data-type="NodeParagraph" class="p"><div contenteditable="true">Body</div></div></div></div>`;
  const spun = l.SpinBlockDOM(dom);
  const { tabs, items } = tabNodes(l.BlockDOM2Tree(spun)!.Root!);
  assert.ok(!(tabs.length !== 0 || items.length !== 1), `tabs=${tabs.length} items=${items.length}\n${spun}`);
  assert.ok(
    !(items[0].ID !== "20260905120000-item001" || !items[0].TabItemTitle.includes(`data-type="strong">Title`) || items[0].FirstChild!.ID !== "20260905120000-para001"),
    `item=${items[0].ID} title=${items[0].TabItemTitle} body=${items[0].FirstChild!.ID}`,
  );
  const md = l.BlockDOM2StdMd(dom);
  assert.ok(md.includes("::: tabs") && md.includes("@tab") && md.includes("**Title**") && md.includes("Body"), md);
});

test("TestTabsHTMLAndEmptyInput", () => {
  const l = tabsEngine();
  const md = "::: tabs\n@tab **Title**\nBody\n@tab\n:::\n";
  const html = l.MarkdownStr("", md);
  const back = l.HTML2Md(html);
  const { tabs, items } = tabNodes(P(back, l));
  assert.ok(!(tabs.length !== 1 || items.length !== 2), `HTML round trip: tabs=${tabs.length} items=${items.length}\n${back}`);
  assert.ok(
    !(!items[0].TabItemTitle.includes("Title") || items[1].TabItemTitle !== "" || items[1].FirstChild === null),
    `HTML round trip: title=${JSON.stringify(items[0].TabItemTitle)} empty=${JSON.stringify(items[1].TabItemTitle)} child=${String(items[1].FirstChild)}\n${back}`,
  );
  assert.ok(!(html.includes("contenteditable") || html.includes("display: none")), "HTML must work without enhancement");
  assert.ok(l.BlockDOM2StdMd(l.Md2BlockDOM(md, false)).includes("::: tabs"), "clipboard markdown lost fences");
});

test("TestTabsEmptyParagraphIDs", () => {
  const l = tabsEngine();
  const md = "::: tabs\n@tab\n{: id=\"20260905120000-item001\"}\n\n{: id=\"20260905120000-empty01\"}\n\n{: id=\"20260905120000-empty02\"}\n:::\n{: id=\"20260905120000-tabs001\"}\n";
  let dom = l.Md2BlockDOM(md, false);
  for (let round = 0; round < 3; round++) {
    const tree = l.BlockDOM2Tree(dom)!;
    const { tabs, items } = tabNodes(tree.Root!);
    assert.ok(!(tabs.length !== 1 || items.length !== 1 || tabs[0].ID !== "20260905120000-tabs001" || items[0].ID !== "20260905120000-item001"), `round ${round} containers: ${dom}`);
    const paragraphs: string[] = [];
    for (let child = items[0].FirstChild; child !== null; child = child.Next) {
      if (child.Type === ast.NodeParagraph) {
        paragraphs.push(child.ID);
      }
    }
    assert.equal(paragraphs.join(","), "20260905120000-empty01,20260905120000-empty02", `round ${round} empty paragraph IDs: ${paragraphs}\n${dom}`);
    dom = l.SpinBlockDOM(dom);
  }
});

test("TestTabsSlashPreset", () => {
  const l = tabsEngine();
  const markdown = "::: tabs\n@tab\n‸\n@tab\n\n:::\n";
  const dom = l.Md2BlockDOM(markdown, false);
  assert.ok(!dom.includes(":::"), dom);
  const { tabs, items } = tabNodes(l.BlockDOM2Tree(dom)!.Root!);
  assert.ok(!(tabs.length !== 1 || items.length !== 2 || null === items[0].FirstChild || null === items[1].FirstChild), `tabs=${tabs.length} items=${items.length}\n${dom}`);
  const paragraph = `<div data-node-id="20260905134000-paragraph" data-type="NodeParagraph" class="p"><div contenteditable="true">` + markdown + `</div><div class="protyle-attr" contenteditable="false"></div></div>`;
  const spun = l.SpinBlockDOM(paragraph);
  assert.ok(!(spun.includes(":::") || !spun.includes("<wbr>")), spun);
});

test("TestTabsNestedFenceLengthsAndIndent", async (t) => {
  for (const indent of ["", "  ", "    "]) {
    await t.test("indent" + indent.split(" ").join("_"), () => {
      const l = tabsEngine();
      let md = "::::: tabs\n@tab Outer\n" + indent + ":::: tabs\n" + indent + "@tab Middle\n" + indent + indent + "::: tabs\n" + indent + indent + "@tab Inner\n" + indent + indent + "body\n" + indent + indent + ":::\n" + indent + "@tab Middle sibling\n" + indent + "body\n" + indent + "::::\n@tab Outer sibling\nbody\n:::::\n";
      for (let round = 0; round < 3; round++) {
        const { tabs, items } = tabNodes(P(md, l));
        assert.ok(!(tabs.length !== 3 || items.length !== 5), `round ${round} tabs=${tabs.length} items=${items.length}\n${md}`);
        assert.ok(!(tabs[1].Parent !== items[0] || tabs[2].Parent !== items[1] || items[3].Parent !== tabs[1] || items[4].Parent !== tabs[0]), `round ${round} invalid nesting\n${md}`);
        md = l.FormatStr("", md);
      }
    });
  }
  for (const md of [
    "::: tabs\n@tab A\n::: tabs\nbody\n@tab B\n:::\n",
    "::: tabs\n@tab A\n:::: tabs\nbody\n@tab B\n:::\n",
    ":::: tabs\n@tab A\n:::\nbody\n@tab B\n::::\n",
    "::: tabs\n@tab A\n::::\nbody\n@tab B\n:::\n",
  ]) {
    const l = tabsEngine();
    const { tabs, items } = tabNodes(P(md, l));
    assert.ok(!(tabs.length !== 1 || items.length !== 2 || items[1].TabItemTitle !== "B"), `mismatched fence changed nesting: tabs=${tabs.length} items=${items.length}\n${md}`);
  }
});

test("TestTabsCanonicalFenceLengths", () => {
  const l = tabsEngine();
  const cases: { markdown: string; fences: string[] }[] = [
    { markdown: ":::::::: tabs\n@tab A\nbody\n::::::::\n", fences: ["::: tabs", ":::"] },
    { markdown: ":::::::: tabs\n@tab A\n:::::: tabs\n@tab B\nbody\n::::::\n::::::::\n", fences: [":::: tabs", "::: tabs", ":::", "::::"] },
    { markdown: ":::::::: tabs\n@tab A\n:::::: tabs\n@tab B\n:::: tabs\n@tab C\nbody\n::::\n::::::\n::::::::\n", fences: ["::::: tabs", ":::: tabs", "::: tabs", ":::", "::::", ":::::"] },
  ];
  for (const test of cases) {
    const formatted = l.FormatStr("", test.markdown);
    const fences: string[] = [];
    for (let line of formatted.split("\n")) {
      line = line.trim();
      if (line.startsWith(":::")) {
        fences.push(line);
      }
    }
    assert.equal(fences.join("|"), test.fences.join("|"), `fences=${fences} want=${test.fences}\n${formatted}`);
  }
});

test("TestTabsDeepNesting", () => {
  const l = tabsEngine();
  const depth = 12;
  let markdown = "";
  for (let level = 0; level < depth; level++) {
    const indent = " ".repeat(2 * level);
    markdown += indent + ":".repeat(depth - level + 2) + " tabs\n";
    markdown += indent + "@tab Level " + String.fromCharCode("A".charCodeAt(0) + level) + "\n";
  }
  markdown += " ".repeat(2 * (depth - 1)) + "deep body\n";
  for (let level = depth - 1; level >= 0; level--) {
    markdown += " ".repeat(2 * level) + ":".repeat(depth - level + 2) + "\n";
  }
  let md = markdown;
  for (let round = 0; round < 3; round++) {
    const { tabs, items } = tabNodes(P(md, l));
    assert.ok(!(tabs.length !== depth || items.length !== depth), `round ${round} tabs=${tabs.length} items=${items.length}\n${md}`);
    for (let level = 1; level < depth; level++) {
      assert.ok(tabs[level].Parent === items[level - 1], `round ${round} wrong parent at level ${level}\n${md}`);
    }
    assert.ok(items[depth - 1].Content().includes("deep body"), `round ${round} deepest body lost\n${md}`);
    md = l.FormatStr("", md);
  }
});

test("TestTabsLiteralMarkers", async (t) => {
  const l = tabsEngine();
  const bodies: Record<string, string> = {
    backtick: "```\n@tab Literal\n:::\n```\n",
    tilde: "~~~\n@tab Literal\n:::\n~~~\n",
    "indented code": "    @tab Literal\n    :::\n",
    blockquote: "> @tab Literal\n> :::\n",
    list: "- @tab Literal\n  :::\n",
    escaped: "\\@tab Literal\n\\@tab:active Literal\n",
    "escaped fence": "\\::: tabs\n\\:::\nLiteral\n",
    "soft break": "Literal first line\n\\@tab Literal\n\\@tab:active Literal\n",
    "similar token": "@table Literal\n@tab:activeX Literal\n@tab:other Literal\n",
  };
  for (const [name, body] of Object.entries(bodies)) {
    await t.test(name, () => {
      let md = "::: tabs\n@tab A\n\n" + body + "\n@tab B\nbody\n:::\n";
      for (let round = 0; round < 3; round++) {
        const { tabs, items } = tabNodes(P(md, l));
        assert.ok(!(tabs.length !== 1 || items.length !== 2 || items[1].TabItemTitle !== "B"), `round ${round} literal changed structure: tabs=${tabs.length} items=${items.length}\n${md}`);
        assert.ok(items[0].Content().includes("Literal"), `round ${round} literal lost\n${md}`);
        md = l.FormatStr("", md);
      }
    });
  }
});

test("TestTabsLiteralMarkersSpin", () => {
  const l = tabsEngine();
  for (const body of [
    "\\@tab Literal\n\\@tab:active Literal\n",
    "Literal first line\n\\@tab Literal\n\\@tab:active Literal\n",
    "\\::: tabs\n\\:::\nLiteral\n",
    "Literal first line\n\\::: tabs\n\\:::\n",
  ]) {
    const md = "::: tabs\n@tab A\n\n" + body + "\n@tab B\nbody\n:::\n";
    let dom = l.Md2BlockDOM(md, false);
    let expected = "";
    for (let round = 0; round < 4; round++) {
      const { tabs, items } = tabNodes(l.BlockDOM2Tree(dom)!.Root!);
      assert.ok(!(tabs.length !== 1 || items.length !== 2 || items[1].TabItemTitle !== "B"), `round ${round} tabs=${tabs.length} items=${items.length}\n${dom}`);
      if (round === 0) {
        expected = items[0].Content();
      } else {
        assert.equal(items[0].Content(), expected, `round ${round} literal changed: ${JSON.stringify(items[0].Content())} want ${JSON.stringify(expected)}\n${dom}`);
      }
      dom = l.SpinBlockDOM(dom);
    }
  }
});

test("TestTabsNestedSlashPreset", () => {
  const l = tabsEngine();
  const markdown = "::: tabs\n@tab\n\n‸\n\n@tab\n\n:::\n";
  const paragraph = `<div data-node-id="20260905134000-para001" data-type="NodeParagraph" class="p"><div contenteditable="true">` + markdown + `</div><div class="protyle-attr" contenteditable="false"></div></div>`;
  const innerDOM = l.SpinBlockDOM(paragraph);
  const inner = tabNodes(l.BlockDOM2Tree(innerDOM)!.Root!);
  assert.ok(!(inner.tabs.length !== 1 || inner.items.length !== 2 || !innerDOM.includes("<wbr>")), `slash fragment tabs=${inner.tabs.length} items=${inner.items.length}\n${innerDOM}`);
  let dom = `<div data-node-id="20260905120000-tabs001" data-type="NodeTabs" class="tabs"><div data-node-id="20260905120000-item001" data-type="NodeTabItem" class="tab-item"><div class="tab-item-info callout-info"><span class="tab-item-title callout-title">Outer</span></div><div class="tab-item-content">` + innerDOM + `</div></div></div>`;
  for (let round = 0; round < 3; round++) {
    dom = l.SpinBlockDOM(dom);
    const { tabs, items } = tabNodes(l.BlockDOM2Tree(dom)!.Root!);
    assert.ok(!(tabs.length !== 2 || items.length !== 3 || tabs[1].Parent !== items[0] || !dom.includes("<wbr>")), `round ${round} tabs=${tabs.length} items=${items.length}\n${dom}`);
  }
});

test("TestTabsEmptyAndLeadingBody", () => {
  const l = tabsEngine();
  const cases: { markdown: string; items: number; leading: string }[] = [
    { markdown: "::: tabs\n:::\n", items: 1, leading: "" },
    { markdown: "::: tabs", items: 1, leading: "" },
    { markdown: "::: tabs\n@tab", items: 1, leading: "" },
    { markdown: "::: tabs\n@tab\n@tab\n:::\n", items: 2, leading: "" },
    { markdown: "::: tabs\nLeading body\n@tab Titled\nbody\n:::\n", items: 2, leading: "Leading body" },
    { markdown: "::: tabs\nLeading body", items: 1, leading: "Leading body" },
  ];
  for (const test of cases) {
    let md = test.markdown;
    for (let round = 0; round < 3; round++) {
      const { tabs, items } = tabNodes(P(md, l));
      assert.ok(!(tabs.length !== 1 || items.length !== test.items), `round ${round} tabs=${tabs.length} items=${items.length} want=${test.items}\n${md}`);
      if (test.leading !== "" && (items[0].TabItemTitle !== "" || !items[0].Text().includes(test.leading))) {
        assert.fail(`round ${round} leading content lost\n${md}`);
      }
      for (const item of items) {
        assert.ok(item.FirstChild !== null, `round ${round} item has no content block\n${md}`);
      }
      md = l.FormatStr("", md);
    }
  }
});

test("TestTabsActiveSelection", async (t) => {
  const table: { name: string; markers: [string, string, string]; groupIAL: string; selected: number }[] = [
    { name: "default", markers: ["@tab", "@tab", "@tab"], groupIAL: "", selected: 0 },
    { name: "second", markers: ["@tab", "@tab:active", "@tab"], groupIAL: "", selected: 1 },
    { name: "first marker wins", markers: ["@tab", "@tab:active", "@tab:active"], groupIAL: "", selected: 1 },
    { name: "marker overrides IAL", markers: ["@tab", "@tab:active", "@tab"], groupIAL: ` tabs-active-id="20260905120000-item003"`, selected: 1 },
    { name: "valid IAL", markers: ["@tab", "@tab", "@tab"], groupIAL: ` tabs-active-id="20260905120000-item003"`, selected: 2 },
    { name: "invalid IAL", markers: ["@tab", "@tab", "@tab"], groupIAL: ` tabs-active-id="20260905120000-missing"`, selected: 0 },
  ];
  for (const ial of [false, true]) {
    for (const blockOnly of [false, true]) {
      for (const test of table) {
        let name = test.name;
        if (ial) {
          name += "/IAL";
        }
        if (blockOnly) {
          name += "/Block";
        }
        await t.test(name, () => {
          const l = tabsEngine();
          l.SetKramdownBlockIAL(ial);
          let md = "::: tabs\n";
          test.markers.forEach((marker, index) => {
            md += marker + " Title\n";
            if (ial) {
              md += "{: id=\"20260905120000-item00" + String.fromCharCode("1".charCodeAt(0) + index) + "\"}\n";
            }
            md += "\nbody\n";
          });
          md += ":::\n";
          if (ial) {
            md += "{: id=\"20260905120000-tabs001\"" + test.groupIAL + "}\n";
          }
          const parser = blockOnly ? parse.Block : parse.Parse;
          let r = tabNodes(parser("", BytesFromString(md), l.ParseOptions).Root!);
          assert.ok(!(r.tabs.length !== 1 || r.items.length !== 3), `tabs=${r.tabs.length} items=${r.items.length}\n${md}`);
          let selected = test.selected;
          if (!ial && test.name === "valid IAL") {
            selected = 0;
          }
          assert.ok(!(r.items[selected].ID === "" || r.tabs[0].IALAttr("tabs-active-id") !== r.items[selected].ID), `active=${JSON.stringify(r.tabs[0].IALAttr("tabs-active-id"))} expected item ${selected} ID=${JSON.stringify(r.items[selected].ID)}`);
          let formatted = l.FormatStr("", md);
          assert.equal(count(formatted, "@tab:active"), 1, `expected exactly one active marker\n${formatted}`);
          for (let round = 0; round < 3; round++) {
            r = tabNodes(parser("", BytesFromString(formatted), l.ParseOptions).Root!);
            assert.ok(!(r.tabs.length !== 1 || r.items.length !== 3 || r.items[selected].ID === "" || r.tabs[0].IALAttr("tabs-active-id") !== r.items[selected].ID), `round ${round} selection changed\n${formatted}`);
            formatted = l.FormatStr("", formatted);
          }
        });
      }
    }
  }
});

test("TestTabsNestedActiveSelection", () => {
  const l = tabsEngine();
  let md = ":::: tabs\n@tab Outer first\n::: tabs\n@tab Inner first\nbody\n@tab:active Inner second\nbody\n:::\n@tab:active Outer second\nbody\n::::\n";
  for (let round = 0; round < 3; round++) {
    const { tabs, items } = tabNodes(P(md, l));
    assert.ok(!(tabs.length !== 2 || items.length !== 4), `round ${round} tabs=${tabs.length} items=${items.length}\n${md}`);
    assert.ok(
      !(tabs[0].IALAttr("tabs-active-id") !== items[3].ID || tabs[1].IALAttr("tabs-active-id") !== items[2].ID),
      `round ${round} outer active=${JSON.stringify(tabs[0].IALAttr("tabs-active-id"))} inner active=${JSON.stringify(tabs[1].IALAttr("tabs-active-id"))}\n${md}`,
    );
    md = l.FormatStr("", md);
  }
});

test("TestTabsItemAttributePlacement", () => {
  const l = tabsEngine();
  let md = "::: tabs\n@tab A\n{: id=\"20260905120000-item001\" custom-item=\"kept\"}\n\nbody\n{: id=\"20260905120000-para001\" custom-body=\"kept\"}\n@tab B\n{: id=\"20260905120000-item002\"}\n\n{: id=\"20260905120000-empty01\"}\n:::\n{: id=\"20260905120000-tabs001\" tabs-position=\"left\"}\n";
  for (let round = 0; round < 3; round++) {
    const { tabs, items } = tabNodes(P(md, l));
    assert.ok(!(tabs.length !== 1 || items.length !== 2), `round ${round} tabs=${tabs.length} items=${items.length}\n${md}`);
    assert.ok(
      !(tabs[0].ID !== "20260905120000-tabs001" || tabs[0].IALAttr("tabs-position") !== "left" || items[0].ID !== "20260905120000-item001" || items[0].IALAttr("custom-item") !== "kept" || items[1].ID !== "20260905120000-item002"),
      `round ${round} container attributes changed\n${md}`,
    );
    assert.ok(
      !(items[0].FirstChild!.ID !== "20260905120000-para001" || items[0].FirstChild!.IALAttr("custom-body") !== "kept" || items[1].FirstChild!.ID !== "20260905120000-empty01"),
      `round ${round} body attributes changed\n${md}`,
    );
    md = l.FormatStr("", md);
  }
});
