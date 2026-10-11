# gen-parse-tables-vectors

Generators for the TypeScript port of the `parse` files `table`, `table_rich`, `table_rich_style`, `transform`, `emoji`, `emoji_map`, `block_ref`, `file_annotation_ref` and `inline_attribute_list`.

- `convert-emoji.mjs` writes `ts/src/parse/emoji_map.ts` from `parse/emoji_map.go`: the 2,126 alias to unicode entries as one string literal, decoded on first use. Run again only if `emoji_map.go` changes, from `ts/`: `node tools/gen-parse-tables-vectors/convert-emoji.mjs`. It prints the number of unicode values with more than one alias (34).
- `main.go` (with `linkname.go` and `empty.s`) writes `ts/src/parse/testdata/tables_pure_vectors.json`, the oracle for `ts/src/parse/tables_pure.vectors.test.ts`: the emoji tables, `IsEmoji`, the kramdown IAL functions, the table helpers and row/table parsers, block and file annotation reference IDs, the rich table cell style protection, and the standard library `html.UnescapeString` on the style literals. The unexported functions and methods are reached with `go:linkname` pulls.
- `gen-tree-cases.ts` writes `ts/src/parse/testdata/tables_tree_cases.json` (markdown inputs), and `tree/main.go` parses them with the real Go package and writes `ts/src/parse/testdata/tables_tree_expected.txt`, the oracle for `ts/src/parse/tables_tree.vectors.test.ts`.

Regenerate from `ts/tools/gen-parse-tables-vectors` (Git Bash):

```sh
export GOTOOLCHAIN=local
"/c/Program Files/Go/bin/go.exe" run -tags javascript . > ../../src/parse/testdata/tables_pure_vectors.json
node gen-tree-cases.ts ../../src/parse/testdata/tables_tree_cases.json
"/c/Program Files/Go/bin/go.exe" run -tags javascript ./tree ../../src/parse/testdata/tables_tree_cases.json > ../../src/parse/testdata/tables_tree_expected.txt
```

The module `lute-ts-gen-parse-tables-vectors` has `replace github.com/88250/lute => ../../..`, so the repo's root `go.mod` and `go.sum` are not changed. `go.sum` is a copy of the one in `gen-html-vectors`.
