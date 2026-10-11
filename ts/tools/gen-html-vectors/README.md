# gen-html-vectors

Three parts:

1. `convert-entity.mjs` writes `ts/src/html/entity.ts` from `html/entity.go`. It
   copies the `Entities` table (2125 entries, name to one or two code points)
   into string data that `entity.ts` decodes on first use. Regenerate it after
   `html/entity.go` changes:

   ```sh
   cd ts
   node tools/gen-html-vectors/convert-entity.mjs
   ```

2. `main.go` (no argument) runs the real Go `html` package on a fixed corpus and
   writes `ts/src/html/testdata/escape_vectors.json`, the oracle for
   `ts/src/html/escape.vectors.test.ts`. It calls every exported function of
   `entity.go`, `escape.go`, `escape_encode.go` and `unesc_str.go` (except
   `escape`, which `EscapeString` calls), and dumps the complete `Entities`
   table. The unexported functions `unescape`, `unescapeEntity`, `lower`,
   `parseEntity`, `isValidEntityCode`, `unhex` and `advance` are reached through
   `go:linkname` pulls in `linkname.go` (`empty.s` makes the body-less
   declarations compile).

   Size rules (the file is 1.43 MB): `UnescapeString`, `HtmlUnescapeString` and
   `unescapeEntity` cover every entity name. The wrapper functions
   (`UnescapeHTMLStr`, `UnescapeAttrVal`, `UnescapeBytes`, `UnescapeHTML`,
   `unescape`, `parseEntity`) use a sample: every 16th name, sorted
   (`sampledNames`), plus all the non-entity edge cases. The overlapping
   `dst = 0` case of `unescapeEntity` is used for the base strings and the sampled
   names only.

3. `token_vectors.go` (subcommand `token`) runs the real Go tokenizer
   (`html/token.go`) on a corpus of 680 documents and writes
   `ts/src/html/testdata/token_vectors.json`, the oracle for
   `ts/src/html/token.vectors.test.ts`. Each document is tokenized three ways on a
   fresh copy of its input: high level (`Next`, `Raw`, `Token`), low level (`Next`,
   `Raw`, `Text`, `TagName` and `TagAttr`), and `NewTokenizerFragment` with the
   contexts script, style, textarea, title, plaintext, iframe, noscript, xmp and div.
   The corpus is: hand-written documents (plain text, tags, attributes, comments,
   doctypes, CDATA, processing instructions, raw text, NUL, CR/LF, CJK, emoji,
   invalid UTF-8, the editor caret), attribute combinations, raw text elements with
   bodies, 150 random documents (fixed seed), and three large documents: the Lute
   engine's output on the first 300 lines of `benchmark/commonmark-spec.md` for
   `MarkdownStr`, `Md2BlockDOM` and `Md2VditorDOM` (fragment runs for these use only
   the div context). Byte values are JSON strings when they are valid UTF-8 and
   `{"hex": "..."}` when they are not. Block IDs written by `Md2BlockDOM` are
   replaced by a fixed ID of the same length, so the file does not change between runs.

4. `node_vectors.go` and `node_linkname.go` (subcommand `node`) run 300 random
   scenarios of operations on `html.Node` trees and on the `nodeStack` of
   `html/node.go`, and write `ts/src/html/testdata/node_vectors.json`, the oracle
   for `ts/src/html/node.vectors.test.ts`. The exported tree methods are called
   directly. `reparentChildren`, `(*Node).clone` and the `nodeStack` methods are
   unexported and are reached through linknames. Each operation's result (a panic
   flag or the returned value) and the final links, stack, tree dumps and
   consistency are recorded.

