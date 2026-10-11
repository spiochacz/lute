# Reference oracle

`lute.ref.min.cjs` is the reference bundle that the port's tests compare against.

## What it is

- A GopherJS build of the Go source at the commit in `../../UPSTREAM_PIN`, with the `javascript` build tag, built with Go 1.21.13 and GopherJS 1.21.0.
- The Go source is the repository's source with the patches in `../../tools/oracle/patches/` applied. Currently there is one patch, `0001-code-block-keeps-block-ial.patch`: fenced and indented code blocks keep their block attributes (kramdown IAL), as native Go does. The `javascript` build lost them (`tasks/002-upstream-bugs.md`, item 59). This is a deliberate departure from the JavaScript build, made as a Go patch and a rebuilt bundle, never as a filter in the tests.
- Loading it as a script sets `globalThis.Lute`, as `javascript/lute.min.js` does.

`lute.ref.min.cjs` is the default for `oraclePath()` in `oracle.ts`. `LUTE_ORACLE` overrides it with another bundle.

## Why the extension is `.cjs`

`../../package.json` has `"type": "module"`, so a `.js` file under `ts/` loads as an ES module. The GopherJS bundle uses CommonJS `require` at top level and fails in ES module scope. The `.cjs` extension always loads as CommonJS.

## Rebuild

The copy of the repository used for the build is `C:\Users\SlawomirPiochacz\lute-oracle-build\src` (outside the repository). Only the `go` directive in its `go.mod` is lowered from `go 1.26` to `go 1.21`, because GopherJS 1.21 cannot build a module that declares a newer Go version.

1. Make a copy of the repository at `UPSTREAM_PIN` into that directory, with `go.mod` changed to `go 1.21`.
2. Apply the patches: `git apply` each file in `../../tools/oracle/patches/` in order, with `-p1` from the repository root of the copy.
3. In the copy's `javascript/` directory, with the environment `GOTOOLCHAIN=local`, `GOPHERJS_GOROOT=C:\Users\SlawomirPiochacz\sdk\go1.21.13`, `GOOS=js`, `GOARCH=ecmascript`, and `C:\Users\SlawomirPiochacz\sdk\go1.21.13\bin` first on `PATH`:

   ```
   C:\Users\SlawomirPiochacz\go\bin\gopherjs.exe build --tags javascript -o lute.ref.min.js -m
   ```

4. Copy `lute.ref.min.js` to `ts/test/oracle/lute.ref.min.cjs`, without the `.map` file and without the trailing `//# sourceMappingURL=` line.

## Using the other bundle

`javascript/lute.min.js` (one Go commit behind the pin, without patch 0001) remains usable through `LUTE_ORACLE=/path/to/javascript/lute.min.js`. It will differ from the port on the patched behaviour (code blocks with block attributes).
