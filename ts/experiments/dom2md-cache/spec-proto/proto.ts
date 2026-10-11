// Scratch prototype of the milestone B sandbox (spec validation only; not part of the repo).
// Usage (from ts/): node <this file> [--mode=wysiwyg|ir] [--barrier=1]
import { readFileSync, readdirSync } from "node:fs";

const ROOT = "C:/Users/SlawomirPiochacz/projects/lute/";
const SRC = "file:///" + ROOT + "ts/src/index.ts";
const SCAN = "file:///" + ROOT + "ts/experiments/dom2md-cache/scan.ts";
const S: any = await import(SRC);
const { New, ast, html, parse, render, util, editor } = S;
const { splitTopLevel } = (await import(SCAN)) as any;
const bytesMod: any = await import("file:///" + ROOT + "ts/src/runtime/bytes.ts");
const convMod: any = await import("file:///" + ROOT + "ts/src/runtime/conv.ts");
const atomMod: any = await import("file:///" + ROOT + "ts/src/html/atom/index.ts");
const slicesMod: any = await import("file:///" + ROOT + "ts/src/runtime/slices.ts");

const args = new Map<string, string>(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "1"]; }));
const MODE = (args.get("mode") ?? "wysiwyg") as "wysiwyg" | "ir";
const BARRIER = args.get("barrier") === "1";
const MAXDOCS = Number(args.get("docs") ?? "400");

const SETS: Array<[string, any[][]]> = [
  ["vditor", [["SetAutoSpace", false], ["SetCallout", false], ["SetToC", false], ["SetFootnotes", true], ["SetFixTermTypo", false], ["SetVditorCodeBlockPreview", true], ["SetVditorMathBlockPreview", true], ["SetMark", false], ["SetGFMAutoLink", true]]],
  ["protyle", [["SetProtyleWYSIWYG", true], ["SetKramdownBlockIAL", true], ["SetKramdownSpanIAL", true], ["SetKramdownIAL", true], ["SetSpin", true], ["SetVditorCodeBlockPreview", true]]],
];

function mdCorpus(): string[] {
  const out: string[] = [];
  for (const f of ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case1.md", "test/format-case2.md", "test/format-case3.md", "test/format-case4.md", "test/commonmark-spec.md", "test/gfm-spec.md", "ts/PORTING.md", "tasks/001-analysis.md", "tasks/004-incremental-and-fast-paths.md"]) {
    try { out.push(readFileSync(ROOT + f, "utf8").replace(/\r\n?/g, "\n")); } catch { /* skip */ }
  }
  const dir = ROOT + "ts/test/go/cases/";
  for (const f of readdirSync(dir).sort()) {
    const j = JSON.parse(readFileSync(dir + f, "utf8"));
    for (const rows of Object.values(j)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows as any[]) {
        if (Array.isArray(row) && typeof row[1] === "string" && row[1].length > 0 && row[1].length < 4000) out.push(row[1].replace(/\r\n?/g, "\n"));
      }
    }
  }
  return out;
}

const LF = 10;
type Ctx = { lastOut: number; prev: number; next: number; isFirst: boolean; isLast: boolean; domPrev: number; domNext: number; domNextAttrs: number };
type Variant = { reads: Map<string, any>; ops: any[]; endLastOut: number | "PASS" };
type Info = { alive: boolean; fail: string; atom: number; attrs: number; tipOpen: boolean; topTypes: number[] };
type Entry = { info: Info; variants: Variant[] };

