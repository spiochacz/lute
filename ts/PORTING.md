# Porting rules

Lute is ported from Go to TypeScript one file at a time, 1:1. These rules are binding for every ported file. Background and reasons are in `../tasks/001-analysis.md`.

The Go commit being ported is in `UPSTREAM_PIN`.

## Ground rules

- **1:1.** Same file names, same declaration order, same function and field names, same control flow. No refactoring, no "improvements", no reordering, no merging of functions.
- **Do not fix upstream bugs, but record them.** If Go code looks wrong (a panic on plausible input, a comment that contradicts the code, an off-by-one, dead or unreachable code, a wrong condition), port it exactly as it is and mark the line `// UPSTREAM-BUG: <one-line description>`. List every such marker in your report with the Go file and line, what happens, and the smallest input you know that triggers it. The coordinator adds them to `../tasks/002-upstream-bugs.md`; they are fixed later, in Go first.
- **Port the `javascript` build variant.** Where Go has two files selected by build tags, port the one tagged `javascript` and give it the base name: `util/byte_strjs.go` → `util/byte_str.ts`, `util/panicjs.go` → `util/panic.ts`. Skip files tagged `!javascript`.
- **English only.** Translate Chinese comments to English and keep them at the same place. Keep issue links unchanged.
- **Erasable TypeScript.** No `enum`, no `namespace`, no parameter properties, no decorators. Node runs the `.ts` files directly.
- **Do not benchmark.** If something looks slow, add a `// PERF-TODO:` comment with one line of explanation and mention it in your report.

## Files, packages, imports

- `pkg/file.go` → `ts/src/pkg/file.ts`. First line: `// Ported from pkg/file.go @ <first 8 chars of UPSTREAM_PIN>`. Then the file's original license header, in English.
- Every Go package directory gets `ts/src/pkg/index.ts` containing only `export * from "./file.ts";` lines, one per file.
- Another package is imported as a namespace through its index, so code reads like Go:
  `import * as lex from "../lex/index.ts";` then `lex.ItemNewline`.
- A file in the same package is imported by name: `import { IsWhitespace } from "./token.ts";`. Go identifiers that are unexported (lower case) but used from another file of the package are exported from their file.
- Runtime layer (Go standard library): `import * as bytes from "../runtime/bytes.ts";`, likewise `strings`, `strconv`, `utf8`, `unicode`, `slices`, `conv`.
- Imports always carry the `.ts` extension. Type-only imports use `import type`.

## Types

| Go | TypeScript |
|---|---|
| `[]byte` | `Uint8Array` |
| `string` | `string` |
| `byte`, `rune`, `int`, other integers | `number` |
| `bool` | `boolean` |
| `[]T` (not bytes) | `T[]` |
| `map[K]V` | `Map<K, V>` |
| `*T` | `T \| null` |
| `error` | `Error \| null` |
| `type X int` with constants | `export type X = number;` plus `export const A = 0;` (never `enum`) |
| `func` types | function type aliases |

