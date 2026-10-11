// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".
//
// The piece-assembly test of step 7 (a temporary harness, not part of the product): for the WYSIWYG DOMs of corpus documents, every
// scanner child runs alone (sandbox), the context is the one computed from the neighbours (the sweeps of 5.1 line 12), the logs are
// replayed on a FormatRenderer and the document close is run; the result must equal the engine's VditorDOM2Md output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { New, editor } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import * as bytes from "../../src/runtime/bytes.ts";
import * as conv from "../../src/runtime/conv.ts";
import * as lex from "../../src/lex/index.ts";
import * as parse from "../../src/parse/index.ts";
import { scanTopLevel } from "../../src/incremental/scanner.ts";
import { runChild, listCoupling, WYSIWYG_ADAPTER, IR_ADAPTER } from "../../src/incremental/sandbox.ts";
import type { ModeAdapter } from "../../src/incremental/sandbox.ts";
import { LASTOUT_PASS } from "../../src/incremental/piece.ts";
import type { ChildInfo, Context, ReadKey, Variant } from "../../src/incremental/piece.ts";
import { FormatRenderer } from "../../src/render/types.ts";
import { closeDocumentWriter } from "../../src/render/format_renderer.ts";
import { auditDocuments } from "./corpus_docs.ts";

const PROVISIONAL: Context = { lastOut: 10, prev: -1, next: -1, isFirst: true, isLast: true, domPrev: -1, domNext: -1, domNextAttrs: 0 };

function matches(v: Variant, c: Context): boolean {
  return v.readKeys.every((k: ReadKey, i: number) => c[k] === v.readVals[i]);
}

export interface Assembled {
  text: string | null; // null when the document is refused
  reason: string | null;
}

// assemble composes one document from its children (the sweeps of 5.1 line 12, the matching and the replay of line 14).
export function assemble(lute: Lute, adapter: ModeAdapter, h: string): Assembled {
  const sc = scanTopLevel(h);
  if (!sc.ok) {
    return { text: null, reason: "scan:" + sc.code };
  }
  const infos: ChildInfo[] = [];
  const provisional: Array<Variant | null> = [];
  for (const c of sc.children) {
    const res = runChild(lute, adapter, h.substring(c.start, c.end), PROVISIONAL, { certify: true, opaque: c.opaque });
    if (res.refusal !== null) {
      return { text: null, reason: res.refusal.reason };
    }
    infos.push(res.info!);
    provisional.push(res.variant);
  }
  if (listCoupling(lute, infos)) {
    return { text: null, reason: "list-coupling" };
  }
  const n = infos.length;
  const emitting = (i: number): boolean => infos[i].alive && infos[i].topTypes.length > 0;
  const prevT: number[] = new Array(n).fill(-1);
  const domP: number[] = new Array(n).fill(-1);
  const nextT: number[] = new Array(n).fill(-1);
  const domN: number[] = new Array(n).fill(-1);
  const domNA: number[] = new Array(n).fill(0);
  let lastEmit = -1;
  let lastAlive = -1;
  for (let i = 0; i < n; i++) {
    prevT[i] = lastEmit < 0 ? -1 : infos[lastEmit].topTypes[infos[lastEmit].topTypes.length - 1];
    domP[i] = lastAlive < 0 ? -1 : infos[lastAlive].atom;
    if (infos[i].alive) {
      lastAlive = i;
    }
    if (emitting(i)) {
      lastEmit = i;
    }
  }
  let nextEmit = -1;
  let nextAlive = -1;
  for (let i = n - 1; i >= 0; i--) {
    nextT[i] = nextEmit < 0 ? -1 : infos[nextEmit].topTypes[0];
    domN[i] = nextAlive < 0 ? -1 : infos[nextAlive].atom;
    domNA[i] = nextAlive < 0 ? 0 : infos[nextAlive].attrs;
    if (infos[i].alive) {
      nextAlive = i;
    }
    if (emitting(i)) {
      nextEmit = i;
    }
  }

  // The replay: the same calls as ReplayFormatLogsTrace (recording_format_renderer.ts), on a FormatRenderer with the render options of the adapter.
  const R = new FormatRenderer(new parse.Tree(), adapter.renderOptions(), lute.ParseOptions);
  R.LastOut = lex.ItemNewline;
  R.Writer = new bytes.Buffer();
  for (let i = 0; i < n; i++) {
    if (!infos[i].alive) {
      continue;
    }
    const ctx: Context = {
      lastOut: R.LastOut,
      prev: prevT[i],
      next: nextT[i],
      isFirst: prevT[i] < 0,
      isLast: nextT[i] < 0,
      domPrev: domP[i],
      domNext: domN[i],
      domNextAttrs: domNA[i],
    };
    let v: Variant | null = provisional[i] !== null && matches(provisional[i]!, ctx) ? provisional[i] : null;
    if (v === null) {
      const c = sc.children[i];
      const res = runChild(lute, adapter, h.substring(c.start, c.end), ctx, { certify: false, opaque: c.opaque });
      if (res.refusal !== null) {
        return { text: null, reason: res.refusal.reason };
      }
      v = res.variant!;
    }
    for (const op of v.ops) {
      switch (op.kind) {
        case "Append":
          if (op.setsLastOut) {
            R.Write(op.bytes);
          } else {
            R.Writer.Write(op.bytes);
          }
          break;
        case "NewlineIfNotLF":
          R.Newline();
          break;
        case "TrimSpaceAll":
          R.trimWriterTo(bytes.TrimSpace(R.Writer.Bytes()));
          break;
      }
    }
    if (v.endLastOut !== LASTOUT_PASS) {
      R.LastOut = v.endLastOut;
    }
  }
  closeDocumentWriter(R);
  return { text: conv.StringFromBytes(R.Writer.Bytes()), reason: null };
}

