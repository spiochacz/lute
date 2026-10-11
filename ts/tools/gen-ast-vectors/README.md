# gen-ast-vectors

Generates the oracle files for the TypeScript port of Go package `ast`
(`ts/src/ast/*.test.ts`). The generator calls the real Go `ast` and `parse`
packages (built with `-tags javascript`) and writes JSON into
`ts/src/ast/testdata/`:

| File | Contents |
|---|---|
| `nodetype_vectors.json` | NodeType constants (derived from node.go with go/types), `String()` for -2..maxVal+2, `Str2NodeType` |
| `predicates_vectors.json` | IsBlock, IsContainerBlock, IsMarker, IsCloseMarker, AcceptLines, Marker, CanContain per type |
| `tree_vectors.json` | 150 scripted tree scenarios (seed 20260101): operations, forest dumps, link invariants, final queries |
| `realtree_vectors.json` | About 70 parsed Markdown snippets: every Node field and method result, per node |
| `ial_vectors.json` | SetIALAttr, IALAttr, RemoveIALAttr, RemoveIALAttrsByPrefix, IsEmptyBlockIAL |
| `misc_vectors.json` | IsNodeIDPattern, IsValidCalloutImageSrc, callout helpers, callout constants |
| `table_rich_vectors.json` | TableCellRich Encode (Go 1.27) and DecodeTableCellRich + Validate |

Inputs containing U+0008 or U+000C are excluded from the Go 1.27 encode and
decode vectors. The Go 1.21 generator in `go121/` covers them.

## Commands

From `ts/tools/gen-ast-vectors/`:

```
set GOTOOLCHAIN=local
"C:\Program Files\Go\bin\go.exe" run -tags javascript .
```

Flags (optional, defaults shown):

```
"C:\Program Files\Go\bin\go.exe" run -tags javascript . -repo ../../.. -out ../../src/ast/testdata
```

The module uses the root `go.sum` (copied here). It never changes the root
`go.mod` or `go.sum`.