function barrierStub(what: string): any {
  return new Proxy({}, { get(_t, p) { if (typeof p === "symbol") return undefined; throw new Error("BARRIER: " + what + "." + String(p)); }, set() { throw new Error("BARRIER write " + what); } });
}
function astStub(type: number, rec: () => void): any {
  const target = new ast.Node(type);
  return new Proxy(target, {
    get(t, p, rcv) {
      if (typeof p === "symbol") return undefined;
      if (p === "Type") { rec(); return type; }
      const fn = (ast.Node.prototype as any)[p];
      if (typeof fn === "function") return fn;
      throw new Error("BARRIER: ast neighbour." + String(p));
    },
    set() { throw new Error("BARRIER write ast neighbour"); },
  });
}
function domStub(atomV: number, rec: () => void, attrs = 0): any {
  const target = new html.Node();
  target.Type = html.ElementNode;
  return new Proxy(target, {
    get(t, p) {
      if (typeof p === "symbol") return undefined;
      if (p === "DataAtom") { rec(); return atomV; }
      if (p === "Type") return html.ElementNode;
      if (p === "Attr") return new Array(attrs).fill({ Key: "k", Val: "v", Namespace: "" });
      throw new Error("BARRIER: dom neighbour." + String(p));
    },
    set() { throw new Error("BARRIER write dom neighbour"); },
  });
}

const domReadLog = new Map<string, number>(); // "pass:field" -> count (barrier mode)

function adjustTreeWysiwyg(tree: any, mode: string): void {
  ast.Walk(tree.Root, (n: any, entering: boolean) => {
    if (entering) {
      switch (n.Type) {
        case ast.NodeInlineHTML: case ast.NodeCodeSpan: case ast.NodeInlineMath: case ast.NodeHTMLBlock: case ast.NodeCodeBlockCode: case ast.NodeMathBlockContent:
          n.Tokens = html.UnescapeHTML(n.Tokens ?? new Uint8Array(0));
          if (null !== n.Next && ast.NodeCodeSpan === n.Next.Type && n.CodeMarkerLen === n.Next.CodeMarkerLen) {
            if (mode === "wysiwyg") n.FirstChild.Next.Tokens = slicesMod.Append(n.FirstChild.Next.Tokens, n.Next.FirstChild.Next.Tokens);
            else n.FirstChild.Next.AppendTokens(n.Next.FirstChild.Next.Tokens ?? new Uint8Array(0));
            n.Next.Unlink();
          }
          break;
        case ast.NodeList:
          if (null !== n.Parent && ast.NodeList === n.Parent.Type) { const p = n.Previous; if (null !== p) p.AppendChild(n); }
          break;
      }
    }
    return ast.WalkContinue;
  });
}

// the passes of adjustVditorDOM in order: [method, scope, armed]
const PASSES: Array<[string, "root" | "child", boolean]> = [
  ["removeEmptyNodes", "root", false], ["removeHighlightJSSpans", "root", false], ["removeWbr", "child", false],
  ["mergeVditorDOMList0", "child", true], ["adjustVditorDOMListTight0", "child", true], ["adjustVditorDOMListList", "child", true],
  ["adjustVditorDOMListItemInP", "child", true], ["removeCodeCode", "child", true], ["adjustVditorDOMCodeA", "child", true],
  ["adjustTag", "child", true], ["mergeSameStrong", "child", true], ["adjustTableCode", "child", true], ["adjustMath", "child", true],
  ["adjustNoscriptImg", "child", true], ["adjustBlockInTable", "child", true],
];

