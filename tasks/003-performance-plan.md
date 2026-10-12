# Performance plan for the TypeScript port (2026-10-11)

Independent analysis of where the remaining time goes and what to change, ranked. Analysis only; nothing under `ts/src/` or `ts/test/` was modified. All scratch experiments live in the session scratchpad (`scratchpad/fable/`: `alloc.mjs`, `alloc2.mjs`, `node-size.mjs`, `fixed-cost.mjs`, `count.ts` + `hook.mjs` + `slices-instr.ts`, `ab.ts` + `ab-run.mjs` + `hook2.mjs` + `slices-fast.ts` + `slices-fast2.ts`, `callers.mjs`, `deopt.mjs`, `nodes.mjs`) and can be re-run.

Provenance labels: **[measured]** a scratch experiment or a new profile from this session; **[profile]** read from a CPU profile (self time of samples, `bench:profile` on `dist/lute.esm.js`); **[counted]** from the instrumented run (allocation counts are stable, timings are not); **[reasoned]** inference from the code.

State of `dist/` during this session: built 12:33, i.e. after the three wave-1 commits and including the uncommitted wave-2 edits (`slices.ts` short-copy loop, counted `EscapeHTML`). The A/B experiments run the unbundled `ts/src/` files directly, so their absolute numbers are 10–30% slower than the bundle and only the ratios matter.

## 1. Verdict on the structural picture

The suspicion is confirmed on two of three points and corrected on the third.

1. **ArrayBuffer-backed slices are expensive, but mostly on small inputs.** V8 keeps a `Uint8Array` of at most 64 bytes on-heap without an `ArrayBuffer`; `new Uint8Array(n)` then costs 25–30 ns. `new Uint8Array(new ArrayBuffer(n), 0, n)` costs 280–330 ns without survivors and 1.1–1.5 µs with survivors and GC pressure (the real case for tokens kept in the tree). Reading `.buffer` on an on-heap array materialises an `ArrayBuffer` at the same price, and `slices.Append`, `AppendByte` and `Cap` read `.buffer` on every call, so today no byte slice ever stays on-heap. `MarkdownStr` on the 212 KB spec creates 9.2k fresh ArrayBuffers and 31k in-place views per call [counted]. Replacing the scheme (section 4, item S1) gives +11–13% on 1 KB inputs and 0–5% on the spec alone, +10% on the spec when combined with the Node change [measured]. So it is real, but it is not the single dominant cost on large inputs.
2. **The 76-field `Node` is worse than assumed, for a reason other than the field count.** A real `ast.Node` costs 1,834 bytes on the heap [measured]; the 76 in-object fields are about 630 of those. The five `new Uint8Array(0)` fields cost 200 bytes each (1,000 bytes per node), the `Properties` `Map` 184 bytes, the three empty arrays 96. A spec parse holds 11,655 live nodes (21 MB of nodes for a 212 KB input) [measured]. Sharing one empty array and creating the Map lazily, without touching the layout or any call site, gives +10–15% on every method [measured]. A hot/cold split on top of that is worth less than this first step (section 4, S2).
3. **bytes→string→bytes round trips matter on the DOM paths, not on `MarkdownStr`.** `TextEncoder.encode` has a fixed cost of about 340 ns per call regardless of length (an 8-byte string: 340 ns against 36 ns for a `charCodeAt` loop into an on-heap array) [measured]. `BytesFromString` is 2.2% of `MarkdownStr` but 14.5% of `HTML2Md` (all from `genASTByDOM`), 7% of `BlockDOM2Md` and 5–7% of `SpinBlockDOM` [profile]. The renderer side is not a round trip problem: the high `Buffer.WriteString` share under `Tag` (10.7% of `SpinBlockDOM`) is the byte-writing of the attribute text itself, as wave 1 already found.

Three things the picture missed, all algorithmic and all inherited from Go:

- `Md2VditorSVDOM` spends 57% of its time in `moveBytes` + `Append` under `renderListItem` and allocates 171 MB of growing appends per spec call (0.4 MB for `MarkdownStr`) [profile, counted]: every list item close prepends a marker to the item's buffer, `ReplaceAll`s the newline marker over it, and then re-writes the whole parent buffer onto itself. Quadratic in list items × output size.
- The same `r.Writer.Reset(); r.Write(buf)` self-copy of the whole parent buffer at every container close exists in `FormatRenderer` (document, list item, blockquote, callout, tabs), `ProtyleExportMdRenderer` and `VditorSVRenderer` (14 sites). Its only purpose is to set `LastOut`.
- `BlockDOM2Tree` converts two constants with `BytesFromString(" ")` for every text node and clones every text node's tokens through `ReplaceAllOrNil` (`protyle.ts:528`).

Micro-tuning of single runtime functions is indeed at its end: the wave-2 `moveBytes` loop and counted `EscapeHTML` are within noise on the spec. The profiles have no deopt loops (7 deoptimisations in 40 spec calls, none recurring) [measured], all `Node` instances are in fast-properties mode [measured], the min bundle inlines the `ast.NodeX` constants (one textual occurrence of `NodeTableCell` left, the name table) and has no `__publicField` helpers [measured]. What remains is allocation volume (about 50 MB per spec `MarkdownStr` call, one scavenge per call, GC 8–13% of every profile [measured]) and the three algorithmic items above.

## 2. Key measurements

### 2.1 Allocation cost by representation [measured]

`alloc2.mjs`, no survivors, best of 7 × 500k iterations (ns per operation); `alloc.mjs` with 1 in 64 survivors in parentheses.