- **nil slices.** A byte slice is `Uint8Array \| null` only where the Go code tells nil and empty apart: it compares the value with `nil`, or a caller compares the function result with `nil`. Search for the callers before deciding. Everywhere else use `Uint8Array` and an empty array for the zero value. Runtime functions never accept or return `null`.
  **Where the nil comes from.** Nullable locations are `ast.Node.Tokens`, `ast.Node.CodeBlockCloseFence`, `ast.Node.KramdownIAL` and the locals, results and fields that Go compares with `nil` (`parse/link.go:55,60,328`, `parse/inline.go:195`, `parse/inlines.go:66,120`, `render/html_renderer.go:1136,1179`, `render/renderer.go:539,555`). A runtime function returns an empty array where Go returns nil, so when the result of a function in the table below is *assigned to a nullable location* (a `Tokens` field, a nullable local, a nullable return value, an argument that a callee compares with nil) the call must give `null` exactly when Go gives nil: wrap it as the table says. Where the result only goes to a local that is read (length, `HasPrefix`, `Split`, writing), the empty array is correct and no wrapper is needed. The reverse also holds: do not write `x ?? empty` into an argument whose Go result is nil for a nil input and then store the result in a nullable location; use `slices.KeepNil(x, f)` (or `lex.TrimWhitespace(x)`, which accepts and returns `null`). Go's `append(x, y...)` is nil only when `x` is nil and `y` is empty (`Node.AppendTokens` does this by hand). Slicing a nil slice (`s[0:0]`) is nil, slicing a non-nil one never is. Conversions `[]byte(str)`, `make`, `[]byte{}`, `bytes.Buffer.Bytes()` and literals are never nil.
  Helpers (`runtime/slices.ts`, `runtime/bytes.ts`; each is tested against the nil flags that Go 1.21.13 recorded in `runtime/testdata/bytes_vectors.json`, see `runtime/nilness.test.ts`): `slices.NilIfEmpty(b)`, `slices.KeepNil(src, f)`, `bytes.ReplaceOrNil`, `bytes.ReplaceAllOrNil`, `bytes.JoinOrNil`. `parse/tree.vectors.test.ts` compares whole parsed trees, nil-ness of `Tokens`, `CodeBlockCloseFence` and `KramdownIAL` included, with real Go (`tools/gen-parse-tree-vectors`).

  | Go function (the result of) | is nil exactly when | Port |
  |---|---|---|
  | `bytes.TrimSpace`, `bytes.Trim`, `bytes.TrimLeft`, `bytes.TrimFunc`, `bytes.TrimLeftFunc` | the result is empty (an empty non-nil input included) | `slices.NilIfEmpty(f(x))` |
  | `bytes.TrimRight`, `bytes.TrimRightFunc`, `bytes.TrimPrefix`, `bytes.TrimSuffix`, `bytes.CutPrefix`, `bytes.CutSuffix` (first result), `lex.TrimWhitespace`, `lex.Trim` (remains), `lex.TrimLeft` and `lex.TrimRight` (remains), `lex.ReplaceAll`, `lex.ReplaceNewlineSpace`, `html.UnescapeBytes`, `html.EscapeHTML`, slicing `s[a:b]` | the input is nil | `slices.KeepNil(x, f)`; `lex.TrimWhitespace(null)` is `null` |
  | `bytes.Replace`, `bytes.ReplaceAll` | `len(s) == 0` and (`n == 0` or `len(old) > 0`): nothing is replaced and `append([]byte(nil), s...)` of an empty `s` is nil. An empty `s` with an empty `old` matches once and gives a non-nil result | `bytes.ReplaceOrNil`, `bytes.ReplaceAllOrNil` |
  | `bytes.Join` | `len(s) == 1` and `len(s[0]) == 0`; no element gives `[]byte{}`, two or more give a non-nil slice | `bytes.JoinOrNil` |
  | `bytes.Split`, `SplitN`, `SplitAfter` (elements) | the element is a slice of `s`: nil only if `s` is nil. The result itself is nil only for `n == 0` | none (inputs here are non-nil) |
  | `lex.Split`, `lex.SplitWithoutBackslashEscape` (elements) | the first element, when the input starts with the separator: `var line []byte` is never appended to. Later elements are `[]byte{}` | none; the callers (`parse/table.go`) trim and replace the element, which gives the same result for nil and empty |
  | `lex.TrimLeft` (whitespaces) | no white space was found (`var whitespaces []byte` is only appended to); `parse/link.go:60` compares it | the port returns `null` |
  | `lex.TrimRight` (whitespaces), `lex.Trim` (left and right white space), `lex.Spnl` (passed) | no white space was found or the input is empty; no caller compares them with nil | the port returns an empty array |
  | `lex.Lexer.NextLine` | the input is exhausted | the port returns `null` |
  | `bytes.Repeat`, `bytes.ToLower`, `bytes.ToUpper`, `bytes.Map`, `bytes.Clone` (non-nil input), `util.StrToBytes`, `html.EncodeDestination` | never (`Clone(nil)` is nil) | none |
