import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as conv from "../runtime/conv.ts";
import * as ast from "../ast/index.ts";
import * as parse from "../parse/index.ts";
import { NewOptions } from "./renderer.ts";
import { NewProtyleExportRenderer } from "./protyle_export_renderer.ts";
import { NewProtyleExportDocxRenderer } from "./protyle_export_docx_renderer.ts";
import { applyOptions } from "./testhelpers.ts";

// Markdown documents parsed under the Protyle parse options and rendered with NewProtyleExportRenderer and NewProtyleExportDocxRenderer
// under several render option sets, against the output of the same calls in Go (ts/tools/gen-render-export-vectors).
// A record holds the length and a hash of the output (the output itself when it is short). The renderers modify the tree, so every render parses afresh.

interface Doc {
  name: string;
  in?: string;
  repo?: string;
  mut?: string;
}
interface OptSet {
  name: string;
  parse: string;
  render: Record<string, unknown>;
}
interface Rec {
  doc: number;
  opt: number;
  r: string;
  throws?: boolean;
  len: number;
  hash?: string;
  out?: string;
}
interface Vectors {
  docs: Doc[];
  optionSets: OptSet[];
  records: Rec[];
}
const data: Vectors = JSON.parse(readFileSync(new URL("./testdata/protyle_export_vectors.json", import.meta.url), "utf8"));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function parseOptions(flavour: string): parse.Options {
  const po = parse.NewOptions();
  const set: Record<string, boolean> = {
    ProtyleWYSIWYG: true,
    KramdownBlockIAL: true,
    KramdownSpanIAL: true,
    BlockRef: true,
    FileAnnotationRef: true,
    Tag: true,
    SuperBlock: true,
    Mark: true,
    Sup: true,
    Sub: true,
    GitConflict: true,
    TextMark: true,
    Callout: true,
    Tabs: true,
  };
  if ("B" === flavour) {
    set.ArbitraryTaskListItemMarker = true;
    set.ParagraphBeginningSpace = true;
    set.ImgPathAllowSpace = true;
  }
  for (const [k, v] of Object.entries(set)) {
    if (!Reflect.has(po, k)) {
      throw new Error("unknown parse option " + k);
    }
    Reflect.set(po, k, v);
  }
  return po;
}

function firstByType(n: ast.Node, t: ast.NodeType): ast.Node | null {
  let ret: ast.Node | null = null;
  ast.Walk(n, (c: ast.Node, entering: boolean): ast.WalkStatus => {
    if (entering && c.Type === t) {
      ret = c;
      return ast.WalkStop;
    }
    return ast.WalkContinue;
  });
  return ret;
}

function mutate(tree: parse.Tree, mut: string | undefined): void {
  if ("colspan" === mut) {
    const cell = firstByType(tree.Root!, ast.NodeTableCell);
    if (null !== cell) {
      cell.SetIALAttr("colspan", "2");
    }
  } else if ("caption" === mut) {
    const table = firstByType(tree.Root!, ast.NodeTable);
    if (null !== table) {
      table.SetIALAttr("caption", "&lt;caption contenteditable=&quot;false&quot;&gt;cap&lt;/caption&gt;");
    }
  }
}

test("ProtyleExportRenderer and ProtyleExportDocxRenderer match Go on parsed Markdown documents", () => {
  ast.SetTesting(true);
  try {
    const failures: string[] = [];
    let count = 0;
    for (const rec of data.records) {
      const d = data.docs[rec.doc];
      const o = data.optionSets[rec.opt];
      const input = undefined !== d.repo ? readFileSync(repoRoot + d.repo, "utf8") : d.in!;
      const ro = NewOptions();
      applyOptions(ro, o.render);
      const po = parseOptions(o.parse);
      const what = d.name + " / " + o.name + " / " + rec.r;
      let out: Uint8Array | null = null;
      let threw: string | null = null;
      try {
        const tree = parse.Parse("", conv.BytesFromString(input), po);
        mutate(tree, d.mut);
        out = "export" === rec.r ? NewProtyleExportRenderer(tree, ro, po).Render() : NewProtyleExportDocxRenderer(tree, ro, po).Render();
      } catch (e) {
        threw = (e as Error).message;
      }
      count++;
      if (true === rec.throws) {
        if (null === threw) {
          failures.push(what + ": Go threw, the port did not");
        }
        continue;
      }
      if (null !== threw) {
        failures.push(what + ": the port threw " + threw);
        continue;
      }
      const hash = createHash("sha256").update(out!).digest("hex").slice(0, 16);
      if (out!.length !== rec.len || hash !== rec.hash) {
        failures.push(what + "\n  go: len " + rec.len + (undefined !== rec.out ? " " + JSON.stringify(rec.out) : "") + "\n  ts: len " + out!.length + " " + JSON.stringify(conv.StringFromBytes(out!).slice(0, 600)));
      }
    }
    assert.ok(count >= 2500, "records: " + count);
    assert.deepEqual(failures.slice(0, 15), [], failures.length + " of " + count + " records differ");
  } finally {
    ast.SetTesting(false);
  }
});
