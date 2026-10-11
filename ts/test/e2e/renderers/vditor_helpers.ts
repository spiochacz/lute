// Helpers of the VditorIRRenderer and VditorSVRenderer end-to-end tests. The port side is the engine method Md2VditorIRDOM or Md2VditorSVDOM;
// neither changes an option before parsing, the tests set VditorIR / VditorSV themselves.

import * as editor from "../../../src/editor/index.ts";
import { attempt } from "../helpers.ts";
import type { Engines, Outcome, SetterCall } from "../helpers.ts";

export function irBoth(engines: Engines, markdown: string): { port: Outcome; oracle: Outcome } {
  return {
    port: attempt(() => engines.port.Md2VditorIRDOM(markdown)),
    oracle: attempt(() => engines.oracle.Md2VditorIRDOM(markdown) as string),
  };
}

export function svBoth(engines: Engines, markdown: string): { port: Outcome; oracle: Outcome } {
  return {
    port: attempt(() => engines.port.Md2VditorSVDOM(markdown)),
    oracle: attempt(() => engines.oracle.Md2VditorSVDOM(markdown) as string),
  };
}

export interface VditorSet {
  name: string;
  setters: SetterCall[];
}

const IR_ON: SetterCall = ["SetVditorIR", true];
const SV_ON: SetterCall = ["SetVditorSV", true];

// Option sets: every option the two renderers (or the parse of the caret) branch on, one at a time and in a few combinations.
function setsFor(modeOn: SetterCall): VditorSet[] {
  return [
    { name: "default", setters: [] },
    { name: "mode on", setters: [modeOn] },
    { name: "code block preview off", setters: [modeOn, ["SetVditorCodeBlockPreview", false]] },
    { name: "math block preview off", setters: [modeOn, ["SetVditorMathBlockPreview", false]] },
    { name: "html block preview off", setters: [modeOn, ["SetVditorHTMLBlockPreview", false]] },
    { name: "all previews off", setters: [modeOn, ["SetVditorCodeBlockPreview", false], ["SetVditorMathBlockPreview", false], ["SetVditorHTMLBlockPreview", false]] },
    { name: "ToC", setters: [modeOn, ["SetToC", true]] },
    { name: "no footnotes", setters: [modeOn, ["SetFootnotes", false]] },
    { name: "no heading ID", setters: [modeOn, ["SetHeadingID", false]] },
    { name: "heading anchor", setters: [modeOn, ["SetHeadingAnchor", true]] },
    { name: "auto space on", setters: [modeOn, ["SetAutoSpace", true]] },
    { name: "auto space off", setters: [modeOn, ["SetAutoSpace", false]] },
    { name: "fix term typo", setters: [modeOn, ["SetFixTermTypo", true]] },
    { name: "fix term typo off", setters: [modeOn, ["SetFixTermTypo", false]] },
    { name: "sanitize", setters: [modeOn, ["SetSanitize", true]] },
    { name: "link base and prefix", setters: [modeOn, ["SetLinkBase", "https://example.com/base/"], ["SetLinkPrefix", "https://example.org/prefix"]] },
    { name: "emoji site", setters: [modeOn, ["SetEmojiSite", "https://emoji.example.com"]] },
    { name: "no emoji", setters: [modeOn, ["SetEmoji", false]] },
    { name: "inline math", setters: [modeOn, ["SetInlineMath", true]] },
    { name: "inline math digit after open marker", setters: [modeOn, ["SetInlineMath", true], ["SetInlineMathAllowDigitAfterOpenMarker", true]] },
    { name: "mark sup sub", setters: [modeOn, ["SetMark", true], ["SetSup", true], ["SetSub", true]] },
    { name: "chinese paragraph beginning space", setters: [modeOn, ["SetChineseParagraphBeginningSpace", true]] },
    { name: "render list style", setters: [modeOn, ["SetRenderListStyle", true]] },
    { name: "kramdown IAL", setters: [modeOn, ["SetKramdownIAL", true]] },
    { name: "kramdown block IAL", setters: [modeOn, ["SetKramdownBlockIAL", true]] },
    { name: "no setext", setters: [modeOn, ["SetSetext", false]] },
    { name: "no indent code block", setters: [modeOn, ["SetIndentCodeBlock", false]] },
    { name: "no yaml front matter", setters: [modeOn, ["SetYamlFrontMatter", false]] },
    { name: "no GFM table", setters: [modeOn, ["SetGFMTable", false]] },
    { name: "task list options", setters: [modeOn, ["SetArbitraryTaskListItemMarker", true], ["SetDataTask", true], ["SetGFMTaskListItemClass", "task-item"]] },
    { name: "callout and tabs", setters: [modeOn, ["SetCallout", true], ["SetTabs", true]] },
    { name: "soft break not hard", setters: [modeOn, ["SetSoftBreak2HardBreak", false]] },
    { name: "block ref, tag, super block", setters: [modeOn, ["SetBlockRef", true], ["SetTag", true], ["SetSuperBlock", true]] },
    { name: "no link ref", setters: [modeOn, ["SetLinkRef", false]] },
    { name: "img path allow space", setters: [modeOn, ["SetImgPathAllowSpace", true]] },
    {
      name: "vditor typical",
      setters: [
        modeOn, ["SetToC", true], ["SetFootnotes", true], ["SetHeadingID", true], ["SetAutoSpace", true], ["SetFixTermTypo", true],
        ["SetInlineMath", true], ["SetMark", true], ["SetSup", true], ["SetSub", true], ["SetCallout", true], ["SetKramdownIAL", false],
      ],
    },
  ];
}