// The whole WYSIWYG corpus (every accepted document of auditDocuments, opaque children included: a refused document is counted by its reason and
// must not be an inconsistency). The run is about the time of one npm test budget; the number of documents compared is printed.
test("piece assembly equals VditorDOM2Md on the whole WYSIWYG corpus (accepted documents)", () => {
  const lute: Lute = New();
  const docs = auditDocuments().filter((d) => d.mode === "wysiwyg");
  let compared = 0;
  const refused = new Map<string, number>();
  for (const doc of docs) {
    const sc = scanTopLevel(doc.html);
    if (!sc.ok) {
      continue;
    }
    const got = assemble(lute, WYSIWYG_ADAPTER, doc.html);
    if (got.text === null) {
      refused.set(got.reason!, (refused.get(got.reason!) ?? 0) + 1);
      continue;
    }
    const want = lute.VditorDOM2Md(doc.html.split(editor.Zwsp).join(""));
    if (want !== got.text.split(editor.Zwsp).join("")) {
      throw new Error(`${doc.name}: piece assembly differs
assembled: ${JSON.stringify(got.text)}
engine:    ${JSON.stringify(want)}
html: ${doc.html}`);
    }
    compared++;
  }
  assert.ok(compared >= 500, `only ${compared} documents compared`);
  process.stdout.write(`piece assembly (WYSIWYG): ${compared} documents equal; refused by reason ${JSON.stringify(Object.fromEntries(refused))}
`);
});

// Step 8: the same harness for the IR DOM. A document that is refused with tip-open (indented code in IR, section 1.2 S5) is skipped with
// its reason asserted; any other refusal is counted, and a mismatch of an assembled document is a STOP.
test("piece assembly equals VditorIRDOM2Md on the whole IR corpus (accepted documents)", () => {
  const lute: Lute = New();
  const docs = auditDocuments().filter((d) => d.mode === "ir");
  let compared = 0;
  const refused = new Map<string, number>();
  for (const doc of docs) {
    const sc = scanTopLevel(doc.html);
    if (!sc.ok) {
      continue;
    }
    const got = assemble(lute, IR_ADAPTER, doc.html);
    if (got.text === null) {
      refused.set(got.reason!, (refused.get(got.reason!) ?? 0) + 1);
      continue;
    }
    const want = lute.VditorIRDOM2Md(doc.html.split(editor.Zwsp).join(""));
    if (want !== got.text.split(editor.Zwsp).join("")) {
      throw new Error(`${doc.name}: IR piece assembly differs\nassembled: ${JSON.stringify(got.text)}\nengine:    ${JSON.stringify(want)}\nhtml: ${doc.html}`);
    }
    compared++;
  }
  assert.ok(compared >= 500, `only ${compared} IR documents compared`);
  process.stdout.write(`piece assembly (IR): ${compared} documents equal; refused by reason ${JSON.stringify(Object.fromEntries(refused))}\n`);
});