- **Annotate byte locals.** Write `let x: Uint8Array = new Uint8Array(0);`. Without the annotation TypeScript infers `Uint8Array<ArrayBuffer>`, which rejects a later `subarray` assignment.
- **Out-of-range reads.** Go panics on an out-of-range index; a typed array returns `undefined`. Do not add bounds checks in general. Add an explicit `throw` only where the Go vectors show a panic for some input and the TypeScript code would otherwise return a wrong value, and mark it `// PORT-NOTE: Go panics here`.
- **Reserved words** used as Go identifiers (`new`, `default`, `function`, `class`, ...) get the shortest clear rename (`nw`, `def`), with a `// PORT-NOTE:`.
- **Pointers.** Use `!` where Go dereferences without a nil check. Do not add nil checks Go does not have.
- **Structs** become classes. Declare every field and initialize all of them in the constructor, in declaration order, with Go zero values (`0`, `""`, `false`, `null`, empty `Uint8Array`, `[]`, `new Map()`). Never add a field later, never `delete` one. Methods keep their Go names, including capitalization.
- **Struct literals.** `&T{A: 1, B: x}` → `const t = new T(); t.A = 1; t.B = x;` (or an inline helper expression where a statement is impossible). Do not use `Object.assign` or spread to build structs: it allocates a throwaway object per node. Where a class documents a positional constructor for its common literal forms, use that.
- **Structs whose methods live in several files.** In Go, methods of one struct can be spread over many files of the package (`*Tree` has methods in 31 files of `parse`). Such a struct is declared as a class in `<pkg>/types.ts`, which contains only class declarations (fields and constructor) and must not import any other file of the same package at runtime (`import type` is fine). Each method is defined in the file where Go defines it, by interface merging plus a prototype assignment, so call sites keep Go's syntax `t.parseBlocks()`:
  ```ts
  import { Tree } from "./types.ts";

  declare module "./types.ts" {
    interface Tree {
      parseBlocks(): void;
    }
  }

  Tree.prototype.parseBlocks = function (this: Tree): void {
    // body, using `this` where Go uses the receiver
  };
  ```
  Use a `function` expression with an explicit `this` parameter, never an arrow function. Inside the body the receiver is `this`; when Go passes the receiver on or captures it in a closure, bind it first (`const t = this;`) and use `t` in the closure. Because methods are attached when their file is loaded, code outside the package always imports the package through its `index.ts`, which lists every file.
- **Methods on non-struct types.** A Go type that becomes a plain `number` or `string` cannot carry methods. Port each method as an exported free function named `<Type><Method>` with the receiver as the first parameter: `func (a Atom) String()` → `AtomString(a)`, called as `atom.AtomString(x)` where Go writes `x.String()`.
- **Names that collide with JS globals** (`String`, `Map`, `Object`, `Math` as Go identifiers) keep their Go name. Inside that module reach the global through `globalThis`.
- **Byte and rune literals** become numbers with the character in a comment: `'a'` → `0x61 /* a */`. Use named constants where Go does.

## Statements

- **Slicing bytes:** `s[a:b]` → `s.subarray(a, b)`. `s[:n]` where `n` may exceed the length (reslicing into capacity) → `slices.Reslice(s, n)`.
- **Slicing strings:** `s[a:b]` → `s.slice(a, b)`. JS strings are UTF-16 and Go strings are bytes. If an index comes from byte arithmetic (a byte length, a byte offset from a `[]byte` operation, a literal that counts bytes of non-ASCII text), stop and handle it explicitly, and mark the line `// PORT-NOTE: byte offset`. Indices produced by `strings.*` functions of the runtime are already UTF-16 and are safe.
- **`len(s)` of a string** → `s.length` only if the value is used as an offset into the same string or compared with another such length; if Go uses it as a byte count (width, size limit), use `utf8.ByteLen(s)`.
- **`append` on bytes:** `append(a, b...)` → `slices.Append(a, b)`, `append(a, c)` → `slices.AppendByte(a, c)`, `append(a, "str"...)` → `slices.AppendString(a, "str")`. Always assign the result, as in Go.
- **`append` on other slices:** `xs = append(xs, x)` → `xs.push(x)`; when the result goes to a different variable, build a new array.
- **Conversions:** `string(b)` → `conv.StringFromBytes(b)`, `[]byte(s)` → `conv.BytesFromString(s)`, `string(r)` for a rune → `conv.StringFromRune(r)`, `[]rune(s)` → `conv.RunesFromString(s)`.
- **`[]byte("literal")`** inside a function → a module-level constant computed once, named after its content, unless the function mutates or appends to it.
- **`for i, r := range str`** → a loop over code points with `utf8.DecodeRuneInStringPacked`; `i` is then a UTF-16 offset.
- **`for i, b := range bytes`** → an index loop.
- **Integer division** → `Math.trunc(a / b)`.
- **Multiple results** → a tuple, in Go's order. **Named results** → `let ret …` declared at the top and returned explicitly.
- **`defer`** → `try { … } finally { … }`.
- **`goto`** → a loop with a state variable and `switch`, keeping the label names as state names.
- **`panic(x)`** → `throw new Error(…)`. **`sync` mutexes** → removed.
- **`switch`** on types or values keeps its case order. Go has no fallthrough by default, so every case ends with `break` or `return`.
- **Map iteration** order is random in Go and insertion order here. Port as written.

