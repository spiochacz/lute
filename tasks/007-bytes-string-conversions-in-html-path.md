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

## Analysis (2026-10-12): options and compatibility with Go

Analysis only; nothing under `ts/src` changed. Scripts: `ts/experiments/conv-proto/` (`fixtures.ts`, `count.ts`, `replay.ts`, `candidates.ts`, `buf_micro.ts`, `time.ts`, `run.ts`, `mkvariant.sh`, `patch_conv.ts`, `patch_buf.ts`). Variants are copies of `ts/src` without test data in the session scratch directory (`conv-variants/{base,count,rt,rtdec,rtenc}`), rebuilt with `mkvariant.sh` plus the patch scripts. Every number below is labelled **measured** (this machine, Node 24, another agent running tests at the same time, so timings are noisy; counts are exact), **read** (from the code) or **reasoned**.

Fixtures (measured): `benchmark/commonmark-spec.md` (212,035 characters) becomes **514,207 characters of WYSIWYG DOM** through `Md2VditorDOM` (794,015 for the IR DOM), with 534 non-ASCII code units, so the document is *not* pure ASCII and a "pure ASCII" fast path for option A would never fire on it. The other inputs are the first 1 KB of the spec (1,227 characters of DOM) and a Polish/CJK/emoji document (54,080 characters, 5,360 non-ASCII units).

### 1. The conversions as they really are

Counts of one `VditorDOM2Md` call on the spec DOM (measured with the `count` variant, whose `conv.ts` records the call site of every conversion; input 514,207 characters, output 200,068):

| site (port) | Go counterpart | calls | units or bytes | notes |
|---|---|---|---|---|
| `util.ParseHTML` → `conv.BytesFromString(htmlStr)` (`util/html.ts:30`) | `strings.NewReader` + the tokenizer's own buffer (`util/html.go:23`, `html/token.go:1212`) | 1 | 514,167 | TextEncoder; then **a second whole-input copy** in `NewTokenizerFragment` (`html/token.ts:1360`, `slices.Clone`, marked PERF-TODO). Go also copies twice (reader into `z.buf`). |
| `Tokenizer.Token()` text, comment, doctype (`html/token.ts:1273`) | `string(z.Text())` (`html/token.go:1175`) | 3,674 | 194,285 | 1,655 take the ≤32-byte `fromCharCode.apply` path, 2,019 go through TextDecoder |
| `Tokenizer.Token()` attribute values (`token.ts:1287`) | `string(val)` (`token.go:1181`) | 8,855 | 109,269 | 8,834 short; **only 110 distinct values** in the whole document, none contains `&` (measured on the fixture) |
| `atom.String(key)` for keys that are not atoms (`html/atom/atom.ts:94`) | `atom.String(key)` → `string(s)` | 4,473 | 46,248 | the `data-*` keys; keys that are atoms and all known tag names are `atomText.slice(...)` (an allocation but no decode) |
| `unescapeEntity` entity name (`html/escape.ts:153`) | `entityName := string(s[1:max])` (`html/escape.go:142`) | **15,848** | 51,293 | **not in the table at the top of this task**; the spec DOM is full of `&lt;`, `&gt;`, `&quot;`. Same allocation count as Go. |
| `html.UnescapeHTML` round trip (`html/escape_encode.ts:53`, called from `vditorDOM2MdAdjustTree`) | `[]byte(UnescapeString(string(h)))` | 1,225 + 1,225 | 49,920 + 48,764 | one decode and one encode per code block, inline code or HTML node |
| `genASTByVditorDOM` `[]byte(content)` for **every** DOM node (`vditor_wysiwyg.ts:1245`) | `vditor_wysiwyg.go:958` | 4,159 | 102,196 | element nodes included (their `content` is the tag name, later overwritten or unused); 3,645 short |
| other `genASTByVditorDOM` sites (code block tokens 1433, fence markers 1460/1461/1472/1473, info 1467, code spans 1730/1747, link dest 2184, `suffixSpaces` 2450) | the same Go lines | about 4,900 | about 148,000 | all 1:1 with Go's `[]byte(...)`; the four fence-marker sites convert the same marker four times per block (Go does too) |
| result `conv.StringFromBytes(formatted)` (`vditor_wysiwyg.ts:326`) | `string(formatted)` | 1 | 200,464 | TextDecoder, one call |
| `bytes.Buffer.String()` (`DomText`, `DomTexhtml`, `domCode`) | `buffer.String()` | 375 | 5,235 | negligible on this path; **3,727 calls / 253,080 bytes on `HTML2Md`**, 3,754 / 157,458 on `VditorIRDOM2Md` (these paths build text through `DomText`) |
| totals | | encode 11,951 calls / 819,329 units; decode 34,158 calls / 656,708 bytes | | 31,459 of the decodes are ≤32 bytes (25,802 ≤12 bytes) |

