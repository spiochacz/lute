// usage (from ts/): node experiments/dom2md-cache/repro/root-writer-prefix.ts --mode=wysiwyg|ir
// Evidence tool for the state-vector enumeration: which top-level node types rewrite bytes the root writer already holds.
// Validates, from outside ts/src, the claim "the root writer is append-only except for the TrimSpace of list/blockquote exits":
// for every top-level AST node, the root writer's bytes before the node must be a prefix of the bytes after it, unless the node type is a known trimmer.
// Also checks LastOut at the entry of a top-level node against the last byte of the root writer.
import { ast, html as htmlpkg, parse, render, util, editor } from "../../../src/index.ts";
import { engines, CONFIGS, buildDomDocs, loadMarkdownCorpus } from "../corpus.ts";

const mode = (process.argv.find((a) => a.startsWith("--mode="))?.slice(7) ?? "wysiwyg") as "wysiwyg" | "ir";
const mds = loadMarkdownCorpus();
const viol = new Map<string, number>();
const seen = new Map<string, number>();
const lastOutStale = new Map<string, number>();
let docsRun = 0;
let examples = 0;

function renderChecked(lute: any, htmlStr: string): void {
  htmlStr = htmlStr.split(editor.Zwsp).join("").split("<wbr>").join("");
  htmlStr = htmlStr.split("\t\n").join("\n").split("    \n").join("  \n");
  const root = util.ParseHTML(htmlStr);
  if (root === null) return;
  lute.adjustVditorDOM(root);
  const tree = new parse.Tree();
  tree.Name = "";
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.Context = new parse.Context(lute.ParseOptions);
  tree.Context.Tip = tree.Root;
  for (let c = root.FirstChild; c !== null; c = c.NextSibling) {
    if (mode === "wysiwyg") lute.genASTByVditorDOM(c, tree);
    else lute.genASTByVditorIRDOM(c, tree);
  }
  ast.Walk(tree.Root, (n: any, entering: boolean) => {
    if (entering) {
      switch (n.Type) {
        case ast.NodeInlineHTML: case ast.NodeCodeSpan: case ast.NodeInlineMath: case ast.NodeHTMLBlock: case ast.NodeCodeBlockCode: case ast.NodeMathBlockContent:
          n.Tokens = htmlpkg.UnescapeHTML(n.Tokens ?? new Uint8Array(0));
          if (n.Next !== null && ast.NodeCodeSpan === n.Next.Type && n.CodeMarkerLen === n.Next.CodeMarkerLen) {
            n.FirstChild.Next.Tokens = new Uint8Array([...n.FirstChild.Next.Tokens, ...n.Next.FirstChild.Next.Tokens]);
            n.Next.Unlink();
          }
          break;
        case ast.NodeList:
          if (n.Parent !== null && ast.NodeList === n.Parent.Type && n.Previous !== null) n.Previous.AppendChild(n);
          break;
      }
    }
    return ast.WalkContinue;
  });
  const options = render.NewOptions();
  options.AutoSpace = false;
  options.FixTermTypo = false;
  const r: any = render.NewFormatRenderer(tree, options, lute.ParseOptions);
  const rootStr = (): string => Buffer.from(r.NodeWriterStack[0].Bytes()).toString("latin1");
  const snap = new Map<any, { s: string; lastOut: number }>();
  for (const [type, fn] of [...r.RendererFuncs.entries()]) {
    r.RendererFuncs.set(type, (n: any, entering: boolean) => {
      const top = n.Parent !== null && n.Parent.Type === ast.NodeDocument;
      if (top && entering) {
        const s = rootStr();
        snap.set(n, { s, lastOut: r.LastOut });
        const key = ast.NodeTypeString(n.Type);
        const expect = s.length === 0 ? 10 : s.charCodeAt(s.length - 1);
        if (r.LastOut !== expect) lastOutStale.set(key, (lastOutStale.get(key) ?? 0) + 1);
      }
      const st = fn(n, entering);
      if (top && !entering) {
        const before = snap.get(n)!;
        const after = rootStr();
        const key = ast.NodeTypeString(n.Type);
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (!after.startsWith(before.s)) { viol.set(key, (viol.get(key) ?? 0) + 1); if (examples++ < 3) console.log("EXAMPLE", JSON.stringify(htmlStr.slice(0, 600)), " before-tail", JSON.stringify(before.s.slice(-40)), "after-head", JSON.stringify(after.slice(Math.max(0, before.s.length - 40), before.s.length + 20))); }
      }
      return st;
    });
  }
  r.Render();
  docsRun++;
}

for (const cfg of CONFIGS) {
  const { port } = engines(cfg, mode);
  const docs = buildDomDocs(cfg, mode, mds);
  for (const d of docs) {
    try { renderChecked(port, d.html); } catch { /* engine throws on some hand-written inputs */ }
  }
}
console.log(`mode=${mode} documents rendered=${docsRun}`);
console.log("top-level node types seen:", [...seen].map(([k, v]) => `${k}=${v}`).join(" "));
console.log("node types that broke the prefix property (root writer not append-only):", [...viol].map(([k, v]) => `${k}=${v}`).join(" ") || "none");
console.log("LastOut at entry of a top-level node differs from the last root-writer byte (empty writer counted as LF):", [...lastOutStale].map(([k, v]) => `${k}=${v}`).join(" ") || "never");
{
  // sensitivity: documents whose leading output is Unicode whitespace followed by each kind of top-level block
  const kinds: Record<string, string> = {
    ul: '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>',
    ol: '<ol data-tight="true" data-marker="1." data-block="0"><li data-marker="1.">z</li></ol>',
    bq: '<blockquote data-block="0"><p data-block="0">q</p></blockquote>',
    h2: '<h2 data-block="0">h</h2>',
    hr: '<hr data-block="0" />',
    p: '<p data-block="0">b</p>',
    table: '<table data-block="0"><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>',
    code: '<div class="vditor-wysiwyg__block" data-type="code-block" data-block="0" data-marker="`"><pre><code>c</code></pre></div>',
    html: '<div class="vditor-wysiwyg__block" data-type="html-block" data-block="0"><pre><code>&lt;b&gt;</code></pre></div>',
    math: '<div class="vditor-wysiwyg__block" data-type="math-block" data-block="0"><pre><code>x</code></pre></div>',
  };
  viol.clear(); seen.clear(); examples = 99;
  const { port } = engines(CONFIGS[3], mode);
  for (const [k, h] of Object.entries(kinds)) {
    renderChecked(port, '<p data-block="0">　a</p>' + h);
    renderChecked(port, '<p data-block="0">　a</p>' + h + h);
  }
  console.log("SENSITIVITY (leading U+3000 paragraph followed by one block kind): node types that rewrote earlier root-writer bytes:", [...viol].map(([k, v]) => `${k}=${v}`).join(" ") || "none");
}