| Operation | ns/op |
|---|---|
| `new Uint8Array(new ArrayBuffer(8..256), 0, n)` (today's `Make` and grow path) | 295–321 (1,290–1,490 with survivors) |
| `new ArrayBuffer(32)` alone | 278 |
| `new Uint8Array(8..64)` (on-heap) | 25–32 (60–75) |
| `new Uint8Array(65)`, `(256)` (off-heap backing store, no ArrayBuffer object) | 297, 328 |
| `new Uint8Array(32)` then read `.buffer` (materialise) | 282 |
| `new Uint8Array(32).subarray(0, 4)` (materialises too) | 313 |
| `new Uint8Array(32)` + `.set`, `.indexOf`, `.copyWithin` (no materialisation) | 34–44 |
| `big.subarray(i, i + 32)` / `new Uint8Array(big.buffer, i, 32)` | 32 / 21 |
| `Uint8Array.of(x)` / `new Uint8Array([x])` | 36 / 62 |
| `TextEncoder.encode("hello wo")` | 339 |
| `charCodeAt` loop into `new Uint8Array(8)` | 36 |
| `TextDecoder.decode` of an 8-byte on-heap array / of a view | 346 / 107 |
| `String.fromCharCode` loop, 8 bytes | 70 |
| `Map.get(int)` / `array[int]` (dispatch table) | 11.6 / 7.3 |
| `WeakSet.has` / `WeakMap.get` on a typed array | 11.8 / 11.7 |
| `{arr, off, len, cap}` object | 7–11 |
| 76-field object / 14-field object | 55–180 / 15–41 |

### 2.2 What a parse allocates [counted]

Instrumented `slices.ts` (hook on the unbundled sources), one call per method on the 212 KB spec:

| Method | `Make` | `Append` in place / growing | `AppendByte` in place / growing | `Clone` | bytes allocated by growth |
|---|---|---|---|---|---|
| `MarkdownStr` | 3,845 | 22,397 / 5,224 | 8,855 / 159 | 0 | 0.39 MB |
| `FormatStr` | 1,630 | 5,696 / 5,322 | 8,855 / 159 | 0 | 0.42 MB |
| `Md2BlockDOM` | 3,150 | 22,401 / 5,224 | 8,855 / 159 | 2,113 | 0.39 MB |
| `Md2VditorSVDOM` | 2,454 | 25,832 / 12,614 | 9,452 / 189 | 177 | **171 MB** |
| `SpinBlockDOM` | 6,501 | 42,537 / 15,673 | 34,285 / **28,128** | 4,859 | 0.85 MB |
| `HTML2Md` | 0 | 14 / 99 | 0 | 15,224 | 0.03 MB |

`Append` by caller in `MarkdownStr` [profile]: `Tree.addLine` 7.5% of the window (line accumulation into block `Tokens`), `emoji0` 1.4%, `EscapeHTML` 1.2%. `Make` by caller: `lex.splitElement` 2.0%, `EscapeHTML` 1.5%, `UnescapeBytes` 1.0%. `Node` constructor by caller: `parseText` 2.3%, `walkParseInline` 2.2% (fence marker nodes), `addChild` 1.3%, `parseCodeSpan` 1.2%.

A spec parse ends with 11,655 live nodes (2,693 `NodeText`, 1,206 `NodeSoftBreak`, 705 code blocks × 4 nodes, 519 code spans × 4 nodes), 8,649 of them with `Tokens`, behind 3,816 distinct ArrayBuffers (1,449 views of the input buffer) [measured].

### 2.3 Where spare-capacity aliasing is observable [counted, measured]

Differential run: the instrumented `Append`/`AppendByte` in copy-always mode (same bytes, same length, same capacity, never writing into the input's buffer) against the in-place mode, 12 documents (spec, kramdown spec, GFM spec, `format-case0..7`, `case1`) × 11 methods, outputs compared after normalising generated IDs: **0 differences in 132 cases**. The only site in the whole corpus that ever appends in place over bytes another view has written is `parse/code_span.ts:73` (the delete-in-place `append(ctx.tokens[:x], ctx.tokens[y:]...)`), 4–5 times per spec document, and its effect is not visible in the output because the text nodes created before `x` end before `x`. The second site known from static analysis, `parse/table.ts:159-170` (upstream item 30), does not occur in these corpora but is checked by the Go tree vectors, so any change to append semantics needs an explicit in-place write there (or an upstream fix) to keep the vectors passing. `slices.Reslice` has no call site in `src/` and `slices.Cap` is only used inside the runtime.

### 2.4 Per-call fixed costs on the ESM build [measured]

`Lute.New()` 2.4 µs; `render.NewOptions()` 2.1 µs (`parse.NewOptions()` 0.04 µs); `NewHtmlRenderer` 5.1 µs, `NewFormatRenderer` 5.6 µs, `NewProtyleRenderer` 6.1 µs (139 `bind` calls and `Map.set`s each); `MarkdownStr("")` 7.7 µs, `MarkdownStr("a")` 10.2 µs, `MarkdownStr(91 B)` 34 µs; `Md2BlockDOM("a")` 12.5 µs; `SpinBlockDOM` of the 91-byte block DOM 299 µs (of which `Md2BlockDOM` 58 µs). `SpinBlockDOM` on 1 KB is 1.67 ms, eight times `MarkdownStr` on the same text (macro `diag1`).

### 2.5 Fresh profiles of the editor paths [profile]

Self time, spec input, 5 s windows:

- `SpinBlockDOM` (23 calls, about 220 ms each under the profiler): GC 11.2%, `Buffer.WriteString` 8.9% (all under `BaseRenderer.WriteString`, i.e. the Protyle attribute text), `AppendByte` 5.3% (inline HTML tag/attribute parsing, autolinks), `Append` 4.1%, `TextEncoder.encode` 3.9%, `strings.ReplaceAll` 3.4%, `Node` 2.7%, `reserve` 2.6%, HTML tokenizer (`TagAttr`, `Token`, `readTag`, `parse`) about 6%, `adjustMath` 1.8%, `parseHTML` 1.8%. Inclusive on the 1 KB input: `BlockDOM2Tree` 37.5% (`ParseHTML` 13.4%, `genASTByBlockDOM` 16.8%, `adjustVditorDOM` 4%), `Tree2BlockDOM` 25.3%, `parse.Parse` 12.4%, `blockDOMTree2Md` 8.1%. No single hotspot: four full passes over the document, each paying the generic costs.
- `Md2VditorSVDOM` (43 calls): `moveBytes` 29.1%, `Append` 24.2%, GC 12.7%; `renderListItem` 52% inclusive.
- `BlockDOM2Md` (61 calls): GC 8.8%, `encode` 6.4% (+2.3% `encodeUtf8String`), `reserve` 5.6% (`IAL2Tokens` 2.8%), `strings.ReplaceAll` 4.7% (3.1% the six whole-document `ReplaceAll`s at the top of `BlockDOM2Tree`), HTML tokenizer about 15%, `adjustMath` 3.8%, `genASTByBlockDOM` 3.0%, `normalizeProtyleInlineCodeCaret` 2.4%.
- `HTML2Md` (117 calls): `encode` 13.4% (+2.9% native; all from `genASTByDOM`), GC 7.8%, `reserve` 6.2% (4.6% from `domText0`: a fresh `Buffer` per `DomText` call growing 0→64→128…), `Node` 5.2%, `Write` 3.7%, `bytes.TrimRight` 3.0% (cutset trimming, `inCutset` per byte), `Clone` 1.9% (`bytes.Replace` with the pattern absent returns a clone).
- `FormatStr` (210 calls): `Append` 11.0%, `Node` 9.9%, `parseBlocks` 6.9%, GC 5.1%, renderer walker 4.6%, `moveBytes` 4.1%, the `finalParseTableCellRich` walk 4.1%, `parseGFMAutoLink0` 4.1%.
- `MarkdownStr` (174 calls, this build): GC 10.9%, `Append` 9.8%, `Node` 8.2%, `parseBlocks` 5.9%, `EscapeHTML` 5.3% (3.2% from `renderCodeBlockCode`), `Make` 5.1%, `moveBytes` 4.7%, `parseGFMAutoLink0` 4.0%, `finalParseTableCellRich` walk 3.5%, renderer walker 3.0%, `headingID0` walk 2.8%, `walk` 2.6%. Inclusive: `parseBlocks` 33.5%, `parseInlines` 30.2%, `walk` (all walks) 33.6%.

### 2.6 A/B of the two structural candidates [measured]

Unbundled sources with patched `slices.ts` / `ast/node.ts` served by a load hook, 4 rounds, fresh process per measurement, variants interleaved, fastest process, output hashes identical in every run.

| Method / input | base | size-gated slices (S1) | slim Node (S2a) | S1 + S2a | S1 + S2a + lazy arrays |
|---|---|---|---|---|---|
| `MarkdownStr` spec | 23.6 ms | 0.95x | 1.13x | 1.24x | **1.26x** |
| `MarkdownStr` 1 KB | 176 µs | 1.11x | 1.10x | 1.24x | **1.27x** |
| `Md2BlockDOM` spec | 41.2 ms | 1.05x | 1.12x | 1.17x | **1.20x** |
| `SpinBlockDOM` 1 KB | 1.90 ms | 1.13x | 1.02x | **1.18x** | 1.15x |
| `HTML2Md` spec | 39.4 ms | 1.00x | 1.15x | 1.15x | 1.16x |

The WeakSet-based "owned capacity" design (in-place growth only for buffers the append chain created) was also measured and is **0.58x** on the spec and 0.76x on 1 KB: a WeakSet entry per view is far more expensive than the ArrayBuffers it saves (ephemeron processing in every scavenge). Rejected.

## 3. Ranked plan

Expected gains are per method against the current bundle; confidence is on the direction and rough size, not the exact number. "Mechanical" means a weaker model can carry it out from a brief with the test suite as the gate.

### (a) Local, safe wins

**L1. `Md2VditorSVDOM`: container close without the quadratic copies.** `render/vditor_sv_renderer.ts` `renderListItem` (1247), `renderBlockquote` (1069), `renderCallout` (1102), `renderDocument` (859). Build the result once: write marker, then the item buffer with `NewlineSV` replaced by `NewlineSV + padding`, straight into the parent buffer (a scan with `indexFrom`, writing segments); drop `r.Writer.Reset(); r.Write(buf)` and set `r.LastOut` from the last byte instead. Bytes written are identical; the intermediate buffers were never observable. Expected: 121 ms → about 45–55 ms on the spec (57% self time plus most of the 12.7% GC) [profile, counted]; nothing on small inputs. Risk to output: low; verified by the existing SV renderer tests and the macro hash. Size: 4 functions, about 60 lines. Mechanical: yes. Record as an upstream performance bug (Go does the same `Reset`/`Write` memmove).

**L2. Remove the `Reset(); Write(buf)` self-copy at every container close** in `FormatRenderer` (`renderDocument` 1401, `renderBlockquote` 1841, 1910, 1994), `ProtyleExportMdRenderer` (1846, 2326, 2394, 2475) and the SV renderer (861, 1090, 1132, 1180, 1276). Each is a memmove of the whole parent buffer onto itself, O(containers × output). Replace by trimming the buffer length (`Truncate` to the trimmed end, and for a leading trim a single `copyWithin`) plus `LastOut = buf[buf.length - 1]`. Expected: `FormatStr`, `BlockDOM2Md`, `SpinBlockDOM` (which renders through `FormatRenderer`), export paths: 3–8% on list-heavy documents (`moveBytes` 4.1% + `Write` 2.3% in `FormatStr`) [profile]; large on pathological inputs (thousands of top-level list items). Risk: low, but `LastOut` must be the last byte of the trimmed content and the trim must keep the exact bytes `bytes.Trim`/`TrimSpace` would give. Size: 14 sites, about 5 lines each. Mechanical: yes. Upstream performance bug.

**L3. Slim `Node` without changing the layout (S2a).** `ast/node.ts` constructor: the five byte fields (`CodeBlockOpenFence`, `CodeBlockInfo`, `LinkRefLabel`, `FootnotesRefLabel`, `HtmlEntityTokens`) initialised with the module-level `emptyBytes`; `Properties` becomes a prototype accessor over a `null` field that creates the `Map` on first read (9 call sites read it, none compares identity); optionally `Children`, `TableAligns`, `FootnotesRefs` the same way (8/14/12 sites). Bytes per node 1,834 → about 700. Expected: +10–15% on every method, +13% `MarkdownStr` spec, +15% `HTML2Md` [measured]. Risk: the shared empty array is safe because a zero-length array cannot be written and `Append` on it always allocates (capacity 0); `copyNode` in `parse/table_rich.ts` copies fields by assignment, fine. One subtlety: code that writes `n.X[i] = …` into an empty array is a no-op either way. Size: 10 lines plus one accessor. Mechanical: yes. Do this first.

**L4. ASCII fast path in `conv.BytesFromString`.** For strings up to about 64 chars, scan for a char ≥ 0x80 and, if none, fill `new Uint8Array(len)` with `charCodeAt` (36 ns against 340 ns) [measured]; longer or non-ASCII strings keep `TextEncoder`. Result is an exact-fit on-heap array, which is also what S1 wants. Expected: `HTML2Md` about −10% (encode 14.5%), `BlockDOM2Md` and `SpinBlockDOM` −4%, `MarkdownStr` −1.5% [profile]. Risk: none to output (same bytes; lone surrogates cannot occur in the ASCII path). Size: 15 lines in `runtime/conv.ts`. Mechanical: yes. The mirror image, `StringFromBytes`, already has the ASCII path up to 32 bytes; raise it to 64 and reuse it in `bytes.Buffer.String()`, which still does the old `utf8.Valid` + decode two-pass (`runtime/bytes.ts:676`).

**L5. `BlockDOM2Tree`: constants and clone per text node.** `protyle.ts:528`: hoist `BytesFromString(" ")` (NBSP) and `BytesFromString(" ")` to module constants. `ReplaceAllOrNil` clones every text node even when the pattern is absent (Go semantics); keep the clone unless the differential test of S1 (section 3, S1 verification) is extended to cover "return the input when nothing is replaced". Expected: 1–2% of `SpinBlockDOM`/`BlockDOM2Md` (the anonymous walker at `78579` is 1.1–1.2% in `encode` alone) [profile]. Risk: none for the constants. Size: 3 lines. Mechanical: yes.

**L6. Whole-document `strings.ReplaceAll` chains.** `BlockDOM2Tree` (six on the input, `protyle.ts:444-450`), `Tree2BlockDOM` (419), `SpinBlockDOM` (111), `BlockDOM2Md` (333), `vditorDOM2Md` (209-213): `strings.ReplaceAll` is `split/join` and copies the string even when the pattern is absent. Add `if (s.indexOf(old) === -1) return s;` in `strings.ReplaceAll` (the result is the same string). Expected: 2–3% of `BlockDOM2Md` and `SpinBlockDOM` [profile: 3.1% + 0.6% + 0.4%]. Risk: none. Size: 1 line. Mechanical: yes.

**L7. Skip the `finalParseTableCellRich` walk when the document has no table.** `parse/table_rich.ts:333`: the walk visits every node (23k visits) to find table cells with the `table-cell-rich` attribute, which only `parse/table.ts` can set (159-170, 196-207; not gated by `KramdownSpanIAL`, by design). Count tables created in `parseTable0` on the `Context` and return early when zero. Expected: 3.5–4% on `MarkdownStr`/`FormatStr`/`Md2BlockDOM` for documents without tables, 0 otherwise [profile]. Risk: none if the flag is set wherever a table node is created (two sites). Size: 5 lines. Mechanical: yes.

**L8. `parseGFMAutoLink0`: one pre-scan instead of three `LastIndex` scans.** `parse/auto_link.ts:221-238` scans every text node three times for `://`, `http://`, `https://`, `ftp://` plus the `www.` check in the loop. Scan once for `:` and `w`; when neither occurs, return (the function can then only add nothing). Expected: 2–3% of `MarkdownStr` (self 4.0%) [profile]. Risk: low; the early return must match the existing control flow exactly (no `addPreviousText` happens when no protocol is found and `needUnlink` stays false). Size: 10 lines. Mechanical: yes, with care.

**L9. `DomText`/`IAL2Tokens` buffers.** `util/html.ts:274` and `parse/inline_attribute_list.ts:114` create a `bytes.Buffer` that grows 0→64→128→… per call. Start the buffer at 256 bytes (`new Buffer()` keeps `new Uint8Array(0)`; add a `Grow` call) or compute the final length first for `IAL2Tokens`. Expected: 2–4% of `HTML2Md` (`reserve` under `domText0` 4.6%), 2% of `BlockDOM2Md` [profile]. Risk: none. Size: 2 lines each. Mechanical: yes.

**L10. `bytes.Trim`/`TrimRight` with ASCII cutsets.** `runtime/bytes.ts` `Trim` family calls `inCutset(chars, r)` per byte; for the cutsets in use (`" \t\n"`, `"\n"`, `"#"`) a 128-entry lookup built once per distinct cutset string (a small `Map<string, Uint8Array>` cache) makes it a table lookup. Expected: 3% of `HTML2Md`, 1% elsewhere [profile]. Risk: none. Size: 20 lines. Mechanical: yes.

**L11. Renderer construction on tiny inputs.** 139 `bind` calls per renderer, 5–6 µs, created once per public call and again per callout title and rich table cell. Keep a per-class table of unbound prototype methods filled once (the factory still runs Go's registration order the first time) and have `Render`'s walker call `fn.call(r, n, entering)`; `ExtRendererFuncs` and `SetJSRenderers` unchanged. Expected: 4–5 µs per call, i.e. 10–15% of `MarkdownStr` on a 91-byte input, under 1% on 1 KB, nothing on the spec [measured fixed cost]. Risk: low; any renderer that mutates `RendererFuncs` per instance (search for `.RendererFuncs.set` outside factories) must keep an instance copy. Size: 5 factories (mechanical rewrite of 139 lines each) plus `Render`. Rank it after the above because keystroke paths spend most of their time elsewhere (`SpinBlockDOM` tiny: 299 µs, of which construction is about 12 µs).

### (b) Structural changes

**S1. Size-gated byte slices (replaces today's capacity scheme in `runtime/slices.ts` only).** Rules: an array of at most 64 bytes is never appended in place; the result of `Append`/`AppendByte`/`Make(len, cap ≤ 64)` is an exact-fit `new Uint8Array(n)` (on-heap, 25–30 ns, no ArrayBuffer ever created, no `.buffer` read). Arrays longer than 64 bytes keep today's semantics unchanged (capacity = buffer tail, in-place append when it fits, GopherJS growth policy). `Append(a, empty)` returns `a`. Prototype: `scratchpad/fable/slices-fast2.ts` (100 lines, all hashes identical across 132 corpus cases and the A/B runs). Expected: +11–13% on 1 KB inputs, 0–5% alone on the spec, +10% on the spec in combination with L3 [measured]; `SpinBlockDOM` +13% on 1 KB (28k growing single-byte appends per spec call become on-heap allocations). The large-input gain is limited because exact-fit copying replaces amortised growth for short strings; the net is positive because each copy is ≤ 64 bytes and no ArrayBuffer is created.
  - What changes semantically: spare-capacity aliasing is lost for bases of ≤ 64 bytes. The corpus differential shows no output effect at all (section 2.3). Two static sites must be handled explicitly: `parse/table.ts:159-170` (upstream item 30: the Go tree vectors record the corrupted span-IAL tokens; keep Go's bug with an explicit in-place write helper, `slices.AppendInPlaceLikeGo`, or patch it upstream and regenerate the vectors) and `parse/code_span.ts:73` (no output effect, but the tree vectors compare tokens; run `parse/tree.vectors.test.ts` first). `lex.Split`'s `CapAfterByteAppends` capacities become irrelevant; `splitElement` can allocate exact-fit (`Make(len)`) and lose nothing.
  - Verification: `npm test` (tree vectors, nilness vectors, oracle comparisons), the differential script in copy-always mode over the test corpora, the macro hashes. Size: `runtime/slices.ts` rewritten (100 lines), `slices.test.ts` adjusted for the capacity expectations, one or two parser sites. Mechanical: the runtime file yes; the two sites need judgement (one short brief each).
  - Do not combine with a WeakSet/WeakMap ownership marker (measured 0.58x) or with a `Uint8Array` subclass as marker (untested; adds a second hidden class to every token access site).

**S2. `Node`, second step: hot/cold split.** After L3 the node is about 700 bytes, 630 of them the 76 in-object fields; the constructor still executes 76 stores (8–10% self time). Keep the 14–16 hot fields (`Type, Parent, Previous, Next, FirstChild, LastChild, Tokens, Close, LastLineBlank, LastLineChecked, ID, KramdownIAL, ListData, HeadingLevel, IsFencedCodeBlock, CodeBlockFenceLen`) in the object and move the rest behind prototype accessors over a lazily created `ext` object that returns Go zero values; no call site changes (`n.TextMarkAHref` keeps working). The 14-field object costs 137 bytes and allocates 3–4x faster than the 76-field one [measured]. Expected: another 5–8% on `MarkdownStr`/`Md2BlockDOM` [reasoned from the constructor's 8–10% self time and the measured allocation ratio], less on DOM paths. Risks: an accessor on a field read in a hot loop (`HtmlBlockType`, `CodeBlockInfo`, `TableCellAlign` in renderers) costs a call unless V8 inlines it; the choice of hot fields must come from a field-access count on the profiles (`--cpu-prof` with `callers.mjs`, or a one-off instrumented `Node` with counting accessors over the test suite). `copyNode` in `parse/table_rich.ts` and `SetJSRenderers` consumers see the same property names. Size: `ast/node.ts` only (about 150 lines of accessors). Mechanical: yes once the hot list is fixed. Measure after L3 and S1; stop if under 5%.

**S3. DOM→AST converters (`HTML2Md`, `BlockDOM2Md`, `SpinBlockDOM`).** After L4–L6 and L9–L10 the remaining cost is the HTML tokenizer (`Token()` building a `Token` with string `Data`/`Attr` per tag, `atom.Lookup`, `lower()` copies; about 15% of `BlockDOM2Md`) and `genASTByBlockDOM`/`genASTContenteditable` converting those strings back to bytes. The Go design (string-typed `html.Node`) forces the round trip; a byte-native `html.Node.Data` would change `util.DomAttrValue`, `DomText`, and 200+ call sites and is not worth it. Expected remaining gain from the local items on these paths: 15–25% combined. No further structural change recommended here.

### (c) Examined and rejected

- **Renderer output as strings / string builder / `encodeInto`.** Finding A3 stands: renderers read and edit the buffer (`Bytes()` ×28, `Truncate`, `Reset`, `NodeWriterStack` swaps, `LastOut`); and the measured cost of `WriteString` is the byte writing itself (`charCodeAt` loop 16 ms per 800k writes against `encodeInto` 144 ms in the earlier run; wave 1 showed the attribute pieces cost the same whether concatenated or not).
- **WeakSet-owned capacity (`slices-fast.ts`).** 0.58x on the spec [measured].
- **Slab/arena allocator with one buffer per parse.** Capacity would have to come from a side table (the buffer tail is the next allocation), views keep the whole slab alive after a tree escapes (`Md2BlockDOMTree`), and S1 removes most of the ArrayBuffer cost without any of this.
- **`{buffer, offset, length, cap}` slice struct.** 7–11 ns per allocation [measured] but every byte read in 68k lines becomes `s.arr[s.off + i]`; a complete rewrite of the port.
- **Renderer dispatch array instead of `Map` and unbound methods for the spec input.** `Map.get` 11.6 ns against `array[i]` 7.3 ns, two lookups per visit, 23k visits: about 0.2 ms per spec render (<1%). Only the construction cost matters (L11).
- **`const enum` / switch jump tables / esbuild settings.** Already settled by the A4 spike; the bundle inlines the constants, has no class-field helpers and no deopt loops [measured].
- **Node pooling.** Trees escape to callers and to `SetJSRenderers`.
- **Pre-encoded literal byte constants in renderers.** Measured marginal in the A3 run; `WriteString` of short literals is already a tight loop.
- **Caching `Lute.New()`/options.** 2.4 µs per `New`; engines are reused by the editors.
- **`headingID0` walk.** It runs once per document (first heading), 2.8% self time of `MarkdownStr`, dominated by `Text()` per heading; not quadratic, leave it.

## 4. Order of work and where to stop

1. **L3** (slim `Node` without layout change): one file, +10–15% everywhere, lowest risk. Measure with `bench:macro` against the previous bundle (`LUTE_BENCH_REF`), 5 rounds.
2. **L1 + L2** (SV renderer close, self-copy removal): `Md2VditorSVDOM` 2x; record both as upstream performance bugs in `tasks/002-upstream-bugs.md`.
3. **S1** (size-gated slices) with the two parser sites handled; run the tree vectors first, then `npm test`, then the differential script.
4. **L4, L6, L9, L10, L5** (DOM-path string/bytes items): `HTML2Md` and `BlockDOM2Md` 15–25% together.
5. **L7, L8** (table walk gate, autolink pre-scan): 5–7% on `MarkdownStr`/`FormatStr`.
6. **S2** (hot/cold split) only if the profile after 1–5 still shows the constructor above 5%.
7. **L11** last, for keystroke-sized inputs.

Expected end state, from the measured items only: `MarkdownStr` spec about 1.3–1.4x faster than today (L3 + S1 measured 1.26x, L7 + L8 + GC reduction on top), 1 KB about 1.3x; `Md2VditorSVDOM` 2–2.5x; `HTML2Md`/`BlockDOM2Md` 1.3–1.5x; `SpinBlockDOM` 1.2–1.3x. Beyond that the profile is flat (parser control flow, walks, the renderer writing bytes) and further gains need the Go-level algorithmic work on the editor paths (four passes per `SpinBlockDOM`), which is outside a 1:1 port. Stop after step 6 unless a new profile shows a single function above 5%.

## 5. What was not determined

- Absolute gains on the shipped bundle: the A/B ran on the unbundled sources; the ratios should carry over but the bundle must be measured with `bench:macro`.
- The field-access frequency needed for S2's hot list (needs an instrumented `Node` over the test suite; not run).
- `TextEncoder` output for strings over 64 bytes: whether Node allocates it on-heap or through a separate backing store was not tested; L4 only covers short ASCII strings.
- The share of `strings.ReplaceAll` that is absent-pattern versus present-pattern on real editor inputs (L6 assumes mostly absent, which the block DOM of the spec confirms, since five of the six patterns are `\n<wbr>\n</x>`).
- Heap-sampling allocation profile by call site (`--heap-prof`) was not run; the instrumented counts and the CPU caller attribution were used instead.
- Timings of items L5–L10 are read from profiles, not measured in isolation.
