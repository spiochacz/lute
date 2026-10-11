import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOutcome, markdownBoth, newEngines } from "./helpers.ts";
import { FUZZ_SET_NAMES, OPTION_SETS } from "./option_sets.ts";
import { FULL } from "./full.ts";

// A deterministic generator (mulberry32, fixed seed) of short Markdown documents built by combining fragments.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAGMENTS: string[] = [
  // emphasis runs in tricky adjacency
  "*a*", "**a**", "***a***", "_a_", "__a__", "___a___", "*a**b*c**", "**a*b**c*", "_a_b_", "foo*bar*baz", "foo_bar_baz", "*foo _bar* baz_",
  "** a **", "* a *", "*(*a*)*", "_(_a_)_", "**foo*", "*foo**", "a**b**", "__init__", "snake_case_word", "2*3*4", "*", "**", "_", "__", "~~a~~", "~a~", "~~~", "==mark==", "^sup^", "~sub~",
  // links, images, reference definitions
  "[a](b)", "[a](<b c>)", "[a](b \"t\")", "[a](b 'c' )", "![i](src)", "![i](src \"title\")", "[a][r]", "[r]", "[r]: /url", "[r]: /url \"title\"", "[a]: <b>", "[*a*](x)", "[a](b(c)d)", "[a](b\\)c)", "[a]()", "[[a]]", "[a][]", "![a][r]",
  // code spans and fences
  "`a`", "``a`b``", "` a `", "`", "``", "```\ncode\n```", "~~~ lang\ncode\n~~~", "```js\nlet a = 1;\n```", "    indented code", "```\nunclosed", "````\n```\n````",
  // lists and task lists
  "- a", "* a", "+ a", "1. a", "2) a", "- [ ] task", "- [x] done", "- [X] done", "- [ ]no", "* [ ] a\n  * [x] b", "- a\n\n- b", "- a\n  - b\n    - c", "1. a\n2. b", "10. ten", "-", "1.",
  // block quotes
  "> a", "> > a", ">a", "> - a", "> ```\n> c\n> ```", ">",
  // tables
  "| a | b |\n| - | - |\n| 1 | 2 |", "a | b\n--|--\n1 | 2", "| a |\n|:-:|\n| `|` |", "|a|b|\n|-|\n|c|",
  // HTML blocks and inline HTML
  "<div>a</div>", "<div>\n*a*\n</div>", "<!-- c -->", "<p>a</p>", "<br/>", "a <b>c</b>", "<a href=\"x\">y</a>", "<?php x ?>", "<![CDATA[x]]>", "<script>x</script>", "<img src=x>", "<span", "<a",
  // entities
  "&amp;", "&copy;", "&#35;", "&#x22;", "&nbsp;", "&foo;", "&", "&#0;", "&#xD800;", "&notit;",
  // autolinks
  "<http://a.b>", "<a@b.c>", "http://a.b/c", "www.a.com", "www.a.com/b?c=d", "https://github.com/user/repo", "https://github.com/issues/1", "https://github.com/a/b/issues/1", "a@b.co", "a.b@c.d.e", "https://x.y/z)", "(www.a.com)", "www.", "http://", "ftp://a.b",
  // footnotes
  "[^1]", "[^1]: note", "[^a]: note\n    more", "text[^x] more", "[^1]:",
  // headings, setext, thematic breaks
  "# h", "## h ##", "### h {#id}", "#nospace", "####### seven", "Setext\n===", "Setext\n---", "---", "***", "___", "- - -", "***\n---",
  // breaks
  "a  \nb", "a\\\nb", "a\nb", "a\\", "\\*not\\*", "\\\\",
  // CJK, emoji
  "中文测试", "中文English混合", "English中文", "日本語のテキスト", "한국어 텍스트", "😀 emoji", "a😀b", ":smile:", ":heart: :+1:", ":not_an_alias:", "1.2中文3", "中文，标点。", "（括号）",
  // tabs, indentation
  "\ttab", "  two", "   three", "    four", "\t\tcode", "- a\n\tb", ">\ta",
  // misc
  "$a$", "$$\nx\n$$", "{{ }}", "((id \"t\"))", "{: id=\"a\"}", "{: id=\"20200101000000-abcdefg\" style=\"c\"}", "#tag#", "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x", "---\ntitle: t\n---", "{{{\na\n}}}", "> [!NOTE]\n> text", "== a ==", "[[ref]]", "[toc]", "[TOC]", "\\", "#",
  // text
  "plain", "word word", "Hello, world!", "a", "", "foo bar", "　", "​",
];

