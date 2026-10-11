import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as bytes from "../../../src/runtime/bytes.ts";
import * as conv from "../../../src/runtime/conv.ts";
import * as ast from "../../../src/ast/index.ts";
import * as editor from "../../../src/editor/index.ts";
import * as parse from "../../../src/parse/index.ts";
import * as render from "../../../src/render/index.ts";
import { NewProtyleExportMdRenderer } from "../../../src/render/protyle_export_md_renderer.ts";
import { New } from "../../../src/index.ts";
import { assertSameOutcome, attempt, newEngines, normalizeOutput, readRepoFile } from "../helpers.ts";
import type { SetterCall } from "../helpers.ts";
import { buildNode } from "../../../src/render/testhelpers.ts";
import type { NodeSpec } from "../../../src/render/testhelpers.ts";

// ProtyleExportMdRenderer against the real Go renderer. The vectors come from ts/tools/gen-render-exportmd-vectors: about 480 Markdown documents
// (paragraphs with every inline kind, lists, task lists, tables, code, math, HTML, quotes, callouts, super blocks, tabs, footnotes, refs, IAL, the repo
// files test/case1.md, test/format-case*.md, the first 600 lines of benchmark/commonmark-spec.md, README.md) are parsed under a Protyle option set
// (ast.Testing = true), optionally flattened to text marks (NestedInlines2FlattedSpans), and rendered under several render option sets. The port
// does the same parse and render and must give the same bytes. For the kramdown and plain output the render of the parse of the output
// (the round trip) is compared as well; the port has to agree with Go whether or not Go is idempotent on the document.

interface Doc {
  md?: string;
  file?: string;
  lines?: number;
}
interface ParseSet {
  name: string;
  opts: Record<string, unknown>;
  flatten: boolean;
}
interface RenderSet {
  name: string;
  opts: Record<string, unknown>;
  stdPrep: boolean;
  roundTrip: boolean;
}
interface RoundTrip {
  same: boolean;
  th?: boolean;
  o?: string;
  h?: string;
  n: number;
}
interface VecCase {
  d: number;
  p: number;
  r: number;
  th?: boolean;
  o?: string;
  h?: string;
  n: number;
  rt?: RoundTrip;
}

const dir = new URL("./testdata/", import.meta.url);
const corpus: { goVersion: string; docs: Doc[]; parseSets: ParseSet[]; renderSets: RenderSet[] } = JSON.parse(readFileSync(new URL("exportmd_corpus.json", dir), "utf8"));
const cases: VecCase[] = [];
for (const f of readdirSync(dir).filter((n) => /^exportmd_vectors_\d+\.json$/.test(n)).sort()) {
  cases.push(...(JSON.parse(readFileSync(new URL(f, dir), "utf8")) as VecCase[]));
}

function docBytes(d: Doc): Uint8Array {
  if (undefined === d.file) {
    return conv.BytesFromString(d.md ?? "");
  }
  let text = readRepoFile(d.file);
  if (undefined !== d.lines) {
    text = text.split(/(?<=\n)/).slice(0, d.lines).join("");
  }
  return conv.BytesFromString(text);
}

function setByName(target: object, opts: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(opts)) {
    if (!Reflect.has(target, k)) {
      throw new Error("unknown option " + k);
    }
    Reflect.set(target, k, v);
  }
}

const zwspBytes = conv.BytesFromString(editor.Zwsp);

// renderOnce mirrors renderOnce of the generator. ast.SetTesting is a module-level switch, so it is turned off again.
function renderOnce(md: Uint8Array, ps: ParseSet, rs: RenderSet): Uint8Array {
  ast.SetTesting(true);
  try {
    return renderOnce0(md, ps, rs);
  } finally {
    ast.SetTesting(false);
  }
}

function renderOnce0(md: Uint8Array, ps: ParseSet, rs: RenderSet): Uint8Array {
  // parse.Parse (lex.Lexer.NextLine) rewrites a CR in the caller's buffer to LF, so every parse gets its own copy (as in the generator)
  md = md.slice();
  const po = parse.NewOptions();
  setByName(po, ps.opts);
  const tree = parse.Parse("", md, po);
  if (ps.flatten) {
    parse.NestedInlines2FlattedSpans(tree, true);
  }
  if (rs.stdPrep) {
    ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
      if (!entering) {
        return ast.WalkContinue;
      }
      if (ast.NodeKramdownBlockIAL === n.Type || ast.NodeKramdownSpanIAL === n.Type) {
        n.Tokens = null;
      }
      return ast.WalkContinue;
    });
    ast.Walk(tree.Root!, (n: ast.Node, entering: boolean): ast.WalkStatus => {
      if (entering) {
        // Go: bytes.ReplaceAll(n.Tokens, zwsp, nil) keeps nil for nil
        n.Tokens = null === n.Tokens ? null : bytes.ReplaceAllOrNil(n.Tokens, zwspBytes, new Uint8Array(0));
        n.TextMarkTextContent = n.TextMarkTextContent.split(editor.Zwsp).join("");
      }
      return ast.WalkContinue;
    });
  }
  const ro = render.NewOptions();
  setByName(ro, rs.opts);
  return NewProtyleExportMdRenderer(tree, ro, po).Render();
}