## Tests

- A Go test file in the package (`x_test.go`) is ported to `x.test.ts` with the same cases and expected values.
- Exported functions are also checked against real Go output. A generator in `ts/tools/gen-<pkg>-vectors/` (its own `go.mod` with `replace github.com/88250/lute => ../../..`, run with the system Go and `-tags javascript`) writes JSON vectors into `ts/src/<pkg>/testdata/`, and a test asserts every vector. Inputs include empty, ASCII, CJK, emoji and invalid UTF-8 where the function takes bytes.
- **Invalid UTF-8 that passes through a string.** Go keeps invalid bytes when it converts `[]byte` → `string` → `[]byte`; a JS string cannot, so `conv.StringFromBytes` turns each invalid byte into U+FFFD. For a function that does such a round trip, vectors with valid UTF-8 input must match Go byte for byte, and vectors with invalid input must equal Go's output after the same lossy step: `conv.BytesFromString(conv.StringFromBytes(goOutput))`. Keep the two groups as separate assertions and state the reason in a comment. Do not rewrite the function to work on bytes just to match Go on invalid input. (Through the public API, input always arrives as a JS string, so it is valid UTF-8.)
- **Vector files stay small.** Aim for under 1.5 MB per package. Cover the full input space once, for the function that owns the logic, and use a sample for functions that only wrap it.
- Tests use `node:test` and `node:assert/strict`.
- A file is done when `npm run typecheck` is clean and `npm test` passes, both run from `ts/`.

## Renderers

Rules for `ts/src/render/` (the renderer files `*_renderer.ts` and the engine methods that use them).

- **Go embedding has no virtual dispatch.** In Go, a `BaseRenderer` method that calls `r.X()` runs `BaseRenderer.X` even when the embedding renderer also defines `X`. With `extends`, `this.X()` would run the override. Therefore:
  - A renderer that overrides a name of its base writes the call to the embedded method explicitly: `r.BaseRenderer.X(...)` in Go becomes `BaseRenderer.prototype.X.call(r, ...)` with `// PORT-NOTE: Go embedding, base method`.
  - A base-class method (in `renderer.ts`, `link.ts`, `space.ts`, `term_typographer.ts`, `custom_block_renderer.ts`, `tabs.ts`) that calls a name which some renderer overrides must call the base version explicitly in the same way. The names overridden somewhere are `Render`, `renderToC`, `renderDefault`, `Text`, `Newline`, `Write`, `WriteByte`, `WriteString`; check this list before adding a base-class call to any of them.
  - `TextBundleRenderer.Render` returns two values while the embedded `Render` returns one, which a TypeScript subclass cannot declare. The base class is typed as `FormatRenderer` without `Render` and `renderLinkDest` (one cast, documented in `textbundle_renderer.ts`); at run time it is a subclass of `FormatRenderer`.
- **Where the classes live.** A renderer class whose methods are all in one Go file is declared in its own `<name>_renderer.ts` with ordinary class-body methods. A class with methods in several Go files (`BaseRenderer`, `HtmlRenderer`, `FormatRenderer`, `ProtyleRenderer`, `ProtyleExportMdRenderer`) is declared in `render/types.ts` (fields and constructor only) and its methods are attached by interface merging and prototype assignment in the files where Go defines them (see "Structs whose methods live in several files"). `render/tabs.ts` holds all methods of `render/tabs.go`.
- **`nodeTokens(n)`** reads a node's possibly-null `Tokens` where Go only uses their length or content; read `n.Tokens` directly where Go compares with nil.
- **Factory functions do the registration.** `NewXRenderer(...)` has Go's signature, creates the instance and fills `RendererFuncs` in Go's order (`ret.RendererFuncs.set(ast.NodeDocument, ret.renderDocument.bind(ret))`). The constructor of the class does not register anything. Registration looks up methods at call time, so the factory works whenever the renderer file is imported, directly or through `render/index.ts`; the renderer files import `tabs.ts` (and `link.ts`, `space.ts`, `term_typographer.ts`) for the methods they attach. `render/types.ts` must not import another render file at runtime.
- **Shared declarations.** A package-level Go identifier is exported once from the file where Go declares it (`headingLevel` from `html_renderer.ts`, `reverse` from `protyle_export_md_renderer.ts`, `isTableCellIALNode`, `tableCellStructIALTokens`, `tableCellFullIALTokens` from `format_renderer.ts`) and imported by the others; no private copies.
- **`ast.SetTesting(true)` is a module-level switch** (fixed node IDs and timestamps). Any test that turns it on must turn it off in a `finally` or `after` hook: other tests compare with the reference bundle, whose IDs are random.
- **Tests and tools do not write to shared locations with fixed names** (no `/tmp/x.txt`); use a per-run directory from `fs.mkdtempSync` or the scratchpad given to you, and remove it.
- **Never kill processes by name** (`Stop-Process node`, `pkill node`, `taskkill /im`): they can hit unrelated programs on the machine. Stop only a process you started, by its ID.
- **No git commands that change state**: no `git checkout`, `git stash`, `git reset`, `git clean`, `git commit`, `git add`; `git status`, `git diff` and `git log` are fine.

