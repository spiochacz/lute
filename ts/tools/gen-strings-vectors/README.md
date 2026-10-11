# gen-strings-vectors

Generates the expected results for the Go `strings` and `strconv` ports in the TypeScript runtime:

- `ts/src/runtime/testdata/strings_vectors.json`: results of Go's `strings` functions (used by `strings.test.ts`).
- `ts/src/runtime/testdata/strconv_vectors.json`: results of Go's `strconv` functions (used by `strconv.test.ts`).

Every expected value is computed by the real Go standard library. Inputs are valid UTF-8 generated from a fixed seed (`20260610`), so the output is reproducible. Index-returning functions record the Go byte offset and the prefix `s[:offset]`; the TypeScript tests compare the UTF-16 offset with `prefix.length`.

This is its own Go module (`lute-ts-gen-strings-vectors`, Go 1.21, no dependencies), separate from the parent Go module.

## Regenerate

From `ts/tools/gen-strings-vectors` (Windows PowerShell or Git Bash):

```sh
export GOTOOLCHAIN=local
GO=/c/Users/SlawomirPiochacz/sdk/go1.21.13/bin/go.exe

$GO run . -out ../../src/runtime/testdata
```

Then run the tests from `ts/`:

```sh
node --test src/runtime/strings.test.ts src/runtime/strconv.test.ts
```

`GOTOOLCHAIN=local` stops Go from downloading and switching to another toolchain. Keep the code compatible with Go 1.21 (no `math/rand/v2`, no range-over-int).
