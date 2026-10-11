// Scratch: parser boundary-state certificate prototype and an in-context equality check over the corpus.
import { readFileSync, readdirSync } from "node:fs";
const ROOT = "C:/Users/SlawomirPiochacz/projects/lute/";
const S: any = await import("file:///" + ROOT + "ts/src/index.ts");
const { New, html, util, editor } = S;
const { splitTopLevel } = (await import("file:///" + ROOT + "ts/experiments/dom2md-cache/scan.ts")) as any;
const bytesMod: any = await import("file:///" + ROOT + "ts/src/runtime/bytes.ts");
const convMod: any = await import("file:///" + ROOT + "ts/src/runtime/conv.ts");
const MODE = (process.argv.find((a) => a.startsWith("--mode="))?.slice(7) ?? "wysiwyg") as "wysiwyg" | "ir";

interface Boundary { im: unknown; oe: string[]; afe: number; head: boolean; form: boolean; tmpl: number; origIM: unknown; foster: boolean; quirks: boolean; fragment: boolean; scripting: boolean; selfClosing: boolean; ctx: boolean; rawTag: string; err: string; lastTokEnd: number; bufLen: number; framesetOK: boolean }

function parseWithBoundary(htmlStr: string): { doc: any; b: Boundary | null } {
  const buf = convMod.BytesFromString(htmlStr);
  let b: Boundary | null = null;
  let lastEnd = -1;
  const opt = (p: any) => {
    const orig = p.parseCurrentToken;
    p.parseCurrentToken = function (this: any) {
      if (b === null) {
        if (this.tok.Type === html.ErrorToken) {
          const z = this.tokenizer;
          b = { im: this.im, oe: this.oe.items.map((n: any) => n.Namespace + "|" + n.DataAtom + "|" + n.Data), afe: this.afe.items.length, head: this.head !== null, form: this.form !== null, tmpl: this.templateStack.items.length, origIM: this.originalIM, foster: this.fosterParenting, quirks: this.quirks, fragment: this.fragment, scripting: this.scripting, selfClosing: this.hasSelfClosingToken, ctx: this.context !== null, rawTag: z.rawTag, err: String(z.err), lastTokEnd: lastEnd, bufLen: buf.length, framesetOK: this.framesetOK };
        } else {
          lastEnd = this.tokenizer.raw.end;
        }
      }
      return orig.call(this);
    };
  };
  const [doc, err] = html.ParseWithOptions(buf, opt);
  if (err !== null) throw err;
  return { doc, b };
}

const REF = parseWithBoundary("<hr>").b!;
function sameBoundary(x: Boundary, ref: Boundary): string {
  const keys: (keyof Boundary)[] = ["im", "afe", "head", "form", "tmpl", "origIM", "foster", "quirks", "fragment", "scripting", "selfClosing", "ctx", "rawTag", "err"];
  for (const k of keys) if (x[k] !== ref[k]) return String(k);
  if (x.oe.join(",") !== ref.oe.join(",")) return "oe";
  if (x.lastTokEnd !== x.bufLen) return "lastTokEnd";
  return "";
}
console.log("REF", JSON.stringify({ ...REF, im: String((REF.im as any).name), origIM: String(REF.origIM) }));

function bodyOf(doc: any): any {
  return "html" !== doc.FirstChild.Data ? doc : doc.FirstChild.LastChild;
}
function ser(n: any): string { const b = new bytesMod.Buffer(); html.Render(b, n); return b.String(); }

function mdCorpus(): string[] {
  const out: string[] = [];
  for (const f of ["test/case1.md", "README.md", "test/format-case0.md", "test/format-case1.md", "test/format-case2.md", "test/commonmark-spec.md", "test/gfm-spec.md", "ts/PORTING.md", "tasks/004-incremental-and-fast-paths.md"]) {
    try { out.push(readFileSync(ROOT + f, "utf8").replace(/\r\n?/g, "\n")); } catch { /* skip */ }
  }
  const dir = ROOT + "ts/test/go/cases/";
  for (const f of readdirSync(dir).sort()) {
    const j = JSON.parse(readFileSync(dir + f, "utf8"));
    for (const rows of Object.values(j)) if (Array.isArray(rows)) for (const row of rows as any[]) if (Array.isArray(row) && typeof row[1] === "string" && row[1].length > 0 && row[1].length < 4000) out.push(row[1].replace(/\r\n?/g, "\n"));
  }
  return out;
}

const lute = New();
(lute as any)[MODE === "wysiwyg" ? "SetVditorWYSIWYG" : "SetVditorIR"](true);
lute.SetFootnotes(true); lute.SetVditorCodeBlockPreview(true); lute.SetVditorMathBlockPreview(true);
let children = 0, certFail = new Map<string, number>(), ctxDiff = 0, docsN = 0, checked = 0;
for (const md of mdCorpus()) {
  let dom: string;
  try { dom = MODE === "wysiwyg" ? lute.Md2VditorDOM(md) : lute.Md2VditorIRDOM(md); } catch { continue; }
  dom = dom.split(editor.Zwsp).join("").split("<wbr>").join("");
  const sp = splitTopLevel(dom);
  if (!sp.ok) continue;
  docsN++;
  const whole = util.ParseHTML(dom);
  if (whole === null) continue;
  const wk: any[] = []; for (let c = whole.FirstChild; c; c = c.NextSibling) wk.push(c);
  const kids = sp.children.map((c: any) => dom.substring(c.start, c.end));
  if (wk.length !== kids.length) { certFail.set("child-count", (certFail.get("child-count") ?? 0) + 1); continue; }
  for (let i = 0; i < kids.length; i++) {
    children++;
    const { doc, b } = parseWithBoundary(kids[i]);
    const body = bodyOf(doc);
    let why = "";
    if (b === null) why = "no-boundary";
    else why = sameBoundary(b, REF);
    if (!why) {
      if (body.FirstChild === null || body.FirstChild.NextSibling !== null) why = "shape";
    }
    if (why && (why==="form"||why==="im"||why==="afe"||why==="oe")) console.log("FAIL", why, JSON.stringify(kids[i].slice(0,160)));
    if (why) { certFail.set(why, (certFail.get(why) ?? 0) + 1); continue; }
    checked++;
    if (ser(body.FirstChild) !== ser(wk[i])) { ctxDiff++; if (ctxDiff < 4) console.log("CTXDIFF", JSON.stringify(kids[i].slice(0, 100))); }
  }
}
console.log(JSON.stringify({ mode: MODE, docsN, children, checked, certFail: [...certFail], ctxDiff }));
// negative samples: children the certificate must refuse
for (const bad of ["<p>x</p><p>y</p>", "<p>x", "<b>x</b>", "<p><b>x</p>", "<p>x</p>text", "<table><tr><td>x</td></tr></table>", "<textarea>x</textarea>", "<ul><li>a</li>", "<div><p>x</div>", "<p>x</p></p>"]) {
  const { doc, b } = parseWithBoundary(bad);
  const body = bodyOf(doc);
  const why = b === null ? "no-boundary" : sameBoundary(b, REF) || (body.FirstChild !== null && body.FirstChild.NextSibling === null ? "" : "shape");
  console.log("neg", JSON.stringify(bad), "->", why || "ACCEPTED");
}
