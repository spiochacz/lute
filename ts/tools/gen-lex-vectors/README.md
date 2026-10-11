# gen-lex-vectors

Generates `ts/src/lex/testdata/lex_vectors.json`, the oracle for
`ts/src/lex/lex.vectors.test.ts`.

The generator calls the real Go `lex` package (every exported function of
`lex/token.go`, and `NewLexer` and `NextLine` of `lex/lexer.go`) on a fixed
corpus of about 90 byte inputs. Byte predicates cover all 256 byte values. The
rune predicate `IsUnicodeWhitespace` covers U+0000-U+2FFF and the blocks
U+3000-U+303F, U+4E00-U+4E7F, U+FF00-U+FFEF and U+1F600-U+1F64F, plus a few
known spaces and joiners. Go panics are recorded as `"panic": true`. The module
is separate (`go.mod` replaces `github.com/88250/lute` with the repository
root), so the root `go.mod` and `go.sum` are not touched.

Regenerate (system Go at `C:\Program Files\Go\bin\go.exe`):

```sh
cd ts/tools/gen-lex-vectors
GOTOOLCHAIN=local "/c/Program Files/Go/bin/go.exe" run -tags javascript . > ../../src/lex/testdata/lex_vectors.json
```

Then run the tests from `ts/`:

```sh
node --test src/lex/lexer.test.ts src/lex/lex.vectors.test.ts
```

Notes:

- Byte slices are lowercase hex. A Go nil slice is `null`; an empty slice is `""`.
- In-place calls (`ReplaceAll`, the lexer input buffer) record `after`, the
  buffer after the call (`inputAfter` for the lexer).
- Input buffers are copied with `make` and `copy`, so their capacity equals their
  length, as `BytesFromString` gives in TypeScript.
- `go mod tidy` was run here once; the package imports only the standard library,
  so no `go.sum` is created.
