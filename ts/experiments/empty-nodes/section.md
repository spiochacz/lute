

## searchEmptyNodes: where its self time goes (2026-10-12)

Question: a CPU profile of `VditorDOM2Md` on the 212 KB CommonMark spec attributes about 3.9 percent of the call to `Lute.searchEmptyNodes` (pass `removeEmptyNodes`), 89 percent of it as self time. An earlier attempt (trim reorder, `atom.X` namespace reads) found nothing. All scratch code is in `ts/experiments/empty-nodes/` (no edit of `ts/src`). Input: `benchmark/commonmark-spec.md` through `Md2VditorDOM` (fixture by `dom2md-cache/cold-proto/mkfix.ts`, 518 KB), `vditorDOM2MdPreprocess`, `util.ParseHTML`.

### Counts (`counts.ts`, `attrs.ts`, `maps.ts`)

- Calls of `searchEmptyNodes`: 8889 (one root call; the function recurses, it is not called per top-level child). Maximum recursion depth 10. Array pushes into `emptyNodes`: 1 (one comment node). One hidden class for all 8889 nodes and one for all 8855 `Attribute` objects (`%HaveSameMap`); the `Attr` arrays have two maps (5214 of 8889 differ from the first): polymorphic, not megamorphic.
- Atoms: Code 1930, Pre 1412, P 743, Div 706, A 117, Li 113, Em 75, H2 34, Strong 29, Ol 17, Ul 15, other small; text nodes (atom 0) 3674, Span 0.
- Branches: `default` (the `class == "katex"` check, `DomAttrValue`) 5111; atom 0: 3139 take the "inline neighbour, keep" exit (29 of them do the strong-prev ZWSP trim), 534 are non-inline text nodes (the `TrimLeft`/`TrimRight`/`Contains`/`ReplaceAll` chain; text length p50 59, p90 155, max 579 chars, 42 208 chars in total), 15 are under Ol/Ul/Li (a `TrimRight`), 0 under a table; marks (Strong/Em/...) 104; second switch: 32 Ol/Ul reach `util.DomText` (22 226 chars in total).
- Elements by attribute count: 0:28, 1:2993, 2:1430, 3:54, 4:710 (8855 attributes; key `class` 3509, `data-block` 1531, `data-marker` 1518, ...). The attribute keys are NOT internalized strings (`%DebugPrint`: `SEQ_ONE_BYTE_STRING_TYPE`; the literal `"class"` is `INTERNALIZED_ONE_BYTE_STRING_TYPE`).
- Time per call (fresh parse untimed, timed call only, 8889 nodes): 1.1 to 1.4 ms in the "natural" state, 0.3 to 0.5 ms right after a minor GC, 0.17 to 0.3 ms when the same DOM is processed a third time. A plain recursive walk that reads only `DataAtom`/`FirstChild`/`NextSibling` costs 0.48 ms natural, 0.22 ms after a minor GC, 0.13 ms on its third pass.

### Line-level profile (`prof_loop.ts`, `analyse_prof.ts`)

`node --cpu-prof --cpu-prof-interval 100` on 6 s of "fresh parse + `lute.removeEmptyNodes`" (270 iterations, TS sources, default flags; one process, partly in the slowed state, so only the shares inside it mean something). `searchEmptyNodes` self = 6.2 percent of all samples (the parse dominates the loop). Of its self ticks:

