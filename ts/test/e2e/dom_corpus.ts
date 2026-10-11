// Corpora of the DOM-to-Markdown direction, shared by the end-to-end tests. Moved unchanged from root/vditor_wysiwyg.test.ts when the
// replay test (root/dom2md_replay.test.ts, tasks/004 milestone A) needed the same inputs; a test file cannot be imported for them.

import { readRepoFile } from "./helpers.ts";
import type { SetterCall } from "./helpers.ts";
import { CARET_DOCS, JSON_DOCS, withCarets } from "./renderers/json_vditor_corpus.ts";

export const WYSIWYG: SetterCall = ["SetVditorWYSIWYG", true];

export interface OptionSet {
  name: string;
  setters: SetterCall[];
}

export const SETS: OptionSet[] = [
  { name: "default", setters: [] },
  { name: "wysiwyg", setters: [WYSIWYG] },
  { name: "wysiwyg + all previews", setters: [WYSIWYG, ["SetVditorCodeBlockPreview", true], ["SetVditorMathBlockPreview", true], ["SetVditorHTMLBlockPreview", true]] },
  { name: "toc, no heading id", setters: [WYSIWYG, ["SetToC", true], ["SetHeadingID", false]] },
  { name: "heading id", setters: [WYSIWYG, ["SetHeadingID", true], ["SetToC", true]] },
  { name: "no footnotes", setters: [WYSIWYG, ["SetFootnotes", false]] },
  { name: "no auto space, no fix term typo", setters: [WYSIWYG, ["SetAutoSpace", false], ["SetFixTermTypo", false]] },
  { name: "sanitize", setters: [WYSIWYG, ["SetSanitize", true], ["SetVditorHTMLBlockPreview", true]] },
  { name: "link base, prefix and emoji site", setters: [WYSIWYG, ["SetLinkBase", "https://example.com/base/"], ["SetLinkPrefix", "https://p.example.org/"], ["SetEmojiSite", "https://emoji.example.com"]] },
  { name: "inline math digit, mark, sup, sub, tag, block ref", setters: [WYSIWYG, ["SetInlineMath", true], ["SetInlineMathAllowDigitAfterOpenMarker", true], ["SetMark", true], ["SetSup", true], ["SetSub", true], ["SetTag", true], ["SetBlockRef", true]] },
  { name: "Chinese paragraph beginning space", setters: [WYSIWYG, ["SetChineseParagraphBeginningSpace", true]] },
  { name: "list style, kramdown IAL", setters: [WYSIWYG, ["SetRenderListStyle", true], ["SetKramdownIAL", true]] },
  { name: "data task", setters: [WYSIWYG, ["SetDataTask", true], ["SetGFMTaskListItemClass", "task-item"]] },
  { name: "protyle wysiwyg", setters: [WYSIWYG, ["SetProtyleWYSIWYG", true]] },
  { name: "no GFM", setters: [WYSIWYG, ["SetGFMTable", false], ["SetGFMTaskListItem", false], ["SetGFMStrikethrough", false], ["SetGFMAutoLink", false]] },
  { name: "callout", setters: [WYSIWYG, ["SetCallout", true]] },
];

export interface Spec {
  markdown: string;
  section: string;
  example: number;
}

// Splits the DOM into tags and text segments; returns the UTF-16 ranges of the text segments.
function textSegments(dom: string): [number, number][] {
  const ret: [number, number][] = [];
  const re = /<[^>]*>|[^<]+/g;
  let m: RegExpExecArray | null;
  while (null !== (m = re.exec(dom))) {
    if (!m[0].startsWith("<")) {
      ret.push([m.index, m.index + m[0].length]);
    }
  }
  return ret;
}

export function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) {
    return items;
  }
  const ret: T[] = [];
  for (let i = 0; i < count; i++) {
    ret.push(items[Math.floor((i * items.length) / count)]);
  }
  return ret;
}

function safeCut(s: string, i: number): number {
  // do not split a surrogate pair
  const prev = i > 0 ? s.charCodeAt(i - 1) : 0;
  const next = i < s.length ? s.charCodeAt(i) : 0;
  return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? i + 1 : i;
}

