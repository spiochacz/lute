// Recording format renderer: milestone A of the per-child cache (tasks/004-incremental-and-fast-paths.md, section
// "Mismatch analysis and fix specification", (c) item 3 and (d) H2). It is not on any default path: nothing in the engine
// uses it unless a test or a tool calls NewRecordingFormatRenderer / RenderWithLogs / ReplayFormatLogs explicitly.
//
// RenderWithLogs renders the tree like BaseRenderer.Render (the output is the normal output), and for every top-level node of
// the document it records the operations on the ROOT writer, which are:
//   Append(bytes, setsLastOut)  bytes written to the root writer; setsLastOut tells whether the write also sets LastOut
//                               (the renderer's Write, WriteString and WriteByte do; a container exit that writes its buffer
//                               into the root with Buffer.Write, and TextAutoSpacePrevious/Next, do not)
//   NewlineIfNotLF              Newline() called while the root writer is the current writer (decided at replay time, on LastOut)
//   TrimSpaceAll                trimWriterTo of the root writer by a container exit (the buffer is bytes.TrimSpace of the root)
// ReplayFormatLogs replays the operations of all pieces on a fresh root writer and then runs the document close, the same
// function renderDocument runs at its exit (closeDocumentWriter in format_renderer.ts). Each piece also records LastOut at its
// end, and ReplayFormatLogsTrace returns the LastOut after every piece of the replay, so a difference in LastOut is seen even
// when the bytes happen to agree.
//
// Mechanism. The recorder keeps the real state: it performs every operation (the trims included) and records it into the
// piece being rendered. A logging root buffer (RecordingRootBuffer) is the root writer: its Write, WriteByte, WriteString and
// WriteRune record Append, and its Reset and Truncate throw when they happen outside a logged operation (so an unlogged root
// mutation cannot pass silently). Renderer-level writes are flagged by a depth counter set in the overrides of Write,
// WriteString, WriteByte and Newline. Operations that the recorder performs itself while it is logging a single logged
// operation are muted, so the log has one entry per logical operation.
//
// ROOT-WRITER MUTATION INVENTORY (E4), from the code as of this commit; line numbers are of format_renderer.ts and renderer.ts.
//   M1  renderDocument entering (:1419): r.Writer = r.newBuffer(); push. This creates the root writer (NodeWriterStack[0]).
//   M2  Renderer-level writes while the root is r.Writer: BaseRenderer.Write, WriteString, WriteByte (renderer.ts:612-640),
//       which set LastOut, and BaseRenderer.Newline (renderer.ts:646), which writes LF only when LastOut is not LF and sets LastOut.
//       Logged as Append(setsLastOut=true) and NewlineIfNotLF.
//   M3  Container exits write their own buffer into the parent with Buffer.Write, not through the renderer, so LastOut is not
//       set: renderBlockquote exit (format_renderer.ts:1857, "NodeWriterStack[top].Write(writer.Bytes())"), renderList
//       exit (:1925), renderListItem exit (:2008) and renderFootnotesDef exit (:973, contentBuf). Logged as Append(setsLastOut=false).
//   M4  Direct buffer writes by renderer helpers: TextAutoSpacePrevious, TextAutoSpaceNext and the two LinkTextAutoSpace
//       functions write r.Writer.WriteByte(' ') without setting LastOut (renderer.ts:677, 706, 735, 754). Logged as Append(setsLastOut=false).
//   M5  Trims of the root writer: trimWriterTo(TrimSpace(root)) at renderBlockquote exit (:1861), renderList exit (:1929),
//       renderListItem exit (:2012) when the parent is the root (an orphan top-level <li>), and closeDocumentWriter (:1412)
//       (the document close, Trim with " \t\n" or TrimRight+TrimLeft). The container trims are logged as TrimSpaceAll after a
//       check that the argument is bytes.TrimSpace of the root; the document close is not logged (it runs after the pieces).
//       setWriterFromOwn (renderer.ts:545) is the mutator under the trim: Reset (empty result, LastOut unchanged), Truncate,
//       copyWithin of the trimmed view to the start of the storage, Write when the view is not in the storage (never for the
//       views the format renderer passes), and LastOut set to the last byte when the result is not empty.
//   M6  Stack swaps: r.Writer = newBuffer() and NodeWriterStack push/pop at the entering and exiting of renderFootnotesDef
//       (:952, :974), renderBlockquote (:1819, :1858), renderList (:1920, :1926) and renderListItem (:1942, :2009); the exit sets r.Writer to the new top of the stack. The swaps do not
//       change the root's content; they decide which writer an operation reaches (a container's operations never reach the root
//       except through M3 and M5).
//   M7  Newline's dependence on LastOut: the write of LF in M2 happens only when LastOut is not LF.
//   M8  Reads of the root's content: only the trims of M5 and the output read at the end of Render. No format code reads the
//       root's length or bytes otherwise (grep of r.Writer.Bytes/Len/String in format_renderer.ts and tabs.ts).
//   M9  Reads of LastOut outside Newline: renderText (format_renderer.ts:1496, the task list marker check "0x20 === r.LastOut").
//       LastOut is also set by writes into node buffers (a container's own writes), which the root log does not contain.
//       This is the case the piece-end LastOut check (ReplayFormatLogsTrace) covers.
//   Explicit base-class calls: the format path has none that write (tabs.ts renderTabs calls r.* methods; the explicit
//       BaseRenderer.prototype.WriteString.call of renderDefault is reached only for node types without a renderer).
//
// What the three operations cannot express: M3 and M4 (LastOut is not set) are expressed by the flag of Append, not by a
// fourth operation. The effect of node-level writes on LastOut (M9) is not in the log; it matters only when a trim leaves the
// root empty and LastOut is then the value of the last node-level write. The piece-end LastOut check detects that case.
//
// Not done in milestone A (the cache, milestone B, needs them): the sandbox with LastOut UNKNOWN at the start of a piece, the
// read barrier on the context fields, and the reads of previous-node context (isLastNode, Previous/Next). Each piece here is
// rendered in the context of the whole document, so NewlineIfNotLF is recorded for every Newline at the root.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as ast from "../ast/index.ts";
import * as lex from "../lex/index.ts";
import * as parse from "../parse/index.ts";
import { BaseRenderer, FormatRenderer } from "./types.ts";
import type { Options, ExtRendererFunc, RendererFunc } from "./renderer.ts";
import { setWriterFromOwn } from "./renderer.ts";
import { closeDocumentWriter, registerFormatRendererFuncs } from "./format_renderer.ts";

