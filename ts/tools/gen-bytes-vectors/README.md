# gen-bytes-vectors

Generates `ts/src/runtime/testdata/bytes_vectors.json`, the oracle for
`ts/src/runtime/bytes.test.ts` and `ts/src/runtime/slices.test.ts`.

The generator runs Go's real `bytes` package on a fixed corpus (seeded with
`20260610`) and records the results. It also records `bytes.Buffer` operation
sequences and the aliasing scenarios for slice semantics. It is a separate Go
module (`go.mod`, Go 1.21), so it is not part of the repository root module.

Regenerate (Go 1.21.13 at `C:\Users\SlawomirPiochacz\sdk\go1.21.13\bin\go.exe`):

```sh
cd ts/tools/gen-bytes-vectors
GOTOOLCHAIN=local go run . -out ../../src/runtime/testdata/bytes_vectors.json
```

Then run the tests from `ts/`:

```sh
node --test src/runtime/bytes.test.ts src/runtime/slices.test.ts
```

Notes:

- Byte slices are stored as lowercase hex. Go strings (cutset / chars arguments)
  are stored as JSON strings and must be valid UTF-8.
- Scenario slices use `mk` (exact capacity) instead of `[]byte("...")`, because
  Go may round the capacity of a converted string up to a size class.
