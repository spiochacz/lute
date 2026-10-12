# Per-child cache of `VditorDOM2Md` and `VditorIRDOM2Md`

`src/incremental/` is a cache for the two conversions of the Vditor DOM to Markdown: `VditorDOM2Md` (WYSIWYG, `vditor_wysiwyg.ts`) and `VditorIRDOM2Md` (Instant Rendering, `vditor_ir.ts`). It is not part of the 1:1 port (`ts/PORTING.md`, "Code without a Go counterpart"). A call returns the same string as the normal path (`vditorDOM2Md`, `vditorIRDOM2Md`), or it returns nothing and the normal path runs.

## What it does

The input string is cut into its top-level elements. Each element (a child) is converted once, alone, into its root-writer log: the operations that the renderer writes to the output. A later call whose document has the same child, in a context that the child's log does not depend on, replays the stored log instead of converting the child again. The output is the replay of the logs, child by child, and the document close.

Only the two public wrappers use the cache. Nothing else in the engine changes its behaviour.

## Model

- **Top-level children.** `scanner.ts` cuts the string into children without building a DOM. It accepts only the grammar it documents (G1 to G5); anything else is a fallback with a scan code. The cut is then certified by the engine's own HTML parser (`parser_certificate.ts`): a child is certified when parsing it alone reaches the same parser state at its end as the reference `<hr>`.
- **Per-child log.** A child's entry holds its string, its `ChildInfo` (alive, atom, attrs, topTypes), its refusal (if any) and its variants. A variant is the root-writer log of one run (`RootOp` list, coalesced), the `LastOut` at its end, and its key.
- **Context key.** The key of a variant is `lastOut,prev,next,domPrev,domNext,domNextAttrs` (`contextKey` in `piece.ts`). `lastOut` is the renderer's LastOut at entry; `prev` and `next` are the AST node types of the neighbouring emitted nodes; `domPrev`, `domNext` are the DOM atoms of the nearest alive siblings, and `domNextAttrs` their attribute count. A variant is used only for an equal key. At most 16 variants per child (`MAX_VARIANTS`); the oldest is dropped.
- **Parser certificate.** Only certified children are analysed. In strict mode the sandwich check (`sandwichCheck`) is also run on each newly certified child.
- **Barrier stubs.** A child runs with its neighbours replaced by stubs (`barrier.ts`). The DOM stubs answer `DataAtom`, `Type` and, for the next sibling, `Attr` (a count). The AST stubs answer `Type` and the methods of `ast.Node.prototype`. Any other read, or any write, throws `BarrierViolation`, which becomes an inconsistency. The key holds every field that the stubs expose.
- **Sandbox phases** (`sandbox.ts`). Each child runs in three phases:
  1. *analyse*: parse with the certificate (or without it, for a child already certified), then the first three DOM passes of `adjustVditorDOM` (the passes whose `phase` is `"analyse"` in `ADJUST_VDITOR_DOM_PASSES`). A child removed by `removeEmptyNodes` is dead.
  2. *build*: the DOM neighbours are linked to the stubs; the remaining DOM passes run on the child; `genAST`; a check that the tip is back at the root (an open tip is `tip-open`); `adjustTree`. The child's `ChildInfo` is complete after this phase.
  3. *render*: the AST neighbours are linked to stubs; the recording renderer (`render/recording_format_renderer.ts`) renders the child with `LastOut` of the key; the log is coalesced.
  `runChild` is the three phases for one context. Each phase runs under `withoutNodeIDs`: if `ast.NewNodeIDCalls` moved, the child is refused as `generated-id`.
- **Call order** (`assemble.ts`): options fingerprint; preprocess; scan; lookup of the children (new children are entered); stored refusals (the first in document order ends the call); analyse of the new children (opaque children first); list coupling; DOM sweeps (the nearest alive siblings of each child); build of the new alive children in document order; AST sweeps (the neighbouring emitted node types); replay child by child; document close; output; eviction; `verify` when enabled.
- **Replay.** For each alive child, the variant with the key of its position is used. If there is none, the child is rendered from its build of this call when that build had the same DOM context; otherwise it runs in full with the exact context (`runChild`). A new variant is stored after a run.
- **Negative memo.** One memo per mode holds the entry whose stored refusal ended the last call, when the refusal is `cert:opaque-preview`, `tip-open`, `generated-id` or `engine-threw` (the refusals that depend only on the child and the options). A call whose string still contains that child is answered with the stored reason and no other work (`memoHits`). Every 32nd hit runs the full path instead, which refreshes or clears the memo.
- **Eviction.** The state holds two maps (WYSIWYG, IR) and a byte estimate. The bound is `maxBytes` (default 64 MiB). When it is exceeded at the end of a call, entries not touched by that call are removed in insertion order until 75 percent of the bound; if the total is still over the bound, both maps are cleared.
- **Options.** `fingerprint` reads every own field of `ParseOptions` and `RenderOptions` on every call. A change clears both maps (`optionClears`). An unknown field type is `options-not-fingerprintable`.

## Invariants

