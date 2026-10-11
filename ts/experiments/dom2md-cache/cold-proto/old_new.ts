// Milestone C timing (tasks/004 C2 stop condition, section 7): one process, interleaved, fastest of N. For the CommonMark spec document of
// FIX (mkfix.ts), WYSIWYG and IR: the normal path, the cold call and the warm one-edit call of the engine of this tree (tryDom2Md of
// src/incremental), and the same of the engine before milestone C (a copy in cold-proto/old-incremental, made from HEAD before C1).
// Scratch code, not part of the product. Usage: FIX=<dir> node experiments/dom2md-cache/cold-proto/old_new.ts [reps]

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { tryDom2Md } from "../../../src/incremental/assemble.ts";
import { State } from "../../../src/incremental/cache.ts";
import { WYSIWYG_ADAPTER as OLD_WYSIWYG, IR_ADAPTER as OLD_IR } from "./old-incremental/sandbox.ts";
import { tryDom2Md as oldTryDom2Md } from "./old-incremental/assemble.ts";
import { State as OldState } from "./old-incremental/cache.ts";

const FIX = process.env.FIX!;
const reps = Number(process.argv[2] ?? 14);

for (const mode of ["wysiwyg", "ir"] as const) {
  const raw = readFileSync(`${FIX}/spec.${mode}.html`, "utf8").split(editor.Zwsp).join("");
  const { port } = engines(CONFIGS[0], mode);
  const ad = mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
  const oad = mode === "wysiwyg" ? OLD_WYSIWYG : OLD_IR;
  const normal = (doc: string): string => (mode === "wysiwyg" ? port.VditorDOM2Md(doc) : port.VditorIRDOM2Md(doc));
  // the public call is the cache plus, on a fallback, the normal path (as the wrapper of vditor_wysiwyg.ts does)
  // one edit that the cache has never seen: a new character inserted into the first paragraph end of the document, numbered by k
  const edit = (k: number): string => raw.replace(/([A-Za-z])<\/p>/, `$1 q${k}</p>`);

  const warmNew = new State({});
  const warmOld = new OldState({});
  // the cache is warmed by one call on the unedited document (the warm state of the one-edit measurement)
  const w0 = tryDom2Md(warmNew, port, ad, raw);
  const o0 = oldTryDom2Md(warmOld, port, oad, raw);
  const best: Record<string, number> = {};
  const m = (key: string, f: () => unknown): void => {
    const t = performance.now();
    f();
    best[key] = Math.min(best[key] ?? Infinity, performance.now() - t);
  };
  for (let i = 1; i <= reps; i++) {
    m("normal (unedited)", () => normal(raw));
    m("new cold", () => tryDom2Md(new State({}), port, ad, raw) ?? normal(raw)); // the public call: a fallback runs the normal path
    m("old cold", () => oldTryDom2Md(new OldState({}), port, oad, raw) ?? normal(raw));
    const doc = edit(i);
    m("normal (edited)", () => normal(doc));
    m("new warm one-edit", () => tryDom2Md(warmNew, port, ad, doc) ?? normal(doc));
    m("old warm one-edit", () => oldTryDom2Md(warmOld, port, oad, doc) ?? normal(doc));
  }
  const base = best["normal (unedited)"];
  console.log(`== ${mode} (warm-up composed: new ${w0 !== null}, old ${o0 !== null}; reps ${reps})`);
  for (const [k, v] of Object.entries(best)) {
    console.log(`  ${k.padEnd(20)} ${v.toFixed(1).padStart(7)} ms   x normal(unedited) ${(v / base).toFixed(2)}`);
  }
  console.log(`  ratio new cold / normal ${(best["new cold"] / base).toFixed(2)}, old cold / normal ${(best["old cold"] / base).toFixed(2)}`);
  console.log(`  ratio new warm / normal edited ${(best["new warm one-edit"] / best["normal (edited)"]).toFixed(2)}, old warm / normal edited ${(best["old warm one-edit"] / best["normal (edited)"]).toFixed(2)}`);
  console.log(`  ratio new warm / old warm ${(best["new warm one-edit"] / best["old warm one-edit"]).toFixed(2)}`);
}
