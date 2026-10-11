# gen-util-vectors

Generates `ts/src/util/testdata/util_vectors.json`, the oracle for
`ts/src/util/util.vectors.test.ts`.

The generator calls the real Go `util` package (built with `-tags javascript`)
for every exported function of the files ported in scope A: `byte_strjs.go`,
`panicjs.go`, `ial.go`, `rune.go` and `url.go`. Inputs:

- string functions: 143 valid UTF-8 strings (`strCorpus`) covering empty, ASCII,
  CJK, emoji, combining marks, the caret, reserved characters, `%` with 0-2 hex
  digits, invalid hex, percent-encoded multi-byte and invalid UTF-8, `+`,
  query-like and path-like strings;
- byte functions: every string of `strCorpus` as bytes, plus invalid UTF-8;
- `ContainsStr`: every string with 8 sets of second arguments;
- `IsDocIAL2`: empty, every single IAL item and every ordered pair of items
  (items with too few elements make Go panic, recorded as `"panic": true`);
- `RecoverPanic`: 143 calls with a nil or a non-nil error.

Each string result has `ret` (the Go string where invalid bytes became U+FFFD,
as Go ranges over it), `retHex` (the exact bytes) and `retValid`. Errors are
recorded as `err` and `errMsg` (the Go `Error()` text).

The module is separate (`go.mod` replaces `github.com/88250/lute` with the
repository root), so the root `go.mod` and `go.sum` are not touched. `go mod
tidy` creates a `go.sum` here only.

Regenerate (system Go at `C:\Program Files\Go\bin\go.exe`):

```sh
cd ts/tools/gen-util-vectors
GOTOOLCHAIN=local "/c/Program Files/Go/bin/go.exe" run -tags javascript . > ../../src/util/testdata/util_vectors.json
```

Then run the tests from `ts/`:

```sh
node --test src/util/util.vectors.test.ts
```

## html subcommand: util/html.go

`html_vectors.go` (subcommand `html`) calls every helper of `util/html.go` that
takes a node on the elements of a corpus of 199 documents, and writes
`ts/src/util/testdata/util_html_vectors.json` (about 1.0 MB), the oracle for
`ts/src/util/util_html.vectors.test.ts`. The corpus:

- 86 hand-written documents (`htmlDocs`): nested and inline elements, entities,
  empty values, duplicate and upper-case keys, `data-*` and `custom-*`
  attributes, class lists, `&nbsp;`, zero-width spaces, the caret, CJK, emoji,
  `<br>`, `<wbr>`, comments, tables, task lists and editor markup;
- 56 Markdown snippets (`markdownSnippets`), each rendered by `Md2BlockDOM` and
  by `Md2VditorDOM` on a `lute.New()` engine with inline math, block refs, tags,
  file annotation refs, sup, sub and mark enabled: 55 + 56 documents. One snippet
  (the link reference definition `[ref link][r]`) makes `Md2BlockDOM` panic in
  `render/protyle_renderer.go` (`renderLinkRefDef`, nil `LinkDest`); the panic is
  recovered, the document is skipped and "skipped snippet" is printed to stderr;
- the first 150 lines of `benchmark/commonmark-spec.md` through both engine
  functions: 2 documents.

`ast.Testing = true` fixes the node IDs, so the file does not change between runs.

Each document is recorded with its `src`, the rendered result of `ParseHTML(src)`
(`null` when Go returns nil) and one record per element, in document order, with
its path (child indexes from the node `ParseHTML` returns, `""` for that node).
Helpers and arguments recorded per element:

- `DomHTML`; `DomText`; `IsTempMarkSpan`;
- `DomAttrValue` and `ExistDomAttr` for every name in `attrNames` (every attribute
  key of the corpus plus two that do not occur);
- `DomCustomAttrs`; `DomAttrValuesWithPrefix` for every entry of `prefixes`;
- `DomChildByTypeAndClass` for every entry of `classQueries` (the result path);
- `DomChildrenByType` for every atom of `atomNames` (the result paths);
- `DomExistChildByType` for every entry of `existQueries` (an empty list and a
  two-atom call included);
- `GetTextMark*Data`, `GetTextMarkAData`, `GetTextMarkBlockRefData`,
  `GetTextMarkFileAnnotationRefData`, `GetFormula` and `DomTexhtml` on every
  `span` and `img`;
- `SetDomAttrValue`, `RemoveDomAttrs` and `RemoveDomAttr`: for each element the
  rendered node after the change, made on a fresh parse of `src`.

Encoding: a result that is the zero value (`null`, `""`, `false`, an empty list)
is left out of the element record, and the test reads the missing field as the
zero value, so every element still checks every query. A string longer than 200
bytes is stored as `{"sha256", "len"}` of its UTF-8 bytes. The generator
panics if `DomAttrValue` returns a non-empty value for an absent attribute.

Regenerate (system Go at `C:\Program Files\Go\bin\go.exe`; `go.sum` is a copy of
the root `go.sum`, and `go mod tidy` was run in this directory):

```sh
cd ts/tools/gen-util-vectors
GOTOOLCHAIN=local "/c/Program Files/Go/bin/go.exe" run -tags javascript . html > ../../src/util/testdata/util_html_vectors.json
```

Then run the tests from `ts/`:

```sh
node --test src/util/util_html.vectors.test.ts
```
