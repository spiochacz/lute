# lute-ts

A 1:1 TypeScript port of [Lute](https://github.com/88250/lute), the Markdown engine written in Go. The port covers the `javascript` build variant: everything that `javascript/main.go` exposes as the global `Lute` object. It is checked against the Go tests and against `test/oracle/lute.ref.min.cjs`, a GopherJS build of the same Go code with the patches in `tools/oracle/patches/` (the "oracle"). The port follows the `javascript` build except for the departures listed in `../tasks/002-upstream-bugs.md`.

The Go commit that is ported is in `UPSTREAM_PIN`. The rules for the port are in `PORTING.md` (binding for every ported file). Background is in `../tasks/001-analysis.md`; Go behaviour that looks wrong and is reproduced on purpose is marked `// UPSTREAM-BUG:` in the sources and listed in `../tasks/002-upstream-bugs.md`.

Node 24 or later runs the `.ts` files directly (type stripping); there is no transpile step except for the bundle.

## Commands (run from `ts/`)

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over `src`, `test`, `bench`, `scripts` |
| `npm test` | all `*.test.ts` under `src/` and `test/` with a deterministic sample of the big cross-product tests |
| `npm run test:full` | the same files with `LUTE_TEST_FULL=1` (loaded from `.env.full`): nothing is sampled |
| `npm run build` | writes `dist/lute.min.js`, `dist/lute.esm.js` and `dist/types/` |
| `node scripts/build.mjs --sourcemap` | the same, plus source maps for the two bundles |
| `npm run bench:runtime -- <tag> [--groups=g] [--rounds=N]` | runtime micro-benchmarks, one run, prints the comparison table (see `bench/`) |
| `npm run bench:runtime:aa -- [tag] [--groups=g] [--rounds=N]` | A/A noise test of the same rows, interleaved in one run |
| `npm run bench:compare -- <tag>` | prints the table of a saved micro-benchmark run again |
| `npm run bench:macro -- [tag] [--rounds=N] [--methods=A,B] [--inputs=tiny,small,medium,spec] [--warmup-ms=N] [--min-ms=N]` | port bundle against the reference bundle, per method and input (µs per call in batches for tiny and small; `spec` is `benchmark/commonmark-spec.md`, one call per batch) |
| `npm run bench:startup -- [tag] [--rounds=N]` | start-up of the port bundle against the reference bundle: read, compile, run, first `New` and first calls, in fresh child processes; wall time against an empty child |
| `npm run bench:profile -- <method> [--input=spec] [--seconds=5] [--top=40]` | CPU profile of one method on the unminified ESM build (needs `npm run build`): top functions by self time, self time per source module and directory, GC share |
| `npm run bench:oracle` | baseline of the reference bundle alone |

`test` versus `test:full`: `test/e2e/full.ts` exports `FULL` and `sample()`. In the default run the tests that cross a large corpus with many option sets run the base option sets on every document and the other sets on every sixth document; the throw-parity scan, the random fuzz and the editing loops use smaller counts. `test:full` runs everything. Tests of Go's own cases, the spec cases under the base option sets and the regression cases are never sampled.

## The build

- `dist/lute.min.js`: `src/bundle.ts` bundled by esbuild as an IIFE (`es2022`, minified syntax, whitespace and identifiers, no property mangling, no source map unless `--sourcemap`). Loading it as a script sets `globalThis.Lute`, as the GopherJS build `javascript/lute.min.js` does.
- `dist/lute.esm.js`: `src/index.ts` as an ES module, not minified.
- `dist/types/`: declarations of `src/index.ts`, emitted by `tsc -p tsconfig.build.json` (`emitDeclarationOnly`). `tsconfig.json` stays `noEmit`.

## How the oracle comparison works

`test/oracle/oracle.ts` loads the reference bundle once (`require`) and `test/e2e/helpers.ts` creates a port engine and an oracle engine from the same list of setter calls, runs the same call on both and compares the outcome: both return the same text (generated node IDs and timestamps normalised), or both throw. Inputs for DOM-taking methods come from the oracle's own forward methods. The oracle is `test/oracle/lute.ref.min.cjs` (its origin and rebuild steps are in `test/oracle/README.md`). It is a `.cjs` file because `package.json` has `"type": "module"`. Set `LUTE_ORACLE` to the path of another bundle to compare against it, for example the unpatched GopherJS build:

    LUTE_ORACLE=/path/to/javascript/lute.min.js npm test

`test/e2e/bundle.test.ts` and `test/e2e/bundle_driver.mjs` run `dist/lute.min.js` and the oracle in separate child processes and compare the global object, an engine's function-valued members and about 650 calls.

## Layout

`src/` follows the Go packages, one TypeScript file per Go file with the same name:

- `ast/`, `editor/`, `html/`, `lex/`, `parse/`, `render/`, `util/`: the packages of the same name. Each has an `index.ts` that re-exports its files.
- `runtime/`: the part of the Go standard library the code uses (`bytes`, `strings`, `strconv`, `unicode`, `utf8`, `slices`, `conv`, `json`, ...).
- `types.ts`, `lute.ts`, `h2m.ts`, `h2m_code_banner.ts`, `protyle.ts`, `protyle_tabs.ts`, `vditor_ir.ts`, `vditor_sv.ts`, `vditor_wysiwyg.ts`: Go's root package; the methods of `Lute` are attached per file.
- `global.ts`: `makeGlobal()`, the object that `javascript/main.go` sets as `Lute`. `bundle.ts`: assigns it to `globalThis.Lute`. `index.ts`: the public API of the ESM build.
- `*.test.ts` next to a source file: unit tests and tests with vectors generated by real Go (`testdata/`).

`test/`:

- `oracle/`: the oracle loader and its own tests, and the reference bundle `lute.ref.min.cjs` (see `oracle/README.md`).
- `e2e/`: comparisons with the oracle (`helpers.ts`, `option_sets.ts`, `full.ts`), the CommonMark/GFM spec runs, the file and fuzz runs, the regressions, `throw_parity.test.ts`, `bundle.test.ts`.
- `e2e/renderers/` and `e2e/root/`: per-renderer and per-method comparisons, and the Go test tables ported with Go's expected values.
- `go/`: ports of the Go test files of `../test/`, one TypeScript file per Go file.

`tools/`: Go programs (`gen-*-vectors`, each with its own `go.mod`, run with the system Go and `-tags javascript`) that write the vectors in `testdata/` directories, and scripts (`extract-*.mjs`) that extract the tables of Go test files into JSON. `bench/` holds benchmarks (not part of the tests). `bench:macro` runs each method on four inputs (`tiny` about 100 bytes, `small` about 1 KB, `medium` the first 10 KB of the spec, `spec` the whole 212 KB file); the small inputs are timed in batches of about 20 ms, and the round-trip inputs are made by the reference. `bench:startup` times the bundles' start-up in fresh children (bundle sizes in bytes, raw and gzip, are printed too). `bench:profile` writes its summary to `bench/results/profiles/<method>-<input>.txt`. Two rules govern them. First, the machine drifts by 15 to 35% over minutes, so two separate runs can never be compared: `bench:compare` takes one tag and refuses two. Second, variants are measured interleaved inside one run, one fresh child process per measurement: the runtime rows round-robin the impls of a group (`group.name|input`) for `--rounds` rounds (default 5), and `bench:macro` alternates the port bundle and the reference bundle. Compare only variants measured in the same run; use the fastest process per variant; treat a difference under 20% as noise (5% for bytes per operation). `bench:runtime:aa` checks this rule: unchanged code on both sides should agree within 10% for most rows (the Step 0 runs in `../tasks/001-analysis.md` reached 87% with an earlier runner; the current one is not yet measured on the full suite). Each run writes a fresh `bench/results/*.<tag>.json` (git-ignored). Benchmarks take minutes; run them one at a time. `scripts/build.mjs` is the build.
