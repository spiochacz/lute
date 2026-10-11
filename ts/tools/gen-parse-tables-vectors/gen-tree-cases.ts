import { writeFileSync } from "node:fs";
import * as ast from "../../src/ast/index.ts";

const cases: { opt: string; md: string }[] = [];
const add = (opt: string, md: string) => cases.push({ opt, md });

const enc = (content: string) => {
  const r = new ast.TableCellRich();
  r.Spec = 1; r.Format = "kramdown"; r.Content = content;
  return r.Encode();
};

// emoji
for (const md of [
  ":+1:", "a :smile: b", ":smile::+1:", "::", ":a", "a:", ":x y:", "no emoji: here", ":myimg:", ":site: x", ":huaji: :siyuan:", "[:smile: link](http://a.b)", "*:+1:* x :unknown_alias: y",
  ":+1: :-1: :100:", "text :smile:", ":smile: text", "中文:smile:中文", ":smile:\n:+1:", "a:b:c:d", ":::", ": :", "e.g. 10:30:45", ":a:b:c:", "![:smile:](x.png)",
]) add("emoji", md);

// tables
for (const md of [
  "| a | b |\n|---|---|\n| 1 | 2 |", "a|b\n-|-\n1|2", "| a | b |\n|:-:|--:|\n| 1 |", "| a |\n|---|\n| 1 | 2 | 3 |", "foo\n---", "foo\n|---|", "para\n| a | b |\n|---|---|\n| x | y |", "| a | b |\n|---|\n| x |",
  "| `a|b` | c |\n|---|---|\n| d | e |", "| a \\| b | c |\n|---|---|\n| $x|y$ | z |", "|a|b|\n|-|-|\n||x|", "| a |\n|---|\n\n| b |\n|---|",
  "| h1 {: colspan=\"2\"} | h2 |\n|---|---|\n| a {: style=\"text-align:right\"} b | c |", "| {: style=\"text-align:center\"} h |\n|---|\n| {: rowspan=\"2\"} c |",
  "| a |\n|---|\n| b |\n\ntext", "x\n\n| a |\n|:--|\n| b |\n", "| 中文 | b |\n|---|---|\n| é | 😀 |", "|a|b|\n|---|---|\n|1|2|\n|3|4|\ntail line",
]) { add("default", md); add("protyle", md); add("ial", md); }

// ial
for (const md of [
  "para\n{: id=\"20200101010101-abcdefg\" custom-a=\"b\"}", "{: id=\"20200101010101-abcdefg\" updated=\"20200101010102\"}\n\ntext", "> quote\n{: id=\"20200101010101-abcdefg\"}", "- item\n  {: id=\"20200101010101-abcdefg\"}\n{: id=\"20200101010102-abcdefg\"}",
  "*em*{: style=\"color:red\"} text", "**s**{: a=\"b\" c='d'} x", "`code`{: k=\"v\"}", "![img](a.png){: style=\"w\"}", "text {: not=\"ial\"}", "*em*{: style=\"&quot;x\"}", "*em*{: a=\"b&amp;c\"}",
  "{: id=\"20200101010101-abcdefg\"}\n{: id=\"20200101010102-abcdefg\"}", "# h\n{: id=\"20200101010101-abcdefg\"}", "```\ncode\n```\n{: id=\"20200101010101-abcdefg\"}", "{: a=\"b\"}",
]) { add("ial", md); add("protyle", md); }

// refs
for (const md of [
  "((20200101010101-abcdefg))", "((20200101010101-abcdefg \"text\"))", "((20200101010101-abcdefg 'text'))", "(( 20200101010101-abcdefg ))", "((20200101010101-abcdefg \"text\")", "((x))", "(((20200101010101-abcdefg)))",
  "a ((20200101010101-abcdefg \"t\")) b ((20200101010102-abcdefg)) c", "((20200101010101-abcdefg (text)))", "((20200101010101-abcdefg \"text\" ))", "((20200101010101-abcdefg 'text'))",
  "((20200101010101-abcdefg \"t\"))*em*", "(", "((", "(((", "(a)", "((20200101010101-abcdefg \"d\"))",
  "<<assets/a.pdf/20200101010101-abcdefg>>", "<<assets/a.pdf/20200101010101-abcdefg \"text\">>", "<<assets/a.pdf/20200101010101-abcdefg 'text'>>", "<<assets/a/b.pdf/20200101010101-abcdefg \"t\">>",
  "<<assets/a.txt/20200101010101-abcdefg>>", "<<assets/../a.pdf/20200101010101-abcdefg>>", "<<<<assets/a.pdf/20200101010101-abcdefg>>", "<<assets/a.pdf/20200101010101-abcdefg", "<<a>>", "<< >>", "<<",
  "<<assets/abcd.pdf/20200101010101-abcdefg>> and <<assets/abcde.pdf/20200101010101-abcdefg \"x y\">>", "<<assets/a.pdf?x=1/20200101010101-abcdefg>>",
]) { add("refs", md); add("protyle", md); }

// rich table cells
const rich = [
  "plain", "**bold**", "**x**{: style=\"color: red;\"} &amp; `a&b`", "- l1\n- l2", "1. a\n2. b", "- [ ] t\n- [x] u", "a\n\nb", "# h", "```\ncode &amp; here\n```", "$$\nx^2\n$$", "> q", "![i](a.png)",
  "[link](http://a.b \"t\")", "((20200101010101-abcdefg \"t\"))", "<span data-type=\"text\" style=\"color: red;\">t</span>{: style=\"color:red\"}",
  "</span>{: style=\"font-family: &amp;x;\"} z", "<span data-type=\"strong\">s</span>{: style=\"a&amp;b\"}", "```mermaid\ngraph\n```", "text `code &amp;` end", "$a|b$ inline", "*e*{: style=\"background:&quot;x&quot;\"}",
  "<span data-type=\"text\">中文é😀</span>{: style=\"font-family:é&amp;中;\"}", "~~s~~ ==m== ^sup^ ~sub~ #tag#", "a  \nb",
];
for (const c of rich) {
  const e = enc(c);
  add("protyle", "| {: table-cell-rich=\"" + e + "\"} h |\n|---|\n| {: table-cell-rich=\"" + e + "\"} c |\n");
  add("ial", "| {: table-cell-rich=\"" + e + "\"} h |\n|---|\n| {: table-cell-rich=\"" + e + "\"} c |\n");
}
add("protyle", "| {: table-cell-rich=\"%%%\"} h |\n|---|\n| a |\n");
add("protyle", "| {: table-cell-rich=\"e30\"} h |\n|---|\n| a |\n");

writeFileSync(process.argv[2], JSON.stringify(cases));
console.log(cases.length);
