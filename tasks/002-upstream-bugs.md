# 002 — Upstream bugs found while porting

Bugs and suspicious behaviour in the Go source of Lute (`88250/lute`), noticed during the TypeScript port. The user asked on 2026-10-10 to keep this record so the bugs can be fixed later.

## How this list is used

- **During the port nothing here is fixed.** The port reproduces Go's behaviour, including the bugs, so that it stays byte-for-byte comparable with the oracle. Each place is marked in the TypeScript code with `// UPSTREAM-BUG:` (or an older `// PORT-NOTE: Go panics here`).
- **Every entry is a candidate until triaged.** "Go panics on this input" is a fact; whether it is a bug that users can reach, or an internal precondition that callers always satisfy, has not been checked unless the entry says so.
- **Fixing** means: fix in Go first (or decide to diverge), add the test, then change the port, and move the entry to "Fixed".
- Entries carry the Go commit they were observed at: `8e7896b6` unless stated otherwise.

## Candidates

### Panics on reachable-looking input

| # | Where | What happens | Smallest input known | Status |
|---|---|---|---|---|
| 1 | `html/parse.go`, `inFramesetIM` | nil pointer dereference: the open-elements stack is empty | `ParseFragment("<frameset>‸</frameset>", context <head>)`; 20 of the test documents hit it, all with context `head` | Not triaged. Lute may never parse fragments in a `head` context. |
| 2 | `html/parse.go`, `afterBodyIM` | panic `html: bad parser state: <html> element not found, in the after-body insertion mode` | `ParseFragment("<html></html><!--after-->", context <head>)`; 5 documents | Not triaged. Same remark as 1. |
| 3 | `util/ial.go`, `IsDocIAL2` | index out of range when a key/value pair has fewer than two elements | 58 of 273 generated inputs panic | Not triaged. Check what `parse/blocks.go` and `parse/inline_attribute_list.go` can pass. |
| 4 | `lex/token.go`, `ReplaceNewlineSpace` | index out of range | Seen in generated vectors (291 panics across items 4–7) | Not triaged. |
| 5 | `lex/token.go`, `AcceptTokens` | index out of range | as above | Not triaged. |
| 6 | `lex/token.go`, `IsBackslashEscapePunct` | index out of range | as above | Not triaged. |
| 7 | `lex/token.go`, `Peek` | index out of range for a negative position | as above | Not triaged. |
| 13 | `render/protyle_renderer.go:770`, `renderLinkRefDef` | nil pointer dereference: `node.FirstChild.ChildByType(ast.NodeLinkDest)` returns nil and `.Tokens` is read from it | `Lute.New().Md2BlockDOM("[r]: /u\n")` with default options; any link reference definition triggers it | **Confirmed in the oracle bundle on 2026-10-10.** `MarkdownStr` on the same input works, and `SetLinkRef(false)` avoids the panic, which is presumably why SiYuan does not hit it. |
| 14 | `util/html.go`, `ParseHTML` | Returns nil for input that starts with `<!DOCTYPE html>`: the doctype node also has `Data == "html"`, so the function takes the doctype's `LastChild`, which is nil | `ParseHTML("<!DOCTYPE html><p>x</p>")` | **Confirmed in the oracle bundle on 2026-10-11:** `HTML2Md` and `HTML2Text` throw a nil-pointer error on input starting with a doctype declaration (six variants tested), so converting a complete HTML document fails. |
| 17 | `parse/parse.go:75,80,100`, `finalParseBlockIAL` | `n.ID[:14]` slices the first 14 bytes of the block ID, but the ID can come from a user-written attribute list. An ID shorter than 14 bytes panics with `slice bounds out of range`. | `Md2BlockDOM("foo
| 18 | `parse/auto_link.go:408-409` and `:426-427`, GitHub issue and pull request links | `slice bounds out of range [:-1]`: the code assumes a repository path before `/issues/` or `/pull/`; when the URL is `https://github.com/issues/N`, the marker overlaps the 19-byte prefix | `Lute.New().MarkdownStr("", "https://github.com/issues/1")` and `..."https://github.com/pull/1"`, default options | **Confirmed in the oracle bundle on 2026-10-11.** Reachable from plain Markdown with default options. |
| 19 | `parse/inline_html.go:275`, `processSpanTag` | `slice bounds out of range`: `strings.Index` returns -1 and the result is used as a slice bound | `Md2BlockDOM("<span data-type=ab>x</span>")` with `SetProtyleWYSIWYG(true)` | **Confirmed in the oracle bundle on 2026-10-11.** |
| 20 | `parse/html_block.go`, `parseHTML` | Index out of range when the input ends right after a tag name or after `/` | `<script`, `<div`, `<div/` as the whole argument of `parseHTML` (from Go vectors) | Not triaged: check whether a block-start caller can pass such input. |
| 21 | `parse/code_block.go` and `parse/custom_block.go`, finalize; `parse/paragraph.go` (`tokens[1:closeBracket]` with `closeBracket == -1`) | Possible index panics noticed by reading the code | none found | Not triaged; no input known. |
| 36 | `parse/code_block.go:104` (`codeBlockFinalize`) after `parse/code_block.go:166-168` (`isFencedCodeClose`) | In editor modes `isFencedCodeClose` replaces the tip tokens `
| 38 | `render/vditor_wysiwyg_renderer.go:772-773`, `renderLink` | nil pointer dereference: a link whose text is only an image has no direct `NodeLinkText` child, and with the caret inside the destination the code reads `text.Tokens` from nil | `Md2VditorDOM("[![img](a.png)](ht‸tps://example.com)")` with `SetVditorWYSIWYG(true)` | **Confirmed in the oracle bundle on 2026-10-11** by the renderer tests (both sides throw). |
| 39 | Parser, Protyle mode: a table followed by an attribute list line | `slice bounds out of range` | `"| a | b |
| 45 | `parse/custom_block.go`, `customBlockFinalize` | Same pattern as item 36: `content[i+1:]` with `i == len(content)` after the caret replaced the tip tokens | `";;;x
;;;‸"` with `SetCustomBlock(true)` and Vditor WYSIWYG, IR, SV or Protyle | **Confirmed in the oracle bundle on 2026-10-11.** The port now throws here too. |
| 46 | `parse/heading_id.go`, `parseHeadingID` | The end index of the `{#…}` braces is found before the caret is removed from the content, so `content[1:curlyBracesEnd]` runs past the shortened slice | `"# a {#i‸d}"` with `SetVditorWYSIWYG(true)`; also `# h {: id="…‸"}` | **Confirmed in the oracle bundle on 2026-10-11.** Found by a throw-parity scan over about 20,000 documents with the caret at every position; the port now throws here too. |
| 47 | `vditor_ir.go`, `genASTByVditorIRDOM`, `atom.Pre` case | nil pointer dereference on a `pre` element without children | `VditorIRDOM2Md("<pre></pre>")` | **Confirmed in the oracle bundle on 2026-10-11.** |
| 48 | `vditor_ir.go`, `genASTByVditorIRDOM`, `code-block-open-marker` case | nil pointer dereference when the open-marker span has no next sibling | `VditorIRDOM2Md` on a `div data-type="code-block"` that contains only the `span data-type="code-block-open-marker"` | **Confirmed in the oracle bundle on 2026-10-11.** |
| 49 | `h2m.go`, `genASTByDOM`, `pre` handling | nil pointer dereference: `firstc.NextSibling` is nil | `HTML2Md("<pre><i class=\"iconfont icon-copy\"></i></pre>")` | **Confirmed in the oracle bundle on 2026-10-11.** About 30 such inputs in the HTML test corpus. |
| 50 | `protyle.go:980-987`, `Blockquote2Callout` | A paragraph with no children gets a text node appended, but the local variable `text` stays nil and `text.Text()` is called on it | `Blockquote2Callout` on a blockquote whose first paragraph is empty | **Confirmed in the oracle bundle on 2026-10-11.** |
| 51 | `protyle.go`, `UL2TL` and `OL2TL` (and other list conversions) | nil pointer dereference when the DOM passed in is not a list | any non-list block DOM | **Confirmed in the oracle bundle on 2026-10-11.** Thousands of hits in the comparison corpus; arguably a caller error, but the API does not guard. |
| 52 | `render/html_renderer.go:1404,1431`, `renderHeading` | `headingLevel[level : level+1]` on the 7-character constant panics for a heading level of 7 or more | `BlockDOM2RichHTML` on a heading DOM with `data-subtype="h7"` | **Confirmed in the oracle bundle on 2026-10-11.** Supersedes the heading-level half of item 35. Levels below 0 throw as well; level 0 does not. The port throws here too since the phase 5 merge step. |
| 58 | `render/protyle_renderer.go:1809`, heading rendering | A negative heading level panics (levels above 6 are clamped just before the slice, negative ones are not) | `Blocks2Hs(dom, "-1")` | **Confirmed in the oracle bundle on 2026-10-11.** The port throws here too. |
| - | - |
| c | d |
{: id=\"x\"}
"` under the Protyle option set, through `FormatStr` | **Confirmed in the oracle bundle on 2026-10-11** by the format renderer tests (both sides throw). Probably the same cause as item 17 (`n.ID[:14]` on a short ID). |
` with just the caret; `codeBlockFinalize` then slices `content[i+1:]` with `i == len(content)` and panics with `slice bounds out of range` | A fenced code block whose closing fence is followed by the caret: three backticks, newline, three backticks, then the caret character, with `SetVditorIR`, `SetVditorSV`, `SetVditorWYSIWYG` or `SetProtyleWYSIWYG` on; `MarkdownStr`, `Md2VditorIRDOM` and `Md2VditorSVDOM` all throw | **Confirmed in the oracle bundle on 2026-10-11** by the Vditor renderer tests. The port throws here too since the merge step. |
{: id=\"abc\"}
")` with `SetProtyleWYSIWYG(true)` and `SetKramdownIAL(true)` | **Confirmed in the oracle bundle on 2026-10-10.** IDs of 14 bytes or more work, including non-ASCII ones (where the slice may cut inside a character; effect not traced). |

For items 4–7 the exact failing inputs are in `ts/src/lex/testdata/lex_vectors.json` (vectors recorded as panics), and for item 3 in `ts/src/util/testdata/util_vectors.json`.

### Wrong conditions

| # | Where | What | Smallest input known | Status |
|---|---|---|---|---|
| 15 | `ast/node.go:482`, `IsSameTextMarkType` | The link-title check compares a value with itself: `node.TextMarkATitle != node.TextMarkATitle` is always false, so two link text marks with the same href but different titles count as the same type. The left side should be `n.TextMarkATitle`. | `n` = text mark `a`, href `x`, title `t1`; `node` = text mark `a`, href `x`, title `t2`: returns true | **Confirmed by reading the source on 2026-10-10.** Effect on output not yet traced: callers merge adjacent text marks of the same type, so a title may be lost. |
| 16 | `ast/node.go:440`, `IsNextSameInlineMemo` | Inside the loop over `node := n.Next`, the condition starts with `nil == n.Next`, which tests the receiver instead of the loop variable. The loop only runs when `n.Next` is non-nil, so that part is always false (dead check). | none needed | Confirmed by reading the source. Harmless as written; possibly `node` was meant. |
| 22 | `parse/auto_link.go:126-133`, GFM email autolink | When an email candidate ends right after `@`, the second loop never runs, so a variable keeps its zero value and a NUL byte is written into the output as text | `MarkdownStr("", "a.@")` gives `<p><a href="mailto:a.">a.</a> </p>`: a bogus link and a NUL character | **Confirmed in the oracle bundle on 2026-10-11.** Default options. |
| 23 | `parse/auto_link.go:198`, GFM autolink | The flag `www` is never reset inside the loop, so after a `www.` link every later link in the same text node loses its protocol in the link text (the destination keeps it) | `MarkdownStr("", "www.example.com http://example.org")`: the second link is shown as `example.org` | **Confirmed in the oracle bundle on 2026-10-11.** Default options. |
| 24 | `parse/inline_html.go:469`, `TagAttr` | For an unquoted attribute value, `valSpec[2:len-1]` drops the first and the last byte of the value | `TagAttr(" a=xy>")` gives an empty value; `" a=bc d=ef"` gives `c` (from Go vectors) | Confirmed against Go vectors. Effect on output not traced. |
| 25 | `parse/inline_html.go:570`, attribute name parsing | When an attribute name runs to the end of the input, the last byte of the name is left in the remainder | from Go vectors | Confirmed against Go vectors. Effect on output not traced. |
| 26 | `parse/thematic_break.go:39`, `parseThematicBreak` | `caretInLn` is never set to true, so the caret-handling result is always nil (dead code) | none needed | Found by reading the source. |
| 27 | `parse/block_query_embed.go:62` | `tokens = bytes.TrimSuffix(tokens, editor.CaretTokens)` has no effect: `tokens` is not used afterwards | none needed | Found by reading the source. |
| 28 | `parse/code_span.go:~172`, `matchCodeSpanEnd` | A `continue` branch is unreachable because all contiguous backticks were already consumed; if it were reached it would loop forever without advancing | none | Found by reading the source. |
| 29 | `parse/auto_link.go:537`, `parseAutoEmailLink` | Uses `ctx.tokens[1:]` instead of the current position, which probably explains why `<foo@bar.com>` in the middle of a paragraph is not recognised by this function | not isolated | Not triaged. |
| 30 | `parse/table.go:254` and `:285`, `parseTable0` (table cell attribute list) | `ialTokens` is a sub-slice of `th.Tokens`; the next statement removes the attribute list from `th.Tokens` with an in-place `append`, which shifts the following text over the very bytes `ialTokens` points at. The `NodeKramdownSpanIAL` node then holds corrupted tokens. | `"| {: style=\"text-align:right\"} a |
:-"`: the span IAL tokens become ` a style="text-align:right"}` instead of `{: style="text-align:right"}` | Confirmed against Go vectors on 2026-10-11 (a slice-aliasing bug; the port reproduces it because `slices.Append` writes in place like Go). Effect on rendered output not traced. |
| 31 | `parse/transform.go:303`, `NestedInlines2FlattedSpans` | The branch `else if ast.NodeBackslash == n.Type` is unreachable: `NodeBackslash` is not in the enclosing `case` list (the Hybrid variant at line 121 does handle it) | none needed | Found by reading the source; the TypeScript compiler rejected the comparison as impossible. |
| 32 | `parse/block_ref.go:127` and `parse/file_annotation_ref.go:160` | `bytes.HasPrefix(remains, editor.CaretTokens)` is dead: the scan loop before it skips every caret byte, so `remains` can never start with the caret | none needed | Found by reading the source. |
| 33 | `render/space.go:51`, `addSpaceAtBoundary` | `"1" <= prefix && "9" >= prefix` compares the whole prefix as a string, so it is true for any prefix that starts with 1 to 8 (for example `1abc`), not only for a single digit | from Go vectors | Found by reading the source; behaviour matches Go vectors. Effect on auto-spacing not traced. |
| 34 | `render/renderer.go:863`, `tagSrc` | `src[:bytes.Index(src, "\"")]` panics when the `src` value has no closing quote | `<img src="a` | Not triaged; `tagSrc` is not called from the HTML renderer. |
| 35 | `render/html_renderer.go:1404,1431` (heading level above 6) and `render/renderer.go:390` (`UnescapeHTMLStr(marker)[0]` on an empty marker) | Index panics on values the parser normally does not produce | none known | Not triaged. |
| 37 | `render/vditor_sv_renderer.go:437-447`, `renderFootnotesRef` | `previousNodeText` and `attrs` are computed and never used, so the generated span carries none of those attributes | `a[^1]
| 40 | `render/kityminder_json_renderer.go:187-189`, `renderHeading` | The loop `for c := node.FirstChild; ...` calls `c.Unlink()`, which clears `c.Next`, so it stops after the first child; the remaining children stay under the heading | `# a

text

## b` through `RenderKityMinderJSON` | Found by reading the source; the port reproduces it and matches the oracle. |
| 41 | `render/format_renderer.go:827` and `render/protyle_export_md_renderer.go:1031`, `renderYamlFrontMatter` | `!entering` is tested inside `if entering`, so the blank line after YAML front matter is dead code | none needed | Found by reading the source (two renderers, same code). |
| 42 | `render/protyle_preview_renderer.go`, `renderCallout` | `icon` is computed, including a default emoji, and never used | none needed | Found by reading the source. |
| 43 | `lex/lexer.go:47-49`, `Lexer.NextLine` | Writes `
` over `` in the caller's buffer, so `parse.Parse` modifies the byte slice it was given: parsing the same buffer twice gives different trees (`"a
b
"` becomes `"a

b

"`) | Call `parse.Parse` twice on one `[]byte` containing CRLF | Confirmed against Go by the export-Markdown vector generator. Not reachable through the string API (`MarkdownStr` converts to a fresh slice), but it affects Go callers of `Markdown([]byte)`. |
| 44 | `render/protyle_export_md_renderer.go:586`, text mark of type `text` | Attributes are written by iterating a Go map, so with two or more attributes their order in the exported Markdown is random between runs | a `text` text mark with two attributes | Confirmed by the Go vector generator (output differs between runs). The port writes them in insertion order. |
| 53 | `vditor_wysiwyg.go:2029-2037`, `suffixSpaces` | Compares single bytes with 160 to detect a non-breaking space; 160 (0xA0) is also a UTF-8 continuation byte, so text ending in a character such as `à` (C3 A0) is treated as ending in a space | a `strong` whose text ends in `à` | Found by reading the source; port and oracle agree (the port works on bytes there). |
| 54 | `vditor_wysiwyg.go:652-658`, `searchEmptyNodes` | Checks the LAST child for a trailing space but appends the zero-width space to the FIRST child's data | `<strong>a <b>x</b> </strong>` | Found by reading the source. |
| 55 | `h2m.go:2387,2395`, `appendSpace` | The trim cutset is `" Š"`: it contains U+0160 (Š) where a non-breaking space U+00A0 was almost certainly meant | `<p>a<b> x</b>y</p>`; a text ending in `Š` gets it trimmed | Found by reading the source. |
| 56 | `h2m.go:1183` and `:1732` | `CodeMarkerLen = 2` is set on the wrong node (the code block node, and the span's node, instead of the code span) | a `pre` inside a table cell whose line contains a backtick; a `span data-type="code"` whose text contains a backtick | Found by reading the source. |
| 57 | `protyle.go:1406-1418`, `genASTByBlockDOM`, blockquote case | When the blockquote text is only the caret, the same node is appended as text and then again as the blockquote | a blockquote DOM whose text is only `<wbr>` | Found by reading the source. |
| 59 | `render/code_block_html_renderjs.go` (the `javascript` build variant) | A fenced code block without a language loses its block attributes: native Go renders `<pre data-block-id="…"><code …>`, the JavaScript build renders `<pre><code>` with no attribute | a fenced code block followed by `{: id="20201105103725-3ad5wcz"}` with `KramdownIALIDRenderName` set to `data-block-id` (Go test `kramdownBlockIALIDNAmeTests` row 4) | Found by the ported Go tests: port and bundle agree with each other and differ from Go's expected value. Looks like an oversight in the JS variant rather than a deliberate simplification. Port and reference oracle follow native Go since 2026-10-11 (oracle patch 0001). |
| 60 | `vditor_wysiwyg.go:931`, footnote handling (`md = md[3:]`) | Native Go panics when `len(md) < 3`; the GopherJS bundle does not, because GopherJS evaluates a string slice with a start past the end to an empty string | `VditorDOM2Md` on `<div data-type="footnotes-block"><ol data-type="footnotes-defs-ol">x</ol></div>`: the bundle returns `"[]:\n"` | **Confirmed in the oracle bundle on 2026-10-11.** A case where native Go and the JS build differ; the port follows the bundle. |

[^1]: n` | Found by reading the source. |

### Editor round trips

| # | Where | What | Smallest input known | Status |
|---|---|---|---|---|
| 64 | `vditor_ir.go`, `genASTByVditorIRDOM`, indented code block case (TypeScript `vditor_ir.ts:212`) | An IR indented code block is turned into a paragraph without restoring `Context.Tip`, so every later sibling is attached inside it; the Markdown round trip loses the fence and the blank lines | `VditorIRDOM2Md` on the IR DOM of a document with an indented code block followed by other blocks | Found on 2026-10-11 by the per-child cache spike (`tasks/004-incremental-and-fast-paths.md`), by reading the code and by fuzzing; confirmed on the oracle bundle on 2026-10-11 (`ts/experiments/dom2md-cache/cold-proto/oracle64.ts`): the IR DOM of `# a`, an indented code block, a paragraph, a heading and a list gives `# a

indented code
paragraph after

## b

- item
` (indentation and blank line lost). In the CommonMark spec document the tip opens at child 17 and never closes (18 top-level AST nodes for 1,413 children). It is also the reason the per-child cache cannot serve such IR documents. |
| 65 | Format renderer, `isLastNode` | A block nested in a top-level child renders differently depending on whether that child is the last AST node of the document | not isolated | Observed by the same spike; may be intended. Not triaged. |
| 66 | `render/format_renderer.go`, `renderList` and `renderBlockquote` exit (TypeScript `format_renderer.ts` near lines 1907 and 1839) | On leaving a top-level list or blockquote the renderer applies `bytes.TrimSpace` to the whole root writer, so Unicode white space at the very start of the document (vertical tab, form feed, NBSP, U+2028, U+3000, U+2003 and similar) is removed whenever a list or blockquote occurs later; a first paragraph consisting only of such white space disappears. Without a later list or blockquote the same document keeps it. | `VditorDOM2Md` on a paragraph starting with U+3000 followed by a list | Found on 2026-10-11 by the per-child cache fuzzer and traced by reading the code (`tasks/004-incremental-and-fast-paths.md`, mismatch analysis); port and oracle agree. Not yet confirmed with a Markdown-only input through `FormatStr`. |
| 67 | Vditor DOM to Markdown, paragraph whose text begins with four spaces (both modes) | The paragraph becomes a code block and the output has two blank lines before the next block instead of one | `VditorDOM2Md` on `<p data-block="0">    indented code</p><h1 data-block="0">h</h1>` | Found 2026-10-11 while building cache witnesses (`tasks/004`, negative-controls analysis). The port matches the oracle. Fixed 2026-10-12 on the owner's instruction, see "Deliberate departures from the JavaScript build". |
| 68 | Format renderer, paragraph after a top-level text without a trailing LF | A link reference definition block (or footnotes block) whose text has no final LF is glued to the following block (`[r]: http://x# h`, `[r]: http://xpara`) because the following block does not start a new line | `VditorDOM2Md` on `<div data-type="link-ref-defs-block">[r]: http://x</div><p data-block="0">para</p>` | Found 2026-10-11, same analysis. The port matches the oracle. Fixed 2026-10-12 on the owner's instruction, see "Deliberate departures from the JavaScript build". |

### Performance

| # | Where | What happens | Smallest input known | Status |
|---|---|---|---|---|
| 61 | `vditor_wysiwyg.go:179-181` (`adjustVditorDOM`) calling `removeWbr` (`vditor_wysiwyg.go:686-694`) | Quadratic: the loop calls `removeWbr(c)` for every top-level child, and each call walks `c` and all its following siblings (`searchWbr` on each), so the total work is quadratic in the number of top-level nodes. The first call already removes every matching node, so the later calls find nothing. In a CPU profile of `SpinBlockDOM`, `HTML2Md` and `VditorDOM2Md` it took 37-58% of the time. | Any Vditor DOM with many top-level nodes, for example `VditorDOM2Md` on a `div` with several thousand `p` children. Output is not affected. | Not fixed in Go. Since 2026-10-11 the TypeScript port calls `removeWbr` once, on `root.FirstChild` (a `PORT-NOTE: perf` departure with the equivalence argument in `ts/src/vditor_wysiwyg.ts`). Fix in Go: call it once on `root.FirstChild`. |
| 62 | `render/vditor_sv_renderer.go:881` (`renderDocument`), `:1091` (`renderBlockquote`), `:1131` (`renderCallout`), `:1266` (`renderListItem`) | Quadratic: each container close writes the whole parent buffer back onto itself (`r.Writer.Reset()` then `r.Write(buf)`), and that copy is made for every list item, so `Md2VditorSVDOM` costs (list items) x (output size). Measured on the port's profile of the 212 KB spec: 171 MB of growing appends per call. Port departs since 2026-10-11: `ts/src/render/vditor_sv_renderer.ts` (`setLastOutSVFromCopy`, the four methods) appends to the parent without that copy; the output bytes are the same. Smallest input known: not established; Go was not measured. The cost shows in the port's profile of the 212 KB spec (171 MB of growing appends per call). | Found by reading the source; the port's fix is tested on 1,800 generated documents against the previous bundle. |
| 63 | `render/format_renderer.go:1414` (`renderDocument`), `:1816` (`renderBlockquote`), `:1881` (`renderList`), `:1962` (`renderListItem`); `render/protyle_export_md_renderer.go:1520`, `:1963`, `:2026`, `:2106` (the same four) | Quadratic: at each container close the output buffer is copied onto itself (`r.Writer.Reset()` then `r.Write(buf)`), the only effect being that `LastOut` is set. Every list item copies the whole list buffer, so the cost is (list items) x (output size). Port departs since 2026-10-11: `ts/src/render/renderer.ts` (`setWriterFromOwn`) moves the trimmed text within the same storage and sets `LastOut` as `Write` does, including for an empty buffer. Smallest input known: not established; Go was not measured. The cost shows in the port's profile of the 212 KB spec (171 MB of growing appends per call). | Found by reading the source; not measured on Go. |

### Documentation or code disagreeing with itself

| # | Where | What | Status |
|---|---|---|---|
| 8 | `html/escape_encode.go`, `EncodeDestination` | The comment says invalid UTF-8 becomes U+FFFD; the code percent-encodes the raw byte instead. | Not triaged: decide which is intended. |
| 9 | `lute.go`, `const Version` | Says `1.7.6`; the newest upstream tag is `v1.7.8` (2026-09-23). | Stale constant. |
| 10 | `javascript/build.sh`, `javascript/build.bat` | License header says Mulan PSL v1; the project is under Mulan PSL v2. | Stale header. |

### Build and consistency

| # | Where | What | Status |
|---|---|---|---|
| 11 | `go.mod` and `javascript/lute.min.js` | `go.mod` declares `go 1.26`, but the committed bundle was built with Go 1.21.13 and GopherJS 1.21 refuses a `go 1.26` module. The published build recipe therefore does not work as written. | How upstream builds is unknown. |
| 12 | `javascript/lute.min.js` | The committed bundle is one Go commit behind the source (built at `f47ad925`). | Recurs whenever upstream commits Go changes without rebuilding. |

## Native Go versus the JavaScript build

The reference for the port is the GopherJS build (since 2026-10-11 `ts/test/oracle/lute.ref.min.cjs`, built with the patches listed under "Deliberate departures from the JavaScript build"), and it is not identical to native Go. Differences seen so far, each pinned by a test (`JS_BUILD_DIFFERENCES` lists in `ts/test/go/`):

- **No full Unicode case folding for link labels** (`[ẞ]` versus `[SS]`): CommonMark example 540 and four more Go test rows.
- **No syntax highlighting:** no `highlight-chroma` class, no language detection from content; eight Go tests are skipped for this reason.
- **Block attributes lost on fenced code blocks** (item 59): resolved on 2026-10-11, the port and the reference oracle now keep them as native Go does (see "Deliberate departures from the JavaScript build").
- **`util.RecoverPanic` is an empty function,** so panics propagate as exceptions where native Go recovers.
- **GopherJS does not panic on a string slice whose start is past the end** (item 60), while it does panic on byte-slice bounds. So "Go panics here" has to be confirmed on the bundle case by case.
- **Standard library version:** the bundle is built with Go 1.21.13 (Unicode 15.0, `encoding/json` escaping without `\b`/`\f`, `net/url` host parsing of that version).

## Deliberate departures from the JavaScript build

Behaviour where the port and the reference oracle follow native Go instead of the JavaScript build. Each departure is a Go patch in `ts/tools/oracle/patches/` plus a rebuilt oracle (`ts/test/oracle/lute.ref.min.cjs`), never a filter in the tests.

- **Item 59: fenced and indented code blocks keep their block attributes (kramdown IAL).** Native Go keeps them; the JavaScript build dropped them. Changed 2026-10-11. Patch: `ts/tools/oracle/patches/0001-code-block-keeps-block-ial.patch`.
- **Item 64: an indented code block of the IR DOM is built as a code block and the builder's tip is restored.** Upstream (Go and JavaScript alike) turned it into a paragraph and left `Context.Tip` inside it, so all later blocks nested in that paragraph. Fixed 2026-10-12 on the owner's instruction ("64 napraw"). `VditorIRDOM2Md` now returns the code as a fenced block (as the format renderer does for every indented code block) followed by a blank line. The legacy paragraph branch of the same condition no longer moves the tip either. Patch: `ts/tools/oracle/patches/0002-ir-indented-code-block-restores-tip.patch`; port: `ts/src/vditor_ir.ts`; test: `ts/test/e2e/ir_indented_code.test.ts`.
- **Item 67: a paragraph whose only child is a code block (its text began with four spaces) is replaced by that code block, in the WYSIWYG and the IR DOM.** Upstream left the code block inside the paragraph, so the Markdown had two blank lines after it. Fixed 2026-10-12 on the owner's instruction. The paragraph is replaced after `ParentTip()` in the deferred function of the paragraph case. Patch: `ts/tools/oracle/patches/0003-paragraph-code-block-and-link-ref-defs-line-end.patch`; port: `ts/src/vditor_wysiwyg.ts` and `ts/src/vditor_ir.ts`; test: `ts/test/e2e/vditor_dom2md_fixes.test.ts`.
- **Item 68: the text of a link-ref-defs-block ends with a LF when it does not have one.** Upstream glued the following block to the last definition (`[r]: http://xpara`). Fixed 2026-10-12 on the owner's instruction. Patch: `ts/tools/oracle/patches/0003-paragraph-code-block-and-link-ref-defs-line-end.patch` (the same patch as item 67); port: `ts/src/vditor_wysiwyg.ts` and `ts/src/vditor_ir.ts`; test: `ts/test/e2e/vditor_dom2md_fixes.test.ts`.

## Known limitations that are deliberate

Not bugs, listed so they are not reported again:

- **CommonMark example 540 fails in the JavaScript build.** `parse/linkrefdef_case_foldjs.go` skips full Unicode case folding to keep the bundle small, so `[ẞ]` does not match the definition `[SS]`. Native Go passes it.
- **`html.Entities` has only names ending in `;`** (2,125 entries), so `&copy` without a semicolon is not unescaped, unlike upstream `golang.org/x/net/html`.

## Fixed

- Item 64 (2026-10-12), see "Deliberate departures".
- Item 67 (2026-10-12), see "Deliberate departures".
- Item 68 (2026-10-12), see "Deliberate departures".
