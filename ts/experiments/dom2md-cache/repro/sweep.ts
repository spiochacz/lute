// Exhaustive small-document sweep: every ordered sequence of up to 3 children from a fixed alphabet,
// where the alphabet contains paragraphs with a Unicode whitespace character at the start, at the end, or alone.
// Compares CachedDom2Md.convert (cold cache per document) with the uncached engine call.
// usage: node repro/sweep.ts [--mode=wysiwyg|ir] [--config=defaults] [--len=3]
import { engines, CONFIGS } from "../corpus.ts";
import { CachedDom2Md } from "../cached.ts";
import type { Mode } from "../cached.ts";

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) args.set(m[1], m[2]); }
const mode = (args.get("mode") ?? "wysiwyg") as Mode;
const cfg = CONFIGS.find((c) => c.name === (args.get("config") ?? "defaults"))!;
const maxLen = Number(args.get("len") ?? 3);
const e = engines(cfg, mode);

const WS: Array<[string, string]> = [["U+3000", "　"], ["NBSP", " "], ["VT", "\u000b"], ["FF", "\u000c"], ["U+2028", " "], ["U+0085", "\u0085"], ["U+2003", " "], ["space", " "], ["tab", "\t"], ["CR", "\r"]];
const alphabet: Array<[string, string]> = [
  ["p", '<p data-block="0">a</p>'],
  ["h2", '<h2 data-block="0">h</h2>'],
  ["ul", '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>'],
  ["bq", '<blockquote data-block="0"><p data-block="0">q</p></blockquote>'],
  ["hr", '<hr data-block="0" />'],
  ["code", '<div class="vditor-wysiwyg__block" data-type="code-block" data-block="0" data-marker="`"><pre><code>c</code></pre></div>'],
  ["emptyp", '<p data-block="0"></p>'],
  ["table", `<table data-block="0"><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>`],
  ["html", `<div class="vditor-wysiwyg__block" data-type="html-block" data-block="0"><pre><code>&lt;b&gt;</code></pre></div>`],
  ["math", `<div class="vditor-wysiwyg__block" data-type="math-block" data-block="0"><pre><code>x</code></pre></div>`],
  ["ol", `<ol data-tight="true" data-marker="1." data-block="0"><li data-marker="1.">z</li></ol>`],
];
const SMALL = args.get("small") === "1";
for (const [wn, w] of WS.filter((x) => !SMALL || x[0] === "U+3000" || x[0] === "VT" || x[0] === "space")) {
  alphabet.push(["p<" + wn + ">a", `<p data-block="0">${w}a</p>`]);
  alphabet.push(["p a<" + wn + ">", `<p data-block="0">a${w}</p>`]);
  alphabet.push(["p<" + wn + ">only", `<p data-block="0">${w}</p>`]);
  alphabet.push(["ul-item<" + wn + ">x", `<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">${w}x</li></ul>`]);
  alphabet.push(["ul-item x<" + wn + ">", `<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x${w}</li></ul>`]);
  alphabet.push(["bq<" + wn + ">q", `<blockquote data-block="0"><p data-block="0">${w}q</p></blockquote>`]);
  alphabet.push(["h2<" + wn + ">h", `<h2 data-block="0">${w}h</h2>`]);
}
const UNI = new RegExp("^[" + [9, 10, 11, 12, 13, 32, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000].map((c) => "\\u" + c.toString(16).padStart(4, "0")).join("") + "\\u2000-\\u200a]+"); // Go unicode.IsSpace
let unexplained = 0;
const sigs = new Map<string, { n: number; ex: string; got: string; want: string }>();
let total = 0, bad = 0;
function rec(prefix: Array<[string, string]>): void {
  if (prefix.length > 0) {
    const html = prefix.map((x) => x[1]).join("");
    const c = new CachedDom2Md(e.port, mode);
    let got: string, want: string;
    try { got = c.convert(html); } catch (x) { got = "THROW " + String(x); }
    try { want = c.uncached(html); } catch (x) { want = "THROW " + String(x); }
    total++;
    if (got !== want) {
      bad++;
      if (got.replace(UNI, "") !== want.replace(UNI, "")) { unexplained++; if (unexplained <= 5) console.log("UNEXPLAINED", JSON.stringify(html), JSON.stringify(got), JSON.stringify(want)); }
      const sig = prefix.map((x) => x[0]).join(" , ");
      sigs.set(sig, { n: 1, ex: html, got, want });
    }
  }
  if (prefix.length < maxLen) for (const a of alphabet) rec([...prefix, a]);
}
rec([]);
console.log(`unexplained by leading-Unicode-whitespace strip: ${unexplained}`);
console.log(`mode=${mode} config=${cfg.name} documents=${total} mismatching=${bad}`);
const by = new Map<string, number>();
for (const [sig, v] of sigs) {
  // class: which first child
  const first = sig.split(" , ")[0];
  by.set(first, (by.get(first) ?? 0) + 1);
}
console.log("mismatching documents by first child:", [...by].map(([k, v]) => `${k}=${v}`).join("; "));
let shown = 0;
for (const [sig, v] of sigs) {
  if (shown++ >= (Number(args.get("show") ?? 6))) break;
  console.log(JSON.stringify(sig), "\n  cached", JSON.stringify(v.got), "\n  want  ", JSON.stringify(v.want));
}