function sha(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

// compares the port output with the recorded output; returns a description of the difference, or null
function diff(out: Uint8Array, o: string | undefined, h: string | undefined, n: number): string | null {
  if (undefined !== o) {
    const got = conv.StringFromBytes(out);
    return got === o ? null : "go " + JSON.stringify(o) + "\n    ts " + JSON.stringify(got);
  }
  if (out.length !== n || sha(out) !== h) {
    return "long output differs (go length " + n + ", ts length " + out.length + ")";
  }
  return null;
}

test("ProtyleExportMdRenderer matches Go on the corpus", () => {
  const failures: string[] = [];
  let compared = 0;
  let roundTrips = 0;
  let goIdempotent = 0;
  const bySet = new Map<string, number>();
  for (const c of cases) {
    const ps = corpus.parseSets[c.p];
    const rs = corpus.renderSets[c.r];
    const md = docBytes(corpus.docs[c.d]);
    const label = "doc " + c.d + " " + JSON.stringify(md.length < 120 ? conv.StringFromBytes(md) : conv.StringFromBytes(md).slice(0, 80) + "...") + " / " + ps.name + " / " + rs.name;
    let out: Uint8Array;
    try {
      out = renderOnce(md, ps, rs);
    } catch (e) {
      if (!c.th) {
        failures.push(label + ": port threw " + (e as Error).message);
      }
      continue;
    }
    if (c.th) {
      failures.push(label + ": Go panicked, port did not");
      continue;
    }
    compared++;
    bySet.set(rs.name, (bySet.get(rs.name) ?? 0) + 1);
    const d = diff(out, c.o, c.h, c.n);
    if (null !== d) {
      failures.push(label + "\n    " + d);
      continue;
    }
    if (undefined !== c.rt) {
      roundTrips++;
      if (c.rt.same) {
        goIdempotent++;
      }
      let out2: Uint8Array | null = null;
      try {
        out2 = renderOnce(out, ps, rs);
      } catch {
        out2 = null;
      }
      if (c.rt.th) {
        if (null !== out2) {
          failures.push(label + " (round trip): Go panicked, port did not");
        }
      } else if (null === out2) {
        failures.push(label + " (round trip): port threw");
      } else {
        const d2 = diff(out2, c.rt.o, c.rt.h, c.rt.n);
        if (null !== d2) {
          failures.push(label + " (round trip)\n    " + d2);
        } else if (c.rt.same !== (conv.StringFromBytes(out2) === conv.StringFromBytes(out))) {
          failures.push(label + " (round trip): idempotence differs from Go");
        }
      }
    }
  }
  console.log("compared " + compared + " renders, " + roundTrips + " round trips (Go idempotent on " + goIdempotent + "), per render set " + JSON.stringify([...bySet]));
  assert.equal(failures.length, 0, failures.length + " differences, first ones:\n" + failures.slice(0, 15).join("\n"));
});

// Hand-built trees: text marks in every combination of types (the Markdown parser reaches them only through BlockDOM2Tree) and the
// nodes that no Markdown input produces. The specs are built with buildNode of src/render/testhelpers.ts; HeadingSetext is not one of its props, so it is set here.
interface TreeCase {
  spec: NodeSpec;
  r: number;
  th?: boolean;
  o?: string;
  h?: string;
  n: number;
}

function buildTree(spec: NodeSpec): ast.Node {
  const props: Record<string, unknown> = { ...(spec.props ?? {}) };
  const setext = props.HeadingSetext === true;
  delete props.HeadingSetext;
  const n = buildNode({ type: spec.type, tokens: spec.tokens, props });
  for (const c of spec.children ?? []) {
    n.AppendChild(buildTree(c));
  }
  if (setext) {
    n.HeadingSetext = true;
  }
  return n;
}

const treeCases: TreeCase[] = [];
for (const f of readdirSync(dir).filter((n) => /^exportmd_trees_\d+\.json$/.test(n)).sort()) {
  treeCases.push(...(JSON.parse(readFileSync(new URL(f, dir), "utf8")) as TreeCase[]));
}

test("ProtyleExportMdRenderer matches Go on hand-built trees", () => {
  const failures: string[] = [];
  for (let i = 0; i < treeCases.length; i++) {
    const c = treeCases[i];
    const rs = corpus.renderSets[c.r];
    let out: Uint8Array;
    ast.SetTesting(true);
    try {
      const po = parse.NewOptions();
      setByName(po, corpus.parseSets[0].opts);
      const tree = new parse.Tree();
      tree.Root = buildTree(c.spec);
      tree.Context = new parse.Context(po);
      const ro = render.NewOptions();
      setByName(ro, rs.opts);
      out = NewProtyleExportMdRenderer(tree, ro, po).Render();
    } catch (e) {
      if (!c.th) {
        failures.push("tree " + i + " / " + rs.name + ": port threw " + (e as Error).message + "\n    " + JSON.stringify(c.spec));
      }
      continue;
    } finally {
      ast.SetTesting(false);
    }
    if (c.th) {
      failures.push("tree " + i + " / " + rs.name + ": Go panicked, port did not");
      continue;
    }
    const d = diff(out, c.o, c.h, c.n);
    if (null !== d) {
      failures.push("tree " + i + " / " + rs.name + "\n    " + d + "\n    " + JSON.stringify(c.spec));
    }
  }
  console.log("compared " + treeCases.length + " hand-built trees");
  assert.equal(failures.length, 0, failures.length + " differences, first ones:\n" + failures.slice(0, 10).join("\n"));
});

// Port of test/protyle_export_md_test.go (TestProtyleExportMd): it needs only parse.Parse, parse.NestedInlines2FlattedSpans and the renderer.
const protyleExportMdTests: [name: string, from: string, to: string][] = [
  ["19", "[foo & bar](https://baz.com)", "[foo & bar](https://baz.com)\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["18", "![foo](bar \"baz\")", "<img alt=\"foo\" src=\"bar\" title=\"baz\" />\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["17", "` ``foo`` `", "`` `foo` ``\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["16", "`` `foo` ``", "`` `foo` ``\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["15", "`foo`", "`foo`\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["14", "[foo](bar baz.txt)", "[foo](bar%20baz.txt)\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["13", "| `foo\\\\|bar` |\n| -- |", "|`foo\\\\|bar`|\n| -|\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["12", "| `foo\\&#124;bar` |\n| -- |", "|`foo\\|bar`|\n| -|\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["11", "| `foo\\|bar` |\n| -- |", "|`foo\\|bar`|\n| -|\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["10", "| $foo\\\\\\|bar$ |\n| -- |", "|$foo\\\\\\\\|bar$|\n| -|\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["9", "| $foo\\\\|bar$ |\n| -- |", "|$foo\\\\\\|bar$|\n| -|\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["8", "| $foo\\|bar$ |\n| -- |", "|$foo\\\\|bar$|\n| -|\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["7", "[~\\~foo\\~foo\\~~](bar)", "<sub>[\\~foo\\~foo\\~](bar)</sub>\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["6", "[^\\^foo\\^foo\\^^](bar)", "<sup>[\\^foo\\^foo\\^](bar)</sup>\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["5", "[==\\=foo\\=foo\\===](bar)", "==[\\=foo\\=foo\\=](bar)==\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["4", "[~~\\~foo\\~foo\\~~~](bar)", "~~[\\~foo\\~foo\\~](bar)~~\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["3", "[*\\*foo\\*foo\\**](bar)", "*[\\*foo\\*foo\\*](bar)*\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["2", "[**\\*foo\\*foo\\***](bar)", "**[\\*foo\\*foo\\*](bar)**\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["1", "[`foo`](bar \"baz\")", "[`foo`](bar \"baz\")\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
  ["0", "foo**bar**{: style=\"color: red;\"}baz", "foo**bar**{: style=\"color: red;\"}baz\n\n{: id=\"20060102150405-1a2b3c4\" updated=\"20060102150405\" type=\"doc\"}\n"],
];

test("TestProtyleExportMd (test/protyle_export_md_test.go)", () => {
  const luteEngine = New();
  luteEngine.SetProtyleWYSIWYG(true);
  luteEngine.ParseOptions.Mark = true;
  luteEngine.ParseOptions.BlockRef = true;
  luteEngine.SetKramdownIAL(true);
  luteEngine.SetSuperBlock(true);
  luteEngine.SetTag(true);
  luteEngine.SetSub(true);
  luteEngine.SetSup(true);
  luteEngine.SetGitConflict(true);
  luteEngine.SetIndentCodeBlock(false);
  luteEngine.SetEmojiSite("http://127.0.0.1:6806/stage/protyle/images/emoji");
  luteEngine.SetAutoSpace(true);
  luteEngine.SetParagraphBeginningSpace(true);
  luteEngine.SetFileAnnotationRef(true);
  luteEngine.SetInlineMathAllowDigitAfterOpenMarker(true);
  luteEngine.SetTextMark(true);
  luteEngine.SetImgPathAllowSpace(true);
  luteEngine.SetImgTag(true);

  ast.SetTesting(true);
  try {
    for (const [name, from, to] of protyleExportMdTests) {
      const tree = parse.Parse("", conv.BytesFromString(from), luteEngine.ParseOptions);
      parse.NestedInlines2FlattedSpans(tree, true);
      const renderer = NewProtyleExportMdRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions);
      const kmd = conv.StringFromBytes(renderer.Render());
      assert.equal(kmd, to, "test case [" + name + "] failed, original markdown text " + JSON.stringify(from));
    }
  } finally {
    ast.SetTesting(false);
  }
});

// Port of TestLegacyTableCellAlignmentSurvivesMarkdownExport (test/table_alignment_style_test.go:106), which also needs no BlockDOM2Tree.
test("legacy per-cell table alignment survives the Markdown export (test/table_alignment_style_test.go)", () => {
  const engine = New();
  engine.SetProtyleWYSIWYG(true);
  engine.SetKramdownIAL(true);
  const tree = parse.Parse("", conv.BytesFromString("| Header |\n| :---: |\n| value |\n"), engine.ParseOptions);
  const table = tree.Root!.FirstChild!;
  const cell = table.FirstChild!.Next!.FirstChild!;
  cell.TableCellAlign = 3;
  const markdown = conv.StringFromBytes(NewProtyleExportMdRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render());
  assert.ok(markdown.includes("text-align: right;"), "legacy per-cell alignment was lost: " + markdown);
  const roundTrip = parse.Parse("", conv.BytesFromString(markdown), engine.ParseOptions);
  assert.equal(roundTrip.Root!.FirstChild!.FirstChild!.Next!.FirstChild!.TableCellAlign, 3);
});

// Secondary evidence, through the oracle (the reference bundle). BlockDOM2StdMd is the only engine method that renders with ProtyleExportMdRenderer
// (protyle.go:257; BlockDOM2Md renders with FormatRenderer, and ProtyleExportMdNodeSync in lute.go walks single nodes with the renderer of
// NewProtyleExportMdRenderer(nil, nil, nil)). The Block DOM comes from the oracle's Md2BlockDOM and both engines run BlockDOM2StdMd on it.
const oracleSetters: SetterCall[] = [
  ["SetProtyleWYSIWYG", true], ["SetKramdownIAL", true], ["SetSuperBlock", true], ["SetTag", true], ["SetSub", true], ["SetSup", true], ["SetMark", true],
  ["SetBlockRef", true], ["SetFileAnnotationRef", true], ["SetGitConflict", true], ["SetTextMark", true], ["SetCallout", true], ["SetTabs", true],
  ["SetInlineMath", true], ["SetIndentCodeBlock", false], ["SetParagraphBeginningSpace", true], ["SetImgPathAllowSpace", true],
  ["SetInlineMathAllowDigitAfterOpenMarker", true],
];

test("BlockDOM2StdMd: port and oracle on the Block DOM of the oracle", () => {
  const { port, oracle } = newEngines(oracleSetters);
  const oracleThrew: string[] = [];
  const bothThrew: string[] = [];
  const failures: string[] = [];
  let compared = 0;
  const inlineDocs = corpus.docs.filter((d) => undefined === d.file).map((d) => d.md ?? "");
  for (const md of inlineDocs) {
    let dom: string;
    try {
      dom = oracle.Md2BlockDOM(md, false) as string;
    } catch {
      oracleThrew.push(md);
      continue;
    }
    const o = attempt(() => oracle.BlockDOM2StdMd(dom) as string);
    const p = attempt(() => port.BlockDOM2StdMd(dom));
    compared++;
    try {
      if ("bothThrew" === assertSameOutcome(JSON.stringify(md), p, o)) {
        bothThrew.push(md);
      }
    } catch (e) {
      failures.push((e as Error).message);
    }
  }
  console.log("oracle BlockDOM2StdMd: " + compared + " documents compared, both threw on " + bothThrew.length + ", the oracle threw in Md2BlockDOM on " + oracleThrew.length);
  // The oracle crashes in Md2BlockDOM on link reference definitions; nothing else may make it throw.
  for (const md of oracleThrew) {
    assert.ok(md.includes("]: "), "the oracle threw on a document without a link reference definition: " + JSON.stringify(md));
  }
  assert.deepEqual(failures.slice(0, 5), []);
  assert.ok(compared >= 250, "only " + compared + " documents compared");
});
