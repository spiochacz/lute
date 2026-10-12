# 008 — Allocation locality of the parsed DOM tree

Status: **task, not started; nothing decided.** The owner decided on 2026-10-12 to leave the code as it is and to record the possible improvements. Related: `001-analysis.md` (section "searchEmptyNodes: where its self time goes (2026-10-12)", the measurement rules, the memory breakdown in "Hot/cold split of ast.Node and flat short strings"), `007-bytes-string-conversions-in-html-path.md`.

## Finding

The cost of the passes over the DOM tree in `VditorDOM2Md` (and the other HTML to Markdown paths) is dominated by where the objects are in memory, not by the code of the passes.

- The HTML parser allocates tree nodes interleaved with short-lived objects (tokens, text pieces, working arrays), so nodes that are neighbours in the tree are far apart in memory, separated by garbage.
- A pass touches, per node: the node, its `Attr` array, each `Attribute`, the key string. Every one is a pointer to follow.
- Measured (Sonnet analysis, spec document as WYSIWYG DOM, 8,889 nodes): the same call of `searchEmptyNodes` takes about 1.25 ms on the freshly parsed tree and about 0.4 ms right after a minor garbage collection, which copies the live objects next to each other. A plain walk of the tree halves in the same way. Without a forced collection the timing is bimodal, depending on where a scavenge happens to fall.
- In the profile the time shows up as self time of whatever function touches a node first, and as time of `DomAttrValue` inlined into its callers; this is why edits of those functions' own lines found nothing.
- Not separated: cache misses against TLB misses (no hardware counters on the machine).

Size of the effect: the DOM passes and the tree building are about 24 percent of `VditorDOM2Md` on the spec document (`vditor_wysiwyg.ts` in the profile of 2026-10-12); the tokenizer and the tree construction, which create the layout, another 25 percent. How much of the 24 percent is layout is not known; for `searchEmptyNodes` it is about two thirds.

## Possible improvements (none evaluated beyond what is stated)

### L1. Fewer objects per node
Every object removed from a node's reach is a pointer not followed.
- Attribute array only for elements that have attributes (in progress on 2026-10-12 as a memory item; record its effect on pass times here when it lands).
- Attribute keys as interned strings (the tokenizer creates a new string for every `data-block`, `class`, ...). The interning cache for short decodes added in wave 5 (`runtime/conv.ts`) already returns one string object per distinct key within its 4,096 slots: check whether keys are in fact shared now, and whether comparisons then hit the pointer-equality fast path. The analysis reported that interning the keys alone changed nothing for `searchEmptyNodes`.
- `Attribute` as two parallel arrays on the node (keys, values) instead of one object per attribute: removes one hop per attribute. A change of the shape of `html.Node`, so a departure from the Go struct; about 60 reader sites use `a.Key` / `a.Val`.
- Size and risk: local to `html/`, `util/html.ts` and the readers; each is a `PORT-NOTE` departure.

### L2. Less garbage between the nodes
If the parser allocates fewer short-lived objects, consecutive nodes end up closer together.
- The tokenizer builds a `Token` object, strings for the tag name and each attribute, and arrays, per tag; the parser then copies them into a node. Reusing one token object and writing attribute data straight into the node would remove most of the interleaved garbage.
- Risk: `html/token.ts` and `html/parse.ts` are 1:1 ports of Go's `x/net/html`; the Go-generated vectors (`token.vectors.test.ts`, `parse.vectors.test.ts`) guard the behaviour, but the code would stop mirroring the Go files in the hot loop.
- Unknown: how much garbage is interleaved today (count allocations per node during `ParseHTML`), and whether V8's allocation folding already groups some of it.

### L3. A compacting copy after the parse
After `ParseHTML`, copy the tree once in traversal order into fresh objects, so that nodes, their attributes and their strings are contiguous; the passes then run on the copy.
- Keeps the parser untouched (no departure in `html/`); the copy is new code without a Go counterpart, placed in `util/` or next to `ParseHTML`.
- Cost: one walk that allocates about as much as the tree (3.1 MB for the spec document), plus the old tree becoming garbage. Gain: every later pass runs on a compact tree. The measured halving of a pass (1.25 to 0.4 ms) is the best case for one pass; the copy itself is of the order of one or two passes.
- Variant: force the same effect without code by letting a scavenge happen at the right moment. Not controllable from JavaScript; `gc()` is not available in a browser. Not an option.
- Risk: node identity changes between the parse and the passes; nothing may hold a reference to the pre-copy nodes (the per-child cache's parser certificate reads the parser, not the tree: check).

### L4. Nodes in typed arrays (structure of arrays)
Keep the tree links and the scalar fields in a few large typed arrays indexed by node number, strings in side tables.
- The largest possible effect on locality and on memory per node, and the largest departure: `html.Node` would no longer be an object with pointer fields, which more than 200 call sites and the 1:1 structure of `genASTByVditorDOM` depend on.
- Listed for completeness; not recommended without a prototype that shows a gain far above the other items.

### L5. The same question for the AST
`ast.Node` objects are built by `genASTByVditorDOM` and by the Markdown parser, also interleaved with garbage, and walked by the renderers and by several tree passes (`walk` is about 3 percent of `MarkdownStr`; the plan in `003-performance-plan.md` lists four extra tree walks). Nobody has measured whether the AST walks show the same before/after-scavenge difference. Measure first; the hot/cold split of 2026-10-12 already halved the bytes per node.

## How to evaluate (binding for whoever takes this)

1. **Measure the ceiling first, without changing the parser:** in a scratch script, parse the spec DOM, then time the whole sequence of DOM passes plus `genASTByVditorDOM` (a) on the fresh tree, (b) after two forced collections (`--expose-gc`), (c) on a tree copied in traversal order by a throwaway implementation of L3. The difference between (a) and (b) is the most any locality work can win on the passes; (c) minus its own cost is what L3 would deliver. If (a) to (b) is under about 5 percent of the whole `VditorDOM2Md` call, close this task.
2. Short processes, interleaved variants, arithmetic canary, A/A run for the bias of the harness: the rules in `004-incremental-and-fast-paths.md` ("Correction: the 2.5x slowdown...") and the header of `ts/bench/macro.ts`. The bimodal timing described above means: many processes per variant, and report the distribution, not only the minimum.
3. Output hashes of all engine methods equal before any timing; `npm test`; `npm run test:full` before a commit; the cache fuzzer in both modes.
4. Any change in `html/` or to the shape of `html.Node` is a departure: `PORT-NOTE`, regenerate `ts/DEPARTURES.md` (`npm run departures`).

## Coordinator's view (not a decision)

L1 is cheap and partly under way. L3 is the only item that leaves the Go-shaped parser alone and can be judged by step 1 above in an afternoon; do that measurement before considering L2. L4 is out of proportion to the known gain.