function run0(lute: any, htmlStr: string, ctx: Ctx): { info: Info; variant: Variant | null } {
  const reads = new Map<string, any>();
  const rec = (k: string, v: any) => { reads.set(k, v); };
  const fail = (f: string): any => ({ info: { alive: false, fail: f, atom: 0, attrs: 0, tipOpen: false, topTypes: [] }, variant: null });
  const root = util.ParseHTML(htmlStr);
  if (root === null) return fail("parse-null");
  const child = root.FirstChild;
  if (child === null || child.NextSibling !== null || child.Type !== html.ElementNode) return fail("cert:shape");
  const atom0 = child.DataAtom;
  const attrs0 = child.Attr.length;

  // DOM accessors (armed flag)
  let armed = false;
  let domRec = "";
  const dprev = ctx.domPrev, dnext = ctx.domNext;
  const hist = (f: string) => { domReadLog.set(domRec + ":" + f, (domReadLog.get(domRec + ":" + f) ?? 0) + 1); };
  if (BARRIER) {
    let bp: any = null, bn: any = null;
    Object.defineProperty(child, "PrevSibling", { configurable: true, enumerable: true, get() { if (!armed) return bp; if (bp !== null) return bp; hist("PrevSibling"); rec("domPrev", dprev); return dprev < 0 ? null : domStub(dprev, () => {}); }, set(v) { bp = v; } });
    Object.defineProperty(child, "NextSibling", { configurable: true, enumerable: true, get() { if (!armed) return bn; if (bn !== null) return bn; hist("NextSibling"); if (domRec !== "mergeVditorDOMList0") rec("domNext", dnext); return dnext < 0 ? null : domStub(dnext, () => {}, ctx.domNextAttrs); }, set(v) { bn = v; } });
    let bf: any = child, bl: any = child;
    Object.defineProperty(root, "FirstChild", { configurable: true, enumerable: true, get() { if (!armed) return bf; hist("root.FirstChild"); rec("domPrev", dprev); return dprev < 0 ? bf : barrierStub("root.FirstChild(other)"); }, set(v) { bf = v; } });
    Object.defineProperty(root, "LastChild", { configurable: true, enumerable: true, get() { if (!armed) return bl; hist("root.LastChild"); rec("domNext", dnext); return dnext < 0 ? bl : barrierStub("root.LastChild(other)"); }, set(v) { bl = v; } });
    for (const [name, scope, arm] of PASSES) {
      const has = root.FirstChild !== null;
      domRec = name;
      armed = arm;
      if (scope === "root") lute[name](root); else if (has) lute[name](child);
      armed = false;
    }
  } else {
    lute.adjustVditorDOM(root);
  }
  // after adjust
  const rf = (root as any).FirstChild;
  if (rf === null) return { info: { alive: false, fail: "", atom: atom0, attrs: attrs0, tipOpen: false, topTypes: [] }, variant: { reads, ops: [], endLastOut: "PASS" } };
  if (rf !== child || child.NextSibling !== null && !BARRIER) return fail("shape-after-adjust");
  const tree = new parse.Tree();
  tree.Name = "";
  tree.Root = new ast.Node(ast.NodeDocument);
  tree.Context = new parse.Context(lute.ParseOptions);
  tree.Context.Tip = tree.Root;
  armed = BARRIER; domRec = "genAST";
  if (MODE === "wysiwyg") lute.genASTByVditorDOM(child, tree); else lute.genASTByVditorIRDOM(child, tree);
  armed = false;
  const tipOpen = tree.Context.Tip !== tree.Root;
  adjustTreeWysiwyg(tree, MODE);
  const tops: any[] = [];
  for (let c = tree.Root.FirstChild; c !== null; c = c.Next) tops.push(c);
  const info: Info = { alive: true, fail: "", atom: atom0, attrs: attrs0, tipOpen, topTypes: tops.map((t) => t.Type) };
  if (tipOpen) return { info, variant: null };

  const options = MODE === "wysiwyg" ? S.vditorDOM2MdRenderOptions() : S.vditorIRDOM2MdRenderOptions();
  const r: any = render.NewRecordingFormatRenderer(tree, options, lute.ParseOptions);
  let lo = ctx.lastOut, assigned = false;
  Object.defineProperty(r, "LastOut", { configurable: true, enumerable: true, get() { if (!assigned) rec("lastOut", ctx.lastOut); return lo; }, set(v) { assigned = true; lo = v; } });
  // Newline at the root is a logged NewlineIfNotLF and does not read LastOut
  const baseNewline = r.Newline;
  r.Newline = function () {
    if (r.sink !== null && r.isRootWriter()) { r.sink.push({ kind: "NewlineIfNotLF" }); r.LastOut = LF; return; }
    baseNewline.call(r);
  };
  if (tops.length > 0) {
    const first = tops[0], last = tops[tops.length - 1];
    let pv: any = null, nx: any = null;
    Object.defineProperty(first, "Previous", { configurable: true, enumerable: true, get() { rec("prev", ctx.prev); return ctx.prev < 0 ? null : astStub(ctx.prev, () => {}); }, set(v) { pv = v; } });
    Object.defineProperty(last, "Next", { configurable: true, enumerable: true, get() { rec("next", ctx.next); return ctx.next < 0 ? null : astStub(ctx.next, () => {}); }, set(v) { nx = v; } });
    let rfc: any = first, rlc: any = last;
    Object.defineProperty(tree.Root, "LastChild", { configurable: true, enumerable: true, get() { rec("isLast", ctx.isLast); return ctx.isLast ? last : barrierStub("root.LastChild(later nodes)"); }, set(v) { rlc = v; } });
    Object.defineProperty(tree.Root, "FirstChild", { configurable: true, enumerable: true, get() { rec("isFirst", ctx.isFirst); return ctx.isFirst ? first : barrierStub("root.FirstChild(earlier nodes)"); }, set(v) { rfc = v; } });
  }
  const ops: any[] = [];
  r.sink = ops;
  r.pieces = [];
  r.Writer = new bytesMod.Buffer();
  r.renderDocument(tree.Root, true);
  for (const t of tops) ast.Walk(t, (n: any, entering: boolean) => r.dispatch(n, entering));
  r.sink = null;
  return { info, variant: { reads, ops, endLastOut: assigned ? lo : "PASS" } };
}

