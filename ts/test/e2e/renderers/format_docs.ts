import assert from "node:assert/strict";
import { newEngines } from "../helpers.ts";
import { buildCorpus } from "./format_corpus.ts";
import { compare } from "./format_helpers.ts";
import { FORMAT_SETS } from "./format_sets.ts";
import { sample } from "../full.ts";

// Option sets whose every document is compared in the quick run; the other sets run a sample (see ../full.ts).
const BASE_SET_NAMES = ["default", "Protyle format", "everything on"];

// Short documents under the given option sets (by index range of FORMAT_SETS): port equals oracle, and the formatted output is idempotent on both sides.
export function runDocs(from: number, to: number): void {
  const corpus = buildCorpus();
  assert.ok(corpus.length >= 300, String(corpus.length));
  const failures: string[] = [];
  for (const [setIndex, set] of FORMAT_SETS.slice(from, to).entries()) {
    const engines = newEngines(set.setters);
    const docs = BASE_SET_NAMES.includes(set.name) ? corpus.map((doc, i): [number, string] => [i, doc]) : sample(corpus.map((doc, i): [number, string] => [i, doc]), from + setIndex, 12);
    for (const [i, doc] of docs) {
      const label = `doc ${i} [${set.name}]`;
      const first = compare(engines, label, "", doc, failures);
      if (first.oracle.threw) {
        continue;
      }
      // Idempotence against the oracle: formatting the oracle's formatted output again gives the same result on both sides.
      // The generated IDs are random, so the first output is normalised (by attempt()) before it is formatted again; the input is the same on both sides.
      compare(engines, label + " again", "", first.oracle.value, failures);
    }
  }
  assert.deepEqual(failures.slice(0, 20), []);
  assert.deepEqual(failures, []);
}
