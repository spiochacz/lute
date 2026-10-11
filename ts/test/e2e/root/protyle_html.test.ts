// protyle.go flow 3: HTML2BlockDOM on hand-written HTML and on the HTML (MarkdownStr) of the corpus, against the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CORPUS, PROTYLE_BASE } from "../renderers/protyle_corpus.ts";
import { sample } from "../full.ts";
import { bothThrew, compareCall, newEngines, oracleRaw } from "./protyle_flow_helpers.ts";

const HAND: string[] = [
  "<h1>a</h1><h2 id=\"x\" name=\"n\" updated=\"20210601233355\">b</h2>", "<p>a <b>b</b> <i>c</i> <del>d</del> <u>u</u> <mark>m</mark> <sub>s</sub> <sup>p</sup> <kbd>k</kbd></p>",
  "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>", "<ol start=\"3\"><li>a</li><li>b</li></ol>", "<ul><li><input type=\"checkbox\" checked> done</li><li><input type=\"checkbox\"> todo</li></ul>",
  "<table><thead><tr><th align=\"left\">a</th><th align=\"right\">b</th></tr></thead><tbody><tr><td>1</td><td colspan=\"2\">2</td></tr></tbody></table>",
  "<table><caption>cap</caption><tr><td>x</td></tr></table>",
  "<pre><code class=\"language-go\">func main() {}\n</code></pre>", "<pre>plain\n  text</pre>", "<blockquote><p>q</p><blockquote>n</blockquote></blockquote>",
  "<p><img src=\"a.png\" alt=\"al\" title=\"ti\"><img src=\"b.png\" width=\"20\"></p>", "<a href=\"https://b3log.org\" title=\"t\">l</a><a href=\"javascript:alert(1)\">x</a>",
  "<hr><p>a<br>b</p>", "<details><summary>s</summary>body</details>", "<iframe src=\"https://b3log.org\"></iframe><video src=\"a.mp4\"></video><audio src=\"a.mp3\"></audio>",
  "<p style=\"color: red;\">c</p><span style=\"font-weight:bold\">b</span><font color=\"red\">f</font>", "<!-- comment --><p>&amp;&lt;&gt;&nbsp;&copy;</p>", "<div>  </div><p>\n</p>",
  "<p><b><i><u><s>deep</s></u></i></b></p>", "<span><div>block in inline</div></span>", "<div class=\"language-math\">a+b</div><div class=\"language-plantuml\">x</div>",
  "<span data-type=\"strong\">x</span><span data-type=\"a\" data-href=\"u\">y</span>", "<div data-type=\"NodeParagraph\" class=\"p\"><div contenteditable=\"true\">z</div></div>",
  "<ul><li>a</li></ul><ol><li>b</li></ol>", "<p>中文<code>code</code>english</p>", "<h3>t<span id=\"i\"></span></h3>", "<li>orphan</li>", "<td>orphan</td>", "<script>alert(1)</script><style>a{}</style><p>x</p>",
  "<p>​⁠‸</p>", "text only", "", "   ",
];

const SETS: [string, [string, ...unknown[]][]][] = [
  ["h2m attrs", [["SetKramdownBlockIAL", true], ["SetHTML2MarkdownAttrs", ["name", "custom-*"]]]],
  ["text mark", [["SetTextMark", true], ["SetHTMLTag2TextMark", true]]],
  ["base", []],
  ["tabs, callout", [["SetTabs", true], ["SetCallout", true], ["SetTextMark", true]]],
];

for (const [name, setters] of SETS) {
  test(`HTML2BlockDOM [${name}]`, () => {
    const engines = newEngines([...PROTYLE_BASE, ...setters]);
    const failures: string[] = [];
    for (const [i, h] of HAND.entries()) {
      compareCall(engines, failures, `hand ${i} [${name}]`, "HTML2BlockDOM", h);
    }
    for (const [i, md] of sample(CORPUS, 0, 8).entries()) {
      const html = oracleRaw(engines, "MarkdownStr", "", md);
      if (html !== null) {
        compareCall(engines, failures, `corpus ${i} [${name}]`, "HTML2BlockDOM", html);
      }
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });
}

test("both threw", () => {
  console.log("html both threw:", JSON.stringify([...bothThrew.entries()]));
});
