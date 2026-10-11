import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as conv from "../runtime/conv.ts";
import * as ast from "../ast/index.ts";
import * as parse from "./index.ts";
import { dumpNode, hexBytes, options } from "./testhelpers.ts";
import type { OptionSet } from "./testhelpers.ts";

// Whole parsed trees against the real Go parse package. Vectors come from ts/tools/gen-parse-tree-vectors: about 1,300 Markdown inputs
// (block-level and inline-level, including inputs on which Go leaves a byte slice nil) under six option sets (default, all extensions on,
// Protyle, Vditor IR, Vditor WYSIWYG, Vditor SV). Every node is dumped with its type, its Tokens and whether Tokens is nil, the other nullable
// fields (CodeBlockCloseFence, KramdownIAL) and the rest of its fields. A tree whose dump is longer than the generator's limit is stored as SHA-256 and length.
//
// The dump format is the one of dumpNode in the generator: one line per node, depth first, "key=value" pairs, zero values left out, byte slices as lowercase hex in
// single quotes, N for nil. Tokens, CodeBlockCloseFence and KramdownIAL keep nil and empty apart; other byte slices (not nullable in the port) do not.

type TreeEntry = [input: number, optionSet: number, kind: "P" | "D" | "H", data: string];

interface TreeVectors {
  goVersion: string;
  optionSets: OptionSet[];
  inputs: string[];
  invalid: boolean[];
  trees: TreeEntry[];
}

const vectors: TreeVectors = JSON.parse(readFileSync(new URL("./testdata/tree_vectors.json", import.meta.url), "utf8"));

// parseDump returns the dump of the port's tree, or null when the parser throws.
function parseDump(input: Uint8Array, set: OptionSet): string | null {
  try {
    const tree = parse.Parse("", input, options(set));
    const lines: string[] = [];
    dumpNode(tree.Root!, 0, lines);
    return lines.join("\n");
  } catch {
    return null;
  }
}

// Go's lossy step for an invalid UTF-8 input (see PORTING.md): where the port goes through a string, each invalid byte becomes U+FFFD.
function lossyDump(goDump: string): string {
  return goDump.replace(/'([0-9a-f]*)'/g, (_m, hex: string) => "'" + hexBytes(conv.BytesFromString(conv.StringFromBytes(Buffer.from(hex, "hex")))) + "'");
}

function compare(group: (invalid: boolean) => boolean, lossy: boolean): { count: number; nilTokens: number; differing: string[] } {
  ast.SetTesting(true);
  try {
    let count = 0;
    let nilTokens = 0;
    const differing: string[] = [];
    for (const [input, setIndex, kind, data] of vectors.trees) {
      if (!group(vectors.invalid[input])) {
        continue;
      }
      count++;
      const set = vectors.optionSets[setIndex];
      const bytes = new Uint8Array(Buffer.from(vectors.inputs[input], "hex"));
      const label = `[${set.name}] ${JSON.stringify(conv.StringFromBytes(bytes))}`;
      const got = parseDump(bytes, set);
      if (kind === "P") {
        if (got !== null) {
          differing.push(`${label}: Go panics, the port returns a tree`);
        }
        continue;
      }
      if (got === null) {
        differing.push(`${label}: the port throws, Go returns a tree`);
        continue;
      }
      nilTokens += got.split("\n").filter((l) => l.includes(" tok=N")).length;
      if (kind === "D") {
        const want = lossy && got === lossyDump(data) ? got : data; // invalid UTF-8: the port may keep the bytes (equal to Go) or lose them in a string (equal to lossy Go)
        if (got !== want) {
          const gl = got.split("\n");
          const wl = want.split("\n");
          let i = 0;
          while (i < gl.length && i < wl.length && gl[i] === wl[i]) {
            i++;
          }
          differing.push(`${label}\n    port: ${gl[i] ?? "<end>"}\n    go:   ${wl[i] ?? "<end>"}`);
        }
      } else {
        const sep = data.indexOf(":");
        const sha = data.slice(0, sep);
        const length = Number(data.slice(sep + 1));
        if (createHash("sha256").update(got).digest("hex") !== sha || got.length !== length) {
          differing.push(`${label}: hash of the dump differs (Go dump length ${length}, port ${got.length})`);
        }
      }
    }
    return { count, nilTokens, differing };
  } finally {
    ast.SetTesting(false);
  }
}

test("tree vectors: valid UTF-8 inputs, trees equal Go's including nil-ness", () => {
  const { count, nilTokens, differing } = compare((invalid) => !invalid, false);
  assert.ok(count > 7000, String(count));
  // Sanity: the corpus really contains nodes whose Tokens is nil.
  assert.ok(nilTokens > 1000, String(nilTokens));
  assert.deepEqual(differing, []);
});

test("tree vectors: invalid UTF-8 inputs, equal to Go's output or to its lossy string round trip", () => {
  // Where invalid bytes pass through strings (entity decoding, IAL parsing, ...) JavaScript turns them into U+FFFD, so the expected dump is Go's after the same step.
  // The parser works on bytes for these inputs, so in practice the trees are equal to Go's.
  const { count, differing } = compare((invalid) => invalid, true);
  assert.ok(count > 0, String(count));
  assert.deepEqual(differing, []);
});