- 61 percent on lines `util/html.ts:398` and `:399` (`for (const attr of n.Attr)` / `if (attr.Key === attrName)`): this is `DomAttrValue` INLINED into `searchEmptyNodes` (positionTicks carry the callee's line numbers). Confirmed with `--max-inlined-bytecode-size=0`: `DomAttrValue` then shows as its own function (3.8 percent self against 2.1 percent for searchEmptyNodes), same total picture.
- 23 percent on line 837 (`switch (n.DataAtom)`): the first load from the node `n` (a dependent-load miss lands on the first instruction that uses the value).
- the rest (about 16 percent) is spread over about 25 lines, none above 3 percent (the recursive call 2.9, the katex line itself 0.9, isInline 0.7, the trims 0.2 each).

So the self time is the inlined attribute lookup of the `default` branch (5111 calls, about 1.7 attribute objects each) plus the first read of every node.

### Cause

Memory locality of a freshly parsed DOM, not the shape of the code. Controlled experiment (`repeat_state.ts`; STATE=U: one minor GC before the parse and a 128 MB semi-space, so no scavenge between parse and call and the DOM lies interleaved with the tokenizer garbage; STATE=C: minor GC right after the parse, so the survivors are copied compactly; medians of 13 to 18 fresh DOMs; run k = k-th call on the same DOM; ms):

| variant | U run1 | U run3 | C run1 | C run3 |
|---|---|---|---|---|
| copy a (verbatim) | 1.32 | 0.37 | 0.41 | 0.23 |
| copy b (A/A) | 1.26 | 0.35 | 0.47 | 0.22 |
| katex check removed (changes result, lower bound) | 0.78 | 0.27 | 0.35 | 0.16 |

(one representative process per column; the other processes agree within the bias below.) One minor GC before the call turns 1.2 ms into 0.4 ms, a second one into 0.3 ms; the plain walk shows the same factor 2. Without forced GC the run time is bimodal (0.5 or 1.2 ms) depending on whether a scavenge happened to fall between the parse and the call, which is why profile shares and one-off timings of this function look unstable (an early v_early run showed a 40 percent "gain" in two of four processes that was pure GC phase; the controlled states removed it). The cost is not just "first touch of the spine": `removeHighlightJSSpans` run first on a fresh DOM costs 0.40 ms and `removeEmptyNodes` after it still 0.9 ms (`order.ts`). What `searchEmptyNodes` touches beyond the spine is the attribute chain (node -> `Attr` array -> elements -> `Attribute` -> `Key` string) and the text `Data` strings. The chain is worth about 0.45 ms of the 1.3 ms in state U (check removed: 0.8 ms) but only about 0.05 ms compacted or warm (0.16 against 0.21 to 0.23 ms).

The mechanism inside the memory system (cache misses versus TLB misses) was not separated: no hardware counters on this machine.

### Candidates

1. `switch` shape (11 sparse atom cases, linear compare chain): REFUTED. `v_early.ts` tests the four most common default atoms (Code, Pre, P, Div) before the switch: U run1 1.37 against 1.32 (copy a) and 1.26 (copy b), inside the A/A bias.
2. Megamorphic property access: REFUTED. One map for every `html.Node` and every `Attribute`; `Attr` arrays have two maps (polymorphic only).
3. Recursion with a growing output array: REFUTED. 1 push; depth 10.
4. String comparison against literals (non-internalized `Attribute.Key`): REFUTED as a cost. The keys are non-internalized, but pre-internalizing them (`v_intern.ts`, untimed prep) changes nothing in either state (U run1 1.28 against 1.34 and 1.24; C 0.47 against 0.47 and 0.46).
5. `Array.prototype` iteration: REFUTED as a separate cause. The `for...of` over `Attr` is the inlined hot line, but its cost is the dependent loads (see Cause); the loop is optimized.
6. Deoptimisation loops: REFUTED. `--trace-deopt`, 5 s, 270 iterations: 12 bailouts for this function (3 eager: insufficient type feedback, not a Smi, wrong map; 9 lazy), all during warm-up (Maglev, then Turbofan); the function ends compiled by TURBOFAN_JS and the last trace line is the Turbofan completion.
7. Inlining attribution: CONFIRMED. 61 percent of the self ticks are the inlined `DomAttrValue`, which the profile reports as `searchEmptyNodes` self time. This also explains why the earlier attempts at lines of the function itself found nothing.
8. `atom.X` namespace reads: refuted earlier; consistent (no atom read among the hot lines).
9. Memory layout / cache misses of the freshly parsed DOM: CONFIRMED (minor-GC experiment, walk-only control, third-pass control).
10. Trim and string operations (534 text nodes, 42 KB; 32 `DomText` over 22 KB): not a cause; together under 3 percent of the function's ticks.

### Proposed change

None. The only code-level lever is the katex check (`DomAttrValue(n, "class")` on 5111 elements). It has to read the attribute (any element may carry `class="katex"`), and its cost is the memory chain, not the comparison. Removing it changes the result; every variant that kept it (switch reorder, interned keys) measured equal to the A/A copy. The A/A bias of this harness is about 5 to 7 percent (copy a against copy b, run 1: 1.32/1.26, 1.33/1.40, 1.23/1.21, 1.34/1.24 in four processes of state U; 0.41/0.47, 0.50/0.49, 0.47/0.46 in state C). For the record, the verbatim scratch copy equals `removeEmptyNodes` byte for byte on the spec DOM (`identity.ts`: serialisations equal, 522 317 chars). The `corpus_docs.ts` identity check was not run, since there is no change to verify.

### Is it worth changing

No. 3.9 percent of the call is the ceiling; the inlined attribute lookup is about 60 percent of that, and only the part above what a compact heap would cost (roughly 0.45 of 1.3 ms in the bad-layout state, 0.05 of 0.4 ms in the compact state) is avoidable at all, and not by a change of this function. Even deleting the check would buy about 1.4 percent of the call in the bad-layout state and about 0.5 percent in the compact one. A lever with a real effect, if ever wanted: allocation locality of the parse (less tokenizer garbage between nodes, or a compacting copy of the DOM), which would speed up every pass, not only this one; that is a separate design item and is not proposed here.

### Unknown

- Cache versus TLB share of the miss cost (no hardware counters).
- Why the second call on the same DOM is still slow in state U (0.9 to 1.1 ms) and only the third is fast (0.35 to 0.4 ms); candidates (write-barrier or string-representation effects of the first mutation) were not tested.
- How often the real `VditorDOM2Md` loop of the original profile is in state U or C (depends on where scavenges fall); the 3.9 percent moves with GC timing.
- The experiments ran the TS sources under Node 24; the original profile used the esbuild bundle. positionTicks line numbers refer to the sources.
