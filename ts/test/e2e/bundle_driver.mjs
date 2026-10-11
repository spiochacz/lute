// Run by bundle.test.ts in a fresh Node process: node bundle_driver.mjs <path of a lute.min.js style bundle>.
// Loads the bundle as a consumer would (a script that sets globalThis.Lute), makes a fixed list of calls and prints one JSON document:
// the keys of the global object, its constants, the function-valued keys of an engine, and the result of every call ("THROW" when it threw).
// Nothing here depends on the implementation behind the bundle. Generated node IDs are normalised by the test, not here.

import { createRequire } from "node:module";

const bundle = process.argv[2];
createRequire(import.meta.url)(bundle);
const G = globalThis.Lute;

const out = { keys: Object.keys(G).sort(), version: G.Version, consts: {}, engineFunctions: [], results: [] };
for (const k of ["WalkStop", "WalkSkipChildren", "WalkContinue", "Caret"]) {
  out.consts[k] = G[k];
}
{
  const e = G.New();
  // for...in: the reference has its methods as own properties, the port on the prototype.
  for (const k in e) {
    if (typeof e[k] === "function") {
      out.engineFunctions.push(k);
    }
  }
  out.engineFunctions.sort();
}

function show(v) {
  return JSON.stringify(v, (_k, x) => (x instanceof Error ? "Error:" + x.message : x));
}

function rec(label, fn) {
  let value;
  try {
    value = show(fn());
  } catch (e) {
    // The text of a panic differs between the implementations and is not part of the contract; that it threw is.
    value = "THROW";
  }
  out.results.push([label, value === undefined ? "undefined" : value]);
}

const DOCS = {
  rich: "# Title {#t}\n\nSome *emphasis*, **strong**, ~~del~~, `code`, [link](http://a.b \"t\") and ![img](src.png \"cap\").\n\n- one\n- [ ] two\n- [x] three\n\n> quote\n> > nested\n\n1. a\n2. b\n\n---\n\nwww.autolink.com and https://github.com/a/b/issues/1 :smile:\n",
  table: "| a | b |\n|:--|--:|\n| 1 | 2 |\n| `x` | **y** |\n\nfoo[^1]\n\n[^1]: note\n\n[ref]: http://r.example \"R\"\n\n[use][ref]\n",
  code: "```go\nfunc main() {}\n```\n\n    indented\n\n$$\nE=mc^2\n$$\n\ninline $a^2$ math\n\n<div>html *block*</div>\n\ntext<br/>more <kbd>k</kbd>\n",
  cjk: "中文English混合，测试。\n\n# 标题 abc\n\n这是 **粗体**和*斜体*。\n\n1.2中文3 foo_bar_baz\n",
  ial: "# h\n{: id=\"20200101010101-abcdefg\" custom-x=\"1\"}\n\npara ((20200101010101-abcdefg \"anchor\")) #tag# ==mark== ^sup^ ~sub~\n{: id=\"20200101010102-abcdefg\"}\n\n{{{row\nin\n}}}\n",
  weird: "[TOC]\n\n> [!NOTE]\n> callout\n\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n\n\\*esc\\* &amp; &copy; ​\n",
  caret: "foo " + G.Caret + "bar *em" + G.Caret + "*\n",
  ul: "* one\n* two\n  * nested\n",
  ol: "1. a\n2. b\n",
  tl: "* [ ] a\n* [x] b\n",
  quote: "> quote\n> text\n",
  callout: "> [!NOTE]\n> callout\n",
  empty: "",
};
const HTMLS = {
  article: "<h1>T</h1><p>a <b>b</b> <i>c</i> <a href=\"http://x.y\">l</a> <img src=\"i.png\" alt=\"a\"></p><ul><li>one</li><li>two<ul><li>n</li></ul></li></ul><pre><code class=\"language-js\">let a = 1;\n</code></pre>",
  table: "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><code>2</code></td></tr></tbody></table><blockquote><p>q</p></blockquote><hr>",
  messy: "<div><span style=\"font-weight:bold\">b</span><br>x<sup>1</sup><sub>2</sub><del>d</del><mark>m</mark><kbd>k</kbd><p>&nbsp;&lt;&amp;</p><!-- c --><h7>seven</h7></div>",
};