1. Neither `State` nor `Entry` holds a DOM node, an AST node or a renderer. Handles (the DOM of a child between its phases) live inside one call.
2. A stub or guard that is read beyond its declared fields throws `BarrierViolation`; the phase reports it as an inconsistency (`barrier:<site>`).
3. The variant key contains every field that the stubs expose (`Context` fields, `contextKey`). `context_key.test.ts` enumerates the fields.
4. An inconsistency is never cached: its entry is removed, and the call falls back. An unsupported refusal is cached on its entry (the child is not run again).
5. The render options of a call are frozen (`Object.freeze`): a renderer that writes to them throws instead of leaking state between children.
6. A fallback is always one of the categories below, and its name is a property of the refusal, never a condition on the Markdown construct.
7. A node ID created by a phase refuses the child; the cache never reproduces a random ID.

## Fallback categories (`unsupported`, counted in `stats.unsupported`)

- `options-not-fingerprintable`: an option field has a type the fingerprint does not know.
- `empty-document`: the scanner found no top-level element.
- `scan:top-level-text`: text outside any element at top level.
- `scan:comment-or-doctype`: a comment or a doctype.
- `scan:stray-lt`: a `<` that does not start a tag.
- `scan:tag-not-allowed`: an element not in the allowed set (G2).
- `scan:top-level-tag`: a top-level element that is not one of the allowed top-level tags (G4).
- `scan:upper-case-tag`: an upper-case tag name.
- `scan:malformed-end-tag`: an end tag that is not well formed.
- `scan:mismatched-end-tag`: an end tag that does not match the open element.
- `scan:unterminated`: the child is not closed before the end of the string.
- `scan:unterminated-tag`: a start tag that is not closed.
- `scan:self-closing-non-void`: `/>` on an element that is not void.
- `scan:implicit-end-tag`: a start tag that would close an open element in HTML parsing (for example a block inside a `p`).
- `scan:table-structure`: a table part in a position that the table grammar does not allow.
- `scan:unterminated-attribute`: an attribute value that is not closed.
- `scan:unterminated-preview`: a skipped data-render preview `<pre>` without its end tag.
- `cert:opaque-preview`: a child with a data-render preview fails its certificate.
- `tip-open`: `genAST` leaves the tip of the tree open (an unclosed block).
- `list-coupling`: the list pass of the engine would merge two alive children, so they are not independent.
- `generated-id`: a phase created a node ID.
- `engine-threw`: a phase threw any other exception.
- `too-large`: the stored bytes exceed `maxBytes` at the lookup.

## Inconsistencies (counted in `stats.inconsistencies`; strict mode throws them)

- `cert:scanner-accepted-certificate-refused`: the scanner accepted a child that the certificate refuses (no preview in it).
- `sibling-structure-changed`: a DOM pass changed the top-level links or the top-level sibling structure.
- `top-level-atom-changed`: the DataAtom of the top-level element changed across the DOM passes.
- `info-changed`: a run of a child gave a `ChildInfo` different from the stored one.
- `replay:lastout-diverged`: (strict only) the replayed `LastOut` differs from the variant's end value.
- `replay:unlogged-mutation`: reserved in the list; no code emits it.
- `strict:sandwich`: (strict only) the sandwich check of a newly certified child failed.
- `strict:output-differs`: (`verify` only) the composed output differs from the normal path's.
- `barrier:<site>`: a stub or guard was read or written beyond its fields.

## Policy (`policy.ts`)

Each engine has a policy: `"auto"` (the default), `"on"` or `"off"`.

- `"on"` (`EnableIncrementalDom2Md`, `SetIncrementalDom2MdPolicy(lute, "on")`, `lute.SetIncrementalDom2Md(true)`): the cache runs. It never backs off.
- `"off"` (`DisableIncrementalDom2Md`, `"off"`, `lute.SetIncrementalDom2Md(false)`): the cache is never used; its state is dropped, and so are its statistics (`IncrementalDom2MdStats` returns null).
- `"auto"`: the cache starts by itself on a call when both hold:
  - (a) the HTML string has at least `AUTO_MIN_HTML_LENGTH` (4096) characters;
  - (b) the previous qualifying call of the same mode was similar: its length is within 25 percent of this one's (of the longer one), and its first 64 characters or its last 64 characters equal this one's.
  
  The engine keeps only the length and the 64-character head and tail of the previous call per mode, never the document. The first qualifying call never starts the cache. The starting call runs with a cold cache and is not counted by the back-off.
- Back-off (`"auto"` only): a call after an automatic start is bad when it fell back or had more misses than hits. After 3 consecutive bad calls the state is dropped, `autoBackoffs` is incremented, and the engine is "not started" again. It then stays not started for a cool-down of `AUTO_COOLDOWN_CALLS` (16) qualifying calls, doubled with every further back-off up to `AUTO_COOLDOWN_MAX` (1024), so that a document that keeps falling back does not pay a cold fill every few calls. A cache started by `"on"` is not affected. Setting `"auto"` on an engine whose cache is running keeps the cache and makes it an automatically started one.