Attribute values (measured with a counting accessor in the `count` variant): 8,924 `Attribute.Val` created, 6,594 (74 %) read at least once, 13,020 reads in total.

Other paths (measured, same fixture): `HTML2Md` encode 13,428 / 739,983 (of which `util.StrToBytes` 8,775 calls from `h2m.ts`), decode 32,653 / 623,094, plus the `DomText` round trip above. `SpinVditorDOM` is `VditorDOM2Md` plus `Md2VditorDOM`: 13,494 / 1,026,036 and 36,627 / 1,204,553 (the Markdown is encoded once more and the HTML result decoded once more; one call each). `VditorIRDOM2Md`: 10,840 / 1,058,511 and 45,440 / 839,362 (twice the tokens, because the IR DOM is 794 K characters). `MarkdownStr`: one encode of the input and one decode of the output and nothing else (it is the negative control below).

**Cost of the conversions alone, replayed** (measured: `replay.ts` records every input of `conv.BytesFromString` / `conv.StringFromBytes` during one call, then times the whole call and the replay of the recorded conversions in the same short process, interleaved, fastest of five; two processes in the fast state of the machine, canary 1.01 and 0.85):

| part | `VditorDOM2Md` spec | `HTML2Md` spec | `VditorDOM2Md` non-ASCII 54 KB | `VditorDOM2Md` 1 KB |
|---|---|---|---|---|
| whole call | 31.4 / 28.8 ms | 48.5 ms | 7.4 ms | 0.53 ms |
| step 1, encode of the document | 1.9–2.3 % | 1.6 % | 1.8 % | 0.5 % |
| step 1 with the tokenizer's clone | 2.5–2.6 % | 1.8 % | 1.5 % | 0.6 % |
| step 3 and everything else encoded (11,950 calls) | 4.5–4.9 % | 3.3 % | 5.6 % | 1.2 % |
| of which ≤64 units / >64 units | 2.4 % / 1.7 % | 1.5 % / 1.4 % | 4.4 % / 0.9 % | |
| step 4, decode of the result | 0.6–0.7 % | 0.5 % | 0.7 % | 0.2 % |
| step 2 and everything else decoded (34,157 calls) | 6.1–7.4 % | 4.1 % | 4.3 % | 1.2 % |
| of which ≤32 bytes / >32 bytes | 5.0–5.8 % / 1.9–2.0 % | 3.5 % / 1.0 % | 3.0 % / 1.0 % | |
| **all conversions** | **14–15 %** | **9.7 %** | **12 %** | **3.7 %** |

(`HTML2Md` additionally has the `DomText` round trip, measured separately below: about 3 % more.)

What this changes in the picture of the table at the top of this task:

1. **The total of about 14 % is confirmed, but it is not "four conversions".** The two whole-document conversions (steps 1 and 4) are 3.2 % together, not 7 %. The remaining 11 % is about **46,000 small conversions per call**, most of them of 12 bytes or less, where the cost is the fixed per-call overhead (a function call, an ASCII scan, a fresh string or typed array), not transcoding.
2. **A third of the small decodes are entity names** (`unescapeEntity`, 15,848 of 34,158), which the task did not list. They belong to the "fast paths in entity unescaping" wave that the owner approved separately; whichever wave takes them, they should be counted once.
3. **Every conversion in the table exists in Go with the same count** (read: `string(z.Text())`, `string(val)`, `atom.String`, `string(s[1:max])`, `[]byte(content)`, `string(formatted)`; GopherJS runs the same code). None is introduced by the port's modelling of strings or slices; what the port adds is the price per conversion: UTF-8 to UTF-16 transcoding, the TextEncoder/TextDecoder fixed cost of several hundred nanoseconds above the short-ASCII thresholds, and the `slices.Clone` of the input. The only conversion the port adds that Go does not have in that form is the tokenizer's private copy of the input (Go copies through the reader instead, so the count is even there).
4. **The 1 KB input does not care** (3.7 %, fixed costs elsewhere dominate), and the non-ASCII document behaves like the spec. The problem is proportional to document size and matters for the first call, one-off conversions and changed blocks, as option E says.

Consequence for the options: a tokenizer rewrite (C) attacks 2.5 % (step 1) plus the text and attribute decodes it would turn into slices; a slice fast path (A) attacks the untransformed text spans only; and **the bulk of the cost sits in the runtime layer's per-call overhead, which can be reduced behind the same API without touching any Lute file**.

### 2. Options, with the ones not in the list above

Legend for "1:1": *unchanged* (no Lute file changes), *PORT-NOTE* (a local departure in a ported file, marked as `ts/PORTING.md` prescribes), *parallel* (a second implementation next to the 1:1 one), *architecture* (the Go shape is no longer followed).

**R1 (new). Interning cache for short decodes, in `runtime/conv.ts`.** `StringFromBytes(b)` with `b.length <= 32`: FNV hash of the bytes, a direct-mapped table of 4,096 slots holding a private copy of the key bytes and the decoded string; a hit is verified by a byte comparison and returns the stored string, a miss decodes as today and stores. Removes: most of the per-call cost of the 31,459 short decodes (attribute values: 110 distinct; `data-*` keys; entity names; short texts; tag names of unknown elements), because the same few hundred byte strings recur. 1:1: **unchanged**; the departure is inside the runtime layer, where `conv.ts` already carries two `PORT-NOTE: perf ... (no Lute source line; runtime layer)` markers of the same kind. Following upstream: nothing to follow; Go's `string(b)` semantics are preserved exactly (an immutable string with the same value; sharing is unobservable). Guards: `runtime/conv.test.ts` (valid, invalid, BOM, long inputs), plus a new differential test of the cached function against the uncached one on random bytes with a deliberately tiny table (collisions forced) and invalid UTF-8 (the cache stores whatever the slow path returns, so per-byte U+FFFD is preserved); the output hashes of the 14 engine methods; `npm test`. Risks: the table is module-level and lives for the process (at most 4,096 × (≤32 bytes + object overhead), about 0.5 MB, bounded, no eviction needed because a slot is simply overwritten); the key must be a copy, because the tokenizer's `Text()`/`TagAttr()` results alias `z.buf`, which is edited in place (`lower`, `unescape`, `convertNewlines`) — a stale key would only cause a miss, never a wrong hit, because of the byte comparison; hash collisions cost thrashing, never correctness. Memory of the DOM goes *down* (one string per distinct attribute value instead of 8,855). Gain (measured, `candidates.ts`, recorded inputs of a real call, equality checked on every input, two processes, fastest of seven interleaved rounds): all decodes of the `VditorDOM2Md` call 2.35 / 2.57 ms → 1.65 / 1.51 ms (−0.7 to −1.0 ms, **2.5–3 % of the call**); `HTML2Md` 2.29 → 1.41 ms. A 64-byte limit is slightly worse than 32 (the key copies grow). Confidence: high on the micro, medium on the whole call (see the measurement finding in section 4).

