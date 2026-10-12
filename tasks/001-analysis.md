# 001 — Analysis: porting Lute from Go to TypeScript (1:1)

Status as of 2026-10-10. Analysis done on commit `8e7896b6` (branch `master`).

## Goal

Rewrite Lute from Go to TypeScript "as is", 1:1: file by file, same names, same logic, no redesign. The result must be a drop-in replacement for `javascript/lute.min.js` (the GopherJS build) and must be very fast.

## Decisions made

| Topic | Decision |
|---|---|
| Language | TypeScript, `strict` mode |
| Type checking, `.d.ts`, ESM output | `tsc` from TypeScript 7 (the native compiler, formerly `tsgo`) |
| Transpile and bundle (`lute.min.js` as IIFE) | `esbuild` |
| Runtime for scripts and tests | Node 24, tests on `node:test`, `.ts` files run directly |
| Bun, gulp | not used |
| Go `[]byte` | `Uint8Array` |
| Go `string` | native TS `string` (option A) + audit of places counted in bytes |
| Departing from 1:1 for performance | allowed in hot paths, but only after measurement |
| Verification | byte-for-byte comparison against `javascript/lute.min.js` |
| Code location | `ts/` directory in this repo (`javascript/` is taken by the GopherJS build) |
| `NodeType` | numeric constants (`export const NodeText = 16`, `type NodeType = number`) used through `import * as ast`, so code reads `ast.NodeText` as in Go; a separate name table backs `NodeType.String()` |

The tool split mirrors the VS Code build (TypeScript 7 + esbuild + Node).

### Open

- **Which oracle to verify against:** the committed `javascript/lute.min.js` (one commit behind the pin) or the rebuilt bundle below. Not decided.
- **How upstream builds its bundle:** unknown. GopherJS 1.21 cannot build a module that declares `go 1.26`, yet upstream ships a bundle from such a module.

Resolved since the first draft:

- **Oracle rebuild works (2026-10-10).** The committed bundle embeds `go1.21.13`. GopherJS v1.21.0 (the newest release, requires Go 1.21.x) builds the current source, but only from a copy of the repo whose `go.mod` says `go 1.21` instead of `go 1.26`, and only when `gopherjs.exe` itself was built with Go 1.21.13. Output: `C:\Users\SlawomirPiochacz\lute-oracle-build\lute.head.min.js` (outside the repo).
  - Checked independently: both bundles report version 1.7.6 and 152 methods, and give identical `MarkdownStr` output on all 652 CommonMark cases. They differ on image-title input, as the one missing commit intends.
  - Not audited: whether lowering the `go` directive changes behaviour elsewhere (it changes language semantics such as loop variables).
  - Command: in the copy's `javascript/` directory, with `GOTOOLCHAIN=local`, `GOPHERJS_GOROOT=C:\Users\SlawomirPiochacz\sdk\go1.21.13`, `GOOS=js`, `GOARCH=ecmascript`: `gopherjs build --tags javascript -o lute.head.min.js -m`.
- **Unicode version to match: 15.0.0.** The oracle is built with Go 1.21.13, so the port's Unicode tables are generated with that SDK, not with the system Go 1.27 (Unicode 17.0.0).
- The system Node on PATH is now v24.20.0, so plain `node` runs `.ts` files directly.
- Go 1.27.0 is installed (`C:\Program Files\Go\bin`), `unicode.Version` 17.0.0. The CommonMark and GFM spec tests pass with it, so the Go test suite is a second source of expected values next to the oracle, and Unicode tables can be generated from Go.

## Scope

About 56k lines of Go, excluding tests.

| Package | LOC | Notes |
|---|---|---|
| `render` | 21,300 | 14 renderers; 13 embed `*BaseRenderer`, `TextBundleRenderer` embeds `*FormatRenderer` |
| `parse` | 13,750 | includes `emoji_map.go` (2,165 lines of data) |
| root (`lute.go`, `h2m.go`, `protyle.go`, `vditor_*.go`) | 9,060 | 152 public methods on `*Lute` |
| `html` + `html/atom` | 8,480 | fork of `x/net/html`; tokenizer with 41 `goto`; `entity.go` is 2,140 lines of data |
| `ast` | 1,760 | a single `Node` struct for all 164 node types |
| `util`, `lex`, `editor` | 1,500 | leaves of the dependency graph |
| tests (`test/`) | 10,600 | 110 files, about 2,250 table-driven cases + 652 CommonMark cases |

Out of scope: `benchmark/`, `pprof/`, `chroma-styles/` (CSS generator), `javascript/main.go` (replaced by a native entry point).

### The `javascript` build variant

We port the files tagged `javascript`, i.e. exactly what ships in `lute.min.js` today:

- `render/code_block_html_renderjs.go` instead of `code_block_html_render.go`: no syntax highlighting, so the `chroma` dependency is gone.
- `parse/linkrefdef_case_foldjs.go`: `foldBytes` is a no-op, so `x/text/cases` is gone.
- `util/byte_strjs.go`: plain conversions instead of `unsafe`.
- `util/panicjs.go`: `RecoverPanic` is empty, so a panic propagates as an exception.

What remains is `x/text/width` in `render/space.go` (`EastAsianWide`, `EastAsianFullwidth`), to be replaced with a range table.

## Oracle

`javascript/lute.min.js` runs under Node (verified on v20): it sets `globalThis.Lute`, `Lute.Version` is `1.7.6`, and the object returned by `Lute.New()` has 153 methods.

- Last rebuilt at `f47ad925`, which is one Go commit behind HEAD (`8e7896b6`). Differences from that commit will show up in comparisons until the oracle is rebuilt.
- Random node IDs (`ast.NewNodeID`, format `20060102150405-xxxxxxx`) must be normalized before comparing.

## Translation rules

- **File layout:** `parse/inline.go` → `parse/inline.ts`. Same function and field names (`n.FirstChild`, `n.Tokens`), same declaration order. Comments are kept in place but translated from Chinese to English; issue links in them stay unchanged.
- **"Go runtime" layer:** modules `bytes`, `strings`, `utf8`, `unicode`, `strconv` with Go semantics, so that translated code reads line by line like the original. About 110 functions are actually used. Most frequent: `strings.ReplaceAll` (292), `bytes.ReplaceAll` (164), `strings.TrimSpace` (139), `strings.Contains` (117), `bytes.HasPrefix` (81), `bytes.Buffer` (73).
- **`[]byte` → `Uint8Array`:** `subarray` gives the same aliasing as a Go slice. `append` becomes a helper function, `bytes.Buffer` a custom class with a growing buffer.
- **Embedding → `class extends`:** methods registered in `RendererFuncs` (`ret.RendererFuncs[ast.NodeDocument] = ret.renderDocument`) need `bind`.
- **`defer` → `try/finally`:** 114 occurrences, 90 of which are `defer tree.Context.ParentTip()`.
- **`goto` → loop with a `switch` on state:** only `html/token.go`.
- **Named results:** 816 bare `return` statements → `let ret; … return ret`.
- **Multiple return values:** about 60 functions → tuples.
- **Mutexes:** 4 uses of `sync`, to be removed (JS is single-threaded).
- **Pointers:** `Parent`, `Next`, `FirstChild` etc. as `Node | null`. With `strictNullChecks` there will be many `!` assertions where Go assumes the pointer exists. This is the only systematic deviation from "line by line".
- **`SetJSRenderers`:** objects come from outside, so types are checked at runtime, as in Go.

## Semantic pitfalls

1. **Byte strings vs UTF-16.** `len(s)`, `s[i]`, `s[a:b]`, `for i, r := range s` and offsets from `strings.Index` give different values for non-ASCII text (`żółw`: 7 in Go, 4 in TS; `😀`: 4 in Go, 2 in TS). The code has about 1,100 `string` ↔ `[]byte` conversions. Under option A, sensitive places get byte-counting helpers. Pure-ASCII strings are safe, e.g. `id[:14]` on a node ID.
2. **Invalid UTF-8.** Go's `string(bytes)` keeps invalid bytes, `TextDecoder` replaces them with U+FFFD. To be checked by fuzzing.
3. **Embedding has no virtual dispatch.** In Go, a `BaseRenderer` method calling `r.X()` always reaches the base version; in TS `this.X()` reaches the override. All shadowed methods must be reviewed and the base version called explicitly where needed.
4. **No panic on out-of-range access.** Go panics, JS returns `undefined` and keeps going. Bounds-checked accessors are needed during tests and fuzzing.
5. **Unicode tables.** `unicode.IsLetter`, `IsPunct`, `IsSymbol`, `IsSpace`, `IsDigit`, `IsPrint`, `IsControl`, `SimpleFold`, `Han`, `Hiragana`, `Katakana`, `Hangul`, `Zs`, `Lm`. The Unicode version in Go and in the JS engine may differ, so generating tables from Go is safer than relying on `\p{…}`.
6. **`encoding/json`** (`render/json_renderer.go`, `ast/table_rich.go`). Go keeps struct field order, applies `omitempty`, encodes `[]byte` as base64 and escapes `<>&` as `<`. A custom serializer for `Node` is needed.
7. **`url.Parse`** (`ast/node.go`) behaves differently from the WHATWG `URL`. The used subset must be ported.
8. **Sorting.** `sort.Strings` sorts by bytes, the default JS sort by UTF-16 code units.
9. **Arithmetic.** Integer division (7 places) needs `Math.trunc`. The hash in `html/atom` works on `uint32` (`Math.imul`, `>>> 0`). `byte` variables do not wrap modulo 256 on their own.
10. **`nil` vs empty slice.** The code distinguishes `nil == ret` from `0 < len(x)`. Convention: `nil` → `null`, and `len` as a `null`-safe function.
11. **Map iteration.** Random order in Go, insertion order in JS. Code that depends on order would already be nondeterministic today, but keep it in mind when diffing against the oracle.

## Performance

Assumption: the port alone should be clearly faster than the GopherJS build (emulated slices, bounds checks, 4.3 MB of code), but no numbers are assumed without measurement.

### To be settled by measurement in phase 0

- **`[]byte` sub-slices.** A Go slice is three words on the stack; `subarray` allocates a new object, and the lexer does it for every line and the parser for every node. Alternative: pass an offset pair instead of a slice. That departs from 1:1 and touches the whole codebase, so the decision must be made before phase 1.
  - Measurement: the lexer (`lex/lexer.go`, `NextLine`) and the hot loop of the block parser in both variants, on `benchmark/commonmark-spec.md`.
  - If the difference is small, `subarray` and pure 1:1 stay.
- **`string` ↔ bytes conversions.** Free in Go, a copy plus decode in JS. To measure: `TextDecoder` versus a hand-written ASCII path for short fragments.

### Rules adopted up front

- Constants like `[]byte("<p>")` computed once at module level.
- The renderer writes into one growing byte buffer; decoding to a string happens once, at the end.
- `Node` with a fixed shape: all fields initialized in the constructor in the same order, no fields added later.
- `NodeType` as numeric constants accessed through `import * as ast` (decided after the A4 spike); the renderer function table indexed by type instead of a `Map`.
- Unicode tables: ASCII fast path, binary search in a `Uint32Array` for the rest.
- Emoji map and HTML entities built lazily, on first use (startup time).
- No allocations in hot loops: no closures, temporary arrays, or character-by-character string concatenation.

### Process

- Benchmark from phase 0: the port versus `lute.min.js` on the same input; after phase 3, on every API path.
- Byte-for-byte parity first, optimization second. The oracle guards against regressions.
- Optimizations go into the runtime layer where possible, so translated code stays 1:1.
- Hot spots come from a profile (`node --cpu-prof`), not from guesses.
- Every departure from 1:1 is documented in the code with the measurement that justified it.

## Performance research findings

Added 2026-10-10 from a read-only research pass over the Go source. Nothing here is implemented yet.

Provenance labels used below:

- **[code]** verified by reading the Go source at the given file and line.
- **[run]** measured once with `node -e` on Node v24.14.1 on this machine. Indicative only, not a benchmark suite, and not independently repeated.
- **[web]** confirmed from a linked source.
- **[infer]** inference, not verified.
- **[unverified]** recalled V8 or tooling behaviour that was not confirmed.

### Baseline

Oracle `javascript/lute.min.js` on `benchmark/commonmark-spec.md` (212,366 bytes, 9,703 lines) [run]:

| Path | Oracle time |
|---|---|
| `MarkdownStr` | 125 ms min, 157 ms median |
| `Md2BlockDOM` | 524 ms median |
| Whole-document `TextEncoder` + `TextDecoder` round trip | 1.9 ms |

The whole-document conversion at the API boundary is noise. Per-fragment conversions and per-node allocation are what matter.

### A. Hard-to-reverse decisions (before phase 1)

#### A1. Slice capacity semantics of `append`

This is a correctness issue as well as a speed issue.

- **Problem:** `Uint8Array` has no capacity. Go code relies on `append` writing in place into a backing array shared with other slices.
- **Evidence [code]:**
  - `parse/code_span.go:128`: `ctx.tokens = append(ctx.tokens[:x], ctx.tokens[y:]...)` deletes in place inside the paragraph buffer that already-created Text nodes alias.
  - `parse/table.go:254,285`, `parse/link.go:340`, `parse/inline_html.go:761`, `lex/token.go:417-439` (`EscapeCommonMarkers`).
  - `ast/node.go:505,515`: `tmp := n.KramdownIAL[:0]` filters in place.
  - `parse/auto_link.go:660-666`: `addPreviousText` appends to a Text node whose `Tokens` is a sub-slice of the sibling's buffer.
  - `parse/text.go:32`: every Text node is `ctx.tokens[start:pos]`, so in Go its capacity runs to the end of the paragraph buffer.
