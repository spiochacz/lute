# 007 — Bytes and string conversions on the HTML to Markdown path

Status: **task, options recorded, nothing decided.** The owner asked on 2026-10-12 to write the options down and decide later. Related: `001-analysis.md` (profiles and measurement rules), `003-performance-plan.md` (item S3 names the same cost), `004-incremental-and-fast-paths.md` (the cache uses the same parser for new children).

## Problem

Go's `string` is a byte sequence, so `[]byte(s)` and `string(b)` are cheap and the Go code converts freely. In the port a JavaScript string and a `Uint8Array` are different representations, and every conversion copies and transcodes. On the path from editor DOM to Markdown the data crosses the boundary four times:

| step | where | what | share of `VditorDOM2Md` self time |
|---|---|---|---|
| 1 | `util.ParseHTML` | the whole HTML string is encoded to bytes for the tokenizer | about 5 % (`encode` 3.5 %, `encodeUtf8String` 1.4 %) |
| 2 | `html/token.ts` (`Token`, `Text`, `TagName`, `TagAttr`) | every text, tag name, attribute key and value is decoded to a new string for `html.Node` | about 5 % (`StringFromBytes` 4.8 %) |
| 3 | `genASTByVditorDOM` and helpers | node strings are encoded to bytes again, because `ast.Node.Tokens` is bytes | about 2 % (`BytesFromString` 2.0 %) |
| 4 | end of the call | the rendered bytes are decoded to the result string | about 2 % (`decodeUTF8` 1.9 %) |

Source: CPU profile of `VditorDOM2Md` on the 212 KB CommonMark spec (`npm run bench:profile -- VditorDOM2Md --input=spec`), 2026-10-12, taken while another agent was running, so the shares are indicative and the absolute times are not usable. The same four steps exist in `VditorIRDOM2Md`, `HTML2Md`, `SpinVditorDOM`, `SpinVditorIRDOM`, `BlockDOM2Md`, `SpinBlockDOM` (not profiled for this task).

Whole profile for context: tokenizer module 20.0 %, `vditor_wysiwyg.ts` (DOM passes and tree building) 23.7 %, byte buffers 8.4 %, `strings.ReplaceAll` in the preprocess 8.0 %, `conv` 7.0 %, entity unescaping 7.2 %, tree construction (`html/parse.ts`) 5.3 %, garbage collector 3.4 %.

## Options

### A. Token strings as slices of the input string
Keep the byte tokenizer unchanged. When a token's raw byte span was not transformed (no lower-casing, no entity unescape, no newline conversion), produce its string as `input.slice(i, j)` instead of decoding the bytes. For input that is not pure ASCII, byte offsets and string indices differ: build once per call a table from byte offset to string index (or detect the pure-ASCII case with `encodeInto`'s `read === written` and take the fast path only then).
- Removes: most of step 2.
- Size and risk: local to `html/token.ts` and `util.ParseHTML`; the tokenizer logic and all offsets it reports stay as they are. Lone surrogates in the input must give the same result as today (the encoder turns them into U+FFFD; a slice would keep them): detect and take the old path.
- Memory: a slice keeps the whole input string alive while the node lives. The DOM tree lives until the end of the call on these paths; check every path that keeps `html.Node` objects longer. V8 copies slices shorter than 13 characters anyway.
- Expected: up to about 4 % of the call. Not measured.

### B. Interned tag names and attribute keys
Tag names and attribute keys repeat thousands of times (`p`, `span`, `data-block`, `data-type`, `class`). Return a cached string for a byte span that was seen before (the atom table already identifies known tag names; a small hash cache covers attribute keys and frequent short values).
- Removes: part of step 2 (`TagName` 1.75 % plus part of `TagAttr` 3.7 %).
- Size and risk: about 20 lines, no change of behaviour.
- Expected: 1 to 2 %. Not measured.

### C. A tokenizer that reads the string
Rewrite the tokenizer to walk the JavaScript string by char code; token text is a slice.
- Removes: steps 1 and 2.
- Size and risk: `html/token.ts` is a 1:1 port of Go's tokenizer (buffered byte reader, byte offsets). A string version is a second implementation or a replacement that no longer mirrors the Go file. Byte offsets become UTF-16 indices; the parser certificate of the cache (`ts/src/incremental/parser_certificate.ts`) compares token end offsets and would have to follow. The Go-generated vectors (`token.vectors.test.ts`, `parse.vectors.test.ts`) would guard the behaviour.
- Expected: up to about 10 %. Not measured.

### D. Byte-native `html.Node.Data`
Keep node text as bytes so that step 3 disappears.
- Size and risk: `util.DomAttrValue`, `DomText` and more than 200 call sites that treat `Data` and attribute values as strings. Rejected in `003-performance-plan.md` (S3); the coordinator still advises against it.
- Expected: about 2 %.

### E. Do nothing
The conversions cost about 14 % of the normal path together; the per-child cache already avoids the whole parse for unchanged blocks, so the cost matters for one-off conversions, for the first call, and for changed blocks only.

## Coordinator's recommendation (not a decision)

B first (nearly free). A as a prototype with a measurement; adopt only with a gain above the noise of the method. C only if, after A, the profile still shows the whole-document encode (step 1) as a clear cost. Not D.

## How to measure (binding for whoever does this)

- One short process per measurement, variants interleaved, with the arithmetic canary, as `ts/experiments/dom2md-cache/cold-proto/proc_time.ts` does: this machine slows every process down 2.2 to 2.6 times after 2 to 3 seconds of sustained work, so long processes give inflated absolute times and first-against-later comparisons inside one process are invalid.
- Inputs: 1 KB and 212 KB; methods at least `VditorDOM2Md`, `VditorIRDOM2Md`, `HTML2Md`, `SpinVditorDOM`, `BlockDOM2Md`. One input with non-ASCII text (Polish and CJK) for option A, because the offset table is only exercised there.
- Output hashes equal to the previous bundle on all methods before any timing; `npm test` and, before a commit, `npm run test:full`.
- Keep a change only with a gain that repeats in two independent runs; revert otherwise.

## Related items decided separately (not part of this task)

The owner approved on 2026-10-12 the three other candidates from the same profile: one pass instead of three `strings.ReplaceAll` passes in the preprocess (8 %), fusing or skipping the separate whole-DOM walks (`adjustMath` 5.8 %, `searchEmptyNodes` 3.9 %, highlight spans 1.2 %), and fast paths in the tokenizer and in entity unescaping. They are done as their own wave, each with the measurement rule above.