const SETTERS = {
  default: [],
  wysiwyg: [["SetVditorWYSIWYG", true]],
  ir: [["SetVditorIR", true]],
  sv: [["SetVditorSV", true]],
  // The option set of javascript/main.go BlockDOM2Content.
  protyle: [
    ["SetProtyleWYSIWYG", true], ["SetBlockRef", true], ["SetFileAnnotationRef", true], ["SetKramdownIAL", true], ["SetTag", true], ["SetSuperBlock", true],
    ["SetImgPathAllowSpace", true], ["SetGitConflict", true], ["SetMark", true], ["SetSup", true], ["SetSub", true], ["SetInlineMathAllowDigitAfterOpenMarker", true],
    ["SetFootnotes", false], ["SetToC", false], ["SetIndentCodeBlock", false], ["SetParagraphBeginningSpace", true], ["SetAutoSpace", false], ["SetHeadingID", false],
    ["SetSetext", false], ["SetYamlFrontMatter", false], ["SetLinkRef", false], ["SetCodeSyntaxHighlight", false], ["SetSanitize", true],
  ],
  everything: [
    ["SetGFMStrikethrough1", true], ["SetFullWidthStrikethrough", true], ["SetArbitraryTaskListItemMarker", true], ["SetDataTask", true], ["SetToC", true],
    ["SetHeadingAnchor", true], ["SetChineseParagraphBeginningSpace", true], ["SetMark", true], ["SetSup", true], ["SetSub", true], ["SetTag", true], ["SetInlineMath", true],
    ["SetBlockRef", true], ["SetFileAnnotationRef", true], ["SetSuperBlock", true], ["SetGitConflict", true], ["SetKramdownIAL", true], ["SetRenderListStyle", true],
    ["SetCustomBlock", true], ["SetCallout", true], ["SetTabs", true], ["SetTextMark", true], ["SetEnsureListItemParagraph", true], ["SetParagraphBeginningSpace", true],
    ["SetImgPathAllowSpace", true],
  ],
};

function engine(name, extra) {
  const e = G.New(extra);
  for (const [setter, ...args] of SETTERS[name]) {
    e[setter](...args);
  }
  return e;
}

// Forward methods on documents, in every configuration.
const FORWARD = [
  ["MarkdownStr", (e, d) => e.MarkdownStr("", d)],
  ["FormatStr", (e, d) => e.FormatStr("", d)],
  ["Md2HTML", (e, d) => e.Md2HTML(d)],
  ["Md2VditorDOM", (e, d) => e.Md2VditorDOM(d)],
  ["Md2VditorIRDOM", (e, d) => e.Md2VditorIRDOM(d)],
  ["Md2VditorSVDOM", (e, d) => e.Md2VditorSVDOM(d)],
  ["Md2BlockDOM", (e, d) => e.Md2BlockDOM(d, false)],
  ["RenderJSON", (e, d) => e.RenderJSON(d)],
];
for (const cfg of Object.keys(SETTERS)) {
  const e = engine(cfg);
  for (const doc of ["rich", "table", "code", "ial"]) {
    for (const [name, f] of FORWARD) {
      rec(`${cfg}/${name}/${doc}`, () => f(e, DOCS[doc]));
    }
  }
}

// Other forward methods.
{
  const e = engine("default");
  for (const doc of ["rich", "table", "cjk"]) {
    rec(`default/RenderEChartsJSON/${doc}`, () => e.RenderEChartsJSON(DOCS[doc]));
    rec(`default/RenderKityMinderJSON/${doc}`, () => e.RenderKityMinderJSON(DOCS[doc]));
    rec(`default/TextBundleStr/${doc}`, () => e.TextBundleStr("n", DOCS[doc], ["p/"]));
    rec(`default/Space/${doc}`, () => e.Space(DOCS[doc]));
  }
  const p = engine("protyle");
  for (const doc of ["rich", "ial", "code"]) {
    rec(`protyle/ProtylePreviewStr/${doc}`, () => p.ProtylePreviewStr("n", DOCS[doc]));
    rec(`protyle/Md2BlockDOMWithAutoLink/${doc}`, () => p.Md2BlockDOMWithAutoLink(DOCS[doc], true));
    rec(`protyle/InlineMd2BlockDOM/${doc}`, () => p.InlineMd2BlockDOM(DOCS[doc]));
  }
  rec("default/IsValidLinkDest", () => [e.IsValidLinkDest("http://a.b"), e.IsValidLinkDest("a b c"), e.IsValidLinkDest("")]);
  rec("default/GetLinkDest", () => e.GetLinkDest("[a](http://b.c)"));
  rec("default/GetEmojis", () => Object.keys(e.GetEmojis()).length > 0);
  rec("default/RemoveEmoji", () => e.RemoveEmoji("a :smile: b"));
  rec("default/PutEmojis+GetEmojis", () => {
    e.PutEmojis({ zz: "z.png" });
    return e.GetEmojis().zz;
  });
  rec("default/GetTerms", () => Object.keys(e.GetTerms()).length > 0);
  rec("default/SetLinkBase+GetLinkBase", () => {
    e.SetLinkBase("http://base/");
    return e.GetLinkBase();
  });
}

