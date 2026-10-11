// Port of test/image_title_data_attribute_test.go (TestImageTitleDataAttribute). This test belongs to the newest Go commit, which the committed
// reference bundle javascript/lute.min.js does not include; the assertions below are Go's own expected values.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ast, New } from "../../src/index.ts";
import { StringFromBytes } from "../../src/runtime/conv.ts";

test("TestImageTitleDataAttribute", async (t) => {
  const fixtures = [
    { name: "legacy", attrs: `title="caption &amp; &lt;literal&gt;"`, title: "caption & <literal>" },
    { name: "data", attrs: `data-title="caption &amp; &lt;literal&gt;"`, title: "caption & <literal>" },
    { name: "preferred", attrs: `title="legacy" data-title="updated"`, title: "updated" },
    { name: "cleared", attrs: `title="legacy" data-title=""`, title: "" },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const engine = New();
      engine.SetProtyleWYSIWYG(true);
      const dom =
        `<div data-node-id="20261010130000-abcdefg" data-type="NodeParagraph"><div contenteditable="true"><span data-type="img" class="img"><span> </span><span><img src="assets/image.png" data-src="assets/image.png" alt="description" ` +
        fixture.attrs +
        `><span class="protyle-action__title"><span>caption</span></span></span><span> </span></span></div></div>`;
      const checkTitle = (input: string): void => {
        const tree = engine.BlockDOM2Tree(input)!;
        const image = tree.Root!.FirstChild!.ChildByType(ast.NodeImage);
        assert.ok(image !== null, "image is missing");
        let title = "";
        const node = image.ChildByType(ast.NodeLinkTitle);
        if (node !== null) {
          title = StringFromBytes(node.Tokens!);
        }
        assert.equal(title, fixture.title, "title");
      };
      checkTitle(dom);
      checkTitle(engine.SpinBlockDOM(dom));
      checkTitle(engine.Md2BlockDOM(engine.BlockDOM2Md(dom), false));
      checkTitle(engine.Md2BlockDOM(engine.BlockDOM2StdMd(dom), false));
      if (fixture.title !== "" && !engine.BlockDOM2HTML(dom).includes('title="')) {
        assert.fail("HTML export lost the image title");
      }
    });
  }
});