function run(lute: any, htmlStr: string, ctx: Ctx): { info: Info; variant: Variant | null } {
  const was = ast.GetTesting(); ast.SetTesting(true);
  try { const r = run0(lute, htmlStr, ctx); if (r.variant) for (const op of r.variant.ops) if (op.bytes && convMod.StringFromBytes(op.bytes).includes("20060102150405-1a2b3c4")) { fb("GENERATED-ID"); if (!(globalThis as any).__g) { (globalThis as any).__g = 1; console.log("GENID in", JSON.stringify(htmlStr.slice(0, 200)), "->", JSON.stringify(r.variant!.ops.map((o: any) => o.bytes ? convMod.StringFromBytes(o.bytes) : o.kind).join("|").slice(0, 300))); } } return r; } finally { ast.SetTesting(was); }
}

function ctxMatch(v: Variant, ctx: Ctx): boolean {
  for (const [k, val] of v.reads) if ((ctx as any)[k] !== val) return false;
  return true;
}

const stats = { docs: 0, composed: 0, equal: 0, mism: 0, fallbacks: new Map<string, number>(), children: 0, hits: 0, runs: 0, reruns: 0, readCount: new Map<string, number>(), entryLoNotLF: 0, throws: 0, endLoPass: 0 };
function fb(r: string) { stats.fallbacks.set(r, (stats.fallbacks.get(r) ?? 0) + 1); }

const LISTS = new Set([html.constructor ? 0 : 0]);