// Reverse methods on the DOM that the same bundle produced.
for (const doc of ["rich", "table", "code", "ial", "caret", "ul", "ol", "tl", "quote", "callout"]) {
  {
    const e = engine("wysiwyg");
    const dom = e.Md2VditorDOM(DOCS[doc]);
    rec(`wysiwyg/SpinVditorDOM/${doc}`, () => e.SpinVditorDOM(dom));
    rec(`wysiwyg/VditorDOM2Md/${doc}`, () => e.VditorDOM2Md(dom));
    rec(`wysiwyg/VditorDOM2HTML/${doc}`, () => e.VditorDOM2HTML(dom));
  }
  {
    const e = engine("ir");
    const dom = e.Md2VditorIRDOM(DOCS[doc]);
    rec(`ir/SpinVditorIRDOM/${doc}`, () => e.SpinVditorIRDOM(dom));
    rec(`ir/VditorIRDOM2Md/${doc}`, () => e.VditorIRDOM2Md(dom));
    rec(`ir/VditorIRDOM2HTML/${doc}`, () => e.VditorIRDOM2HTML(dom));
  }
  {
    const e = engine("sv");
    const dom = e.Md2VditorSVDOM(DOCS[doc]);
    rec(`sv/SpinVditorSVDOM/${doc}`, () => e.SpinVditorSVDOM(dom));
  }
  {
    const e = engine("protyle");
    const dom = e.Md2BlockDOM(DOCS[doc], false);
    for (const m of ["SpinBlockDOM", "BlockDOM2Md", "BlockDOM2StdMd", "BlockDOM2HTML", "BlockDOM2RichHTML", "BlockDOM2Content", "BlockDOM2Text", "BlockDOM2TextLen", "BlockDOM2InlineBlockDOM", "BlockDOM2EscapeMarkerContent"]) {
      rec(`protyle/${m}/${doc}`, () => e[m](dom));
    }
    for (const m of ["CancelList", "CancelListRecursively", "CancelBlockquote", "CancelCallout", "CancelSuperBlock", "Blocks2Ps", "UL2OL", "OL2UL", "UL2TL", "OL2TL", "TL2OL", "TL2UL", "Callout2Blockquote", "Blockquote2Callout"]) {
      rec(`protyle/${m}/${doc}`, () => e[m](dom));
    }
    rec(`protyle/Blocks2Hs/${doc}`, () => e.Blocks2Hs(dom, "2"));
    rec(`protyle/ConvertListType/${doc}`, () => e.ConvertListType(dom, "o"));
  }
}

// HTML to Markdown and to the editor DOMs.
for (const name of Object.keys(HTMLS)) {
  const h = HTMLS[name];
  for (const [cfg, methods] of [
    ["default", ["HTML2Md", "HTML2Markdown", "HTML2Text"]],
    ["wysiwyg", ["HTML2VditorDOM"]],
    ["ir", ["HTML2VditorIRDOM"]],
    ["sv", ["HTML2VditorSVDOM"]],
    ["protyle", ["HTML2BlockDOM", "HTML2Md"]],
  ]) {
    const e = engine(cfg);
    for (const m of methods) {
      rec(`${cfg}/${m}/${name}`, () => e[m](h));
    }
  }
}

// Heading levels out of range: the reference throws for some of these.
{
  const e = engine("protyle");
  const heading = (st) => `<div data-subtype="${st}" data-node-id="20260101000000-abcdefg" data-type="NodeHeading" class="h1"><div contenteditable="true" spellcheck="false">x</div></div>`;
  for (const st of ["h1", "h6", "h7", "h-1"]) {
    for (const m of ["BlockDOM2RichHTML", "BlockDOM2Md", "SpinBlockDOM"]) {
      rec(`protyle/${m}/${st}`, () => e[m](heading(st)));
    }
  }
  for (const lv of ["2", "7", "-1"]) {
    rec(`protyle/Blocks2Hs/level ${lv}`, () => e.Blocks2Hs(heading("h1"), lv));
  }
}