const SEPARATORS: string[] = ["", " ", "\n", "\n", "\n\n", "\n\n", "\r\n", "\r\n\r\n", "\n  ", "\n\t", "\n    ", "\n> ", "\n- ", "\0"];

function generate(count: number, seed: number): string[] {
  const rand = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const ret: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = 1 + Math.floor(rand() * 7);
    let doc = "";
    for (let j = 0; j < n; j++) {
      if (j > 0) {
        doc += pick(SEPARATORS);
      }
      doc += pick(FRAGMENTS);
    }
    if (rand() < 0.3) {
      doc += "\n";
    }
    ret.push(doc);
  }
  return ret;
}

const DOC_COUNT = 1500;
// The quick run (see ./full.ts) compares the first QUICK_DOC_COUNT documents of the same sequence; the expected counts of common throws below are for DOC_COUNT.
const QUICK_DOC_COUNT = 300;
const SEED = 20260101;

// Inputs on which the reference throws; the port must throw too (checked below).
const KNOWN_THROWING_INPUTS: { name: string; input: string; sets: string[] }[] = [
  { name: "github issue URL, default", input: "https://github.com/issues/1", sets: ["default", "everything on"] },
  { name: "kramdown IAL line that is not an IAL, Protyle", input: "{: id=\"a\"}", sets: ["Protyle"] },
];

// Number of generated documents on which both sides throw, per option set (the throwing fragments are the known inputs above). A change is noticed.
const EXPECTED_BOTH_THREW: Record<string, number> = {
  "default": 36, // the GitHub issue URL fragment
  "everything on": 36,
  "Protyle": 18, // the kramdown IAL fragment
  "no GFM auto link": 0,
};

test("known throwing inputs: both sides throw", () => {
  for (const known of KNOWN_THROWING_INPUTS) {
    for (const setName of known.sets) {
      const set = OPTION_SETS.find((s) => s.name === setName)!;
      const engines = newEngines(set.setters);
      const { port, oracle } = markdownBoth(engines, "", known.input);
      assert.equal(oracle.threw, true, `${known.name}: the oracle is expected to throw`);
      assert.equal(port.threw, true, `${known.name}: the port is expected to throw`);
    }
  }
});

test(`fuzz: ${DOC_COUNT} generated documents under ${FUZZ_SET_NAMES.length} option sets, port equals oracle`, () => {
  const all = generate(DOC_COUNT, SEED);
  assert.equal(new Set(all).size > DOC_COUNT * 0.8, true);
  const docs = FULL ? all : all.slice(0, QUICK_DOC_COUNT);
  const bothThrew: Record<string, number> = {};
  const failures: string[] = [];
  for (const setName of FUZZ_SET_NAMES) {
    const set = OPTION_SETS.find((s) => s.name === setName)!;
    const engines = newEngines(set.setters);
    bothThrew[setName] = 0;
    for (let i = 0; i < docs.length; i++) {
      const { port, oracle } = markdownBoth(engines, "", docs[i]);
      try {
        if (assertSameOutcome(`doc ${i} [${setName}] ${JSON.stringify(docs[i])}`, port, oracle) === "bothThrew") {
          bothThrew[setName]++;
        }
      } catch (e) {
        failures.push((e as Error).message);
        if (failures.length >= 20) {
          break;
        }
      }
    }
  }
  assert.deepEqual(failures, []);
  if (FULL) {
    assert.deepEqual(bothThrew, EXPECTED_BOTH_THREW);
  } else {
    for (const [name, count] of Object.entries(bothThrew)) {
      assert.ok(count <= EXPECTED_BOTH_THREW[name], `${name}: ${count} common throws`);
    }
  }
});
