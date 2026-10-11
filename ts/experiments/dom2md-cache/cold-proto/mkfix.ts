import { writeFileSync } from "node:fs";
import { CONFIGS, engines, loadMarkdownCorpus, forward } from "../corpus.ts";
const mds = loadMarkdownCorpus().filter((d) => d.real);
const md = mds.find((d) => d.name === "benchmark/commonmark-spec.md")!.md;
for (const mode of ["wysiwyg", "ir"] as const) {
  const { oracle } = engines(CONFIGS[0], mode);
  const h = forward(oracle, mode, md);
  writeFileSync(process.env.OUT + "/spec." + mode + ".html", h);
  console.log(mode, h.length);
}