**R2 (new). ASCII loop for encodes up to 256 units, in `runtime/conv.ts`.** Today `BytesFromString` loops up to 64 units and calls `TextEncoder.encode` above; the fixed cost of `encode` is paid 1,100 times per call for strings of 65 to 512 units (code block contents, `UnescapeHTML`, `DomText` results). Replace the ASCII pre-scan plus fill with one loop that fills and breaks at the first non-ASCII unit, limit 256. Removes: the TextEncoder fixed cost for 1,100 calls. 1:1: unchanged (runtime). Guards: `conv.test.ts` (capacity-equals-length, surrogates), the engine hashes. Risks: none found; `encodeInto` into an array of `s.length` for longer strings was measured too and is equal to the loop, not better. Gain (measured as above): all encodes 1.65 / 1.59 ms → 1.24 / 1.28 ms (−0.35 ms, **about 1.2 % of the call**); limits 128, 256 and 1,024 are within noise of each other.

**R3 (new). `bytes.Buffer.String()` on the same decode path as `conv`.** `Buffer.String` still does `utf8.Valid` plus a non-fatal `TextDecoder` (the path `conv.StringFromBytes` left in optimisation wave 1), with no short-ASCII fast path. `DomText`, `DomTexhtml`, `domCode` and the footnote re-render go through it. Change: `String()` returns `conv.StringFromBytes(this.Bytes())` (same value: both give Go's `string(b)` with per-byte U+FFFD; `bytes.test.ts` has the invalid-input cases, lines 292-297). 1:1: unchanged (runtime). Gain (measured, `buf_micro.ts`, the 3,727 arrays decoded during one `HTML2Md` call, equality checked): 1.58 ms → 0.44 ms (**about 2.5 % of `HTML2Md`**); `VditorIRDOM2Md`: 1.07 → 0.41 ms (0.25 ms with R1), about 1.5 %. Nothing on `VditorDOM2Md` (375 calls). Confidence: high on the micro.

**R4 (new, small). No private copy of the input when the caller owns it.** `NewTokenizerFragment` clones its input (`token.ts:1360`) because the tokenizer edits the buffer in place and Go never touches the caller's bytes. `util.ParseHTML` passes a fresh array nobody else holds. Measured: the clone is 0.2–0.3 ms of the spec call (0.7 %). It needs either a second entry point (`html.ParseOwned`) or a flag, in two 1:1 files (`html/parse.ts`, `util/html.ts`), with a PORT-NOTE each. Below the noise of any whole-call measurement; take it only together with a change that touches those lines anyway. Not recommended alone.

**E1 (overlap with the approved entity wave).** (a) `unescapeEntity`: look up the common entity names (`lt`, `gt`, `amp`, `quot`, `apos`, `nbsp`) by bytes before building the string; 15,848 decodes per call, at most about 2.5 % of the call (measured share of the short decodes; R1 already removes most of their cost, so after R1 the remaining gain here is the hash and the compare, well under 1 %). (b) `html.UnescapeHTML(h)`: when `h` has no `&` byte, return `slices.Clone(h)` instead of decode → `UnescapeString` (which returns its input unchanged when there is no `&`, read: `escape.ts:279-288`) → encode; same bytes, still a fresh array as Go's `[]byte(...)` gives; 1,225 round trips per call (about 1 % of the call, measured as the long-decode and long-encode shares). Both are PORT-NOTE-sized departures in `html/escape.ts` and `html/escape_encode.ts`, guarded by `escape.vectors.test.ts` and `escape_encode.test.ts`. They are listed here so that the entity wave does not count them twice.

**A. Token strings as slices of the input string** (as described above). Measured eligibility on the spec DOM: 3,673 text runs, **1,489 contain `&`** (the span is transformed by `unescape`, so it cannot be a slice), 0 contain `\r`; of the 2,173 runs longer than 32 bytes only 831 are clean (86 KB of 229 KB). Attribute values: all 8,855 are clean, but R1 already returns them from the cache. Ceiling after R1 (reasoned from the replay: the long text decodes are at most 2 % and 38 % of their bytes are sliceable): **under 1 % of the call**, before paying the per-call scan for `&`/`\r` and the byte-offset to UTF-16 cursor. Costs: a PORT-NOTE departure in `html/token.ts` (`Token()` needs the source string and a running byte-to-code-unit cursor; the tokenizer API gains a parameter or a side channel from `util.ParseHTML`), slices keep the 514 KB input alive as long as any node lives (the cache's sandbox keeps nodes beyond the call), lone surrogates would survive where the encoder turns them into U+FFFD today (must be detected). Verdict: **not worth it**; measured ceiling below the noise floor.

**B. Interned tag names and attribute keys.** Subsumed by R1, which interns every short decode without touching `html/token.ts` or `atom.ts`. Known tag names are not decoded at all today (`AtomString` is a slice of `atomText`); the allocation of that slice could be avoided with a string table indexed by atom (0.1 % reasoned, V8 copies slices under 13 characters anyway). Not needed as a separate item.

**C. A tokenizer that reads the string.** Ceiling (reasoned from the replay): step 1 with the clone (2.5 %) plus the text, attribute value and key decodes (about 3.5 % before R1, about 1.5 % after R1, since the short ones are then cache hits) plus the entity-name strings (covered by E1): **4–5 % after R1 and E1**, minus the cost of walking a JS string by `charCodeAt` (comparable to typed-array reads; neutral) and of a string-based `unescape` (a second implementation; `html/unesc_str.ts` is a different function and does not help). 1:1: **architecture** for `html/token.ts` (1,380 lines) and `html/escape.ts`, with `html/parse.ts` unchanged if `Token()` keeps its shape; offsets become UTF-16 indices, so `parser_certificate.ts` (`lastTokEnd`, `bufLen`, `z.raw.end`) must be re-derived; the Go-generated vectors `token.vectors.test.ts` and `parse.vectors.test.ts` would guard the behaviour, with the invalid-UTF-8 vectors re-interpreted (the string tokenizer never sees invalid bytes, which is also what happens through the public API today). Following upstream: `html/token.go` is Go's `x/net/html` copy and changes rarely, but every change would have to be re-applied to a non-1:1 file by hand. Verdict: **not now**; the gain after R1 to R3 is at the noise floor and the departure is the largest of all options. Revisit only if a profile taken after R1 to R3 still shows step 1 as a clear cost on documents of several megabytes, where the clone and the encode are 1 MB each.

**D. Byte-native `html.Node.Data`.** No. (The count of `[]byte(content)` sites alone is 4,159 per call, but the port pays about 50 ns each on the fast path; the 200+ call sites and `DomAttrValue`/`DomText` would change for about 2 %.)

**G (new, rejected). Lazy decode of attribute values.** 74 % of the values are read (measured), and R1 makes a decode of a repeated value a cache hit; an accessor on `Attribute.Val` would change the class shape of a 1:1 file for at most 0.3 % (reasoned). Note for anyone trying it: Node's type stripping keeps `Val;` as an own class field, so a prototype accessor is shadowed; the accessor must be in the class body.

**H (new, rejected). A string type that carries its bytes.** A JS primitive string cannot carry a payload and cannot be a `WeakMap` key; a wrapper object breaks `===`, `typeof`, template concatenation, `Map` keys and the oracle comparison at every one of the 200+ sites that read `Data`, `Key`, `Val`. Not feasible without leaving the Go shape everywhere.

**I (new, rejected). A cache for `BytesFromString` (strings to bytes).** Go's `[]byte(s)` is a fresh mutable array; returning a shared array would alias (`slices.Append` on arrays of 64 bytes or less copies, but `Tokens[i] = ...` writes exist), and copying from a cached array (`slice()`) is not faster than the fill loop for the 9,862 strings of 32 units or less. R2 is the right change for the encodes.

**J (new, rejected). Lazy or one-time conversion at the boundary with views instead of copies.** The DOM path is already "one conversion at the boundary" for the document (step 1) and the result (step 4), and those two are 3.2 %. The per-token conversions cannot be views: Go's `html.Node` is string-typed and the port's strings must be real JS strings for the 200+ sites. The runtime layer is therefore the right place, and R1 to R3 are what "solving it once for all call sites" looks like in practice: every path (`VditorDOM2Md`, `VditorIRDOM2Md`, `HTML2Md`, `SpinVditorDOM`, `BlockDOM2Md`, `SpinBlockDOM`) gets them without a change to any Lute file.

**E. Do nothing.** Still the honest option for the whole-call benchmark: 14 % is the ceiling, and no single option reaches it; see the measurement finding in section 4.

### 3. Managing compatibility when a departure is worth it

What exists (read):

- The marker convention `// PORT-NOTE: perf, departs from 1:1 (<go file>:<line>, <function>): <why, same value because ...>` is in use: 43 markers in 17 files of `ts/src`, with the variant `(no Lute source line; runtime layer)` for `runtime/*.ts`. Every ported file starts with `// Ported from <go file> @ <8 chars of UPSTREAM_PIN>`.
- Behaviour guards: Go-generated vectors per package (`conv.test.ts` and `bytes.test.ts` with invalid UTF-8, BOM and surrogate cases; `token.vectors.test.ts`, `parse.vectors.test.ts`, `node.vectors.test.ts` for the HTML package), the oracle bundle with its patch directory and the rule "a deliberate departure is a Go patch plus a rebuilt bundle, never a filter", the throw-parity scan, the bundle test, and differential tests of the cache against the normal path.
- Measurement discipline: `bench/lib/canary.ts`, `bench:macro` with interleaving and the discard rule.

What is missing:

1. **A manifest of departures that can be regenerated and checked.** The 43 markers carry the Go file and line but not the pin they were checked against, and nothing lists them. Add `ts/tools/departures.mjs`: it greps `PORT-NOTE: perf` (and `PORT-NOTE: byte offset`, `UPSTREAM-BUG`) and prints one row per marker with the TS file:line, the Go file:line it names, and the pin from the TS file's header. Commit its output as `ts/DEPARTURES.md` and let a test fail when the generated text differs from the committed file (the same mechanism as the vectors).
2. **A pin-bump check.** When `UPSTREAM_PIN` moves, a script (`ts/tools/pin-diff.mjs`) runs `git diff --stat <old> <new> -- <go files>` over the Go files named in the headers and prints, for every changed Go file, the ported file and the departure rows inside it from (1). That is the list of places where a hand merge is needed; the rest is the ordinary 1:1 re-port. A departure in a runtime file (R1 to R3) never appears in that list, which is the point of keeping the cost in the runtime layer.
3. **Reference implementation plus differential test for every fast path.** For R1 and R2 the reference is the current function kept under its own name (`StringFromBytesSlow`, module-private) and the new test compares the fast function with it over random inputs (lengths 0 to 300, ASCII, CJK, emoji, invalid bytes, surrogates) and over a run of the HTML tokenizer on the test corpus, with a tiny cache size injected to force collisions. For any future non-runtime fast path (A, C, E1) the same rule applies at the function level: the 1:1 function stays in the file as the reference, the fast one is differential-tested against it in the package's test file, and the marker names both.
4. **A rule for the measurement gate of small gains** (section 5), because the current rule ("a whole-call gain that repeats in two independent runs") cannot accept any option of this task on this machine.

### 4. Evidence and its limits

- **Measured, exact:** all counts (sections 1 and 2), attribute reads, the eligibility counts for option A, the distinct attribute values.
- **Measured, timing, high confidence:** the replay ceilings and the candidate comparisons. They are deterministic input sets timed in one short process, interleaved, fastest of several rounds, with the canary printed; the two processes of each agree within 10 % and the ranking of the candidates is the same on `VditorDOM2Md` and `HTML2Md`.
- **Measured, timing, low confidence:** the whole-call comparison (`run.ts`, four rounds, one process per variant and round, variants alternating, 600 ms budget each, hashes equal everywhere, one row per method discarded by the canary): `VditorDOM2Md` spec base 29.73 ms, `rt` (R1+R2) 28.32 ms (0.953x on the fastest process), `rtdec` 1.003x, `rtenc` 1.052x; `HTML2Md` base 44.48, `rt` 0.948x; `VditorIRDOM2Md` 1.029x; non-ASCII 1.047x; 1 KB 1.069x; the negative control `MarkdownStr` (no conversions on its path) 1.009x. Medians swing between 0.85x and 1.33x from process to process. **This is the finding that matters for the gate: an effect of 3 to 5 % cannot be seen in whole-call timing on this machine while another agent runs, and the control shows that the noise floor on minima is about ±5 %.** The micro measurements are the evidence; the whole-call run can only show that nothing regressed beyond the noise.
- **Reasoned:** the ceilings of A and C after R1, the memory bound of the cache, the equivalence of `Buffer.String` and `conv.StringFromBytes` on invalid input (both run the same per-byte loop; the tests at `bytes.test.ts:292` and `conv.test.ts:55` pin it).

### 5. Recommendation

Order of steps, each with its own gate. All of them keep every Lute file untouched; the only files that change are `ts/src/runtime/conv.ts`, `ts/src/runtime/bytes.ts` and their tests.

1. **R1 + R2 in `runtime/conv.ts`** (one change, about 60 lines, the prototype is `ts/experiments/conv-proto/patch_conv.ts`). Gate: (a) output hashes of the 14 methods of `bench:macro` equal to the current bundle on `tiny`, `small`, `medium`, `spec`; (b) `runtime/conv.test.ts` extended with the differential test of section 3.3, `npm run typecheck` clean, `npm test` green, and `npm run test:full` before the commit when the machine is free; (c) the replay micro (`candidates.ts` on `VditorDOM2Md` and `HTML2Md`) shows the cached decode and the loop encode faster than the current functions in two independent processes (today: 2.35 → 1.65 ms and 1.65 → 1.24 ms); (d) the whole-call run (`run.ts`, with `MarkdownStr` as the control) shows no variant slower than 1.10x the base on any row; a whole-call *gain* is not required, because it is below the noise floor.
2. **R3 in `runtime/bytes.ts`** (`Buffer.String` through `conv.StringFromBytes`; 5 lines, prototype `patch_buf.ts`). Gate: the same hashes; `bytes.test.ts` green including the invalid-input cases; `buf_micro.ts` on `HTML2Md` and `VditorIRDOM2Md` faster in two processes (today 1.58 → 0.44 ms and 1.07 → 0.25 ms); no whole-call regression.
3. **Hand E1 to the entity wave** with the counts of section 1 (15,848 entity-name decodes and 1,225 `UnescapeHTML` round trips per spec call) so that it is measured once, after R1, and not claimed twice.
4. **Tooling of section 3** (`departures.mjs`, `DEPARTURES.md` check, `pin-diff.mjs`): independent of the above, small, and it makes every later departure cheaper to carry. Do it before the first non-runtime fast path is accepted anywhere in the port.

Expected total of 1 to 3 on `VditorDOM2Md` spec: about 4 % (measured ceiling of the micro gains, 1.2 ms of 29 ms); on `HTML2Md` about 6 %; on `VditorIRDOM2Md` about 4 %. The remaining 9 to 10 % of conversion cost is the fixed cost of about 46,000 real allocations per call that Go makes too; removing them means not making the strings or arrays at all, which is what options C and D are, and they are not worth their departure.

What I would **not** do, and why:

- **Not A**: measured ceiling under 1 % after R1 (1,489 of 3,673 text runs contain an entity and cannot be sliced), a tokenizer-level departure, and slices pin the whole input in memory.
- **Not C**: the largest departure of all (a non-1:1 `html/token.ts`, re-derived certificate offsets, a second `unescape`) for 4–5 % at best after R1 to R3, with upstream changes to `x/net/html` then merged by hand forever.
- **Not D, G, H, I**: rejected above with the measured or reasoned reason each.
- **Not R4 alone**: 0.7 %.
- **Not a whole-call gate for any of this**: it would reject every option of this task on this machine, including ones that are measurably right; the micro replay with equality checks is the gate, the whole-call run is the regression check.

Open risks: the whole-call effect of R1 to R3 is predicted from micro measurements, not seen (the machine was shared; repeat `run.ts` once on an idle machine before the commit); the interning table is process-global state in a module that had none (bounded, but a consumer that converts gigabytes of distinct short strings pays an extra `slice()` per miss, about 30 ns); R3 changes which decoder reports an error for invalid UTF-8 inside a `Buffer` (fatal decoder plus the same per-byte fallback: same result, tested, but the failure path is now exercised through an exception).