export const IR_SETS: VditorSet[] = setsFor(IR_ON);
export const SV_SETS: VditorSet[] = setsFor(SV_ON);

// Hand-written documents aimed at the node types the renderers handle specially.
const SNIPPETS: string[] = [
  "plain text",
  "a *em* b",
  "a _em_ b",
  "a **strong** b",
  "a __strong__ b",
  "a ***both*** b",
  "a ~~strike~~ b",
  "a ~strike~ b",
  "a ==mark== b",
  "a =mark= b",
  "a ^sup^ b",
  "a ~sub~ b",
  "a `code` b",
  "a ``co`de`` b",
  "a `` `x` `` b",
  "# Heading\n\ntext",
  "## Heading *em* `code`\n\ntext",
  "###### Six {#custom-id}\n\ntext",
  "# Heading # {#id}\n\ntext",
  "Setext\n======\n\ntext",
  "Setext two\n----\n\ntext",
  "- a\n- b\n- c",
  "* a\n\n* b\n\n* c",
  "+ a\n  + nested\n    + deeper",
  "1. one\n2. two\n3. three",
  "3) three\n4) four",
  "5. five\n\n   para\n\n6. six",
  "- [ ] todo\n- [x] done\n- [X] done2",
  "1. [ ] a\n2. [x] b",
  "- [-] custom\n- [/] other",
  "> quote\n> more",
  "> a\n>\n> > nested",
  "> [!NOTE] Title\n> body",
  "> [!WARNING]\n> body *em*",
  "> [!TIP] ✅ Title with icon\n> body",
  "---",
  "***\n\ntext",
  "line one  \nline two",
  "line one\nline two\nline three",
  "line one\\\nline two",
  "```\ncode\n```",
  "```js\nvar a = 1;\n```",
  "```js\nvar a = 1;\n```\n\ntext",
  "```mermaid\ngraph TD; A-->B;\n```",
  "```mindmap\n- root\n  - child\n```",
  "~~~python\nprint(1)\n~~~",
  "````\n```\nx\n````",
  "```\n```",
  "```js\n```",
  "    indented\n    code",
  "$$\nx^2\n$$",
  "$$\n\n$$",
  "$$\na < b & c\n$$",
  "text $x^2$ text",
  "text $a|b$ text",
  "$ 1 $ and $2$",
  "| a | b |\n| - | - |\n| 1 | 2 |",
  "| a | b | c |\n| :- | :-: | -: |\n| 1 | **2** | `3` |",
  "| a | b |\n| - | - |\n| $x\\|y$ | z |",
  "| a | b |\n| - | - |\n| 1<br>2 | <br> |",
  "| a | b |\n| - | - |\n|   | |",
  "| a |\n| - |",
  "<div>html</div>",
  "<div>\n<p>block</p>\n</div>\n\ntext",
  "<!-- comment -->",
  "text <span>inline</span> text",
  "text <kbd>Ctrl</kbd> text",
  "text <kbd>open only",
  "text close only</kbd>",
  "<img src=\"a.png\" onerror=\"alert(1)\">",
  "<script>alert(1)</script>",
  "[link](http://example.com)",
  "[link](http://example.com \"title\")",
  "[link](<a b> 'title')",
  "[link](javascript:alert(1))",
  "[link](/rel/path)",
  "[ref][label]\n\n[label]: http://example.com \"Title\"",
  "[label]\n\n[label]: http://example.com",
  "[label][]\n\n[label]: /url",
  "<http://example.com>",
  "http://example.com plain autolink",
  "![img](a.png)",
  "![img](a.png \"title\")",
  "![img *em*](rel/a.png)",
  "![ref img][label]\n\n[label]: a.png \"t\"",
  "![](empty-alt.png)",
  "[![img](a.png)](http://example.com)",
  "text[^1] with footnote\n\n[^1]: the note",
  "text[^a] two[^b]\n\n[^a]: first\n[^b]: second",
  "[^1]: orphan def",
  "text[^missing] ref",
  "[^1]: a note\n\n    with two paragraphs\n\n    ```\n    code in note\n    ```\n\ntext[^1]",
  ":smile: emoji alias",
  "emoji unicode \u{1F600} text",
  ":unknown_alias: text",
  "\\*escaped\\* and \\\\ backslash",
  "&amp; &copy; &#35; entity",
  "---\ntitle: yaml\nlist: [a, b]\n---\n\ntext",
  "---\n---\n\ntext",
  "[toc]\n\n# H1\n\n## H2",
  "[toc]",
  "# H1\n\n[toc]\n\n## H2\n\n### H3\n\n## H2b",
  "中文 English 混合text和123数字",
  "中文段落\n\n　　全角缩进段落",
  "emoji \u{1F468}‍\u{1F469} zwj",
  "text{: id=\"20200101000000-abcdefg\"}",
  "para\n{: id=\"20200101000000-abcdefg\" style=\"color:red\"}",
  "- item\n  {: id=\"20200101000000-abcdefg\"}\n{: id=\"20200101000000-hijklmn\"}",
  "{{{row\nsuper\n}}}",
  "((20200101000000-abcdefg \"anchor\")) block ref",
  "#tag# text",
  "term: javascript and github and html5 for fix typo",
  "mixed 中文and English、标点",
  "* * *\n- - -\n___",
  "Term\n: definition",
  "a\n\n\n\nb",
  "  leading space para",
  "\ttab para",
  "tabs:\n\n{% tabs %}\n{% tab One %}\ncontent\n{% endtabs %}",
  "[x]: /url\n\ntext",
  "<br>",
  "line\\\n",
  "end with spaces  ",
];