- **Scale:** 8 "append onto a reslice" sites; about 70 single-byte appends (`parse/inline_html.go` 21, `html/escape_encode.go` 7, `parse/auto_link.go` 6, `lex/token.go:135,156,246,262`, `parse/heading.go:136-144`). A copy-always helper gives different bytes at the first group and is O(n²) at the second.
- **Decision:** one `append(a, b)` in the shim that writes in place when `a.byteOffset + a.length + b.length <= a.buffer.byteLength` and returns a new view over the same buffer; otherwise it grows geometrically.
  - Every allocation must own its own `ArrayBuffer`, so no arenas or pooled buffers for token data.
  - This is one more reason to keep `subarray`: a view carries its capacity for free.
- **Open risk [unverified]:** the oracle is GopherJS, whose growth policy and `[]byte(string)` capacity may differ from gc Go. Aliasing edge cases must match GopherJS.
- **Departure from 1:1:** none in translated code; it lives in the shim.

#### A2. `Node` construction and layout

- **Evidence [code]:** `ast/node.go:30-155` has 66 fields. Of 707 `&ast.Node{…}` literals, 410 are `{Type, Tokens}` and 236 are `{Type}`, so 91% fit `new Node(type, tokens = null)`. Sites by package: parse 233, root 458, render 16.
- **Evidence [run]:** allocating 100k linked nodes took 11.3 ms with a 66-field class and 1.7 ms with a 12-field class.
- **Decision 1 (irreversible):** a positional constructor `new Node(type, tokens)` plus plain assignments for the remaining 9% of sites. Never an options-object literal, never spread, `Object.assign` or `Object.keys` on a node.
- **Decision 2 (reversible, to be measured):** hot/cold split. About 14 hot fields stay in the object; the rest move to a lazily created `ext` object behind prototype accessors that return Go zero values, so call sites still read `n.TextMarkAHref`.
  - Hot: `Type, Parent, Previous, Next, FirstChild, LastChild, Tokens, Close, LastLineBlank, LastLineChecked, KramdownIAL, ID, ListData, HeadingLevel`.
  - Cold: the `TextMark*`, `Callout*`, `Tab*`, `Table*` and `CodeBlock*` groups, plus `Box, Path, Spec, TypeStr, Data, Children, Properties`.
- **Field representation [infer]:** initialize numeric fields with `0`, references with `null`, strings with `""`, booleans with `false`, and never let `undefined` in. An out-of-range typed-array read yields `undefined`, which is another reason for bounds-checked accessors in debug builds.
- **Do not pool nodes:** trees are returned to callers (`Md2BlockDOMTree`, `protyle.go:189`) and exposed to user code through `SetJSRenderers`.
- **Departure from 1:1:** call sites unchanged; only `ast/node.ts` differs.

#### A3. Output buffer and `WriteString`

- **Evidence [code]:** `render/` has 828 `WriteString`, 438 `Write`, 334 `WriteByte` and 1,116 `Tag(` calls; 634 of the `WriteString` calls take a literal.
- **A string or rope output is ruled out [code]:** renderers read and edit the buffer. `Writer.Bytes()` ×28, `Truncate` ×8, `Reset` ×15, 38 `r.Writer = …` swaps through `NodeWriterStack` (`render/format_renderer.go:875-896, 1403, 1775-1814, 1873-1960`), and `LastOut` is a byte (`render/renderer.go:441-468`).
- **Evidence [run]:** 800k short literal writes:

  | Method | Time |
  |---|---|
  | `charCodeAt` loop into `Uint8Array` | 16 ms |
  | Pre-encoded `set()` | 14 ms |
  | Pre-encoded manual byte loop | 31 ms |
  | String `+=` | 30 ms |
  | `TextEncoder.encodeInto` per call | 144 ms |

- **Decision:**
  - `WriteString` is an inline `charCodeAt` loop that bails out to `encodeInto` on the first char >= 0x80.
  - `LastOut` after a non-ASCII string must be the last UTF-8 byte, not `charCodeAt(len - 1)`.
  - The 634 literals stay inline. Pre-encoding them gains too little to justify hurting readability. This narrows the earlier "module-level byte constants" rule to `[]byte("…")` literals used as byte values (472 sites: parse 169, render 138, root 156), which needs a lint or codemod rather than hand discipline.
  - The buffer class needs `Bytes()` as a view, `Truncate`, `Reset` and cheap construction, because format and export renderers create one per list item, blockquote or footnote. Start small or pool them; `Grow(4096)` at `renderer.go:403,411` is only for the root.
  - Grow by reallocate-and-`set` with doubling. Do not use resizable `ArrayBuffer` [unverified that it is slower].

#### A4. `NodeType`: `const enum` versus running `.ts` in Node

- **Evidence [web]:** Node's type stripping rejects `enum` (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) unless `--experimental-transform-types` is passed. esbuild inlines enum values across modules when bundling.
- **Why inlining matters [unverified]:** V8 builds a jump table for a `switch` only when case labels are small-integer literals. `ast/node.go` has long case lists: `IsBlock` (30 cases, `:948`), `IsMarker` (39, `:970`), `CanContain` (`:1008`), `Marker` (`:328`); also `parse/parse.go:278` and `parse/blocks.go:296`. Confirm with `node --print-bytecode --print-bytecode-filter=IsBlock`.
- **Options:**
  - (a) plain `enum` in one file, tests run with `--experimental-transform-types`, esbuild inlines in the bundle;
  - (b) `export const NodeText = 16` plus `type NodeType = number`, which is erasable, relying on esbuild to inline across modules [unverified; check the bundle for `NodeText`].
- **Related [code]:** `NodeType` values are sparse (0–601, `NodeTypeMaxVal = 1024`, `ast/node.go:1062-1296`). A dispatch array must be pre-filled to length 1024 with a default function, or it becomes a holey array.

**Spike result (2026-10-10, esbuild 0.28.2, Node v24.20.0).** A throwaway spike generated the 143 real `NodeType` constants plus `IsBlock` (30 cases) and `IsContainerBlock` (12 cases) in four variants: (a) `enum`, (b) numeric constants with `import * as ast`, (b2) numeric constants with named imports, and hand-written literals. The spike lived in a temporary directory and is not in the repo.