## The engine (`Lute`) and the editor converters

Rules for the files of Go's root package (`lute.go`, `h2m.go`, `h2m_code_banner.go`, `protyle.go`, `protyle_tabs.go`, `vditor_ir.go`, `vditor_sv.go`, `vditor_wysiwyg.go`) and `global.ts`.

- **Methods of `Lute` are attached per file.** `class Lute` is declared in `src/types.ts` (fields and constructor only). Every method is attached in the TypeScript file that corresponds to the Go file that defines it, by interface merging and prototype assignment (`declare module "./types.ts" { interface Lute { ... } }`, then `Lute.prototype.X = function (this: Lute, ...) { const lute = this; ... }`). Do not declare another file's methods. Call sites keep Go's syntax (`lute.HTML2Markdown(...)`). Code outside the package imports `src/index.ts`, which lists every file; a test that imports `lute.ts` alone does not get the methods of the other files.
- **Unexported methods** (lower-case Go names) are attached the same way. They are visible on the object in TypeScript, but `global.ts` makes them non-enumerable when the global object is built, so that a JavaScript consumer sees the same members as in the GopherJS build.
- **`defer`.** Port it with `try { ... } finally { ... }` around exactly the rest of the function body that Go's defer covers: it must run on every return path and on a panic. Three patterns are in use:
  1. A plain `try/finally` where the defer is registered at the top of the function (the usual case, for example the `defer func() { lute.ParseOptions.KeepEscaped = keepEscaped }()` of `Md2BlockDOMTree` and `Md2BlockDOMWithAutoLink` in `protyle.ts`).
  2. A boolean flag (or one flag per deferred call) that the `finally` clause checks, where Go registers the defer conditionally inside a `switch` case of a long function and at most one or two defers can be live (`protyle.ts` `genASTByBlockDOM`: `deferParentTip`, and the block IAL `defer tree.Context.TipAppendChild(ial)`). Acceptable when the order of the flagged calls in the `finally` clause is Go's last-in-first-out order and no loop can register the same defer twice.
  3. A local list of closures (`const deferred: Array<() => void> = []`) that is pushed to where Go registers the defer and run in reverse order by one `finally` around the whole body (`vditor_ir.ts` `genASTByVditorIRDOM`, `h2m.ts` `genASTByDOM`). Use it where the registrations are many, spread over the function, or can happen more than once. A comment `PORT-NOTE:` at the top of the file or at the list says so.
  Never move the deferred call to "just before the return": the functions have many early returns.
- **`recover`.** `util.RecoverPanic` is an empty function in this build, so a panic is an exception that propagates. A function that calls `recover()` directly to swallow a panic is ported with a `catch`; say so in a `PORT-NOTE`.
- **Where Go panics, the port throws.** The public methods must throw exactly when the reference bundle throws (the end-to-end tests and `test/e2e/throw_parity.test.ts` check this). A slice, index or conversion that Go would panic on, and that TypeScript would silently accept (`str.slice` past the end, a negative `bytes.Repeat` count, a property read of `null` that gives `undefined`), gets an explicit `throw new Error("runtime error: ...")` marked `// PORT-NOTE: Go panics here`, plus `// UPSTREAM-BUG:` when the panic is on reachable input. Add the throw only where the reference bundle is shown to throw; do not add bounds checks in general.
- **Maps at the JavaScript boundary.** The engine methods take and return `Map<string, string>` (`GetEmojis`, `PutEmojis`, `GetTerms`, `PutTerms`, `SetEmojis`, `SetTerms`); the engines created through the global `Lute.New` convert from and to plain objects, as GopherJS does.
- **The bundle.** `src/bundle.ts` is the entry of the script build and only assigns `makeGlobal()` to `globalThis.Lute`, like `main()` of `javascript/main.go`.