5. `parse_vectors.go` (subcommand `parse`) runs the real tree construction
   (`html/parse.go`, with `render.go`, `doctype.go` and `foreign.go`) and writes
   `ts/src/html/testdata/parse_vectors.json`, the oracle for
   `ts/src/html/parse.vectors.test.ts`. The corpus is the 680 tokenizer documents of the
   token vectors (the same inputs, built by the same functions as `writeTokenVectors`)
   and 663 tree-construction documents: 593 hand-written cases (`parseTreeCases`, grouped
   by topic, some invalid UTF-8) and 70 generated deep nests. For each document:
   - `Parse`, with the tree `[document]`;
   - `ParseFragment` with each of the 18 contexts (`parseContexts`); documents larger than
     2048 bytes run only `body` and `div`;
   - `ParseWithOptions(..., ParseOptionEnableScripting(false))` when the lower-cased input
     contains `noscript`.
   Each run records its canonical dump, the rendered bytes (`Render` of each node into one
   buffer, stopping at the first error), and the error texts. A Go panic is recorded as a
   run that must panic in TypeScript.

   Canonical dump of a node list (a JSON text, no whitespace, keys in this order):
   `[` node, node, ... `]`, where a node is
   `{"t":T,"d":S,"a":A,"n":S,"at":[[S,S,S],...],"c":[node,...]}`: `T` the node type, `S` a
   string, `A` the DataAtom, `n` the namespace, `at` the attributes (namespace, key,
   value) and `c` the children, in order. A string `S` is written with `"` and `\` escaped
   and the characters below 0x20 as `\u00xx` (lowercase hex); every other character is
   written as is. Go's `json` escaping is not used.

   Storage (JSON): a node is `[T, data, A, namespace, [[ns, key, value], ...], [children]]`.
   Records are kept once in a table (`records`), with distinct content:
   `["f", tree, render]` (full mode), `["h", treeSha, treeLen, renderSha, renderLen]`
   (hash mode, SHA-256 hex over the UTF-8 bytes of the canonical dump and of the rendered
   bytes), `["p", message]` (Go panic). When an error is not null, `err` and `renderErr` are
   appended to the record. Each document is `{name, valid, input, mode, parse, frag,
   noscript}`: `parse` and `noscript` are record indexes (`noscript` null when not run),
   and `frag` has one index per entry of `contexts`, null when the context is not run.
   Documents up to 2048 bytes are in full mode; larger ones in hash mode.

   Invalid UTF-8 (`"valid": false`, input as `{"hex": ...}`): every string that goes into a
   dump or a rendered output is passed through the per-byte lossy step (each invalid byte
   becomes one U+FFFD, as `conv.StringFromBytes`), so the stored values are the lossy Go
   output.

   The file is 1.43 MB. Decisions: the 18-context fragment runs use the record table (this
   keeps all contexts for all documents within the 1.5 MB limit; per-document records with
   key names were 6.6 MB).

The module is separate (`go.mod` replaces `github.com/88250/lute` with the
repository root), so the root `go.mod` and `go.sum` are not touched. The module
needs the root `go.sum` entries for the root package's dependencies (the large
documents import `github.com/88250/lute`). `go.sum` in this directory is a copy of
the root `go.sum`; copy it again if the root file changes. Run with the system Go at
`C:\Program Files\Go\bin\go.exe`:

```sh
cd ts/tools/gen-html-vectors
cp ../../../go.sum go.sum
export GOTOOLCHAIN=local GOPROXY=off
GO="/c/Program Files/Go/bin/go.exe"
"$GO" vet -tags javascript .
"$GO" run -tags javascript . > ../../src/html/testdata/escape_vectors.json
"$GO" run -tags javascript . token > ../../src/html/testdata/token_vectors.json
"$GO" run -tags javascript . node > ../../src/html/testdata/node_vectors.json
"$GO" run -tags javascript . parse > ../../src/html/testdata/parse_vectors.json
```

`go run` may add the `indirect` requirements of the root package to `go.mod` of
this directory (`github.com/gopherjs/gopherjs`, `golang.org/x/text`). That is
expected. Then run the tests from `ts/`:

```sh
cd ts
node --test src/html/escape.vectors.test.ts src/html/token.vectors.test.ts src/html/node.vectors.test.ts src/html/parse.vectors.test.ts
```

Notes:

- Byte slices in `escape_vectors.json` are lowercase hex. A Go nil slice is `null`;
  an empty slice is `""`. Each vector is an array: `[args, ret]`, `[args, null, true]`
  for a Go panic, or `[args, ret, false, after]` for an in-place call.
- Strings in `escape_vectors.json` are JSON strings. They are valid UTF-8 only; the
  byte-taking functions get invalid UTF-8 inputs.
- In-place calls (`unescape`, `lower`, `unescapeEntity`) record `after`, the buffer
  after the call.
- A Go panic is recorded as `"panic": true` (`unhex` on a non-hex byte).
- In `token_vectors.json`, `high` tokens are `[type, dataAtom, data, attrs, raw, string]`;
  `low` tokens are `[type, raw, text]` for text-like tokens and
  `[type, raw, name, hasAttr, [[key, value, more], ...]]` for tags. Empty lists are
  `[]`, not null.
- In `node_vectors.json`, an operation's result is `[panic, value]`; indices are
  node indices with -1 for nil, and `clone` returns the index of the new node.