// RootOp is one operation on the root writer, in the order it happened.
export type RootOp =
  | { kind: "Append"; bytes: Uint8Array; setsLastOut: boolean }
  | { kind: "NewlineIfNotLF" }
  | { kind: "TrimSpaceAll" };

// RootPiece is the log of one top-level node; lastOut is the LastOut of the renderer at the end of the node.
export interface RootPiece {
  ops: RootOp[];
  lastOut: number;
}

// FormatLogs is the result of RenderWithLogs: the pieces in document order, and the options the document close needs.
export interface FormatLogs {
  options: Options;
  parseOptions: parse.Options;
  pieces: RootPiece[];
}

// RecordingRootBuffer is the root writer of a recording render. Its operations are logged into the recorder's open piece.
class RecordingRootBuffer extends bytes.Buffer {
  recorder: RecordingFormatRenderer;

  constructor(recorder: RecordingFormatRenderer) {
    super();
    this.recorder = recorder;
  }

  Write(p: Uint8Array): number {
    this.recorder.appendOp(p);
    return super.Write(p);
  }

  WriteByte(c: number): void {
    this.recorder.appendOp(new Uint8Array([c]));
    super.WriteByte(c);
  }

  WriteString(s: string): number {
    this.recorder.appendOp(conv.BytesFromString(s));
    return super.WriteString(s);
  }

  WriteRune(r: number): number {
    this.recorder.appendOp(conv.BytesFromString(conv.StringFromRune(r)));
    return super.WriteRune(r);
  }

  Reset(): void {
    this.recorder.unloggedMutation("Reset");
    super.Reset();
  }

  Truncate(n: number): void {
    if (n < this.Len()) {
      this.recorder.unloggedMutation("Truncate");
    }
    super.Truncate(n);
  }
}

