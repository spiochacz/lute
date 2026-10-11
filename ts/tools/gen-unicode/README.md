# gen-unicode

Generates the Unicode data used by the TypeScript runtime:

- `ts/src/runtime/unicode_tables.ts`: range tables, case maps, SimpleFold map and ASCII flags, computed by calling the real Go functions for every rune 0..0x10FFFF.
- `ts/src/runtime/testdata/unicode_checksums.json`: per-predicate, per-table and per-mapping counts and FNV-1a checksums, used by `unicode.test.ts`.
- `ts/src/runtime/testdata/utf8_vectors.json`: `unicode/utf8` results used by `utf8.test.ts`.

This is its own Go module (`lute-ts-gen-unicode`), separate from the parent Go module. It requires `golang.org/x/text v0.21.0` (the version the repo's go.mod uses) for the East Asian width data.

## Toolchain

The committed data was generated with Go 1.21.13 (`unicode.Version` 15.0.0), because the reference bundle `javascript/lute.min.js` was built with that version. Use `GOTOOLCHAIN=local` so Go does not download and switch to a different toolchain.

## Regenerate

From `ts/tools/gen-unicode`, on Windows PowerShell or Git Bash:

```sh
export GOTOOLCHAIN=local
GO=/c/Users/SlawomirPiochacz/sdk/go1.21.13/bin/go.exe

$GO run . -tables ../../src/runtime/unicode_tables.ts -checksums ../../src/runtime/testdata/unicode_checksums.json
$GO run ./cmd/utf8vectors -out ../../src/runtime/testdata/utf8_vectors.json
```

Then run the tests from the repo root:

```sh
node --test ts/src/runtime/utf8.test.ts ts/src/runtime/unicode.test.ts
```

Keep the code compatible with Go 1.21 (no `math/rand/v2`, no range-over-int, no `min`/`max` builtins).
