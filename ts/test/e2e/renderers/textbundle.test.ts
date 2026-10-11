import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOutcome, newEngines, readRepoFile } from "../helpers.ts";
import { OPTION_SETS } from "../option_sets.ts";
import { BLOCKS, INLINES } from "./format_corpus.ts";
import { FULL } from "../full.ts";
import { textBundleBoth } from "./format_helpers.ts";


// TextBundleRenderer: the port (parse.Parse + NewTextBundleRenderer(...).Render(), as lute.go TextBundle does) against the reference bundle's TextBundleStr.
// Both results are compared: the text and the list of original links.

const PREFIX_SETS: string[][] = [
  [],
  [""],
  ["https://img.hacpai.com", "https://b3logfile.com"],
  ["https://img.hacpai.com/dir1", "https://img.hacpai.com"],
  ["https://x.com", "assets", "https://x.com/y"],
  ["https://链滴.com", "http"],
  ["https://example.com/"],
];

const DOCS: string[] = [
  "[foo](https://img.hacpai.com/dir1/bar.zip)\n\n![foo](https://b3logfile.com/dir2/baz.png)\n",
  "[a](https://x.com/y/z) ![b](https://x.com/y.png \"title\") [c](https://链滴.com/文件.pdf)\n",
  "<https://x.com/auto> https://x.com/bare [r][ref]\n\n[ref]: https://x.com/ref \"t\"\n",
  "* [l](https://example.com/a)\n* ![i](https://example.com/b.png)\n\n> [q](https://example.com/c)\n",
  "| a | b |\n| - | - |\n| [x](https://x.com/1) | ![y](https://img.hacpai.com/2.png) |\n",
  "[a](http://a) [b](https://a) [c](assets/d) [d](<https://x.com/with space>)\n",
  "`[code](https://x.com/no)`\n\n```\n[block](https://x.com/no)\n```\n",
  "<img src=\"https://x.com/html.png\"> [m](https://x.com/m)\n",
  "[a](https://x.com/y 'title') ![i](https://x.com/y/i.png) [e](https://x.com/y/y)\n",
];

test("TextBundle: port equals oracle (text and original links)", () => {
  const corpus = [...DOCS, ...BLOCKS, ...INLINES.map((s) => s + "\n")];
  const failures: string[] = [];
  let withLinks = 0;
  let bothThrewCount = 0;
  const sets = OPTION_SETS.filter((s) => ["default", "kramdown IAL", "everything on"].includes(s.name));
  assert.equal(sets.length, 3);
  for (const set of sets) {
    const engines = newEngines(set.setters);
    // Quick run: the default set sees every prefix list, the others a sample (see ../full.ts).
    for (const [pi, prefixes] of PREFIX_SETS.entries()) {
      if (!FULL && "default" !== set.name && (pi + sets.indexOf(set)) % 2 !== 0) {
        continue;
      }
      for (const [i, doc] of corpus.entries()) {
        const { port, oracle } = textBundleBoth(engines, "", doc, prefixes);
        try {
          if (assertSameOutcome(`doc ${i} prefixes ${pi} [${set.name}]`, port, oracle) === "bothThrew") {
            bothThrewCount++;
          }
          if (!port.threw && ((JSON.parse(port.value) as [string, string[] | null])[1] ?? []).length > 0) {
            withLinks++;
          }
        } catch (e) {
          failures.push((e as Error).message + "\n  input: " + JSON.stringify(doc));
        }
      }
    }
  }
  assert.deepEqual(failures.slice(0, 20), []);
  assert.deepEqual(failures, []);
  console.log(`TextBundle: ${bothThrewCount} inputs on which both sides throw`);
  assert.ok(withLinks > 50, `only ${withLinks} documents had replaced links`);
});

test("TextBundle: whole files", () => {
  const failures: string[] = [];
  const engines = newEngines([]);
  for (const file of ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case3.md", "test/gfm-spec.md"]) {
    for (const [pi, prefixes] of [["https://github.com", "https://img.shields.io"], ["http"]].entries()) {
      const { port, oracle } = textBundleBoth(engines, file, readRepoFile(file), prefixes);
      try {
        assert.equal(assertSameOutcome(`${file} prefixes ${pi}`, port, oracle), "ok");
      } catch (e) {
        failures.push((e as Error).message);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("TextBundle: the Go doc example", () => {
  const engines = newEngines([]);
  const [text, links] = engines.port.TextBundleStr("", "[foo](https://img.hacpai.com/dir1/bar.zip)\n\n![foo](https://b3logfile.com/dir2/baz.png)\n", ["https://img.hacpai.com", "https://b3logfile.com"]);
  assert.equal(text, "[foo](assets/dir1/bar.zip)\n\n![foo](assets/dir2/baz.png)\n");
  assert.deepEqual(links, ["https://img.hacpai.com/dir1/bar.zip", "https://b3logfile.com/dir2/baz.png"]);
});