Routing: while any engine has a running cache, the wrappers call the handler for every call, whatever the length. Otherwise they call it only when the string is at least `incrementalAuto.minLength` long (4096 once the module is loaded, `Infinity` before). With the module not loaded, the wrappers run one integer test and one length comparison, then the normal path.

Statistics: `IncrementalDom2MdStats(lute)` (and `lute.IncrementalDom2MdStats()`) returns the counters: `calls`, `composed`, `fallbacks` (composed + fallbacks = calls), `unsupported`, `inconsistencies`, `children`, `hits`, `misses`, `sandboxRuns`, `analyses`, `builds`, `renders`, `memoHits`, `bytesIn`, `entries`, `bytesHeld`, `evictions`, `optionClears`, `autoStarts`, `autoBackoffs`. The automatic counters are readable while the cache is not running (the other counters are then zero). `ResetIncrementalDom2MdStats` zeroes all of them; the cache is kept.

## Hooks in the default path

Each hook is marked `PORT-NOTE: hook for the per-child cache (tasks/004)`. None changes the output.

- `src/vditor_wysiwyg.ts`: `VditorDOM2Md` (the wrapper: one test of `incrementalActive.count` and `incrementalAuto.minLength`, then `tryIncrementalDom2Md`); the stage functions `vditorDOM2MdPreprocess`, `vditorDOM2MdPrepare`, `vditorDOM2MdBuildTree`, `vditorDOM2MdAdjustTree`, `vditorDOM2MdRenderOptions`, `vditorDOM2MdRender` (the normal path runs them in this order; the sandbox calls the preprocess, adjust-tree and render-options stages); the table `ADJUST_VDITOR_DOM_PASSES` with `runAdjustVditorDOMPass`, which `adjustVditorDOM` runs, and whose `phase` field the sandbox reads.
- `src/vditor_ir.ts`: the same for `VditorIRDOM2Md`. `adjustVditorDOM` is shared with the WYSIWYG path (no separate IR table). Both wrappers import `dispatch.ts`; nothing else in the engine does.
- `src/render/format_renderer.ts`: `newBuffer` and `trimWriterTo`, the two ways the writer of a container is created and the root writer is trimmed. The default of each is the statement it replaces; the recording renderer of the sandbox uses them.
- `src/ast/node.ts`: `NewNodeIDCalls`, the counter of `NewNodeID` calls.
- `src/bundle.ts` and `src/index.ts`: load `src/incremental/index.ts`, which registers the handler and defines the public API. `src/incremental/index.ts` also defines `Lute.prototype.SetIncrementalDom2Md` and `Lute.prototype.IncrementalDom2MdStats`.

`dispatch.ts` holds the counter, the length threshold, the handler slot and the registry of states (a `WeakMap` per engine). The engine's files import nothing else of this directory.

## Testing

Unit tests (`test/incremental/*.test.ts`): the context key and its fields (`context_key`), the witnesses of each context field and the NC14 refusal (`context_channels`, `witnesses`), the barrier (`barrier`), the parser certificate, the scanner, the pass order (`adjust_passes`), the cache state and eviction (`cache`), the negative memo, the edits and the generated IDs (`generated_ids`), the policy (`policy`). `reference_engine.ts` is the normal path for the differential tests (an engine with policy `"off"`).

End-to-end tests (`test/e2e/root/`): `dom2md_incremental*.test.ts` compare the cache (strict and verify) with the normal path on the corpus, in both modes and under several option sets; `dom2md_replay.test.ts` replays the logs. `test/e2e/bundle.test.ts` checks the bundle and the two engine methods that the port adds.

Fuzzer and negative controls (`experiments/dom2md-cache/`, not part of `npm test`; see its README):

```
node experiments/dom2md-cache/fuzz.ts --mode=wysiwyg --cmp=3000 --seed=1 --no-precheck --corpus-snapshot=<scratch>/corpus.json
node experiments/dom2md-cache/fuzz.ts --mode=ir --cmp=3000 --seed=1 --no-precheck --corpus-snapshot=<scratch>/corpus.json
node experiments/dom2md-cache/negative-control.ts --jobs=3 --cmp=500     # with D2M_SCRATCH set to a scratch directory
```

`negative-control.ts` changes one statement of a scratch copy of `src/` and requires the tests and the fuzzer to catch it. The table in the experiments README lists the controls and where each is caught.

## Known limits

- The first call on a document (or after a clear) runs every child through the three phases and stores it, so it does more work than the normal path. Its cost is not measured here.
- The byte estimate is approximate; `maxBytes` bounds the stored entries and variants, not the process memory.
- An unclosed block leaves the tip open: the child is refused (`tip-open`), so the document falls back to the normal path.
- A single top-level child that is huge is one unit: an edit inside it re-runs its three phases for the whole child.
- A child whose phase creates a node ID is always refused, even when the ID does not reach the output.
- The fingerprint of a `Map` option is a 32-bit hash with the entry count and the character count; a change that gives the same hash, count and characters is not seen.
- An option change between calls clears the stored entries (`optionClears`); the next call starts cold.
