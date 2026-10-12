// Builds the editor-DOM fixtures for the conversion experiments (tasks/007) once and writes them to the fixture directory.
// Inputs: benchmark/commonmark-spec.md (212 KB) through the port's Md2VditorDOM and Md2VditorIRDOM, the first 1 KB of it, and a
// non-ASCII document (Polish, CJK, emoji) so that the byte offset to string index path of option A is exercised.
// Usage: node fixtures.ts <fixture dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { New, editor } from "../../src/index.ts";

const dir = process.argv[2];
if (!dir) {
  throw new Error("usage: node fixtures.ts <fixture dir>");
}
mkdirSync(dir, { recursive: true });
const spec = readFileSync(new URL("../../../benchmark/commonmark-spec.md", import.meta.url), "utf8");
const small = spec.slice(0, spec.indexOf("\n", 1024) + 1);
const polish = [
  "# Zażółć gęślą jaźń",
  "",
  "Pchnąć w tę łódź jeża lub ośm skrzyń fig. **Zażółć** *gęślą* `jaźń` — i tak dalej, aż do końca akapitu, który jest dość długi, aby",
  "tekst nie mieścił się w krótkiej ścieżce konwersji (ponad 32 bajty w każdym węźle tekstowym).",
  "",
  "## 中文标题",
  "",
  "這是一段中文文字，用來測試非 ASCII 的路徑。Lute 是一款結構化的 Markdown 引擎，支持 Go 和 JavaScript。",
  "",
  "- emoji 😀 i 🚀 oraz symbole → ← ↑ ↓ ≠ ≈",
  "- [link ł](https://example.com/ścieżka?q=ż) i ![obraz ó](https://example.com/ó.png \"tytuł ą\")",
  "",
  "> cytat z polskimi znakami: ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ",
  "",
  "```go",
  "fmt.Println(\"żółw 🐢\")",
  "```",
  "",
].join("\n");
const nonAscii = polish.repeat(40);

const lute = New();
lute.SetIncrementalDom2Md(false);
for (const [name, md] of [
  ["spec", spec],
  ["small", small],
  ["nonascii", nonAscii],
] as const) {
  const w = lute.Md2VditorDOM(md).split(editor.Zwsp).join("");
  const ir = lute.Md2VditorIRDOM(md).split(editor.Zwsp).join("");
  writeFileSync(`${dir}/${name}.md`, md);
  writeFileSync(`${dir}/${name}.wysiwyg.html`, w);
  writeFileSync(`${dir}/${name}.ir.html`, ir);
  let nonAsciiUnits = 0;
  for (let i = 0; i < w.length; i++) {
    if (w.charCodeAt(i) >= 0x80) {
      nonAsciiUnits++;
    }
  }
  console.log(JSON.stringify({ name, mdChars: md.length, wysiwygChars: w.length, wysiwygBytes: Buffer.byteLength(w), nonAsciiUnits, irChars: ir.length }));
}