// Editor-like mutations of a Vditor DOM.
export function mutations(dom: string, count: number): string[] {
  const ret: string[] = [];
  const segs = textSegments(dom);
  const points: number[] = [];
  for (const [a, b] of segs) {
    points.push(a, safeCut(dom, Math.floor((a + b) / 2)), b);
  }
  for (const p of spread(points, count)) {
    ret.push(dom.slice(0, p) + "<wbr>" + dom.slice(p)); // caret
  }
  const mid = spread(segs, 3);
  for (const [a, b] of mid) {
    const p = safeCut(dom, Math.floor((a + b) / 2));
    ret.push(dom.slice(0, p) + "x<wbr>" + dom.slice(p)); // typing
    if (b - a > 1) {
      ret.push(dom.slice(0, p) + "<wbr>" + dom.slice(p + 1)); // delete a character after the caret
    }
    ret.push(dom.slice(0, p) + "\n<wbr>" + dom.slice(p)); // newline typed
  }
  const [a, b] = mid[0] ?? [0, 0];
  if (b > a) {
    for (const tag of ["strong", "em", "code", "mark", "del", "b", "i", "s", "sup", "sub", "kbd", "u"]) {
      ret.push(dom.slice(0, a) + `<${tag}>` + dom.slice(a, b) + `</${tag}>` + dom.slice(b));
    }
    ret.push(dom.slice(0, a) + '<a href="https://example.com/x" title="t">' + dom.slice(a, b) + "</a>" + dom.slice(b));
    ret.push(dom.slice(0, a) + '<span style="color:red">' + dom.slice(a, b) + "</span>" + dom.slice(b));
    ret.push(dom.slice(0, a) + "<strong>" + dom.slice(a, b) + " </strong>" + dom.slice(b));
    ret.push(dom.slice(0, a) + "<em> " + dom.slice(a, b) + "</em>" + dom.slice(b));
    ret.push(dom.slice(0, a) + "<strong>" + dom.slice(a, b) + "<br></strong>" + dom.slice(b));
    ret.push(dom.slice(0, a) + "<strong>" + dom.slice(a, b) + "</strong><strong>x</strong>" + dom.slice(b));
  }
  ret.push(dom.replace(/ data-marker="[^"]*"/g, ""));
  ret.push(dom.replace(/ data-block="0"/g, ""));
  ret.push(dom.replace(/ data-tight="true"/g, ""));
  ret.push(dom.replace(/ data-tight="true"/g, ' data-tight="false"'));
  ret.push(dom + dom);
  ret.push("<div>" + dom + "</div>");
  ret.push(dom.replace(/<\/li><li/g, "</li></ul><ul><li"));
  ret.push(dom.replace(/<\/li>/g, "</li>\n"));
  ret.push(dom.replace(/<li( [^>]*)?>/g, "<li$1>foo<br>"));
  ret.push(dom.replace(/<\/p>/g, "<br></p>"));
  ret.push(dom.replace(/<br ?\/?>/g, "<br>"));
  return ret;
}

// A hand-written DOM that reaches the branches of the DOM-to-tree converter that Md2VditorDOM does not produce.
export const RAW_DOMS: string[] = [
  "",
  "foo",
  "<p>foo</p>",
  "<p>foo<br></p>",
  "<p>foo<wbr></p><p><wbr><br></p>",
  "<h1>foo</h1><h2 data-marker=\"=\">bar</h2><h3 data-marker=\"-\" data-id=\"#x\">baz</h3><h4></h4><h5> </h5><h6>x</h6>",
  "<hr><hr/>",
  "<blockquote><p>foo</p></blockquote><blockquote>&gt;</blockquote><blockquote><wbr></blockquote><blockquote></blockquote>",
  "<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>",
  "<ul><li>a</li><ul><li>c</li></ul></ul>",
  "<ul data-marker=\"-\"><li>a</li></ul><ul data-marker=\"-\"><li>b</li></ul>",
  "<ul><li>a</li></ul><ul><li data-node-id=\"20200101010101-aaaaaaa\">b</li></ul>",
  "<ol><li>a</li><li>b</li></ol><ol start=\"3\"><li>c</li></ol>",
  "<ol start=\"5\"><li data-marker=\"5.\">a</li><li data-marker=\"6)\">b</li></ol>",
  "<ol><li data-marker=\"*\">a</li><li data-marker=\"3.\">b</li></ol>",
  "<ul><li data-marker=\"1.\">a</li><li data-marker=\"x\">b</li></ul>",
  "<ul><li data-marker=\"é\">a</li></ul>",
  "<ol><li data-marker=\"é\">a</li></ol>",
  "<ol><li data-marker=\"1é\">a</li></ol>",
  "<ol><li>a<ol><li data-marker=\"3.\">b</li></ol></li></ol>",
  "<ol><li>x</li><li data-marker=\"4.\">y<ol><li data-marker=\"2.\">b</li></ol></li></ol>",
  "<li>orphan</li>",
  "<ul><li><p>a</p><p>b</p></li></ul>",
  "<ul><li>a<p>b</p></li></ul>",
  "<ul><li>a<br><p>b</p></li></ul>",
  "<ul><li><wbr><br></li></ul>",
  "<ul><li>a</li><li><br>b</li></ul>",
  "<ul><li>a</li><li>‸<br></li></ul>",
  "<ul><li>text <em>x</em> more<div>d</div>tail<table><tbody><tr><td>c</td></tr></tbody></table></li></ul>",
  "<ul><li><input type=\"checkbox\" /> a</li><li><input type=\"checkbox\" checked=\"\" data-task=\"X\" /> b</li></ul>",
  "<ul><li class=\"vditor-task\"><input type=\"checkbox\"> foo</li><li class=\"vditor-task\">[ ] <wbr><br></li></ul>",
  "<ul><li><p><input type=\"checkbox\" data-task=\"x\"/><span> foo</span></p></li></ul>",
  "<p><input type=\"checkbox\"> x</p>",
  "<div><input type=\"checkbox\"></div>",
  "<ul><li><span> </span><input type=\"checkbox\"><span> x</span></li></ul>",
  "<pre><code>a\nb</code></pre>",
  "<pre><code class=\"language-go\">a\nb</code></pre>",
  "<pre><code class=\"x language-go\">a\nb</code></pre>",
  "<pre><code class=\"é language-go\">a\nb</code></pre>",
  "<pre><code></code></pre>",
  "<pre></pre>",
  "<pre>text</pre>",
  "<pre><code><code>x</code></code></pre>",
  "<div class=\"vditor-wysiwyg__block\" data-type=\"code-block\" data-block=\"0\" data-marker=\"~~~\"><pre class=\"vditor-wysiwyg__pre\"><code class=\"language-js\">a\n</code></pre><pre class=\"vditor-wysiwyg__preview\" data-render=\"2\"><code>a</code></pre></div>",
  "<div class=\"vditor-wysiwyg__block\" data-type=\"math-block\" data-block=\"0\"><pre><code data-type=\"math-block\">a^2</code></pre><pre class=\"vditor-wysiwyg__preview\" data-render=\"2\">x</pre></div>",
  "<div class=\"vditor-wysiwyg__block\" data-type=\"html-block\" data-block=\"0\"><pre><code>&lt;div&gt;x&lt;/div&gt;</code></pre><pre class=\"vditor-wysiwyg__preview\" data-render=\"2\"><div>x</div></pre></div>",
  "<div data-type=\"yaml-front-matter\" data-block=\"0\"><pre><code data-type=\"yaml-front-matter\">a: b</code></pre></div>",
  "<div data-type=\"link-ref-defs-block\" data-block=\"0\">[foo]: bar\n</div>",
  "<div data-type=\"toc-block\" class=\"vditor-toc\"><ul><li>x</li></ul></div>",
  "<div data-type=\"footnotes-block\"><ol data-type=\"footnotes-defs-ol\"><li data-marker=\"^a\"><p>foo bar</p></li>\n<li data-marker=\"^b\"><p>baz</p><p>two</p></li></ol></div>",
  "<div data-type=\"footnotes-block\"><ul><li>x</li></ul></div>",
  "<div data-type=\"footnotes-block\"><ol><li data-marker=\"^a\"></li></ol></div>",
  "<div data-type=\"footnotes-block\"></div>",
  "<div data-render=\"1\">x</div><p data-render=\"2\">y</p>",
  "<div>plain div</div>",
  "<table><thead><tr><th align=\"left\">a</th><th align=\"center\">b</th><th align=\"right\">c</th><th>d</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td><td>4</td></tr></tbody></table>",
  "<table><thead><tr><th>a<br></th></tr></thead><tbody><tr><td>1<br>2</td></tr><tr><td><br></td></tr><tr><td><wbr><br></td></tr><tr><td>x<br><wbr></td></tr></tbody></table>",
  "<table></table>",
  "<table><thead></thead></table>",
  "<table><tbody><tr><td>x</td></tr></tbody></table>",
  "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td><ul><li>x</li><li>y</li></ul></td></tr></tbody></table>",
  "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td><ol><li>x</li></ol> tail</td></tr></tbody></table>",
  "<table><tr><td class=\"gutter\">1</td><td class=\"code\"><div class=\"container\"><div class=\"line\">a</div><div class=\"line\">b</div></div></td></tr></table>",
  "<table class=\"syntaxhighlighter js\"><tr><td class=\"code\"><div class=\"container\"><div>a</div></div></td></tr></table>",
  "<table><tr><td><span class=\"lnt\">1</span></td><td class=\"code\"><div><div>a</div></div></td></tr></table>",
  "<p>a <em>b</em> c <i>i</i> <strong>s</strong> <b>b</b> <del>d</del> <s>s</s> <strike>k</strike> <mark>m</mark> <sup>u</sup> <sub>l</sub> <kbd>k</kbd> <u>u</u></p>",
  "<p><em></em><strong></strong><del></del><mark></mark><sup></sup><sub></sub></p>",
  "<p><em><br></em><strong><br></strong><del><br></del><mark><br></mark><sup><br></sup><sub><br></sub></p>",
  "<p><em>\nfoo</em><strong>​\nfoo</strong><del>\nx</del><mark>\ny</mark><sup>\nz</sup><sub>\nw</sub></p>",
  "<p><em><wbr></em><strong><wbr></strong><del>‸</del><mark>‸</mark><sup>‸</sup><sub>‸</sub></p>",
  "<p><em>‸<br></em><strong>‸<br></strong><del>‸<br></del><mark>‸<br></mark><sup>‸<br></sup><sub>‸<br></sub></p>",
  "<p><em data-marker=\"_\"> x </em><strong data-marker=\"__\"> x </strong><del data-marker=\"~\"> x </del><mark data-marker=\"=\"> x </mark><sup data-marker=\"^\"> x </sup><sub data-marker=\"~\"> x </sub></p>",
  "<p><em data-marker=\"_\">x\n</em><strong data-marker=\"__\">x\n</strong><del data-marker=\"~\">x\n</del></p>",
  "<p><em> </em><strong> </strong><em>​</em><strong>​‸</strong></p>",
  "<p>a<strong>b</strong><strong>c</strong>d</p>",
  "<p>a<strong> b</strong> <strong>c </strong>d</p>",
  "<p><sup data-type=\"footnotes-ref\" data-footnotes-label=\"^a\">1</sup><sup data-type=\"footnotes-ref\" data-footnotes-label=\"^a\">1‸</sup></p>",
  "<p><code>a</code><code>b</code><code data-marker=\"``\">`x`</code><code>`</code><code>‸</code><code></code><code data-type=\"html-inline\">&lt;b&gt;</code></p>",
  "<p><code>a</code><code>b</code><code>c</code></p>",
  "<p><code><a href=\"u\">x</a></code> <code>y<a href=\"u\">x</a></code></p>",
  "<p><a href=\"u\"><code>x</code></a> <code><code>x</code></code></p>",
  "<p><a href=\"u\" title=\"t\">x</a> <a href=\"u\"></a> <a href=\"u\">​</a> <a href=\"u\"><img src=\"i.png\"></a> <a href=\"u\"><strong>b</strong></a></p>",
  "<p><a></a><a>x</a><a href=\"\">y</a></p>",
  "<p><img src=\"a.png\" alt=\"al\" title=\"ti\"><img src=\"a.png\"><img class=\"emoji\" alt=\"smile\" src=\"https://x/smile.png\"><img data-type=\"link-ref\" alt=\"t\" data-link-label=\"l\"></p>",
  "<p><span data-type=\"link-ref\" data-link-label=\"foo\">text</span><span data-render=\"2\">x</span></p>",
  "<p><span data-type=\"link-ref\" data-link-label=\"foo\">text</span></p>",
  "<p><span class=\"vditor-comment\" data-cmtids=\"1\">foo</span> <span class=\"vditor-comment\" data-cmtids=\"1\" data-x>bar</span></p>",
  "<p><span data-type=\"math-inline\"><code data-type=\"math-inline\">a^2</code><span data-render=\"2\">x</span></span></p>",
  "<p><span data-type=\"math-inline\">​<code data-type=\"math-inline\">a^2</code></span></p>",
  "<p><span data-type=\"html-inline\"><code data-type=\"html-inline\">&lt;b&gt;</code></span> <span data-type=\"code-inline\"><code>x</code></span> <span data-type=\"html-entity\"><code>&amp;amp;</code></span></p>",
  "<p><span data-type=\"html-entity\">​<span>&amp;</span></span></p>",
  "<p><span>​</span><span><code>​</code></span><span style=\"color:red\">x</span><span>plain</span><span></span></p>",
  "<p><span data-type=\"backslash\"><span>\\</span>$</span><span data-type=\"code\">x</span></p>",
  "<p><span class=\"hljs-keyword\">a</span> <span class=\"hljs-x\"><span class=\"hljs-y\">b</span></span></p>",
  "<p><font color=\"red\">x</font><o:p></o:p><ucapcontent>y</ucapcontent><ucaptitle>z</ucaptitle><markerow8>m</markerow8><app-document-text>t</app-document-text><ms-cmark-node>n</ms-cmark-node></p>",
  "<ucaptitle>Title</ucaptitle><ucapcontent>content</ucapcontent>",
  "<p><details><summary>s</summary>body</details></p><details open><summary>S</summary><p>x</p></details>",
  "<details><summary>S</summary></details>",
  "<p><kbd>k</kbd><br><br>x</p>",
  "<p>a<br>b</p><p>c<br></p><ul><li>a<br></li></ul><p>d<br></p><ul><li>x</li></ul>",
  "<p>a<br></p><blockquote><p>b</p></blockquote>",
  "<ul><li><p>a<br></p></li><li>b</li></ul>",
  "<ul><li><p>a<br></p><ul><li>c</li></ul></li><li>b</li></ul>",
  "    indented text",
  "<p>x</p>\t    indented",
  "<p>x</p>    indented<wbr>",
  "<p>x</p>\t\n<p>y</p>    \n<p>z</p>",
  "\t    ‸ code?",
  "<p>a</p>\n\n<p>b</p>",
  "<div>  </div>\n  \n<p> </p>",
  "<p>ab<wbr>c</p><wbr><p><wbr></p>",
  "<p><wbr data-v-1>x</p>",
  "<p><wbr data-v-abc=\"\">x<wbr></p>",
  "<p>x</p><wbr data-v-1><p>y</p>",
  "<figure><noscript><img src=\"a.png\" alt=\"x\"></noscript><img src=\"b.png\"><figcaption>cap</figcaption></figure>",
  "<figure><noscript><img src=\"a.png\"></noscript></figure>",
  "<figure><noscript>text</noscript></figure>",
  "<noscript><img src=\"a.png\"></noscript>",
  "<span class=\"katex--display\"><span class=\"katex-mathml\"><math><semantics><annotation encoding=\"application/x-tex\">x^2</annotation></semantics></math>x\n  y\n\n\n\nz^2</span></span>",
  "<span class=\"katex--inline\"><span class=\"katex-mathml\">a\n b</span></span>",
  "<span class=\"katex--inline\"><span class=\"katex-mathml\"></span></span>",
  "<span class=\"katex\">x</span><div class=\"katex\"><p>y</p></div>",
  "<span class=\"mwe-math-element\"><math><annotation encoding=\"application/x-tex\">E=mc^2</annotation></math></span>",
  "<span class=\"mwe-math-element\"><img alt=\"E=mc^2\" src=\"x.png\"></span>",
  "<div class=\"tex-x\"><img alt=\"a+b\" src=\"x.png\"></div><span class=\"text\"><img alt=\"q\"></span>",
  "<img class=\"ma-tex-img\" alt=\"a+b\" src=\"x.png\"><img class=\"ma-tex-img\" src=\"x.png\">",
  "<span data-formula=\"a+b\">x</span><script type=\"math/tex\">a+b</script>",
  "<mjx-container data-formula=\"a+b\">x</mjx-container>",
  "<span class=\"texhtml\">E<sub>0</sub></span>",
  "<span class=\"math\"><script type=\"math/tex\">c^2</script></span>",
  "<span class=\"math\" data-custom-copy-text=\"cc\">x</span><span class=\"math\" data-math=\"dm\">x</span>",
  "<span class=\"math\">m</span>",
  "<span class=\"x language-math\" data-math=\"dm\">x</span><span class=\"language-math\">txt</span>",
  "<div class=\"language-math\"></div>",
  "<ul><li>a</li><li></li><li>\n</li></ul><ol></ol><ul></ul>",
  "<ul>\n<li>a</li>\n<li>b</li>\n</ul>",
  "<ul>\n  <li>\n    a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>",
  "<!-- comment --><p>x<!-- c --></p><!-- c2 -->",
  "<p>a&nbsp;b&lt;c&amp;d</p>",
  "<p>  x à</p><p><strong>à </strong> <strong> x</strong> <em>à</em> <em>x </em></p>",
  "<p><strong>xà</strong><em>y </em><del>zà</del><mark>w </mark></p>",
  "<p><strong> </strong><strong> </strong><em> </em></p>",
  "<h1><br></h1><h2>a<br></h2>",
  "<h2 data-id=\"{#x}\">title<wbr></h2>",
  "<h1>a <em>b</em> <code>c</code> <a href=\"u\">d</a></h1>",
  "<unknown>x</unknown><custom-tag>y</custom-tag><iframe src=\"a\"></iframe><video src=\"a\"></video><audio src=\"a\"></audio>",
  "<form><input type=\"text\"></form><button>b</button><textarea>t</textarea><select><option>o</option></select>",
  "<script>alert(1)</script><style>p{}</style>",
  "<svg><circle/></svg><math><mi>x</mi></math>",
  "<section><p>x</p></section><article><h1>t</h1></article><center>c</center>",
  "<dl><dt>a</dt><dd>b</dd></dl>",
  "<p>text</p>tail text<span>span at root</span><em>em at root</em>",
  "<body><p>x</p></body>",
  "<html><head><title>t</title></head><body><p>x</p></body></html>",
  "<!DOCTYPE html><html><body><p>x</p></body></html>",
  "<p>unclosed <em>em <strong>strong",
  "<p>a</p></div></ul>",
  "<<p>>x</p",
  "<p data-v-1 data-x=\"1\" class=\"c\" id=\"i\" style=\"s\" title=\"t\">attrs</p>",
  "‸",
  "<p>‸</p><p>x‸</p><p>‸x</p>",
  "<p>a</p><p>b</p>".repeat(50),
];

// Markdown to feed to the oracle's Md2VditorDOM: the inputs of the renderer tests plus the CommonMark spec, README and the documents of the repository.
export function markdownCorpus(): string[] {
  const spec = JSON.parse(readRepoFile("test/commonmark-spec.json")) as Spec[];
  const docs: string[] = [...JSON_DOCS, ...CARET_DOCS, ...spec.map((s) => s.markdown)];
  for (const doc of JSON_DOCS) {
    docs.push(...withCarets(doc).slice(0, 2));
  }
  return docs;
}

const FILES = ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case1.md", "test/format-case2.md", "test/gfm-spec.md"];

export function fileDocs(): string[] {
  const ret: string[] = [];
  for (const f of FILES) {
    try {
      ret.push(readRepoFile(f).split("\n").slice(0, 120).join("\n"));
    } catch {
      // the file does not exist in this checkout
    }
  }
  ret.push(readRepoFile("benchmark/commonmark-spec.md").split("\n").slice(0, 200).join("\n"));
  return ret;
}

