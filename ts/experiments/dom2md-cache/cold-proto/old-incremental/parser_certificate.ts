// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".

// The parser certificate (section 4 of the milestone B specification). A child is certified when parsing it alone reaches, at its end,
// the same projected parser state as the reference "<hr>" (the state in body content), and it is one top-level element whose last token
// ends its own element. A certified child may be parsed alone and its output is the output of the child in context (section 4.3).

import * as bytes from "../../../../src/runtime/bytes.ts";
import * as conv from "../../../../src/runtime/conv.ts";
import * as html from "../../../../src/html/index.ts";

// The state at the first ErrorToken (the end of the input, before the engine's EOF handling), projected as section 4.1.
export interface Boundary {
  im: unknown;
  oe: string[];
  afe: number;
  form: boolean;
  templates: number;
  originalIM: unknown;
  foster: boolean;
  quirks: boolean;
  fragment: boolean;
  scripting: boolean;
  selfClosing: boolean;
  hasContext: boolean;
  rawTag: string;
  err: string;
  lastTokEnd: number;
  lastTokType: number;
  lastTokData: string;
  bufLen: number;
}

// parseWithBoundary parses the string as util.ParseHTML does (html.ParseWithOptions) and records the boundary state. The hook overrides
// parseCurrentToken on the parser of this call only; it changes nothing that the parser does.
export function parseWithBoundary(htmlStr: string): { doc: html.Node; boundary: Boundary | null } {
  const buf = conv.BytesFromString(htmlStr);
  let boundary: Boundary | null = null;
  let lastEnd = -1;
  let lastType = -1;
  let lastData = "";
  const opt = (p: html.parser): void => {
    const orig = p.parseCurrentToken;
    p.parseCurrentToken = function (this: html.parser): void {
      // instance override, this parser object is private to the call
      if (boundary === null) {
        if (this.tok.Type === html.ErrorToken) {
          const z = this.tokenizer!;
          boundary = {
            im: this.im,
            oe: this.oe.items.map((n) => n!.Namespace + "|" + n!.DataAtom + "|" + n!.Data),
            afe: this.afe.items.length,
            form: this.form !== null,
            templates: this.templateStack.items.length,
            originalIM: this.originalIM,
            foster: this.fosterParenting,
            quirks: this.quirks,
            fragment: this.fragment,
            scripting: this.scripting,
            selfClosing: this.hasSelfClosingToken,
            hasContext: this.context !== null,
            rawTag: z.rawTag,
            err: String(z.err),
            lastTokEnd: lastEnd,
            lastTokType: lastType,
            lastTokData: lastData,
            bufLen: buf.length,
          };
        }
      }
      orig.call(this);
      // Recorded after the token is processed: processing may run parseCurrentToken again for implied tokens (parseImpliedToken),
      // and the token of this call must be the last one recorded (deviation from the specification's hook, see tasks/004).
      if (boundary === null && this.tok.Type !== html.ErrorToken) {
        lastEnd = this.tokenizer!.raw.end;
        lastType = this.tok.Type;
        lastData = this.tok.Data;
      }
    };
  };
  const [doc, err] = html.ParseWithOptions(buf, opt);
  if (err !== null) {
    throw err;
  }
  return { doc: doc!, boundary };
}

// bodyOf selects the body as util.ParseHTML does (util/html.ts:35-38).
export function bodyOf(doc: html.Node): html.Node | null {
  const first = doc.FirstChild;
  if (first === null) {
    return null;
  }
  return "html" !== first.Data ? doc : first.LastChild;
}

export function serialiseNode(n: html.Node): string {
  const w = new bytes.Buffer();
  const err = html.Render(w, n);
  if (err !== null) {
    throw err;
  }
  return conv.StringFromBytes(w.Bytes());
}

// The reference state, computed once: the state after "<hr>" in body content (section 4.2).
let refCache: Boundary | null = null;

export function REF(): Boundary {
  if (refCache === null) {
    const r = parseWithBoundary("<hr>").boundary;
    if (r === null) {
      throw new Error("parser certificate: no boundary for the reference <hr>");
    }
    refCache = r;
  }
  return refCache;
}