function convert(lute: any, htmlIn: string): string | null {
  let h = htmlIn.split(editor.Zwsp).join("");
  h = h.split(editor.FrontEndCaret).join("");
  h = h.split("\t\n").join("\n").split("    \n").join("  \n");
  const sp = splitTopLevel(h);
  if (!sp.ok) { fb("scan:" + sp.reason); return null; }
  const kids: string[] = sp.children.map((c: any) => h.substring(c.start, c.end));
  const n = kids.length;
  if (n === 0) { fb("empty"); return null; }
  const cache: Map<string, Entry> = (lute.__cache ??= new Map());
  const entries: Entry[] = [];
  const NOCTX: Ctx = { lastOut: LF, prev: -1, next: -1, isFirst: true, isLast: true, domPrev: -1, domNext: -1, domNextAttrs: 0 };
  for (const k of kids) {
    let e = cache.get(k);
    if (e === undefined) {
      stats.runs++;
      let res;
      try { res = run(lute, k, NOCTX); } catch (err: any) { fb("sandbox-throw:" + String(err.message).slice(0, 40)); return null; }
      e = { info: res.info, variants: res.variant ? [res.variant] : [] };
      cache.set(k, e);
    }
    entries.push(e);
  }
  for (const e of entries) {
    if (e.info.fail) { fb("cert:" + e.info.fail); return null; }
    if (e.info.alive && e.info.tipOpen) { fb("tip-open"); return null; }
  }
  // coupling skeleton: adjacent alive lists
  const aliveIdx = entries.map((e, i) => (e.info.alive ? i : -1)).filter((i) => i >= 0);
  const A = { ul: html.atom ? 0 : 0 };
  for (let a = 0; a + 1 < aliveIdx.length; a++) {
    const x = entries[aliveIdx[a]].info, y = entries[aliveIdx[a + 1]].info;
    if (x.atom === y.atom && y.attrs === 1 && (x.atom === atomMod.Ul || x.atom === atomMod.Ol)) { fb("list-coupling"); return null; }
  }
  // contexts
  const emit = entries.map((e) => e.info.alive && e.info.topTypes.length > 0);
  let lastEmit = -1;
  for (let i = 0; i < n; i++) if (emit[i]) lastEmit = i;
  let firstEmit = -1;
  for (let i = n - 1; i >= 0; i--) if (emit[i]) firstEmit = i;
  // replay
  const R = new render.FormatRenderer(new parse.Tree(), vditorOpts(), lute.ParseOptions);
  R.LastOut = LF; R.Writer = new bytesMod.Buffer();
  stats.children += n;
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    if (!e.info.alive) continue;
    // neighbours
    let prevT = -1, nextT = -1;
    for (let j = i - 1; j >= 0; j--) if (emit[j]) { const t = entries[j].info.topTypes; prevT = t[t.length - 1]; break; }
    for (let j = i + 1; j < n; j++) if (emit[j]) { nextT = entries[j].info.topTypes[0]; break; }
    let dp = -1, dn = -1, dna = 0;
    for (let j = i - 1; j >= 0; j--) if (entries[j].info.alive) { dp = entries[j].info.atom; break; }
    for (let j = i + 1; j < n; j++) if (entries[j].info.alive) { dn = entries[j].info.atom; dna = entries[j].info.attrs; break; }
    const ctx: Ctx = { lastOut: R.LastOut, prev: prevT, next: nextT, isFirst: i === firstEmit, isLast: i === lastEmit, domPrev: dp, domNext: dn, domNextAttrs: dna };
    let v = e.variants.find((x) => ctxMatch(x, ctx));
    if (v === undefined) {
      stats.reruns++;
      let res;
      try { res = run(lute, kids[i], ctx); } catch (err: any) { fb("sandbox-throw2:" + String(err.message).slice(0, 60)); return null; }
      if (!res.variant) { fb("rerun-no-variant"); return null; }
      v = res.variant;
      e.variants.push(v);
    } else stats.hits++;
    if (v.reads.has("lastOut") && !(globalThis as any).__shown) { (globalThis as any).__shown = 1; console.log("LASTOUT READER", JSON.stringify(kids[i].slice(0, 300)), JSON.stringify([...v.reads]), JSON.stringify(v.ops.slice(0,6).map((o: any) => o.kind + (o.bytes ? ":" + JSON.stringify(convMod.StringFromBytes(o.bytes)) : "")))); }
    for (const k of v.reads.keys()) stats.readCount.set(k, (stats.readCount.get(k) ?? 0) + 1);
    if (v.reads.has("lastOut") && ctx.lastOut !== LF) stats.entryLoNotLF++;
    for (const op of v.ops) {
      if (op.kind === "Append") { if (op.setsLastOut) R.Write(op.bytes); else R.Writer.Write(op.bytes); }
      else if (op.kind === "NewlineIfNotLF") R.Newline();
      else if (op.kind === "TrimSpaceAll") R.trimWriterTo(bytesMod.TrimSpace(R.Writer.Bytes()));
    }
    if (v.endLastOut === "PASS") stats.endLoPass++;
    else if (R.LastOut !== v.endLastOut) { fb("END-LASTOUT-MISMATCH"); stats.mism++; }
  }
  S.render.closeDocumentWriter ? S.render.closeDocumentWriter(R) : (0 as any);
  return convMod.StringFromBytes(R.Writer.Bytes()).split(editor.Zwsp).join("");
}