## End-to-end tests against the reference bundle

- **The oracle** is `test/oracle/lute.ref.min.cjs`, a GopherJS build of the Go code at `UPSTREAM_PIN` plus the patches in `tools/oracle/patches/` (see `test/oracle/README.md` for the rebuild; `LUTE_ORACLE` points the harness at another bundle, for example `javascript/lute.min.js`). `test/oracle/oracle.ts` loads it; `test/e2e/helpers.ts` creates a port engine and an oracle engine from the same list of setter calls (`newEngines`) and compares outcomes (`attempt`, `assertSameOutcome`). Output is compared after `normalizeOutput` (generated node IDs and `updated` timestamps).
- **If the oracle throws, the port must throw; if the oracle returns, the port must return the same text.** Only-one-side-throws is a failure. A test that sees both sides throw counts those inputs by name.
- **DOM inputs come from the oracle.** The inputs of DOM-taking methods (`SpinVditorDOM`, `VditorDOM2Md`, `SpinBlockDOM`, `BlockDOM2Md`, `BlockDOM2StdMd`, `HTML2Md`, ...) are produced by the oracle's own forward methods from Markdown (`Md2VditorDOM`, `Md2VditorIRDOM`, `Md2VditorSVDOM`, `Md2BlockDOM`, `MarkdownStr`), optionally mutated the way an editor does (caret `<wbr>` or `‸`, text changes, tags, dropped attributes), and then fed to both engines. A hand-written DOM shows the shape the author expected, not the shape the editors produce. The oracle cannot take or return tree objects (`BlockDOM2Tree`, `Tree2HTML`, ...; its externalisation overflows the stack), so tests of those methods use the port alone.
- **Use the real engine method.** Tests call the engine method under test (`lute.Md2BlockDOM`, ...), never a local re-implementation of its body in a helper.
- **A "known difference" list names exact inputs.** Never filter by a class of outcome ("the parser throws", "oracle threw ... out of range"): a broad filter once hid a real bug. A known difference is an exact input (or an exact input and method) with the reason; the test fails if the input stops differing.
- **Test mutators do not split surrogate pairs.** A function that inserts, deletes or cuts at a UTF-16 index must move the index off the middle of a pair (or work on code points). A lone surrogate is not a valid input of a public method.
- **Sampling.** `test/e2e/full.ts` decides how much a test runs: `npm test` runs a deterministic sample, `npm run test:full` (which loads `.env.full`) runs everything. Tests that cross a large corpus with many option sets use `sample()` from that file: every document under the base option sets, a fraction of the others. Tests of Go's own cases (with Go's expected values), the spec cases under the base option sets and the regression cases always run in full.
- **The throw-parity scan** (`test/e2e/throw_parity.test.ts`) compares only whether each side throws, over corpora with the caret at every position and random marker sequences, for six engine configurations, forward and then reverse (on the oracle's DOM). A mismatch is reduced to a small input and reported; fix it at its root (an explicit throw where Go panics).
- **The bundle test** (`test/e2e/bundle.test.ts`) builds `dist/lute.min.js` and loads it, and the reference bundle, each in its own child process (`bundle_driver.mjs`), and compares the global object, an engine's function-valued members and the results of a fixed list of calls.
- **A deliberate departure from the JavaScript build** is made as a Go patch in `tools/oracle/patches/` plus a rebuilt `test/oracle/lute.ref.min.cjs`, never as a filter in the tests. The port then follows native Go for that behaviour, and each such place in the port carries a `// PORT-NOTE:` that names the item in `../tasks/002-upstream-bugs.md`.

## Code without a Go counterpart

`ts/src/incremental/` (the per-child cache for `VditorDOM2Md` and `VditorIRDOM2Md`, tasks/004 "Milestone B specification") has no Go counterpart. It is not part of the 1:1 port: its files are exempt from the naming rules above and carry the header `// New in the TypeScript port: no Go counterpart ...`. It is opt-in: with no engine enabled, the two public wrappers run one integer test and then the normal path. It must not change the behaviour or the public surface of the engine when off (`test/e2e/bundle.test.ts`). It may use `Proxy` and `Object.defineProperty`, and it is tested by differential tests against the normal path (engine B, the same setters, feature off), not against Go. The 1:1 rules still apply to every ported file that the cache calls, and the hooks in those files are marked `// PORT-NOTE: hook for the per-child cache (tasks/004)`.