// sameState compares the fields of condition 1 (section 4.2) and returns the first field that differs, or null.
export function sameState(b: Boundary, ref: Boundary): string | null {
  if (b.im !== ref.im) {
    return "im";
  }
  if (b.oe.join("\n") !== ref.oe.join("\n")) {
    return "oe";
  }
  if (b.afe !== ref.afe) {
    return "afe";
  }
  if (b.form !== ref.form) {
    return "form";
  }
  if (b.templates !== ref.templates) {
    return "templates";
  }
  if (b.originalIM !== ref.originalIM) {
    return "originalIM";
  }
  if (b.foster !== ref.foster) {
    return "foster";
  }
  if (b.quirks !== ref.quirks) {
    return "quirks";
  }
  if (b.fragment !== ref.fragment) {
    return "fragment";
  }
  if (b.scripting !== ref.scripting) {
    return "scripting";
  }
  if (b.selfClosing !== ref.selfClosing) {
    return "selfClosing";
  }
  if (b.hasContext !== ref.hasContext) {
    return "hasContext";
  }
  if (b.rawTag !== ref.rawTag) {
    return "rawTag";
  }
  if (b.err !== ref.err) {
    return "err";
  }
  return null;
}

// Void elements that the grammar allows at top level (hr), which end with a start tag token.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"]);

// certify returns null when the child is certified, otherwise the failing condition (a field name of section 4.2, "shape" or "last-token").
export function certify(child: string, doc: html.Node, boundary: Boundary | null): string | null {
  void child;
  if (boundary === null) {
    return "no-boundary";
  }
  // condition 1
  const state = sameState(boundary, REF());
  if (state !== null) {
    return state;
  }
  // condition 2: the child ends at its end and its last token closes its own top-level element
  if (boundary.lastTokEnd !== boundary.bufLen) {
    return "last-token";
  }
  // condition 3: the body holds exactly one element
  const body = bodyOf(doc);
  if (body === null || body.FirstChild === null || body.FirstChild.Type !== html.ElementNode || body.FirstChild.NextSibling !== null) {
    return "shape";
  }
  const top = body.FirstChild;
  const endOk = boundary.lastTokType === html.EndTagToken && boundary.lastTokData === top.Data;
  const voidOk =
    VOID.has(top.Data) && (boundary.lastTokType === html.StartTagToken || boundary.lastTokType === html.SelfClosingTagToken) && boundary.lastTokData === top.Data;
  if (!endOk && !voidOk) {
    return "last-token";
  }
  return null;
}

// sandwichCheck is the behavioural check of strict mode (section 4.3): the child parsed between "<hr>" and "<p>x</p>" must give the
// same node as the child alone, the final "<p>x</p>" must not be wrapped, and the final state must be the reference state.
// It returns null when it holds, otherwise the name of the failing part.
export function sandwichCheck(child: string): string | null {
  const alone = parseWithBoundary(child);
  const aloneBody = bodyOf(alone.doc);
  if (aloneBody === null || aloneBody.FirstChild === null) {
    return "sandwich-alone";
  }
  const aloneText = serialiseNode(aloneBody.FirstChild);
  const s = parseWithBoundary("<hr>" + child + "<p>x</p>");
  const body = bodyOf(s.doc);
  if (body === null) {
    return "sandwich-shape";
  }
  const nodes: html.Node[] = [];
  for (let c = body.FirstChild; c !== null; c = c.NextSibling) {
    nodes.push(c);
  }
  if (nodes.length !== 3) {
    return "sandwich-shape";
  }
  if (serialiseNode(nodes[1]) !== aloneText) {
    return "sandwich-child";
  }
  if (serialiseNode(nodes[2]) !== "<p>x</p>") {
    return "sandwich-tail";
  }
  if (s.boundary === null || sameState(s.boundary, REF()) !== null || s.boundary.lastTokEnd !== s.boundary.bufLen) {
    return "sandwich-state";
  }
  return null;
}
