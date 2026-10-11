import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONFIGS, engines } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { State } from "../../../src/incremental/cache.ts";
import { tryDom2Md } from "./assemble_timed.ts";
import { T, SW, WYSIWYG_ADAPTER, IR_ADAPTER } from "./sandbox_timed.ts";
const FIX = process.env.FIX!;
const mode = (process.argv[2] ?? "wysiwyg") as "wysiwyg" | "ir";
const h = readFileSync(`${FIX}/spec.${mode}.html`, "utf8").split(editor.Zwsp).join("");
const { port } = engines(CONFIGS[0], mode);
const ad = mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER;
const variants: Array<[string, Partial<typeof SW>]> = [
  ["baseline", {}], ["noDomGuard", { noDomGuard: true }], ["noAstGuard+noLastOut", { noAstGuard: true, noLastOut: true }],
  ["noGuards at all", { noDomGuard: true, noAstGuard: true, noLastOut: true }], ["sharedOpts", { sharedOpts: true }],
];
const best = new Map<string, number>(); const bT = new Map<string, any>();
for (let rep = 0; rep < 12; rep++) for (const [name, sw] of variants) {
  Object.assign(SW, { noDomGuard: false, noAstGuard: false, noLastOut: false, sharedOpts: false }, sw);
  for (const k of Object.keys(T)) delete T[k];
  const st = new State({}); const t = performance.now(); tryDom2Md(st, port, ad, h); const d = performance.now() - t;
  if (d < (best.get(name) ?? Infinity)) { best.set(name, d); bT.set(name, { ...T }); }
}
for (const [name] of variants) { const t = bT.get(name); console.log(name.padEnd(24), best.get(name)!.toFixed(1), "ms | passes4-15", t["passes4-15"].toFixed(1), "genAST", t["genAST"].toFixed(1), "render-setup", t["render-setup"].toFixed(1), "render", t["render"].toFixed(1), "guards", t["guards"].toFixed(1)); }
