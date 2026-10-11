import { CONFIGS, engines, loadMarkdownCorpus, forward } from "../corpus.ts";
import { editor } from "../../../src/index.ts";
import { WYSIWYG_ADAPTER } from "../../../src/incremental/sandbox.ts";
import { vditorDOM2MdPreprocess } from "../../../src/vditor_wysiwyg.ts";
import { scanTopLevel } from "../../../src/incremental/scanner.ts";
import { Cache, compose } from "./fast.ts";
const { port, oracle } = engines(CONFIGS[0], "wysiwyg");
const mds = loadMarkdownCorpus().filter((d) => d.real);
const prose = mds.filter((d) => (d.name.startsWith("tasks/") && !d.name.includes("002")) || d.name === "ts/PORTING.md").map((d) => d.md).join("\n\n");
const h = vditorDOM2MdPreprocess(forward(oracle, "wysiwyg", prose).split(editor.Zwsp).join(""));
const sc = scanTopLevel(h); if (!sc.ok) throw new Error();
const c = new Cache();
for (const ch of sc.children) {
  const s = h.substring(ch.start, ch.end);
  const x = new Cache();
  const hh = s;
  const out = compose(port, WYSIWYG_ADAPTER, x, hh);
  if (out === null && x.stats.reason === "generated-id") { console.log(s.slice(0, 400)); console.log("---- normal output of this child alone:", JSON.stringify(port.vditorDOM2Md(s).slice(0, 300))); break; }
}
void c;