// RecordingFormatRenderer renders a document and records the root-writer operations of every top-level node.
// PORT-NOTE: Go embedding, a subclass of FormatRenderer as TextBundleRenderer is; the overrides are the hooks of the design (tasks/004 (d) H2).
export class RecordingFormatRenderer extends FormatRenderer {
  sink: RootOp[] | null; // operations of the top-level node being rendered; null outside a top-level node
  muted: number; // > 0 while the recorder performs an operation that is logged as one entry
  rendererWrites: number; // > 0 while a renderer-level write (one that sets LastOut) runs
  pieces: RootPiece[]; // the pieces of the last RenderWithLogs

  constructor(tree: parse.Tree, options: Options, parseOptions: parse.Options) {
    super(tree, options, parseOptions);
    this.sink = null;
    this.muted = 0;
    this.rendererWrites = 0;
    this.pieces = [];
  }

  // newBuffer creates the root writer when the document opens (no writer is on the stack yet); a container's writer is a plain buffer.
  newBuffer(): bytes.Buffer {
    if (0 === this.NodeWriterStack.length) {
      return new RecordingRootBuffer(this);
    }
    return new bytes.Buffer();
  }

  // trimWriterTo: a container's trim of the root writer is logged as TrimSpaceAll after checking that the argument is bytes.TrimSpace of the root.
  // The trim itself is performed (the recorder keeps the real state). The document close has no open piece and is not logged.
  trimWriterTo(buf: Uint8Array): void {
    const r = this;
    if (null !== r.sink && r.isRootWriter()) {
      if (!bytes.Equal(buf, bytes.TrimSpace(r.Writer.Bytes()))) {
        throw new Error("RecordingFormatRenderer: a trim of the root writer is not TrimSpaceAll");
      }
      r.sink.push({ kind: "TrimSpaceAll" });
      r.muted++;
      try {
        setWriterFromOwn(r, buf);
      } finally {
        r.muted--;
      }
      return;
    }
    setWriterFromOwn(r, buf);
  }

  // The renderer-level writes set rendererWrites, so that the root buffer logs them with setsLastOut.
  Write(content: Uint8Array): void {
    this.rendererWrites++;
    try {
      BaseRenderer.prototype.Write.call(this, content); // PORT-NOTE: Go embedding, base method (the override only counts the write)
    } finally {
      this.rendererWrites--;
    }
  }

  WriteByte(c: number): void {
    this.rendererWrites++;
    try {
      BaseRenderer.prototype.WriteByte.call(this, c); // PORT-NOTE: Go embedding, base method (the override only counts the write)
    } finally {
      this.rendererWrites--;
    }
  }

  WriteString(content: string): void {
    this.rendererWrites++;
    try {
      BaseRenderer.prototype.WriteString.call(this, content); // PORT-NOTE: Go embedding, base method (the override only counts the write)
    } finally {
      this.rendererWrites--;
    }
  }

  // Newline is logged as NewlineIfNotLF when the root writer is the current writer; the base method runs muted.
  Newline(): void {
    const r = this;
    if (null !== r.sink && r.isRootWriter()) {
      r.sink.push({ kind: "NewlineIfNotLF" });
    }
    r.muted++;
    try {
      BaseRenderer.prototype.Newline.call(r); // PORT-NOTE: Go embedding, base method (muted: the operation is the NewlineIfNotLF above)
    } finally {
      r.muted--;
    }
  }

  // isRootWriter reports whether r.Writer is the root writer (the first buffer of the stack, which renderDocument pushes).
  isRootWriter(): boolean {
    return 0 < this.NodeWriterStack.length && this.Writer === this.NodeWriterStack[0];
  }

  // appendOp records an Append of p into the open piece, unless the recorder is muted or no piece is open.
  appendOp(p: Uint8Array): void {
    if (null === this.sink || 0 < this.muted || 0 === p.length) {
      return;
    }
    this.sink.push({ kind: "Append", bytes: p.slice(), setsLastOut: 0 < this.rendererWrites });
  }