- **Option (b) inlines, but only with syntax minification.** With `--minify-syntax` or `--minify`, esbuild replaces `ast.NodeText` with the literal across modules and drops the declarations; the output is the same as for the enum. Without minification the constants stay as `var NodeDocument = 0` in the bundle's single scope. Unused constants are tree-shaken either way.
- **The jump-table rationale does not hold for these switches.** V8 emitted 30 `TestEqualStrict` comparisons and no `SwitchOnSmiNoFeedback` for `IsBlock` in every variant, including hand-written literals. A control switch over dense cases 0–19 did get a jump table, so the cause is the sparse values (143 constants spread over 0–1024 in 34 contiguous runs), not the way they are written.
- **No measurable speed difference between variants in a bundle.** Two predicates over 1M types, best median of 5 interleaved runs: literals 13.3 ms, enum 10.6–13.9 ms, (b) not inlined 13.4 ms, (b) inlined 11.2–13.5 ms. Results were bimodal (about 10.5 or 13.4 ms) for every variant, so the differences are noise.
- **Unbundled `.ts` under plain `node`:** (b) 18.4 ms, (b2) 25.7 ms; the enum fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` and takes 16.0 ms with `--experimental-transform-types`. This affects test runs only.
- **Conclusion:** the choice between (a) and (b) does not affect the speed of the shipped bundle. Option (b) with a namespace import works without the experimental flag and reads like the Go source. The limit of this spike is that it measured two predicates in isolation, not the parser.
- **Decision:** option (b) with `import * as ast`, confirmed by the user on 2026-10-10.

#### A5. Tuple returns

- **Evidence [code]:** 62 multi-return functions (parse 37, html 11, util 6, lex 5). Hot ones return 3–5 slices: `lex.Trim` (`lex/token.go:205`), `TrimLeft`/`TrimRight` (`:235,251`), `Spnl` (`:359`), the link parsers (`parse/inline_link.go:23,98`, `parse/link.go:300`), and `TagAttr` with 5 values (`parse/inline_html.go:434`).
- **Wasted work [code]:** `TrimLeft`/`TrimRight` build `whitespaces` byte by byte and most callers discard it (`parse/heading.go:137-138`, `parse/paragraph.go:31-33`).
- **Decision:** tuples stay the default translation. Add single-result siblings in `lex` and use them where the Go discards a result with `_`. Document the rule once.

#### A6. HTML tokenizer without `io.Reader` emulation

- **Evidence [code]:** `html/token.go:238-288` refills in 4096-byte chunks, compacts and rebases spans, yet every caller passes an in-memory reader (`util/html.go:23`, `parse/inline_html.go:167,252`, `render/sanitizer.go:56`, `parse/html_text_style_inline.go:34`).
- **Decision:** hand the tokenizer the whole `Uint8Array` at construction, making the refill branch dead code. The tokenizer stays on bytes; `atom.Lookup` hashes bytes directly (`html/atom/atom.go:57-69`).
- **Remaining cost:** `Token()` at `html/token.go:1171-1190` decodes a string for every text token and attribute value. This is the main consumer of the small-decode fast path on the Protyle paths.

#### A7. "Prefix at offset" helpers in the shim

- **Evidence [code]:** 22 calls of `bytes.X(tokens[i:], …)`, 19 in `parse`. Hot: `parse/delimiter.go:356` (once per delimiter char), `parse/text.go:26` and `parse/inline.go:28` (once per text byte with `FullWidthStrikethrough`), `parse/auto_link.go:250`.
- **Evidence [run]:** a `subarray` costs about 40–50 ns, the comparison it feeds about 1 ns.
- **Decision:** `bytes.HasPrefixAt(s, off, prefix)` and `IndexByteFrom`; translate `X(s[i:], p)` to `XAt(s, i, p)` mechanically.
- **Shim hygiene [infer]:** keep `bytes.*` and `strings.*` strictly separate, never accept `string | Uint8Array` in one helper, never pass `null` to a hot helper.

#### Sub-slice representation: resolved direction

`subarray` stays the global representation [run]: about 40–50 ns per view, i.e. 9.7k lines in 0.8 ms versus 0.3 ms with offsets, and 30k words in 2.1 ms versus 0.9 ms. That is well under 1% of the oracle's `MarkdownStr` time, and A1 needs views anyway. Offsets are used only in per-byte loops (A7). The phase 0 measurement is still required to confirm this on real code.

### B. Hot-path patterns

Ranked by expected effect on `MarkdownStr`. All effects are estimates until profiled on the 1:1 port.

1. **Per-node one-byte slices [code].** `parse/delimiter.go:46`, `parse/inline.go:105,162`, `parse/text.go:58,72,94,124`, `parse/blockquote.go:32`; 70 `[]byte{…}` literals in total. Alternative: a module-level table of 256 one-byte arrays behind `bytesOf(b)`, safe only because A1's `append` reallocates when capacity is 1.
2. **`isMarker` per text byte [code].** `parse/text.go:24-43` runs a 16-case switch (`lex/token.go:459-467`) plus an option load per byte. Alternative: a 256-entry lookup table; same for `IsASCIIPunct`, `IsWhitespace`, `IsASCIILetterNum` (`lex/token.go:55-110`) if profiling shows them.
3. **`mergeText` copies, then emoji copies again [code].** `parse/text.go:140-170`, `parse/emoji.go:43-131`, and autolink passes rescan every text node with three `bytes.LastIndex` scans (`parse/auto_link.go:179-190`). Keep 1:1; rely on geometric growth in `append`.
4. **Renderer dispatch [code].** `render/renderer.go:413-429` does two map lookups per visit, on enter and on leave; each renderer registers about 150 method values. Alternative: pre-filled array, unbound prototype methods called as `fn.call(r, n, entering)`, and a `hasExt` boolean to skip the extension lookup. This matters because `NewHtmlRenderer` is also created per callout title (`render/html_renderer.go:207-217`) and per rich table cell.
5. **`r.Write(html.EscapeHTML(tokens))` [code].** 155 `html.EscapeHTML(` calls. `html/escape_encode.go:56-101` already returns the input unchanged when nothing needs escaping. A `WriteEscaped` method is possible; measure first.
6. **`Tag()` attributes [code].** `render/renderer.go:694` concatenates five strings per attribute; `attrs = append(attrs, node.KramdownIAL...)` runs even when both are nil (`render/html_renderer.go:1232,1458,1473`). `append` must return the same empty value for two empty operands; `Tag` should write the pieces separately.
7. **`KramdownIAL` escape and unescape on every access [code].** Likely dominant on `Md2BlockDOM` and `SpinBlockDOM`. `ast/node.go:524-541`: `SetIALAttr` escapes (string → bytes → escape → string plus three `ReplaceAll`), `IALAttr` unescapes on every read. 73 `IALAttr` and 72 `SetIALAttr` call sites; `finalParseBlockIAL` (`parse/parse.go:53-104`) calls them two or three times per block. Alternative: a string-native fast path in `EscapeAttrVal`/`UnescapeAttrVal` that scans once and returns the input unchanged; IDs and timestamps never need escaping.
8. **`TextMarkType` string scans [code].** `ast/node.go:411-431` splits the string on every call; 48 call sites. Alternative: split-free word scan. Protyle paths only.
9. **`ParentIs` variadic [code].** `ast/node.go:930-945` allocates per call; 79 calls, mostly with one type. Alternative: single-type fast path.
10. **Closure walkers [code].** 71 `Walk(…, func…)` sites. Per-document ones are harmless. Per-node ones matter: `Text()` (`ast/node.go:613-628`) is called per heading, per code span under AutoSpace, and per tag delimiter. Recursive `walk` is fine in V8; keep it.
11. **Block-start probing [code].** `parse/blocks.go:153-172` tries 18 functions in order; several slice or allocate before rejecting (`parse/heading.go:101-110,136-144`, `parse/tabs.go:23`, `parse/callout.go:39`). No structural change; A5 and A7 reduce it to one view per candidate line.
12. **Lexer [code][run].** `lex/lexer.go:23-31` copies the whole input when it lacks a trailing newline, so encode into a buffer with one spare byte. The lexer mutates its input (CR → LF, `:49`), so the buffer must be private. The manual `NextLine` loop beat `indexOf(10)` plus `subarray` (0.8 ms versus 1.6 ms); keep the Go loop.
13. **`defer` [code].** 114 total, 107 in root files, none in parse or render hot loops. 90 are `defer tree.Context.ParentTip()` in the HTML → AST converters, once per DOM node. `try/finally` cost should be small [unverified]; measure only on `SpinBlockDOM`.
14. **Per-delimiter string creation in editor modes [code].** `parse/delimiter.go:374,419,422` builds a string to compare with the caret; compare code points instead.
15. **`openersBottom [128]*delimiter` [code].** `parse/delimiter.go:94` zeroes 128 slots per `processEmphasis` call and uses 6 (`:97-102`).

### C. V8 and runtime techniques

1. **Small-buffer decode [run][web].** 30,541 word-sized decodes: `TextDecoder` 4.1 ms, manual ASCII loop with `TextDecoder` fallback 2.7 ms. Use the manual loop below a length threshold (about 32–64 bytes, to be tuned) and fall back on any byte >= 0x80, which also keeps invalid-UTF-8 behaviour consistent.
2. **Options objects [code][infer].** `parse.Options` has about 55 fields and `t.Context.ParseOption.X` appears 231 times. Build it as a class with every field initialized in the constructor so setters never change its shape.
3. **`Map` for Go maps keyed by string [infer].** `linkRefDefs`, emoji and entity tables, `idOccurs`, the TLD set. Large object-literal dictionaries degrade and have prototype-key hazards (`constructor`, `__proto__`).
4. **Typed-array writes [run].** `set()` beat a manual byte loop for payloads of 3–28 bytes (14 ms versus 31 ms per 800k writes). For 1–2 bytes a direct store is likely better; tune a threshold in the buffer class.
5. **Renderer monomorphism [infer].** 13 renderers extend `BaseRenderer`, so shared methods see many receiver shapes in a long-lived process. Keep buffer state in a separate buffer object with one shape, and declare base fields in the same order in every renderer.
6. **Explicit base calls [infer].** Where Go embedding requires the base version (pitfall 3), call it as `BaseRenderer.prototype.X.call(this, …)` or a free function; that call is direct and inlinable.
7. **String building in loops [code].** `render/space.go:28-44` appends one rune at a time and inspects the end of the growing string; same shape in `SubStr` (`render/renderer.go:566-578`) and `lex.RepeatBackslashBeforePipe` (`lex/token.go:392-415`). Port with explicit last-rune tracking if AutoSpace profiles as hot.

### D. Build and startup

1. **Large tables as lazily parsed strings [code][unverified].** `parse/emoji_map.go` is 121 KB, `html/entity.go` 104 KB, plus the TLD list and `html/atom/table.go` (29 KB). Encode each as one delimiter-separated string literal decoded into a `Map` on first use.
   - Laziness is currently defeated [code]: `parse.NewOptions()` stores the emoji maps into every options object (`parse/parse.go:504-505`), the TLD set is a package-level initializer (`parse/auto_link.go:677`), and `IsEmoji` iterates the whole map (`parse/emoji_map.go:26-33`).
   - To be lazy, the emoji map must be a getter or resolved at the lookup site (`parse/emoji.go:87`), and the TLD set built inside `isValidDomain` (`parse/auto_link.go:465`). APIs that mutate the map must force materialization.
2. **Tree-shaking [code][infer].** `lute.ts` references every renderer from one class, so nothing shakes out of the IIFE bundle. Do not split unless startup profiling says so; keep module-level side effects (`strNodeTypeMap`, `ast/node.go:311-317`) behind lazy functions.
3. **esbuild settings [unverified].** Whitespace and syntax minification are safe. Property mangling must stay off because public API names and `Node` fields are visible to `SetJSRenderers`. Target `es2022`. Use constructor assignments rather than class field declarations, and check the bundle for `__publicField`.
4. **Benchmark the shipped artifact.** Unbundled `.ts` (no enum inlining, live ESM bindings) can rank alternatives differently from the IIFE bundle. Acceptance numbers come from the bundle; unbundled runs are for profile attribution only.

### E. Measurement plan

Harness: Node 24, 20 warm-up runs, median of at least 30, `--expose-gc` with `gc()` between variants, `--trace-gc` scavenge counts, `--cpu-prof` for attribution.

Inputs:

- `benchmark/commonmark-spec.md`: mixed content.
- `test/commonmark-spec-kramdown.md`: IAL-heavy, for Protyle paths.
- `test/format-case*.md`: format renderer.
- `test/gfm-spec.md`: tables and autolinks.
- Synthetic stress files: 10k headings; 10k emphasis lines; 5k links; CJK prose with `AutoSpace`.

| # | Finding | Benchmark | Reject if |
|---|---|---|---|
| A1 | Capacity-aware `append` | Differential fuzz against the oracle on code-span, table-IAL, autolink and link-label generators with both append modes; micro: `parseATXHeading` ×10k | No oracle diffs with copy-always and under 2% time difference |
| A2 | Slim `Node` | Count nodes; `parse.Parse(commonmark-spec.md)` fat versus split; `--trace-gc` | Under 5% on Parse and no scavenge reduction |
| A3 | `WriteString` path | `HtmlRenderer.Render` on a cached tree: `charCodeAt` loop, pre-encoded constants, `encodeInto` | Pre-encoding gains under 3%: keep literals inline |
| A4 | Enum inlining and switch tables | `--print-bytecode` on `IsBlock`; bundle with and without inlined types | No bytecode or time difference |
| A5 | Tuple returns | Micro: `lex.Trim` on 30k slices; macro: 5k-link file | Under 2% macro |
| A6 | Tokenizer without reader | `BlockDOM2Tree(Md2BlockDOM(spec))`; measure the `Token()` decode share | Not applicable (simplification) |
| A7 | `HasPrefixAt` | 10k-emphasis file, `scanDelims` self time | Under 2% |
| B1 | One-byte slice table | Emphasis and escape stress files, allocation count | No change in scavenges |
| B2 | `IsMarker` table | CJK and ASCII prose, `parseText` self time | Under 2% |
| B4 | Dispatch array, unbound methods | `new HtmlRenderer` ×10k plus `Render` on the spec tree | Under 2% |
| B7 | IAL escape fast path | `Md2BlockDOM` and `SpinBlockDOM` on the kramdown spec | Combined self time under 3% |
| C1 | Small-decode threshold | Sweep 0/16/32/64/128 on `BlockDOM2Tree` and `Text()`-heavy runs | Flat curve |
| D1 | Lazy tables | Time for load + `Lute.New()` + `MarkdownStr("a")`, eager versus lazy | Startup difference under 1 ms |

Order of work: A1 and A4 first, because they change conventions. Then A2 and A3 on a throwaway port of `lex`, `ast` and a minimal block parser, the same vehicle phase 0 uses for the sub-slice measurement. Everything in section B waits for a profile of the 1:1 port.

### Sources

- [Node.js: Modules: TypeScript](https://nodejs.org/api/typescript.md)
- [TypeScript `erasableSyntaxOnly`](https://www.typescriptlang.org/tsconfig/erasableSyntaxOnly.html)
- [esbuild 0.14.7 release notes: cross-module enum inlining](https://newreleases.io/project/github/evanw/esbuild/release/v0.14.7)
- [nodejs/node#39879: TextDecoder slow on small inputs](https://github.com/nodejs/node/issues/39879)
- [msgpack-javascript PR #34: pure-JS decode for short inputs](https://github.com/msgpack/msgpack-javascript/pull/34)
- [V8 Ignition design doc](https://chromium.googlesource.com/v8/v8.git/+/main/docs/interpreter/interpreter-ignition.md)

## Phases

| # | Scope | Done when |
|---|---|---|
| 0 | Project skeleton (`tsconfig`, esbuild, scripts), runtime layer with tests, harness comparing against the oracle, benchmark, `subarray` versus offsets measurement | The harness runs `lute.min.js` and compares results; the sub-slice representation is decided from numbers |
| 1 | `editor`, `util`, `lex`, `html/atom`, `html` | `lex` and HTML parser tests match the oracle |
| 2 | `ast` | Tree operations and `Walk` |
| 3 | `parse` + `render/renderer.go` + `render/html_renderer.go` + the `Markdown` path in `lute.go` | CommonMark 651/652 (example 540 is a known difference of the JS build, see the phase 0 log) and the GFM spec |
| 4 | Remaining renderers: format, textbundle, JSON/ECharts/KityMinder, Vditor ×3, Protyle ×5 | The matching test files pass |
| 5 | Root: `h2m.go`, `vditor_*.go`, `protyle*.go`, the rest of `lute.go` | `h2m`, `spin_*`, `v2m`, `p2*` tests |
| 6 | Public API matching `javascript/main.go` (`Lute.New`, `SetJSRenderers`, `Walk*` constants, `Caret`, `NewNodeID`, `EscapeHTMLStr`, `Sanitize`, `BlockDOM2Content` etc.), ESM + IIFE bundle, `.d.ts` | Drop-in replacement for `lute.min.js` |
| 7 | Differential fuzzing on all API paths, profiling, bundle size | Zero differences on the corpus; benchmark results versus GopherJS |

**Performance measurements are deferred and batched.** On 2026-10-10 the user first asked for micro-benchmarks after every phase, then, after the benchmark harness proved too noisy, asked to stop and to record the places to measure later, all at once. So during a phase: note every suspected slow spot in "Deferred performance checks" as soon as it is seen, with file and reason, and do not run benchmarks. A phase is done when its tests pass and its output matches the oracle. Whether the per-phase rule returns once the harness is reliable has not been confirmed with the user.

Notes on ordering:

- Phases 0–2 are sequential because they set the conventions.
- From phase 3 on, files within a package can be translated in parallel (signatures are known from Go).
- Tests from `test/` are ported 1:1 alongside phases 3–5: same file names, expectations copied verbatim.
- The port is pinned to one upstream commit until phase 6 is done; see "Keeping up with upstream".

## Phase 0 progress log

### 2026-10-10

Work is delegated to Haiku subagents; results below were re-checked in the main session unless marked otherwise.

- **Skeleton (done).** `ts/` has `package.json`, `tsconfig.json` (strict, erasable-only), TypeScript 7.0.2, esbuild 0.28.2, `UPSTREAM_PIN`, `scripts/build.mjs`, npm scripts `typecheck`, `test`, `build`, `bench:oracle`. `npm run typecheck` passes.
- **Oracle harness (done).** `ts/test/oracle/oracle.ts` loads the bundle and provides `normalizeIDs`, `firstDifference`, `assertSameOutput`.
- **`utf8` and `unicode` runtime modules (done).** Tables are generated by `ts/tools/gen-unicode` with Go 1.21.13 (Unicode 15.0.0). 13 predicates, 16 tables and 4 case mappings are compared with Go for every code point 0..0x10FFFF through checksums. String-based helpers (`DecodeRuneInString` etc.) work in UTF-16 units and are tested against their definition, not against Go.
- **`bytes`, `slices`, `strings`, `strconv` (done).** Each function Lute uses is compared with Go 1.21.13 through generated vectors (`ts/tools/gen-bytes-vectors`, `ts/tools/gen-strings-vectors`): 2,109 vectors for `strings`, 878 for `strconv`, about 150 per `bytes` function, plus 40 `Buffer` operation sequences and 12 slice-aliasing scenarios. Full suite: 162 tests, 161 pass; the one failure is the intentional CommonMark example 540 check described below. `tsc --noEmit` is clean.
  - `slices.ts` implements the A1 model: `Cap`, `Make`, `Append`, `AppendByte`, `AppendString`, `Copy`, `Clone`, `Reslice`. `Append` writes in place when capacity allows. The growth rule was read from the oracle bundle and matches GopherJS: `Math.max(needed, cap < 1024 ? cap * 2 : Math.floor(cap * 5 / 4))`.
  - `Reslice(a, n)` exists because `subarray` clamps to the current length, while Go's `s[:n]` may extend up to capacity.
  - `bytes.Buffer` follows A3: `WriteString` is a `charCodeAt` loop with a UTF-8 fallback; `Bytes()` is a live view; `String()` decodes invalid bytes the Go way (one U+FFFD per invalid byte, where `TextDecoder` would merge a truncated sequence into one).
  - `strings` works on JS strings with UTF-16 offsets. `strconv` supports exactly the argument combinations Lute passes and throws on others.
  - `strings.ToLower`, `ToUpper` and `Map` turn an unpaired surrogate into U+FFFD, as Go does with invalid bytes.

**Known gaps in the runtime layer** (to check at the call sites when they are ported):

- **Capacity of `bytes.Split` elements.** Go's `bytes.Split` returns three-index slices (`s[:m:m]`), so appending to an element reallocates. A typed-array view cannot limit its capacity, so here `Append` on a Split element would write into the source buffer. Lute itself uses no three-index slices; `bytes.Split`/`SplitN` has about 14 call sites (`h2m.go:1178`, `parse/auto_link.go:410-429`, `parse/blockquote.go:74`, `parse/callout.go:76`, `parse/file_annotation_ref.go:144`, `parse/gitconflict.go:51`, `parse/html_block.go:288`, `render/format_renderer.go:1783,1919`, `render/protyle_export_md_renderer.go:1930,2067`). Each must be checked for an `append` onto an element.
- **`strings.NewReplacer` with an empty pattern** steps by bytes in Go, which a JS string cannot reproduce for non-ASCII text. Lute never passes an empty pattern.
- **Integers beyond ±2^53** are not exact in `strconv`.

Convention fixed while briefing the runtime work: runtime functions take non-null arguments and never return `null`; where Go returns a nil slice they return an empty `Uint8Array`. In the Go source, byte slices are compared with `nil` at only a few dozen sites, almost all on results of Lute's own functions (for example `lexer.NextLine` at end of input, `parseLinkRefDef`, an absent link title). Those keep `null` in the ported code.

**Finding: the JS build does not pass all of CommonMark.** The oracle gives 651 of 652 spec cases. Example 540 (`[ẞ]` with the definition `[SS]: /url`) needs full Unicode case folding, and the `javascript` build variant deliberately skips it (`parse/linkrefdef_case_foldjs.go`: `foldBytes` returns its input, to keep the bundle small). Both the committed and the rebuilt bundle return `<p>[ẞ]</p>`. Consequences:

- The phase 3 criterion "CommonMark 652/652" is wrong for a port that matches the oracle; it is 651/652 with example 540 as a known difference.
- Matching native Go here would mean porting the non-JS variant of that one function, which departs from the oracle. Not decided.
- The harness test currently fails on this case on purpose; it should record example 540 as an expected difference.

**Oracle baseline** (`ts/bench/oracle-baseline.ts`, `benchmark/commonmark-spec.md`, 10 warm-up and 30 timed runs, Node v24.20.0). Other agents were running on the machine at the same time, so treat these as rough; an earlier idle measurement of `MarkdownStr` gave a 157 ms median.

| Path | Median ms | Min ms | Output length |
|---|---|---|---|
| `MarkdownStr` | 246.7 | 218.9 | 233,003 |
| `FormatStr` | 206.3 | 168.5 | 200,961 |
| `Md2BlockDOM` | 619.6 | 511.6 | 937,423 |
| `Md2VditorDOM` | 386.1 | 329.8 | 515,294 |
| `Md2VditorIRDOM` | 634.5 | 537.7 | 794,717 |
| `Md2VditorSVDOM` | 1,499.3 | 1,146.6 | 1,386,416 |
| `HTML2Md` | 1,322.2 | 966.4 | 163,290 |
| `BlockDOM2Md` | 1,402.7 | 976.4 | 235,307 |
| `SpinBlockDOM` | 1,563.3 | 913.6 | 1,728,628 |

Follow-ups for the harness: pin `@types/node` to the Node 24 line (26.x was installed), let the oracle path be chosen through an environment variable so the rebuilt bundle can be used, and re-run the baseline on an idle machine.

## Phase 1 progress log

### 2026-10-10

Porting rules for agents are in `ts/PORTING.md`. It is extended whenever a port raises a question the rules did not answer.

- **`runtime/conv.ts` (done).** `BytesFromString`, `StringFromBytes`, `StringFromRune`, `RunesFromString`, `StringFromRunes`. `StringFromBytes` is lossy for invalid UTF-8 (one U+FFFD per invalid byte), where Go keeps the bytes.
- **`editor` (done).** 12 of 12 constants.
- **`lex` (done).** 33 of 33 `Item*` constants and 36 of 36 functions, plus the lexer and the port of `lexer_test.go`. Checked against Go with 22,140 calls across the 36 functions and 90 lexer runs. All 12,801 rune vectors for `IsUnicodeWhitespace` agree between Go's Unicode 17 and the port's Unicode 15 tables, so nothing was excluded.
  - `TrimLeft` returns its whitespace as `Uint8Array | null` and `TrimWhitespace` is nullable, because `parse/link.go:60` and `:328` compare them with nil.
  - Four functions throw explicitly where Go panics on an out-of-range index (`ReplaceNewlineSpace`, `AcceptTokens`, `IsBackslashEscapePunct`, `Peek` with a negative index); 291 vectors record such panics.
  - `ReplaceAll` takes `nw` instead of `new`.
- **`html/atom` (done).** 368 of 368 constants, the 512-slot hash table, `hash0` and `atomText` compared with Go; 7,286 `Lookup` and 2,566 `String` vectors. `table.ts` is produced by a converter, not typed. `Atom` methods are free functions (`AtomString`).
- **`html` (done).** All 12 files. Entities are generated from `html/entity.go` (2,125 names) and decoded lazily. The tokenizer takes the whole input as a `Uint8Array` instead of an `io.Reader` (finding A6) and works on a private copy, because it rewrites its buffer in place. `Parse`, `ParseFragment` and `Render` work on bytes and a `bytes.Buffer`. Checked against Go: about 34,000 escaping vectors, 680 tokenizer documents (two API levels plus fragment mode), and 1,343 parser documents in 18 fragment contexts, comparing the full tree and the rendered bytes. In 25 runs Go itself panics; the port throws in the same places.
- **`util` (done).** `byte_str`, `panic`, `ial`, `rune`, `url`, and `html.go` with all 27 DOM helpers, checked on 199 documents including Protyle and Vditor markup produced by Lute in Go (every helper called on every element).
- **Phase 1 is complete.** Suite: 1,638 tests, all passing; `tsc --noEmit` clean. Left over: one `Object.assign` struct literal in `ts/src/html/doctype.ts:66`; `html/index.ts` re-exports helpers that Go keeps unexported (`escape`, `unescape`, `lower`, ...), harmless with namespace imports.

Rules added to `ts/PORTING.md` during the phase: methods on non-struct types become free functions (`AtomString`); names colliding with JS globals; annotated byte locals; explicit throws only where Go vectors show a panic; reserved-word renames; struct literals without `Object.assign`; the lossy comparison for invalid UTF-8 that passes through a string; vector files under 1.5 MB; `// UPSTREAM-BUG:` markers.

Policy decided in this phase: functions that convert bytes to a string and back (`html.UnescapeBytes`, `html.UnescapeHTML`) are not byte-exact for invalid UTF-8, because a JS string cannot hold invalid bytes. This is accepted; input from the public API is always valid UTF-8. The remaining risk is Go code that cuts a multi-byte character in half and joins it again later, which only fuzzing of the whole parser against the oracle will show.

## Phase 2 progress log

### 2026-10-10

- **`ast` (done).** 143 `NodeType` constants, the `Node` class with all 66 fields and the positional constructor `new Node(type, tokens)`, 47 methods, `Walk`, `TableCellRich`. `NodeType.String()` is `ast.NodeTypeString(t)`; `ast.Testing = true` is `ast.SetTesting(true)`.
  - Nullable `Node` fields, decided by searching the Go source for nil comparisons: `Tokens` (13 comparisons), `CodeBlockCloseFence` (1, `parse/inlines.go:120`), `KramdownIAL` (1, `parse/list.go:157`). All other slice and map fields are non-null.
  - `NodeJSONFields` and `ListDataJSONFields` keep the JSON struct tags as data for the JSON renderer.
  - Checked against Go: every constant and name; per-type predicates for all type values, including `CanContain` against every other type; 150 scripted tree-edit scenarios comparing Go's `Parent/Previous/Next/FirstChild/LastChild` after every step; 72 real trees from `parse.Parse` with every no-argument method on every node; 120 IAL cases; `TableCellRich` encode and decode.
- **New runtime modules (done):** `sort.ts` (code point order, equal to Go's byte order), `url.ts` (port of Go 1.21 `net/url.Parse`, 904 vectors), `base64.ts` (`RawURLEncoding` with Go's acceptance rules), `json.ts` (`QuoteString` with Go 1.21 escaping).
- **Go version differences that matter for the port.** The reference bundle is built with Go 1.21.13, so the port follows 1.21:
  - `encoding/json` writes U+0008 and U+000C as `\u0008` and `\u000c` in Go 1.21, and as `\b` and `\f` from Go 1.22.
  - `net/url.Parse` accepts `https://[v1.fe]/x` in Go 1.21 and rejects it in Go 1.27. The test `callout_src_121.test.ts` takes its expected values from Go 1.21 and pins the set of inputs where the two versions disagree in `URL_PARSE_GO121_VS_GO127_DIFFERENCES`.
  - Consequence for all later vectors: generators that import Lute run on Go 1.27 (the module requires 1.26), so anything that depends on a standard-library behaviour changed after 1.21 needs the same treatment.
- **Phase 2 is complete.** Suite: 3,206 tests, all passing; `tsc --noEmit` clean. Test data now totals about 13 MB across packages (each file under 1.5 MB).
- Agents from here on run on Sonnet (user's instruction).

## Phase 3 progress log

### 2026-10-10

- **Convention for methods spread across files** (spiked and added to `ts/PORTING.md`): `Tree` and `Context` are declared in `parse/types.ts`; each method is defined in the file where Go defines it, through interface merging and a prototype assignment, so call sites keep `t.parseBlocks()`. The spike confirmed it typechecks under `erasableSyntaxOnly`, runs under Node's type stripping, bundles with esbuild, and is independent of import order as long as `types.ts` imports nothing from its own package at runtime.
- **Plan:** foundation first (`types.ts`, `parse.ts`, `blocks.ts`, `block_start.ts`, `inlines.ts`, `index.ts`, stubs for the rest); then four groups in parallel (block-level files; inline files and emoji; autolink and inline HTML; tables and transforms); the base renderer and the HTML renderer; then integration with a minimal `lute.ts` and comparison of `MarkdownStr` with the oracle on the CommonMark and GFM specs and the ported Go tests.
- **Foundation (done, Sonnet).** `types.ts` (`Tree`, `Context`), `parse.ts`, `blocks.ts`, `block_start.ts`, `inlines.ts`, `index.ts` and 42 stubs: 35 of 35 declarations of the four Go files. Typecheck shows 71 errors, all for symbols that live in stub files. What these files expect from the rest of the package is written down in `ts/src/parse/INTERFACE.md` (to be deleted when the package is complete).
  - `Options.AliasEmoji` and `EmojiAlias` are lazy accessor properties, so creating an engine does not build the emoji tables (finding D1).
  - `Context.ParseOption` is non-null and required by the constructor; `Tree.Context` and `Context.Tip` are nullable, read with `!`.
  - `Options.Copy()` replaces Go's by-value copy of the options struct.
  - The block-start list is built lazily on first use.
- **`parse` complete (2026-10-11).** All 46 Go files, declaration counts equal to Go in every file. Emoji (2,126 aliases) and the TLD list (1,481 entries) are generated from the Go source, compared entry by entry, and built lazily. In-place `append` on shared buffers is kept where Go has it (`code_span.go:51,128`, `link.go:340`, `table.go:254,285`, `auto_link.go:277,394`, `inline_html.go:251`).
- **`render` base and HTML renderer complete.** `renderer.go`, `html_renderer.go` (139 methods), the `javascript` variant of the code block renderer, and `link`, `space`, `term_typographer`, `custom_block_renderer`, `sanitizer`, `table_rich`, `callout`, `setext`, `mindmap`, `filetype`, and the base-renderer half of `tabs`. `HtmlRenderer extends BaseRenderer`; only `Render` and `renderToC` are defined on both, and both embedded calls go through `BaseRenderer.prototype.X.call`.
  - Names that later renderers define over `BaseRenderer` (must get the explicit-base treatment then): `VditorSVRenderer` defines `Newline`, `Text`, `Write`, `WriteByte`, `WriteString`, `renderToC`; `VditorIRRenderer` defines `Text`; `ProtylePreviewRenderer`, `ProtyleExportDocxRenderer` and `TextBundleRenderer` define `Render`; the JSON renderers define `renderDefault`; every renderer defines `renderToC`. Base methods `Tag`, `renderToC`, `renderTableByHTML*`, `renderCustomBlockFallback`, `renderTabsHTML`, `renderTabsDocx` call `WriteString`, `Write`, `Newline`.
- **Checks against Go during the wave** (by the porting agents): about 48,000 inline trees, 3,485 block trees, 218 table/emoji/reference trees, 1,260 hand-built-tree renders and 205 Markdown-to-HTML cases. Differences were only invalid UTF-8 passing through a string, and nil versus empty tokens.
- **First end-to-end comparison with the oracle (main session, scratch script, 2026-10-11):** `parse.Parse` + `NewHtmlRenderer(...).Render()` with default options is identical to `Lute.New().MarkdownStr` on all 652 CommonMark spec cases and on the whole of `benchmark/commonmark-spec.md` (233,003 characters of output), and behaves the same on the known upstream-bug inputs, including throwing on `https://github.com/issues/1`. A rough timing in one process, on unbundled code and not a benchmark: port 62 ms, oracle 121 ms per pass.
- Suite after the wave: 3,301 tests, all passing; `tsc --noEmit` clean.
- **Gaps found, being closed in the integration step:**
  - **nil versus empty.** The runtime returns an empty array where Go returns nil. `Node.Tokens` is nullable and Go assigns results of `bytes.TrimSpace`, `bytes.ReplaceAll` and others to it, so nil-ness must be reproduced at those sites.
  - **Standard-library `html.UnescapeString`** is called at `parse/table_rich_style.go:80`; the port used Lute's fork, which lacks semicolon-less names and two-code-point entities (37 pinned mismatches).
- **Integration (done, 2026-10-11).** Phase 3 is complete.
  - **nil versus empty:** the rule and a table of Go functions with their nil condition are in `ts/PORTING.md`; helpers `slices.NilIfEmpty`, `slices.KeepNil`, `bytes.ReplaceOrNil`, `ReplaceAllOrNil`, `JoinOrNil`; about 50 Go sites audited, 10 changed. A permanent corpus of 8,376 trees (1,396 inputs under 6 option sets, from real Go) is compared including nil-ness in `ts/src/parse/tree.vectors.test.ts`: 85 trees differed without the fixes, 0 with them.
  - **Standard-library `html.UnescapeString`:** `ts/src/runtime/stdhtml.ts` with 2,229 generated entity names, 28,921 vectors from Go 1.21.13; the 37 pinned mismatches are gone.
  - **Engine entry:** `ts/src/types.ts` (class `Lute`), `ts/src/lute.ts`, `ts/src/global.ts` (`makeGlobal()`), `ts/src/index.ts`. Ported: `New`, `Markdown`, `MarkdownStr`, 75 option setters, emoji and term accessors, `IsValidLinkDest`, `GetLinkDest`, `Tree2HTML`, native `SetJSRenderers`. Marked NOT PORTED YET until their renderers exist: `Format`, `FormatStr`, `TextBundle`, `TextBundleStr`, `HTML2Text`, `RenderJSON`, `FormatNodeSync`, `ProtyleExportMdNodeSync`, `ProtylePreview`, `ProtylePreviewStr`, and `BlockDOM2Content` in the global object.
  - **Permanent end-to-end tests against the oracle** (`ts/test/e2e/`): 652 CommonMark and 39 GFM spec cases; 14 files under up to 62 option sets (all `MarkdownStr`-relevant setters); a deterministic fuzz of 1,500 documents under 4 option sets, where both sides throwing counts as equal; custom JS renderers including error messages; 13 regression cases. No difference between port and oracle was found, so no source fix came out of these tests.
  - Inputs on which both the oracle and the port throw: `https://github.com/issues/1` (default options) and `{: id="a"}` under Protyle.
  - Suite: 3,340 tests in about 15 s, all passing; `tsc --noEmit` clean; `npm run build` gives `dist/lute.min.js` of 661 KB (the GopherJS bundle is 4.3 MB; the port is not complete yet, so the sizes are not comparable).
  - **Incident to know about:** the integration agent reported running `Get-Process node | Stop-Process` once to stop its own runaway script. That command stops every Node process on the machine, not only its own. Later briefs forbid killing processes by name.

## Phase 4 progress log

### 2026-10-11

- Shared instructions for the wave are in `ts/WAVE-RENDERERS.md` (temporary). Each renderer is tested by replicating the body of its engine method locally and comparing with the oracle; renderers that are only reachable from block DOM are tested mainly against Go vectors, because `BlockDOM2Tree` is not ported yet.
- **All remaining renderers are ported (2026-10-11), declaration counts equal to Go in every file:**
  - **Format and TextBundle:** compared with the oracle through `FormatStr` and `TextBundleStr` on 652 spec cases, 19 files under 99 option sets and about 1,300 short documents under 39 sets, including a second formatting pass; `test/format_test.go` ported. One port bug found and fixed (TextBundle's link list is nil until the first replacement).
  - **JSON, ECharts, KityMinder, Vditor WYSIWYG:** compared through `RenderJSON`, `RenderEChartsJSON`, `RenderKityMinderJSON`, `Md2VditorDOM`; the JSON serializer reproduces Go's `json.Marshal` from `NodeJSONFields`; three Go test files ported. No difference in the renderers.
  - **Vditor IR and SV:** compared through `Md2VditorIRDOM` and `Md2VditorSVDOM` under 35 option sets with about 1,600 caret positions. This agent also rewrote 47 calls in `renderer.ts`, `tabs.ts` and `custom_block_renderer.ts` to the explicit base form; overridden names across all renderers are `Render`, `renderToC`, `renderDefault`, `Text`, `Newline`, `Write`, `WriteByte`, `WriteString`. On 492 SV documents the output was the same with and without the rewrite.
  - **Protyle and Protyle preview:** compared through `Md2BlockDOM` (both flags), `Md2BlockDOMWithAutoLink`, `ProtylePreviewStr` on 652 spec cases, whole files and 617 documents under 32 option variations; `test/m2p_test.go` ported (141 cases). No difference. The oracle has no setter for `ProtyleContenteditable` or `NodeIndexStart`, so those branches are not compared.
  - **Protyle export HTML and DOCX:** no engine method in Go's root package constructs these renderers (only SiYuan and the Go tests do), so there is no oracle route. Evidence is 2,960 Go-vector records (185 documents, 8 render option sets, 2 renderers), all equal. Not covered: attribute views, custom blocks, rich table cells. Seven Go tests that use them need `BlockDOM2Tree` or `Md2BlockDOMTree` and wait for phase 5; the `p2h` cases are written and skipped.
  - **Protyle export Markdown:** 6,908 renders, 3,352 round trips and 3,246 hand-built trees compared with Go vectors, all equal; `test/protyle_export_md_test.go` ported (20 cases). `BlockDOM2StdMd` and `ProtyleExportMdNodeSync` are its engine entry points; `BlockDOM2Md` uses `FormatRenderer` instead.
- **State after the wave (main session):** `tsc --noEmit` clean; 3,419 tests in 56 s: 3,416 pass, 1 skipped, 2 failing on purpose. Both failures are one parser difference: an empty fenced code block whose closing fence is followed by the caret makes the oracle throw in editor modes, and the port does not (upstream bug 36).
- **Incidents:** one agent ran `git checkout -- .` by mistake; `git status` and `git diff` show no effect, because `ts/` and `tasks/` are untracked and no tracked file had changes. Agents also collided in the shared temp directory. Both are now forbidden or checked in the merge brief.
- **Merge step (done, 2026-10-11). Phase 4 is complete.**
  - **Parser throws where Go panics**, at three sites, each confirmed on the oracle: `codeBlockFinalize`, `customBlockFinalize` and `parseHeadingID` (upstream bugs 36, 45, 46). The third had been hidden: the test harness treated every "oracle parser throws, port does not" case as one known divergence. Removing that special case exposed it. Throw-parity scans afterwards (about 20,000 corpus documents with the caret at every position under four editor modes; about 16,000 spec fragments under six option combinations; random token fuzz over about 35 setters and nine engine methods) found no further difference. The scan scripts were not kept.
  - **Layout:** `FormatRenderer`, `ProtyleRenderer`, `ProtyleExportMdRenderer` are in `render/types.ts` with methods attached per file; the three `tabs_*.ts` files are merged into `tabs.ts`; `headingLevel`, `reverse` and the table-cell IAL helpers are exported once; `render/index.ts` lists all 28 files. Each of the 15 renderer files loads and renders when imported alone.
  - **`lute.ts`:** `Format`, `FormatStr`, `TextBundle`, `TextBundleStr`, `RenderJSON`, `FormatNodeSync`, `ProtyleExportMdNodeSync`, `ProtylePreview`, `ProtylePreviewStr` are ported. `FormatNodeSync` and `ProtyleExportMdNodeSync` are not exposed by the oracle and are checked only by ported Go tests. `HTML2Text` waits for `h2m.ts`.
  - **Tests:** `npm test` runs a deterministic sample for the non-base option sets and takes 31 to 38 s; `npm run test:full` runs everything in about 50 s; both run the same 3,422 tests. Main session after the merge: 3,421 pass, 1 skipped, 0 fail; `tsc --noEmit` clean.
  - All files under `ts/` were normalised to LF line endings.
  - Build: `dist/lute.min.js` 957 KB, `dist/lute.esm.js` 1.7 MB (root package not included yet).
  - Still open: `TextBundleRenderer` needs one type cast because its `Render` returns two values.

## Phase 5 progress log

### 2026-10-11

- Shared instructions for the wave are in `ts/WAVE-ROOT.md` (temporary). Stubs for the seven root files exist and `ts/src/index.ts` already exports them.
- **All Go source is ported (2026-10-11).** The four root-package files landed with declaration counts equal to Go:
  - **`h2m` and `h2m_code_banner`** (plus `HTML2Text`): compared through `HTML2Md`, `HTML2Text`, `HTML2Markdown` under 13 option sets on Go test HTML, about 330 hand-written fragments, mutations, and HTML/DOM produced by the oracle from the whole corpus; no difference, also in the unsampled run. 10 Go tests ported (273 rows in `h2m_test.go`).
  - **`vditor_wysiwyg`** (49 methods): full editor round trips under 16 option sets, DOM mutations spun twice, about 190 hand-written DOMs, paste, ECharts and KityMinder; no difference. 22 Go tests ported.
  - **`vditor_ir` and `vditor_sv`**: eight methods under more than 40 option sets, including about 120 half-typed Markdown inputs; no difference in the quick and in the unsampled run. Three Go test files ported (131 cases).
  - **`protyle` and `protyle_tabs`** (47 methods, plus the global `BlockDOM2Content`): all ten DOM-taking methods, 14 list and block conversions, three rounds of `SpinBlockDOM` on mutated DOM, `HTML2BlockDOM`, and all 2,136 string literals of 40 Go test files used as Markdown, DOM and HTML; no unexplained difference. 23 table-driven Go test functions ported; 94 non-table functions were covered only by feeding their inputs to both sides, without Go's expected values (phase 6 ports them).
  - Not comparable directly: methods returning trees (`Md2BlockDOMTree`, `BlockDOM2Tree`, `HTML2Tree`, `Tree2BlockDOM`, `RenderNodeBlockDOM`), because the GopherJS wrapper cannot be converted; they are checked through the methods built on them.
- **`defer` in the DOM-to-tree converters** was ported in three ways, all preserving Go's semantics: a boolean flag checked in one `finally` (at most one defer per call), a list of closures run in reverse in one `finally` (defers registered inside switch cases), and plain `try/finally` for option restores.
- **Main session after the wave:** `tsc --noEmit` clean; 3,550 tests in 80 s: 3,549 pass, 1 skipped, 0 fail. API parity with the oracle: 152 of 152 engine methods and 14 of 14 global keys exist. A smoke comparison of 13 methods on one document is identical. `dist/lute.min.js` is 1.09 MB (GopherJS bundle: 4.38 MB).
- **One difference left:** a heading of level 7 makes the oracle throw in `BlockDOM2RichHTML`; the port does not (upstream bug 52).
- **Merge step and drop-in bundle (done, 2026-10-11). Phase 5 is complete.**
  - **Heading level out of range:** `BlockDOM2RichHTML` throws for levels below 0 and above 6 (`html_renderer.ts`), and `Blocks2Hs` throws for negative levels (`protyle_renderer.ts`), as the bundle does. The Vditor, preview, export, DOCX and ECharts renderers are not reachable with an out-of-range level through any public method and were left alone.
  - **Tests use the real engine methods;** the local equivalents are deleted, the `p2h` cases run, and `BlockDOM2StdMd` is now compared with the oracle on the oracle's DOM for 469 documents. No difference appeared.
  - **`ts/test/e2e/throw_parity.test.ts`:** a permanent scan that only compares whether each side throws. Stage 1 runs 8 forward methods under 6 configurations on the corpora with the caret at every position and on random token sequences; stage 2 feeds the oracle's DOM to 10 reverse methods. About 2,900 forward and 1,300 reverse calls per side in the default run, about 57,600 and 24,000 under `test:full`. Mismatches are delta-reduced before printing. The scan found none.
  - **A port bug found by `test:full`:** an earlier agent had added a throw at `vditor_wysiwyg.go:931` (`md[3:]`) because native Go panics there; the bundle does not (upstream item 60). The throw was removed. Lesson: "Go panics here" must be confirmed on the bundle; GopherJS does not panic on string slices that start past the end.
  - **Drop-in bundle:** `ts/src/bundle.ts` assigns `makeGlobal()` to `globalThis.Lute`; `npm run build` writes `dist/lute.min.js` (IIFE), `dist/lute.esm.js` and type declarations in `dist/types/`. `ts/test/e2e/bundle.test.ts` loads the built bundle and the reference in separate child processes and compares global keys, constants, engine members and 650 calls. Two differences were found and fixed in `global.ts`: 58 unexported helper methods were enumerable on the engine, and the emoji and term accessors exchanged `Map` where the bundle exchanges plain objects.
  - **Sizes:** port `dist/lute.min.js` 1,011,110 bytes raw and 249,013 gzip; `javascript/lute.min.js` 4,376,521 raw and 707,043 gzip.
  - `ts/README.md` added; lasting rules of the wave moved into `ts/PORTING.md`; `ts/WAVE-ROOT.md` deleted.

## Phase 6 progress log

### 2026-10-11

- **Go test suite ported (three Sonnet agents).** `ts/test/go/` has 90 test files, one per Go test file that was not already ported elsewhere, with expected values extracted from the Go source by scripts in `ts/tools/go-tests/`. 370 new tests: 362 pass, 8 are skipped (syntax highlighting, which the JavaScript build does not have), none fails. No port bug was found: every other Go expected value is met.
  - Differences between the JavaScript build and native Go are pinned in `JS_BUILD_DIFFERENCES` lists and summarised in `tasks/002-upstream-bugs.md` under "Native Go versus the JavaScript build".
  - `image_title_data_attribute_test.go` (the newest Go commit, not in the committed bundle) passes against Go's expected values, so the port corresponds to the pinned commit `8e7896b6`.
  - One agent checked the "already ported" files by function name only, without re-reading their bodies.
  - `TestGFMSpec` adds the suffix `baz` to the global autolink table and does not remove it, as in Go.

## Status on 2026-10-11

**All Go code is ported.** Phases 0 to 6 of the plan are done except the performance work, which the user deferred.

Verified by the main session after the last step:

- `tsc --noEmit`: clean.
- `npm test`: 3,931 tests, 3,923 pass, 8 skipped, 0 fail, 68 s.
- `npm run build`: works.
- The built `dist/lute.min.js` and `javascript/lute.min.js`, each loaded in its own Node process: 14 global keys each, version `1.7.6` each, 152 function members on an engine each, and identical output (same hash) for `MarkdownStr`, `FormatStr` and `Md2VditorIRDOM` on `benchmark/commonmark-spec.md`.
- `git status`: only `tasks/` and `ts/` are untracked; no tracked file changed; nothing is committed.
- Port size: about 68,000 lines of TypeScript in `ts/src/` excluding tests.

Reported by the last agent and not repeated by the main session: `npm run test:full` passes (3,931 tests, about 19 minutes).

### Open items

1. **Decisions for the user**
   - Commit: nothing is committed (`ts/` and `tasks/` are untracked). During the night one agent ran `git checkout -- .` by mistake; it had no effect only because there were no changes to tracked files.
   - Decided 2026-10-11, default oracle: `ts/test/oracle/lute.ref.min.cjs`, built from the pinned commit (`ts/UPSTREAM_PIN`) plus `ts/tools/oracle/patches/`, with Go 1.21.13 and GopherJS 1.21.0. The rebuild steps are in `ts/test/oracle/README.md`. `javascript/lute.min.js` stays usable through `LUTE_ORACLE`.
   - Native Go versus the JavaScript build: the port follows the JavaScript build except for the departures listed in `tasks/002-upstream-bugs.md` (section "Deliberate departures from the JavaScript build"; so far item 59, block attributes on code blocks). Each other difference is listed and pinned, so switching one of them is a local change.
   - Upstream bugs: 60 entries in `tasks/002-upstream-bugs.md`; the port reproduces all of them on purpose.
2. **Performance:** nothing measured, by instruction. The list is in "Deferred performance checks"; step 0 is a trustworthy harness.
3. **Drop-in detail:** on the reference bundle the 152 methods are own properties of the engine object (`Object.keys(engine)` has 153 entries); on the port they are on the prototype (`for…in` finds 152, `Object.keys` 18). Code that enumerates own keys or copies an engine with spread would see a difference.
4. **Test run time:** `npm test` takes 62 to 68 s (target was 45 s); about 1 s per test file is start-up (type stripping and loading the 4 MB reference bundle). `test:full` takes about 19 minutes.
5. **Not comparable with the oracle:** methods that take or return trees (`BlockDOM2Tree`, `Md2BlockDOMTree`, `HTML2Tree`, `Tree2HTML`, `Tree2BlockDOM`, `ProtylePreview`, `RenderNodeBlockDOM`), `FormatNodeSync`, `ProtyleExportMdNodeSync`, the options `ProtyleContenteditable` and `NodeIndexStart`, and the two Protyle export renderers (HTML, DOCX), which no engine method constructs. They are covered by Go vectors or ported Go tests only.
6. **Known gaps in Go-vector coverage:** attribute views, custom blocks and rich table cells in the export renderers; the host-name branches of `util/url.ts`.
7. **Unverified detail:** `TextBundleRenderer` needs one type cast because its `Render` returns two values.
8. **Installed during the work:** Go 1.27 (system), Go 1.21.13 SDK and GopherJS 1.21.0 (user directories), a rebuilt bundle in `C:\Users\SlawomirPiochacz\lute-oracle-build\`, and the `upstream` git remote.

## Deferred performance checks

On 2026-10-10 the user stopped the performance testing of the runtime layer and asked to record the specific places to test later, all in one batch. Nothing in this section has a trusted measurement yet. Do not run these piecemeal; run them together once the machine is free and the harness is reliable.

### Why the measurements were stopped

Three attempts at a micro-benchmark harness did not produce trustworthy timings:

- **First harness** (all rows in one process): unchanged reference rows moved by 0.26x to 4.2x between two runs; checksums depended on iteration count; duplicate row names.
- **Second harness** (one fresh process per row, three processes per row, fixed work per checksum): an A/A test on 79 rows gave 35 within ±5%, 43 within ±10%, 58 within ±20%, and 16 rows off by more than 20% (worst 2.7x). Within one row the three processes disagreed, for example 6.8 / 8.9 / 14.1 ns.
- **Untested hypothesis for the noise:** the machine has an Intel Core i7-1360P, a hybrid CPU with 4 performance cores (logical processors 0-7) and 8 efficiency cores (8-15), on the "Balanced" power plan. Windows may place each fresh process on a fast or a slow core. Pinning every benchmark process to one performance core (affinity mask `0x4`) at High priority, and checking `os.availableParallelism()` reports 1, was the next step; it was not done.
- Another project was running tests on the same machine during part of this work, which also invalidates timings from that period.

### State of the benchmark code

In `ts/bench/`, typechecking and present but not validated:

- `lib/micro.ts`: `bench` (one-operation checksum, 200 ms warm-up, 15 batches) and `allocBytesPerOp` (median of 5 windows, `null` if a GC interferes).
- `runtime-micro.ts`: rows with ids `group.name|input|impl`, each run in 3 child processes; results merge into `results/runtime-micro.<tag>.json`; `--groups=` runs a subset.
- `aa.ts` (A/A summary), `compare.ts` (flags a change only when min..max ranges do not overlap; `--slowest`), `decoder-candidates.ts`.
- `legacy/trim-legacy.ts`, `legacy/buffer-write-legacy.ts`: bench-only copies of the old approaches, for A/B rows.
- npm scripts: `bench:runtime`, `bench:runtime:aa`, `bench:compare`, `bench:oracle`.
- Result files `runtime-micro.before.json`, `.after.json`, `.aa1.json`, `.aa2.json` exist but come from the noisy runs and must not be used as evidence.

Allocation estimates were more stable than timings (controls: about 13 B/op for a loop that allocates nothing, 281 B/op for `new Uint8Array(64)`), but one row reported 0 and then 30,977,016 B/op for the same loop, so they are not validated either.

### Step 0: make the harness trustworthy

Before measuring anything else:

1. Pin benchmark processes to one performance core and verify the pinning.
2. Run the A/A test on the `bytes` group only. Accept the harness when at least 90% of rows are within ±10%.
3. If that cannot be reached, fall back to reporting only allocations and time differences larger than 2x.

### Step 0 results (2026-10-11)

Three A/A runs on the `bytes` group (56 rows, 4 of them report 0 ns per byte after rounding and are excluded, so 52 rows count):

| Run | Estimator | Within ±10% | Within ±20% |
|---|---|---|---|
| Two full runs back to back, pinned to one performance core (affinity `0x4`, verified: `os.availableParallelism()` is 1 in parent and child) | median of 3 processes | 35 of 56 (62%) | 44 of 56 |
| Interleaved (`aa.ts --interleaved`: 6 processes per row alternating between the two tags), not pinned | median of 3 | 39 of 52 (75%) | 50 of 52 |
| the same run | fastest of 3 | 45 of 52 (87%) | 52 of 52 |

- **Pinning alone does not help.** In the back-to-back run all 17 outliers pointed the same way (the first run 15–35% slower): the machine drifts over minutes. That is a systematic error, not random noise, and two separate runs can never be compared.
- **Interleaving removes the drift.** The pinned interleaved run was started and cancelled at the user's request ("run on all cores"), so pinning plus interleaving is untested.
- **The 90% within ±10% target is not met** (87% at best). Spread between the 6 processes of one row: median 1.24x, worst 1.61x.
- **Working rule until the harness improves:** compare only variants measured interleaved in the same run, use the fastest process per variant, and treat a difference under 20% as noise.
- Known defects: rows whose cost per unit rounds to 0.00 ns (`bytes.Contains|…|ref`, `bytes.Index|…|ref`); `aa.ts` without `--interleaved` merges into old result files and then counts stale rows from other groups; `compare.ts` still compares two separate runs.

### Port versus the GopherJS bundle (2026-10-11, first trusted measurement)

`npm run bench:macro -- full1`: `dist/lute.min.js` against `test/oracle/lute.ref.min.cjs` on `benchmark/commonmark-spec.md` (212 KB), 5 rounds, the two sides alternating process by process, fastest process per side, Node 24, i7-1360P, not pinned. Output hashes agree for every method. Spread between processes is at most 1.25.

| Method | Port ms | Reference ms | Port is faster by |
|---|---|---|---|
| `MarkdownStr` | 33.5 | 72.7 | 2.17x |
| `FormatStr` | 25.5 | 58.4 | 2.29x |
| `Md2HTML` | 30.1 | 71.3 | 2.36x |
| `Md2VditorDOM` | 38.3 | 109.5 | 2.86x |
| `Md2VditorIRDOM` | 43.0 | 148.3 | 3.45x |
| `Md2VditorSVDOM` | 120.7 | 389.2 | 3.22x |
| `Md2BlockDOM` | 47.4 | 171.6 | 3.62x |
| `SpinVditorDOM` | 139.5 | 269.2 | 1.93x |
| `VditorDOM2Md` | 92.4 | 178.9 | 1.94x |
| `SpinBlockDOM` | 330.9 | 702.3 | 2.12x |
| `BlockDOM2Md` | 211.5 | 393.8 | 1.86x |
| `HTML2Md` | 160.7 | 320.3 | 1.99x |

This is the unoptimised 1:1 port: none of the deferred items below has been addressed. One input file only; small inputs and start-up time are not measured.

### Diagnosis (2026-10-11)

Tools: `bench:startup`, `bench:macro --inputs=`, `bench:profile` (CPU profile summary by function and module), `bench:runtime` (interleaved). `LUTE_BENCH_REF=<bundle>` makes `bench:macro` compare the current build with an earlier port bundle ("before" versus "after"); bundles are kept in `ts/bench/results/base/` (git-ignored).

- **Start-up** (15 rounds, read + compile + run + `New` + first `MarkdownStr` of 1 KB): port 32.8 ms, reference 174.1 ms (5.3x). Running the bundle: 4.4 ms against 90 ms. The Unicode tables are not a start-up problem.
- **Small inputs** (91 B, 1 KB, 10 KB; 12 methods): the port is 2.2x to 3.8x faster on every row, hashes agree. `MarkdownStr`: 39 µs / 234 µs / 1.27 ms.
- **CPU profiles, 212 KB input** (self time):
  - `SpinBlockDOM`, `HTML2Md`, `VditorDOM2Md`: `Lute.searchWbr` 37–58%: `adjustVditorDOM` calls `removeWbr` for every top-level node and `removeWbr` walks all following siblings (quadratic, same in Go; upstream item 61).
  - `Md2BlockDOM`: `Buffer.WriteString` 18%, almost all from `BaseRenderer.Tag` (attribute strings concatenated, then flattened); `utf8.Valid` 5.5% (from `StringFromBytes` of the result).
  - `MarkdownStr`: garbage collector 14.7%; `slices.Append` + `AppendByte` + `moveBytes` + `Make` + `Cap` 24% (33% on the 1 KB input). By caller: `Node.AppendTokens` 5%, `lex.Split` 5%, `lex.SplitWithoutBackslashEscape` (11% on 1 KB), `EscapeHTML` 3%, `parseInlineLinkDest` (6% on 1 KB). `ast.Node` constructor 6% (9.6% on 1 KB). `parseBlocks` 4.7%, `EscapeHTML` 4.5%, `parseGFMAutoLink0` 3%, `NewHtmlRenderer` 2.7% on 1 KB.
- **Micro suite** (`runtime-micro.full1.json`): the earlier runtime changes are confirmed (packed rune decoder 5–8x faster than the old path; allocation-free `Trim` 7–8x; `Buffer.Write` with `set()` 1.5–1.8x). Slow against a plain loop or the native method: `Buffer.WriteString` text 44–66x, `AppendByte` 26–29x, `strconv.Atoi` 23x, `ReplaceAll` with the pattern absent 12–16x, `ToLower` 6–10x, `Itoa` 5.8x. Most of these do not show up in the profiles. The `bytes.Index` and `bytes.Contains` reference rows report an impossible 0.002 ns per KB: the reference is defective, ignore those rows.
- **Noise:** an A/A run of two identical port bundles with 2 rounds showed 1.19x on one method; use 5 rounds and treat under 20% as noise.

Optimisation proceeds by profile, one change at a time, each with a "before" versus "after" bundle and a full `npm test`.

### Optimisation wave 1 (2026-10-11)

Each step was built into its own bundle and measured interleaved against the earlier ones (`bench:macro`, 5 rounds, fastest process). `npm test` after the wave: 3,936 tests, 3,928 pass, 8 skipped, 0 fail.

| Change | Measured | Outcome |
|---|---|---|
| `adjustVditorDOM` calls `removeWbr` once (it already walks all following siblings; upstream item 61) | 212 KB input: `HTML2Md` 156.5 → 41.2 ms (3.80x), `VditorDOM2Md` 90.1 → 37.8 ms (2.38x), `SpinBlockDOM` 322.3 → 174.0 ms (1.85x). No change on 1 KB. | committed `5e17e673` |
| `lex.Split`, `SplitWithoutBackslashEscape`: one allocation per element with Go's capacity (`slices.CapAfterByteAppends`) | `MarkdownStr` on 1 KB: 228 → 181 µs (1.26x); 5–13% on 212 KB (inside the noise) | committed `5d5b6f6c` |
| `conv.StringFromBytes`: fatal `TextDecoder` instead of `utf8.Valid` plus decode | about 6% of `Md2BlockDOM`, below the noise threshold; `utf8.Valid` (5.5% self time) is gone from the profile | committed `7004dc0f` |
| `BaseRenderer.Tag`: attribute pieces written separately instead of one concatenated string | no gain: `Buffer.WriteString` fell from 18% to 11.6% but `BaseRenderer.WriteString` and `Tag` rose by the same amount | reverted |

Lesson: a high self-time share for `Buffer.WriteString` under `Tag` is the cost of writing the attribute text itself, not of string concatenation.

Profile of `MarkdownStr` after the wave (212 KB / 1 KB): garbage collector 11.9% / 2.5%; `ast.Node` constructor 8.0% / 12.3% (76 fields); `Append` + `Make` + `moveBytes` + `Cap` about 20% (callers: `AppendTokens` 7%, `EscapeHTML` 4.3%, `parseInlineLinkDest` 7.7% on 1 KB); `EscapeHTML` self 4.9%; `parseBlocks` 5.1%; `parseGFMAutoLink0` 3.6–4.6%; the walk in `table_rich.ts` that visits every node 3.5%; `NewHtmlRenderer` 2.3% on 1 KB.

### Optimisation wave 2 (2026-10-11)

| Change | Measured | Outcome |
|---|---|---|
| `slices.Append`, `AppendByte`, `Copy`, `moveBytes`: indexed loop for runs up to 16 bytes, no whole-buffer view, properties read once | micro, old against new interleaved: `Append` 4-byte pieces 46.6 → 36.2 ns, 16-byte with reallocation 111 → 89 ns, `AppendByte` in place 27.4 → 20.1 ns; four other rows unchanged; allocation unchanged. Whole methods (7 rounds): no measurable change. | committed `e304678d` |
| `html.EscapeHTML`: count pass plus one allocation | micro: time inside the noise, 3x less allocation for a line with two special bytes, the plain line 9% slower (noise). Whole methods: no change. | reverted (tests and benchmark rows kept) |

Lesson: after wave 1, tuning single runtime functions no longer moves whole methods measurably. The remaining cost is spread over the representation (a new typed-array view per append, a 76-field node, bytes to string to bytes in renderers). An independent analysis is in `tasks/003-performance-plan.md`.

### Structural change S1 (2026-10-11)

What changed: `runtime/slices.ts` has a size rule. A byte slice of at most 64 bytes is never appended in place; `Append`, `AppendByte`, `AppendString` and `Make` with a capacity of at most 64 return an exact-fit `new Uint8Array(n)` with no ArrayBuffer. Slices longer than 64 bytes are unchanged. Rules and transitions are in the comment at the top of `runtime/slices.ts`; the departure from Go and the lost pre-size capacity (`Make(0, 256)` for the first 64 bytes) are stated there and in `ts/PORTING.md`.

Explicit sites that keep Go's in-place write through `slices.AppendInPlaceLikeGo` / `AppendByteInPlaceLikeGo` (the code before S1): `parse/table.ts` twice (upstream item 30; the tree vectors fail without them), `parse/code_span.ts` twice (the `openMarker` append and the delete-in-place of `ctx.tokens`), `lex/lexer.ts` `NewLexer` (the newline written into the caller's input), `lex/token.ts` `EscapeCommonMarkers` and `EscapeProtyleMarkers`. The table sites were found by the tree vectors (they fail without the helper). The code-span, lexer and `EscapeCommonMarkers` sites were found by an instrumented run of the pre-S1 code over the 12 corpora: they overwrite non-zero bytes of a caller's buffer there. `EscapeProtyleMarkers` has the same shape and is treated alike, without a corpus case.

Status: the before/after measurement is pending (the machine is busy; no benchmark was run for this change). Checks run: `npm test` (3968 tests, 3960 pass, 8 skipped, 0 fail); differential of the 12 corpora times 11 methods, output hashes before and after the change: 132 of 132 equal; an instrumented run of the pre-S1 code over the corpora and a 264-call caret-inserted sample found non-zero overwrites only at the sites listed above.

### Waiting for the owner's go-ahead (state on 2026-10-11, evening)

The machine was busy from the middle of wave 3 on, so the owner asked to implement only and to hold tests, fuzzers and benchmarks. Everything below is committed on `ts-port` but not accepted yet. Each change has its own commit and its own bundle in `ts/bench/results/base/` (git-ignored), so it can be measured and reverted alone.

| Change | Commit | `npm test` | Measured |
|---|---|---|---|
| Wave 3: L3 slim `ast.Node` | `0280f543` | passed (3,936) | no |
| Wave 3: L1 SV container close | `ca034293` | passed | no |
| Wave 3: L2 format renderers self-copy | `1bf7ff47` | passed | no |
| Wave 3: L4 `BytesFromString` ASCII path | `f53e8584` | passed | no |
| S1 size-gated slices | `dadc57d0` | passed (3,960) | no; `test:full` not run |
| Wave 4: L6 `strings.ReplaceAll` | `2eb04362` | NOT run | no |
| Wave 4: L7 table walk gate | `c863b4f4` | NOT run | no |
| Wave 4: L9 buffers | `ed454cae` | NOT run | no |
| Wave 4: L10 `Trim` cutset table | `f7148235` | NOT run | no |
| Wave 4: L5 `BlockDOM2Tree` constants | `a82981c9` | NOT run | no |
| Spike: `VditorDOM2Md` per-child cache (`ts/experiments/dom2md-cache/`) | `ea2ecc05` | not applicable | full fuzz not run |

To do when the machine is free, in this order:

1. `npm run typecheck`, `npm test`, then `npm run test:full` (about 19 minutes) on the current head. A failure is bisected over the commits above.
2. Before/after per change: `LUTE_BENCH_REF=<bundle before> npm run bench:macro -- <tag> --methods=… --inputs=small,spec`. Bundles in order: `lute.wave2`, `lute.w3step1`…`4`, `lute.s1`, `lute.w4step1`…`5`. Revert a change with no gain in the function-level or whole-method measurement. Note for S1: the pre-sizing sites stayed on the old path, so its gain may be below the 1.24x of the experiment.
3. The spike's full runs (commands in `ts/experiments/dom2md-cache/README.md`, about 25 minutes).
4. The final table: `npm run bench:macro -- final --inputs=tiny,small,medium,spec` and `npm run bench:startup -- final`.

Not started: L8 (`parseGFMAutoLink0` pre-scan), L11 (renderer method tables), S2 (hot/cold `Node` split), fusing the four extra tree walks, and a production version of the per-child cache (needs the owner's decision after the full fuzz).

### Results after the go-ahead (2026-10-11, late; machine still partly busy)

- **Correctness of everything in the waiting table:** `npm test` 3,971 tests, 3,963 pass, 8 skipped, 0 fail; `npm run test:full` the same counts in 11.7 minutes. S1 is accepted on correctness.
- **Head against the state before wave 3** (interleaved, fastest of 5; 1 KB / 212 KB): `MarkdownStr` 1.23x / 1.33x, `FormatStr` 1.14x / 1.32x, `Md2VditorSVDOM` 1.20x / 3.04x, `Md2BlockDOM` 1.13x / 1.18x, `SpinBlockDOM` 1.24x / 1.25x, `BlockDOM2Md` 1.21x / 1.09x, `HTML2Md` 1.26x / 1.27x.
- **By change** (from differences between checkpoints; anything under 20% is not resolved by this benchmark): L3 slim node about 13–18% on `MarkdownStr` and 10% on `HTML2Md` (confirmed); L1 SV container close `Md2VditorSVDOM` 117 → 45 ms (confirmed); L4 about 12% on `HTML2Md` spec (likely); L2 not resolved; S1 4–10%, positive in 13 of 14 rows but far below the 1.24x of the experiment because the pre-sizing sites stayed on the old path (not resolved; first candidate to revert if simplicity matters more); wave 4 together 0–7% (not resolved). Nothing was reverted: no change measured negative.
- **Final table, port against the GopherJS reference** (`macro.final.json`, 5 rounds, fastest process, hashes agree on every row):

| Method | 91 B | 1 KB | 10 KB | 212 KB |
|---|---|---|---|---|
| `MarkdownStr` | 41 µs (2.98x) | 175 µs (3.93x) | 1.22 ms (3.11x) | 23.0 ms (3.03x) |
| `FormatStr` | 41 µs (2.96x) | 220 µs (3.53x) | 1.18 ms (3.02x) | 19.8 ms (2.81x) |
| `Md2HTML` | 40 µs (2.99x) | 181 µs (3.88x) | 1.13 ms (3.12x) | 22.8 ms (3.02x) |
| `Md2VditorDOM` | 44 µs (3.03x) | 217 µs (3.90x) | 1.43 ms (2.97x) | 31.5 ms (3.12x) |
| `Md2VditorIRDOM` | 56 µs (3.28x) | 263 µs (4.12x) | 1.63 ms (3.34x) | 35.5 ms (3.69x) |
| `Md2VditorSVDOM` | 74 µs (4.50x) | 407 µs (4.23x) | 2.23 ms (3.95x) | 43.4 ms (7.58x) |
| `Md2BlockDOM` | 50 µs (3.78x) | 313 µs (5.26x) | 1.71 ms (3.86x) | 41.1 ms (3.92x) |
| `SpinVditorDOM` | 76 µs (3.73x) | 558 µs (3.82x) | 2.55 ms (3.27x) | 66.9 ms (4.68x) |
| `VditorDOM2Md` | 38 µs (3.58x) | 277 µs (4.01x) | 1.10 ms (3.91x) | 38.5 ms (5.64x) |
| `SpinBlockDOM` | 198 µs (3.84x) | 1.81 ms (3.49x) | 7.08 ms (3.14x) | 172.0 ms (4.22x) |
| `BlockDOM2Md` | 57 µs (3.84x) | 738 µs (3.41x) | 2.77 ms (3.31x) | 78.1 ms (5.29x) |
| `HTML2Md` | 46 µs (4.34x) | 374 µs (4.84x) | 1.61 ms (4.31x) | 37.2 ms (9.06x) |

  Times are the port's; the factor is reference time divided by port time. One row (`Md2VditorIRDOM` 1 KB) had one disturbed process (spread 78); its fastest value is still usable.
- **Start-up** (`startup.final.json`, 15 rounds): read + compile + run + `New` + first call 39.6 ms against 229.8 ms (5.8x); running the bundle 5.2 ms against 118 ms.
- **Per-child cache spike, full fuzz:** see the end of `tasks/004-incremental-and-fast-paths.md`. It is not correct yet (45 mismatches in about 120,000 comparisons).

### Places to measure

**Changes already made in the runtime layer, effect unconfirmed** (A/B rows exist in `runtime-micro.ts`):

1. **Packed rune decoder.** `utf8.DecodeRunePacked` / `DecodeLastRunePacked` (result `rune | size << 24`) replaced `DecodeRune(s.subarray(i))` on every non-ASCII path in `bytes.ts` and `strings.ts`. One isolated run on CJK text gave 62,133 ns/KB for the old path, 11,367 for a tuple with an offset, 11,091 for the packed form; the packed form was the only one without per-rune allocation. Needs confirmation on a quiet machine.
2. **Cutset scan in `bytes.TrimLeft` / `TrimRight` / `Trim`.** An allocation-free scan replaced building a code-point array per call. Noisy runs showed allocation per pass dropping from about 4.4 MB to 0.55 MB on CJK and from 7.0 MB to 1.0 MB on ASCII.
3. **`Buffer.Write` with `set()`** instead of a `subarray` view. A noisy run showed allocation per pass dropping from 15.9 MB to 0.9 MB on ASCII lines.

**Suspected slow spots in the runtime layer, not yet addressed:**

4. **`slices.AppendByte`**: a new view per appended byte. About 70 byte-wise append loops in the Go source depend on it (`parse/inline_html.go`, `html/escape_encode.go`, `parse/auto_link.go`, `lex/token.go`, `parse/heading.go`).
5. **`bytes.ToLower` and `strings.ToLower` on CJK**: per-rune binary search in `unicode.ToLower` plus re-encoding.
6. **`Buffer.WriteByte`**: per-byte call cost; `render/` calls it 334 times in source.
7. **`Buffer.WriteString` for short literals**: the `charCodeAt` loop against pre-encoded constants and `encodeInto` (finding A3), on the real class rather than a prototype.
8. **`unicode.Is*` predicates on CJK**: binary search per rune; a fast path for common CJK blocks is allowed only if it stays exact for every code point.
9. **`bytes.ReplaceAll` when the pattern is present**, and `bytes.Split` on newline, against simple reference loops.
10. **`strings.Fields`, `strings.Split`, `strings.EqualFold`, `strings.ToLower` on ASCII** against native string methods.
11. **`strconv.Itoa` / `Atoi`** against native conversion (noisy runs suggested a large gap).
12. **`unicode_tables.ts` size**: 238 KB of source; measure its share of the minified bundle and of start-up time.

**Spots flagged with `PERF-TODO` while porting:**

- `lex.EscapeCommonMarkers` and `lex.EscapeProtyleMarkers` (`ts/src/lex/token.ts`): the tail is copied once per escaped marker.
- `html.NewTokenizer`: one copy of the whole input per tokenizer (needed because the tokenizer rewrites its buffer).
- `html.EncodeDestination` / `DecodeDestination`: a `subarray` view per character.
- `html.HtmlUnescapeString`: `s.slice(i)` per ampersand copies the rest of the string, quadratic with many ampersands.
- `util.DomChildrenByType`: copies descendants at each recursion level.
- `util.StrToBytes` (296 call sites) and `util.BytesToStr` (110): free in Go, a copy plus encode or decode here.
- `runtime/sort.ts`, `url.ts` (two spots), `base64.ts`, `json.ts`: flagged by the porting agent; none is on a hot path of `MarkdownStr`.
- Methods attached through `Tree.prototype.x = function…` (the phase 3 convention): confirm they optimize like class methods.
- `parse/delimiter.ts`, `text.ts`, `inline.ts`: one-element `Uint8Array` per delimiter, escape and break (finding B1); `openersBottom` array of 128 slots per `processEmphasis` call (B15).
- `parse/emoji_map.ts` `IsEmoji`: iterates the whole alias table on every call.
- `render`: the renderer function table is a `Map` with 139 bound closures per renderer instance (B4); `SubStr`, `normalizeHeadingID` and `Space0` concatenate strings rune by rune.
- `parse/table_rich.ts` `copyNode`: copies 66 fields one by one.
- `lex.TrimRight` / `TrimLeft`: the whitespace result is built byte by byte with `AppendByte` and most callers discard it (same as finding A5).

**Decisions from "Performance research findings" that still need their measurement:**

13. **A1**: capacity-aware `Append` against copy-always, by differential fuzzing against the oracle once the parser exists.
14. **A2**: 66-field `Node` against the hot/cold split, on `parse.Parse` of the spec file.
15. **A5**: tuple returns in `lex.Trim` and the link parsers against single-result siblings.
16. **A7**: `HasPrefixAt` against `HasPrefix(s.subarray(i), …)` in `scanDelims`.
17. **B1, B2, B4, B7, C1, D1** as listed in the measurement plan table above.

**Oracle baseline:** re-run `npm run bench:oracle` on a quiet machine. The current numbers have a standard deviation of 10–20% of the median, and 70% for `SpinBlockDOM`.

## Keeping up with upstream

Upstream (`88250/lute`) releases by committing to `master` and tagging. The port follows it commit by commit, which the 1:1 layout makes mechanical: every Go file has a TS file with the same name and the same functions, so a Go diff says exactly what to change and where.

### Facts (checked 2026-10-10)

- **Remotes:** `origin` is the fork `spiochacz/lute`; `upstream` is `88250/lute` (added 2026-10-10). The local `master` equals `upstream/master` at `8e7896b6`.
- **Tags:** upstream has 58 tags; the newest is `v1.7.8` (2026-09-23), and `master` is 5 commits past it. The fork has no tags of its own. The `Version` constant in `lute.go` still says `1.7.6`, so it is not a reliable version marker; use tags and commit hashes.
- **Pace:** about 20 commits per month touch Go code (7 to 43 over the last 12 months). In the last 90 days: 77 non-test commits, about 4,800 lines added and 1,000 deleted across 67 files, close to 9% of the codebase per quarter.

Syncing is therefore continuous work, not a rare event, and upstream will move by dozens of commits while the port is being written.

### Process

1. **One recorded pin.** A file in `ts/` holds the Go commit hash the port corresponds to.
2. **List what is pending:** `git log <pin>..upstream/master -- '*.go'`. Each upstream commit becomes one change in TS.
3. **Port commit by commit, not in bulk.** Upstream writes one commit per bug or feature, usually with an issue link and a test. The Go diff maps onto the same functions in TS, and the test from the commit is ported with it.
4. **Verify each change:**
   - the new test from the commit passes in TS;
   - the whole test suite still passes;
   - comparison against an oracle rebuilt at that commit shows no differences.
5. **Move the pin** to that commit.

A "port commit X" task has a clear input (the Go diff), a clear output (the TS diff) and an automatic success criterion, so it is a good fit for automation.

### Prerequisites and rules

- **GopherJS** is needed to rebuild the oracle for new commits. Without it only the Go tests are available as a check, which is weaker because they cover chosen cases rather than arbitrary input.
- **Freeze during the port.** The pin does not move until phase 6 is done. Pending commits are ported afterwards with the process above.
- **Optimizations make syncing harder.** Every place that departs from 1:1 has to be translated by hand instead of mechanically. Keep departures in the runtime layer, and mark each one in translated code with a comment.
- **Data files are generated, not hand-ported.** `parse/emoji_map.go` and `html/entity.go` are produced by a script that reads the Go source, so updating them is a re-run.
- **Large upstream changes** (for example the tabbed container blocks added in September 2026) take more work than a bug fix, but follow the same process.

## Most-tested API paths

Verification priority, by number of uses in the Go tests: `MarkdownStr` (68), `Md2BlockDOM` (24), `BlockDOM2Tree` (15), `IsValidLinkDest` (11), `FormatStr` (10), `SpinBlockDOM` (9), `GetLinkDest` (9), `Md2VditorIRDOM` (8), `BlockDOM2StdMd` (8).

## Quiet-machine re-measurement of L2, S1 and wave 4 (2026-10-12)

Conditions: the owner said the machine was free; four stuck `python3 -` processes of this session (one core each, running since 2026-10-11) were found and stopped before these runs, so the earlier "quiet" measurements of 2026-10-11 and the first ones of 2026-10-12 had 2 to 4 of 16 threads busy. Method: `bench:macro`, 5 rounds, interleaved, saved bundles from `ts/bench/results/base/` (the "after" bundle copied to `dist/lute.min.js`, the "before" bundle as `LUTE_BENCH_REF`), methods `MarkdownStr, FormatStr, HTML2Md, Md2VditorSVDOM, Md2BlockDOM, VditorDOM2Md, SpinVditorDOM`, inputs `small` and `spec`. Results in `ts/bench/results/macro.q-*.json`. Ratio = after / before, fastest process; hashes agree in all 42 rows.

| change | before -> after | small (7 rows) | spec (7 rows) | verdict |
|---|---|---|---|---|
| L2 (format renderers, no self-copy at container close) | `w3step2` -> `w3step3` | 0.99 to 1.02 | 0.94 to 1.05 | no measurable effect |
| S1 (size-gated slices) | `w3step4` -> `s1` | 0.94 to 1.01 | 0.96 to 1.08 (`SpinVditorDOM` 1.08, `HTML2Md` 1.07; the others 0.96 to 0.99) | no measurable effect |
| wave 4 (L5, L6, L7, L9, L10) | `s1` -> `w4step5` | 0.96 to 1.02 | 0.95 to 0.99 | no measurable effect (consistently 1 to 5 percent faster on spec, below the 20 percent threshold) |

None of the three is a regression and none is a gain at method level. Nothing is reverted: the changes are correct and tested, and reverting S1 would be the larger risk. The 1.24x of the S1 experiment did not carry over to the methods (as the note in "Structural change S1" expected: the pre-sizing sites stayed on the old path).

## S1 removed (2026-10-12)

The owner decided to remove S1 ("mysle ze s1 tez trzeba usunac") after the quiet re-measurement showed no method-level gain and a CPU profile of `MarkdownStr` on the spec document explained why: the path S1 changes (`Append` on arrays of at most 64 bytes) is 4.8 percent of self time, while the in-place helpers that keep Go semantics are 11 percent and the garbage collector 4.5 percent. The port is back to plain Go capacity semantics for every slice; the 64-byte rule and the helpers `AppendInPlaceLikeGo`, `AppendByteInPlaceLikeGo`, `CapAfterByteAppends` are gone. `ts/test/e2e/table_cell_ial.test.ts` (upstream item 30 on the output) is kept.

Made as a `git revert` of `dadc57d0` (no conflict). `npm run typecheck` clean; `npm test`: 4,138 tests, 4,130 pass, 8 skipped, 0 fail. Interleaved check, bundle without S1 against the bundle with S1, both built from the same tree (`macro.q-s1-revert.json`, ratio without / with): small 0.97 to 1.06, spec 0.95 to 1.12 (`VditorDOM2Md` 1.12, `MarkdownStr` 1.09; 10 of 14 rows slower, median about 1.03); all below the 20 percent threshold, hashes agree in 14 of 14 rows. The cost of removing S1 is therefore about 3 percent, inside the noise.

## Hot/cold split of ast.Node and flat short strings (2026-10-12)

Motive: memory. The live heap of one conversion of the 212 KB spec was about 14 MB (AST 9.5 MB at 815 bytes per node, DOM tree 4.4 MB at 497 bytes per node); a 5 MB document holds about 360 MB.

Method: variants built outside the repository from a copy of `ts/src`, bundles compared with `bench:macro` (5 rounds, interleaved, idle machine, 8 methods, inputs `small` and `spec`); output hashes of 14 methods equal to the base before any timing.

1. **Field use was counted first** (a variant in which every data field of `Node` is a counting accessor; spec document, 9 methods). Of 66 fields only about 20 are touched at all; the busiest (`LastLineBlank`, `Close`, `IsFencedCodeBlock`, `CodeBlockFenceLen`, `KramdownIAL`, `ListData`, `ID`) have 5,000 to 19,000 accesses per conversion; `Children`, `TableAligns`, `FootnotesRefs` none.
2. **Split:** 17 fields stay in the object, 49 move to `ext`, created on the first write of a non-default value. AST after `Parse` of the spec: 9.50 -> 4.97 MB, 815 -> 426 bytes per node; 2,035 of 11,654 nodes get an `ext`. Time, split / base: small 0.93 to 0.97, spec 0.94 to 1.00 (15 of 16 rows faster).
3. **Flat short strings:** `conv.StringFromBytes` built ASCII strings of at most 32 bytes with `s += String.fromCharCode(b[i])`, which leaves a chain of cons-strings for every result of 13 characters or more (48,966 cons-strings in the DOM tree of the spec). One `String.fromCharCode.apply` instead: DOM tree 4.42 -> 3.11 MB, 497 -> 350 bytes per node. Time, flat / base: 0.97 to 1.04 (no change). My first diagnosis ("the HTML parser appends text to text nodes") was wrong: the parser makes 0 such appends on this document.
4. **Both:** small 0.91 to 1.01, spec 0.89 to 1.00 (15 of 16 rows faster; `SpinVditorDOM` spec 0.89, `BlockDOM2Md` spec 0.90, `MarkdownStr` spec 0.91). 5 MB document, repeated `VditorDOM2Md` calls: first call 1,074 -> 925 ms, later calls about 3,070 -> 2,700 ms, garbage-collection pauses per call about 780 -> 520 ms, heap after a call about 368 -> 260 MB.

Each row is below the 20 percent threshold of the benchmark; the direction is the same in 15 of 16 rows in two independent runs. Adopted for the memory (the owner's interest) with a small time gain. `npm run typecheck` clean, `npm test` 4,138 tests, 4,130 pass, 8 skipped, 0 fail.

Not done: releasing the DOM root before rendering; attribute arrays only for elements with attributes (up to 0.5 MB).

## Optimisation wave 5 (2026-10-12)

Source of the candidates: a CPU profile of `VditorDOM2Md` on the spec document (tokenizer 20 percent, DOM passes and tree building 24 percent, `strings.ReplaceAll` 8 percent, `conv` 7 percent, entities 7 percent) and the analysis in `007-bytes-string-conversions-in-html-path.md`. Implemented by a Haiku agent, one step at a time, each with a micro measurement on recorded real inputs (results compared on every input, two processes) as its gate; verified by the coordinator. Base: commit `fb0a64c7`.

| step | what | why it was slow | gate measurement (new / old time, or speed-up) | kept |
|---|---|---|---|---|
| W1 | `runtime/conv.ts`: interning cache for decodes of at most 32 bytes (4,096 direct-mapped slots, hit verified by byte comparison), one fill loop for ASCII encodes up to 256 units | about 46,000 small conversions per call; Go pays nothing for them | decodes 0.65x and 0.80x, encodes 0.92x and 0.83x (warm cache; a cold replay in a fresh process is at parity) | yes |
| W2 | `bytes.Buffer.String()` through `conv.StringFromBytes` | it still used the validate-then-decode path that `conv` left in wave 1 | 0.26x to 0.32x on the arrays of one `HTML2Md` / `VditorIRDOM2Md` call | yes |
| W3 | entities: common names looked up by bytes; `UnescapeHTML` clones when there is no `&` | 15,848 entity-name decodes per call; a decode/encode round trip for text without entities | unescape 0.85x / 0.62x, `UnescapeHTML` 0.77x / 0.55x | yes |
| W4 | the preprocess of `VditorDOM2Md` / `VditorIRDOM2Md`: one pass over the line feeds instead of three `ReplaceAll` passes | not the matches (20 in the spec DOM) but three full scans of 515 KB and a split/join rebuild | 2.2x to 2.4x faster (WYSIWYG), 2.4x (IR); 100,000 random strings equal to the three-call version | yes |
| W5 | `adjustMath`: a cheap `Contains` test before the class list is split | `strings.Fields` allocated for every node | 1.45x to 2.7x faster; DOM after the pass identical | yes |
| W5 | `searchEmptyNodes`: reorder of a trim | | 1.08x to 1.13x, inside the bias of the harness | reverted |
| W5 | highlight-span pass | 1.2 percent of the call, no safe saving found | | not changed |

Not explained: 89 percent of the time of `searchEmptyNodes` is its own code and the cause was not found.

**Whole methods, coordinator's run** (`bench:macro` with the new short-process defaults, 12 rounds, interleaved, bundle of this state against a bundle built from `fb0a64c7`; ratio new / old on the fastest process; hashes agree in 14 of 14 rows; 35 of 336 processes discarded by the canary):

| method | small (1 KB) | spec (212 KB) |
|---|---|---|
| `VditorDOM2Md` | 0.93 | 0.86 |
| `HTML2Md` | 0.98 (weak row: 13 of 24 processes discarded) | 0.94 |
| `BlockDOM2Md` | 0.92 | 1.03 |
| `SpinVditorDOM` | 0.96 | 0.96 |
| `SpinBlockDOM` | 0.97 | 0.99 |
| `Md2VditorDOM` | 0.99 | 0.99 |
| `MarkdownStr` (control: none of the steps is on its path except W1) | 0.97 | 0.97 |

Reading: the control shows a bias or noise of about 3 percent in favour of the new bundle, so only `VditorDOM2Md` (7 and 14 percent) and perhaps `HTML2Md` spec and `BlockDOM2Md` small stand out; the rest is not resolved by this benchmark. Absolute times of this run, port: `VditorDOM2Md` 224 µs / 27.1 ms, `HTML2Md` 311 µs / 30.2 ms, `MarkdownStr` 154 µs / 20.9 ms.

**Tooling added in the same wave:** `ts/DEPARTURES.md` (generated: every `PORT-NOTE` of `ts/src`, 493 rows, and the oracle patches), `npm run departures`, `npm run departures:pin-diff -- <old> <new>` (which departures name a Go file that changed between two upstream commits), and `ts/test/departures.test.ts` (fails when the manifest is stale).

**Benchmark tooling:** this run is also the first use of the short-process `bench:macro` (canary per child, 12 rounds, discarded processes reported). It works; about 10 percent of the processes were discarded, one row lost more than half.

Tests: `npm test` 4,176 tests, 4,168 pass, 8 skipped, 0 fail (coordinator); `npm run test:full` 4,187 tests, 4,179 pass, 0 fail, and the cache fuzzer in both modes with 0 mismatches (agent).