// Inserts the caret at the UTF-16 offset i, keeping surrogate pairs whole.
function insertCaret(s: string, i: number): string {
  if (i > 0 && i < s.length) {
    const c = s.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff) {
      i--;
    }
  }
  return s.slice(0, i) + editor.Caret + s.slice(i);
}

// Documents with the caret at many positions: start, end, and a spread of inner positions.
export function caretVariants(s: string): string[] {
  const out = new Set<string>();
  const n = s.length;
  const positions = new Set<number>([0, n, 1, n - 1]);
  for (let k = 1; k < 8; k++) {
    positions.add(Math.floor((n * k) / 8));
  }
  // positions around markers: every punctuation character gets a caret before and after it
  let punct = 0;
  for (let i = 0; i < n && punct < 12; i++) {
    if (/[*_`~=^$\[\]()|<>#!{}:\\"-]/.test(s[i])) {
      positions.add(i);
      positions.add(i + 1);
      punct++;
    }
  }
  for (const p of positions) {
    if (p >= 0 && p <= n) {
      out.add(insertCaret(s, p));
    }
  }
  return [...out];
}

export function snippets(): string[] {
  return SNIPPETS;
}

// Extra documents with a caret that the position spread may not hit.
export const CARET_SPECIAL: string[] = [
  "‸",
  "\n‸",
  "‸\n",
  "‸\n\n",
  "\n\n‸\n\n",
  "text\n\n‸",
  "text\n‸",
  "‸text",
  "text‸",
  "*‸*",
  "**‸**",
  "_‸_",
  "~~‸~~",
  "`‸`",
  "``‸``",
  "[‸]()",
  "[‸](http://a.b)",
  "[a](‸)",
  "[a](http://‸a.b)",
  "[a](http://a.b‸ \"t\")",
  "[a](http://a.b \"‸t\")",
  "![‸](a.png)",
  "![a](‸)",
  "![a](a.png)‸text",
  "![a](a.png)‸",
  "‸![a](a.png)",
  "# ‸",
  "#‸ x",
  "‸# x",
  "# x‸",
  "## ‸ {#id}",
  "# x {#i‸d}",
  "x\n===‸",
  "x\n‸===",
  "```‸\ncode\n```",
  "```js‸\ncode\n```",
  "```\n‸\n```",
  "```\ncode‸\n```",
  "```\ncode\n```‸",
  "‸```\ncode\n```",
  "```\ncode\n‸```",
  "$$‸\nx\n$$",
  "$$\n‸\n$$",
  "$$\nx‸\n$$",
  "$‸$",
  "$x‸$",
  "---\n‸\n---",
  "---\ntitle:‸ x\n---",
  "- ‸",
  "- a\n- ‸b",
  "- a\n  - ‸",
  "1. ‸",
  "- [ ] ‸",
  "- [x‸] a",
  "> ‸",
  "> a‸",
  "> [!NOTE‸]",
  "> [!NOTE] Ti‸tle\n> body",
  "| a | b |\n| - | - |\n| ‸ | |",
  "| a | b |\n| - | - |\n| 1‸ | 2 |",
  "| a | b |\n| - | - |\n| | ‸|",
  "| a‸ | b |\n| - | - |",
  "| a | b |\n| - | - |\n| $x‸$ | y |",
  "<div>‸</div>",
  "<div>x</div>‸",
  "‸<div>x</div>",
  "a <b>‸</b>",
  "a <kbd>‸</kbd> b",
  "a <kbd>x</kbd>‸",
  "[^1]‸ text\n\n[^1]: note",
  "text[‸^1]\n\n[^1]: note",
  "text[^1‸]\n\n[^1]: note",
  "[^1]: no‸te\n\ntext[^1]",
  "[^1]: note\n\ntext[^1]‸",
  ":smi‸le:",
  ":smile:‸",
  "‸:smile:",
  "a ‸\\* b",
  "a \\‸* b",
  "&am‸p;",
  "‸&amp;",
  "[toc‸]",
  "[‸toc]",
  "[ref‸][label]\n\n[label]: /u",
  "[ref][la‸bel]\n\n[label]: /u",
  "[ref][label]\n\n[label]: ‸/u",
  "[ref][label]\n\n[label]: /u‸",
  "[label]: ‸",
  "‸\\",
  "\\‸",
  "a​‸",
  "‸​",
  "中‸文",
  "‸中文",
  "中文‸",
];