  // unloggedMutation throws when the root writer is reset or truncated outside a logged operation.
  unloggedMutation(name: string): void {
    if (null !== this.sink && 0 === this.muted) {
      throw new Error(`RecordingFormatRenderer: root writer ${name} outside a logged operation`);
    }
  }

  // RenderWithLogs renders the document and returns the output and the logs. The walk is the one of BaseRenderer.Render, with
  // the top-level nodes marked: a piece opens when a top-level node is entered and closes when it is left (after its exit).
  RenderWithLogs(): [Uint8Array, FormatLogs] {
    const r = this;
    r.LastOut = lex.ItemNewline;
    r.Writer = new bytes.Buffer();
    r.Writer.Grow(4096);
    r.pieces = [];
    r.sink = null;
    const root = r.Tree.Root!;
    ast.Walk(root, (n: ast.Node, entering: boolean): ast.WalkStatus => {
      const top = null !== n.Parent && n.Parent === root;
      if (top && entering) {
        r.pieces.push({ ops: [], lastOut: 0 });
        r.sink = r.pieces[r.pieces.length - 1].ops;
      }
      const status = r.dispatch(n, entering);
      if (top && !entering) {
        r.pieces[r.pieces.length - 1].lastOut = r.LastOut;
        r.sink = null;
      }
      return status;
    });
    const output = r.Writer.Bytes();
    return [output, { options: r.Options, parseOptions: r.ParseOptions, pieces: r.pieces }];
  }

  // dispatch is the callback of BaseRenderer.Render (renderer.ts), with the same order of lookups.
  dispatch(n: ast.Node, entering: boolean): ast.WalkStatus {
    const r = this;
    const extRender: ExtRendererFunc | undefined = r.ExtRendererFuncs.get(n.Type);
    if (undefined !== extRender) {
      const [output, status] = extRender(n, entering);
      r.WriteString(output);
      return status;
    }
    const render: RendererFunc | undefined = r.RendererFuncs.get(n.Type);
    if (undefined === render) {
      if (null !== r.DefaultRendererFunc) {
        return r.DefaultRendererFunc(n, entering);
      }
      r.rendererWrites++;
      try {
        return BaseRenderer.prototype.renderDefault.call(r, n, entering); // PORT-NOTE: Go embedding, base method
      } finally {
        r.rendererWrites--;
      }
    }
    return render(n, entering);
  }
}

// NewRecordingFormatRenderer creates a recording renderer with the function table of NewFormatRenderer.
export function NewRecordingFormatRenderer(tree: parse.Tree, options: Options, parseOptions: parse.Options): RecordingFormatRenderer {
  const ret = new RecordingFormatRenderer(tree, options, parseOptions);
  registerFormatRendererFuncs(ret);
  return ret;
}

// ReplayResult is the output of a replay and the LastOut after each piece.
export interface ReplayResult {
  output: Uint8Array;
  lastOuts: number[];
}

// ReplayFormatLogs replays the logs on a fresh root writer and runs the document close. It returns the document bytes.
export function ReplayFormatLogs(logs: FormatLogs): Uint8Array {
  return ReplayFormatLogsTrace(logs).output;
}

// ReplayFormatLogsTrace is ReplayFormatLogs with the LastOut of the replay after every piece, to compare with RootPiece.lastOut.
export function ReplayFormatLogsTrace(logs: FormatLogs): ReplayResult {
  const r = new FormatRenderer(new parse.Tree(), logs.options, logs.parseOptions);
  r.LastOut = lex.ItemNewline;
  r.Writer = new bytes.Buffer();
  const lastOuts: number[] = [];
  for (const piece of logs.pieces) {
    for (const op of piece.ops) {
      switch (op.kind) {
        case "Append":
          if (op.setsLastOut) {
            r.Write(op.bytes);
          } else {
            r.Writer.Write(op.bytes);
          }
          break;
        case "NewlineIfNotLF":
          r.Newline();
          break;
        case "TrimSpaceAll":
          r.trimWriterTo(bytes.TrimSpace(r.Writer.Bytes()));
          break;
      }
    }
    lastOuts.push(r.LastOut);
  }
  closeDocumentWriter(r);
  return { output: r.Writer.Bytes(), lastOuts };
}