// JavaScript renderers through New({renderers}).
{
  const seen = [];
  const renderers = {
    Md2HTML: {
      renderHeading: (node, entering) => {
        if (entering) {
          seen.push([G.GetHeadingID(node), G.GetHeadingIDRaw(node)]);
          return ['<section data-id="' + G.GetHeadingID(node) + '" data-raw="' + G.GetHeadingIDRaw(node) + '"><h1 class="x">', G.WalkContinue];
        }
        return ["</h1></section>\n", G.WalkContinue];
      },
      renderText: (node) => [node.TokensStr().toUpperCase(), G.WalkContinue],
      renderBlockquote: (_node, entering) => (entering ? ["<blockquote>skipped</blockquote>\n", G.WalkSkipChildren] : ["", G.WalkContinue]),
      renderCodeSpan: () => ["<kbd>c</kbd>", G.WalkSkipChildren],
    },
    Md2VditorDOM: { renderParagraph: (_n, entering) => [entering ? "<p data-js>" : "</p>", G.WalkContinue] },
    Md2BlockDOM: { renderText: (node) => ["[" + node.TokensStr() + "]", G.WalkContinue] },
    HTML2Md: { renderText: (node) => [node.TokensStr() + "!", G.WalkContinue] },
  };
  for (const doc of ["rich", "table", "cjk", "code"]) {
    const e = G.New({ renderers });
    rec(`renderers/MarkdownStr/${doc}`, () => e.MarkdownStr("", DOCS[doc]));
    rec(`renderers/Md2HTML/${doc}`, () => e.Md2HTML(DOCS[doc]));
    rec(`renderers/Md2VditorDOM/${doc}`, () => e.Md2VditorDOM(DOCS[doc]));
    rec(`renderers/Md2BlockDOM/${doc}`, () => {
      const p = G.New({ renderers });
      p.SetProtyleWYSIWYG(true);
      return p.Md2BlockDOM(DOCS[doc], false);
    });
    rec(`renderers/HTML2Md/${doc}`, () => e.HTML2Md("<p>" + doc + " text</p>"));
  }
  rec("renderers/heading ids", () => seen);
  rec("renderers/WalkStop", () => G.New({ renderers: { Md2HTML: { renderList: () => ["LIST", G.WalkStop] } } }).MarkdownStr("", DOCS.rich));
  for (const bad of [{ renderers: { Md2HTML: 1 } }, { renderers: { NoSuchRenderer: {} } }, { renderers: { Md2HTML: { renderText: () => 1 } } }, null, {}]) {
    rec("renderers/options " + show(bad), () => G.New(bad).MarkdownStr("", "a *b*"));
  }
}

// The functions of the global object.
rec("NewNodeID shape", () => {
  const ids = [G.NewNodeID(), G.NewNodeID(), G.NewNodeID()];
  return [ids.every((id) => /^\d{14}-[0-9a-z]{7}$/.test(id)), new Set(ids).size];
});
for (const s of ["", "a<b>&\"'", "&lt;&gt;&amp;&quot;&#39;&copy;&#x41;&nbsp;", "中文<>", "<script>alert(1)</script>", "\u0000​"]) {
  rec("EscapeHTMLStr " + show(s), () => G.EscapeHTMLStr(s));
  rec("UnEscapeHTMLStr " + show(s), () => G.UnEscapeHTMLStr(s));
}
for (const s of ["- a\n  - b\n  - c\n- d", "- a", "1. x\n2. y", "", "- a\n\n- b\n   text", "* [ ] t\n  * u", "- 中文\n  - 子"]) {
  rec("EChartsMindmapStr " + show(s), () => G.EChartsMindmapStr(s));
}
for (const s of ["<script>x</script>ok", "<a href=\"javascript:alert(1)\">x</a>", "<img src=x onerror=alert(1)>", "<b onclick=\"x\">b</b>", "plain", "<iframe src=\"//x\"></iframe>", "<p style=\"color:red\">p</p>"]) {
  rec("Sanitize " + show(s), () => G.Sanitize(s));
}
{
  const e = engine("protyle");
  for (const doc of ["rich", "table", "code", "ial", "cjk"]) {
    const dom = e.Md2BlockDOM(DOCS[doc], false);
    rec("BlockDOM2Content " + doc, () => G.BlockDOM2Content(dom));
  }
  rec("BlockDOM2Content garbage", () => G.BlockDOM2Content("<div>not block dom</div>"));
  rec("BlockDOM2Content empty", () => G.BlockDOM2Content(""));
}

process.stdout.write(JSON.stringify(out));
