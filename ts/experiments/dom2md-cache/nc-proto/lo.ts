import { readFileSync } from "node:fs";
import { New } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER, IR_ADAPTER, runChild } from "../../../src/incremental/sandbox.ts";
import * as ast from "../../../src/ast/index.ts";
const data = JSON.parse(readFileSync(process.argv[2], "utf8")) as { docs: { mode: string; kids: string[] }[] };
const lute = New();
const PREVS = [-1, ast.NodeText, ast.NodeParagraph, ast.NodeList, ast.NodeHeading, ast.NodeBlockquote, ast.NodeThematicBreak, ast.NodeCodeBlock, ast.NodeTable, ast.NodeHTMLBlock];
for (const mode of ["wysiwyg", "ir"]) {
  const seen = new Set<string>(); const readsBy = new Map<number, number>(); let runs = 0;
  for (const d of data.docs) if (d.mode === mode) for (const k of d.kids) {
    if (seen.has(k)) continue; seen.add(k);
    for (const pv of PREVS) for (const nx of [-1, 1]) {
      const r = runChild(lute, mode === "ir" ? IR_ADAPTER : WYSIWYG_ADAPTER, k, { lastOut: 120, prev: pv, next: nx, isFirst: pv < 0, isLast: nx < 0, domPrev: -1, domNext: -1, domNextAttrs: 0 }, { certify: true, opaque: false });
      runs++;
      if (r.variant && r.variant.readKeys.includes("lastOut")) readsBy.set(pv, (readsBy.get(pv) ?? 0) + 1);
    }
  }
  console.log(mode, "runs", runs, "lastOut read counts by prev type:", JSON.stringify([...readsBy]));
}