function vditorOpts(): any { return MODE === "wysiwyg" ? S.vditorDOM2MdRenderOptions() : S.vditorIRDOM2MdRenderOptions(); }

for (const [name, setters] of SETS) {
  const lute = New();
  (lute as any)[MODE === "wysiwyg" ? "SetVditorWYSIWYG" : "SetVditorIR"](true);
  for (const [m, ...a] of setters) (lute as any)[m](...a);
  const docs = mdCorpus().slice(0, MAXDOCS);
  let seen = 0;
  for (const md of docs) {
    const dom = MODE === "wysiwyg" ? lute.Md2VditorDOM(md) : lute.Md2VditorIRDOM(md);
    let want: string;
    try { want = MODE === "wysiwyg" ? lute.VditorDOM2Md(dom) : lute.VditorIRDOM2Md(dom); } catch { continue; }
    stats.docs++;
    const got = convert(lute, dom);
    if (got === null) continue;
    stats.composed++;
    const norm = (s: string) => s.replace(/\d{14}-[a-z0-9]{7}/g, "ID");
    if (norm(got) === norm(want)) stats.equal++;
    else { stats.mism++; if (stats.mism < 4) console.log("MISMATCH", name, JSON.stringify(got.slice(0, 200)), "\nWANT", JSON.stringify(want.slice(0, 200))); }
    seen++;
  }
  console.log(name, "composed docs", seen);
}
console.log(JSON.stringify({ ...stats, fallbacks: [...stats.fallbacks], readCount: [...stats.readCount] }, null, 1));
if (BARRIER) console.log("DOM reads (pass:field)", [...domReadLog].sort());

// synthetic edge documents (wysiwyg)
if (MODE === "wysiwyg") {
  const lute = New(); lute.SetVditorWYSIWYG(true);
  const U3 = "\u3000", VT = "\u000b";
  const L = '<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>';
  const P = (t: string) => '<p data-block="0">' + t + "</p>";
  const BQ = '<blockquote data-block="0"><p data-block="0">q</p></blockquote>';
  const EMPTYUL = '<ul data-tight="true" data-marker="*" data-block="0"></ul>';
  const docs = [
    P(U3 + "a") + L, P(VT + "a") + BQ, P(U3) + L, P("a") + L, P("x<br>") + L, P("x<br>") + EMPTYUL + L, P("x<br>") + BQ, P("x<br>") + P("y"),
    L + L, L + EMPTYUL + L, P("") + L, P("") + BQ + P("z"), P("<em><br></em>") + BQ + "<h2 data-block=\"0\">..</h2>",
    '<div class="vditor-toc" data-type="toc-block" data-block="0"><p>[toc]</p></div>' + P("x"),
    '<div data-type="link-ref-defs-block" data-block="0">[a]: http://x\n</div>' + P("x"),
    '<div data-type="link-ref-defs-block" data-block="0">[a]: http://x\n</div>' + L + P("y"),
    '<div data-type="footnotes-block" data-block="0"><ol data-type="footnotes-defs-ol"><li data-marker="1"><p>f</p></li></ol></div>' + P("x"),
    L + '<ul data-marker="*"><li>y</li></ul>', L + EMPTYUL + '<ul data-marker="*"><li>y</li></ul>', P("a") + '<pre><code>c</code></pre>', '<hr data-block="0" />' + L, L,
    '<table data-block="0"><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>' + L,
  ];
  let ok = 0, bad = 0, fbk = 0;
  for (const d of docs) {
    let want: string; try { want = lute.VditorDOM2Md(d); } catch { want = "THROW"; }
    let got: string | null; try { got = convert(lute, d); } catch (e: any) { got = "THROW"; }
    if (got === null) { fbk++; continue; }
    if (got === want) ok++; else { bad++; console.log("EDGE MISMATCH", JSON.stringify(d.slice(0, 120)), "got", JSON.stringify(got), "want", JSON.stringify(want)); }
  }
  console.log("edge docs ok", ok, "bad", bad, "fallback", fbk, JSON.stringify([...stats.fallbacks]));
}
