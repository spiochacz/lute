# Design study: incremental and fast paths for the TypeScript port (2026-10-11)

Analysis and design only. Nothing under `ts/src/`, `ts/test/`, the Go sources or `javascript/` was changed. All experiments are scratch scripts in `scratchpad/design004/` (session scratchpad) and use `ts/dist/lute.esm.js` read-only, or a patched copy of `ts/src` in the scratchpad (the walk counter).

Labels: **[measured]** a scratch run in this session; **[source]** read from code; **[inference]** reasoned, not measured; **[guess]** an estimate with no evidence behind it.

**Timing caveat.** The machine was busy during every timing below. Absolute numbers are inflated by an unknown factor (the `MarkdownStr` baseline on the 212 KB spec read 25 ms in plan 003 and 32 ms here). Only ratios between interleaved variants are used, each the fastest of several runs; anything under 20% is noise. Prototype speedups are therefore given as ranges.

## 0. Summary

1. **Ordinary keystrokes call the engine on one block only.** In WYSIWYG and IR mode a keystroke calls `SpinVditorDOM` / `SpinVditorIRDOM` on the *current block* (plus neighbours in a few cases): 40-450 microseconds for typical blocks [measured]. SV mode is a plain `<textarea>`: no Lute call per keystroke, and `Md2VditorSVDOM` / `SpinVditorSVDOM` are never called by Vditor (the quadratic SV renderer fix has no Vditor effect).
2. **But some keystrokes run a synchronous whole-document `getMarkdown`.** In both modes, when the user types a space at the end of a block (the most common typing event: `endSpace`), types spaces at the start of a block (`startSpace`), or the block is a heading marker or `---` (`isHeadingMD`, `isHrMD`), the `input` listener skips `Spin*` and instead runs `vditor.options.input(getMarkdown(vditor))` immediately and returns (`wysiwyg/index.ts` listener ~line 385-399, `ir/input.ts` the `startSpace`/`endSpace` branches). `getMarkdown` is `VditorDOM2Md` / `VditorIRDOM2Md` on the whole editor `innerHTML`: 41-135 ms on a 200 KB document [measured, busy machine]. It happens only when the host registered `options.input` as a function (host dependence: [inference] that many do). There is no debounce on this path and it returns before `afterRenderEvent`, so no undo-stack diff runs there; the browser cost that remains is the `innerHTML` serialisation. The DOM is unchanged except for the typed space, which is the ideal case for a per-child cache.
3. **The debounced whole-document calls:** after the last input, 800 ms later (`undoDelay`), `getMarkdown` again (`VditorDOM2Md` / `VditorIRDOM2Md`), then counter, cache, `options.input`, undo stack; in SV mode `Md2HTML` for the preview, 1000 ms after the last input (`preview.delay`). The tick also does browser work I could not measure (A.5).
4. **Primary item for scenario 1: a per-top-level-child cache for `VditorDOM2Md` / `VditorIRDOM2Md`** (B.4 iii), because that is the call on both the synchronous space/heading path and the pause tick. Timing of an unvalidated composition: 78-135 ms -> 4-8 ms on a 200 KB document [measured]. The separator between children is not constant (tables, lists, adjacent lists), so it needs untrimmed per-child output, a whitelist of cacheable child kinds and a differential fuzzer before any claim. The splitter is 2-5 ms of the 4-8 ms, so a cheaper scan is the next lever.
5. **Second item: a chunk cache for Markdown-to-HTML/Vditor-DOM** (opt-in, off by default) whose boundaries come from the engine's own block-parser state (a cut after a blank line when `Root.LastChild` is closed). A prototype gave **0.8-1.0 ms per edit instead of 44-55 ms** on a 200 KB document with byte-identical output for `MarkdownStr`, `Md2VditorDOM`, `Md2VditorIRDOM` [measured, eligible documents only]. It serves the SV preview (`Md2HTML`), `setValue` and mode switches, not the typing path. Only correct for documents without cross-block dependencies (link reference definitions, footnotes, ToC, duplicate heading IDs, front matter, block IALs), which need explicit keys or a whole-document fallback (B.3).
6. **A one-entry memo per method** (same input string and options epoch gives the stored output) is trivial and risk-free, but it does **not** help the typing path: the string changes with every space. It only helps repeated identical calls (a host calling `getValue()` after Vditor's own `getMarkdown` on the same tick, mode toggles, `setValue(getValue())`) [inference].
7. **Scenario 2 (one-off large render):** no cache helps. A second, lean HTML pipeline is **not recommended** now: large to build, costly to keep in step with upstream (249 commits touched `parse/` or `render/` since 2025-01-01), and its gain is a [guess] of 2-4x on the covered subset. The honest ceiling inside the 1:1 pipeline after plan 003 is small (walk fusion: at most about 8-10%). Chunk-independent processing offers worker parallelism as an extra API, with a [inference] best case of about 2x on four warm workers.

## A. What Vditor actually calls

Source: `https://github.com/Vanessa219/vditor`, branch `master`, commit `4535ffb0c6b70809a0d5bcb477d9568e297ae83f` (2026-08-30), files under `src/ts/` and `src/index.ts`, fetched with `curl` and grepped locally (`lute.<Method>(` over the whole tree). Web access worked; nothing here is inferred from method names.

### A.1 Per keystroke (not debounced)

| Mode | Handler | Lute call | Input |
|---|---|---|---|
| WYSIWYG | `wysiwyg/index.ts` `input` listener (lines ~320-410) then `wysiwyg/input.ts` `input()` | `vditor.lute.SpinVditorDOM(html)` (`input.ts:147`) | `blockElement.outerHTML` of the closest `data-block` element; the **top-level list** (`getTopList`) when inside a list (the previous and next sibling lists are pulled in too); the footnotes block when inside one; the callout when inside a callout. After it, every `[data-type='link-ref-defs-block']` and `footnotes-block` element is appended to the HTML (unless the block text starts with ```` ``` ````), so those blocks are re-spun on every keystroke. **Whole editor `innerHTML`** when there is no enclosing block, or when the edited block is the `link-ref-defs-block`. |
| IR | `ir/index.ts` `input` listener (line ~136) then `ir/input.ts` `input()` | `vditor.lute.SpinVditorIRDOM(html)` (`input.ts:179`) | Same selection rules; additionally the blockquote ancestor (so `> ---` is not read as front matter), and on `insertParagraph` the **previous sibling** block as well. Whole `ir.element.innerHTML` for the root case and the link-ref-defs block. |
| SV | `sv/index.ts` `input` listener then `sv/process.ts` `processAfterRender` | **none** (SV is a `<textarea>`; `getMarkdown` reads `sv.element.value`). | `vditor.preview.render(vditor)` is called every keystroke but only arms a timer (`preview/index.ts:145`, `clearTimeout(this.mdTimeoutId)`; `delay` 1000 ms). |

Not called anywhere in Vditor: `Md2VditorSVDOM`, `SpinVditorSVDOM`, `HTML2VditorSVDOM`, `FormatStr`, `MarkdownStr` (it uses `Md2HTML`), any Protyle or BlockDOM method.

Early exits that skip `Spin*` (they do **not** skip Lute): typing a space at the start or end of a block, `isHeadingMD`, `isHrMD` (WYSIWYG listener) and the `startSpace`/`endSpace` branches in `ir/input.ts` run `vditor.options.input(getMarkdown(vditor))` synchronously when `options.input` is a function, then return. That is a whole-editor `VditorDOM2Md` / `VditorIRDOM2Md` per such keystroke (see A.2). Composition (IME) defers everything to `compositionend`.

### A.2 Debounced (after a pause)

| What | Where | Lute call | Input |
|---|---|---|---|
| Value for the host, counter, `localStorage` cache, undo stack | `wysiwyg/afterRenderEvent.ts` and `ir/process.ts` `processAfterRender`: `window.setTimeout(..., vditor.options.undoDelay)`, default `undoDelay: 800` (`util/Options.ts:129`) | `getMarkdown` -> `vditor.lute.VditorDOM2Md(vditor.wysiwyg.element.innerHTML)` / `VditorIRDOM2Md(vditor.ir.element.innerHTML)` (`markdown/getMarkdown.ts`), wrapped in `code160to32` | **The whole editor `innerHTML`**, once per tick. The result is passed to `options.input`, `counter.render` (counter and cache are off by default: `counter.enable: false`, `cache.enable: false`), `devtools` (`RenderEChartsJSON`, only with devtools), and `undo.addToUndoStack`. |
| **Synchronous, per keystroke, when `options.input` is set** | `wysiwyg/index.ts` `input` listener (`(startSpace && ...) || endSpace || isHeadingMD(...) || (isHrMD(...) && previousElementSibling)` -> `vditor.options.input(getMarkdown(vditor)); return;`), `ir/input.ts` (`startSpace` and `endSpace` branches) | `VditorDOM2Md` / `VditorIRDOM2Md` | **The whole editor `innerHTML`**, no debounce, no undo-stack diff on this path. Triggered by a space typed at the end (or start) of a block, by `# `, by `---`. |
| Preview (SV mode, or the preview panel) | `preview/index.ts` `render()` (lines 145-205) | `vditor.lute.Md2HTML(markdownText)`, `markdownText = getMarkdown(vditor)` | Whole document, after `preview.delay` (1000 ms) of idleness; a new call cancels the timer. `getMarkdown` is called twice in `render()`; in SV mode both are a cheap textarea read. |
| Outline, ToC | `outline/index.ts`, `util/toc.ts` `renderToc` | none (DOM based) | |
| Undo / redo | `undo/index.ts` `renderDiff` | `SpinVditorDOM` / `SpinVditorIRDOM` only for blocks with an `echarts` preview; otherwise it sets `innerHTML` from the diff | |

### A.3 Once (or on explicit user action)

| Call | Where |
|---|---|
| `Md2VditorDOM(md)` | `wysiwyg/renderDomByMd.ts` (`setValue`, initial value), `fixBrowserBehavior.ts:1618` (paste of plain text with link) |
| `Md2VditorIRDOM(md)` | `src/index.ts:361` (`setValue`), `toolbar/EditMode.ts:59` (mode switch), `fixBrowserBehavior.ts:1614` |
| `HTML2VditorDOM`, `HTML2VditorIRDOM`, `HTML2Md` | paste (`fixBrowserBehavior.ts:1565-1571`), initial value from innerHTML (`ui/initUI.ts:178`) |
| `Md2HTML`, `VditorDOM2HTML`, `VditorIRDOM2HTML` | `getHTML` (`markdown/getHTML.ts`), the exports |
| `VditorDOM2Md` / `VditorIRDOM2Md` | copy and cut (`wysiwyg/index.ts:242`, `ir/index.ts:91`), `getValue()`, `options.blur` |
| `SpinVditorDOM` on one block | list indent/outdent (`fixBrowserBehavior.ts:347,416`), table header, emoji and hint insertion, paste of code (`wysiwyg/index.ts:305`: the **whole editor `innerHTML`** when no block is found) |

### A.4 Cost per keystroke in the port [measured, busy machine]

`SpinVditorDOM` / `SpinVditorIRDOM` on one block, with a caret `<wbr>`, min of 40 x 20 repetitions (`scratchpad/design004/spin.mjs`):

| Block (markdown size) | WYSIWYG Spin | IR Spin |
|---|---|---|
| heading (14 B) | 44 us | 46 us |
| short paragraph (15 B) | 36 us | 32 us |
| paragraph (237 B) | 85 us | 104 us |
| paragraph (713 B) | 174 us | 235 us |
| list of 10 items (229 B) | 297 us | 336 us |
| table of 20 rows (319 B) | 451 us | 561 us |
| fenced code, 40 lines (629 B) | 73 us | 95 us |

So the Lute share of a keystroke is well under one frame (16 ms), and a block cache cannot help it: the edited block is new text each time. The exceptions are the whole-editor cases above and one huge top-level block (a list or table of many thousands of lines), where the unit is the whole list.

On the synchronous space/heading path of A.2 the Lute cost is the whole-document `getMarkdown` below, per such keystroke, not the block-level numbers above.

Whole documents [measured]: 212 KB spec: `VditorDOM2Md` 41 ms, `VditorIRDOM2Md` 59 ms, `SpinVditorDOM` of the whole editor 76 ms; a 200 KB article of ordinary content (generated, 2,682 top-level DOM children, WYSIWYG DOM 585 KB, IR DOM 1.16 MB): `VditorDOM2Md` 78 ms, `VditorIRDOM2Md` 135 ms, `Md2VditorDOM` 76 ms, `MarkdownStr` 69 ms.

### A.5 What I could not measure (inference)

Per tick the browser also does, on a 0.5-1 MB DOM: `innerHTML` serialisation for `getMarkdown`; in `addToUndoStack` (`undo/index.ts`) a `cloneNode(true)` of the editor, an `outerHTML`/`innerHTML` serialisation, and `diff_match_patch` `diff_main` + `patch_make` over the two HTML strings; and when enabled a `localStorage.setItem` of the Markdown. The diff cost depends on how much of the text changed (the library trims a common prefix and suffix first). These may be as large as the Lute call, which bounds the user-visible gain of anything below. **Step 0 of the plan is to measure this in a browser** (section D).

## B. Incremental designs for scenario 1

### B.1 The core idea: cut where the parser says the document is closed

`Tree.parseBlocks` is a forward-only, line-by-line state machine (`parse/blocks.ts`: `incorporateLine` starts at `Root`, walks down `LastChild` while the child is not `Close`d, and only then decides what the line is). If, after consuming a blank line, `Root.LastChild` is null or already closed, then **the parser state is "document open, nothing pending"**, and the rest of the input is parsed exactly as if it were a fresh document, except for the global `Context` fields (`rootIAL`, `tabs`, `tabsItemIAL`) and the "root is empty" tests. That is the engine's own criterion, so it agrees with `parseBlocks` by construction, including every construct that makes a hand-written boundary detector hard:

| Construct | Why the criterion handles it |
|---|---|
| Lists, loose/tight | A list item stays open across blank lines, so no cut inside a list. A list absorbs the block after it (the next cut is after that block). |
| Fenced code swallowing the rest, indented code | The code block is open; no cut until it closes. An unclosed fence makes one chunk to the end of the input. |
| HTML blocks (types 1-5 continue across blank lines) | Open until the end condition; the README test (a `<p align="center">` block with blank lines inside) cut correctly. |
| Lazy continuation, setext headings, tables | These happen on consecutive non-blank lines, inside one chunk. |
| Blockquote, callout, super block, footnote definition | Containers are open until a line fails to continue them. |

The criterion is evaluated on the **lexer's normalised line stream**. `lex.Lexer.NextLine` turns `\r\n` and lone `\r` into `\n` and appends a missing final newline [measured: `"a\r\nb\r\n"` gives lines `"a\n"`, `"b\n"`], so byte offsets in a raw CRLF input are *not* line lengths. My first cut experiment accumulated `line.length` over a CRLF README and produced chunks that ended in the middle of a line; the apparent "disagreement with parseBlocks" was this offset drift, not a boundary bug (after normalising `\r\n` the README matched). Rule for the implementation: **cut offsets are computed in normalised-text coordinates; the engine normalises the input first (the same transformation the lexer applies).** For Vditor, version 1 may simply send input containing `
` to the whole path (a textarea value or `innerHTML` is LF). For one-off renders of files from disk (4 of 9 sample files are CRLF) up-front normalisation is the better v1, provided no entry point touches the raw string before the lexer; the fuzzer must check that (the Vditor wrappers do their own string replacements before parsing).

### B.2 What the experiments showed

(1) **Concatenation equals the whole result, when nothing global is involved** [measured, `chunk4.mjs`]. Cut with the criterion above, render every chunk with the public method, concatenate, compare with the whole-document call:

| Document | Chunks | `MarkdownStr` | `Md2VditorDOM` | `Md2VditorIRDOM` |
|---|---|---|---|---|
| CommonMark spec (212 KB) | 1,999 | identical | identical | identical |
| GFM spec (227 KB) | 2,079 | identical | identical | identical |
| `tasks/003-performance-plan.md` | 49 | identical | identical | identical |
| `README_en_US.md` (after CRLF normalisation) | 50 | identical | identical | identical |
| `ts/PORTING.md` | 15 | identical | identical | identical |
| `tasks/001-analysis.md` | 133 | identical | **differs** | **differs** |
| `test/commonmark-spec-kramdown.md` | 1,388 | **differs** | **differs** | **differs** |

The two failure classes are the real dependencies: in `001-analysis.md` the Vditor renderers emit heading IDs (`id="wysiwyg-2026-10-10-"`) and the *second* heading with the same text gets a trailing `-`; the chunk render has no memory of the first one (10 characters of difference in total). In the kramdown spec, a trailing `{: id=... type="doc"}` line is the document IAL (and block IALs attach across blank lines).

(2) **Targeted probes of other dependencies** [measured, `t5.mjs`, `t6.mjs`]:

| Probe | Result |
|---|---|
| `Text [foo] and [^1].\n\n[foo]: /url\n\n[^1]: note\n\nlast [^1]` | Whole call resolves the reference and numbers the footnote refs `1` and `1:2`; chunked rendering leaves `[foo]` literal and numbers every ref `1`. **Break.** |
| `a\n\n---\ntitle: x\n---\n\nz` (YAML front matter enabled by default) | Whole call: `<hr />` + `<h2>`; the *second chunk* parsed alone: a front matter block. `parse/yaml_front_matter.ts:34` only accepts front matter when `t.Root.FirstChild === null`. **Break** unless a chunk parsed in isolation gets a dummy first child. |
| `# a\n\n# a` in WYSIWYG | Whole call: `id="wysiwyg-a"` then `id="wysiwyg-a-"`. **Break** for isolated chunks. |
| `- a\n\n- b\n\npara` split naively at blank lines | Tight/loose changes (`<li><p>a</p></li>` vs `<li>a</li>`) and two lists. **Break** for a naive splitter; the criterion never cuts here because the list is open. |

(3) **The prototype** [measured, `proto.mjs`, busy machine]: keep the previous input and its chunks `[start, end, output]`; on a new input compute the common prefix and suffix, find the first chunk not entirely inside the prefix, re-run the *real* block parser from that chunk's start (a fresh `Tree`/`Context`, calling `incorporateLine` per lexer line) until it reaches a cut whose offset maps (shift by the length delta) to an old chunk end lying entirely inside the common suffix; render only the new chunks with the public method; reuse every other chunk's output; join.

| Method | 200 KB document, one edit | Full call | Edits tested for equality |
|---|---|---|---|
| `MarkdownStr` | 1.03 ms | 44.1 ms | 6 edits, all identical |
| `Md2VditorDOM` | 0.87 ms | 49.9 ms | 6, all identical |
| `Md2VditorIRDOM` | 0.84 ms | 55.2 ms | 6, all identical |

The edits were a character inserted and deleted in the middle, near the start and near the end, a line inserted at the start of a block, a fence inserted that splits a code block (boundary change), and a list item inserted. Each re-parsed 107-332 bytes (6-11 lines) and produced one new chunk. Breakdown of the 0.8-1.0 ms: `Buffer.from(200 KB)` 0.11-0.15 ms, prefix/suffix compare 0.21 ms, one 600-byte chunk render 0.11-0.14 ms, joining 2,086 outputs 0.01-0.02 ms, the rest being the boundary scan and map lookups. The test document (`art`: 2,086 chunks, unique headings, no references or footnotes) **avoids every dependency in table (2)**; the figure is the "when eligible" figure.

The same run showed the **cold cost**: building the first state by calling the engine once per chunk took 105-182 ms against 44-57 ms for one whole call (2,086 calls with fixed costs). The real implementation must not do that; see B.5.

(4) **Fallback frequency on real documents** [measured, `elig.mjs`, regexes plus the chunker]: nine Markdown files from this repository (3-87 KB). None had a ToC or front matter; one had link reference definitions (`test/case1.md`: 14); one (`002-upstream-bugs.md`, 2 matches) had `[^x]`-shaped text, a false positive that the check would correctly send to the whole path. Four of the nine contain `
` (CRLF). 27-89% of the *bytes* sit in chunks containing `[` (links), which matter only if the document has reference definitions or footnotes. Chunk sizes: average 254 B to 1,870 B per document (medians not computed), largest chunk 1.3-8.7 KB, 0-4 chunks over 4 KB per document. So chunks without an environment key are the majority; documents with footnotes or ToC take the whole path.

### B.3 Cross-block dependencies and how to handle each

"Cheap detection" is what runs per call; "Fallback" is the conservative rule for version 1; "Precise" is the invalidation rule for later.

| Dependency | Evidence | Cheap detection | Fallback (v1) | Precise rule |
|---|---|---|---|---|
| Link reference definitions | `Tree.FindLinkRefDefLink` looks up a document-wide index (`parse/linkrefdef_index.ts`); forward references resolve; measured break above | Each chunk's parse tells whether it created `NodeLinkRefDef` nodes (count + list of fold key, destination, title) | Any definition in the document: whole path | Key of every chunk containing `[` (prefilter on the text) gets `defsSig` = hash of the ordered list of all definitions in the document. A typing edit that does not touch a definition leaves `defsSig` unchanged. Definitions are discovered in the chunk parse, so a changed definition changes `defsSig`, which invalidates only chunks that contain `[`. |
| Footnote definitions and refs | `FindFootnotesDef`, `FootnotesRefs.length` decides ref ids (`1`, `1:2`), `RenderFootnotes` appends at the end (`html_renderer.ts:1046`), measured break | `Footnotes` option on and `[^` in the text | Whole path | Not worth doing: numbering is document-global by design. |
| Heading IDs | `headingID0` (`render/renderer.ts:793`): one walk over the document, duplicates get `-` appended; used by `HtmlRenderer`, `VditorRenderer` (`id="wysiwyg-..."`), `VditorIRRenderer` (`id="ir-..."`) and the Protyle renderers; measured break | A chunk's parse reports its headings | Treat as an environment key: while walking chunks in order keep the set of used IDs; a chunk with headings is keyed by its final IDs (the suffixed result), computed by simulation. Costs one pass over headings only. Editing a heading's text changes the IDs of later duplicates and re-renders only those chunks. | Same. |
| `[toc]` / ToC | `renderToC` (`render/renderer.ts:864`) renders all headings | `ToC` option on and `[toc]` (case-insensitive) in the text | Whole path | A key from the hash of all heading texts/levels for chunks containing the ToC node. |
| Front matter | `yaml_front_matter.ts:34` tests `Root.FirstChild`; measured break | Option `YamlFrontMatter` | Parse every chunk after the first with a dummy closed first child in `Root` | Same. |
| Block IAL (`{: id=..}`), document IAL, `KramdownBlockIAL` | `finalParseBlockIAL` looks at `n.Next`; `rootIAL`; kramdown spec mismatch measured | Options | Option on: whole path | none |
| Tabs (`Context.tabs`), `SuperBlock`, `Callout` | Containers close at the same criterion; `tabs` map lives in `Context` | Options | `Tabs` on: whole path | none |
| Loose/tight lists, lazy continuation, setext, HTML block, fenced code, indented code | all inside one open construct | none needed | Handled by the criterion (B.1) | |
| Caret `‸` / `<wbr>` | `parseBlocks` moves a leading caret only when `Tip.ParentIs(ListItem)` (needs an open list), never at a cut | none | Not a boundary issue; the edited chunk contains it | |
| Node IDs from `ast.NewNodeID()` | Called only under `KramdownBlockIAL` (`parse/list.ts`, `parse/parse.ts`), in `BaseRenderer.NodeID` (when no IAL), and in the Protyle paths. **Measured** (call twice, diff): with default options only `Md2BlockDOM` and `SpinBlockDOM` are non-deterministic; with Vditor WYSIWYG/IR/SV options the same two; with `KramdownBlockIAL` also `MarkdownStr`, `FormatStr`, `Md2VditorSVDOM`, `Md2HTML`; with the Protyle option set also `Md2VditorDOM` and `SpinVditorDOM`. | Options | Option set that can emit IDs: whole path (a cached chunk would freeze the ID while an uncached call regenerates it; the oracle comparison already normalises IDs) | none |
| `LastOut` | `Newline()` writes `\n` only if `LastOut != '\n'` (`render/renderer.ts:646`); each `Render()` starts with `LastOut = '\n'`. Vditor DOM output does not end in `\n`, so a block whose renderer calls `Newline()` first would differ in isolation. Concatenation matched on all six documents [measured], so the cases that matter did not occur there. | The key includes the last byte of the previous chunk's output, and the chunk render starts with that `LastOut` (needs a small parameter in the renderer constructor). | Include `prevLastOut` in the key | Same. |
| `NodeWriterStack`, `DisableTags`, list numbering | Reset per `Render`; list numbering is inside the list (`ListData.Start`) | | Balanced at the end of every top-level block; checked by the fuzzer | |
| Auto-spacing, typography | `TextAutoSpacePrevious/Next` use `node.Previous/Next` inside the same parent; a top-level paragraph's first inline has no previous sibling | | Same: no cross-chunk effect [source]; the fuzzer must include `AutoSpace` on with CJK text at block edges | |
| Trailing parts the renderer adds at `Render()` end | `HtmlRenderer.Render` appends `RenderFootnotes()` | `Footnotes` | Whole path when the document has footnotes | |
| Final trim | Renderers' `renderDocument`: `FormatRenderer` trims the whole result | | `FormatStr` is **out of v1**: output of `FormatRenderer` is trimmed and block separators are not a constant, so a chunk cannot just be concatenated | |

### B.4 Three granularities compared

| | (i) Memoise whole calls | (ii) Chunk cache inside parse + render (B.1-B.3) | (iii) Per top-level DOM child cache |
|---|---|---|---|
| Methods served | any pure method: `MarkdownStr`, `Md2HTML`, `FormatStr`, `Md2Vditor*DOM`, `VditorDOM2Md`, `VditorIRDOM2Md`, `Spin*` (hit only on an identical input) | Markdown to HTML or Vditor DOM: `MarkdownStr`, `Md2HTML`, `Md2VditorDOM`, `Md2VditorIRDOM`, `Md2VditorSVDOM` (not used by Vditor). Not `FormatStr` in v1. Also the "parse + render" half of `SpinVditorDOM` when it gets the whole editor. | `VditorDOM2Md`, `VditorIRDOM2Md`, and the DOM half of `SpinVditorDOM` for whole-editor input |
| Hit rate while typing | 0 (every keystroke changes the text); useful only for repeated identical calls (`getValue` twice, mode toggles, undo to a known state) | ~100% of chunks except the edited one(s) | ~100% of children except the edited one(s) |
| Correctness argument | trivial (pure function of input and options epoch) | by construction for block structure (B.1) plus the environment keys (B.3), checked by a differential fuzzer (B.7) | needs a boundary rule for HTML (below) and separator rules; **not established** |
| Risk | none | medium, contained by the whole-path fallback and the fuzzer | higher |
| Size | 40 lines | 400-600 lines (boundary scan hook, chunk store, keys, assembly, renderer `LastOut` parameter) + fuzzer | 300-500 lines + more fuzzer |
| Expected gain, 200 KB, one edit [measured prototype, eligible docs] | one extra call avoided when the host duplicates it | 44-55 ms -> 0.8-1.0 ms | 78-135 ms -> 4-8 ms (unvalidated, see below) |

**(iii) in detail.** The input is a string (`innerHTML`). I wrote a quote-aware top-level splitter (void elements, depth stack, bail-out on `<script>`, `<style>`, `<textarea>`, `<svg>`, comments, top-level text) and cached `VditorDOM2Md(child)` per child [measured, `dom2md.mjs`]:

| Document | children | result |
|---|---|---|
| article, 200 KB, WYSIWYG | 2,682 | `join("\n")` of the per-child results equals the whole result |
| `003-performance-plan.md`, WYSIWYG | 56 | equal with `join("\n")` |
| `PORTING.md`, WYSIWYG | 22 | **not equal** (a list followed by a paragraph: the whole call puts a blank line, the child alone is trimmed) |
| article and plan, **IR** | 2,682 / 56 | **no join rule equals the whole**; a table gets an extra blank line (`\n\n\n`) |
| spec, README | | the splitter bails (raw HTML in the DOM) |

Timing of the unvalidated composition: WYSIWYG 92.5 ms full against 3.9 ms (of which the splitter 2.1 ms); IR 142.6 ms against 7.7 ms (splitter 4.8 ms). The mismatches come from `FormatRenderer`'s block separators and from `adjustVditorDOM`, which looks across top-level children: `mergeVditorDOMList0` merges adjacent lists of the same type when the second has exactly one attribute, `adjustVditorDOMListTight0` and `removeEmptyNodes` look at siblings, `searchEmptyNodes` consults `PrevSibling`/`NextSibling` inline-ness. A correct (iii) therefore needs: untrimmed per-child Markdown (a hook before the document-level trim in `vditorDOM2Md`), a conservative list of child kinds that may be cached alone (paragraph, heading, code block, table, hr, blockquote without adjacent lists; never a list next to a list, never top-level text), and a differential fuzzer on DOM trees produced by `Md2Vditor*DOM` followed by random DOM edits. The splitter also has to agree with the HTML tokenizer in `html/`; the conservative bail-outs make a disagreement fall back to the whole path, but "agree" is a claim the fuzzer has to carry.

### B.5 Design of (ii)

**Public API.** Opt-in, off by default; a drop-in for the bundle must behave identically without it. Proposal: `lute.SetIncremental(true)` (same name style as the other ~100 setters) and `lute.ClearIncrementalCache()`; extra methods only on the new object, nothing renamed. A separate constructor is the alternative; a setter is simpler because Vditor builds the engine once and calls setters (`markdown/setLute.ts`). Callers who do not know the option see no change, byte for byte. The bundle has no such option, so the opt-in is an extension, not a compatibility risk.

**State** (per engine instance and per method family): the last normalised input as a `Buffer`; the chunk list `[start, end, outputString, key]`; a text-keyed LRU `Map` (chunk text + key -> output) for undo/redo and moved chunks. Memory per document: input 0.2 MB, outputs 0.5-1.2 MB of characters for a 200 KB document in WYSIWYG (the IR DOM is 2x that), doubled if the engine's strings are two-byte (Vditor DOM contains U+200B). No trees are retained (a 212 KB spec tree is 21 MB, plan 003). Bound: a total character budget (default 8 M characters) with LRU eviction of the text-keyed map; the chunk list itself is bounded by the document.

**Cold start.** Do not render per chunk. Run the normal whole-document path once with two hooks that only record: in `parseBlocks`' line loop, the cut offsets (blank line and `Root.LastChild` null or closed); in `BaseRenderer.Render`'s walk, the writer length when entering each top-level child. The first output string is then sliced into chunk outputs. The slices are right *in this document's environment*, which is why every entry carries its key. The hooks cost one comparison per blank line and one per top-level node.

**Update.** As in the prototype (prefix/suffix, re-run the block parser from the first affected chunk to the first resynchronising cut, render the new chunks). If the re-scanned region exceeds half the input (an unclosed fence above the edit, say), run the normal path and rebuild the chunk list; worst-case cost is the normal path plus the hook overhead.

**Keys.** `(chunk text, options fingerprint, defsSig if the chunk contains "[", heading result IDs if it has headings, prevLastOut)`. Chunk text is the identity; hash it only for the LRU map (V8 caches a string's hash, so a lookup is one pass).

**Options changes.** About 100 setters write plain fields on `ParseOptions`/`RenderOptions`. Fingerprint at call time instead of wrapping setters: join the primitive fields (about 100 reads, a few microseconds), plus a version counter for the object-valued ones (`Terms`, emoji maps via `PutEmojis`/`PutTerms`/`SetEmojis`). A changed fingerprint drops all entries. **Bypass entirely** when `SetJSRenderers` or any `ExtRendererFuncs`/`Md2*RendererFuncs` is installed (Vditor installs them temporarily in paste), and when the option set can emit IDs (table in B.3).

**Eligible option set (v1):** `KramdownBlockIAL`, `KramdownSpanIAL`, `ProtyleWYSIWYG`, `Spin`, `Tabs` off; `Footnotes`/`ToC` allowed with the whole-path fallback per document; `YamlFrontMatter` allowed with the dummy first child. Input containing `\r` takes the whole path until the normalisation is implemented.

**Expected gain per method (200 KB, one edit)** [measured prototype for the three Md2* rows, otherwise inference]:

| Method | Today | With the cache | Remaining cost |
|---|---|---|---|
| `Md2HTML` / `MarkdownStr` | 33-69 ms | about 1 ms | `Buffer.from` 0.15 ms, prefix/suffix 0.2 ms, one chunk 0.1-0.15 ms, scan of the edited region, join 0.02 ms |
| `Md2VditorDOM`, `Md2VditorIRDOM` | 38-76 ms, 43-130 ms | about 1 ms | the same |
| `VditorDOM2Md`, `VditorIRDOM2Md` (design iii) | 40-78 ms, 59-135 ms | 4-8 ms, unvalidated | splitter 2-5 ms (can drop to about 1 ms with a cheaper scan that trusts Vditor's flat DOM), child lookup, join |
| `SpinVditorDOM` per keystroke | 0.04-0.45 ms | unchanged | |
| `SpinVditorDOM` of the whole editor | 76 ms (spec) | with (iii) + (ii): about 1-2 ms plus the edited blocks, **inference** | |

User-visible effect: the pause tick loses 40-135 ms of Lute work but keeps the unmeasured browser costs (A.5); the SV preview loses its `Md2HTML`.

### B.6 Where the cache must not be trusted (stated plainly)

- Documents with footnotes, ToC, reference definitions (until `defsSig` is built), front matter handled wrongly, or any ID-emitting option set: fall back, never approximate.
- A single huge top-level construct (one list with 10,000 items, one long table, an unclosed fence): the chunk is the construct, no gain, correct.
- Edits that change block boundaries far from the edit (an inserted fence line turns the rest of the document into code until the next fence): the resynchronisation takes the parser as far as needed; the test above included such an edit and it re-parsed 107 bytes because the document had fence pairs; with an unmatched fence the cost is the rest of the document.

### B.7 How to prove equivalence

1. **Three-way differential harness** `cached == uncached == oracle`. Uncached is the current port path; the oracle comparison against `test/oracle/lute.ref.min.cjs` already exists for the uncached path (`npm test` runs it), so cached equals uncached equals the GopherJS bundle transitively. The harness compares raw strings, with generated IDs normalised only where the option set permits.
2. **Random edit generator** over a corpus document: insert or delete a character, a word, a line, a blank line, a fence marker, a list marker, a table row, a `[label]: url` line, a `# ` prefix, a `[^1]` reference; undo (restore an earlier text); replace a block with itself. After each edit compare the three outputs and the chunk boundaries with a fresh full scan (`cuts(newText) == cuts maintained incrementally`).
3. **Corpora:** `benchmark/commonmark-spec.md`, `test/commonmark-spec.md`, `test/gfm-spec.md`, `test/commonmark-spec-kramdown.md` (expected: fallback or mismatch classes recorded), `test/*.md` cases (`case1.md`, `format-case*.md`), the Markdown the e2e tests already use (`ts/test/e2e/markdown_files.test.ts`, `markdown_fuzz.test.ts`, `option_sets.ts` for option combinations), `ts/test/go/cases`, and this repository's `tasks/*.md`, `README*.md`.
4. **Option matrix:** `option_sets.ts` extended with: every setter toggled once; the Vditor set from `markdown/setLute.ts`; `AutoSpace`, `FixTermTypo`, `Emoji`, `GFMAutoLink`, `Sup`/`Sub`/`Mark`, `InlineMath`, `Footnotes`, `ToC`, `HeadingID`. For each, the fuzzer asserts either equality or that the call took the whole path (the fallback decision itself is asserted so a missing dependency cannot hide as an accidental pass).
5. **Negative controls** (must produce "fallback taken" or an explicit key difference): the four probes of B.2 (2), duplicate headings, reference defined after use, `\r` input, `---` front matter in a later chunk.
6. **Options-change test:** toggle a random setter between calls; the cached engine must equal a freshly constructed engine with the same options.
7. **Cache-off identity:** `SetIncremental(false)` output identical to the engine without the feature for the whole existing `npm test` (it adds hooks to `parseBlocks` and `Render`; these must be inert).

## C. Scenario 2: one-off render of a large file

### C.1 Whole-tree walks that `MarkdownStr` performs [measured]

Instrumented copy of `ts/src` with a counting wrapper around `ast.Walk` (caller taken from the stack), spec input, 11,655 final nodes. Calls and visits for `MarkdownStr` with default options (the numbers are per call; my script ran one extra parse so the printed counts were doubled for the index walks and `finalParseTableCellRich`; halved here):

| Walk | File and function | Visits (spec) | Notes |
|---|---|---|---|
| Inline parse recursion | `parse/inlines.ts` `walkParseInline` | 11,655 nodes (own recursion, not `ast.Walk`) | needed |
| `finalParseTableCellRich` | `parse/table_rich.ts:338` | 11,655 | only matters when a table with a rich cell exists; plan 003 item L7 gates it |
| Link reference index | `parse/linkrefdef_index.ts:77` `indexLinkRefDefs` | 2,081 per call | built lazily at the first reference-style lookup |
| Footnote index | `parse/linkrefdef_index.ts:105` `indexFootnotesDefs` | 2,081 per call | built at the first footnote lookup even without footnotes |
| `headingID0` | `render/renderer.ts:793` | 11,655 | once per document at the first heading; computed even when the ID is not emitted (`HeadingID(node)` is called before the option test) |
| Renderer | `BaseRenderer.Render` `render/renderer.ts:583` | 11,652 | needed |
| `needUseHTMLTable` | `render/renderer.ts:1297` | 902 (prose doc) | per table |

(For the prose document `003-performance-plan.md`: 3,031 nodes, the same five walks, `needUseHTMLTable` 6 calls.) With the Vditor renderers the set is the same. `finalParseBlockIAL`, `parseKramdownSpanIAL`, `NormalizeInlineHTMLTextStyles`, `finalParseTabs` do nothing in default options. So the post-parse whole-tree walks are: `finalParseTableCellRich`, `headingID0`, the two index walks, and the render walk; plus the parse-time recursion.

**Fusion potential [inference from plan 003's profile shares]:** gating or removing the four non-render walks (L7: table walk 3.5%; `headingID0` 2.8% self; index walks about 1% each) bounds the gain at about 8-10% of `MarkdownStr`, partly overlapping plan 003 L7. Concretely: register reference definitions and footnote definitions at creation (as the Go code did with `Context.LinkRefDefs`), assign heading IDs while the inline pass visits headings, skip the table walk without tables. All are local changes in the 1:1 pipeline and are cheaper than anything below.

### C.2 A second, lean pipeline for HTML only

What it would be: offset-based tokens over the input buffer, compact node records (typed arrays or a few small classes), direct HTML emission, the 1:1 pipeline as differential oracle and fallback for anything unsupported.

**Coverage needed to be usable** [source]: the 1:1 parse and render core is about 19,600 lines (`parse/` plus `render/html_renderer.ts`, `render/renderer.ts`, `lex/`); `ast.Node` has about 140 node types; `ParseOptions` has 48 fields and `RenderOptions` 42. A lean pipeline needs the CommonMark and GFM blocks and inlines (the spec corpus, 650+ examples), tables, task lists, strikethrough, autolinks (`parse/auto_link.ts` alone is 2,287 lines of domain/email rules), link reference definitions, entities, raw HTML (`parse/inline_html.ts` 1,030 lines), plus whichever options are on by default in `New()` (emoji, typography/auto-space, `Sup`/`Sub`/`Mark`, inline math, heading anchors...). Anything outside the supported subset must be detected *before* rendering and routed to the 1:1 path, which means an up-front scan that is itself a pass over the input. I estimate 5,000-8,000 lines for a defensible subset [guess].

**Maintenance** [measured count, inference for cost]: `git log --since=2025-01-01 -- parse render` counts 249 commits on `master` (about 12 a month), each a behaviour change in Lute's own dialect (SiYuan issues). A second implementation must mirror every one that touches the subset, or the subset shrinks. The oracle protects against divergence only on inputs the tests contain.

**Speed-up, evidence and honesty.** What is known: the profile of `MarkdownStr` on the spec (plan 003, 2.5) puts garbage collection at 10.9%, `Append` 9.8%, `ast.Node` construction 8.2%, `Make` 5.1%, `moveBytes` 4.7%: about 39% allocation-bound work that offset tokens and compact nodes would remove; plus `walk` 33.6% inclusive of which the renderer walk is part. What is not known: the cost of the parsing logic that stays (delimiter stack, link scanning, autolink detection, emphasis rules), because it was never measured separately. A byte pass over 212 KB costs 0.3-0.6 ms in this runtime (FNV loop, lexer line pass 1.0 ms [measured]), so a floor of a few milliseconds exists, but a floor is not an estimate. My [guess] for a hand-tuned single-pass renderer on the covered subset is 2-4x faster than the port today, i.e. about 1.5-3x after plan 003 lands. No JS Markdown engine is installed here and I did not install one, so I have no measured reference point; I will not quote published figures from memory.

**Verdict: do not build it now.** Cost 5-8k lines plus a standing mirror obligation, gain unmeasured and bounded to the covered subset, and half of its benefit (allocation) is attackable inside the 1:1 pipeline (plan 003 S1/S2/L3, 1.3x). If the owner later has a measured need of more than 2x on one-off renders, the right sequence is: finish plan 003, fuse the walks (C.1), measure how much of the profile is still allocation, and only then prototype the lean path for the narrowest option set that matters (Vditor's `setLute.ts` set), with a deliberately small subset and the 1:1 fallback.

### C.3 Cheaper alternatives inside the 1:1 pipeline

| Idea | Verdict |
|---|---|
| Fuse the whole-tree walks | Yes, small (about 8-10% at most), local; part of the plan. |
| Lazy inline parsing | No gain for a full render (every block is rendered); useful only for viewport rendering or progressive display, where the chunk list (B.5) is the better tool. |
| Output as string chunks | Rejected in plan 003 (A3): renderers read and edit the buffer. |
| Top-level blocks independently | Possible with the B.1 criterion for eligible documents (no footnotes/ToC/references/front matter/ID options, or with their keys). It enables: (a) the incremental cache, (b) an **extra API** `MarkdownChunks(markdown)` returning `[{start, end, html}]` for hosts that render progressively (idle-time slices, first screen first), (c) worker parallelism. The serial part is the boundary scan, which is a full block parse (about 20% of `MarkdownStr`, plan 003 `parseBlocks` 33.5% inclusive); each worker then re-parses its chunks. Amdahl [inference]: 33 ms becomes about 7 ms serial + 26 ms / 4 + join, about 15 ms best case on four warm workers (2x); structured-clone of strings and a per-worker bundle start-up (32.8 ms for a cold port, plan 001) make it a loss below roughly 1 MB or without pre-warmed workers. Not a replacement, not a v1 item. |

### C.4 Outside the engine (notes only)

Run the engine in a Web Worker so a 30-100 ms call does not block input (same speed, free main thread); pre-warm the worker once; for first paint of a huge file render the first chunks and the rest in idle slices (needs (b) above); keep the Markdown text, not the DOM, as the source of truth so `getMarkdown` is a string read. In Vditor specifically, much of the pause-tick cost is DOM serialisation and the undo diff (A.5), which only the host can change.

## D. Recommendation

Ranked by value over risk. Each item can become a task brief; sizes are estimates [guess] except where tied to measured code.

**0. Measure the real tick in a browser (small, valuable, not a gate).** Load Vditor (commit above) with the port's `lute.min.js` replacing `dist/js/lute/lute.min.js`, a 200 KB document in WYSIWYG and IR, with and without an `options.input` callback; record with `performance.measure` around the synchronous `getMarkdown` of the space/heading path, the 800 ms tick (`getMarkdown`, `addToUndoStack` serialisation and `diff_main`, counter, callback) and per-keystroke `SpinVditorDOM`. Output: where the time goes per event type. It sizes the user-visible gain; the design work below does not wait for it, because the synchronous path has no undo-diff cost and so the Lute call is a large share of it.

**1. Per-child cache for `VditorDOM2Md` / `VditorIRDOM2Md` (B.4 iii): the primary scenario-1 item.** It is the call on the synchronous space/heading keystroke path (A.2) and on the pause tick. Work in this order: (a) validation spike: untrimmed per-child Markdown (a hook before the document-level trim in `vditorDOM2Md`), a whitelist of cacheable child kinds (paragraph, heading, code block, table, hr, blockquote without adjacent lists; never a list next to a list, never top-level text, bail on anything the splitter does not understand), a fuzzer on random DOM edits of `Md2Vditor*DOM` output; (b) only if the fuzzer passes, the cache with the splitter; (c) then a cheaper top-level scan, since the splitter is 2-5 ms of the 4-8 ms [measured]. Expected 78-135 ms -> 4-8 ms, falling toward 2-3 ms with a cheaper scan [measured composition, unvalidated; the second figure is a guess]. Risk: medium-high until (a) passes; opt-in, so no compatibility risk. Size: 300-500 lines plus the fuzzer. Stop if the fuzzer finds a separator or sibling rule that cannot be keyed cheaply.

**2. Hook-only groundwork plus the differential fuzzer (no behaviour change; shared by items 1 and 3).** (a) Boundary recording in `parseBlocks` and top-level output offsets in `Render`, inert by default; (b) the three-way harness of B.7 with the corpora and generators, extended with a DOM-edit generator for item 1; (c) the negative controls. Size: about 500 lines of test code and 60 of engine. Gate: the existing `npm test` unchanged with the hooks compiled in.

**3. Chunk cache for the Markdown-to-HTML/Vditor-DOM methods (B.5), eligible documents only.** Serves the SV preview (`Md2HTML` after `preview.delay`), `setValue`, mode switches and the whole-editor `Spin*` fallbacks, not the typing path. Expected 40-60x on one edit, 0.8-1 ms [measured prototype], zero on ineligible documents. Risk: medium; compatibility risk none while opt-in. Size: 400-600 lines. Order inside: `MarkdownStr`/`Md2HTML` first, then `Md2VditorDOM`, `Md2VditorIRDOM`; environment keys for headings, then reference definitions; footnotes/ToC/IAL/front-matter stay on the whole path.

**4. One-entry memo per method (trivial, risk-free, narrow).** `VditorDOM2Md`, `VditorIRDOM2Md`, `Md2HTML`, `Md2Vditor*DOM`, `MarkdownStr`: store the last (input string, options fingerprint) -> output. Does **not** help the typing path (the string changes with every space). Helps a second identical call: a host calling `getValue()` from its `input` callback on the same tick, mode round-trips, `setValue(getValue())` [inference]. Verification: fingerprint test across every setter. Size: about 80 lines. Cheap enough to ship with item 2 regardless of the rest.

**5. Fuse the whole-tree walks (C.1).** About 8-10% on `MarkdownStr`/`Md2*`, local changes, part of plan 003's local items (L7 plus three more). Verification: `npm test` and the macro hashes.

**6. (Optional, later) `MarkdownChunks` extra API and worker-chunk rendering.** Only after 3, only for hosts that ask.

**What I would explicitly not build:**
- The lean second pipeline (C.2): unmeasured gain, large mirror obligation.
- A persistent tree patched in place (retains 21 MB per 212 KB document, and every post-pass would need an invalidation story); the text-keyed chunk cache needs no tree.
- A cache for per-keystroke `Spin*` (the edited block is always new text; 40-450 us is already below a frame). If it ever matters, a plain-text fast path is the tool, not a cache.
- A hand-written block-boundary detector (B.1 shows the parser's own state is both simpler and correct).
- Transparent (always-on) caching: the bundle has no such feature, hosts mutate engine options between calls, and the ID-emitting option sets cannot be cached.
- Further work on the SV renderer for Vditor's sake (Vditor never calls it); L1 stays valuable for other hosts.

## E. What I could not determine

- **Browser-side share of the pause tick** (serialisation, `cloneNode`, `diff_main`, `localStorage`, host callbacks): not measurable here; step 0.
- **How many hosts register `options.input`**, which decides whether the synchronous whole-document `getMarkdown` on space, heading-marker, `---` and indent keystrokes runs at all, and whether they also call `getValue()` inside it (host-dependent; the value of items 1 and 4).
- **Correctness of the DOM-to-Markdown per-child composition**: unresolved separator rules (tables, list followed by paragraph, IR) and sibling interactions in `adjustVditorDOM`; the numbers in B.4 are timings of an unvalidated composition.
- **The environment keys** (`defsSig`, heading IDs, `prevLastOut`) are designed but not prototyped; only their necessity (the breaks) is measured. The prototype handled neither, and only ran on a corpus without them.
- **Cold-start hooks** were not prototyped; the cold figure measured is for per-chunk calls, which the design avoids.
- **CRLF/CR normalisation inside the incremental layer** beyond the observation that the lexer normalises; version 1 sends `\r` input to the whole path.
- **A lean pipeline's real speed**: no reference engine available; 2-4x is a guess.
- **Worker parallelism**: Amdahl estimate only.
- All timings are from a busy machine; ratios and orders of magnitude are the usable part.

## Appendix: scratch scripts (session scratchpad `design004/`)

`m1.mjs` (sizes, whole-call timings), `chunk4.mjs` (concatenation test per document and mode), `t5.mjs`/`t6.mjs` (dependency probes), `proto.mjs` (the incremental prototype and edit equality), `dom2md.mjs`/`d2c.mjs` (per-child DOM-to-Markdown), `spin.mjs` (per-keystroke costs), `walks2.mjs` with `srccopy/` (counted `ast.Walk`), `ids.mjs` (determinism of generated IDs per method and option set), `elig.mjs` (fallback frequency), `vditor/` (the fetched Vditor sources, commit `4535ffb0`).

## Spike: per-child cache for VditorDOM2Md (2026-10-11)

Prototype, fuzzer and negative controls are in `ts/experiments/dom2md-cache/` (its README has every command). Nothing under `ts/src`, `ts/test`, the Go sources or `javascript/` was changed by the spike; the experiments directory is not in `tsconfig` and not picked up by `npm test`.

**Status: provisional.** Midway the owner reserved the machine, so the long runs were not done. "What was run" lists exactly what ran; "Still to run" gives the commands for the rest. Labels: **[fuzz]** observed in the differential fuzzer, **[code]** read from source, **[probe]** a one-off scratch probe, **[inference]**.

### Verdict (provisional)

1. **Build, with restrictions**: opt-in, per mode, WYSIWYG first. Composition is exact for the child kinds p, h1-h6, ul, ol, table, blockquote, hr and div[code-block | math-block | html-block | yaml-front-matter | toc-block], with the fallbacks and per-child facts below. 0 mismatches in about 14,500 comparisons on near-final code [fuzz]; the 50,000-per-mode confirmation is still to run.
2. **IR is weaker than WYSIWYG**: any IR document containing an indented code block falls back as a whole (an upstream quirk, below), which includes all three spec documents.
3. Rough warm one-edit cost: 11 ms against 142 ms (WYSIWYG, 666 KB of HTML, 704 children) and 20 ms against 205 ms (IR, 1.64 MB), fastest of 2 runs on a busy machine: about 10x, not the 4-8 ms projected in B.4, because the scan of the string is about half of the cached time.

### Composition rule

`result(doc) = strip_zwsp(trim(U_1 + ... + U_n) + LF)`, trim = strip space, tab and LF at both ends [code: `renderDocument`, `format_renderer.ts:1386`]. `U_i` is the untrimmed output of child i in its context. Without a hook it is obtained by calling the engine's inner method (`vditorDOM2Md`, which strips ZWSP neither on input nor on output) on `HR + child + tail` and slicing off the known head and tail. ZWSP must be stripped after the trim: an empty paragraph emits a ZWSP that shields the blank lines around it from the trim [fuzz: found with the protyle option set; minimal case `<p><em><br></em></p><blockquote></blockquote><h2>..</h2>`].

Separators between blocks, from a probe of 17 representative children (paragraph, paragraph with hard break, ATX and setext heading, ul, ol, task list, table, fenced code, indented code, blockquote, hr, html block, math block, `[toc]`, footnotes, link-ref-def) in all 289 ordered pairs, both modes; gap = whole output minus the two standalone outputs [probe, before the fuzzer existed; the script was scratch]:

| previous child -> next child | separator between the trimmed texts | code |
|---|---|---|
| any block -> any block (p, h, ul, ol, table, code, bq, hr, html, math, toc) | one blank line | paragraph `format_renderer.ts:1408` (Newline + LF); heading `:1855`; hr `:1993`; list `:1896` and blockquote `:1795` (2 LF after trimming the whole root writer); code block close marker `:1650` (Newline, then LF unless `isLastNode`); table `:1113` exit; html `renderHTML`; math `:1639` |
| footnotes-block -> anything | LF, 4 spaces, LF (IR, footnotes -> table: LF, 4 spaces, 2 LF) | text node `[^1]: ...` with 4-space continuation lines, `vditor_wysiwyg.ts:1111` |
| link-ref-defs-block -> anything | a single LF | text node, `vditor_wysiwyg.ts:1107` |
| IR only: anything -> table | two blank lines | the IR table output starts with its own newline; not traced into the renderer; harmless inside `U_table` |
| IR only: indented code -> anything | a single LF | not a separator: the IR indented-code div leaves `Context.Tip` on a paragraph and every later sibling is attached inside it (`vditor_ir.ts:212`) |
| end of document | trim, then exactly one LF | |

So the separator is not a function of the pair of kinds in five cases; the cache stores `U_i` with its own trailing whitespace, not separators.

What a child's output depends on beyond its own HTML [code, each confirmed by a negative control]:

| dependence | rule | where |
|---|---|---|
| last AST node | a block nested in a child (a code block inside a list item) writes one blank line less when the child is the last node of the AST (`isLastNode` climbs to the root's `LastChild`); later children that produce no node (empty heading, empty blockquote, dropped empty list) do not count. First seen as a mismatch on single-child documents from the Go spec tests | `renderer.ts:1151` |
| next sibling of a `<p>` containing `<br>` | the `<br>` becomes a ZWSP when the next DOM sibling is ul, ol or blockquote, after `removeEmptyNodes` removed the vanishing siblings (an empty `<ul>` does not count) | `vditor_wysiwyg.ts:1683`, `vditor_ir.ts:636` |
| adjacent lists | `mergeVditorDOMList0` merges list n+1 into list n when same tag and the second has exactly one attribute; runs after empty-node removal, so a dead child between two lists does not stop it | `vditor_wysiwyg.ts:875`; whole-document fallback |
| AST builder state | a child may leave `tree.Context.Tip` above the document, so the next sibling is attached inside it | IR `vditor_ir.ts:212` (code or math div without open marker = every IR indented code block), `:334` (setext heading with blank last child); fallback |
| HTML parser state | accepted children are balanced element trees with explicit end tags, so the parser state at the start of each child is the same. A `data-render` preview `<pre>` holds raw HTML: it is skipped to the first `</pre>`, then verified with the engine's own parser (`HR + child + <p>x</p>` must parse to exactly hr, the child element, a clean p) | `scan.ts`, `cleanParse` |
| first child | must start the body (all accepted kinds do); a leading style, script, meta, comment or text is consumed by `<head>` | `scan.ts` refuses them |

The other cross-sibling work in `adjustVditorDOM` (`removeWbr`, `mergeSameStrong`, `adjustVditorDOMCodeA`, `adjustMath` unlinking a following script, `adjustNoscriptImg`) acts on top-level inline, script or noscript nodes or inside one child [code]; those top-level kinds are fallbacks.

### Key

Per distinct child text (after the engine's own two global replacements, ZWSP then `<wbr>`, are applied to the whole document in the same order; a replacement that creates a new `<wbr>` makes the call fall back): an `Entry { alive, emits, unsafe, u[4] }` in a Map per options fingerprint. `u[v]` is the untrimmed output; `v` = (next alive sibling is ul/ol/blockquote, used only for a `<p>` that contains `<br>`) + 2 x (last AST node). The facts come from replaying the engine's exported pre-render steps on `HR + child + HR` once per distinct text. Options fingerprint: all primitive fields of `ParseOptions` and `RenderOptions`, array contents, map sizes (limitation: an in-place change of the emoji or terms map that keeps its size is not seen; production needs a version counter). Not in the key: position, neighbour text, caret.

### Fallback conditions and how often they fire

Whole-document fallback to the uncached call. Counts from `fuzz.ts --report=real` run before the last refactor (ZWSP/caret strip, inner method) [measured]: 19 repository files and about 1,500 snippets from `test/go/cases`; the four option sets gave identical counts.

| condition | real files of 19, WYSIWYG / IR | snippets of ~1,500, WYSIWYG / IR | necessary? |
|---|---|---|---|
| `link-ref-defs-block` child | 1 (`test/case1.md`) / 1 | 36 / 36 | yes: separator differs (probe); mismatch with the fallback removed (rerun of allow-other-div reduced to this child) |
| `footnotes-block` child | 0 / 0 | 10 / 10 | yes by the probe (separator); 5 / 0 mismatches in the weak control run |
| IR child that leaves `Tip` open (every IR indented code block) | n/a / 5 (`format-case0.md`, the three spec files and one more) | n/a / 42 | yes: 132 mismatches without the check |
| splitter refuses (top-level text, comment, unknown or foreign tag such as svg, iframe, textarea, form; unbalanced raw HTML; text inside a table row) | 1 (`002-upstream-bugs.md`; the forward renderer itself puts text inside `<tr>`) / 1 | ~100 / ~80 | mostly precautionary: the cut cannot be vouched for |
| opaque preview child failing the parser check | 0 / 0 | 12 / (included above) | yes: 20 / 17 mismatches without the check |
| adjacent lists (same tag, second with one attribute; dead children skipped) | 0 / 0 | not counted | yes: 232 / 241 mismatches without it |
| other div, top-level inline element, `<wbr data-v-..>` | 0 / 0 | few | precautionary (no clean attribution, see controls) |
| engine throws on a child, unexpected sandwich shape | 0 / 0 | 0 | defensive |

Fallback rate on real documents (before the final refactor): WYSIWYG 2 of 19 files (10%), IR 6 of 19 (32%). In the fuzz mix, which is deliberately nasty, about 80% of comparisons were answered by composition in the last runs.

### What was run

Fuzz documents: Markdown from 19 repository files and every string input of the Go case tables (1,528 documents), converted by the reference bundle (`Md2VditorDOM`, `Md2VditorIRDOM`), split into children (pool of about 3,700 children per mode and option set), plus the browser-shaped DOM strings of `v2m_test.json` (120 WYSIWYG, 13 IR). Five option sets (Vditor's own; Vditor with ToC, callout, auto space; protyle + kramdown IAL + spin; defaults; no previews + list style). Edits: replace, insert, delete, duplicate, swap; typing-like text edits (character, space at either end, `# `, newline, tab-newline, NBSP, U+3000, VT, FF, ZWSP, `<wbr>` caret at tag boundaries only, `<br>`); merge and split children; move a list next to a list; restyle tags and list attributes; empty blocks; transient top-level junk; targeted neighbourhoods (p with br before list, blockquote, empty list; list with code block before empty trailing blocks; lists around a dead list); a host option toggle (`SetProtyleWYSIWYG`) between calls. After every edit `cached(doc)` against `uncached(doc)` byte for byte (throw status and message too; generated node IDs normalised as the oracle tests do, needed only on the fallback path), plus an audit that the splitter agrees with `util.ParseHTML` on child count, tag and attribute count. Passes: warm (new cache per sequence of 8-28 edits), cold (new cache per comparison), shared (one cache for all unrelated documents of a set). Not in the corpus: DOM written by Vditor's JavaScript (KaTeX, mermaid, ECharts output, highlight spans).

Last runs on near-final code (0 mismatches, 0 splitter disagreements):

| run | comparisons | answered by composition | notes |
|---|---|---|---|
| seed 9, both modes | 4,995 + 4,995 | 3,969 + 3,623 | |
| seed 10, WYSIWYG | 3,000 | 2,425 | composed calls only: warm 85.2% hits, cold 0%, shared 85.4%; warm pass re-processed 15.7% of the bytes |
| seed 7, WYSIWYG, final code | 1,500 | 1,253 | warm 83.0%, shared 84.2% hits |

About 40,000 earlier comparisons on earlier rules found and fixed: the wrong "last" notion, unsafe raw-HTML previews, the IR Tip leak, vanishing siblings for the br rule, the ZWSP shield; they are not counted. IR was not run on the final code after the last refactor, and the 50,000-per-mode target is not reached.

Negative controls (about 4,000 requested, 3,990 done per mode; run on the build just before the last refactor; WYSIWYG / IR mismatches): constant blank line 1380 / 1445; trim every part and add a blank line 1380 / 1445; ignore the next-sibling bit 298 / 322; never use the last variant 158 / 136; last = last DOM child 77 / 46; raw neighbours 155 / 121; no adjacent-list fallback 232 / 241; no options fingerprint 37 / 44; no Tip-leak check 2 / 132; no parser check of previews 20 / 17. All fire. The mutants are made by `negative-control.ts` from a scratch copy; no wrong rule remains in `cached.ts`. The fallback-removal controls (`allow-*`) gave small counts (link-ref 2 / 1, footnotes 5 / 0, other div 5 / 1, top-level inline 6 / 8); in several of those runs the first printed reduced case was the same unrelated p/ul pair, so the attribution of the allow-* counts is unreliable and must be re-read when the controls are re-run. A later 1,500-comparison rerun of allow-other-div reduced to a link-ref-defs-block child.

### Cost [rough, busy machine, one smoke run]

`bench.ts --doc=article --runs=2`: article = the repository's prose documents repeated; every iteration edits a paragraph with text the cache never saw; fastest of 2 runs (the brief asks for 7+):

| | HTML / children | cached, warm, one edit | uncached | `util.ParseHTML` of the whole document alone |
|---|---|---|---|---|
| WYSIWYG | 666 KB / 704 | 11.4 ms | 141.7 ms | 33.2 ms |
| IR | 1.64 MB / 704 | 19.5 ms | 205.1 ms | 82.4 ms |

Breakdown of the fastest cached run (ms), WYSIWYG: prep (fingerprint, ZWSP and caret strip) 2.5, split 4.3, classify 0.3, key substring and lookup 1.5, miss (probe and variant fill) 0.2, assemble 2.6; IR: 3.4, 10.0, 0.5, 2.9, 0.2, 2.5. The cost is the scan of the string, not the edited child; a leaner scanner trusting Vditor's flat DOM is the lever. Cold call (every child a miss): 393 ms WYSIWYG, 532 ms IR against 142 / 205 ms uncached: a miss costs about 3 engine passes. Memory was not measured reliably (the two-run heap delta is noise): keys are flattened copies, the cache is bounded by entry count (200,000), not bytes, so a byte bound and a measurement are production requirements. Not measured: the 212 KB spec document (WYSIWYG composes, IR does not), 7+ runs.

### Hook a production version needs

What the prototype does by replaying engine internals becomes one hook in `vditorDOM2Md` / `vditorIRDOM2Md`: (a) run the pipeline per top-level child without the document trim and with the ZWSP strip deferred, giving the untrimmed `U_i` in a given context (no sandwich); (b) per-child flags from that run: survives `adjustVditorDOM`, produces an AST node, leaves `Context.Tip` open; (c) an `isLast` input; (d) an options version counter instead of the fingerprint; (e) the top-level split from the engine's HTML tokenizer or a verified cheap scan. With (a)-(c) a miss costs one engine pass and the sandwich, probe and clean-parse code disappears.

### Estimate of production work

About 250 lines for the cache and scanner (prototype: `cached.ts` about 420 and `scan.ts` about 330 lines including commentary), about 80 lines of inert hooks in `vditor_wysiwyg.ts`, `vditor_ir.ts`, `format_renderer.ts` plus the options counter, about 500 lines of tests (the fuzzer cut down to a fixed-seed test with the corpora, plus the cases above as unit tests), a public opt-in setter. The 1:1 rule is touched only by the hooks, which must be inert when off (`npm test` unchanged).

### Verified by the fuzzer versus inferred

Verified [fuzz]: the composition formula, the four variants, each rule in the dependence table (a control that removes one produces mismatches), splitter and parser agree on every composed document, option toggling, a cache shared across unrelated documents. Inferred: that the fallbacks marked precautionary are only that; that DOM produced by Vditor's JavaScript behaves like the corpus (it is not in it; svg and unknown tags fall back); that the IR table's extra newline is context-free (no mismatch seen); that the timing ratio holds on the spec document.

### Upstream observations (for `tasks/002`, not edited here)

IR renders an indented code block as `div[data-type=code-block]` without fence markers, and `genASTByVditorIRDOM` (`vditor_ir.ts:212`) turns it into a paragraph without restoring `Context.Tip`: every later sibling is nested in that paragraph and the round trip loses the fence and blank lines. Also `isLastNode` makes the rendering of a nested block depend on whether the top-level child is the last AST node (a code block followed by a paragraph inside the last list item loses its blank line).

### Still to run (commands in `ts/experiments/dom2md-cache/README.md`)

1. Full fuzz, 6 seeds per mode of `--cmp=10000` (estimate about 80-90 s each on a quiet machine, from about 130 comparisons per second): at least 60,000 comparisons per mode, all passes. Expected: 0 mismatches. Record composed versus fallback counts per pass.
2. `negative-control.ts`, two halves, about 3 minutes each; re-read the reduced case of every allow-* run.
3. `fuzz.ts --report=real` for both modes on the final code (about 10 s each).
4. `bench.ts --runs=9` for `--doc=article` and `--doc=spec`, quiet machine, about 2 minutes.

### Full runs by the coordinator (2026-10-11, late)

Run on commit `ea2ecc05` with the commands of the README, machine partly busy.

- **Fuzz, six seeds of 10,000 per mode:** WYSIWYG 59,940 comparisons, **41 mismatches** (seeds 1, 3, 4, 5: 4, 1, 14, 22; seeds 2 and 6: 0), all in the `cold` and `shared` passes, none in the `warm` pass; IR 59,940 comparisons, **4 mismatches** (seed 3). No disagreement between the splitter and `util.ParseHTML` in any run. About 80% of WYSIWYG comparisons and 72% of IR comparisons were answered by composition; the most frequent fallback is "adjacent lists (merge rule)", then the link-ref-defs block.
- **So the composition rules are not complete.** The reduced cases printed in the log involve: a first child whose text starts with a space or an ideographic space; a child starting with a vertical tab; lists moved next to other lists (`move-list`); and one case where the cached output dropped everything after a fenced block. Mismatches concentrated in the shared-cache pass point at a key that is too weak (a cached piece reused in a context where it renders differently). These must be reduced and fixed, or the affected child kinds moved to the fallback, before any production work. The log is in the session scratchpad (`spike-full.log`), not in the repo: rerun the seeds to reproduce.
- **Real documents:** WYSIWYG falls back on 2 of 19 files, IR on 6 of 19; unit-test snippets about 6% and 8%; 0 mismatches in that report.
- **Warm one-edit cost** (fastest of 9): 4.8 ms cached against 44.7 ms uncached, 7.9 ms against 82.1 ms, and 4.4 ms against 38.3 ms on the three bench documents; parsing the whole HTML with `util.ParseHTML` alone takes 12.6 to 29.5 ms, so the scanner, not the engine, bounds a production version.
- **Verdict stays provisional:** the gain (about 9x on one edit) is confirmed; correctness is not.

## Mismatch analysis and fix specification (2026-10-11)

Status: analysis plus a validated stop-gap; the generic design in (c)/(d) is a **design**, not built. Labels: **[ran]** I executed it in this session, **[code]** read from source, **[inference]**, **[design]** unvalidated. Nothing under `ts/src`, `ts/test`, `javascript/`, or the prototype's `scan.ts`, `cached.ts`, `corpus.ts`, `fuzz.ts` was changed. New files are all in `ts/experiments/dom2md-cache/repro/` (listed in (f)); scratch copies of the prototype used for the validation runs are in the session scratchpad, not in the repo.

### Summary

1. There is **one** root cause for every mismatch I could attribute (R1): the engine's list and blockquote renderers call `TrimSpace` on the **whole root writer**, so Unicode whitespace at the start of the document's output is removed whenever any top-level list or blockquote follows. The prototype models the document-level trim as `bytes.Trim(" \t\n")` of the concatenation only. The same behaviour also swallows a whole leading paragraph that consists only of Unicode whitespace.
2. R1 depends only on the document, not on the cache. "Cold/shared only" is chance (my rerun of seed 11 has warm-pass mismatches). No weakness of the key was found; the shared-cache hypothesis of the coordinator is **not supported**.
3. The general diagnosis is that the prototype re-derives the engine's inter-child data flow by hand. The generic fix (c) makes the engine record that flow (a log of root-writer operations per top-level child) and assemble from the log with its own code, so a behaviour like R1 cannot be missed: it is part of the log, not of a rule.
4. A **stop-gap** that makes the prototype correct for R1 (10 lines, hand-annotated by tag, exact code in (e) step 1) removes all mismatches in every run I did and does not change the fallback rate [ran].

### (a) Root causes as evidence

| id | explains | minimal reproduction | engine cause | why cold/shared only | fix |
|---|---|---|---|---|---|
| R1 | all 18 logged mismatches that have printed detail (WYSIWYG seeds 1, 3, 4, 5; IR seed 3); the other 27 of the 45 are attributed by class inference, see "How many are explained" | WYSIWYG, any option set, cold cache: `[<p data-block="0">U+3000 a</p>, <ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">x</li></ul>]`. Uncached `"a\n\n* x\n"`, cached `"U+3000 a\n\n* x\n"`. Variants in `repro/cases.ts`: VT/NBSP/FF/U+2028 start, blockquote or ol as the trimmer, any blocks in between, whitespace-only first paragraph (uncached output loses the whole paragraph: `"* x\n"`), IR (`\f[foo]` + list) | `renderList` exit (`ts/src/render/format_renderer.ts:1907`, `bytes.TrimSpace(r.Writer.Bytes())`) and `renderBlockquote` exit (`:1839`) run on the root writer (`r.Writer` is `NodeWriterStack[0]` for a top-level node) and then `setWriterFromOwn`. Go `TrimSpace` strips every `unicode.IsSpace` rune (VT, FF, U+0085, U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, and ASCII space, tab, LF, CR). The document trim `renderDocument` (`:1398`) only strips space, tab, LF, and the paragraph's own `TrimSpace(FirstChild.Tokens)` (`:1412`) runs on exit after the text was written, so it trims nothing | not explained by the cache. It is a function of the whole document: a stream of 8-28 edits keeps the offending first child for many consecutive steps, so mismatches come in streaks (consecutive step numbers in my reruns: 3, 5, 6, 7, 7 per streak). Which pass sees a streak is chance: in my rerun of seed 11 the **warm** pass had 6 mismatches (cold/shared 0), and of seeds 6, 9, 11 and IR 5, 6 the passes were cold, shared, warm, cold, cold. The log's "none in warm" is a small-sample coincidence (about 10 episodes in total) | do not model it: replay the engine's root-writer operations ((c), (e) step 1) |
| A | no mismatch; explains the 10 `splitDisagreements` I saw in WYSIWYG seed 8 of my rerun (I analysed the first; the others are the same document in consecutive steps) (the log of the coordinator says 0 because the corpus differs, see below) | `repro/cases.ts` case `A-fuzz-audit-raw-vs-stripped` | `fuzz.ts: auditSplit` runs the scanner and `util.ParseHTML` on the **raw** html (still containing the caret `<wbr>` and ZWSP), while the cache splits the html after both are stripped, exactly like the engine. A `data-render` preview containing a stray `</div>` closes the html-block `div` early, so the parser puts the `<wbr>` that follows at top level in the raw string only. `cached.convert` output was equal | n/a | fix the audit in `fuzz.ts` (f) |
| L | explains the "lost everything after a fenced block" hint | seed 4 shared mismatches | not a bug. `fuzz.ts:505` prints `JSON.stringify(got).slice(0, 300)`; the cached and wanted strings differ only by the leading `U+000B` (lengths 39 and 38) | n/a | print full strings and the first differing offset (f) |

How many are explained: the log has 41 + 4 = 45 mismatches, but only 18 are printed with outputs (the fuzzer prints at most 3 per configuration and pass, `fuzz.ts:545`). I checked the 18 by diffing the printed strings: every one differs only by Unicode whitespace removed at offset 0 [ran: `spike-analysis/parse.mjs`]. The other 27 are **not individually inspected**; the claim for them rests on class inference: in 5 reruns of the full fuzz in which mismatches occurred (28 mismatches in total: WYSIWYG seeds 6, 9, 11 and IR seeds 5, 6, each 10,000 comparisons) I classified every mismatch by "cached output with leading Go-whitespace removed equals the uncached output" and got 28 of 28 and an empty OTHER bucket [ran, patched scratch copy of `fuzz.ts`]. 18 of 45 are verified, 27 inferred; I found no unexplained mismatch.

The logged seeds do **not** reproduce. Reruns with the same `--seed`: WYSIWYG seeds 1, 2, 3, 4, 5 give 0 mismatches (the log: 4, 0, 1, 14, 22). A likely cause is that the corpus reads files of the repository that changed after the full run: my startup line reports a child pool of 3876 (log: 3868) and 297 lists (log: 294) for `wysiwyg/vditor`, so the random streams diverge. That the corpus changed is **observed**; that it is the only reason is a hypothesis. For a reproducible fuzzer see (f).

The prototype's other rules were not contradicted: in the 33,824-document sweeps below there is no mismatch outside R1.

Evidence runs [ran]:
- `repro/run.ts`: 10 R1 cases mismatch today as expected, 6 controls equal, 1 audit case reproduced.
- `repro/sweep.ts` (exhaustive ordered sequences of 2 children over 77 children, 3 children over a reduced alphabet incl. table, html block, math block, ol; modes WYSIWYG and IR; defaults, protyle and no-preview option sets): every mismatching document has a Go-whitespace-leading first emitted child followed (not necessarily adjacent) by a list or blockquote; "unexplained by leading-Unicode-whitespace strip: 0" in all runs; ASCII space, tab and CR as first character never mismatch. The first emitted child may follow empty paragraphs.
- `repro/root-writer-prefix.ts`: over the whole corpus (7,607 WYSIWYG and 7,612 IR renderings of the five option sets, about 34,000 top-level nodes per mode) the root writer is append-only for every top-level node type except NodeList and NodeBlockquote, which rewrite earlier bytes (sensitivity probe: leading U+3000 paragraph then each block kind: only list and blockquote). In the corpus alone the only violations are 5 IR cases where a blockquote follows an IR table, whose output begins with its own newline; that newline is eaten by the blockquote's trim (it is why "IR: anything -> table: two blank lines" is harmless). `LastOut` at entry of a top-level node always equalled the last byte of the root writer (an empty writer counted as LF); never stale in these nodes.

### (b) General diagnosis

I agree with the owner's reading. The prototype is an **external model** of the engine: a separator table, a hand-written document trim, a classifier of child kinds, and a key of selected context bits, each added after a mismatch showed an unmodelled behaviour (earlier: the wrong "last" notion, the br/next-sibling bit, the list merge, the `Tip` leak, the ZWSP shield; now R1). R1 shows the structure of the failure: the engine has a channel between top-level children that nobody wrote down (the root writer is read-modify-written by two renderers), and a model that lists channels is complete only as far as the listing is. The prototype's invariant, `result = trim(U_1 + ... + U_n)`, is a theorem about the engine only if there is no other channel; nothing in the prototype checks that, and the fuzzer can only sample it (the documents that expose R1 need a first child starting with one of about 20 rare characters (Go's set minus space, tab, LF; CR is normalised away by the HTML parser) followed by a list: the fuzzer builds that by accident, which is why 45 mismatches appeared only after 120,000 comparisons).

The cure is not more rules but changing what is cached: cache what the engine itself produced, together with the exact context it consumed, and let the engine's own code combine the pieces.

### (c) Generic design (recommended)

Name: **recorded root-writer log with declared-context keys**. Parts:

1. **Split.** Keep the scanner as an acceptor of a restricted grammar (the allow-list), plus an engine-produced **certificate per child** (below). The scanner may be wrong without the result being wrong, because a child is only used if the certificate holds.
2. **Per-child pipeline stages** (parse, adjust, tree, render) run **in a sandbox** that contains only the child's subtree and stubs for the declared context. Anything the stages need from outside the child is a field of the declared context `C`; there is no other path, so the output of a child is a function of `(html, C-fields-read)` by construction.
3. **Render pieces are logs** of what the child does to the root writer: `Append(bytes)`, `NewlineIfNotLF`, and `TrimSpaceAll` (in order). Not strings.
4. **Assembly is the engine's own replay**: replaying the logs of all pieces on a fresh root writer gives the document, followed by the engine's own `renderDocument` trim and the ZWSP strip. The uncached path is changed to use the same replay (inert: output byte-identical, tested), so cached and uncached share the assembling code; a cached piece is correct whenever its log is.
5. **Cache key** = child html + the values of those context fields that the piece's run actually **read** (recorded by the sandbox), plus an options version.

#### The state vector (enumerated from the code)

"in-before" = written while processing earlier children; "in-after" = depends on later children.

| # | Phase | State | Direction | Where read / written [code] | How the design handles it |
|---|---|---|---|---|---|
| S0 | string | ZWSP removal (`VditorDOM2Md`, `vditor_wysiwyg.ts:162`), caret removal and `"\t\n"`, `"    \n"` replacement (`vditorDOM2Md`, `:205`) | none | global string replacements; the patterns cannot straddle two children (a child ends with `>`, the next starts with `<`, the scanner refuses text between them), except that a replacement could create a new `<wbr>` (the prototype already falls back) | per child, same functions |
| S1 | parse | HTML parser state at the child boundary: insertion mode, stack of open elements, active formatting list, form and head pointers, template modes, tokenizer state | in-before | `html.Parse` via `util.ParseHTML` | **certificate**: parse `child` alone and require (i) exactly one top-level element covering the whole string, (ii) final state equals the initial in-body state. By determinism of the parser, equal state at both ends gives `parse(A+B) = parse(A) + parse(B)`. Needs one parser hook (H4). The prototype's `cleanParse` is a behavioural approximation of (ii) |
| S2 | adjust | `removeEmptyNodes` (`:700`): reads Prev/NextSibling only for root-level nodes with atom 0 (text, comment, unknown tag), which the scanner refuses; removes the child itself (empty list: aliveness) | in-before (none for accepted kinds); out: alive flag | | alive flag is a function of the child html: recorded by the engine in the piece |
| S3 | adjust | `mergeVditorDOMList0` (`:875`): merges `n.NextSibling` into `n` when same atom and one attribute | couples child N with N+1 | | **coupling unit**: run the engine's own pass on a skeleton of stubs (one stub per alive child with atom and attribute count) and read off which children merged; a merged run is one cache unit keyed by its concatenated html. A stub is read-only; a pass that reads any other field of a stub throws and the document falls back. [design] |
| S4 | adjust | all other passes of `adjustVditorDOM` (`:276-340`): `removeHighlightJSSpans`, `removeWbr` (walks all following siblings but only unlinks `wbr[data-v-*]` nodes, which are local), `adjustVditorDOMListTight0`, `adjustVditorDOMListList` (a root-level list has the root as parent: no effect), `adjustVditorDOMListItemInP`, `removeCodeCode`, `adjustVditorDOMCodeA` (reads Prev/NextSibling of root-level `code`, which the scanner refuses), `adjustTag`, `mergeSameStrong` (merges children of each root child, not root children), `adjustTableCode`, `adjustMath` (unlinks a following `script` for `data-formula` nodes, the scanner refuses `script`), `adjustNoscriptImg` (`noscript` refused), `adjustBlockInTable` | none for accepted kinds | | local by the allow-list; the sandbox's read barrier makes a violation loud |
| S5 | tree | `tree.Context.Tip` | in-before and out | genAST appends to `Tip`; only `Tip` and `ParentTip` of `Context` are used (grep of `tree.Context!.` in both builders) | certificate: the engine reports "Tip is the root after this child" (prototype: `probe`). A piece that leaves `Tip` open is not cacheable (property-defined fallback) |
| S6 | tree | next alive DOM sibling: the br rule, `n.Parent.NextSibling` is ul, ol or blockquote (`:1684`; IR `:636`), after S2 removed vanishing siblings | in-after | | context field `next.atom` (the atom of the next alive sibling). Recorded when read; part of the key only for pieces that read it |
| S7 | tree | `isInline(n.PrevSibling)` for a root-level paragraph (`:1169`) | in-before | | context field `prev.isInline`; constant false for accepted kinds; recorded when read |
| S8 | post-walk | code-span merge and `ul.ul` fix-up (`vditorDOM2Md` `:236-260`) use siblings inside one parent | none at root | | local |
| S9 | render | **root writer content** `W`, read only by `TrimSpace(r.Writer)` at the exit of a top-level list (`format_renderer.ts:1907`) and blockquote (`:1839`), and by the document trim (`:1398`). Complete list of writer mutators (grep `Reset`, `Truncate`, `setWriterFromOwn`, `NodeWriterStack`): `renderFootnotesDef` (`:948-970`, appends), `renderDocument` (`:1389-1402`), `renderBlockquote` (`:1799-1841`), `renderList` (`:1900-1909`), `renderListItem` (`:1922-1992`, trims the list's writer, never the root); confirmed empirically (prefix check) | in-before | | **the log**: `TrimSpaceAll` is a logged operation. Since `TrimSpace(TrimSpace(A)+B) = TrimSpace(A+B)` the replay needs only the incremental state "head is known non-space" (property-tested, below) |
| S10 | render | `LastOut` at the start of the child | in-before | read only by `Newline()` (`renderer.ts:648`, 39 call sites in the format renderer) and by `renderText` `:1476` (list items with a task marker) | the sandbox starts with `LastOut = UNKNOWN`; `Newline()` on UNKNOWN logs `NewlineIfNotLF` (afterwards LastOut is LF either way); any other read of UNKNOWN marks the piece uncacheable. Replay tracks the real `LastOut`. Note `setWriterFromOwn` returns without setting `LastOut` when the trimmed buffer is empty (`renderer.ts:560`): the replay must copy that behaviour (it is part of the log semantics, not an assumption) |
| S11 | render | `isLastNode(root, node)` (`renderer.ts:1151`): the child's top-level node is `root.LastChild` | in-after | 13 call sites in the format renderer | context field `isLast`; sandbox adds a stub tree node after the child when false; recorded when read; the prototype's variants 2/3 |
| S12 | render | `node.Previous` / `node.Next` of the child's first / last top-level node: `newlineBeforeBlock` (`:2058`: Previous is non-block, not an IAL, not a task marker), `withoutKramdownBlockIAL` (`:2055`: Next is an IAL) | both | | context fields `prev.kind`, `next.isIAL`; recorded when read. For accepted kinds both are constant (blocks) [inference]; with kramdown IAL on, test (g) |
| S13 | all | engine options (`ParseOptions`, `RenderOptions`, the `Lute` fields read by the passes, `ProtyleWYSIWYG`) | static | | options version counter (prototype: fingerprint) |
| S14 | all | exceptions | out | the engine may throw on a child | not cacheable |

Only S1, S3, S5-S7, S9-S12 are channels. S9 and S10 are the channels that R1 shows were not modelled; with the log, both are first-class.

#### Invariant

> For every accepted child `x` and every context `C` that the replay constructs for it from the other children,
> `pieceLog(x, C-read-set(x))` equals the sequence of root-writer operations that the engine performs while rendering `x`'s nodes in the whole-document run, and `replay(log(x_1) ... log(x_n))` followed by the engine's final trim equals the whole-document output.

It holds if the engine satisfies **E1-E5**:
- E1 (parser): parsing is a deterministic function of (state, input); neutral children leave the state unchanged.
- E2 (DOM passes): the passes of S4 touch only the subtree of the node they are called on, except S3 and the br read S6. [code]
- E3 (tree): `Tip` is the only builder state shared between top-level children. [code]
- E4 (render): the root writer is only mutated by Append, `Newline` and `TrimSpaceAll` through the hook points; the renderer reads `LastOut`, `isLastNode`, `Previous`/`Next` of top-level nodes and nothing else of the neighbours.
- E5 (options): no other mutable global is read.

How a test detects a future engine change that breaks E2-E4 (this is the contract between engine and cache):
1. **Replay equality test** (new, in `ts/test/`): in a test-only mode of the engine, for every document of the existing test corpora (the e2e oracle documents, the Go case tables, the repository Markdown files, the fuzz pool), render the document normally and via `replay(log)`, assert byte equality, and assert for every top-level node that the root writer was only changed through logged operations (the prefix check of `repro/root-writer-prefix.ts` becomes an assertion inside the recording renderer: every write goes through the logging buffer, so an un-logged mutation makes `replay != actual`).
2. **Read barrier test**: the sandbox stubs throw on any access outside the declared context fields; run the whole corpus once with `strict` on and assert zero throws. A new cross-sibling read added to a pass fails this test even when no fuzz document exercises it.
3. **Parser certificate test**: for every accepted child of the corpus, `parse(child)` is neutral and equals the subtree parsed in context (compare serialisations).

#### Why the three fuzzer passes follow

A cache entry is a pure function of its key (html plus the read context values); the key contains everything the run read, and the lookup computes those fields from the actual neighbours. So a hit in the shared cache is a pure function value with the same inputs; a warm hit differs from a cold miss only in time. The three passes can therefore differ only in speed. A shared-cache mismatch would require an entry whose recorded reads are incomplete, which the sandbox makes impossible for reads through the DOM and tree links, and the strict test (2) checks. Note this is the property the **current** prototype does not have: its key (html plus 2 bits) is incomplete by hand-selection; R1 shows that incompleteness does not show up as a cache-state-dependent failure, but as a rule failure.

#### Alternatives evaluated

| option | correctness | cost | verdict |
|---|---|---|---|
| A. Split by the engine's HTML parser (one parse, engine hands out children) | removes scanner/parser disagreement and every "mismatched end tag" class by construction | the coordinator's numbers: `util.ParseHTML` of the whole document takes 12.6-29.5 ms against 38-82 ms for the whole uncached call, so the best case is roughly 2-3x, not 9x | keep the scanner as an acceptor and add the certificate S1 plus the strict test; offer the parser split as an opt-in "safe mode" if the owner values the guarantee more than the speed. Owner's choice |
| B. Cache the AST per child and run the engine's own renderer on the assembled tree | render-phase channels (S9-S12) vanish by construction | AST nodes must be cloned per use (the renderer mutates tokens); the saving is parse + adjust + gen, minus the clones. Not measured | not recommended first; revisit if cloning is cheaper than I expect |
| C. Op-log pieces + declared context + replay (this section) | S9/S10 by construction, the rest by sandbox + tests | one miss costs one engine pass in the sandbox, as the hook production version already planned; hits cost the replay (linear, mostly string appends) | **recommended** |
| D. Pure dependency tracking of every field read (instrumented DOM and AST) | most general | heavy instrumentation | C already contains the useful part (reads through the declared context) |

Fallbacks remain legitimate only as the following **properties**, each reported by the engine, never as shapes: the piece leaves `Tip` open (S5); the piece reads `LastOut` or any context field that the sandbox cannot supply (S10, S12 or barrier violation); the certificate fails (S1); the coupling pass touches more than the stub interface (S3); the engine throws (S14); an options version changed under a running call.

### (d) Engine hooks (design; do not edit `ts/src` as part of this analysis)

Goal: zero behaviour change and no measurable cost when off. Every hook is an overridable method or factory that does what the code does today; the recording behaviour lives in a subclass in a new file.

| id | file, function | change | inert because |
|---|---|---|---|
| H1 | `ts/src/render/format_renderer.ts`: `renderDocument`, `renderBlockquote`, `renderList`, `renderListItem`, `renderFootnotesDef` | replace `new bytes.Buffer()` by `r.newBuffer()` and `setWriterFromOwn(r, buf)` by `r.trimWriterTo(buf)`; add both methods to `FormatRenderer`, defaults `return new bytes.Buffer()` and `setWriterFromOwn(this, buf)`. 4 + 5 call sites | the defaults are the replaced statements; cost is one extra method call per container exit (count equals the number of containers), to be measured once in the batch of deferred measurements |
| H2 | `ts/src/render/format_renderer.ts` / `renderer.ts`: new class `RecordingFormatRenderer extends FormatRenderer` in a new file | overrides `newBuffer` (returns a buffer whose `Write`, `WriteByte`, `WriteString`, `Reset` log `Append`), `trimWriterTo` (logs `TrimSpaceAll` for the root writer instead of trimming, so the piece keeps its raw bytes), `Newline` (if `LastOut` is UNKNOWN logs `NewlineIfNotLF` and sets LF), `isLastNode` (reads the declared context, records the read). Piece boundaries: its `Render` loop walks top-level nodes one by one | not on the default path at all |
| H3 | `ts/src/vditor_wysiwyg.ts: vditorDOM2Md`, `ts/src/vditor_ir.ts: vditorIRDOM2Md` | split into `prepare(html) -> root`, `buildTree(root)`, `renderPieces(tree)` and the existing final part; `vditorDOM2Md` calls them in order and the **replay** for assembly (the final step is the replay of the logs recorded by the same code, with the hook off it is the plain renderer). Add `vditorDOM2MdPiece(childHtml, ctx)` returning `{ alive, tipOpen, log, reads }` | refactor with byte-equal output, guarded by the whole existing test suite (not run here) |
| H4 | `ts/src/html/`: parser | export `ParseFragmentState(html) -> { children, finalStateIsInitial }`, where the state compared is the one listed in S1 | pure addition |
| H5 | `ts/test/`: the three tests of "How a test detects a future engine change" | new tests | none |

### (e) Implementation steps for a weaker model

Step 1 (stop-gap, prototype only; validated [ran] in a scratch copy): in `cached.ts: convert`, replace the two lines
`const joined = parts.join(""); // NC: assemble` and `let result = trimBlank(joined) + "\n";` by

```ts
// replay of the root writer: Write appends; renderList and renderBlockquote exit do TrimSpace(whole root writer)
// before they write "\n\n" (format_renderer.ts:1907, :1839)
let W = "";
for (let i = 0; i < n; i++) {
  const u = parts[i];
  if (u === "") continue;
  const tag = ch[i].tag;
  if (tag === "ul" || tag === "ol" || tag === "blockquote") {
    let e = u.length;
    while (e > 0 && u.charCodeAt(e - 1) === 10) e--;     // the "\n\n" written after the trim
    W = goTrimSpace(W + u.substring(0, e)) + u.substring(e);
  } else {
    W += u;
  }
}
let result = trimBlank(W) + "\n";
```

with `goTrimSpace` stripping the Go `unicode.IsSpace` set at both ends (`\t \n \v \f \r`, space, U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000). This is hand-annotated by tag, i.e. it is the stop-gap the owner does not want as the answer; it is justified because the three trimming sites are enumerated from the renderer and the prefix check shows no other type rewrites earlier output. Result [ran, scratch copy]: WYSIWYG seeds 1-7 and 9-13 and IR seeds 5, 6 (seed 8 not rerun after the patch): 0 mismatches, composed counts unchanged (same fallback rate); `repro/sweep.ts` (copy using the patched module) 0 mismatching documents in 2-child WYSIWYG and IR, the other option sets, and 3-child WYSIWYG small alphabet; the 16 handwritten edge documents of `probe2` (whitespace-only list item, empty first paragraph, hr in between, ZWSP then whitespace) 0 mismatches in both modes. Incremental form (avoid a regex over the whole accumulated output at each list, which is quadratic): keep chunks and a flag `headClean` (first character known non-space); at a trimming piece, trim the head only if `!headClean`, trim the tail chunk-wise; `repro/replay-incremental.ts` property-tests this against the naive version on 200,000 random piece sequences [ran]: 0 differences. After this step flip the `R1-*` cases in `repro/cases.ts` to `expect: "equal"` and add `node experiments/dom2md-cache/repro/run.ts` as the first line of the fuzz command in `README.md`.

Step 2: fix `fuzz.ts: auditSplit` (f.1) and re-run the full fuzz on a frozen corpus (f.2).

Step 3 (generic design, after the owner's decision on option A in (c)): implement H1 and H3 behind the existing test suite; then H2 and the replay assembly; make the uncached path use the replay; port the cache to store `{ alive, tipOpen, log, reads }`; add H4 and the three tests. Order inside step 3: replay equality test first (it fails if H1/H3 are incomplete), then the cache.

### (f) Fuzzer changes

Blind spots shown by R1 (and what the sweep covers):
1. Rare characters in rare places. The roughly 20 characters that Go's `TrimSpace` strips but the prototype's trim does not are in `TEXT_INSERTS` for 5 of them, inserted at a random position of a random text run of a random child; the offending position (start of the first emitted child's first text) has probability about 1/(children x runs x length). Warm, cold and shared pass draw from the same distribution; only chance separates them.
2. `fuzz.ts` has no operation whose purpose is to change the **document's first output bytes** or the **last block kind**.
3. Mismatches are capped at 3 per configuration and pass and the log prints truncated strings, so 27 of 45 had no detail.
4. The audit runs on unstripped html (class A).
5. The corpus reads mutable repository files, so seeds do not reproduce.

Additions (apply to `fuzz.ts`; I did not edit it):
1. `auditSplit`: strip ZWSP and `<wbr>` first (`html.split(editor.Zwsp).join("")`, then `<wbr>`), exactly as `convert` does.
2. Freeze the corpus: print a hash of the loaded Markdown (and the child pool size) on the first line, and add `--corpus-snapshot=<file>` to save and load it; the full-run log must contain the hash.
3. New edit operations (each at ~3% of edits): `first-ws` (insert one of the 20 Go-space characters, or a string of two, at the start of the first text run of the first emitting child); `prepend-ws-paragraph` (insert `<p data-block="0">X</p>` at position 0, X = each Go-space character alone, or followed by text); `append-trimmer` (append or insert after position 0 a list or a blockquote, from the pool); `empty-first` (insert an empty paragraph, empty list, empty heading at position 0 before the whitespace paragraph).
4. A metamorphic extra comparison on 10% of the comparisons: re-run `cached.convert` on the same document with a fresh cache and on the document with a whitespace paragraph prepended, and assert both equal the uncached results. Cheap and independent of the edit generator.
5. Run `repro/run.ts` and a bounded `repro/sweep.ts --len=2` for both modes first (about 2 s each), abort the fuzz on a failure.
6. Report every mismatch (counted per episode: consecutive steps of one sequence), print the first differing offset with code points, the pass, and whether it reproduces with a cold cache (`reduce` already does the reduction; do not cap it at 3 per pass: cap per distinct (offset-class, cause)).
7. For the generic design: a mode that compares `replay(log)` with the uncached output for every document (E4), and a mode that runs the cache with the strict read barrier (E2).

Regression list: `repro/cases.ts` (run by `repro/run.ts`): 10 R1 cases (WYSIWYG 8 incl. the protyle and cache-primed variants, IR 2), 6 controls that must stay equal (whitespace paragraph alone, among paragraphs and headings, after the list, ASCII space first, whitespace in the second paragraph, IR alone), 1 audit case. Files added: `repro/cases.ts`, `repro/run.ts`, `repro/sweep.ts` (exhaustive small documents; `--mode`, `--config`, `--len`, `--small=1`, `--show`), `repro/root-writer-prefix.ts` (S9 evidence), `repro/replay-incremental.ts`. Commands, from `ts/`: `node experiments/dom2md-cache/repro/run.ts`; `node experiments/dom2md-cache/repro/sweep.ts --mode=ir --len=2`.

### (g) What remains uncertain; further suspects

Not determined or not run:
- The 27 unprinted mismatches of the log (class inference only). The log's seeds do not reproduce (corpus changed; cause unconfirmed).
- The generic design is unbuilt. I validated only: the single channel S9 (prefix check), the stop-gap replay, the incremental form, and that `LastOut` at entry is the last root byte on the corpus. Not validated: the hooks H1-H5, the sandbox read barrier, the skeleton run of `mergeVditorDOMList0`, the parser certificate hook, the assumption that a recording buffer sees every write (the prefix check wraps `RendererFuncs`, not buffers), the cost of the replay, and the "no measurable cost" claim for H1. I have not run `npm test`.
- Whether `RecordingFormatRenderer` can deliver the per-node `isLastNode` and `Previous`/`Next` reads without touching the base class (H2) - I read the code but did not write it.
- Option A numbers are the coordinator's, not remeasured.

Is more of the same family likely? Yes for anything that is an unmodelled channel; by the enumeration the remaining ones are few. I would test next (each is a few lines of `repro/sweep.ts` or a case):
1. **Other `TrimSpace`/`Trim` of the root writer** in kinds the cache does not compose today (`renderFootnotesDef`, link-ref-defs, which fall back): a future widening would hit S9 again.
2. **Kramdown IAL** (S12): protyle with `KramdownBlockIAL`, children that are an IAL only, or an IAL first node of the next child (`withoutKramdownBlockIAL`, `newlineBeforeBlock`). The protyle option set is in the fuzz mix but the generator does not produce IAL-only children.
3. **IR table**: its output starts with a newline, and anything trimming the root writer eats it; test table as first, second and last child with every trimmer, and a table directly after an empty paragraph.
4. **`LastOut` stale after an empty trimmed buffer** (S10): a child whose trimmed buffer is empty leaves `LastOut` as is (`setWriterFromOwn`, `renderer.ts:560`): a whitespace-only list item or blockquote as a child followed by a block that starts with `Newline()`.
5. **ZWSP shield** combined with R1: a ZWSP-only paragraph before a whitespace paragraph (emitted ZWSP is not Go-space, so it protects the trim target); the sweep covers a ZWSP-then-whitespace paragraph (equal after the stop-gap) but not longer chains.
6. **`isLastNode` with trailing dead siblings under kramdown IAL**, and **tight/loose list neighbours** (`adjustVditorDOMListTight0` reads the list only, but list item `data-node-id` duplicates use `ast.NewNodeID()`; random IDs reach output only through the default branch, per the fuzz note).
7. **Classification by `class` attribute**: `adjustMath` takes the math path for any accepted element whose class contains `tex` but not `text` (for example `class="latex"`) or `math`; the effects are attribute writes on the element itself (local), but `data-formula` followed by a `script` sibling unlinks the sibling: only safe because `script` is refused. Test accepted kinds with those classes.
8. **Characters the document trim and the paragraph trim treat differently**: besides the 20 Go-space characters, U+180E and U+200B (not Go-space) are the reverse case; the sweep covers only the Go-space set.
9. **Engine option state read by passes but not in the fingerprint** (maps changed in place): already known; unrelated to R1.

## Milestone A (2026-10-11)

Status: built and verified. `npm run typecheck` clean; `npm test` 3977 tests, 3969 pass, 0 fail, 8 skipped (the baseline 3971 / 3963 / 8 plus the 6 new tests); `npm run build` clean. The cache itself (milestone B) is not built; `cached.ts` and `repro/cases.ts` are unchanged. Labels as before: [ran], [code], [inference].

### What was built

- **A1, fuzzer hardening** (`ts/experiments/dom2md-cache/fuzz.ts`, `corpus.ts`). Item 1: `auditSplit` strips ZWSP and `<wbr>` first; split disagreements are 0 in both full runs. Item 2: the corpus is frozen with a printed sha256 and `--corpus-snapshot=<file>`; the snapshot used here has hash `437419118443f599d02654934d414e96598835072e36cc29309778ac078cf845` (1528 documents, 19 real files, 120 WYSIWYG and 13 IR hand-written DOMs). Item 3: four edit operations (`first-ws`, `prepend-ws-paragraph`, `append-trimmer`, `empty-first`) at about 3% each. Item 5: `precheck()` runs `repro/run.ts` and `repro/sweep.ts --len=2` for both modes before the fuzz (`--no-precheck` skips it). Item 6: every mismatch is one `MISMATCH` line with its cause, the first differing UTF-16 and UTF-8 offsets and the code points on each side; one reduced representative per (mode, cause, offset class). Not done: item 4 (the metamorphic comparison).
- **A2, H1** (`ts/src/render/format_renderer.ts`). `newBuffer()` and `trimWriterTo(buf)` are declared in the `FormatRenderer` interface merge and attached in the same file, with the default statements. Call sites, verified: `newBuffer` in `renderFootnotesDef` (:952), `renderDocument` (:1419), `renderBlockquote` (:1819), `renderList` (:1920), `renderListItem` (:1942); `trimWriterTo` in `renderBlockquote` (:1861), `renderList` (:1929), `renderListItem` (:2012) and the document close (:1412, inside the new `closeDocumentWriter`). This confirms the 4 + 5 of the design. Scratch buffers (`blockquoteLines`, `contentBuf`, `indentedLines`, `listItemBuf`) are not writers and are unchanged. `protyle_export_md_renderer.ts` has the same shapes; it is out of scope and untouched.
- **A3, H2** (`ts/src/render/recording_format_renderer.ts`, new; exported from `render/index.ts`, not from `Lute`). `RecordingFormatRenderer extends FormatRenderer` (the TextBundle precedent); factory `NewRecordingFormatRenderer` calls `registerFormatRendererFuncs`. `RenderWithLogs()` returns the normal output and `FormatLogs` (one `RootPiece` per top-level node: its ops and the LastOut at its end). `ReplayFormatLogs(logs)` returns the bytes; `ReplayFormatLogsTrace(logs)` also returns the LastOut after every piece. The header comment of the file holds the mutation inventory (below).
- **A4, H3 first half** (`ts/src/vditor_wysiwyg.ts`, `ts/src/vditor_ir.ts`). Stages as exported module functions, not `Lute` members: `vditorDOM2MdPrepare(lute, html): html.Node | null` (caret and `\t\n` / `    \n` replacements, parse, `adjustVditorDOM`), `vditorDOM2MdBuildTree(lute, root): parse.Tree` (genAST and the AST adjustment), `vditorDOM2MdRenderOptions()` and `vditorDOM2MdRender(lute, tree)`; the same four with the `vditorIRDOM2Md` prefix. The public methods call them in order; the output is byte-identical (the test suite is the proof). The ZWSP removal stays in the public wrappers `VditorDOM2Md` / `VditorIRDOM2Md`.
- **A5, H5 first test** (`ts/test/e2e/root/dom2md_replay.test.ts`, 6 tests, about 3 s). Inputs: the oracle's `Md2VditorDOM` / `Md2VditorIRDOM` on the Markdown corpus under the wysiwyg test's option sets and the IR option sets (`IR_SETS`); the hand-written DOMs (`RAW_DOMS`) under three and two sets; edited DOMs (`mutations`); the Markdown corpus and repository files through `FormatStr` under five option sets; three fixed cases. For each DOM: the public method's output equals the recorder's output and the replay's output, and LastOut after every top-level node agrees. Counts of the final run: WYSIWYG corpus 1689 comparisons, WYSIWYG hand-written and edited 660, IR corpus 1842, IR hand-written 316, FormatStr 1030; 0 failures. The corpora moved out of `root/vditor_wysiwyg.test.ts` into `test/e2e/dom_corpus.ts` (text unchanged; `export` added and the imports rewired), because a test file cannot be imported for its data.
- **A6, `--check=replay`** (`fuzz.ts`). For every generated document (the edit generator of the cache fuzz, no cache), the uncached output must equal the replay, and LastOut must agree after every top-level node. Full runs (`--cmp=5000 --seed=1 --corpus-snapshot=<scratch>/corpus.json`, precheck included): WYSIWYG 5000 comparisons, 0 mismatches (2 equal only after node-ID normalisation); IR 5000 comparisons, 0 mismatches (1 after normalisation). The normalisation is the one `fuzz.ts` already uses for generated node IDs.

### Root-writer mutation inventory (E4)

Full text and line numbers are in the header of `recording_format_renderer.ts`. In short, the root writer (`NodeWriterStack[0]`) is mutated by:

- **M1** creation in `renderDocument` entering (`newBuffer`).
- **M2** renderer-level writes while the root is the current writer: `BaseRenderer.Write`, `WriteString`, `WriteByte` (these set LastOut) and `Newline` (writes LF only when LastOut is not LF, then sets LastOut). Logged as `Append(setsLastOut=true)` and `NewlineIfNotLF`.
- **M3** container exits that write their buffer into the parent with `Buffer.Write`, without setting LastOut: `renderFootnotesDef` (:973), `renderBlockquote` (:1857), `renderList` (:1925), `renderListItem` (:2008). Logged as `Append(setsLastOut=false)`.
- **M4** direct buffer writes that do not set LastOut: `TextAutoSpacePrevious` / `Next` and the two `LinkTextAutoSpace` functions (`renderer.ts:677, 706, 735, 754`). Logged as `Append(setsLastOut=false)`.
- **M5** trims: `trimWriterTo(TrimSpace(root))` at the three container exits (this includes an orphan top-level `<li>`, see F1), and the document close (`closeDocumentWriter`, Trim with " \t\n", or TrimRight then TrimLeft). The container trims are logged as `TrimSpaceAll`, after a runtime check that the argument is `bytes.TrimSpace` of the root. The document close is not logged. `setWriterFromOwn` is the mutator under the trim: Reset (empty result, LastOut unchanged), Truncate, `copyWithin` of the view into the storage, and LastOut set to the last byte of a non-empty result.
- **M6** stack swaps (`r.Writer = newBuffer()`, push, pop, and the exit that sets `r.Writer` to the new top). They do not change the root's content.
- **M7** `Newline`'s dependence on LastOut (see M2).
- **M8** reads of root content: only the trims and the final output (grep of `r.Writer.Bytes`, `Len`, `String` in the format path).
- **M9** reads of LastOut outside `Newline`: the `renderText` task-list marker check (`format_renderer.ts:1496`). LastOut is also set by writes into node buffers, which are not in the root log (see F2).

Explicit `BaseRenderer.prototype.X.call(r)` writes in the format path: only `renderDefault` (node types without a renderer), which the recorder covers with its rendererWrites counter. `tabs.ts` `renderTabs` calls `r.*` methods only.

What the three operations cannot express: M3 and M4 (LastOut not set) are expressed by a flag on `Append`, not by a fourth operation. Node-level writes to LastOut (M9) are not in the log; they affect the replay only when a trim leaves the root empty, and the piece-end LastOut check (`ReplayFormatLogsTrace`) detects that. Nothing was found that the flag and the piece-end check cannot cover. The recorder throws when the root is reset or truncated outside a logged operation, so a new unlogged mutation fails the tests instead of passing silently.

### Negative control

With the `TrimSpaceAll` push removed from `RecordingFormatRenderer.trimWriterTo` (the trim still performed), `dom2md_replay.test.ts` fails in all six tests (exit 1). The fixed case "U+3000 paragraph before a list" fails with `replay gives "　 a\n\n* x\n", normal "a\n\n* x\n"`. The file was then restored from a byte-identical backup (checked with `cmp`), and the full run above passes with it.

### Deviations from the design

1. H2 said `trimWriterTo` logs instead of trimming, so the piece keeps raw bytes. The recorder performs the real trim and also logs it: its own output then equals the normal output, which gives a third comparand (recorder, replay, normal) and tells a bug in the recorder from one in the replay. Consequence: milestone A does not exercise piece independence.
2. Not built in A (milestone B needs them): the sandbox with LastOut UNKNOWN at the start of a piece (the recorder starts each piece with the real LastOut, so every Newline at the root is logged as NewlineIfNotLF and the replay decides it); the read barrier; the recording of `isLastNode`, `Previous` and `Next` reads (H2); `Tip` tracking (S5); the parser certificate (H4); the per-child stage functions (`buildTree` still loops over all children, so a piece-level DOM and AST run does not exist yet).
3. Piece boundaries come from one `ast.Walk` over the tree, not from a per-child `Render` loop (the advisor's advice; the `WalkStatus` values are those of `BaseRenderer.Render`).
4. `Append` carries `setsLastOut` (see the inventory). `ReplayFormatLogs` takes `FormatLogs`, which carry the render and parse options that the document close needs, not a bare list of pieces.
5. `closeDocumentWriter` (format_renderer.ts) is exported and shared by `renderDocument` and the replay. It calls `trimWriterTo` as renderDocument did; in the recorder that call has no open piece and is not logged.
6. The stage functions are exported module functions, neither `Lute` members nor private (the test has to call them). `src/index.ts` re-exports the vditor files with `export *`, so the names are distinct: `vditorDOM2MdPrepare` and `vditorIRDOM2MdPrepare`, and so on.
7. The FormatStr part normalises node IDs (generated per render from the clock and a counter), as the other e2e tests do. The replay and the recorder are compared exactly.
8. `render/index.ts` exports the recorder. It is not on `Lute` or the global object; the bundle test passes.

### Findings

- **F1, an orphan top-level list item trims the root.** `<li>orphan</li>` as a top-level node: `renderListItem`'s exit writes into the root (its parent is the root) and trims it. The log of that node is `Append(false)`, `TrimSpaceAll`, `Append(true)` (smoke test; the fixed case "orphan list item" passes). The design's S9 says list items "trim the list's writer, never the root". That holds for items inside a list, not for orphan top-level items. The orphan item is in `RAW_DOMS` and passes the replay test. S9 must be corrected before milestone B.
- **F2, LastOut is also set by node-level writes.** The design's S10 says the replay tracks LastOut from root operations. The renderer's LastOut is one global, and writes into node buffers set it too. The two differ only when a container's trim leaves the root empty and the container's last write was not LF. I could not construct that case from the corpora, and the piece-end check passed on every corpus. Milestone B's UNKNOWN-at-start rule must treat it as a fallback, or the piece log must carry LastOut at its end (`RootPiece.lastOut` already does, and the replay checks it).
- **F3, a root Newline depends on the previous piece.** With the real LastOut, every root Newline is logged as NewlineIfNotLF, so the replay needs the previous piece's end LastOut. That is a dependency between pieces that a cache must not have; milestone B has to start pieces with UNKNOWN, as the design says.
- **F4, the trim check never failed.** The check in `trimWriterTo` (the argument must equal `TrimSpace` of the root) did not fail in the replay test (about 4,500 comparisons), the fuzz replay (10,000) or the smoke documents. So every container trim of the root is a TrimSpaceAll.
- **F5, the replay reproduces R1 without a model of it.** The replay follows the engine's own trim (M5), so R1 is a property of the log and not a separate rule. The fixed U+3000 case passes in the replay with the uncached output as the reference.

### What milestone B needs

1. Piece-level stages: `buildTree` and the DOM passes per top-level child (the S2-S4 passes, with the coupling pass S3 run on skeletons), and a piece entry point `vditorDOM2MdPiece(childHtml, ctx)` returning `{ alive, tipOpen, log, reads }` (H3).
2. The sandbox of H2: LastOut UNKNOWN at the start of a piece. A non-Newline read of UNKNOWN makes the piece uncacheable; today the only such read is `format_renderer.ts:1496`. The context reads (`isLastNode`, `Previous` / `Next`) are recorded and declared (S11, S12).
3. `Tip` tracking for S5 and the parser certificate (H4, S1); both are still missing.
4. A piece-start rule for the root that does not depend on the previous piece (F2, F3).
5. The strict read-barrier run (test 2 of (c)) and the parser certificate test (test 3); only the replay test is built.
6. The orphan `<li>` (F1) added to the S9 inventory.

### Measurements not taken

- H1 adds one method call per container writer creation and per trim on the default path (5 `newBuffer` and 4 `trimWriterTo` call sites; the number of calls per render equals the number of containers and trims). Not measured, as instructed; for the coordinator's batch.
- The full `npm test` took 66.7 s in the final run (58.4 s after H1 alone, before the recorder and the tests). The replay test is about 3 s of that.

## Milestone B specification (2026-10-11)

Status: **specification only, plus scratch validation.** Nothing under `ts/src`, `ts/test`, `ts/experiments`, the Go sources or `javascript/` was changed. The sections above this one are unchanged. Labels: **[ran]** executed in this session (scratch scripts in the session scratchpad `cache-b-spec/`: `proto.ts`, `cert.ts`, `fp.ts`; not in the repo), **[code]** read from the source (file:line of commit `62496a1f`), **[assume]** not verified. A weaker model implements this from the text; every "must" is checked by a named test or command in section 9.

### 0. Decisions in one table

| topic | decision |
|---|---|
| Shape | A cache entry per distinct child HTML holds a **context-free `ChildInfo`** (alive, top-level atom, attribute count, AST top-level node types) and a list of **variants**. A variant is the root-writer log of the child (milestone A's `RootOp`s) plus the **declared context values it read**. The engine's own `closeDocumentWriter` and a replay of the logs assemble the document. |
| Split | The scanner (allow-listed grammar, section 4.4) cuts the string. Every child is certified by the **engine's HTML parser** (boundary-state certificate, section 4). A child that the scanner accepted and the parser refuses is an inconsistency, except children with a skipped `data-render` preview (unsupported by definition). |
| Sandbox | One child runs alone: parse, 15 DOM passes driven pass by pass, tree build, tree passes, recording render. Out-of-context reads are intercepted by accessors and proxies on the few objects that connect the child to its neighbours (section 3). |
| Cross-child coupling | `mergeVditorDOMList0` (greedy, pairwise) is decided at document level by running **the engine's own pass on a skeleton of stubs**; a merge makes the call a fallback (`list-coupling`). No other coupling needs a fallback. |
| `LastOut` | No UNKNOWN value. The replay supplies the real entry value; the sandbox records a read only when the child reads it before assigning it. A root `Newline` is logged as `NewlineIfNotLF` and does not read it. |
| Options | A fingerprint is computed on every call (about 20 microseconds [ran], section 5.5). No version counter. |
| API | ESM exports `EnableIncrementalDom2Md` etc. from `src/incremental/`; module state in a `WeakMap`; no new member on `Lute` or on the global object; the bundle test is untouched (section 7.3). |
| Verified | Core mechanism on 1,152 corpus documents and 23 synthetic ones (21 composed and equal, 2 correctly refused by the coupling check): 0 mismatches (section 8.0). Evidence for the mechanism, not fuzz-level assurance. Not verified: performance, the parser lemma beyond the corpus, IR under the DOM barrier, eviction, fuzz-level edits. |

### 1. Corrected state vector

#### 1.1 Corrections to the earlier design (S0-S14) and to milestone A

| id | earlier statement | corrected |
|---|---|---|
| C1 | S0: the string replacements are applied per child; a replacement that creates `<wbr>` makes the call fall back | The replacements are applied **once to the whole string, in the engine's order**, before the scan (ZWSP in the public wrapper `vditor_wysiwyg.ts:165` / `vditor_ir.ts:113`, then caret, `"\t\n"`, `"    \n"` in `vditorDOM2MdPrepare` `:211-215` / IR `:126-130`). The scanner scans the string the parser would receive, so no special case exists. The three replacements are factored into one function per mode (step 1). |
| C2 | S1: "final state equals the initial in-body state" | The state is **parser plus tokenizer**, compared as an enumerated projection (section 4.2). The comparison is made at the first `ErrorToken` (before the engine's EOF handling), and it also requires that the last token is the end tag of the top-level element (a comment that EOF closes would otherwise pass). `framesetOK` and `head` are deliberately excluded (the allow-listed grammar cannot read them). |
| C3 | S3: "a merged run is one cache unit" | Not needed. `mergeVditorDOMList0` (`vditor_wysiwyg.ts:906`) is greedy and pairwise: the root loop (`:321-323`) visits `A`, `A` absorbs `B` and unlinks it, the next visited node is `A.NextSibling = C`. Whether `C` merges with `D` does not depend on `A`/`B`. Only "does any merge happen" matters, and the answer is read off by running the engine's own pass on stubs (section 3.5). A merge makes the call a fallback; the property is "the pass unlinked a stub". |
| C4 | S2: alive flag in the piece | `alive` is **context-free** for the accepted kinds (`searchEmptyNodes` `:743` reads siblings only for `DataAtom == 0` nodes, which the grammar excludes at top level). It lives in `ChildInfo`, computed once per distinct HTML, and re-checked on every rerun (`info-changed` inconsistency). |
| C5 | S6: context field `next.atom` | Two DOM-sibling context fields, `domPrev` and `domNext`, plus **guards on `root.FirstChild` / `root.LastChild`** of the DOM root. The only semantic reads found are the `br` rule (`vditor_wysiwyg.ts:1715`, IR `:667`) and `mergeVditorDOMList0` (`:911`, covered by the skeleton). [ran] over 1,152 documents: `mergeVditorDOMList0:NextSibling` 961 reads, `genAST:NextSibling` 1 read, nothing else. |
| C6 | S9 and F1: list items trim the list's writer, never the root | Corrected by milestone A: an **orphan top-level `<li>`** trims the root (`renderListItem` exit, `format_renderer.ts:2008-2012`). The log already holds it (`TrimSpaceAll`). The scanner refuses `<li>` outside a list, so the case is `scan:implicit-end-tag`; the log is the second line of defence. |
| C7 | S10 and F2: sandbox starts with `LastOut = UNKNOWN`, any non-`Newline` read makes the piece uncacheable | **No UNKNOWN.** The replay passes the real entry `LastOut` (`ctx.lastOut`). The renderer's `LastOut` is an instance accessor in the sandbox: a read before the first assignment is recorded as a read of `ctx.lastOut`; later reads are piece-local. A root `Newline` is logged `NewlineIfNotLF` and sets `LastOut = LF` without a read. [ran] the reads of `ctx.lastOut` in 7,714 children: 2 (a `blockquote` nested in a `blockquote` calls `Newline` in the inner buffer before any write). F2 (a trim that empties the sandbox root while the real root is not empty gives a different `LastOut`) cannot matter: every root trim in the format renderer is followed by a root write in the same function (`renderBlockquote` `:1861-1866` `WriteString("\n\n")`, `renderList` `:1929-1934`, `renderListItem` `:2012-2016` `WriteString("\n")`), because `withoutKramdownBlockIAL` is always true (`vditorDOM2MdRenderOptions` leaves `KramdownBlockIAL` false). The replay adopts the piece's `endLastOut` after each piece; strict mode checks that the replay's own computation agrees. |
| C8 | S11: stub tree node when `isLast` is false | `isLastNode` (`renderer.ts:1151`) reads `node.Next`, `node.Parent.Type` and `treeRoot.LastChild`. The sandbox installs an accessor on **`tree.Root.LastChild`** (and `FirstChild`); no stub node is added to the tree. |
| C9 | S12: `prev.kind`, `next.isIAL` | Fields `prev` and `next` hold the **`ast.NodeType` of the neighbouring top-level AST node** (-1 if none). Reached by accessors on `tops[0].Previous` and `tops[last].Next`. [ran] reads: `prev` 1,148, `next` 162, in WYSIWYG. `withoutKramdownBlockIAL` never reads `Next` in this configuration (short circuit on the option). |
| C10 | (new) | **Iteration reads versus semantic reads.** `adjustVditorDOM` loops over the root's children (`:321-371`) and `removeEmptyNodes`, `removeHighlightJSSpans`, `removeWbr` scan siblings by design. A pointer-level barrier on `child.NextSibling` cannot tell an iteration read from a semantic one. So the sandbox does not call `adjustVditorDOM`: it drives the passes itself (section 3.2) and arms the barrier only in the passes where every read is semantic. A conformance test ties the driver to the engine's pass order. |
| C11 | (new) | Four channels that the earlier list missed: S15 generated node IDs, S16 module-level flags, S17 retained objects, S18 nested uncached engine calls (below). |

#### 1.2 The table

"Crosses" says whether information flows between top-level children. "Handling" is one of: **K** part of the key (a recorded read), **L** carried in the log, **F** a fallback category (defined by a property), **I** impossible, with the reason.

| # | state | written | read | crosses | handling |
|---|---|---|---|---|---|
| S0 | the input string | ZWSP removal: `VditorDOM2Md` `vditor_wysiwyg.ts:165`, IR `vditor_ir.ts:113`; caret `editor.FrontEndCaret` (IR: the literal `"<wbr>"`), `"\t\n"`, `"    \n"`: `vditorDOM2MdPrepare` `:211-215`, IR `:126-130`; output ZWSP removal `:167` / IR `:115` | the scanner, the parser | no (the patterns contain no `<` or `>`, the scanner refuses characters between children) | **I** after C1: the scan runs on the engine's post-replacement string; the output ZWSP strip runs on the assembled result after the document trim, as the engine does (an empty paragraph emits a ZWSP that shields the trim, see the spike) |
| S1a | HTML tokenizer state: `rawTag`, `err`, `raw`, `buf`, `textIsRaw`, `convertNUL`, `allowCDATA`, `pendingAttr`, `attr` (`html/token.ts:188-223`) | `Tokenizer.Next` (`token.ts:1072`) | every `Next` | between tokens only `rawTag` (raw text and RCDATA elements) and `err` persist; `allowCDATA` is set by the parser before each token from `top().Namespace` (`parse.ts:863`); the rest is reset at each `Next` (`:1072-1080`, `:1096`) | **certificate**: `rawTag === ""`, `err` is EOF, the last token ends at the end of the string and is the end tag of the top-level element. Grammar: no `script style textarea title xmp iframe noembed noframes noscript plaintext`, no foreign content (so `allowCDATA` stays false). |
| S1b | HTML parser state: `oe`, `afe`, `head`, `form`, `framesetOK`, `templateStack`, `im`, `originalIM`, `fosterParenting`, `quirks`, `fragment`, `context`, `scripting`, `hasSelfClosingToken`, `tok`, `doc` (`parse.ts:118-174`) | `parseCurrentToken` and the insertion modes | the insertion modes | yes: state at the end of child k is the state at the start of child k+1 | **certificate** (section 4): the projection E of the state at the boundary equals E of the reference state after `<hr>`. Fields excluded from E and why: section 4.2. |
| S2 | which top-level children survive `removeEmptyNodes` | `searchEmptyNodes` `:743` pushes the child to `emptyNodes` (class `katex`: `:850`; empty `ul`/`ol`: `:860-877`) | the same function; later passes see the survivors | the survivors define the "next/previous alive sibling" seen by S3 and S6 | **L/K**: `ChildInfo.alive` (context-free, section 2). A dead child contributes nothing and is skipped when neighbours are computed. |
| S3 | list merging | `mergeVditorDOMList0` `:906-926`: reads `n.NextSibling` (atom equal, `Attr.length === 1`), moves its children into `n`, unlinks it | the same | yes, couples child and next alive sibling | **F** `list-coupling`: decided by the engine's own pass on a skeleton of stubs, one per alive child (section 3.5). In the sandbox the pass runs with its `NextSibling` read answered from the context but **not recorded** ("covered"): the answer cannot change the result, because a merge makes the call a fallback, and a stub touched beyond `DataAtom`/`Attr` throws. |
| S4 | the other DOM passes (`:317-371`): `removeHighlightJSSpans`, `removeWbr`, `adjustVditorDOMListTight0`, `adjustVditorDOMListList`, `adjustVditorDOMListItemInP`, `removeCodeCode`, `adjustVditorDOMCodeA`, `adjustTag`, `mergeSameStrong`, `adjustTableCode`, `adjustMath`, `adjustNoscriptImg`, `adjustBlockInTable` | in the child's subtree; `adjustMath` unlinks a following `script` of a `data-formula` node (`:518`); `adjustVditorDOMCodeA` and `searchEmptyNodes` (span) insert siblings of top-level nodes | siblings of top-level nodes only in: `adjustMath :518` (a following script; the grammar has no top-level script), `adjustVditorDOMCodeA :1026-1048` (top-level `code`), `searchEmptyNodes :747-749` and span `:795` (top-level text, comment, span), `adjustVditorDOMListItemInP :953` and `adjustVditorDOMListList :683` (top-level `li`) | not for the accepted top-level kinds (p, h1-h6, ul, ol, table, blockquote, hr, div) | **barrier**: the DOM accessors are armed in every pass except the three scanning passes. A read that happens answers from the context and is recorded (**K**), or throws if it needs more than `DataAtom`/`Attr`. Top-level kinds outside the list are refused by the scanner (`top-level-tag`). |
| S5 | `tree.Context.Tip` | `genASTByVditorDOM` (`:1233` etc., 164 assignments in the two files) and `ParentTip`; IR leaves it open for a `code-block`/`math-block` div without an open marker (`vditor_ir.ts:243`) | every `Tip.AppendChild` | yes: the next sibling would be attached inside | **F** `tip-open`: `tree.Context.Tip !== tree.Root` after the child's genAST. Context fields used by the builders: only `Tip` and `ParentTip` (grep of `tree.Context!.` in both files: `Tip` 164+2, `ParentTip` 20+1). Property-defined and cached in the entry. |
| S6 | next/previous alive DOM sibling and the DOM root's first/last child | n/a | `br` rule: `n.Parent.NextSibling` is ul, ol or blockquote (`:1715`; IR `:667`); `n.Parent.Parent.NextSibling` (`:1719`: for a top-level `p` this is `body.NextSibling`, null in both runs); `isInline(n.PrevSibling)` for text (`:1200`; IR `:301`; top-level text excluded) | yes | **K**: `domPrev`, `domNext` (atom of the nearest alive sibling, -1 if none); `root.FirstChild`/`LastChild` answer `child` or a barrier stub according to the same fields. |
| S7 | local DOM and AST passes | tree walk of `vditorDOM2MdBuildTree` (`:243-272`, IR `:157-182`): code-span merge, `ul.ul` fix | siblings inside one parent | no | **I**: `n.Next` of a code node and `n.Previous` of a list whose parent is a list are never top-level nodes. Extracted to `vditorDOM2MdAdjustTree(tree)` (step 1) so that the sandbox runs the engine's own code. |
| S8 | root writer content | M1-M5 of milestone A (writes, container exits, trims); orphan `li` (F1) | only the trims (`TrimSpaceAll`) and the final output (M8) | yes | **L**: the log. `Append(bytes, setsLastOut)`, `NewlineIfNotLF`, `TrimSpaceAll`. The unlogged-mutation guard of `RecordingRootBuffer` stays. |
| S9 | `LastOut` (one field of `BaseRenderer`) | `Write`, `WriteByte`, `WriteString`, `Newline` (`renderer.ts:612-652`), `setWriterFromOwn` (`:545-565`, only for a non-empty result) | `Newline` (39 call sites in the format renderer), `renderText :1494-1496` (`0x20 === r.LastOut`, task list marker) | yes: the next piece starts with the previous piece's value | **K** (`lastOut`, recorded on first read before assignment) and **L** (`endLastOut`: the constant the piece ends with, or `PASS` if it never assigned). See C7. |
| S10 | `isLastNode` | n/a | 13 call sites in `format_renderer.ts` (`:251, :271, :458 ...`) through `renderer.ts:1151` | yes, depends on later children | **K**: `isLast` (no top-level AST node after this piece), read through `tree.Root.LastChild`. |
| S11 | first node of the document | n/a | no format-renderer read found; guarded anyway | would | **K**: `isFirst` through `tree.Root.FirstChild`; [ran] never read in 7,714 children. |
| S12 | `Previous`/`Next` of the first/last top-level AST node | n/a | `newlineBeforeBlock :2080` (called at `:1368, :1818, :1878, :1919`: `Previous != null && !Previous.IsBlock() && Type != KramdownBlockIAL && Type != TaskListItemMarker`), `renderKramdownBlockIAL :635` (returns first: option off), `withoutKramdownBlockIAL :2075` (short circuit), `renderListItem :1944` (guard on the option), `renderText :1494` (`Previous == null`) | yes | **K**: `prev`, `next` (types). |
| S13 | engine options: every field of `lute.ParseOptions` and `lute.RenderOptions` (read by genAST, `new parse.Context(lute.ParseOptions)`, `adjustBlockInTable :383-385` (`HTMLNode2Tree`, `FormatNodeSync` with both option objects), `FormatRenderer` through `r.ParseOptions`); the render options of the DOM2Md formatter are constants (`vditorDOM2MdRenderOptions :279`) | setters, direct field assignment, in-place map changes | the whole path | between calls only | **K** (entry map is cleared when the fingerprint changes), section 5.5. No other `Lute` field is read (grep `lute\.` in the two files: the renderer-function maps are not used by this path). |
| S14 | exceptions | engine code | caller | n/a | **F** `engine-threw` (the normal path reproduces the throw). |
| S15 | generated node IDs | `ast.NewNodeID()` in `adjustVditorDOMListItemInP :954, :960`; clock and random | the output, if the ID reaches it | would freeze an ID | **F** `generated-id`: the sandbox runs with `ast.SetTesting(true)` (restored in `finally`), so every generated ID is the fixed `20060102150405-1a2b3c4`; a variant whose output contains that string is refused. |
| S16 | module-level mutable state: `ast.SetTesting`, lazily built tables (emoji maps, `Terms`) | setters | `NewNodeID`; option accessors | between calls | **K/I**: testing flag handled by S15; the lazy emoji maps are fingerprinted through their backing fields. |
| S17 | objects retained between calls | n/a | n/a | would be a channel | **I**: entries hold strings, numbers and `Uint8Array` copies only (`appendOp` copies with `p.slice()`, `recording_format_renderer.ts:229`); no DOM or AST node is retained. |
| S18 | nested uncached engine calls inside a child (`genASTByVditorDOM :1156`, IR `:262` call `lute.vditorDOM2Md` / `vditorIRDOM2Md` on footnote definitions) | n/a | n/a | no | **I**: the dispatch is in the public wrappers only; the inner methods are not dispatched. |
| S19 | the DOM root chain (`body`, `html`, document) seen by `parentIs`, `n.Parent.Parent` | n/a | `parentIs :2293`, `:1719` | no | **I**: the sandbox DOM root is `body` of the child parsed alone by the same `ParseHTML` logic, so the chain and the atoms are those of the whole-document parse; `body.NextSibling` is null in both. |

Not channels (checked, so that the next reader does not repeat it): `Context.ParentTip` beyond `Tip`; `NodeWriterStack` depth (the sandbox pushes the root writer by calling the engine's `renderDocument` entering, so `1 === NodeWriterStack.length` at `:1832` means what it means in the whole run); the document close (`closeDocumentWriter`, run once by the assembly); `tree.Name`.

### 2. The piece

All types live in `ts/src/incremental/piece.ts`. `RootOp` is the type of `render/recording_format_renderer.ts` (import it; do not copy it).

```ts
export type Mode = "wysiwyg" | "ir";
export const LASTOUT_PASS = -1;          // endLastOut: the piece never assigned LastOut

// The context a piece may read. Nothing else about the neighbours is reachable (section 3).
export interface Context {
  lastOut: number;       // LastOut of the renderer at entry, 0..255. The replay's value; 10 (LF) at the start of the document.
  prev: number;          // ast.NodeType of the last top-level AST node before this piece's first one, -1 if none.
  next: number;          // ast.NodeType of the first top-level AST node after this piece's last one, -1 if none.
  isFirst: boolean;      // no top-level AST node before this piece's first one.
  isLast: boolean;       // no top-level AST node after this piece's last one.
  domPrev: number;       // html atom (DataAtom) of the nearest ALIVE top-level DOM sibling before, -1 if none.
  domNext: number;       // same after.
  domNextAttrs: number;  // Attr.length of that sibling; used only to answer the covered mergeVditorDOMList0 read; never part of a key.
}
export type ReadKey = "lastOut" | "prev" | "next" | "isFirst" | "isLast" | "domPrev" | "domNext";

export interface Variant {
  readKeys: ReadKey[];                 // the context fields the run read, in order of first read, no duplicates
  readVals: Array<number | boolean>;   // the value of each at the time of the run (same index)
  ops: RootOp[];                       // root-writer log, adjacent operations coalesced (section 2.3)
  endLastOut: number;                  // 0..255, or LASTOUT_PASS
  bytes: number;                       // memory estimate
}

export interface ChildInfo {           // context-free: a function of (html, options) only
  alive: boolean;                      // survives removeEmptyNodes
  atom: number;                        // DataAtom of the top-level element after the DOM passes (== before pass 4, checked)
  attrs: number;                       // Attr.length of it right before mergeVditorDOMList0
  topTypes: number[];                  // Type of every top-level AST node the child produced, in order ([] if none)
}

export type RefusalKind = "unsupported" | "inconsistency";
export interface Refusal { kind: RefusalKind; reason: string }   // reason from the closed list of section 6

export interface Entry {
  html: string;                        // the key; a flat copy (section 5.4)
  opaque: boolean;                     // the string contains a skipped data-render preview (scanner flag)
  info: ChildInfo | null;              // null until the first run completes
  refusal: Refusal | null;             // set when the child cannot be a piece; the entry then has no variants
  variants: Variant[];                 // at most MAX_VARIANTS (8); the oldest is dropped when a ninth is added
  bytes: number;
  lastCall: number;                    // the call number that last touched the entry
}
```

#### 2.1 Match rule

A variant `v` matches a context `c` iff for every `i`, `c[v.readKeys[i]] === v.readVals[i]`. A variant with no reads matches every context. Because a run is deterministic in (html, options, the values it read), the decision tree argument holds: if the actual context agrees with `v` on every field `v` read, a run with the actual context would take the same path, read the same fields and produce the same log. A field that `v` did not read cannot have influenced the run.

#### 2.2 The start of a piece (`LastOut`)

- The sandbox renderer is created fresh for every run, with `LastOut` initialised to `ctx.lastOut` behind an accessor (section 3.4). There is no UNKNOWN value.
- `Newline()` while the root writer is the current writer (checked with `isRootWriter()` of the recorder): push `{kind: "NewlineIfNotLF"}`, assign `LastOut = 10`, write nothing, **do not read** `LastOut`. The replay decides at replay time. This is what makes the common piece independent of the previous piece (F3).
- `Newline()` while a container's buffer is current (a nested writer): the base method runs; it reads `LastOut`. If nothing assigned `LastOut` since entry, this read is recorded as `lastOut = ctx.lastOut`. If `Write`/`WriteByte`/`WriteString`/`setWriterFromOwn`/a root `Newline` assigned it earlier in the piece, the read is piece-local and not recorded.
- `renderText :1494-1496` (task marker, M9): the same rule; in practice `renderTaskListItemMarker` wrote before, so the value is piece-local.
- At the end of the run: `endLastOut = assigned ? value : LASTOUT_PASS`.
- First piece of a document: the replay starts with `LastOut = 10`, as `BaseRenderer.Render` does (`recording_format_renderer.ts:243`, `RenderWithLogs`).
- A piece in which a root trim empties the sandbox root while the real root is not empty (F2): not a divergence that can reach a `Newline`, see C7. Strict mode compares the replay's own `LastOut` with `endLastOut` after every piece (inconsistency `replay:lastout-diverged`); normal mode adopts `endLastOut`.

#### 2.3 Coalescing

After the run, merge adjacent `Append` ops with the same `setsLastOut` into one (`Uint8Array` concatenation). `Append(a, true)` then `Append(b, true)` and `Append(a+b, true)` set `LastOut` to the same last byte; the same holds for `false`. Never merge across a different flag, `NewlineIfNotLF` or `TrimSpaceAll`. Drop empty appends (the recorder already does).

### 3. The sandbox

File `ts/src/incremental/sandbox.ts` (+ `barrier.ts`). One call `runChild(lute, adapter, html, ctx, opts)` runs one child alone, from the string to the log. A [ran] prototype of the whole mechanism (render phase with accessors, DOM driver, replay) composed 1,152 corpus documents (WYSIWYG 581 of 600, IR 571 of 600, two option sets) with 0 mismatches and 21 synthetic documents with 0 mismatches; the code below is derived from it.

#### 3.1 Mode adapter

```ts
export interface ModeAdapter {
  mode: Mode;
  preprocess(html: string): string;                       // vditorDOM2MdPreprocess / vditorIRDOM2MdPreprocess (step 1)
  genAST(lute: Lute, child: html.Node, tree: parse.Tree): void;   // lute.genASTByVditorDOM / genASTByVditorIRDOM
  adjustTree(tree: parse.Tree): void;                     // vditorDOM2MdAdjustTree / vditorIRDOM2MdAdjustTree (step 1)
  renderOptions(): render.Options;                        // vditorDOM2MdRenderOptions / vditorIRDOM2MdRenderOptions
}
```

#### 3.2 The DOM phase: a pass driver instead of `adjustVditorDOM`

`adjustVditorDOM` (`vditor_wysiwyg.ts:307-372`) runs 15 passes in this order, each over all root children. The driver calls them in the same order, for a root that holds the one child:

| # | method | argument | barrier |
|---|---|---|---|
| 1 | `removeEmptyNodes` | `root` | off (scans siblings by design: `:735`) |
| 2 | `removeHighlightJSSpans` | `root` | off (`:711`) |
| 3 | `removeWbr` | `child` (the engine passes `root.FirstChild`, `:318`; it walks all following siblings by design, `:883`) | off |
| 4 | `mergeVditorDOMList0` | `child` | armed, **covered** (reads answered from the context, not recorded) |
| 5-15 | `adjustVditorDOMListTight0`, `adjustVditorDOMListList`, `adjustVditorDOMListItemInP`, `removeCodeCode`, `adjustVditorDOMCodeA`, `adjustTag`, `mergeSameStrong`, `adjustTableCode`, `adjustMath`, `adjustNoscriptImg`, `adjustBlockInTable` | `child` | armed |

Reasons: in passes 1-3 every read of `child.NextSibling` is loop iteration (`for (c = node; c; c = c.NextSibling)`), and the semantic reads of these passes are at atom-0 root nodes, which the grammar excludes. In passes 4-15 the loop is the driver's, so every read inside the pass function is semantic. A conformance test (section 8.3) records the order of first calls of the 15 methods during a real `adjustVditorDOM` and compares it to the driver's table; a reordered or added pass fails it.

Between the passes the driver checks, with the barrier disarmed: after pass 1, `root.FirstChild === null` means the child is dead: return `{info: {alive: false, atom, attrs: 0, topTypes: []}, variant: null}` (no variant, nothing else runs; the real engine's later passes would find nothing to do for this child). After pass 3 capture `atomAtMerge = child.DataAtom`, `attrs = child.Attr.length`. After pass 15, if `root.FirstChild !== child` or the backing `child.PrevSibling`/`NextSibling` is not null (a pass inserted or removed a top-level node) throw `Inconsistency("sibling-structure-changed")`. Capture `atomFinal = child.DataAtom`; if `atomFinal !== atomAtMerge` throw `Inconsistency("top-level-atom-changed")` (the model has one atom per child).

#### 3.3 DOM barrier (objects: `child`, `root`)

`root` is the `body` node returned by the certified parse (section 4.3); `child = root.FirstChild`. Install four accessors with `Object.defineProperty(obj, field, {configurable: true, enumerable: true, get, set})`, the setter writing a backing variable that starts with the current value:

```ts
const dom = { armed: false, covered: false };           // set by the driver around each pass
guard(child, "PrevSibling", (backing) => {
  if (!dom.armed || backing !== null) return backing;    // a node a pass really linked is returned as is (shape check will catch it)
  record("domPrev", ctx.domPrev);
  return ctx.domPrev < 0 ? null : domStub(ctx.domPrev, 0);
});
guard(child, "NextSibling", (backing) => {
  if (!dom.armed || backing !== null) return backing;
  if (!dom.covered) record("domNext", ctx.domNext);
  return ctx.domNext < 0 ? null : domStub(ctx.domNext, ctx.domNextAttrs);
});
guard(root, "FirstChild", (backing) => {
  if (!dom.armed) return backing;
  record("domPrev", ctx.domPrev);
  return ctx.domPrev < 0 ? backing : barrierStub("dom.root.FirstChild");
});
guard(root, "LastChild", (backing) => {
  if (!dom.armed) return backing;
  if (!dom.covered) record("domNext", ctx.domNext);
  return ctx.domNext < 0 ? backing : barrierStub("dom.root.LastChild");
});
```

`domStub(atom, attrs)` is a `Proxy` over a fresh `html.Node` whose `get` trap allows exactly `DataAtom` (returns `atom`), `Type` (returns `html.ElementNode`) and `Attr` (returns an array of `attrs` dummy attributes `{Namespace: "", Key: "k", Val: "v"}`), returns `undefined` for symbols, and throws `BarrierViolation("dom.next.<prop>")` for every other property; its `set` and `deleteProperty` traps throw. `barrierStub(site)` is a `Proxy` over `{}` whose every `get`/`set` throws `BarrierViolation(site + "." + prop)`; it exists so that `treeRoot.FirstChild === child` style identity tests work and anything else fails loudly.

After the DOM phase and before genAST: `dom.armed = true`, `dom.covered = false`; call `adapter.genAST(lute, child, tree)` once (not through `vditorDOM2MdBuildTree`, whose loop would read `child.NextSibling` as iteration); `dom.armed = false`. genAST has no iteration over the root's children (it is called for the child only), so every pointer read of the child's siblings in it is semantic. [ran] with these guards on 1,152 documents: no `BarrierViolation`, reads recorded only for `br` (domNext 1) and the covered merge read (961).

What is silently wrong without each guard:
- `child.NextSibling` in genAST missing: `<p>a<br>b</p>` followed by a list would be cached from a run that saw no next sibling (`br` stays `<br>`), and reused when a list follows (the engine writes a ZWSP instead). The negative control NC5 (section 8.5).
- `child.PrevSibling` missing: a future `isInline(n.PrevSibling)` on a top-level node would see `null` and answer "not inline", the in-context answer may be "inline".
- `root.FirstChild`/`LastChild` missing: `n.Parent.FirstChild === n` style tests (`:1338` shows the form for list items) answer true for every top-level child.
- covered merge read: if the guard were absent a future change that reads more of the next sibling (`.Data`, `.FirstChild`) would see `null` silently; with the stub it throws.

#### 3.4 Render phase

```
tree = new parse.Tree(); tree.Name = ""; tree.Root = new ast.Node(ast.NodeDocument)
tree.Context = new parse.Context(lute.ParseOptions); tree.Context.Tip = tree.Root
... genAST (3.3) ...
tipOpen = tree.Context.Tip !== tree.Root                     -> Refusal unsupported "tip-open" (after the info is computed)
adapter.adjustTree(tree)                                      // the engine's own Walk (step 1)
tops = []; for (c = tree.Root.FirstChild; c !== null; c = c.Next) tops.push(c)    // collect BEFORE arming
info = { alive: true, atom, attrs, topTypes: tops.map(n => n.Type) }
r = new SandboxRenderer(tree, adapter.renderOptions(), lute.ParseOptions) registered like NewRecordingFormatRenderer
```

`SandboxRenderer extends RecordingFormatRenderer` (the milestone A class, unchanged) and overrides only `Newline` as in 2.2 (for the nested case it calls `BaseRenderer.prototype.Newline.call(this)`, which reads `this.LastOut`, i.e. the accessor). `NewRecordingFormatRenderer` registers the function table with `registerFormatRendererFuncs(ret)`; do the same for the subclass (the function is exported from `format_renderer.ts`). Then:

```ts
let value = ctx.lastOut, assigned = false;
Object.defineProperty(r, "LastOut", { configurable: true, enumerable: true,
  get() { if (!assigned) record("lastOut", ctx.lastOut); return value; },
  set(v: number) { assigned = true; value = v; } });
if (tops.length > 0) {
  const first = tops[0], last = tops[tops.length - 1];
  guardAst(first, "Previous", () => { record("prev", ctx.prev); return ctx.prev < 0 ? null : astStub(ctx.prev); });
  guardAst(last,  "Next",     () => { record("next", ctx.next); return ctx.next < 0 ? null : astStub(ctx.next); });
  guardAst(tree.Root, "FirstChild", () => { record("isFirst", ctx.isFirst); return ctx.isFirst ? first : barrierStub("ast.root.FirstChild"); });
  guardAst(tree.Root, "LastChild",  () => { record("isLast",  ctx.isLast);  return ctx.isLast  ? last  : barrierStub("ast.root.LastChild"); });
}
const ops: RootOp[] = []; r.sink = ops; r.pieces = [];
r.Writer = new bytes.Buffer();
r.renderDocument(tree.Root, true);                 // the engine's own entering: newBuffer() creates the RecordingRootBuffer, pushes it
for (const t of tops) ast.Walk(t, (n, entering) => r.dispatch(n, entering));
r.sink = null;
// no renderDocument exit: the document close is the assembly's job
```

`astStub(type)` is a `Proxy` over `new ast.Node(type)`: `get` returns `type` for `Type`; for any other property that is a function on `ast.Node.prototype` it returns that function (called with `this` = the proxy, so a method such as `IsBlock()` reads `Type` through the trap and nothing else); anything else, and every `set`, throws `BarrierViolation("ast.neighbour.<prop>")`. `guardAst` is `guard` of 3.3 with the same semantics (a plain backing outside the render phase; here the accessor is installed after the walk of `adjustTree` and the collection of `tops`, so the build code never sees it).

`ast.Walk(t, ...)` does not read `t.Next` (`ast/walk.ts:34-55`: it iterates `n.FirstChild`/`c.Next` of descendants only), so walking each top-level node separately does not trigger the guards. The real walk of a whole document reads `Next` of top-level nodes as iteration; the sandbox's driver owns that iteration.

What is silently wrong without each guard:
- `tree.Root.LastChild` (isLast) missing: the sandbox root's last child is the piece's last node, so `isLastNode` is true for every piece; a code block nested in a list item writes one blank line less (`renderer.ts:1151`, spike table "last AST node"). NC1.
- `tops[0].Previous` missing: `Previous` is `null`, `newlineBeforeBlock :2080` never logs the root `Newline` that a preceding non-block node (a `link-ref-defs-block` text, a footnote text) requires. NC2.
- `tops[last].Next` missing: `Next` is `null`; harmless today (`withoutKramdownBlockIAL` short-circuits), wrong as soon as `KramdownBlockIAL` is on in the render options or a renderer reads `Next`.
- `LastOut` accessor missing: the nested `Newline` in `> > x` reads a constant instead of the real entry value; the log is wrong when the previous piece ended with a non-LF byte. Not reachable on any corpus ([ran] 0 of 7,714 entries had `lastOut != 10`), therefore tested by a unit test with an explicit context (section 8.2).

`Context.Tip` is not stubbed (the sandbox owns the tree; the check is `tipOpen`). `Tree.Root` children are guarded as above. The DOM sibling and AST neighbour objects are the only links from a child to its neighbours: DOM `child.PrevSibling/NextSibling`, `body.FirstChild/LastChild`; AST `tops[0].Previous`, `tops[last].Next`, `Document.FirstChild/LastChild`; renderer `LastOut`. Everything else a node can reach (`Parent` chain up to the document, descendants) is real and identical to the whole-document run.

#### 3.5 The skeleton for list coupling

Run once per call after all `ChildInfo` are known (`assemble.ts`):

```ts
function listCoupling(lute: Lute, infos: ChildInfo[]): boolean {
  const root = new html.Node(); root.Type = html.ElementNode; root.DataAtom = atom.Body; root.Data = "body";
  let count = 0;
  for (const info of infos) {
    if (!info.alive) continue;
    const n = new html.Node(); n.Type = html.ElementNode; n.DataAtom = info.atom;
    n.Attr = Array.from({ length: info.attrs }, () => ({ Namespace: "", Key: "k", Val: "v" }));
    root.AppendChild(n); count++;
  }
  for (let c = root.FirstChild; c !== null; c = c.NextSibling) lute.mergeVditorDOMList0(c);   // the loop of adjustVditorDOM :321-323
  let left = 0; for (let c = root.FirstChild; c !== null; c = c.NextSibling) left++;
  return left !== count;                                                                      // some stub was unlinked: a merge would happen
}
```

The stubs have no children, so the pass's inner loops do nothing; a merge shows as an unlinked stub. Dead children are not in the skeleton, which is exactly the engine's behaviour (`removeEmptyNodes` ran first). [ran] with a hand-written equivalent: `ul + ul[1 attr]` and `ul + empty ul + ul[1 attr]` were refused as `list-coupling`, `ul[3 attr] + ul[3 attr]` was composed and equal. Cost: n allocations per call (assume below 0.2 ms for 700 children, measure later).

#### 3.6 After the run

1. If `ast.SetTesting` was false before the run it was switched on only around it: the whole `runChild` body, from the first parse to the end of the render phase, is inside `const was = ast.GetTesting(); ast.SetTesting(true); try { ... } finally { ast.SetTesting(was); }`.
2. Coalesce (2.3). Scan the concatenated bytes of all `Append` ops for the ASCII string `20060102150405-1a2b3c4` (a byte search is enough): found means `Refusal{unsupported, "generated-id"}`.
3. `bytes` estimate: sum of `op.bytes.length` plus 64 per op.
4. A thrown `BarrierViolation` or `Inconsistency` is an inconsistency (section 6); any other exception is `Refusal{unsupported, "engine-threw"}` and the entry remembers it.

### 4. The parser certificate (H4)

File `ts/src/incremental/parser_certificate.ts`. It needs no change in `ts/src/html/`: `html.ParseWithOptions(buf, opt)` takes a `ParseOption = (p: parser) => void`, and `parser` and its fields are exported.

#### 4.1 The hook

```ts
export interface Boundary { im: unknown; oe: string[]; afe: number; form: boolean; templates: number; originalIM: unknown;
  foster: boolean; quirks: boolean; fragment: boolean; scripting: boolean; selfClosing: boolean; hasContext: boolean;
  rawTag: string; err: string; lastTokEnd: number; lastTokType: number; lastTokData: string; bufLen: number }

export function parseWithBoundary(htmlStr: string): { doc: html.Node; boundary: Boundary | null } {
  const buf = conv.BytesFromString(htmlStr);
  let boundary: Boundary | null = null; let lastEnd = -1, lastType = -1, lastData = "";
  const opt = (p: html.parser): void => {
    const orig = p.parseCurrentToken;
    p.parseCurrentToken = function (this: html.parser): void {           // instance override, this parser object is private to the call
      if (boundary === null) {
        if (this.tok.Type === html.ErrorToken) {
          const z = this.tokenizer!;
          boundary = { im: this.im, oe: this.oe.items.map(n => n.Namespace + "|" + n.DataAtom + "|" + n.Data), afe: this.afe.items.length,
            form: this.form !== null, templates: this.templateStack.items.length, originalIM: this.originalIM, foster: this.fosterParenting,
            quirks: this.quirks, fragment: this.fragment, scripting: this.scripting, selfClosing: this.hasSelfClosingToken,
            hasContext: this.context !== null, rawTag: z.rawTag, err: String(z.err), lastTokEnd: lastEnd, lastTokType: lastType,
            lastTokData: lastData, bufLen: buf.length };
        } else { lastEnd = this.tokenizer!.raw.end; lastType = this.tok.Type; lastData = this.tok.Data; }
      }
      orig.call(this);
    };
  };
  const [doc, err] = html.ParseWithOptions(buf, opt);
  if (err !== null) throw err;
  return { doc: doc!, boundary };
}
```

The first `ErrorToken` is the end of the input before the engine's EOF handling (`parse.ts:857-878`: `parse()` reads a token, then `parseCurrentToken`). `parseImpliedToken` also calls `parseCurrentToken`, but never with an `ErrorToken`. The hook is in new code; it is not a change to a ported file. The body is selected exactly as `util.ParseHTML` does (`util/html.ts:35-38`): `"html" !== doc.FirstChild.Data ? doc : doc.FirstChild.LastChild`; a test asserts that `bodyOf(parseWithBoundary(s).doc)` serialises like `util.ParseHTML(s)` on the corpus. [ran] the prototype of this hook: `cert.ts`.

#### 4.2 What is compared

The reference `REF` is **computed**, not written: `parseWithBoundary("<hr>").boundary`, once per process. [ran] it is: `im` = `inBodyIM`, `oe` = `["|22020|html", "|10244|body"]` (atoms of html and body), `afe` 0, `form` false, `templates` 0, `originalIM` null, `foster` false, `quirks` true, `fragment` false, `scripting` true, `selfClosing` false, `hasContext` false, `rawTag` "", `err` "Error: EOF".

A child is certified iff all of the following hold for `b = parseWithBoundary(child).boundary` and `body = bodyOf(doc)`:
1. `b !== null`, and for each field in `{im, afe, form, templates, originalIM, foster, quirks, fragment, scripting, selfClosing, hasContext, rawTag, err}`: `b[f] === REF[f]`, and `b.oe` joined equals `REF.oe` joined.
2. `b.lastTokEnd === b.bufLen` and the last token is the end tag of the top-level element (`lastTokType === html.EndTagToken && lastTokData === <the element's tag name>`) or, if the element is a void element (`hr`), a start-tag token (`lastTokType === html.StartTagToken`) whose element is that node. (Without this an unterminated comment, which the tokenizer closes at EOF, would pass 1.)
3. `body.FirstChild !== null`, it is an element, and `body.FirstChild.NextSibling === null` (no text, no comment, no second element).

The field table, with the readers (greps of `parse.ts`) and the reason for each decision:

| field | read by | decision |
|---|---|---|
| `im`, `oe`, `afe`, `templateStack`, `originalIM`, `fosterParenting` | all insertion modes | compared |
| `form` | `<form>` start (`:1417`), `<isindex>` (`:1580`), `</form>` (`:1769`), form in table (`:1977`) | compared (and the grammar has no `form`, `isindex`) |
| `quirks` | `<table>` start tag (`:1531`) | compared (true on both sides: no doctype in the grammar, `initialIM` sets it, `:933`) |
| `scripting`, `fragment`, `context` | `noscript` (`:1130`), fragment parsing | compared (constants of `Parse`) |
| `hasSelfClosingToken` | reset after each token (`:849-852`) | compared |
| `framesetOK` | `<frameset>` (`:1350`) and written by many tags (`:1077 ... :2330`) | **excluded**: read only by `<frameset>`, which the grammar excludes; REF has it false, a first child may leave it true |
| `head` | `resetInsertionMode` for html context (`:622`), `afterHeadIM` (`:1225`), set at `:992` | **excluded**: after the first child's implied tags it is non-null on both sides; read only in modes that body content never re-enters |
| `tokenizer.rawTag`, `err` | `Next` | compared via the boundary |
| `tokenizer.allowCDATA` | set from `top().Namespace` before each token (`:863`) | not needed: foreign content is excluded, so it is always false |
| `tok`, `doc` | overwritten per token; tree under construction | not state |

#### 4.3 Why "the child alone" equals "the child in context", and when it is established

Claim L: for every child `c` of the allow-listed grammar, if the parser's projected state before `c` is `E(REF)` then the subtree built for `c` and the projected state after `c` equal those of parsing `c` alone from the initial state.
- Tokenization: the tokenizer state between tokens is `rawTag` and `err` only (`token.ts:1072-1080`, `:1096`). With `rawTag === ""` and no tag that can set it (grammar), the token stream of `c` is the same whatever precedes it, and a token never straddles a child boundary because the certificate requires the last token to end exactly at the end of `c`.
- Tree construction: for the first start tag of `c` the initial parser reaches `inBodyIM` through `initialIM`, `beforeHTMLIM`, `beforeHeadIM`, `inHeadIM`, `afterHeadIM`, which create `html`, `head`, `body` and set `head`, `framesetOK`; the in-context parser is already there. The two states differ in `framesetOK` and `head` only, which the grammar cannot read. Every later token is processed from equal projected states (induction on tokens).
- Induction over the document: child 1 is parsed in context from the initial state, exactly like alone. Child k+1 starts at the state after child k, whose projection is `E(REF)` by the certificate of child k, so Claim L applies.

Established **once per distinct child string**, in the same parse as the first sandbox run (the DOM that `parseWithBoundary` returns is the sandbox's DOM; reruns of the same string parse again with `util.ParseHTML`, the certificate is not repeated). The result (certified, or the refusal) is stored in the entry. It is sound because of the argument above plus the grammar (4.4); the lemma is a statement about the port of `x/net/html`, checked by reading the readers of every state field (table above) and by the corpus test: [ran] 4,943 WYSIWYG children, 4,935 certified, **0** differences between the child alone and the same child's subtree in the whole-document parse (`cert.ts`, comparing `html.Render`); IR: 4,944 children, 4,936 certified, 0 differences. The 8 refusals in each mode are all `html-block` previews (`<pre data-render=...>` with raw HTML such as `<form`, `<style`, `<iframe`, an unclosed `<div`): `form` 3, `im` 3, `afe` 1, `oe` 1. Negative samples [ran]: `<p>x</p><p>y</p>`, `<p>x`, `<p><b>x</p>`, `<ul><li>a</li>`, `<p>x</p>text`, `<p>x</p></p>` are refused (`shape`, `oe`, `afe`, `oe`, `shape`, `shape`).

Strict mode adds a **sandwich parse** per newly certified child: `parseWithBoundary("<hr>" + c + "<p>x</p>")`: the serialisation of the second top-level node must equal that of `c` alone, the third must be `<p>x</p>`, and the final boundary must equal `REF`. This is the behavioural check of Claim L (a leaked formatting element would wrap the `x`). Inconsistency `strict:sandwich`.

#### 4.4 What the scanner's grammar must guarantee

The scanner (`ts/src/incremental/scanner.ts`, ported from `experiments/dom2md-cache/scan.ts`) accepts a string iff it is a concatenation of top-level element trees such that:
- G1 no character between or around top-level elements (not even white space), so token boundaries are child boundaries; no `<!`, `<?`, no stray `<` anywhere (comments and bogus comments are never produced);
- G2 every tag is in the allow-list `p h1-h6 ul ol li table thead tbody tfoot tr th td caption colgroup col blockquote pre code hr br img input wbr a strong em b i u s del strike mark sup sub span div kbd font details summary label small abbr ins cite q var samp figure figcaption center`; none of the tags that switch the tokenizer (`script style textarea title xmp iframe noembed noframes noscript plaintext select`), none that read `head`, `form`, `framesetOK` or the template stack (`html head body frameset frame form isindex template`), no foreign content (`svg math`), no upper-case tag names, no self-closing syntax on a non-void element;
- G3 no implicit end tags: end tags match the open stack exactly; no block start tag inside an open `p`; `li` only directly in `ul`/`ol`; no heading in a heading; no `a` in an `a`; table parts only where the content model puts them; no non-blank text directly in `table`, `thead`, `tbody`, `tfoot`, `tr` (foster parenting). So `oe` returns to `[html, body]` and `afe` is empty after every child (an end tag only ever closes the top of the stack, so the adoption agency never runs on a misnested tag);
- G4 the top-level tag is one of `p h1 h2 h3 h4 h5 h6 ul ol table blockquote hr div`; anything else is `top-level-tag` (these are the kinds the passes' top-level sibling reads, listed in S4, cannot reach);
- G5 a `pre` with `data-render="1"` or `"2"` is skipped up to the first `</pre>` and the child is flagged `opaque`; its inner raw HTML is not validated by the scanner; the certificate must then decide.

Property: if the scanner accepts, the string is balanced, token-aligned and free of tokenizer-switching tags, **assuming** the scanner's attribute and quote handling agrees with the tokenizer's. If it does not, the certificate (conditions 1-3) refuses the child; the only way a mis-cut passes is a mis-cut that is itself a balanced element tree ending on a token boundary, and then the token argument applies to that cut. A refusal of a non-opaque child is therefore an inconsistency, which the fuzzer's scanner audit (section 8.4) hunts.

### 5. Lookup and assembly

#### 5.1 One call (`ts/src/incremental/assemble.ts`)

`tryDom2Md(st, lute, adapter, htmlIn): string | null`. `htmlIn` is the input **after** the public wrapper's ZWSP removal. It returns what `lute.vditorDOM2Md(htmlIn)` (inner method) would return, or `null` meaning "not handled, run the normal path". The wrapper then strips ZWSP from the result as before.

```
 1  stats.calls++
 2  fp = fingerprint(lute)                 // 5.5; null => return fallback(unsupported, "options-not-fingerprintable")
 3  if fp !== st.fp: (if st.fp !== "" stats.optionClears++); st.maps.wysiwyg.clear(); st.maps.ir.clear(); st.bytes = 0; st.fp = fp
 4  h  = adapter.preprocess(htmlIn)         // the engine's caret and white-space replacements, one function (step 1)
 5  sp = scanTopLevel(h)                    // O(|h|), allocation-free except the children array
 6  if !sp.ok: return fallback(unsupported, sp.code === "no-children" ? "empty-document" : "scan:" + sp.code)
 7  call = ++st.callNo
 8  for i in 0..n-1:                        // lookup, O(|h|) in total for the hashing of the keys (5.3)
        s = h.substring(c_i.start, c_i.end); e = map.get(s)
        if e === undefined: e = newEntry(flat(s), c_i.opaque); map.set(e.html, e); st.bytes += e.bytes
        e.lastCall = call; entries[i] = e
 9  for i: if entries[i].info === null && entries[i].refusal === null: runAndStore(entries[i], PROVISIONAL_CONTEXT, certify = true)   // misses, in document order
10  for i: if entries[i].refusal !== null: return refuse(entries[i].refusal)        // first refusal in document order names the reason
11  infos = entries.map(e => e.info); if listCoupling(lute, infos): return fallback(unsupported, "list-coupling")
12  sweeps (O(n)):   forward:  prevT[i], domP[i]    from the last alive/emitting infos before i
                     backward: nextT[i], domN[i], domNA[i]   from the first alive/emitting infos after i
                     an info is "emitting" iff alive && topTypes.length > 0; prevT[i] = last topType of the nearest emitting info before i (-1 if none),
                     nextT[i] = topTypes[0] of the nearest emitting info after i; domP/domN = atom of the nearest ALIVE info before/after (-1 if none)
13  R = new FormatRenderer(new parse.Tree(), adapter.renderOptions(), lute.ParseOptions); R.LastOut = 10; R.Writer = new bytes.Buffer()
14  for i with infos[i].alive:
        ctx = { lastOut: R.LastOut, prev: prevT[i], next: nextT[i], isFirst: prevT[i] < 0, isLast: nextT[i] < 0, domPrev: domP[i], domNext: domN[i], domNextAttrs: domNA[i] }
        v = first variant of entries[i] that matches ctx (2.1)                    // hit: stats.hits++ (counted once per child per call)
        if v === undefined:                                                       // stats.misses++
            res = runChild(lute, adapter, entries[i].html, ctx, { certify: false })
            if res.refusal: store it in the entry, return refuse(...)
            if !sameInfo(res.info, entries[i].info): inconsistency "info-changed"
            v = res.variant; entries[i].variants.push(v) (drop the oldest beyond 8); entries[i].bytes += v.bytes; st.bytes += v.bytes
        replay v.ops on R:  Append(b, true) -> R.Write(b);  Append(b, false) -> R.Writer.Write(b);  NewlineIfNotLF -> R.Newline();  TrimSpaceAll -> R.trimWriterTo(bytes.TrimSpace(R.Writer.Bytes()))
        if v.endLastOut !== LASTOUT_PASS: if strict && R.LastOut !== v.endLastOut: inconsistency "replay:lastout-diverged"; R.LastOut = v.endLastOut
15  closeDocumentWriter(R)                  // the engine's own document close, exported from format_renderer.ts
16  out = conv.StringFromBytes(R.Writer.Bytes())
17  evict(st, call)                          // 5.4
18  if verify: ref = lute.vditorDOM2Md(htmlIn); if ref !== out: inconsistency "strict:output-differs" (strict: throw; else return ref and count)
19  stats.composed++; return out
```

`runAndStore(e, ctx, certify)`: calls `runChild`; sets `e.info`, `e.refusal`; pushes the variant if any; on a dead child sets `e.info = {alive: false, ...}` and no variant. For `certify` the first run uses `parseWithBoundary` (section 4) and applies the opaque rule of section 6. `PROVISIONAL_CONTEXT = {lastOut: 10, prev: -1, next: -1, isFirst: true, isLast: true, domPrev: -1, domNext: -1, domNextAttrs: 0}`: an isolated document. It is a guess; the first variant is used only if the actual context equals it. [ran] a miss of a child that reads the context is therefore up to two sandbox runs (the first run to learn `ChildInfo`, the second with the real context): 2,486 reruns for 5,666 first runs in the prototype, because 40 percent of the children read `isLast` or `prev`. An exact optimisation for a later step: compute `prev`/`next`/`isLast` for the first run from the already known `ChildInfo` of the neighbours when they exist.

`replay` uses the exact calls of `ReplayFormatLogsTrace` (`recording_format_renderer.ts:316-331`). `R.trimWriterTo` is the default (`setWriterFromOwn`). Replaying `TrimSpaceAll` reproduces R1 (the leading Unicode white space of the document) without any rule, as milestone A showed (F5).

Dead children are skipped in line 14 but take part in the skeleton only as absent (3.5). A child that is alive and emits no AST node (an unknown `div`) replays an empty log and is invisible to `prev`/`next`, as in the engine (where it has no node).

#### 5.2 Complexity

n = number of children, |h| = characters of the (preprocessed) string, B = bytes of output, m = misses, k = variants per entry (at most 8, typically 1-3).
- preprocess: three `ReplaceAll` scans, O(|h|) (the engine does the same).
- scan: O(|h|), one pass, [ran, spike] 4.3 ms for 666 KB WYSIWYG, 10.0 ms for 1.64 MB IR (the spike's scanner; this one adds a few comparisons).
- keys: `substring` O(1) (sliced strings), `Map.get` hashes the string: O(|child|) once per new substring object, O(|h|) in total [spike: 1.5-2.9 ms for the substring and lookup of 704 children].
- phase 9-11: O(m x engine pass for one child) plus the skeleton O(n).
- phase 12-14: O(n x k) matching, O(B) replay (appends into one growing buffer; each `TrimSpaceAll` is O(edges) except that a leading white-space prefix is shifted once per trim: the same cost as the engine's own).
- phase 15-16: O(B).
So an unchanged document costs O(|h| + B), no engine pass. One edited paragraph costs that plus one sandbox run (1-2 passes over that child). Spike numbers for the same shape [ran, spike, coordinator]: 4.8 ms cached against 44.7 ms uncached (WYSIWYG, 666 KB). **Not measured** for this design: the sandbox's own overhead (`defineProperty`, `Proxy`, 15 driven passes) and the cold call (every child a miss: expect between 1.5x and 3x the uncached time, the spike's cold call was 2.8x); to be measured in the deferred batch.

#### 5.3 What is hashed and compared

The key is the **whole child string** as a `Map<string, Entry>` key (one Map per mode). Exact string equality decides a hit; there is no rolling hash and no truncated digest, because a collision would produce silently wrong output and the owner's requirement is correctness by construction. The cost of V8 hashing the string is the 1.5-2.9 ms above for 600-700 KB. A cheaper lookup is only possible by trusting a hash, which this milestone does not do.

#### 5.4 Memory bound and eviction

- Accounting: `entry.bytes = 2 * html.length + 160 + sum(variant.bytes)`; `variant.bytes = sum(op.bytes.length + 64) + 96`; `st.bytes` is the sum over both maps.
- Flat key: `Map.set(s, e)` with `s = h.substring(a, b)` would keep the whole 600 KB parent string alive through V8's sliced string (>= 13 chars), once per entry. Make a flat copy when creating an entry: `const flat = (s: string): string => (s + "x").slice(0, -1)` is not guaranteed flat; use `Buffer.from(s, "utf16le").toString("utf16le")` (a real copy, O(|s|), only for new entries). A unit test checks the heap difference is not O(|h|) per entry (section 8.1).
- Limit: `maxBytes`, default 64 MiB, option `maxBytes`.
- Eviction at the end of each call (line 17 of 5.1): if `st.bytes > maxBytes`: walk the two maps in insertion order and delete every entry with `lastCall < call` until `st.bytes <= 0.75 * maxBytes`; entries touched by this call are never deleted. If the bound is still exceeded (the document alone is larger), clear both maps and count `evictions` once more; the next call starts cold. Insertion order approximates age because entries are never re-inserted; a hot old entry survives because `lastCall` protects it only for the current call, so it can be evicted and rebuilt (a cost, not a correctness issue).
- Variants: at most 8 per entry; the oldest is dropped when a ninth is added.

#### 5.5 Options: a fingerprint per call, not a version counter

`fingerprint(lute): string | null` walks `Object.keys(lute.ParseOptions)` and `Object.keys(lute.RenderOptions)` (own fields, so the lazily built emoji tables are covered through their backing fields `_AliasEmoji`, `_EmojiAlias`, which are `null` until assigned) and builds a string:
- boolean, number, string, `null`: `String(v)` (strings are length-prefixed to avoid ambiguity);
- `Map<string,string>`: size plus a 31-polynomial hash of all keys and values in iteration order, plus the total character count (this catches an in-place `PutTerms`/`PutEmojis` that keeps the size);
- array of primitives: joined with a length prefix;
- anything else (an object, a function, a Map with other value types): return `null`, and the call falls back as `options-not-fingerprintable` (a new option of an unforeseen type disables the feature instead of being ignored).
[ran, `fp.ts`] `ParseOptions` has 50 fields (46 boolean, 2 null, 1 string, 1 array), `RenderOptions` 42 (33 boolean, 7 string, 1 number, 1 `Map` of 116 `Terms`); the fingerprint of both costs 4.2 plus 15.1 microseconds. With the emoji maps assigned (about 2,100 entries) expect about 100 more. It runs on every call.
Why not a version counter bumped by the setters: there are 72 `Set*` methods in `lute.ts` plus `Put*`, but the fields are public (`lute.ParseOptions.X = ...`, `lute.RenderOptions.Terms.set(...)` are legal and change in place), so a counter bumped in setters is incomplete by construction. The fingerprint reads the state itself. Both option objects can also be replaced wholesale; reading them on every call covers that. A change clears **both** maps (the entries of the other mode are stale too).

### 6. Fallback categories and inconsistencies (closed list)

Counted in `IncrementalStats.unsupported` / `.inconsistencies` by the strings below. A call is counted under the first reason found in the order of the algorithm. "Unsupported": the input or configuration is legal but outside the feature; silent fallback for the caller, counted. "Inconsistency": a case that the design says cannot happen; **strict mode throws** `IncrementalInconsistency` (message = reason + detail), normal mode falls back and counts. Only the reason strings are keys; details go into the thrown message.

| reason | kind | defined by the property |
|---|---|---|
| `options-not-fingerprintable` | unsupported | an own field of `ParseOptions` or `RenderOptions` is not a primitive, `null`, an array of primitives or `Map<string,string>` |
| `empty-document` | unsupported | the scanner found no top-level element |
| `scan:top-level-text`, `scan:comment-or-doctype`, `scan:stray-lt`, `scan:tag-not-allowed`, `scan:top-level-tag`, `scan:upper-case-tag`, `scan:malformed-end-tag`, `scan:mismatched-end-tag`, `scan:unterminated`, `scan:self-closing-non-void`, `scan:implicit-end-tag`, `scan:table-structure`, `scan:unterminated-attribute`, `scan:unterminated-preview` | unsupported | the string is not in the grammar of 4.4 (G1-G5); the code names the first violated clause |
| `cert:opaque-preview` | unsupported | a child with `opaque = true` fails the parser certificate (4.3 conditions 1-3) |
| `tip-open` | unsupported | after `genAST` of the child, `tree.Context.Tip !== tree.Root` (S5) |
| `list-coupling` | unsupported | the engine's `mergeVditorDOMList0` unlinked a stub of the skeleton (S3) |
| `generated-id` | unsupported | a variant's output contains the fixed test ID produced under `SetTesting(true)` (S15) |
| `engine-threw` | unsupported | the sandbox run threw an exception that is not `BarrierViolation` or `Inconsistency`; the normal path reproduces the behaviour |
| `too-large` | unsupported | a single document's entries exceed `maxBytes` (eviction cleared the cache within the call) |
| `cert:scanner-accepted-certificate-refused` | inconsistency | a child with `opaque = false` fails the certificate |
| `barrier:<site>` | inconsistency | a stub or guard was touched beyond its declared fields (`ast.neighbour.<prop>`, `dom.next.<prop>`, `dom.root.FirstChild.<prop>`, `ast.root.LastChild.<prop>` ...) |
| `sibling-structure-changed` | inconsistency | after the DOM passes the root is not exactly the original child, or a pass other than `removeEmptyNodes` removed it |
| `top-level-atom-changed` | inconsistency | the child's `DataAtom` differs between the merge pass and genAST |
| `info-changed` | inconsistency | a rerun produced a `ChildInfo` different from the stored one (the info is context-free by design) |
| `replay:lastout-diverged` | inconsistency (checked in strict mode only) | the replay's own `LastOut` after a piece differs from the piece's `endLastOut` |
| `replay:unlogged-mutation` | inconsistency | the recorder's guard fired (a root mutation outside a logged operation) |
| `strict:sandwich` | inconsistency (strict only) | the sandwich parse of 4.3 disagrees |
| `strict:output-differs` | inconsistency (`verify` only) | the composed output differs from the normal path's output |

`engine-threw` and certificate refusals are remembered in the entry (`refusal`), so the same child does not rerun the sandbox on every call; the call still counts under the same reason every time. An inconsistency is never cached as a refusal in normal mode (it may be a transient bug in the fallback decision); in normal mode the entry is deleted and the call falls back.

### 7. Where the code lives and the API

#### 7.1 Files (all new, `ts/src/incremental/`)

Every file starts with the header `// New in the TypeScript port: no Go counterpart, not part of the 1:1 port (ts/PORTING.md, "Code without a Go counterpart"). Per-child cache for VditorDOM2Md / VditorIRDOM2Md: tasks/004-incremental-and-fast-paths.md, "Milestone B specification".` `PORTING.md` gets a new short section "Code without a Go counterpart" (step 15): `ts/src/incremental/` is opt-in, off by default, must not change behaviour or the public surface of the engine when off, may use `Proxy` and `Object.defineProperty`, is exempt from the 1:1 naming rules, and is tested by differential tests against the normal path instead of against Go; the 1:1 rules still apply to every ported file it calls.

| file | responsibility |
|---|---|
| `dispatch.ts` | The only file imported by `vditor_wysiwyg.ts` and `vditor_ir.ts`. `export const incrementalActive = { count: 0 }`, the `WeakMap<Lute, State>` registry, `tryIncrementalDom2Md(lute, mode, html): string \| null`, `registerIncrementalHandler(fn)`. No imports of other incremental files (no cycle). |
| `piece.ts` | the types of section 2, `LASTOUT_PASS`, `PROVISIONAL_CONTEXT`, the reason constants, `IncrementalInconsistency`, `BarrierViolation`. |
| `scanner.ts` | `scanTopLevel(html): ScanResult` (grammar 4.4). Pure. |
| `parser_certificate.ts` | `parseWithBoundary`, `REF`, `certify(child, doc, boundary): string \| null` (null = certified, else the failing condition), `sandwichCheck(child)`. |
| `barrier.ts` | `guard`, `guardAst`, `domStub`, `astStub`, `barrierStub`. |
| `sandbox.ts` | `SandboxRenderer`, the pass table, `runChild`, `listCoupling`, the mode adapters. |
| `options_fingerprint.ts` | `fingerprint(lute)`. |
| `cache.ts` | `State`, `newEntry`, `flat`, eviction, `Stats`. |
| `assemble.ts` | `tryDom2Md` (5.1). |
| `index.ts` | the public API (7.2); registers the handler into `dispatch.ts`; exported from `src/index.ts` with `export * from "./incremental/index.ts";`. |

Changes in ported files (behaviour-preserving, step 1 and 2): `vditor_wysiwyg.ts` and `vditor_ir.ts` get `vditorDOM2MdPreprocess`, `vditorDOM2MdAdjustTree` (and the IR twins) extracted from the stage functions, and the dispatch lines; each change carries `// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change`.

#### 7.2 API

```ts
export interface IncrementalOptions { strict?: boolean; verify?: boolean; maxBytes?: number }   // defaults false, false, 64 MiB
export function EnableIncrementalDom2Md(lute: Lute, options?: IncrementalOptions): void   // idempotent; re-enabling replaces the options and keeps the cache
export function DisableIncrementalDom2Md(lute: Lute): void                                 // drops the cache and the stats
export function IncrementalDom2MdStats(lute: Lute): IncrementalStats | null               // a copy; null if not enabled
export function ResetIncrementalDom2MdStats(lute: Lute): void
export class IncrementalInconsistency extends Error { reason: string }
export interface IncrementalStats {
  calls: number; composed: number; fallbacks: number;               // composed + fallbacks == calls
  unsupported: Record<string, number>; inconsistencies: Record<string, number>;   // reason -> number of calls
  children: number; hits: number; misses: number; sandboxRuns: number;
  bytesIn: number;                                                   // characters of h in composed calls
  entries: number; bytesHeld: number; evictions: number; optionClears: number;
}
```
Strict mode: inconsistencies throw instead of falling back; the sandwich check (4.3) runs. `verify`: line 18 of 5.1. The e2e tests and the fuzzer use `{strict: true, verify: true}` or `{strict: true}` (the fuzzer compares itself).

Dispatch (both public wrappers, the only edit of the default path besides the extractions):

```ts
Lute.prototype.VditorDOM2Md = function (this: Lute, htmlStr: string): string {
  const lute = this;
  let markdown = "";
  htmlStr = strings.ReplaceAll(htmlStr, editor.Zwsp, "");
  // PORT-NOTE: opt-in per-child cache (tasks/004, milestone B); one integer test when no engine has it enabled.
  if (0 !== incrementalActive.count) {
    const composed = tryIncrementalDom2Md(lute, "wysiwyg", htmlStr);
    if (null !== composed) {
      markdown = strings.ReplaceAll(composed, editor.Zwsp, "");
      return markdown;
    }
  }
  markdown = lute.vditorDOM2Md(htmlStr);
  markdown = strings.ReplaceAll(markdown, editor.Zwsp, "");
  return markdown;
};
```
`VditorIRDOM2Md` is the same with `"ir"` and `vditorIRDOM2Md`. The inner methods, `SpinVditorDOM` and all other callers are not dispatched. (Vditor's per-keystroke path is `SpinVditorDOM`; extending the cache to it is a later milestone.)

#### 7.3 Compatibility with the bundle test (recommendation)

`bundle.test.ts` compares the keys of the global `Lute`, its constants, the enumerable function-valued members of an engine, and about 300 call results. `bundle.ts` assigns `makeGlobal()` only, and `makeGlobal` returns a fixed list (`global.ts`). Recommended: **ESM exports only** (the functions above, plus module state in a `WeakMap`): no new key on the global object, no new member on `Lute`, no new field on the `Lute` class (a struct field would break "never add a field later"), so the bundle test passes unchanged and with the feature off the behaviour and the surface are identical. The cost of the default path is one property load and one integer compare per public call. The script bundle does not expose the feature in this milestone. If the owner wants it there later, the least visible way is a non-enumerable property on the global, `Object.defineProperty(globalThis.Lute, "Incremental", {value: {...}, enumerable: false})` added in `bundle.ts` after `makeGlobal()` (the test reads enumerable keys, `global.ts` already uses non-enumerability for the unexported methods), which still needs an explicit line in the bundle test's documentation; a member named with a lower-case first letter on `Lute.prototype` would be hidden automatically by `hideUnexported` (`global.ts`) but would be a method on the `Lute` class, which this milestone avoids.

#### 7.4 What stays in `ts/experiments/dom2md-cache/`

`fuzz.ts`, `corpus.ts`, `repro/`, `bench.ts`, `negative-control.ts`, `README.md`. They are retargeted (step 13) to the engine implementation: a new `engine-adapter.ts` implements the interface that `fuzz.ts` uses from `CachedDom2Md` (`convert`, `uncached`, `stats`, `lastFallbackReason`, `clear`, `size`) on top of two port engines built from the same setter list: engine A with `EnableIncrementalDom2Md(A, {strict: true})`, engine B untouched (`uncached`). Every option toggle of the fuzzer (`SetProtyleWYSIWYG`) is applied to both. `convert` calls `A.VditorDOM2Md`; `lastFallbackReason` is derived from the change of `IncrementalDom2MdStats(A)` between calls; `clear` is `DisableIncrementalDom2Md` + `EnableIncrementalDom2Md`. `cached.ts` and `scan.ts` of the experiment stay as the historical prototype (the fuzzer's `auditSplit` keeps using `scan.ts` or, better, `scanTopLevel` from `src`). `negative-control.ts` works on a scratch copy of `ts/src` (copied into `ts/experiments/dom2md-cache/.mut/<id>/src`, so that relative imports and the nearest `package.json` keep working), applies a one-line substitution to the statements marked `// NC:<id>` and runs the fuzzer against that copy; the marked statements are listed in 8.5. `.mut/` is git-ignored and deleted after each run.

### 8. Tests

#### 8.0 What was run for this specification [ran]

Scratch scripts (session scratchpad `cache-b-spec/`, not in the repo), run from `ts/` on Node 24, nothing from `npm test`:
- `proto.ts`: the render-phase sandbox with the accessors of 3.4, the DOM pass driver of 3.2/3.3 (`--barrier=1`), the variant matching of 2.1 and the replay of 5.1, over the Markdown corpus (12 repository files and the Go case tables, 300 documents per option set, the engine's own `Md2VditorDOM` / `Md2VditorIRDOM` as the producer; option sets: Vditor defaults and protyle + kramdown IAL + spin), split with the spike's `scan.ts` (which accepts any `div`, so link-ref-defs and footnotes blocks were composed, not refused). Result: WYSIWYG 581 documents composed (19 refused by the scanner: 18 `mismatched end tag`, 1 `top-level text`), **581 equal, 0 mismatches**; IR 571 composed, **571 equal**, 10 `tip-open`. With the DOM barrier on, the only semantic sibling reads were `mergeVditorDOMList0:NextSibling` (961 in WYSIWYG, 761 in IR) and `genAST:NextSibling` (1). Reads of context fields per run (WYSIWYG): `isLast` 2,933, `prev` 1,148, `next` 162, `lastOut` 2, `domNext` 1 (the `br` rule), `isFirst` 0; entry `LastOut != 10`: 0 times. 23 synthetic documents, 21 composed and equal and 2 refused by the coupling check (R1 with U+3000 and U+000B first paragraphs, whitespace-only paragraph, `p<br>` before a list, before an empty list, before a blockquote, list + list, list + empty list + list, empty paragraph + blockquote, `[toc]`, link-ref-defs before a paragraph and before a list, footnotes block, `pre/code`, hr + list, table + list): **0 mismatches**; `ul + ul[1 attribute]` and `ul + empty ul + ul[1 attribute]` refused by the coupling check.
- `cert.ts`: the certificate of section 4 over every scanner-cut child of the corpus (4,943 WYSIWYG, 4,944 IR): 4,935 / 4,936 certified, 0 differences against the whole-document parse, 8 refused (all opaque `html-block` previews), negative samples refused.
- `fp.ts`: the fingerprint cost (5.5).
Not run: `npm test`, `npm run typecheck` (the snippets of this section were executed under Node type stripping only, never type-checked under `strict` + `erasableSyntaxOnly`: expect type errors to fix while implementing), any fuzz, any benchmark, eviction, the strict mode, the sandwich, IR under the DOM barrier with a `br` child, anything on DOM written by Vditor's JavaScript.

#### 8.1 Files and budget (`npm test`, about 10 s extra; `test:full` removes the sampling)

| file | tests | cost |
|---|---|---|
| `ts/test/incremental/scanner.test.ts` | one accept case per allowed top-level tag; one refuse case per `scan:` code of section 6 (exact strings in the test); the audit: for every document of `markdownCorpus()`, `fileDocs()` and `RAW_DOMS` run through the oracle's `Md2VditorDOM` / `Md2VditorIRDOM`, the children of `scanTopLevel` have the tag, attribute count and `html.Render` serialisation of the top-level elements of `util.ParseHTML(h)` (ZWSP and caret stripped first). | 0.5 s |
| `ts/test/incremental/parser_certificate.test.ts` | section 8.3 | 1.5 s |
| `ts/test/incremental/barrier.test.ts` | section 8.2 | 0.5 s |
| `ts/test/incremental/adjust_passes.test.ts` | the pass-order conformance of 8.3 | 0.1 s |
| `ts/test/incremental/fingerprint.test.ts` | every primitive option changes the fingerprint; `PutTerms` that keeps the size changes it; an object-valued own field gives `null`; the fingerprint is stable across calls | 0.1 s |
| `ts/test/incremental/cache.test.ts` | flat key (heap: 2,000 entries cut from a 600 KB string retain less than 5 MB), eviction order, `maxBytes` clear, variant cap 8, stats arithmetic (`composed + fallbacks == calls`) | 0.3 s |
| `ts/test/e2e/root/dom2md_incremental.test.ts` | the differential test: for each mode and each option set of the sampled `SETS` (and `IR_SETS`), for every DOM of the corpora of `dom_corpus.ts` (oracle-produced from Markdown, `RAW_DOMS`, `mutations`): engine A (`EnableIncrementalDom2Md(A, {strict: true, verify: true})`) must return what engine B (same setters, feature off) returns, exceptions included (both throw or both return equal text); afterwards `IncrementalDom2MdStats(A)` has `inconsistencies` empty, every `unsupported` key in the closed list of section 6, `composed >= 0.7 * calls` for the plain-corpus group, and a second pass over the same documents has `misses === 0` for composed calls (warm hits). | 3 s |
| `ts/test/incremental/edits.test.ts` | the deterministic edit simulation (8.4, "in-test generator"): 300 comparisons per mode in the default run, 20,000 in `test:full` | 2 s |
| regressions inside the files above | the list of 8.6 | included |

If the new tests together exceed 12 s measured, reduce the sampling of the two big ones with `sample()` from `test/e2e/full.ts`; do not drop a test.

#### 8.2 The read-barrier test (H5 test 2)

`barrier.test.ts`, with the real sandbox (`runChild`), strict mode. Each case restores what it patched in `finally`.
1. **Declared reads are recorded.** `runChild` of `<blockquote data-block="0"><blockquote data-block="0"><p data-block="0">x</p></blockquote></blockquote>` with `ctx.lastOut = 10` and again with `0x78`: both variants list `lastOut` in `readKeys` with the value used, and their `ops` differ (the inner blockquote writes a line feed into its own buffer when `LastOut` is not LF). A `<p>` alone: `readKeys` does not contain `lastOut`.
2. **`isLast`**: `<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*"><div data-type="code-block" ...>...</div></li></ul>` (a code block in the last list item; use a document from the oracle) run with `isLast` true and false: `readKeys` contains `isLast` (or `next`) and the ops differ by one blank line.
3. **`prev`**: a `<blockquote>` with `ctx.prev = ast.NodeText` and with `ast.NodeParagraph`: the first variant's ops contain a `NewlineIfNotLF` before the first `Append`, the second's do not; `readKeys` contains `prev`.
4. **`domNext`**: `<p data-block="0">a<br>b</p>` with `domNext` = `atom.Ul` and `atom.P`: ops differ (a ZWSP replaces the `<br>`), `readKeys` contains `domNext`. A `<ul>` (covered merge read) with `domNext` any: `readKeys` does not contain `domNext`.
5. **Violations** (negative controls of the barrier; each patches one engine function with a read outside the declared context and expects `BarrierViolation` with the named site): (a) `FormatRenderer.prototype.renderParagraph` reads `node.Previous.Tokens` of a top-level paragraph, `ctx.prev >= 0`: `ast.neighbour.Tokens`; (b) `Lute.prototype.mergeSameStrong` reads `n.NextSibling.Data` of the top-level child, `ctx.domNext >= 0`: `dom.next.Data`; (c) `FormatRenderer.prototype.renderHeading` reads `node.Parent.FirstChild.Type` with `ctx.isFirst` false: `ast.root.FirstChild`; (d) the pass driver's `genAST` adapter wrapper reads `child.Parent.LastChild.DataAtom` with `ctx.domNext >= 0`: `dom.root.LastChild`; (e) `Lute.prototype.adjustTag` calls `n.Unlink()` on the top-level child with a neighbour present: `BarrierViolation` from the stub's `set` trap. In normal mode each of these makes the call fall back with `inconsistencies["barrier:<site>"] === 1` and the output equals the normal path's.
6. **Whole corpus under strict**: the differential test of 8.1 asserts `inconsistencies` is empty; a new cross-sibling read in an engine pass fails here even when no fuzz document exercises it, as soon as one corpus document has a neighbour.

#### 8.3 Parser certificate test (H5 test 3) and pass-order conformance

`parser_certificate.test.ts`: (1) `REF` has the fields listed in 4.2 (`im` is the `inBodyIM` function: compare against the `im` of a parse of `<p>x</p>`); (2) for every scanner-cut child of the corpora (as in 8.1): `certify` returns null, or the child is `opaque`; every non-opaque refusal is a failure (report the child); (3) for the certified ones `html.Render` of `body.FirstChild` of the child alone equals that of the corresponding top-level node of `util.ParseHTML(whole document)`; (4) negative samples are refused: `<p>x</p><p>y</p>` (condition 3), `<p>x` (1, `oe`), `<p><b>x</p>` (1, `afe`), `<ul><li>a</li>` (1), `<p>x</p>text` (3), `<p>x</p></p>` (3), and `<p>x</p><!-- c` (3; the scanner refuses it earlier as `scan:comment-or-doctype`); (5) the sandwich check of strict mode accepts every certified child of the corpus; (6) `bodyOf(parseWithBoundary(s).doc)` serialises like `util.ParseHTML(s)`.

`adjust_passes.test.ts`: create a throwaway `Lute`, wrap the 15 pass methods as own properties that record the name on first call and delegate to the prototype method, call `lute.adjustVditorDOM(util.ParseHTML(doc))` for a document with a list, a table with a list in a cell and a code block, and assert the recorded order equals the driver's table names (exported from `sandbox.ts` as `ADJUST_PASSES`). Also assert `adjustVditorDOM.toString()` contains each name once at top level is **not** used (too brittle); the behavioural check is enough.

#### 8.4 Differential fuzz: three passes, strict mode, scanner audit

The existing `experiments/dom2md-cache/fuzz.ts` is retargeted (step 13); it keeps its generator, its three passes and its reductions:
- **warm**: a new engine A per sequence of 8-28 edits; **cold**: a new engine A (or `DisableIncrementalDom2Md` + `Enable`) per comparison; **shared**: one engine A for all unrelated documents of a set. By the argument in the earlier "Why the three fuzzer passes follow", the three can differ only in speed; any difference in outcome is a bug in the recorded reads.
- New fourth pass **evict**: `maxBytes` = 256 KiB, so that eviction and the `too-large` path run constantly.
- Engine A is created with `{strict: true}`: an inconsistency throws `IncrementalInconsistency`, which the fuzzer reports as a mismatch of cause `INCONSISTENCY:<reason>` and reduces like any other. `verify` stays off (the fuzzer compares itself, with its node-ID normalisation).
- `auditSplit` calls `scanTopLevel` of `src` (after stripping, as now) and reports a disagreement with `util.ParseHTML` on count, tag or attribute count.
- Option toggles between calls (`SetProtyleWYSIWYG`) apply to A and B.
- Reports per pass: comparisons, composed, fallbacks by reason (A's stats), hit rate, bytes re-run, mismatches by cause. `--check=replay` of milestone A stays.
- Commands (from `ts/`): the six seeds of the README for both modes at `--cmp=10000`; expected: 0 mismatches, 0 inconsistencies, 0 split disagreements. The corpus is frozen with `--corpus-snapshot` (milestone A).
- **In-test generator** (`edits.test.ts`, no dependency on `experiments/`): a seeded LCG; the pool is the children of the oracle-produced DOM of the corpus documents (split with `scanTopLevel`); one step is replace / insert / delete / duplicate / swap of children, a text edit inside a child (insert one of `" "`, `"U+3000"`, `"\u000b"`, `"x"` after a random `>` of a text-bearing element), or a merge of two adjacent children into one string. Passes warm / cold / shared as above. Outcomes must be equal (throws included) to engine B.

#### 8.5 Negative controls (must be caught)

Marked in the source with a one-line `// NC:<id>` comment on the statement to mutate. Run through `negative-control.ts` (7.4), 4,000 comparisons per mode unless noted. "Caught" = at least one mismatch or `INCONSISTENCY` is printed.

| id | mutation | expected |
|---|---|---|
| NC1 | 5.1 line 14: `isLast: true` | caught (a code block in a non-last list; spike control "last AST node": 158 / 136 mismatches) |
| NC2 | 5.1 line 14: `prev: -1` | caught (link-ref-defs or footnotes text before a block) |
| NC3 | 5.1 line 14: `next: -1` | **not caught, documented**: `isLast` carries the information, `next` is redundant for the current renderers (the control proves the redundancy; do not remove the field) |
| NC4 | `domNext: -1` in 5.1 line 14 | caught (`p<br>` before ul, ol, blockquote; spike control 298 / 322) |
| NC5 | `NextSibling` guard without `record("domNext", ...)` | caught, same documents |
| NC6 | `listCoupling` returns false | caught (spike 232 / 241) |
| NC7 | `certify` skips condition 1 and 3 | caught (opaque previews with stray tags; spike 20 / 17) |
| NC8 | the `tip-open` refusal removed | caught in IR (spike 132) |
| NC9 | the `TrimSpaceAll` replay does not trim | caught by `repro/run.ts` (R1) and the fuzz |
| NC10 | `fingerprint` returns a constant | caught in the option-toggle fuzz (spike 37 / 44) |
| NC11 | the variant match always takes `variants[0]` | caught |
| NC12 | coalescing merges across `setsLastOut` | caught (strict: `replay:lastout-diverged`; otherwise output) |
| NC13 | `closeDocumentWriter` replaced by a plain trim of space, tab, LF | caught (the engine's close differs for `KeepParagraphBeginningSpace`; at least the ZWSP shield case) |
| NC14 | the `generated-id` scan removed | caught by a dedicated unit test (patch `renderParagraph` to write `ast.NewNodeID()`), not by the fuzz (it normalises IDs) |
| NC15 | the `lastOut` accessor returns 10 always | caught by the unit test of 8.2 item 1, not by the fuzz (no corpus child ends with a non-LF byte) |

#### 8.6 Regression list (explicit documents, in `edits.test.ts` or the e2e file; each compared with engine B in both modes where it applies)

R1 family from `repro/cases.ts` (leading U+3000, VT, FF, NBSP, U+2028 first paragraph followed by a list or a blockquote; whitespace-only paragraph; IR `\f[foo]` + list); an empty paragraph before a whitespace paragraph (ZWSP shield); `<ul></ul>` alone and `<p></p>` alone (all children dead: output `"\n"`); `<p>x<br></p>` followed by `ul`, `ol`, `blockquote`, by an empty `ul` then `ul`, by `h2`; a list whose item holds a fenced code block, last and not last, followed by empty blocks; `ul` + `ul` (3 attributes, composed), `ul` + `ul[1]` and `ul` + `<ul></ul>` + `ul[1]` (refused `list-coupling`); a blockquote nested in a blockquote after a paragraph and after a link-ref-defs block (the `lastOut` read); link-ref-defs block before a heading, a list, a table; a footnotes block followed by a paragraph; the same child twice in one document (shared entry, two contexts); an opaque html-block preview whose raw HTML is `<form`, `<style`, `<iframe` and `<div` (refused `cert:opaque-preview`); a child with a stray `</div>` inside a preview; IR indented code (`tip-open`) in the middle of a document; `<li>x</li>` at top level (`scan:implicit-end-tag`); top-level text between blocks; upper-case tag; a `data-formula` element followed by a `script` (refused by the scanner); a document with a leading U+FEFF or white space (`scan:top-level-text`); ZWSP inside tags and inside text; `<wbr>` created by the ZWSP removal (`<wbr>` with a ZWSP inside the tag name); `SetProtyleWYSIWYG` toggled between two calls with the same document; `lute.RenderOptions.Terms.set("a", "b")` between two calls (the fingerprint changes); `lute.ParseOptions.X = ...` assigned directly; an engine whose `ParseOptions` gets an object-valued own field (`options-not-fingerprintable`); a document larger than `maxBytes` (`too-large`); two engines enabled at once with different options (separate states); `EnableIncrementalDom2Md` twice; `DisableIncrementalDom2Md` then a call (normal path, identical output, `IncrementalDom2MdStats` null); the exception cases of `throw_parity` that go through `VditorDOM2Md` (both sides throw).

#### 8.7 Default run versus `test:full`

Default `npm test`: 8.1 with `sample()`, 300 edit comparisons per mode, the regression list, the scanner audit, the certificate test. `npm run test:full` (`FULL`): all option sets, all documents, 20,000 edit comparisons per mode. The fuzzer, the negative controls and `bench` stay outside `npm test` (commands in the README of the experiment).

### 9. Implementation steps for a weaker model

Rules for every step: run the commands from `ts/`; **from step 3 on, also run `npm run typecheck` after every step and fix type errors before going on** (`node --test` strips types and proves nothing about them); do not benchmark; do not run `npm run test:full` unless a step says so; never `git add/commit/checkout/stash/reset`; do not touch the Go sources, `javascript/` or `test/oracle/`; erasable TypeScript only (no `enum`, no `namespace`, no parameter properties); imports with `.ts`; English only. "STOP" means: stop, do not work around, and report the observation with the smallest input.

**Step 0. Baseline.** `npm run typecheck && npm test`. Record the totals (milestone A: 3,977 tests, 3,969 pass, 0 fail, 8 skipped, about 67 s). STOP if anything fails before you start.

**Step 1 [DEFAULT PATH, behaviour-preserving]. Extract four functions.**
- `src/vditor_wysiwyg.ts`: add `export function vditorDOM2MdPreprocess(htmlStr: string): string` containing exactly the three `strings.ReplaceAll` statements now at the top of `vditorDOM2MdPrepare` (caret, `"\t\n"`, `"    \n"`); `vditorDOM2MdPrepare` starts with `htmlStr = vditorDOM2MdPreprocess(htmlStr);`. Add `export function vditorDOM2MdAdjustTree(tree: parse.Tree): void` containing the `ast.Walk(tree.Root, ...)` statement of `vditorDOM2MdBuildTree` (comment "Adjust the tree structure" included, `tree.Root!` as now); `vditorDOM2MdBuildTree` calls it before `return tree`.
- `src/vditor_ir.ts`: the same, `vditorIRDOM2MdPreprocess` (its first replacement is the literal `"<wbr>"`) and `vditorIRDOM2MdAdjustTree` (this walk uses `n.FirstChild!.Next!.AppendTokens(...)`; copy it exactly).
- Each new function gets `// PORT-NOTE: hook for the per-child cache (tasks/004), no behaviour change: see vditorDOM2MdPrepare.`
- Check: `npm run typecheck`, `npm test` (totals equal to step 0), `node --test test/e2e/root/dom2md_replay.test.ts`. STOP if the totals differ.

**Step 2 [DEFAULT PATH, behaviour-preserving]. The inert dispatch.**
- Create `src/incremental/dispatch.ts` (header comment of 7.1): `export const incrementalActive = { count: 0 };` `export type IncrementalHandler = (lute: Lute, mode: "wysiwyg" | "ir", html: string) => string | null;` `let handler: IncrementalHandler | null = null;` `export function registerIncrementalHandler(h: IncrementalHandler | null): void` and `export function tryIncrementalDom2Md(lute, mode, html): string | null { return handler === null ? null : handler(lute, mode, html); }`. `import type { Lute } from "../types.ts";` only.
- Edit the two public wrappers as in 7.2.
- Check: typecheck; `npm test` totals equal; `node --test test/e2e/bundle.test.ts` passes. STOP if the bundle test fails (it means a surface change).

**Step 3. `piece.ts`, `scanner.ts` and the scanner test.**
- `piece.ts`: the types of section 2, the reason constants of section 6 as string literals in one `export const REASONS = [...] as const`, `class IncrementalInconsistency extends Error { reason: string; constructor(reason: string, detail: string) }`, `class BarrierViolation extends Error { site: string }`.
- `scanner.ts`: start from `experiments/dom2md-cache/scan.ts` (copy the algorithm, do not import it). Changes: `Child = { start, end, tag, attrs, opaque }`; the result is `{ ok: true, children } | { ok: false, code: string, at: number }` with the codes of section 6 (`top-level-text`, `comment-or-doctype`, `stray-lt`, `tag-not-allowed`, `upper-case-tag`, `malformed-end-tag`, `mismatched-end-tag`, `unterminated`, `self-closing-non-void`, `implicit-end-tag` for "block start tag inside p", "li outside a list", "heading in heading", "a in a", `table-structure` for the table content-model refusals, `unterminated-attribute`, `unterminated-preview`, `no-children`); the allow-list `ALLOWED` exactly as in 4.4 G2 (the experiment's list plus nothing; remove nothing); a new check at depth 0: the tag must be in `TOP_LEVEL = {p, h1..h6, ul, ol, table, blockquote, hr, div}` else `top-level-tag`; drop `dataType`.
- Test `test/incremental/scanner.test.ts` as in 8.1. Check: `node --test test/incremental/scanner.test.ts`. STOP if the audit finds a disagreement with `util.ParseHTML` (print document name, child index, both serialisations); do not edit the grammar to hide it.

**Step 4. `parser_certificate.ts` and its test.** Write section 4.1 as given. `certify(child: string, doc: html.Node, boundary: Boundary | null): string | null` implements 4.2 conditions 1-3 and returns the failing field name or `"shape"` / `"last-token"`, null if certified. `sandwichCheck(child: string): string | null` implements the strict check. `REF` is computed lazily once. Test as in 8.3. Check: `node --test test/incremental/parser_certificate.test.ts`: expect every non-opaque child certified and 0 context differences. STOP if a non-opaque child is refused: this is the scanner/parser disagreement this design exists to expose; report the child.

**Step 5. `options_fingerprint.ts` and its test** (5.5). The hash of a Map: iterate entries in insertion order, `h = (Math.imul(h, 31) + charCode) | 0` over the key then the value, plus `size` and total character count. Check: `node --test test/incremental/fingerprint.test.ts`.

**Step 6. `barrier.ts` and its unit tests.** `guard(obj, field, read)`: `let backing = obj[field]; Object.defineProperty(obj, field, {configurable: true, enumerable: true, get: () => read(backing), set: (v) => { backing = v; }})` (`guardAst` is the same function, kept under one name in code). `domStub`, `astStub`, `barrierStub` exactly as in 3.3/3.4 (traps: `get`, `set`, `deleteProperty`, `has` is left alone). Unit tests: each allowed property works, each other property throws `BarrierViolation` with the site string, identity comparisons of stubs work, `set` throws. Check: `node --test test/incremental/barrier.test.ts` (this file grows in step 7).

**Step 7. `sandbox.ts` for WYSIWYG.**
- `ADJUST_PASSES: Array<{ name: string; scope: "root" | "child"; armed: boolean; covered: boolean }>` as the table in 3.2.
- `class SandboxRenderer extends RecordingFormatRenderer` and `newSandboxRenderer(tree, options, parseOptions)` (construct, `registerFormatRendererFuncs(ret)`); the `Newline` override of 2.2.
- `runChild(lute, adapter, html, ctx, opts): RunResult` where `RunResult = { info: ChildInfo; variant: Variant | null; refusal: Refusal | null }`, following 3.2-3.6 in this order: `const was = ast.GetTesting(); ast.SetTesting(true); try { ... } finally { ast.SetTesting(was); }` around everything; (1) get the DOM: `opts.certify ? parseWithBoundary(html) + certify(...)` (a failed certificate returns the refusal of section 6: opaque -> `cert:opaque-preview` unsupported, else inconsistency) : `util.ParseHTML(html)`; (2) install the DOM guards (3.3) with `reads: Map<ReadKey, number | boolean>` and `record(key, value) { if (!reads.has(key)) reads.set(key, value); }`; (3) drive the 15 passes with the checks of 3.2; (4) genAST; `tipOpen`; `adjustTree`; collect `tops`; (5) render phase 3.4; (6) after the run 3.6. A throw inside is classified: `BarrierViolation` -> inconsistency `barrier:<site>`; `IncrementalInconsistency` as is; anything else -> `Refusal{unsupported, "engine-threw"}`.
- `listCoupling` (3.5), `export const WYSIWYG_ADAPTER` using the Step 1 functions.
- Tests: extend `barrier.test.ts` with 8.2 items 1-5; create `adjust_passes.test.ts` (8.3). Also a piece-assembly test (temporary harness inside the test file, not part of the product): for the oracle DOMs of 30 corpus documents, split with `scanTopLevel`, `runChild` every child with the `PROVISIONAL_CONTEXT` then with the real context computed by the sweeps of 5.1 line 12, replay the ops with a `FormatRenderer`, and compare with `lute.VditorDOM2Md`. This is the prototype's test; if it fails, the sandbox is wrong.
- Check: `node --test test/incremental/barrier.test.ts test/incremental/adjust_passes.test.ts`. STOP if the piece-assembly test shows a mismatch: print the document and the child; do not patch the replay.

**Step 8. The IR adapter.** `IR_ADAPTER` with the IR functions of step 1, `lute.genASTByVditorIRDOM`, `vditorIRDOM2MdRenderOptions`. Everything else is shared. Repeat the piece-assembly test for IR (expect `tip-open` refusals on indented code; those documents are skipped by the test with the reason asserted). STOP if a non-`tip-open` mismatch appears.

**Step 9. `cache.ts`.** `class State { maps: {wysiwyg: Map<string, Entry>; ir: Map<string, Entry>}; fp: string; bytes: number; callNo: number; stats: IncrementalStats; options: Required<IncrementalOptions> }`, `newEntry`, `flat` (5.4), `evict` (5.4), `addVariant` (cap 8). Test `cache.test.ts` (8.1).

**Step 10. `assemble.ts` and `index.ts`.** Write 5.1 literally. `index.ts`: `EnableIncrementalDom2Md` creates the `State`, stores it in the registry (`WeakMap<Lute, State>` in `dispatch.ts`: export `getState/setState/deleteState`, keep `incrementalActive.count` equal to the number of enabled engines; **decrement on Disable only if the engine was enabled**), and calls `registerIncrementalHandler((lute, mode, html) => { const st = getState(lute); return st === undefined ? null : tryDom2Md(st, lute, mode === "wysiwyg" ? WYSIWYG_ADAPTER : IR_ADAPTER, html); })` once at module load. The handler catches nothing: in normal mode `tryDom2Md` itself converts every inconsistency and `engine-threw` into `null` plus a counter; in strict mode it throws `IncrementalInconsistency`. Export from `src/index.ts`: `export * from "./incremental/index.ts";`.
- Test: `dom2md_incremental.test.ts` (8.1). Check: `node --test test/e2e/root/dom2md_incremental.test.ts`, then `npm run typecheck`, then `node --test test/e2e/bundle.test.ts`. STOP if the differential test shows any mismatch, any `inconsistencies` entry, or a reason outside the closed list; bisect with the smallest child sequence before touching code.

**Step 11. Strict mode, `verify`, the sandwich.** Implement 5.1 line 18, the sandwich call after a successful certificate when `strict`, the `replay:lastout-diverged` comparison, and the normal-mode behaviour (count, drop the entry, return `null`). Tests: the barrier violations of 8.2 item 5 in normal mode; a patched engine for `generated-id` and `engine-threw`.

**Step 12. `edits.test.ts` and the regression list of 8.6.** Check: the whole `npm test`; record the new totals and the time (budget: at most 12 s above step 0). STOP if over budget: reduce sampling, report.

**Step 13. Retarget the experiments.** `experiments/dom2md-cache/engine-adapter.ts` (7.4); change `fuzz.ts` to build its cached object from it (a flag `--impl=prototype|engine`, default `engine`); add the `evict` pass and the strict-mode reporting; switch `auditSplit` to `scanTopLevel`. Run (from `ts/`, one command at a time, each under 5 minutes): `node experiments/dom2md-cache/repro/run.ts`, then `node experiments/dom2md-cache/fuzz.ts --mode=wysiwyg --cmp=3000 --seed=1 --corpus-snapshot=<scratch>/corpus.json` and the same for `--mode=ir`. Expected: 0 mismatches, 0 inconsistencies, composed rate above 80 percent in the generated mix. STOP on the first mismatch: reduce it (the fuzzer does) and report the reduced case.

**Step 14. Negative controls.** Mark the NC statements; extend `negative-control.ts` as in 7.4; run NC1-NC13 in two halves. Every row marked "caught" must print a mismatch; NC3 must not. STOP if a control that must be caught is silent (that means the test, not the code, is weak).

**Step 15. Documents.** Add the "Code without a Go counterpart" section to `PORTING.md` (7.1). Update the README of the experiment (engine impl, new commands). Append to `tasks/004-incremental-and-fast-paths.md` a short "Milestone B results" section with the measured numbers (test totals and time, fuzz totals, composed rates, negative controls) and the deviations from this specification.

**Step 16. Final checks.** `npm run typecheck`, `npm test` (no failures, time within budget), `npm run build`, `node --test test/e2e/bundle.test.ts`. The default surface (global keys, engine members) is checked by the bundle test; there is nothing else to compare by hand. Do not run benchmarks; list the measurements for the coordinator's batch: (a) the cost of `tryIncrementalDom2Md` dispatch when off (one integer test), (b) cold and warm times of the 666 KB / 1.64 MB documents of the spike, (c) sandbox overhead per miss, (d) memory of a warm cache of the 600 KB document.

### 10. Open risks, most likely to invalidate a step first

1. **The parser lemma beyond the corpus (steps 3-4).** Claim L is argued from the readers of the state fields and checked on 9,887 corpus children. I did not read every `inBodyIM` branch that the allow-listed tags reach (`a`, `font`, `b`..`u`, `details`, `summary`, `label`, `center`, `input`, `img`, `wbr`, `q`, `abbr`...) for reads of `head`, `framesetOK`, `form` outside the greps; if one reads state outside the projection, an adversarial child could pass the certificate yet parse differently in context. The strict sandwich check and the fuzz are the nets. If the scanner audit or the sandwich ever disagrees, shrink G2 first.
2. **Cold-call and per-miss cost (step 7, 10).** The sandbox adds `defineProperty` on nodes (hidden-class changes), `Proxy` stubs and a second run for context-reading children (40 percent of the children read `isLast` or `prev`: 2,486 reruns in 5,666 first runs). The spike's cold call was already 2.8x the uncached time. If the cold call exceeds about 3x, implement the exact optimisation in 5.1 (first run with the neighbours' known infos) before anything else. Not measured.
3. **Variant fragmentation.** Reads record exact types (`prev`, `next`, `domNext` as values). A document whose neighbours' kinds change often makes many variants per child (cap 8, then churn). Finer keys (`prevExists` separate from `prev`, recorded when the stub's `Type` is read) are a compatible refinement; not done because the simple form is what was validated.
4. **`defineProperty` on `html.Node`/`ast.Node` instances breaks something I did not exercise**: `Walk` on a node with an accessor `Next`, clone helpers that copy own enumerable properties, `structuredClone`, `JSON.stringify` of nodes in error messages. The corpus run exercised `Walk`, the renderers and the passes only. A code path that spreads or `Object.assign`s a top-level node would copy the getter's value (a stub) and could throw at an unexpected place.
5. **The pass driver (3.2) and `adjustVditorDOM` drift.** The conformance test checks order of first calls only, not arguments or guards (`removeWbr` is called only `if (null !== root.FirstChild)`, `removeCodeCode` and `adjustVditorDOMCodeA` capture `next` before the call). For a one-child root these differences are invisible; a future pass that depends on sibling count would not be.
6. **IR under the DOM barrier.** The prototype ran IR with the barrier (571 documents equal) but no corpus child exercised the IR `br` rule (`vditor_ir.ts:667`) or reads of `domNext` beyond the merge. The IR table output starts with its own newline (spike); the replay handles it as part of the log, but no negative control targets it.
7. **Hit rate on DOM written by Vditor's JavaScript and by browsers.** The corpus is the engine's own forward output. Real editor DOM may contain newlines between blocks (`scan:top-level-text`), `<span>` or text at top level, KaTeX/mermaid/ECharts markup, `class="katex"` blocks (dead by `removeEmptyNodes`) and `hljs-` spans. Each is either a counted fallback or correct, but the fraction served from the cache is unknown.
8. **Memory.** `bytes` is an estimate; `Uint8Array` copies per op carry object overhead (coalescing reduces it); the flat copy of keys is O(|s|) per new entry. The 64 MiB default is a guess; not measured.
9. **Same-call state.** The replay's `LastOut` for `PASS` pieces, and the adoption of `endLastOut`, are argued (C7) and checked in strict mode on corpora only; a case where a node-level write sets `LastOut` and the root log shows nothing (footnote definitions in the Markdown formatter, not reachable in DOM2Md) would be adopted correctly in normal mode and flagged in strict mode.
10. **`ast.SetTesting(true)` around the sandbox (low).** Verified by reading: the flag has one reader, `NewNodeID` (`ast/node.ts:1445`; `GetTesting` has no caller in `src`), and [ran] the prototype rerun with every sandbox run under `SetTesting(true)` gave 400 of 400 (WYSIWYG) and 390 of 390 (IR) equal documents. The only outputs containing the fixed ID were literal occurrences of that string in the corpus file `tasks/004-incremental-and-fast-paths.md` (this section quotes it): a user document that contains the string falls back as `generated-id`, which is harmless but means that fuzz corpora built from this file see those fallbacks (keep the corpus snapshot of milestone A).

## Milestone B implementation (2026-10-11)

Status: **stopped at step 3** (of 0-16). Steps 0-2 done. The tree is in the state after step 2: `npm run typecheck` clean, `npm test` 3977 tests, 3969 pass, 0 fail, 8 skipped (baseline). The step 3 files were reverted from the repo; copies are in the session scratchpad `cache-b/step3-unfinished/` (not part of the repo). Labels: [ran] executed in this session, [code] read from source.

### Steps done

- **Step 0, baseline [ran]**: `npm run typecheck` clean; `npm test` 3977 / 3969 pass / 0 fail / 8 skipped, 61.9 s.
- **Step 1 [DEFAULT PATH] [ran]**: `ts/src/vditor_wysiwyg.ts` gains `vditorDOM2MdPreprocess` (the three replacements) and `vditorDOM2MdAdjustTree` (the `ast.Walk` of the build stage); `vditor_ir.ts` the same as `vditorIRDOM2MdPreprocess` / `vditorIRDOM2MdAdjustTree`. Prepare and BuildTree call them. Each carries the PORT-NOTE. Check: typecheck clean, `test/e2e/root/dom2md_replay.test.ts` 6/6, `npm test` totals equal to step 0.
  - Mechanical correction: `ast.Walk(tree.Root!, ...)` in both `AdjustTree` functions (the spec's `tree.Root!`; `tree.Root` is nullable in a function that does not assign it; the first typecheck failed without it).
- **Step 2 [DEFAULT PATH] [ran]**: `ts/src/incremental/dispatch.ts` (new; imports only `type Lute`): `incrementalActive`, `IncrementalMode`, `IncrementalHandler`, `registerIncrementalHandler`, `tryIncrementalDom2Md`. The two public wrappers (`VditorDOM2Md`, `VditorIRDOM2Md`) carry the dispatch block of 7.2 with the PORT-NOTE; each vditor file imports `incrementalActive, tryIncrementalDom2Md` from `./incremental/dispatch.ts`. Check: typecheck clean, `test/e2e/bundle.test.ts` 4/4, `npm test` totals equal to step 0.

### Step 3: STOP (scanner audit disagreement)

Step 3 wrote `src/incremental/piece.ts` (types of section 2, `REASONS`, `IncrementalInconsistency(reason, detail)`, `BarrierViolation(site)`), `src/incremental/scanner.ts` (the grammar of 4.4 from `experiments/dom2md-cache/scan.ts`, with the codes of section 6, `TOP_LEVEL`, and the check `top-level-tag` placed after the `li`/heading/`a` and table checks so that a top-level `<li>` reports `implicit-end-tag` as C6 requires) and `test/incremental/scanner.test.ts` (16 refuse cases, 13 accept cases, the corpus audit). The 16 refuse cases and 13 accept cases pass. The audit fails:

- [ran] `test/incremental/scanner.test.ts`, the audit test, first failure: `markdown#402 wysiwyg: scanner found 3 children, the engine's parse 1`. The accepted string holds a `<pre data-render="2">` preview whose raw HTML contains a `</pre>`; the scanner's rule "skip to the first `</pre>`" cuts there.
- [ran] A diagnostic over the whole audit population (2,789 documents: the Markdown corpus under WYSIWYG and IR, the repository files, `RAW_DOMS`): 2,667 accepted, 122 refused, **8 disagreements, all of them count mismatches, and every one contains an opaque child**; 0 disagreements without an opaque child. Documents: `markdown#402` (3 vs 1), `#405` (1 vs 2), `#444` (5 vs 1), `#445` (5 vs 1), each in WYSIWYG and IR. Script: `cache-b/diag/audit-all.ts` in the scratchpad.

Why this stops the walk: the step 3 check requires the audit to show no disagreement, and the STOP rule says to stop and not edit the grammar to hide it. The specification itself is inconsistent on this point. Section 4.4 G5 and section 4.3 say that an opaque preview is not validated by the scanner and that "the certificate must then decide" (so a mis-cut is expected and is caught by the certificate, which would refuse these children as `cert:opaque-preview`). Section 8.1 (the audit) and step 3's STOP rule require exact agreement for every document, opaque ones included. The two readings conflict for these 8 documents. I did not pick one. Coordinator decision needed: (a) the audit excludes children flagged `opaque` (and checks that the certificate refuses the mis-cut), or (b) the grammar treats the `</pre>` inside a preview differently (for example skipping to the matching `</pre>` by counting raw `<pre` openings), which the spec's G5 does not describe.

### Deviations and corrections so far

1. `Walk(tree.Root!)` in the two AdjustTree functions (see step 1).
2. Scanner: the spec's codes `scan:unterminated` also covers the "unterminated tag" case (a start tag that never closes), mapped to `unterminated`. This is my choice; the spec lists no separate code.
3. Scanner: the `top-level-tag` check is the last nesting check, so `<li>` at top level is `implicit-end-tag` (C6) and `<tr>` / `<td>` at top level are `table-structure`.

### Test and fuzz results

- `npm test` after the last step that passed (step 2): `ℹ tests 3977`, `ℹ pass 3969`, `ℹ fail 0`, `ℹ skipped 8`, duration about 73 s. After the revert: `ℹ tests 3977`, `ℹ pass 3969`, `ℹ fail 0`, `ℹ skipped 8`, duration 76.4 s.
- Fuzz, negative controls, steps 4-16: **not run** (the walk stopped at step 3).

### Negative-control table

Not built (steps 6-14 not reached).

### Left for the coordinator

- The decision on the opaque-preview audit conflict above, then resume at step 3 (the three files are in the scratchpad copy).
- Measurements of step 16 (not taken, none requested by the walk so far): dispatch cost, cold and warm times, sandbox overhead, warm cache memory.
- Steps 4-16 as specified.

### Resumed run (coordinator's resolution applied)

Status: **stopped again, at step 7** (a second STOP). Steps 0-6 done; step 7 partly done. Typecheck clean. `npm test`: `ℹ tests 4027`, `ℹ pass 4019`, `ℹ fail 0`, `ℹ skipped 8`, 80.0 s (baseline 3977 / 3969 / 0 / 8; the 50 added tests are the new incremental tests).

**Deviation 4, audit invariant revised by the coordinator.** Section 8.1 and step 3 are read with it: for every accepted document, the scanner's children equal the engine's top-level children (count, tag, attribute count, child-alone serialisation), or the document contains an opaque child (a data-render preview). The 8 opaque disagreements are pinned by id in `test/incremental/corpus_docs.ts` (`OPAQUE_DISAGREEMENTS_EXPECTED`): markdown#402, #405, #444, #445, each in WYSIWYG and IR. Observed over 2,789 documents: 2,667 accepted, 122 refused, 3,901 engine children compared. The audit test fails if the set changes. A disagreement without an opaque child fails.

**Step 4 [ran]: parser certificate, `src/incremental/parser_certificate.ts`, `test/incremental/parser_certificate.test.ts` (6 tests pass).**
- Mandatory check (coordinator item 2): for each of the 8 documents, the certificate refuses at least one scanner child. Both directions are observed. "Scanner found more children" (markdown#402, #444, #445): the first child `<div>` is refused with `im` (its parser state at the cut is not the initial state). "Scanner found fewer" (markdown#405): the single scanner child is refused with `shape` (it parses to two top-level nodes). No document has all children certified.
- Corpus: 3,897 non-opaque children certified (each also passes the sandwich check); 22 opaque children refused; 0 non-opaque refusals. Certified children's alone parse equals the whole-document node.
- Negative samples refused as the spec lists: `<p>x</p><p>y</p>` (shape), `<p>x` (oe), `<p><b>x</b>` (afe), `<ul><li>a</li>` (oe), `<p>x</p>text` (shape), `<p>x</p></p>` (shape), `<p>x</p><!-- c` (refused).
- **Deviation 5, certificate hook (spec 4.1).** The spec's hook records the last token before calling the original `parseCurrentToken`. The parser processes an implied token (here `<body>`) re-entrantly inside the processing of `<hr>`, so the last recorded token was the implied `body` start tag, and every non-opaque `<hr>` child was refused by `last-token` (first run: markdown#83). The hook now records the token after the original returns (the ErrorToken capture stays before). Fixed; the test passes.
- Mechanical: `REF` is a function (lazy, computed once), `sameState` is the condition-1 comparison, `serialiseNode`, `bodyOf` exported.

**Step 5 [ran]: `src/incremental/options_fingerprint.ts`, `test/incremental/fingerprint.test.ts` (4 pass).** The field counts match the spec (ParseOptions 50, RenderOptions 42). The PutTerms test overwrites an existing key: the first version added a key, which changed the size (my test error).

**Step 6 [ran]: `src/incremental/barrier.ts`, `test/incremental/barrier.test.ts` (6 unit tests pass).** guard, domStub, astStub, barrierStub as in 3.3/3.4.

**Step 7 [partly]: `src/incremental/sandbox.ts` (new; typecheck clean).** `ADJUST_PASSES`, `SandboxRenderer` (the root Newline does not read LastOut), `newSandboxRenderer`, `runChild` (never throws; classifies barrier, inconsistency, engine-threw), `listCoupling`, `WYSIWYG_ADAPTER`, `coalesce`, `GENERATED_ID` scan.
- `test/incremental/adjust_passes.test.ts`: pass order equals `ADJUST_PASSES` on a list, table and code-block document. Passes.
- `test/incremental/piece_assembly.test.ts` (temporary harness): 30 WYSIWYG corpus documents, every child run alone with the real neighbour context, replayed on a `FormatRenderer`, equal to `VditorDOM2Md`; 0 refused. Passes.
- Barrier sandbox items of 8.2: 8.2.3 (prev), 8.2.5a (neighbour `Tokens`), 8.2.5e (Unlink of a top-level child) pass in the repo. Not in the repo, in scratchpad `cache-b/barrier-sandbox-items.pending.ts`:
  - 8.2.1 **spec claim not observed (STOP)**: "their ops differ" for `<blockquote><blockquote><p>x</p></blockquote></blockquote>` with `lastOut` 10 and 0x78. The reads are recorded as specified (`lastOut` in both variants), but the two logs are identical (`[Append false ">> x\n>>", TrimSpaceAll, Append true "\n\n"]`): the nested line feed is removed by the trim. The mechanism is real; the claimed observable difference is not.
  - 8.2.2 **spec claim not observed (STOP)**: "ops differ by one blank line" for a code block in the last list item, `isLast` true and false. Both reads are recorded (`isLast`), but the logs are identical. The spec's own example does not show the difference; the spec's NC1 (spike) needs a different document (a code block in a non-last list), which I did not run.
  - 8.2.4 (domNext with `<p>a<br>b</p>`) failed for a setup reason: the `ul` case had `domNextAttrs: 1`, which is a real merge (the skeleton would refuse it). Corrected to 0 in the pending copy; not re-run in the repo.
  - 8.2.5b failed for a setup reason: the patch read `NextSibling.Data` on every node `mergeSameStrong` visits, including text nodes, where `null` is correct. Corrected in the pending copy (top-level children only).
- The two STOP claims were not weakened; they are left for the coordinator.

**Other deviations and mechanical corrections in the resumed run.**
- `RunResult.info` is `ChildInfo | null` (no info exists when the certificate refuses before the first run); the spec's type is not nullable.
- `REASONS` gained `scan:unterminated-tag` (the start-tag-never-closed case, which the coordinator asked to be an unsupported reason) with the scanner code `unterminated-tag`. The element left open at the end of input keeps the code `unterminated` (`scan:unterminated`). Both are unsupported.
- `runChild` takes `opts.opaque` (the scanner's flag) to choose `cert:opaque-preview` over `cert:scanner-accepted-certificate-refused`.

**Not done (left for the coordinator).** Steps 8-16. Step 7's barrier items 8.2.1 and 8.2.2 need the decision above. The opaque documents are not yet in the 8.6 regression list (step 12). Measurements of step 16 were not taken.

### Coordinator decisions applied, and steps 7 to 16 (continued run)

**Deviation 8, 8.2 REAL-ness is established by witness search (coordinator decision).** The two claims of 8.2 items 1 and 2 ("the ops differ") were false for the hand-written inputs: the logs are identical there, while the reads are recorded. Replaced by: COVERED, for every context field and every corpus child, no run under the base context or a single-field change trips the barrier (1,773 candidates x 7 fields x 2 values, `test/incremental/context_channels.test.ts`); and REAL, by a deterministic witness search (`test/incremental/witness.ts`, 2 s budget per field) over the same candidates. A witness is pinned as a fixed case and the key separation is asserted (the variant of A does not match the context of B). Results:
- lastOut 10 vs 0x78 (120): witness after 509 candidates (a blockquote with a heading and a paragraph).
- isLast true vs false: witness after 37 candidates (a table with a head and a body).
- prev -1 vs NodeText: witness after 3 candidates (a heading).
- next -1 vs NodeParagraph type (1): witness after 37 candidates (the table).
- domNext -1 vs atom.Ul (42754 as found by the search): witness after 82 candidates (a paragraph with `<br />`, the `br` rule).
- isFirst true vs false: **no witness over 1,773 candidates** (recorded as "no witness found"; the field stays declared and recorded).
- domPrev -1 vs atom.P: **no witness over 1,773 candidates** (recorded; stays declared and recorded).
Those two fields are conservative: their reads are recorded, so at worst an extra variant. A finding for the coordinator.

**Deviation 9, a `data-render="2"` preview with a raw `<div` is certified, not refused.** The spec's 8.6 list says refused. The raw `<div>` nests inside the `<pre>`, the `</pre>` cut closes it, the child is a balanced element, and the certificate certifies it; the composed output equals the normal path (verify on). The regression case expects composed. The `<form` and `<style` cases are refused by the certificate as the spec says.

**Deviation 10, 8.2 items 4 and 5b (pending file) corrected and moved.** 8.2.4 used `domNextAttrs: 1` on a `ul`, which is a real merge the skeleton refuses; now 0. 8.2.5b read `NextSibling.Data` on every node `mergeSameStrong` visits; now only top-level children with a next sibling. Both pass in `test/incremental/barrier.test.ts`.

**Step 4, deviation 5 tests** (`test/incremental/parser_certificate.test.ts`): a non-opaque `<hr>` child (three spellings) is certified with its last token `hr`; a boundary whose last token is another end tag (`p` for a `div`) or a start tag for a non-void element is refused with `last-token`. The corrected sentence is the one of section 4.1 that records the last token before delegating to `parseCurrentToken`.

**Step 7 finished, whole WYSIWYG corpus** (`test/incremental/piece_assembly.test.ts`, no sampling): 1,320 accepted documents equal to `VditorDOM2Md`. Refused: `cert:opaque-preview` 11, `list-coupling` 2, `engine-threw` 3 (not compared; the normal path is their reference). Time about 1 s.

**Step 8, IR adapter** (`IR_ADAPTER` in `src/incremental/sandbox.ts`). The same harness on the IR corpus: 1,259 documents equal to `VditorIRDOM2Md`. Refused: `tip-open` 56 (skipped and counted, as the spec says), `cert:opaque-preview` 11, `list-coupling` 2, `engine-threw` 3. No mismatch.

**Steps 9 and 10** (`cache.ts`, `assemble.ts`, `index.ts`, the registry in `dispatch.ts`, the export in `src/index.ts`). `tryDom2Md` follows 5.1 lines 1-18. Evict: insertion order until 75%, then clear; `evictions` counts each deleted entry and the clear. The `too-large` check runs after the lookup, when the document's entries alone exceed `maxBytes`. Strict mode throws `IncrementalInconsistency` after counting it; the call also counts as a fallback, so composed + fallbacks == calls. Bundle test 4/4 unchanged. `test/e2e/root/dom2md_incremental.test.ts`: 17 tests pass. Sampling: every second document under the default option set, every tenth under each of the other 14 sets. Results: no inconsistency; warm pass 0 misses in every set; about 92% composed on the default set; unsupported reasons only from the closed list.

**Step 11, strict, verify, sandwich.** The sandwich check runs for each newly certified child in strict mode (`strict:sandwich`). `test/e2e/root/dom2md_incremental_modes.test.ts` (3 pass): an injected barrier violation throws `IncrementalInconsistency` (`barrier:dom.next.Data`) in strict mode and falls back in normal mode with the normal output (inconsistencies 1, fallbacks 1, composed 0); a generated node ID is `generated-id` (unsupported) in both modes; an injected exception is `engine-threw` in both modes and both engines throw the same.

**Step 12, in-test generator and regression list.** `test/incremental/edits.test.ts`: 6 tests (300 comparisons per mode and pass: warm, cold, shared), all equal to the normal path, throws included. `test/e2e/root/dom2md_incremental_regressions.test.ts` (45 tests pass): the 8.6 list, each case in both modes; the eight opaque-disagreement documents fall back as a whole with `cert:opaque-preview` (unsupported; no inconsistency; no composed call); option toggle (`optionClears`), Terms change, enable twice, disable, two engines, `too-large`.

**Engine fuzz (substitute for step 13, run outside `npm test`).** `experiments/dom2md-cache/fuzz.ts` was not retargeted. The in-test generator with a seed argument was run (scratchpad `cache-b/diag/fuzz.ts`, command `node <scratchpad>/cache-b/diag/fuzz.ts <seed> 10000 wysiwyg|ir`): seeds 1, 2 and 3 in both modes, 10,000 comparisons per pass (warm, cold, shared): 0 mismatches, 0 inconsistencies, no throw mismatch. Shared-engine composed rate: WYSIWYG 6,094 / 6,342 / 6,319 of 10,000 (seeds 1, 2, 3); IR 6,719 / 6,765 / 6,749. Below the 80% that step 13 expects: the generator's deletions produce many empty documents (about 1,350 per run) and its text edits many top-level text refusals (about 2,000 per run). A finding, not a failure.

**Negative controls (step 14, outside `npm test`; one source line changed per control in `src/incremental/`, restored and checked by hash after each; NC marks not added to the source).**

| id | mutation | fuzz (wysiwyg / ir) | unit tests | result |
|---|---|---|---|---|
| NC1 | assemble: `isLast: true` | 4,000: 0 / 0 mismatches | 0 failures | silent (finding) |
| NC2 | assemble: `prev: -1` | 4,000: 0 / 0 | 0 | silent (finding) |
| NC4 | assemble: `domNext: -1` | 4,000: 5 / 1 mismatches, 43 / 1 inconsistencies | - | caught |
| NC6 | `listCoupling` returns false | - | 2 failures | caught |
| NC7 | certify skips conditions 1 and 3 | - | 7 failures | caught |
| NC8 | tip-open refusal removed | - | 1 failure | caught |
| NC9 | replay TrimSpaceAll does not trim | 1,500: 5 / 5 mismatches | - | caught |
| NC10 | fingerprint constant | - | 2 failures | caught |
| NC11 | variant match always variants[0] | 1,500: 5 / 5 mismatches | - | caught |
| NC12 | coalesce across setsLastOut | 4,000: 0 / 0 | 0 | silent (finding) |
| NC3 | `next: -1` | not run | - | documented as not caught by the spec (redundant field) |
| NC5 | NextSibling guard without record | not run | - | not built |
| NC13 | closeDocumentWriter replaced | not run | - | not built |
| NC14, NC15 | generated-id scan removed; lastOut accessor returns 10 | not run | - | not built |

The silent NC1, NC2 and NC12: the spec expects NC1 and NC2 to be caught on the corpus. The isLast and prev channels are REAL at the level of one child (deviation 8), but at document level their effect is absorbed in every document of the corpus and of the generator at 4,000 comparisons (for example, the trailing blank line of a last node is removed by the document close). The spike's "last AST node" control (158 / 136 mismatches) was not reproduced. This needs a coordinator decision: search for a document-level witness, or accept the field as a conservative key.

**Time.** Full `npm test` (last run): `ℹ tests 4119`, `ℹ pass 4111`, `ℹ fail 0`, `ℹ skipped 8`, `ℹ duration_ms 91364.6` (baseline 3977 / 3969 / 0 / 8, about 61 to 77 s). The new incremental files take about 26 s of wall time together (the differential test 4.8 s after sampling; `context_channels` about 6 s including the oracle corpus). The 12 s budget of 8.1 is **exceeded**; not reduced further, per the coordinator's rule to report it. `npm run build` passes; `test/e2e/bundle.test.ts` 4/4.

**Step 15, documents.** `ts/PORTING.md` section "Code without a Go counterpart" added. The experiment README is not updated (step 13 not done).

**Step 16.** Typecheck clean; `npm test` no failures; build passes; bundle test passes. Not taken (for the batch): (a) dispatch cost when off; (b) cold and warm times of the 666 KB and 1.64 MB spike documents; (c) sandbox overhead per miss; (d) warm-cache memory of a 600 KB document.

**Not done.** Step 13 (retarget `experiments/dom2md-cache/fuzz.ts`, `engine-adapter.ts`, the `evict` pass, the README); step 14 NC marks in the source and NC5, NC13 to NC15; the 8.1 cache tests (`cache.test.ts`: heap check, eviction order); document-level witnesses for NC1 and NC2.

## Negative controls and context witnesses: analysis (2026-10-11)

Status: analysis only. `ts/src`, `ts/test`, Go and `javascript/` are unchanged (`git status` shows only untracked `tasks/` and scratch directories under `ts/experiments/dom2md-cache/`). All scratch code is in `ts/experiments/dom2md-cache/nc-proto/`: `assemble_nc.ts` and `sandbox_nc.ts` are copies of `src/incremental/assemble.ts` and `sandbox.ts` with switches read from `globalThis.__NC`; `driver.ts` registers them as the dispatch handler (with `REAL=1` the real `src` handler is used); `search.ts` (neighbour sweep), `gen.ts` (edit generators and kill rates), `unit.ts` (unit-level controls), `hand*.ts` (hand witnesses), `reads.ts`, `ends.ts`, `lo.ts`, `adj.ts`, `adj2.ts` (what the children read and write), `pool.ts` (pool census). Labels: [ran] executed, [code] read from source.

### 1. Method

[ran] Corpus: 2,242 audit documents without opaque children; 1,197 unique WYSIWYG and 1,155 unique IR top-level children. `search.ts` takes every unique child c (subject) and a neighbour set N (the shortest child of each kind, plus a link-ref-defs div without a trailing LF and `<p>a<br>b</p>`; 19-20 neighbours) and converts `[c]`, `[c,n]`, `[n,c]`, `[n,c,n]` on ONE warm strict engine (a wrong variant made in one context is reused in the next), about 70,000 documents per control and mode, and compares with the normal path. Two kinds of break per field: VALUE (assembly passes a wrong context value, what the old NC1/NC2 rows did) and SKIP (`skip_<field>`: the variant is matched ignoring that key; the literal "drop from the cache key"). A second run (`REV=1`) creates the variants in the reverse order.

### 2. Per-control verdict

| control | verdict | evidence |
|---|---|---|
| NC1 `isLast` (value or skip) | real field; missed because the fuzzer cannot generate the child (case ii) | Witness in section 3. VALUE: 62 wrong documents WYSIWYG, 200 IR; SKIP: 62 / 156-160. All have one subject: a paragraph whose text begins with four spaces. The pool of `edits.test.ts` is the FIRST 400 children of the corpus and holds 0 such paragraphs (`pool.ts`: 0 of 400, both modes). |
| NC2 `prev` (value or skip) | real field; missed because the fuzzer cannot generate the child (case ii) | Witness in section 3. VALUE 500 / 470 wrong documents, SKIP 476 / 446. Needs a top-level NodeText that does not end in LF (link-ref-defs-block or footnotes text) followed by a block that calls `newlineBeforeBlock` (heading, list, blockquote, table). Every link-ref block in the corpus ends with `\n` (`[r]:‸\n`), so the root `Newline` the child logs is a no-op and the control is invisible. |
| NC12 coalesce across `setsLastOut` | equivalent mutant; the control is wrongly specified (case iii) | 0 wrong documents over 140,000 (both modes, strict). [ran] `adj.ts`, `adj2.ts`: over all 2,352 unique children in two contexts and 26 hand children (footnotes, nested lists, blockquotes, tables, IR variants) there is NO pair of adjacent `Append` operations with different `setsLastOut` in any coalesced log. [code] The `false` appends are the container exits of blockquote, list and list item (recording_format_renderer M3) and each is followed at once by `TrimSpaceAll`; the AutoSpace appends (M4) are off in the Vditor render options (`vditor_wysiwyg.ts:302`: `AutoSpace = false`). So the test `last.setsLastOut === op.setsLastOut` is always true for adjacent Appends: removing it changes nothing. Even if it were not, the replay sets `R.LastOut = endLastOut` after each child, which hides the intermediate difference (strict mode would still throw `replay:lastout-diverged`). Replace by NC12' (section 4). |
| NC5 (domNext guard without record) | caught by existing tests once built | `unit.ts`: `readKeys` of the pinned domNext witness becomes `[]`, so `assert.ok(readKeys.includes(field))` of the pinned and REAL tests in `context_channels.test.ts` fails. Document level: 346 wrong documents WYSIWYG, 336 IR (same documents as NC4). |
| NC13 (`closeDocumentWriter` = trim of space, tab, LF) | equivalent mutant; wrongly specified | [code] `closeDocumentWriter` differs only for `Options.KeepParagraphBeginningSpace`; `vditorDOM2MdRenderOptions` and `vditorIRDOM2MdRenderOptions` build `NewOptions()` (that option false) and never copy it from the engine. 0 wrong documents over 140,000. Replace by NC13' (section 4): trim LF only, 360 / 9,112 wrong documents; caught by the OLD generator as well (footnotes blocks end in `"    \n"`). |
| NC14 (generated-id scan removed) | caught by a dedicated unit test that must be written | `unit.ts`: with `FormatRenderer.prototype.renderParagraph` patched to write `ast.NewNodeID()`, `runChild` refuses with `generated-id` normally and returns a variant containing `20060102150405-1a2b3c4` when the scan is removed. |
| NC15 (`lastOut` accessor returns 10) | caught at unit level only; no document can show it | `unit.ts`: the ops of the pinned lastOut witness (blockquote with h1 and p, lastOut 10 vs 0x78) differ normally and are equal under NC15, so the pinned test fails. 0 wrong documents (lastOut proof in section 3). |
| NC3 (`next: -1`) | not caught, as documented | 0 wrong documents in both orders (value and skip, about 140,000 each). |

[ran] No cache bug found: the real `src` engine (strict, verify) with the new generator of section 5, seeds 1-3, both modes, 8,000 comparisons each (48,000), had 0 differences and 0 strict throws. Every wrong document above came from a deliberate break. The unmodified copy (`{}`) also gives 0.

### 3. Witness table, field by field

HTML as the oracle writes it; output of `VditorDOM2Md` (WYSIWYG; IR has the same witnesses with its attribute set). "Broken" is the output with the break (value or skip) after the cache was warmed on D1.

| field | D1 (warm) | D2 | expected (normal path) | broken |
|---|---|---|---|---|
| isLast | `<p data-block="0">    indented code</p>` | D1 + `<h1 data-block="0" id="wysiwyg-h" data-marker="#">h</h1>` | ```` ```\nindented code\n```\n\n\n# h\n ```` (two blank lines: the paragraph renders a nested code block and `isLastNode` of that block reads `Root.LastChild`) | one blank line: ```` ...```\n\n# h\n ```` |
| prev | `<h1 data-block="0" id="wysiwyg-h" data-marker="#">h</h1>` | `<div data-block="0" data-type="link-ref-defs-block">[r]: http://x</div>` + D1 | `[r]: http://x\n# h\n` | `[r]: http://x# h\n` |
| domNext | `<p data-block="0">a<br>b</p>` | D1 + `<ul data-tight="true" data-marker="*" data-block="0"><li data-marker="*">a</li></ul>` | `ab\n\n* a\n` (the br rule, a list follows) | `a\nb\n\n* a\n` |
| next | none | none | no witness in about 140,000 documents, both orders | - |
| lastOut | none | none | proved constant (below) | - |
| isFirst | none | none | proved a function of `prev`, never read | - |
| domPrev | none | none | never read | - |

Findings per field.

- **isFirst is redundant, proven.** [code] `assemble.ts` sets `isFirst: prevT[i] < 0`, so `isFirst === (prev === -1)` in every reachable context. The guard that records it (`Root.FirstChild`, installed after `adjustTree`) is read by no render code: [ran] `reads.ts`, 0 reads over 2,352 children in two contexts (read-key census WYSIWYG: none 1,678, prev 600, domNext 30, isLast+next 26, next 26, lastOut+prev 12, isLast 6, isLast+prev 2; no `isFirst`, no `domPrev`). The same relation holds for `isLast === (next === -1)`, but `isLast` is NOT redundant in the key: a variant can read `isLast` without reading `next` (the nested last node of a paragraph climbs to the top node and reads only `Root.LastChild`). Verdict: `isFirst` can be dropped from the declared context and key. Keep the guard (it becomes the barrier that throws if a future renderer reads it).
- **domPrev is never read: source plus census.** [code] Top-level elements are `p h1-h6 ul ol table blockquote hr div` (`TOP_LEVEL`, scanner.ts:47). Every `PrevSibling` read in `vditor_wysiwyg.ts` and `vditor_ir.ts` is in a branch for a text node (770, 772, 1223; IR 324), `li` (716 needs a `ul`/`ol` parent; 976-982; 1356; IR 484), `code` (1049), `br` (1725; IR 677) or on a `FirstChild` of the node; none can be the top-level element. [ran] 0 reads in 2,352 children x 2 contexts; 0 wrong documents for value and skip, both orders. Verdict: unreachable; keep as a defensive key.
- **lastOut is 10 on every read, by data and structure.** [ran] `lo.ts`: a child reads `lastOut` (12 distinct children, 24 runs) with every previous node type except NodeText (16): after a text node the first operation of the child is `NewlineIfNotLF`, which assigns LastOut before any read. `ends.ts`: every emitting child ends with `endLastOut` 10 (2,344 of 2,380 runs; the other 36 are non-emitting children, `LASTOUT_PASS`); the document starts at LF; non-emitting children emit nothing. So at every read the replay's LastOut is 10, and a wrong value can only come from a synthetic context. A document-level witness would need a block whose log ends in a non-LF byte followed by a blockquote or list; no renderer in `format_renderer.ts` produces one. Verdict: no witness; keep the field (a new renderer could change this); its REAL test stays the unit-level pinned witness.
- **next:** reads only `Next != null` (the `.Type` is read by no top-level code with the Vditor options; `KramdownBlockIAL` is off). A variant made at `next=-1` always also reads `isLast` (the null result falls through to `Root.LastChild`), so the `isLast` key separates it. The reverse reuse (a variant made at `next>=0` used at `next=-1`) can only differ by trailing blank lines, which `closeDocumentWriter` removes. Verdict: redundant in practice (NC3 stays "not caught"), not proven in general; keep.
- The witness search of `witness.ts` flips ONE field of a base context, so it also tries contexts that cannot occur (`isLast=false` with `next=-1`; `next>=0` with `isLast=true`). Its "REAL" for `isLast`, `next`, `prev` therefore says only that the sandbox log depends on the field, not that the document output does. The real document witnesses are the three rows above.

Engine quirks met while building the witnesses (the normal path does the same, so the port keeps them; to be logged in `tasks/002-upstream-bugs.md` by whoever owns it): (1) a paragraph that begins with four spaces becomes a fenced code block and the output has TWO blank lines before the next block; (2) a top-level text without a trailing LF (link-ref-defs-block, footnotes) is glued to a following paragraph (`[r]: http://xpara`), because a paragraph does not call `newlineBeforeBlock`.

### 4. Missing and redefined controls

Each is a one-line break in `src/incremental/`, applied in a scratch copy only.

- **NC5.** In `sandbox.ts`, inside `runChildInner`, in `guard(child, "NextSibling", ...)`, delete the statement `record("domNext", ctx.domNext);` (keep the answer from `ctx.domNext`). Caught by: `context_channels.test.ts` pinned witness `domNext` (`readKeys.includes`); and by the document pair `[p-br]` then `[p-br, ul]` of section 3 (regression, section 6 step 3).
- **NC13 (redefined as NC13').** In `assemble.ts`, replace `closeDocumentWriter(R);` by `R.trimWriterTo(bytes.Trim(R.Writer.Bytes(), "\n")); R.WriteByte(10);`. Caught by: `dom2md_incremental.test.ts` (any corpus document ending in a footnotes block keeps the `    \n` tail). The original NC13 (trim " \t\n") is an equivalent mutant: delete it from the table and say why ("KeepParagraphBeginningSpace is false for both Vditor render option sets").
- **NC12 (redefined as NC12').** In `sandbox.ts` `coalesce`, merge equal-flag `Append`s across the barrier operations and move the `TrimSpaceAll` and `NewlineIfNotLF` operations behind them (hoist). [ran] 30,583 wrong documents WYSIWYG (8,855 strict throws) and 33,763 IR (9,516), first hit at comparison 1-2 with the OLD generator (47-52% of its comparisons). Caught by: `piece_assembly.test.ts` and `dom2md_incremental.test.ts`. The old NC12 stays in the table only as "equivalent".
- **NC14.** In `sandbox.ts` delete the `if (text.includes(GENERATED_ID))` refusal. Caught by the new unit test of section 6 step 4, not by the fuzz (IDs are fixed in the sandbox and the format renderer writes none).
- **NC15.** In `sandbox.ts`, the `LastOut` getter: `return value;` becomes `return assigned ? value : 10;`. Caught by `context_channels.test.ts` pinned witness `lastOut` (`notDeepEqual(ra.variant.ops, rb.variant.ops)`). Unit level only (proved above); the table says "unit".
- **NC1 and NC2** keep their definitions; their catching tests are the regression pairs of section 6 step 3 and the new generator.

### 5. Fuzzer generator changes

Why the controls were silent: the pool is the first 400 children (`out.length < 400`), 328 / 332 unique, with no indented-code paragraph and only link-ref blocks that end in LF; documents have 1-4 children; each edit touches one place; deletions can empty the document; none of the 7 edits is directed at a neighbour.

New generator (`nc-proto/gen.ts`, 16 edits): pool = ALL unique non-opaque children of the mode (1,307 / 1,213); three CHANNEL children in a "mixed" pick (probability `CHW`): `<p data-block="0">    indented code</p>` (isLast), `<div data-block="0" data-type="link-ref-defs-block">[r]: http://x</div>` (prev), `<p data-block="0">a<br>b</p>` (domNext); start documents of 1-5 mixed children; edits: replace, insert anywhere, delete (never empties), duplicate, swap neighbours, text edit, merge two children (the old 7) and delete last, delete first, insert at start, append at end, append after a random ul/ol/blockquote/table/code block, replace the block before a random index, replace the block after a random index, swap first and last, insert a channel child with a random neighbour.

[ran] Kill rate (percent of 2,000 comparisons whose result differs from the normal path; one engine per 8-28 edits, strict; first = index of the first kill). NEW uses `CHW = 0.12` unless noted.

| control | OLD wys / ir | NEW wys / ir |
|---|---|---|
| NC1 isLast (value; skip identical) | 0 / 0 | 20.05% first@35 / 26.05% first@35 |
| NC2 prev (value) | 0 / 0 | 3.3% first@9 / 6.45% first@9 |
| NC2 prev (skip, CHW 0.35) | 0 / 0 | 6.75% / 7.55% |
| NC4/NC5 domNext | 0.55% first@969 / 0.35% first@509 | 2.05% first@280 / 3.35% first@86 |
| NC13' trim LF only | 2.3% / 4.05% | 0.55% first@0 / 1.5% first@303 |
| NC12' hoist (CHW 0.35) | 47.4% / 52.4% | 81% / 85% |
| NC3, skip_next | 0 / 0 | 0 / 0 (expected) |

Fuzz time of the whole matrix: about 1.5 min wall on 16 cores (about 7 s CPU per 2,000 comparisons). With `CHW = 0.12` every real channel is hit at 2-26% per comparison, so 1,000 comparisons give more than 20 hits for the weakest (domNext); the old generator needed about 1,000 comparisons for ONE domNext hit and never hit isLast or prev.

### 6. Implementation steps

1. `ts/test/incremental/edit_generator.ts` (new, not a test file): move `Lcg` there and export `pool(mode)` (all unique non-opaque children of the accepted audit documents of the mode; delete the `out.length < 400` cap; use a `Set`), `CHANNEL` (the three strings above, for both modes; check once with `runChild` that each is composed, else adjust only attributes), `mixed(rng, pl)` (probability 0.12 from `CHANNEL`, else `pl`) and `step(rng, doc, pl)` = the 16 edits of `nc-proto/gen.ts` `newStep` parameterised by `rng`, `pl`. Start documents have `1 + rng.int(5)` mixed children.
2. `ts/test/incremental/edits.test.ts`: import these; keep COMPARISONS = 300 per pass and the assertions. Add per mode, after the shared pass, a count `channelHits` of documents matching `/indented code<\/p><(h\d|ul|ol|blockquote|table|p)/`, `/\[r\]: http:\/\/x<\/div><(h\d|ul|ol|blockquote|table)/` and `/a<br>b<\/p><(ul|ol|blockquote)/` (`assert.ok(count >= 5)` for each at the pinned seeds 1 and 2; if a count is lower, raise `CHW`, never lower the assertion).
3. `ts/test/e2e/root/dom2md_incremental_regressions.test.ts`: add the three witness pairs of section 3, each in both modes: one engine, `{strict: true, verify: true}`, convert D1 then D2, assert each equals the normal path and `IncrementalDom2MdStats(engine).composed === 2` (so a fallback cannot hide the test); then the reverse order on a fresh engine. These are the permanent killers of NC1, NC2, NC4, NC5.
4. `ts/test/incremental/context_channels.test.ts`: (a) NC14 unit test: patch `FormatRenderer.prototype.renderParagraph` to write `ast.NewNodeID()` first (restore in `finally`), `runChild` of `<p data-block="0">x</p>`, assert `refusal.reason === "generated-id"`. (b) Replace the REAL tests of `isFirst` and `domPrev` by an assertion that no candidate run has `readKeys` containing them (the cheap form of the proofs). (c) For every candidate and every `prev` in {-1, NodeText, NodeParagraph, NodeList}: if `readKeys` includes `lastOut` then `prev !== NodeText`.
5. `ts/experiments/dom2md-cache/negative-control.ts`: add a table `{id, file, from, to, expected}` for NC1, NC2, NC3, NC4, NC5, NC9, NC11, NC12', NC13', NC14, NC15 with the statements of section 4 (and the existing ones of the implementation table); for each, copy `src/incremental` to `$D2M_SCRATCH`, apply the one-line change, run `context_channels`, `dom2md_incremental_regressions`, `edits` with `node --test` against the copy and the 2,000-comparison fuzz (seeds 1 and 2). Pass if the outcome equals `expected` (`caught`, `equivalent` for NC3). Never write into `ts/src`.
6. The table in "Milestone B implementation" stays as history; this section supersedes its NC1, NC2, NC12, NC13, NC15 rows.

### 7. Test time

[ran] each file alone with `node --test <file>` (`duration_ms`): context_channels 5.35 s (COVERED sweep 2.14, REAL isFirst 0.75, domPrev 0.65, lastOut 0.21), dom2md_incremental 5.53 (15 option sets, 0.33-0.84 s each), piece_assembly 2.86 (WYSIWYG corpus 1.44, IR 0.71), edits 2.55 (6 tests, 0.1-0.2 s each), parser_certificate 2.44 (bodyOf 0.83, every child certified 0.63, opaque 0.31), scanner 1.62 (corpus cut 0.93), dom2md_incremental_regressions 1.31, fingerprint 0.66, barrier 0.60, adjust_passes 0.53, modes 0.50. Sum 23.95 s. Fixed cost: process start plus `auditDocuments()` (0.58 s cold, 0.27 s warm) in 7 files. `node --test` runs files in parallel processes, so the wall time is lower than the sum.

Proposal (no coverage lost; exhaustive forms move to `test:full` through `FULL` from `test/e2e/full.ts`, which reads `LUTE_TEST_FULL`):

1. `context_channels.test.ts`: COVERED sweep over every 8th candidate in the default run (about 0.3 s), all candidates under `FULL`; the isFirst/domPrev/lastOut searches are replaced by the cheap assertions of step 4(b)-(c). Saves about 3.2 s.
2. `dom2md_incremental.test.ts`: the default run executes the `default` set plus four sets that exercise different paths (`no GFM`, one render option set, `Chinese paragraph beginning space`, `callout`); the other 10 under `FULL`. Keep in the default run the fingerprint test that every set has a distinct fingerprint. Saves about 3.3 s.
3. `piece_assembly.test.ts` (a declared temporary harness): every 4th document of each corpus by default, the whole corpus under `FULL`. Saves about 2.1 s.
4. `parser_certificate.test.ts`: `bodyOf` and "every child certified" on every 4th document by default, all under `FULL` (saves about 1.5 s); `scanner.test.ts` corpus cut on every 2nd document (saves about 0.5 s).
5. Estimated sum after 1-4: about 13.3 s (23.95 - 3.2 - 3.3 - 2.1 - 2.0), about 6 s wall with file parallelism. If the budget is defined on the sum, also memoise `auditDocuments()` in a JSON file in the OS temp directory keyed by the corpus hash (saves about 2-3 s).
6. Do not shrink `edits.test.ts` (the only random coverage). Check: `node --test test/incremental/*.test.ts test/e2e/root/dom2md_incremental*.test.ts`, read `duration_ms`; stop when the sum is at most 12.5 s.

### Implementation (negative controls and fuzzer) (2026-10-11)

[ran] Test and experiment changes only; `ts/src`, Go and `javascript/` untouched. `npm run typecheck` clean. `npm test`: 4,135 tests, 4,127 pass, 0 fail, 8 skipped, 76 s (baseline 4,119 / 88 s). Incremental files alone (duration_ms): edits 5.7 s, context_channels 4.5, dom2md_incremental 4.8 (5 sets default), parser_certificate 3.5, piece_assembly 2.9, scanner 2.7, regressions 2.6, witnesses 1.2, cache 1.0 (new), barrier 1.0, adjust_passes 1.0, fingerprint 1.0.

Done: edit_generator.ts (shared by edits.test.ts and the fuzzer; CHANNEL_WEIGHT 0.2, raised from 0.12 because the channel-hit thresholds of edits.test.ts were not met); witnesses.test.ts (isLast, prev, domNext, both modes, both orders, literal normal outputs, composed === 2; placed in test/incremental/ as the coordinator asked, not in e2e); context_channels (REAL searches of isFirst/domPrev/lastOut replaced by assertions over all candidates; NC14 unit test with a non-vacuous unpatched control); sampling (scanner every 2nd document plus the 8 pinned opaque documents; parser_certificate every 4th; piece_assembly every 4th with minimum 125 (500 under FULL); dom2md_incremental 5 sets and sampled documents by default, all under test:full; fingerprint test changed to a bijection check, because "every set distinct" is false: several sets write the default value); cache.test.ts (eviction order, bound, clear, variant cap, accounting, stats arithmetic; the heap check is not implemented, no gc under node --test); engine-adapter.ts and fuzz.ts (engine by default, warm/cold/shared/evict, inconsistencies counted as mismatches, prototype behind --impl=prototype, precheck only for the prototype); negative-control.ts (table of section 6 step 5; baseline green first); README.

Negative controls, expected = observed for all 11 (with a green baseline): NC1, NC2, NC4, NC5, NC9, NC11, NC12', NC13' caught by the tests and by the fuzzer (fuzz mismatches 3842, 481, 174, 174, 2450, 4923, 6230 (+3166 inconsistencies), 13); NC3 silent (equivalent); NC14 and NC15 caught by one unit test each (context_channels), no fuzz mismatch.

Deviations and findings:
1. The evict pass is VACUOUS: with maxBytes = 256 KiB and 500 comparisons per pass and mode, the engine evicted nothing (evictions 0 in both modes, clean runs). The pass therefore does not yet exercise eviction; a smaller bound would, but the bound is not changed here. Needs a decision.
2. The engine keeps no per-miss byte counter, so "bytes probed" is not reported for the engine (would need a ts/src change).
3. NC9 is caught by the engine tests and fuzz; repro/run.ts tests the prototype only, so it is not evidence for the engine.
4. The NC prototype controls of the spike (constsep, no-next-bit, ...) are removed from negative-control.ts, not kept behind --impl=prototype.
5. Fuzz generator: the old edit kinds (first-ws, trimmers, targeted, junk, split, move, restyle) are gone; the R1 whitespace class is covered by the regression list only.

## Milestone C analysis: cold call and fallback cost (2026-10-11)

Status: **analysis plus a scratch prototype; nothing under `ts/src`, `ts/test`, the Go sources or `javascript/` was changed.** All scratch code is in `ts/experiments/dom2md-cache/cold-proto/` (list at the end). Labels: **[ran]** measured or executed in this session, **[code]** read from the source, **[inferred]** reasoning or a number computed from measured numbers, **[derived]** arithmetic on measured numbers.

Measurement conditions: the machine was shared with another agent's test runs for most of the session (the same `normal` call varied between 28 and 58 ms for WYSIWYG, between 46 and 234 ms for IR). Everything below is "fastest of N" and, where it matters, a ratio inside one process. Absolute milliseconds are rough; ratios are the result. The spec document is the CommonMark spec as WYSIWYG DOM (515 KB, 1,413 top-level children) and as IR DOM (795 KB, 1,413 children), generated by the oracle with the "vditor" option set of `corpus.ts`.

### 0. Result in one table

| question | answer |
|---|---|
| Where does the cold time go? | Not in the parser or the passes. 35 percent of the WYSIWYG cold call is **reruns** (762 of 2,159 sandbox runs re-do parse, passes and genAST because the first run used a provisional context), about 30 percent is **building one renderer per run** (`render-setup`), and the **accessors** (`Object.defineProperty` on AST and DOM nodes) roughly double the cost of every other phase because they turn the nodes into dictionary-mode objects [ran, `fastprops.ts`]. In IR, 99 percent of the cold call is thrown away: the loop keeps running all 1,396 other children after `tip-open` was found. |
| Cheap cold call | Candidate (b), prototyped: no accessors (neighbours are linked as plain stubs), a context key that always holds the whole tuple (no read recording), three phases (analyse, build, render) so that no child is run twice. Cold WYSIWYG **1.8 to 2.2 times the normal path instead of 3.7 to 4.6 times** [ran, in-process interleaved, 5 runs]; first call in a fresh process 190 to 208 ms against 327 to 376 ms (normal path: 105 to 136 ms) [ran, 3 processes each]. Output equal to the normal path on 2,579 audit documents x 3 sweeps and on 9,500 edited documents (7,023 composed), 0 mismatches [ran]. Warm one-character edit: no regression (4.6 against 6.0 ms, inside the run spread 4.3 to 7.5). |
| Not recommended | (a) populate from a whole-document run: cheapest (about 1.25x, inferred) but loses the barrier, so the cache would be correct by analysis, not by construction. (c) lazy first call: 1.1x on call 1, but call 2 pays the full fill, and the first two calls together cost more (3.0 against 2.0 normal units). |
| Early exit | Reorder the work (section 5): known refusals before any run, opaque children first, list coupling after the analyse phase and before any genAST, `tip-open` after the build phase of the offending child, stop at the first refusal. A new negative memo makes a repeated fallback cost about 0.01 ms above the normal path. |
| `tip-open` | The tip is shared builder state that, once left open, never closes in the rest of the document (spec IR: opens at child 17, stays open for the remaining 1,396 children, 18 top-level AST nodes for 1,413 children). A generic treatment exists (the tip in the state vector) but it only yields a prefix cache, which is nothing for this document. Fixing upstream item 64 is the real fix. Section 6. |

### 1. Phase breakdown of the current implementation [ran]

Method: `mktimed.mjs` copies `sandbox.ts` and `assemble.ts` to `sandbox_timed.ts` / `assemble_timed.ts` with `performance.now()` laps between the phases, `phases.ts` runs `tryDom2Md` on a fresh `State` 12 times and keeps the fastest run (so the timer overhead, about 2 to 3 ms, is included). The "inner" table is summed over all sandbox runs of that call. Percentages are of the cold `tryDom2Md` total.

**WYSIWYG, cold `tryDom2Md` 125.6 ms** (normal path in the same session 30 to 35 ms; 2,159 sandbox runs for 1,413 children, 1,397 distinct strings)

| phase (assemble) | ms | % |
|---|---:|---:|
| fingerprint | 0.0 | 0.0 |
| preprocess (caret, white space) | 0.9 | 0.8 |
| scan | 0.9 | 0.7 |
| lookup and `newEntry` (flat copy of every new key) | 1.8 | 1.4 |
| first runs (provisional context), wall | 74.1 | 59.0 |
| list-coupling skeleton | 0.7 | 0.5 |
| sweeps | 0.1 | 0.1 |
| replay | 2.5 | 2.0 |
| **second runs (context reruns), wall** | **43.9** | **35.0** |
| document close | 0.2 | 0.2 |

| phase (inside `runChild`, all 2,159 runs) | ms | % of cold total |
|---|---:|---:|
| parse with certificate (first runs) | 15.3 | 12.2 |
| certificate check | 0.5 | 0.4 |
| parse plain (reruns) | 11.5 | 9.2 |
| barrier setup of the DOM (4 accessors) | 3.0 | 2.4 |
| DOM passes 1 to 3 | 2.4 | 1.9 |
| DOM passes 4 to 15 | 8.0 | 6.4 |
| genAST | 12.8 | 10.2 |
| adjustTree | 7.8 | 6.2 |
| **render setup** (renderer + 80 bound functions + options + LastOut accessor + 4 AST accessors) | **35.8** | **28.5** |
| render (recording) | 17.0 | 13.5 |
| coalesce and text scan | 3.4 | 2.7 |
| sum | 117.4 | 93.5 |

**IR, cold `tryDom2Md` 133.7 ms** (normal path 46 to 50 ms; 1,397 sandbox runs, all first runs; the call ends in a fallback)

| phase | ms | % |
|---|---:|---:|
| preprocess | 1.7 | 1.3 |
| scan | 2.4 | 1.8 |
| lookup and `newEntry` | 3.7 | 2.7 |
| **first runs, wall** | **125.3** | **93.7** |
| of which parse with certificate | 31.0 | 23.2 |
| of which certificate check | 0.8 | 0.6 |
| of which accessor setup | 2.9 | 2.1 |
| of which DOM passes 1 to 3 / 4 to 15 | 4.7 / 12.5 | 3.5 / 9.3 |
| of which genAST / adjustTree | 14.2 / 1.9 | 10.6 / 1.4 |
| of which render setup | 41.9 | 31.3 |
| of which render / post | 12.0 / 2.8 | 9.0 / 2.1 |
| list coupling, sweeps, replay | not reached | 0 |

One child (number 17, an indented code block) ends with `tip-open`; the loop in `assemble.ts` line 118 to 147 (`continue` after an unsupported refusal) runs the other 1,396 children to completion, renders them, and the call then returns the refusal. The cold IR call is therefore 2.8 times the normal path and 99 percent of it is wasted.

**The normal path for comparison** [ran, `normal_phases.ts`, fastest of 15]: WYSIWYG preprocess 0.9, `util.ParseHTML` 11.2, `adjustVditorDOM` 4.2, genAST + adjustTree 5.3, render 3.3 (sum 24.9 of a 30.5 ms call); IR 1.3, 20.1, 8.4, 9.9, 3.0 (of 45.8). Parsing child strings one by one costs the same as parsing the whole string (13.3 against 13.0 ms for 1,413 children, 14.6 ms with the certificate hook) [ran, `parse_cost.ts`]. The whole-document render is 3.3 ms; the per-child recording renders cost 17 ms plus 36 ms of setup. That is where the factor goes.

**Three different "cold" numbers, not to be confused** [ran]

| call | normal path | current cache | prototype (section 3) |
|---|---:|---:|---:|
| first conversion in a fresh process (includes JIT warm-up), WYSIWYG 515 KB, 3 processes each | 105, 109, 136 ms | 327, 337, 376 ms | 189, 195, 208 ms |
| first conversion with an empty cache in a warm process (fastest of 8 to 14, interleaved) | 28 to 35 ms | 125 to 131 ms (170 to 270 under load) | 55 to 64 ms (91 to 106 under load) |
| ratio to the normal path, same process | 1.0 | 3.7 to 4.6 | 1.8 to 2.2 |
| warm one-character edit (spec, fastest of 14) | 31 ms | 6.0 ms | 4.6 ms |

The coordinator's "256 ms against 33 ms" compares a first call in a process with a warm normal call; the like-for-like comparison is 327 to 376 against 105 to 136. Break-even [derived]: current cache needs (128 - 32) / (32 - 6) = 3.7, so about 4 warm calls before it has paid for its cold call; the prototype needs (60 - 32) / (32 - 4.6) = 1.0, so about 1.

**The IR fallback, warm** [ran, `fallback_cost.ts`, one paragraph edited per call, fastest of 14]: normal path 48.6 ms; current cache falling back 52.7 ms (so +4 ms: scan, lookup, a second preprocess; the edited child is also run through the sandbox once, 0.1 to 0.2 ms); an unchanged second call: 58.6 against 49.8 ms (+9 ms). The coordinator measured 163 against 143 ms, +20 ms, in another run of the same scenario. I could not reproduce +20; the likely extra is the effect of section 2.2 on the normal path (accessor pollution makes the following normal calls slower, intermittently) plus timing drift. Both figures are reported; neither is hidden.

### 2. Findings behind the numbers

#### 2.1 Reruns [ran, code]

`assemble.ts` line 124 runs each new child with `PROVISIONAL` (an isolated document), and line 228 runs it again with the real context whenever the first variant does not match. 40 percent of the children read `isLast` or `prev` (spec 5.1), so 762 of 2,159 runs (35 percent of the wall time) repeat parse, passes, genAST and adjustTree. The information needed for the real context (the neighbours' atoms and AST node types) is produced by the first run of the neighbours, so a three-phase order removes the reruns without changing what is computed (section 3).

#### 2.2 Accessors: cost and pollution [ran]

`barrier.ts guard()` uses `Object.defineProperty(obj, field, {get, set})` on a field that is a plain data property. In V8 this reconfigures the object into dictionary mode: `%HasFastProperties` is true for a fresh `ast.Node` and `html.Node` and **false after one `guardAst`/`guard`**, and stays true when a Proxy stub is assigned to the field instead [ran, `fastprops.ts`, `node --allow-natives-syntax`].

Effects:
- Cold sandbox cost. Interleaved variants in one process (`variants.ts`; noisy, +-20 ms): baseline 172.7 ms; no DOM accessors 151.8; no AST accessors and no `LastOut` accessor 92.7; no accessors at all 86.4. So the AST accessors cost about 45 percent of the cold call and the DOM accessors about 10 percent.
- Pollution of the normal path. After 10 cold sandbox calls in the same process, the **normal** `vditorDOM2Md` of the same document is slower: CPU-time ratio after / before in fresh processes (`pollute4.ts`, `pollute6.ts`): current cache **14 of 14 runs above 1.2** (range 1.26 to 3.52, median 2.3); wall-clock repeats gave 8 of 8 above 1.2 (1.81 to 2.87; one earlier run 1.03) and the earlier matrix gave 2.8 twice for the current guards against 1.0 for no guards. Which guard is responsible was only run once per variant (`pollute2.ts`: DOM-only 2.8, AST-only 2.4, `LastOut`-only 0.9; unrepeated, outliers up to 321 ms in a loaded batch), so treat the attribution as indicative. This is the same engine object: a user who enables the cache pays for it in the fallback path too.
- Prototype without accessors: three quiet runs gave 1.06, 0.95, 1.01; later runs under heavy load gave 1 of 6 above 1.2 (CPU time) and 7 of 8 above 1.2 (CPU time, loaded), and the control (normal path only, no sandbox) also drifted 1.7 to 2.9 in wall-clock repeats. **The pollution test is not conclusive for the prototype on this machine**; it must be repeated on a quiet machine (stop condition in section 7).

#### 2.3 Renderer setup [ran]

`newSandboxRenderer` = `FormatRenderer` constructor + `registerFormatRendererFuncs` (80 `.bind` closures) = 4.6 us in a hot loop [ran, `micro.ts`], plus `adapter.renderOptions()` (2.5 us), plus the accessors; 16 us per run in the cold call, 35.8 ms of 125.6. Experiment: reuse one renderer for all children (unsound by construction: it shares mutable state, so it is a measurement, not a candidate): phase `render-setup` fell from 15 to 2 ms in the prototype, the total changed by -4 percent in a quiet run (57.9 against 55.3 ms: within noise), and by -22 to -25 percent in loaded runs (66.8 against 90.7; 73.8 against 95.6). **Inconclusive, at most 0.3x of the normal path; do not reuse a renderer.** The by-construction alternative is optional step C4.

#### 2.4 Other [code, ran]

- `domStub(ctx.domPrev, 0)` (`sandbox.ts` line 204) answers `Attr` of the previous sibling with an empty array: a read of `PrevSibling.Attr.length` would be silently wrong instead of raising `BarrierViolation`. Whether anything reads it is unknown, because the stub answers instead of throwing (the corpus raises no violation); it breaks "undeclared reads throw". The prototype keeps the same stub; the implementation should make the previous-sibling stub throw on `Attr` (step C1).
- `generated-id` is decided by a byte search for the fixed test ID in the output. The "article" fixture of `bench.ts` (prose from `tasks/`) is refused with `generated-id` because `tasks/004` quotes the ID in its S15 row [ran, `gid.ts`]. The property that matters is "`ast.NewNodeID` was called"; a call counter would be exact and would not depend on content, but it is a one-line edit in the default path (`ast/`), so it is the owner's decision (step C6). No warm number is reported for the article document.
- Shared `Options` per call (instead of one `vditorDOM2MdRenderOptions()` per run): no assignment to `Options` fields exists in the format renderer [code, grep]; saves about 2.5 us x 2,159 = 5 ms [derived]. The prototype shares it.

### 3. Candidates

| | cold WYSIWYG (x normal) | cold IR spec | warm effect | soundness | code size |
|---|---|---|---|---|---|
| **current** | 3.7 to 4.6 [ran] | 2.8x, 99 percent wasted [ran] | 6.0 ms | by construction (fresh DOM, tree, renderer per child; barrier) | 667 lines (`sandbox.ts` 382 + `assemble.ts` 285) |
| **(a) by-product of one whole-document run** | about 1.25 [inferred: normal + RenderWithLogs overhead 3.4 ms + hook 0.4 ms (`a_cost.ts`: render 3.5 -> 6.9, parse 11.2 -> 11.6) + scan/lookup 3 ms + bookkeeping] | about 1.1 | unchanged | **by analysis only**: no fresh state per child, so the channel table of milestone B must be complete; no barrier (neighbours are real nodes); negative controls NC1, NC2, NC12 were silent, which shows how little the tests exercise some channels | +200 lines and a callback in `vditorDOM2MdBuildTree` (default path) |
| **(b) per-child path, fixed costs removed** (prototype) | **1.8 to 2.2** [ran] | **0.6 (exit after child 17) + the normal path** [ran] | 4.6 ms (no regression) | by construction, kept: fresh DOM, tree, renderer per child; stubs throw on undeclared fields; key is a superset of the reads | prototype 271 lines for the whole of sandbox + assemble logic (it omits cache accounting, strict, fingerprint); expected net size of the real code: about -60 lines in `sandbox.ts`/`barrier.ts`, +80 in `assemble.ts` |
| (b4) lazy `RendererFuncs` (optional, inside (b)) | up to -0.3 [ran bound, inconclusive] | n/a | none | by construction (table derived from `registerFormatRendererFuncs`) | +25 lines |
| (b5) one parse of the whole string, children detached (in-situ certificate) | about -0.2 [inferred: parse is 11 to 15 ms of 60] | | none | needs Claim L in the other direction (already verified on the corpus) | +100 lines; not recommended now |
| **(c) lazy first call** | 1.1 on call 1 (normal + scan + lookup: 3 ms WYSIWYG, 6 ms IR [ran]) | 1.1 | the fill moves to call 2: 1.8 to 2.2 there | unchanged (same sandbox) | +40 lines, plus a policy; windowed fill needs margins (analyse +-2, build +-1 children) and about +150 lines |

**(a) in detail: what is missing for a whole-document run to produce a cache entry.** The recording renderer (`RenderWithLogs`) already gives one log per top-level AST node. Missing: (1) a map from DOM children to AST top nodes (count the `Root` children before and after each `genASTByVditorDOM` call; needs a hook in `vditorDOM2MdBuildTree`); (2) the parser certificate per child in situ: snapshots at the scanner's cut offsets (a token must end exactly at each cut, the projected state there must equal `REF`, the body must have grown by exactly one element); (3) the context tuple, which can be computed after the fact from the same sweeps as in `assemble.ts`; (4) the **barrier**, which is the real gap: in a whole run the neighbours are real objects, so "the child read only the declared fields" cannot be enforced without accessors (which pollute, section 2.2) or stubs (which change what the engine sees); (5) isolation of hidden state: the renderer and the tree are shared between children, so any field not in the channel table leaks into a log; the sandbox excludes this by construction. (a) is rejected because of (4) and (5), not because of cost. It remains useful as a **test oracle**: in `verify` mode the in-situ per-child logs can be compared with the sandbox logs, which would catch an incomplete channel table.

**(c) numbers** [derived from section 1]: the first two calls of a document cost 1.1 + 2.0 = 3.1 normal units with (c) and 2.0 + 0.15 = 2.15 without; (c) wins only for a caller that converts a document exactly once, which is not the use case of an opt-in cache. A window-limited fill (spread the 28 ms over about 10 calls) removes the spike but needs neighbour margins; I do not recommend building it before (b).

### 4. The prototype [ran]

`cold-proto/fast.ts` (271 lines), driven by `fast_check.ts`, `fast_fuzz.ts`, `fast_time.ts`, `warm.ts`, `final_cold.ts`.

What it changes with respect to `src/incremental/`:
1. **No accessors.** The DOM neighbours are linked once, after the three scanning passes: `child.PrevSibling = domStub(prevAtom, 0)`, `child.NextSibling = domStub(nextAtom, nextAttrs)`, and `root.FirstChild` / `root.LastChild` become `barrierStub` when a neighbour exists. After genAST and `adjustTree`, the AST neighbours: `first.Previous = astStub(prev)`, `last.Next = astStub(next)`, `tree.Root.FirstChild/LastChild = barrierStub`. These are plain assignments; the nodes keep fast properties. A stub still throws `BarrierViolation` for any undeclared field.
2. **Always-key.** The variant key is the whole tuple `lastOut, prev, next, domPrev, domNext, domNextAttrs` (as a string); there is no read recording, no `LastOut` accessor and no `LASTOUT_PASS`: `endLastOut` is `r.LastOut` at the end, and the replay assigns it. `isFirst` and `isLast` are not in the key because `assemble.ts` derives them from the same sweeps as `prev < 0` and `next < 0` (invariant I1). Soundness argument: the run is a function of (html, options, tuple) because the tuple is the only thing the stubs expose and the stubs throw on anything else, so equal tuples give equal logs; a key that is a superset of the reads is sound, the only price is more variants. Measured price: after the audit sweeps 1.09 variants per entry, 5 percent of the entries have more than one (distribution WYSIWYG: 1 -> 1,385, 2 -> 44, 3 -> 14, 4 -> 3, 5 -> 6, 7 -> 1, 8 -> 2) [ran].
3. **Three phases.** A analyse (parse with certificate, passes 1 to 3: gives `alive`, `atom`, `attrs`); the list-coupling skeleton runs on these before any genAST; B build (passes 4 to 15 and genAST with the DOM context known, adjustTree: gives `topTypes` and `tip-open`); C render once with the real AST context and replay. The handle (DOM root, tree, tops) lives in a local array of the call and is dropped after the child's replay (invariant I3: no handle in `State` or `Entry`). A child that is cached but has no variant for the actual key is run in full (A, B, C) with the exact context and its info is compared (`sameInfo`; the prototype omits the comparison, the implementation must keep `info-changed`).
4. One `Options` object per call.

What the prototype omits and the implementation must keep: fingerprint and option clearing, byte accounting and eviction, `too-large`, strict / verify / sandwich, the dispatch registry and stats, the `info-changed` comparison on reruns, the classification of exceptions, and inconsistency handling (the prototype stores `"inconsistency:cert"` in an entry, which section 6 of the specification forbids: inconsistencies are never cached).

Evidence:
- **Equality, audit population** (`fast_check.ts`, the 2,789 documents of `test/incremental/corpus_docs.ts`, one shared cache per mode, 3 sweeps, compared with the normal path without its preprocess stage, because the preprocess is not idempotent: `"    \n"` -> `"  \n"` twice shortens a run of spaces twice): composed 2,579, fallbacks 210, **0 mismatches**. Fallback reasons match the engine's own: `tip-open` 56, `cert:opaque-preview` 22, `list-coupling` 4, `engine-threw` 6, scan reasons 122.
- **Edit fuzz** (`fast_fuzz.ts`: delete, duplicate, swap, insert, text edit, `<br>` edit of top-level children of the audit documents, shared cache and fresh cache for each document): seeds 1, 2, 3 with 1,500 + 4,000 + 4,000 edited documents, composed 7,023, **0 mismatches** with the shared cache and **0** with a fresh cache.
- **Warm** (`warm.ts`, spec WYSIWYG, one paragraph edited with a never-seen character, fastest of 14): prototype 4.60 ms, current 6.04 ms, normal 31.1 ms. The 1.4 ms difference is inside the spread of repeated runs (4.3 to 7.5 ms): **no regression**, not "faster". IR spec cannot be timed warm (`tip-open`).
- **First call in a fresh process**, cold in a warm process, pollution: section 1 and 2.2.

### 5. Early exit: which fallback is knowable when

| reason | knowable after | today | proposed order |
|---|---|---|---|
| `options-not-fingerprintable` | the fingerprint (20 us) | first | unchanged |
| negative memo hit (section 6) | preprocess + `String.includes` (below 1 ms) | not present | before the scan |
| `empty-document`, `scan:*` | the scan, which stops at the first violation (0.9 ms WYSIWYG, 2.4 ms IR for the full string) | after preprocess | unchanged |
| entry refusals already stored (`cert:opaque-preview`, `tip-open`, `generated-id`, `engine-threw`) | the lookup (1.8 to 3.7 ms: hashing the keys) | misses are **run first**, refusals read afterwards (`assemble.ts` 118 to 154) | return at the first stored refusal before running any miss |
| `cert:opaque-preview` for a new child | parse of that child only: only `opaque` children can be refused as unsupported (a non-opaque refusal is an inconsistency) | in document order, after which the loop continues | analyse the opaque entries first, return at the first refusal |
| `list-coupling` | analyse phase of all new children (parse and passes 1 to 3: `alive`, `atom`, `attrs` are enough; about a third of the cold prototype call) | after all runs (10 times the work) | right after phase A, before any genAST |
| `tip-open` | build phase of the offending child | after all runs | stop at the first child in document order (phase B in document order) |
| `generated-id` | render of the child (byte search) | same | same (step C6 for an exact test) |
| `engine-threw` | anywhere | continues | stop and store |
| `too-large` | lookup (bytes accounting) | same | same |

The worst case for a document that will fall back (offending child last, nothing cached) is phase A for all children plus phase B for all: about 30 ms for the spec WYSIWYG size, 1.0 times the normal path, **once** per distinct offending child string, because the refusal is stored in the entry and the memo of section 6 skips everything afterwards. For the IR spec document the prototype stops at child 17: 30 ms for the whole `compose` call (A for all children 23 ms, B up to the offender) instead of 134 ms today. `tip-open` cannot be known earlier without a predicate on the construct (excluded by the requirement); a pipelined A/B (build child i as soon as child i+1 is analysed) would make the cost proportional to the offender's position; it is not worth the complexity because the cost is paid once.

### 6. `tip-open`, in detail, and the negative memo

#### 6.1 Why the whole call must fall back today [code, ran]

IR `genASTByVditorIRDOM` (`vditor_ir.ts` lines 257 to 267): for a `div` with `data-type` `code-block` or `math-block` whose first child has no `-block-open-marker` in its `data-type` (an indented code block has no fence marker), it creates a paragraph `p`, appends it to `tree.Context.Tip`, sets `tree.Context.Tip = p` and returns without restoring the tip. Every builder appends its nodes to `Tip` and restores `Tip` on exit to what it was on entry; here the entry value is lost, so `Tip` stays inside `p`. [ran, `tip.ts`, spec IR]: the tip first opens after child 17, is still open after each of the remaining 1,396 children, and the finished tree has **18 top-level nodes for 1,413 children** (everything after child 17 nests in its paragraph). On the oracle the effect is visible in the round trip [ran, `oracle64.ts`, minimal document `# a`, indented code, paragraph, heading, list]: `VditorIRDOM2Md` gives `# a\n\nindented code\nparagraph after\n\n## b\n\n- item\n` on the oracle and on the port: the indentation and the blank line are lost. This confirms upstream item 64 on the oracle (the "not yet confirmed" in `tasks/002` can be updated).

For the cache this is a violation of the quiescence the piece model assumes: the sandbox gives each child a fresh tree whose tip is the root, which is what the next child would see only if the tip were the root at the boundary. With an open tip, the log of child k+1 is not a function of (child k+1, context): it depends on child k's tip, and child k's own paragraph contains all later nodes. `S5` of the specification put this in the table as a fallback by property (`Tip !== Root` after genAST); the property is exactly "builder state at the boundary is not the initial state".

#### 6.2 Generic treatments that follow from the property (not built) [inferred]

- **T1, absorbing suffix piece.** Make the unit a run of children that ends where the tip is the root again (or at the end of the document): the prefix composes from the cache, the suffix is one piece keyed by its whole string and run by the sandbox on a multi-child DOM. Sound by construction (at the end of a piece the builder state equals the initial state, which is what a fresh sandbox has). Gain: edits in the prefix hit the cache, an unchanged suffix hits. For the spec IR document the prefix is 17 of 1,413 children and the suffix is 99 percent of the text, so a typical edit re-runs 99 percent of the document through a path as slow as the normal path. Needs a multi-child driver, first/last atoms in `ChildInfo` for the coupling skeleton, and a multi-child certificate. About +150 lines.
- **T2, the open chain in the state vector.** The key gets the types of the nodes from the root to the tip at entry; the sandbox builds the child under a stub chain; the logs of the nested children are attributed to a position inside the opener's output; the opener's exit operations move to the document close. This lets the suffix children be cached individually. It reopens the channel analysis for every read through `Parent` (list tightness, `isLastNode`, trims) and needs its own negative controls: +300 lines and a new risk surface, for a bug that has a one-line fix.
- Neither is recommended. T1 is the minimum honest improvement if documents with an open tip must not pay the cold fallback cost forever, and the negative memo already gives that (section 6.3).

#### 6.3 What fixing upstream item 64 would change [inferred]

After a fix that restores the tip (for example by not changing `Tip` after appending the paragraph, or by restoring the previous tip), no child of the spec document leaves the tip open: `tip-open` stops firing, the IR document composes, and its warm one-edit cost should fall from the normal path (about 143 to 163 ms in the coordinator's runs) to the WYSIWYG-like 5 to 6 ms (not measured: needs the fix). The normal path's output changes for such documents (indentation and blank line restored), so the fix must be made in the Go source, the oracle bundle rebuilt and the port changed together (the port keeps Go behaviour by repository rule), and every test that pins the old output updated. The `tip-open` refusal stays as a property check. This is the owner's decision; it is also the only change that makes IR documents with indented code benefit from the cache.

#### 6.4 Negative memo: do not re-pay a stable fallback

Per-child refusals are already stored in the entry (`Entry.refusal`), so a repeated call does not re-run those children; what it still pays is scan + lookup + preprocess (+4 to +9 ms for IR) and, today, a sandbox run of the edited child. Add a **document-level memo** in `State`:

- What it holds: a reference to the `Entry` whose stored refusal ended the last call, but only for refusals that are **deterministic functions of the child string and the options**: `cert:opaque-preview`, `tip-open`, `generated-id`, `engine-threw`. Not `list-coupling` (depends on the neighbour), not `scan:*` (document level; the scan is cheap and stops early), not `too-large`, not any inconsistency (spec section 6: never cached).
- Use: after the fingerprint check and the preprocess, `if (memo !== null && h.includes(memo.html))` count the stored reason, count `memoHits`, return the fallback. Cost: one `String.includes` (below 1 ms for 800 KB; the whole `compose` call measured 0.01 ms with the memo against 2.98 ms without) [ran, `fallback_cost.ts`]. The caller then runs the normal path: 51.4 ms against 48.6 ms for the normal path alone (inside the noise: the memo itself costs 0.01 ms).
- Why it is sound: a fallback is always correct; the memo can only turn a would-be composition into a fallback. It is imprecise in one direction (the memo string may still occur in the document without being a top-level child, for example inside an attribute value) so a **re-probe**: every 32nd memo hit skips the memo and runs the full path, which refreshes or clears it.
- Invalidation: set to `null` when the fingerprint changes, when `maps.clear()` or the eviction clear runs, on `DisableIncrementalDom2Md`, and when a call composes. An edit inside the offending child creates a new entry; the memo string is gone from `h`, the full path runs (scan + lookup + one analyse/build of the edited child + early exit, about 3 ms) and sets the memo again.
- Cost profile after the change [ran/derived]: first call with an offender anywhere: normal + up to 1.0x once; every later call: normal + 0.01 ms (offender untouched) or + 3 ms (offender edited).

### 7. Recommendation and implementation steps

**Recommendation:** build (b) (steps C1 to C3), keep (a) only as a future test oracle, do not build (c) or T1/T2, hand item 64 and the `NewNodeID` counter to the owner (C5, C6).

Steps, in order; after each step `npm run typecheck` and the milestone B suites must be unchanged (`test/incremental/*`, `test/e2e/root/dom2md_incremental*.test.ts`); do not run `npm run test:full`.

**C1. Barrier without accessors, key without reads** (`piece.ts`, `barrier.ts`, `sandbox.ts`, `assemble.ts`, `cache.ts`).
- `piece.ts`: delete `ReadKey`, `Variant.readKeys/readVals`, `LASTOUT_PASS`; `Variant = { key: string; ops: RootOp[]; endLastOut: number; bytes: number }`; `Context` loses `isFirst/isLast`; add `export function contextKey(c: Context): string` returning `lastOut,prev,next,domPrev,domNext,domNextAttrs`. Keep `MAX_VARIANTS = 8`.
- `barrier.ts`: delete `guard` and `guardAst`; `domStub(atom: number, attrs: number | null)`: `Attr` returns the dummy array only when `attrs !== null`, otherwise throws `BarrierViolation("dom.prev.Attr")`; the previous-sibling stub is built with `null`.
- `sandbox.ts`: replace the DOM guards by `linkDom(root, child, ctx)` called after pass 3 (before pass 4) and `linkAst(tree, tops, ctx)` called after the `tops` are collected; both plain assignments as in `fast.ts`. Delete the `LastOut` accessor: `r.LastOut = ctx.lastOut`, `endLastOut = r.LastOut`. Check after passes 4 to 15 that `root.FirstChild`, `root.LastChild`, `child.PrevSibling`, `child.NextSibling` are identical to what was installed, else `sibling-structure-changed`.
- `assemble.ts`: variant lookup by `contextKey(ctx)` (a `Map<string, Variant>` per entry, or linear over at most 8); `isFirst`/`isLast` derived (invariant I1 below).
- Invariants: **I1** `isFirst === (prev < 0)` and `isLast === (next < 0)` in every context the assembler builds, because both come from the same sweeps; **I2** a stub exposes exactly the fields of its key and throws on any other read or write; **I3** no DOM node, AST node, renderer or handle is stored in `State` or `Entry`; **I4** the key contains every context field the stubs expose (a field added to `Context` must be added to `contextKey`, a test enumerates `Object.keys(Context)`).
- Tests (new `test/incremental/context_key.test.ts`; adapt `barrier.test.ts` and `context_channels.test.ts`): I1 over the audit population; I2: reading `PrevSibling.Attr` throws, reading `NextSibling.DataAtom` does not, a write to a stub throws; I4; same key => deep-equal ops when a child is run twice; the COVERED test of `context_channels.test.ts` (no `BarrierViolation` for any single-field change of 1,773 candidates x 7 fields) stays; the REAL witness test now asserts only that the keys differ and the logs differ for the pinned witnesses. Remove the tests of `guard`.
- Stop: any mismatch in the audit or the edit tests; a `BarrierViolation` on the corpus; cold WYSIWYG not below 2.5x the normal path (interleaved `final_cold.ts`) after C1 and C2 together; the pollution check (below) above 1.2 in more than one of six quiet CPU-time runs.

**C2. Three phases and early exit** (`sandbox.ts`: export `analyse`, `build`, `render` as in `fast.ts`, keep `runChild` as their composition for the rerun path; `assemble.ts`).
- Order of one call: fingerprint; preprocess; memo (C3); scan; lookup; return at the first stored refusal (a pre-pass over `entries`); analyse the new opaque entries first, then the other new entries in document order, stopping at the first refusal (child-local deterministic ones are stored in the entry, inconsistencies remove the entry as today); `listCoupling` on `{alive, atom, attrs}` of all entries; DOM sweeps; build the new entries in document order, stopping at `tip-open`; AST sweeps; for each alive child: variant by key, on a miss render from the handle (new child) or run in full with the exact context and compare `sameInfo` (inconsistency `info-changed`); replay; close.
- `ChildInfo` is stored only after build (never a partial info). A dead child (`removeEmptyNodes`) gets `{alive: false}` in phase A.
- Strict mode: sandwich per newly certified child as today, at the end of phase A. `verify` unchanged.
- Stats: keep `sandboxRuns`, `misses`; add `analyses`, `builds`, `renders` (needed by the order tests).
- Tests (new `test/incremental/phase_order.test.ts`, counting calls by wrapping `lute.genASTByVditorDOM` and `lute.genASTByVditorIRDOM` on the engine instance): (i) a document with one opaque child that the certificate refuses and 100 clean children: builds and renders of the clean children are 0; (ii) a document with a list-coupling pair: builds 0; (iii) 50 children with an open tip at child 3: builds <= 4, renders 0; (iv) a warm document with an unchanged tail: analyses 0 for unchanged children; (v) no child is analysed or built twice in one call (counts equal the number of distinct new strings).
- Stop: cold WYSIWYG above 2.5x normal; warm one-edit above 1.2x of the pre-change cost (interleaved, fastest of 14); any new inconsistency count in `dom2md_incremental.test.ts`.

**C3. Negative memo** (`cache.ts` `State.memo`, `assemble.ts`, `index.ts` stats `memoHits`). As in 6.4. Tests (new `test/incremental/negative_memo.test.ts`): (i) IR document with an indented code block: call 1 falls back `tip-open`, call 2 with an edit elsewhere has `memoHits` 1 and `sandboxRuns` unchanged; (ii) remove the offending child: the call composes and the memo is null; (iii) edit inside the offending child: no memo hit, `tip-open` again, memo set to the new entry; (iv) no memo is set for `list-coupling`, `scan:*`, `too-large`, or an inconsistency (inject one with the existing barrier-violation hook); (v) a fingerprint change clears it; (vi) the 32nd hit re-probes (assert by call counts); (vii) output of every call, memo or not, equals the normal path.
- Stop: any call whose output differs from the normal path; `memoHits` growing while the offending string is not in the document.

**C4. Optional: lazy renderer function table for `SandboxRenderer`.** Build once, from `registerFormatRendererFuncs` applied to a spy object whose `renderX` getters return a recorder with `bind`, a table `NodeType -> method name`; `SandboxRenderer.RendererFuncs` is a `Map` subclass whose `get` binds on first use per instance. Keep only if an interleaved cold benchmark shows at least 10 percent and the audit equality still holds; otherwise drop. Do not share a renderer between children.

**C5. Quiet-machine measurement (gate for C1 to C3, owner's machine).** (1) `final_cold.ts` 14 repetitions x 3, cold WYSIWYG at most 2.5x normal; (2) pollution: `pollute4.ts` run 8 times per variant (`src`, `fast`, `ctl`) on a quiet machine: report the count above 1.2; require 0 for `ctl` and at most 1 for the new code; (3) `first.ts` three processes. Without a quiet machine the pollution result of this section stays open.

**C6. Owner decisions (not for the implementer).** (i) Fix upstream item 64 in Go and TS together (6.3) and rebuild the oracle. (ii) Replace the content search for the fixed ID by a counter of `ast.NewNodeID` calls under `SetTesting` (default path, one line); until then a document that quotes the ID is refused as `generated-id` (observed: `tasks/004` itself). (iii) Whether the first call of a document should use the lazy policy (c) as an option.

### 8. Open risks

- The pollution of the normal path by the prototype is **not shown to be absent** (section 2.2): the machine was too loaded; the mechanism (fast properties kept) is shown, the timing is not.
- Always-key gives more variants than read recording in principle; measured 1.09 per entry on the audit population, not measured on long editing sessions. `MAX_VARIANTS` bounds the memory.
- The prototype was exercised on the audit population and a child-level edit fuzz, not on the milestone B generator with throws, options toggling and eviction; the implementation must pass those suites.
- Warm numbers: no regression claimed; IR could not be timed warm because of `tip-open`.
- The negative memo keeps a reference to one entry and uses `String.includes` on every call while it is set; with a very large document and a tiny memo string that is a sub-millisecond search; a memo string that is itself huge (a giant offending child) still costs one search of the same size as the scan.
- First-call JIT cost remains: 190 to 208 ms against 105 to 136 ms for the normal path in a fresh process (the larger code footprint of the cache path); not addressed.

### 9. Scratch files (`ts/experiments/dom2md-cache/cold-proto/`)

Fixtures: `OUT=<dir> node mkfix.ts` writes `spec.wysiwyg.html` and `spec.ir.html`; all other scripts read `FIX=<dir>`. `phases.ts` (+ generated `mktimed.mjs`, `sandbox_timed.ts`, `assemble_timed.ts`: copies of `src` with timers; delete when `src` changes), `normal_phases.ts`, `parse_cost.ts`, `micro.ts`, `variants.ts` (+ `mkvar.mjs`), `pollute.ts`, `pollute2.ts` to `pollute4.ts`, `fastprops.ts` (run with `node --allow-natives-syntax`), `base.ts`, `first.ts`, `final_cold.ts`, `warm.ts`, `fallback_cost.ts`, `a_cost.ts`, `tip.ts`, `oracle64.ts`, `gid.ts`, `dbg.ts`, `ref.ts` (normal path without preprocess), and the prototype `fast.ts` with `fast_check.ts`, `fast_fuzz.ts`, `fast_time.ts`. None of it is imported by `src` or `test`; `tsconfig.json` does not include `experiments`.

### Implementation (milestone C, steps C1 to C3)

Status: implemented and verified; no STOP triggered. Nothing committed. Outside `ts/src/incremental/` nothing in `ts/src` changed; no Go or `javascript/` change. [ran] = executed in this session.

**Changed per file**
- `src/incremental/piece.ts`: `Context` loses `isFirst`/`isLast` (I1: they are `prev < 0` and `next < 0`, linked by the sandbox). `contextKey(c)` = `lastOut,prev,next,domPrev,domNext,domNextAttrs` (I4; `domNextAttrs` is in the key because the next-sibling stub answers `Attr`). `Variant = {key, ops, endLastOut, bytes}`; `ReadKey`, `readKeys`, `readVals`, `LASTOUT_PASS` deleted.
- `src/incremental/barrier.ts`: `guard`, `guardAst` deleted. `domStub(atom, attrs|null, side)`; the previous-sibling stub has `attrs = null`, so `Attr` throws `dom.prev.Attr` (I2).
- `src/incremental/sandbox.ts`: three phases. `analyse` (parse, certificate, passes 1-3); `build` (plain-assignment DOM links, passes 4-15, sibling checks against the installed stubs, genAST, tip check, adjustTree); `render` (AST links from prev/next, `r.LastOut = ctx.lastOut`, `endLastOut = r.LastOut`, coalesce, generated-id scan). `runChild` is their composition; `withTesting` and `classify` exported. `ADJUST_PASSES` keeps names and scope; `armed`/`covered` removed. The `LastOut` accessor is gone.
- `src/incremental/assemble.ts`: rewritten for C2 (order, early exits, handles, full runs) and C3 (memo). Variant lookup by key; the replay checks `endLastOut` in strict mode for every variant.
- `src/incremental/cache.ts`: `MAX_VARIANTS = 16` (was 8, deviation 1); `MemoSlot`, `MEMO_REPROBE = 32`, `clearMemoSlots`; stats `analyses`, `builds`, `renders`, `memoHits`.
- `src/incremental/index.ts`: unchanged (the four exports keep their signatures; the stats copy is a spread).
- Tests: `barrier`, `cache`, `context_channels`, `piece_assembly`, `witness` restated on the key (the `guard` tests removed; the `isFirst`/`isLast` searches replaced by key checks, and log-level checks for `domPrev` and `lastOut`). New: `context_key.test.ts` (I2, I4, determinism), `phase_order.test.ts` (C2 tests i to v), `negative_memo.test.ts` (C3 tests i to vii).
- Experiments: `negative-control.ts` anchors re-done (table below); `README.md` table and command note updated; `engine-adapter.ts` unchanged (its statistics names still exist). Scratch under `cold-proto/`: `old-incremental/` (pre-change engine copy from HEAD, imports rewritten), `old_new.ts`, `variant_hist.ts`, `list_coupling_cost.ts`.

**Deviations from the specification, with reasons**
1. `MAX_VARIANTS` 8 to 16. Always-key needs more variants: at 8 the warm pass of `dom2md_incremental.test.ts` had 24 misses, and its assertion `misses === 0` is kept. Measured with the cap raised (`variant_hist.ts`): uncapped maximum 14 variants (`<hr data-block="0" />`), 1,300 WYSIWYG entries; the warm pass then had 0 misses. After C2 the maximum is still 14, and cold misses fell from 2,104 to 1,555 (the provisional-context variant is gone). Memory stays bounded by `maxBytes`. `cache.test.ts` asserts the constant 16.
2. `endLastOut` is the renderer's `LastOut` at the end of every run (no `LASTOUT_PASS`). The strict `replay:lastout-diverged` check applies to every variant. The `lastOut` log test compares operations only, because `endLastOut` of a run that writes nothing is the entry value by construction.
3. Reason attribution follows the new order (spec section 6: the first reason found in the order of the algorithm): stored refusals first, then analysis (opaque children first), then list coupling, then tip-open in build order.
4. The negative memo is kept per mode (two slots in `State.memo`), not one slot: a refusal of one mode must not decide a call of the other mode.
5. Stats meaning: `misses` counts alive children with no variant of their key at the replay; `sandboxRuns` counts analyses of new children plus full runs; `renders` counts renders from a build. A child whose string appears twice with different DOM neighbours is built once (first position) and runs in full at the other position, because its DOM context differs from its build.
6. Negative controls re-anchored (a consequence of C1): NC1 is the root `LastChild` link in `render` (`if (false)`); NC3 the `last.Next` link; NC5 `domNext` left out of `contextKey` (there is no read recording); NC15 `r.LastOut = 10` at the start of `render` (the accessor is gone). NC2, NC4, NC9, NC11, NC12', NC13', NC14 keep their meaning with new anchors.
7. The I1 test is not written: I1 holds by construction (no field exists; `render` links from `prev`/`next`).
8. Phase order: the IR open-tip child is the literal `<div data-type="code-block" data-block="0"><span data-type="text">indented</span></div>` (refused with tip-open under the neutral context; the corpus search found none).

**Test and fuzz totals [ran]**
- `npm run typecheck`: clean after C1, C2, C3 and at the end.
- Brief test set (`test/incremental/*.test.ts`, `dom2md_incremental*`, `dom2md_replay`): 180 of 180 pass after C3 (C1 alone 167; C2 added 5; C3 added 8).
- `npm test` once: 4,151 tests, 4,143 pass, 0 fail, 8 skipped, 73.5 s (milestone B: 4,119 / 4,111 / 8, 91 s).
- Fuzzer (engine, `--cmp=3000 --no-precheck`): seed 1 wysiwyg 0 mismatches, 0 inconsistencies (2,545 composed of 3,000); seed 1 ir 0 / 0 (2,553); seed 2 wysiwyg 0 / 0 (2,414); seed 2 ir 0 / 0 (2,523). The evict pass is VACUOUS in every run (no eviction happened); this was already so in milestone B and is not fixed here.
- Negative controls (`--jobs=3 --cmp=500`): baseline green (89 tests, 0 mismatches). Expected = observed for all 11:
  - NC1 isLast forced true: caught (909 mismatches, 0 inconsistencies)
  - NC2 prev forced -1: caught (166 / 0)
  - NC3 next forced -1 on the Next stub only: silent (0 / 0), as expected
  - NC4 domNext forced -1: caught (30 / 0)
  - NC5 domNext out of contextKey: caught (context_channels pinned and REAL searches)
  - NC9 TrimSpaceAll does not trim: caught (587 / 0)
  - NC11 variants[0] always: caught (regressions, edit simulation)
  - NC12' coalesce hoist: caught (1,608 / 818)
  - NC13' trim LF only: caught (6 / 0)
  - NC14 generated-id scan removed: caught (unit test)
  - NC15 render starts at LF: caught (unit test, pinned lastOut witness)

**Timing [ran]** (CommonMark spec document, one process, interleaved, fastest of 14; the public call is the cache plus the normal path on a fallback; `old_new.ts`)
- WYSIWYG: normal 46.9 ms; cold new 94.3 ms = **2.01x** normal (old engine 3.91x); warm one-edit new 7.6 ms = 0.16x normal (old 7.9 ms); new / old warm = **0.97**.
- IR: normal 72.4 ms; cold new 135.1 ms = **1.87x** (old 3.22x); warm one-edit new 78.3 ms = 1.02x normal-edited (old 1.04x); new / old warm = **0.98**.
- `final_cold.ts` (14 reps, public call): WYSIWYG normal 47.1, engine cold 95.4 (2.03x); IR normal 77.1, engine cold 128.2 (1.66x).
- `warm.ts spec`: WYSIWYG warm one-edit 8.85 ms vs normal 46.8 ms (composed, equal).
- `fallback_cost.ts`: IR repeated fallback with the memo 70.8 ms vs normal 74.5 ms.
- Stable list-coupling document (spec plus a list pair, `list_coupling_cost.ts`): cache repeat 162 ms vs normal 167 ms (0.97x). Each cache call analyses about 1,400 children and builds none; no memo (by design). This is the cost the memo deliberately does not cover.

**Stop conditions**
- No STOP. Checked: no `BarrierViolation` on the corpus (COVERED sweep, and `dom2md_incremental` inconsistencies empty); no output difference in any test, fuzz pass or control baseline; cold WYSIWYG 2.01x (limit 2.5x); warm one-edit 0.97 to 1.00 of the old engine (limit 1.2x).
- Not run: C5 (the pollution check on a quiet machine) is not in this brief's verification list, so the C1 pollution condition stays open. C4, C5 and C6 are out of scope.

### Implementation (per-child fixed costs) (2026-10-12)

Status: **no change kept.** `ts/src/incremental/` is identical to HEAD (`4526eec1`). Step 1 (lazy renderer table, C4) met the cold gate and was reverted on the warm gate; step 2 (one render options object per call) was reverted because its gain was not shown at 8 percent; step 3 (one parse of all new children) was not built. Both candidates are kept for a quiet-machine measurement: `cold-proto/null-incremental/` (step 1; the name is misleading, see deviation 3) and `cold-proto/step2-candidate/` (step 2 on top of step 1). The machine was shared with other processes for the whole session: the normal path (WYSIWYG, spec) measured 47 to 66 ms fastest-of-14 against 28 to 30 ms when quiet (canary, `cold-proto/canary.ts`). All timings below are ratios inside one process; the absolute values are not comparable with earlier sections.

**Step 0, profile of the current code** [ran; `cold-proto/mkprof.mjs` generates `prof/` (copy of `src/incremental` with laps; every anchor checked), `prof_run.ts` runs it; fastest of 14 cold calls; the normal path measured first]

WYSIWYG, cold call 59.6 ms, normal 28.3 ms (2.11x), composed:

| phase (wall, assemble) | ms | % |
|---|---:|---:|
| replay loop (includes the renders) | 26.0 | 43.6 |
| analyse loop (certificate parse, passes 1 to 3) | 18.6 | 31.3 |
| build loop (passes 4 to 15, genAST, adjustTree) | 9.6 | 16.1 |
| lookup and newEntry | 2.4 | 4.0 |
| scan, preprocess, list coupling, close, rest | 3.0 | 5.0 |

Inside the sandbox, summed over the 1,397 children:

| lap | ms | % of cold |
|---|---:|---:|
| analyse: parse with certificate | 17.4 | 29.2 |
| render: renderer setup (constructor, 141 bound methods) | 10.1 | 16.9 |
| render: walk (recording dispatch) | 7.3 | 12.2 |
| build: genAST | 4.0 | 6.7 |
| render: `adapter.renderOptions()` (copies the 100-entry term table) | 3.6 | 6.0 |
| build: passes 4 to 15 | 3.4 | 5.7 |
| render: coalesce and text | 1.6 | 2.8 |
| build: adjustTree | 1.1 | 1.9 |
| render: AST links, passes 1 to 3, DOM links, certify, generated-id scan | 2.4 | 4.0 |

IR (two runs; the first is the cleaner one, cold 89 ms, its normal path was not measured cleanly; the second ran under load, cold 243 ms): analyse loop 32 and 30 percent, build loop 23 and 22 percent, replay loop 36 and 40 percent; inside the sandbox, parse with certificate 29 and 27 percent, renderer setup 20 and 13 percent, genAST 12 percent in both, render walk 9 and 11 percent, `renderOptions` 8 percent (second run).

Reading: the parse is the largest single cost (about 29 percent), and renderer setup plus `renderOptions` together are about 23 percent (WYSIWYG). The phase tables of section 1 are no longer the current code (reruns and accessors are gone), as expected.

**Step 1, lazy renderer table (C4): reverted.** `sandbox.ts` derives the table `NodeType -> method name` once from `registerFormatRendererFuncs`, run against a spy (its `RendererFuncs` records the `set` calls, its `renderX.bind` records the name; the registration body was checked to contain nothing but the 141 bind lines). Each renderer gets a `Map` subclass whose `get` binds on first use into an array indexed by type (a `Map`-based version cost 33 percent more on a large child, because `get` runs on every node dispatch). `has`, `size` and the iteration methods answer as the eager map does; writes throw. Equivalence: `cold-proto/lazy_check.ts`, 141 types, 0 mismatches (key order, bound names, get identity, refused writes). Brief test set 180 of 180. No change outside `ts/src/incremental/`.

Measured, candidate against the code before (`base-incremental`), one process, fastest per call:

| run | cold WYSIWYG | cold IR | warm WYSIWYG | warm IR |
|---|---:|---:|---:|---:|
| interleaved, order alternating, 30 reps (2 runs) | 0.774, 0.728 | 0.887, 0.893 | 1.086, 1.065 | 0.975, 1.006 |
| GC forced before each timed call, 20 reps (1 run) | 0.849 | 0.888 | 0.819 | 0.940 |
| final pair, 20 reps (2 forced-GC runs, 1 plain) | 0.940, 0.899, 0.826 | 0.890, 0.876, 0.861 | 0.969, 1.231, 1.014 | 1.111, 1.119, 1.107 |
| edited child alone (`runChild`, the only sandbox run of a warm call), 14 blocks, 2 runs | 0.736, 0.726 | 0.852, 0.848 | n/a | n/a |

Decision: the cold gate (at least 8 percent in one mode, not worse in the other) is met in WYSIWYG and IR. The warm gate (not worse by more than 5 percent) is not shown: IR warm is 1.11 in three of the five full-call runs and 0.98 to 1.01 in the other two; the edited child alone is 15 percent faster in both modes, and the rest of the warm call is the same code, so the cause is not identified. The rule says revert, so it is reverted. Re-measure on a quiet machine before deciding.

**Step 2, one render options object per call: reverted.** `vditorDOM2MdRenderOptions()` costs 3.5 us (micro, loaded machine) and builds a fresh 100-entry `Terms` map each time (`NewTerms`). Sharing is sound: the renderers only read `Options` (`Terms` is read by `term_typographer.ts` with `get`, no `Options` field is written in `src/render` or the adapters). Candidate `cold-proto/step2-candidate/` (against step 1, order alternating, 30 reps): cold WYSIWYG 1.015, 1.200, 0.823, 0.900; cold IR 0.964, 0.737, 0.857, 0.925. Forced-GC runs: WYSIWYG 0.922 and 1.107 (the second under a load spike, normal path 164 ms), IR 0.804 and 0.945. Warm 0.97 to 1.17, no effect expected. The median cold gain is about 9 percent with a spread of ±20 percent: 8 percent is not demonstrated in one mode, so it is reverted.

**Step 3, one parse for all new children (b5): not built.** The gate triggers (parse is 29 percent of the cold call after step 1). But the saving can only be the per-child parse overhead: `cold-proto/parse_cost.ts` (re-run on the loaded machine): whole string `ParseHTML` 24.2 ms, 1,413 children `ParseHTML` 26.3 ms, children with `parseWithBoundary` 26.7 ms, with certify 28.5 ms. One concatenated parse saves at most about 2 ms, about 3 percent of the cold call, below the 8 percent gate. A concatenated parse would also have to reproduce the certificate state at every cut inside one token stream (the state at each cut equal to the reference, a token ending exactly at each cut); that is not worth the risk for this gain.

**Deviations**
1. Measurement protocol. The loaded machine moved the normal path by up to 2.3x within minutes, and a null comparison (see 3) was not available as a clean calibration. Used: `cold-proto/pair_time.ts` (interleaved; the order of the two versions alternates per repetition, because the second call of a pair inherits the garbage of the first; fastest of 14 to 30 repetitions); a variant that forces `gc()` before each timed call (`GCBEFORE=1`, `node --expose-gc`), reported separately. `process.cpuUsage` (`cpu_step.ts`) was tried and dropped: it counts V8's GC threads.
2. Final state is HEAD, so the requested "new versus before" table is trivial. The only timings are the candidate tables above and the coordinator's figures (WYSIWYG cold 2.07x, IR 1.53x, warm 7.3 and 10.3 ms, not re-measured today).
3. `cold-proto/null-incremental/` was meant as a null control (a copy of the base code, to calibrate the harness). It was made by `mkcopy.mjs` from the current `src`, which already held step 1, so it is the step 1 candidate. A true null control was not built.
4. `cold-proto/base-incremental/` is the code before this work (HEAD). `prof/` is the timed copy from `mkprof.mjs`. `warm_child*.ts`, `all_children.ts`, `cpu_step.ts`, `warm_only.ts`, `opts_micro.ts`, `canary.ts`, `step_time.ts` are the single-purpose probes used above; `lazy_check.ts` is the equivalence check of step 1.
5. Test count at HEAD: `npm test` gives 4,138 tests, 4,130 pass, 0 fail, 8 skipped. The coordinator recorded 4,152 (4,144 pass) before commit `4526eec1`; the difference was not investigated.
6. Negative controls: no anchor was changed (`ts/src/incremental/` is identical to HEAD), so no control was re-anchored.

**Test and fuzz totals (final state, HEAD)**
- `npm run typecheck`: clean. `npm test`: 4,138 tests, 4,130 pass, 0 fail, 8 skipped, 49.5 s (84.7 s earlier under load).
- Fuzzer, `--cmp=3000 --no-precheck`: wysiwyg seed 1, ir seed 1, wysiwyg seed 2, ir seed 2: 0 mismatches and 0 inconsistencies in every pass (warm, cold, shared, evict and the engine passes); composed 2,390 to 2,493 of 3,000 per run; evict pass 3,186 to 5,216 evictions and 17 to 217 `too-large` fallbacks per run.
- Negative controls, `--jobs=3 --cmp=500`, `D2M_SCRATCH` set: baseline green (89 tests, 0 failed, 0 mismatches in all four fuzz configurations); all 11 as expected:

| control | expected | observed | fuzz mismatches / inconsistencies |
|---|---|---|---|
| NC1 isLast forced true | caught | caught | 948 / 0 |
| NC2 prev forced -1 | caught | caught | 120 / 0 |
| NC3 next forced -1, Next stub only | silent | silent | 0 / 0 |
| NC4 domNext forced -1 | caught | caught | 30 / 0 |
| NC5 domNext out of contextKey | caught | caught | 0 / 0 (witness tests) |
| NC9 TrimSpaceAll does not trim | caught | caught | 696 / 0 |
| NC11 variants[0] always | caught | caught | 257 / 0 |
| NC12' coalesce hoist | caught | caught | 1,529 / 827 |
| NC13' LF-only trim | caught | caught | 1 / 0 |
| NC14 generated-id removed | caught | caught | 0 / 0 (unit test) |
| NC15 render starts at LF | caught | caught | 0 / 0 (pinned witness) |

## Coordinator's verification after milestone C and the item 64 fix (2026-10-12)

Machine quiet (the owner's statement). Commits: `4356825d` (milestone C), `1077108a` (item 64), `68bccb67` (evict bound).

- `npm test` run by the coordinator after each step: 4,152 tests, 4,144 pass, 8 skipped, 0 fail.
- **Item 64 fixed** as a deliberate departure (Go patch `ts/tools/oracle/patches/0002`, rebuilt reference bundle, `ts/src/vditor_ir.ts`, test `ts/test/e2e/ir_indented_code.test.ts`). The open-tip fixtures of `negative_memo.test.ts` and `phase_order.test.ts` now use an unclosed math block, because neither branch of the old code leaves the tip open any more. The `tip-open` refusal stays as a property check.
- **Spec document, one process, scratch script (fastest of 45 warm calls):** WYSIWYG warm one-edit 7.3 ms against 40.5 ms normal (5.6x); IR warm one-edit 10.3 ms against 65.0 ms normal (6.3x; before the fix every IR call fell back). Outputs equal; 73 calls composed, 0 fallbacks, 1,406 entries, 2.0 MB (WYSIWYG) and 2.5 MB (IR) held.
- **Cold call in a warm process** (`final_cold.ts`): WYSIWYG 87.8 ms against 42.5 ms normal (2.07x); IR 105.4 against 68.8 (1.53x).
- **First call in a fresh process**, interleaved, three processes each: WYSIWYG 279 / 279 / 286 ms with the cache against 157 / 158 / 151 ms without (1.8x); IR 333 / 329 / 311 against 205 / 222 / 199 (1.55x). The earlier "256 ms against 33 ms" compared a first call in a fresh process with a warm normal call and overstated the gap.
- **Pollution of the normal path** (`pollute4.ts`, CPU time after / before, fresh process per run, six runs each, interleaved): new engine 0.67, 0.97, 0.67, 1.03, 0.97, 0.67; control 0.66, 0.70, 0.97, 0.66, 0.66, 0.68. 0 of 6 above 1.2 (the old engine: 14 of 14). Gate C5 (2) passed; the timer resolution is about 16 ms.
- **Evict pass** was vacuous at 256 KiB. At 32 KiB, 3,000 comparisons per mode, seed 2: 12,042 / 17,603 evictions, 209 / 570 `too-large` fallbacks, 0 mismatches, 0 inconsistencies.
- `first.ts` of `cold-proto/` no longer runs (it imports removed symbols); not repaired.

## Why the normal path is superlinear on 1 to 5 MB documents (2026-10-12, coordinator)

Question from the owner: speed up the first call on large documents; step "2" was to find out why the normal `VditorDOM2Md` grows faster than the input (0.2 MB: 33 ms; 5 MB, 24 copies of the spec: 1.1 to 3.1 s instead of about 0.8 s). Scripts: `ts/experiments/dom2md-cache/cold-proto/scale_phases.ts`, `heap_sizes.ts`, `gc_share.ts`; idle machine.

Findings [all measured]:

- **No quadratic algorithm.** Every phase slows down by a similar factor at 24 copies (WYSIWYG, x24 input: preprocess x23, parse x36, adjustDOM x40, genAST and adjustTree x43, render x35).
- **Live memory is the cause.** For the 212 KB spec the DOM tree holds 4.1 MB (8,913 nodes, 462 bytes per node) and the AST 7.85 MB (9,380 nodes, 837 bytes per node): about 12 MB live for 0.2 MB of Markdown (57x). One 5 MB call holds about 360 MB of heap.
- **The first 5 MB call in a process takes 1.1 to 1.2 s; from the third call on, the same call takes 2.8 to 3.1 s** (same input, same or a fresh engine: no difference, so it is not engine state). Garbage-collection pauses inside one such call: about 290 ms in the first call, 650 to 790 ms later (17 to 19 scavenges of about 40 ms each, because nearly everything allocated survives until the end of the call). The rest of the slowdown is the mutator itself running about twice as slow on the grown heap; cause not identified.
- Ruled out: allocation-site pretenuring (`--no-allocation-site-pretenuring`: no change), young-generation size (`--max-semi-space-size=128`: no change), incremental marking (no change), deoptimisation storms (123 deoptimisations in the whole run). `--single-threaded-gc` is slower.
- **Node size matters, but not enough.** The bundle before the slim node (L3; 1,834 bytes per AST node) against the one after it (about 700 to 840 bytes), at 5 MB: 4.0 s against 3.45 s on repeated calls (15 percent), 1.49 against 1.36 s on the first. Extrapolating, a hot/cold split of `ast.Node` (plan item S2) would give roughly another 10 percent at 5 MB and nothing measurable at 0.2 MB.

Conclusion: there is no cheap fix in the normal path. The property that hurts is "the whole DOM and the whole AST are alive at once"; the per-child cache does not have it (each new child gets a short-lived tree), which is why its cold call at 5 MB (2.6 s) was not slower than the normal call in the same process (3.1 s), and its warm one-edit call is 0.19 s. Not pursued: S2 for this purpose; a streaming normal path (it would be a second pipeline).

## Correction: the 2.5x slowdown of repeated 5 MB calls is the machine, not Lute or V8 (2026-10-12, coordinator)

The section "Why the normal path is superlinear on 1 to 5 MB documents" reported that the first 5 MB call takes 1.1 to 1.2 s and later calls 2.8 to 3.1 s, cause "not identified". It is identified now:

- **A pure arithmetic loop (no allocation, no Lute code, `canary-only.cjs` in the session scratch directory) slows down the same way:** 137 to 148 ms per chunk in the first 2 seconds of the process, 300 to 390 ms from about second 3 on (2.2 to 2.6 times), in two runs out of two.
- With 5 seconds of such work before the first conversion, **the first 5 MB call is already slow** (2,778 ms), and the following calls are the same (2,535 to 2,855 ms): the slowdown follows process run time, not the call count or the heap.
- Consistent with everything measured before: the per-call CPU profile showed all functions 2.5 to 5 times slower, native string work included; scavenges copied the same bytes (about 7 MB promoted, 7 MB survived each) in twice the time; page faults and kernel time did not grow; V8 flags (compiler tiers, pretenuring, young-generation size, incremental marking) made no reproducible difference; a fresh engine made none.
- Mechanism on this laptop (i7-1360P, "Balanced" plan, on AC): not determined. Candidates: the short turbo window ending, or the scheduler moving the thread to efficiency cores.

Consequences:

1. Most of the "superlinearity" was this artifact: a 5 MB call that runs inside the fast window takes about 0.9 to 1.1 s, against 24 x 33 ms = 0.8 s for linear scaling, so the normal path is about 1.2 to 1.4 times slower than linear at 5 MB, not 2.4 to 3.9 times. The live-memory findings (bytes per node, GC pauses growing with live bytes) stand.
2. Any measurement on this machine whose process runs longer than about 2 seconds mixes two CPU speeds. Interleaved comparisons with the same schedule on both sides stay valid (`bench:macro` runs each child for the same time); absolute times from long processes are inflated by up to 2.5 times, and "first call against later calls" comparisons inside one process are invalid.
3. The cold-cache numbers at 5 MB ("2.6 s against 3.1 s normal") were both taken in the slow window; their ratio is usable, the absolute values are not.
