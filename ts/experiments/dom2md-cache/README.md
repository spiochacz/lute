# Per-child cache for VditorDOM2Md / VditorIRDOM2Md (feasibility spike)

Prototype, differential fuzzer and negative controls. Not imported by `ts/src`, not part of `npm test`, not in `tsc`'s `include`. Nothing under `ts/src` or `ts/test` was changed. Full write-up: section "Spike: per-child cache for VditorDOM2Md (2026-10-11)" in `tasks/004-incremental-and-fast-paths.md`.

## Files

| File | Purpose |
|---|---|
| `scan.ts` | top-level splitter for the editor HTML; refuses anything it cannot cut exactly as the engine's HTML parser would |
| `cached.ts` | `CachedDom2Md(lute, "wysiwyg" \| "ir")`: `convert(html)` (cached), `uncached(html)` (reference), stats, optional timing |
| `corpus.ts` | Markdown corpora, option sets, forward conversion with the reference bundle (`Md2VditorDOM`, `Md2VditorIRDOM`) |
| `fuzz.ts` | differential fuzzer (warm, cold, shared passes), `--report=real` for the fallback rate on whole documents |
| `negative-control.ts` | runs the fuzzer against deliberately wrong copies of `cached.ts` (and against copies with a fallback removed) |
| `bench.ts` | rough timing of a warm one-edit call |

## Commands

Run from `ts/`. Node 24 type stripping, no build.

```
# fallback rate on whole documents (19 repository files + about 1,500 unit-test snippets): about 10 s per mode
node experiments/dom2md-cache/fuzz.ts --report=real --mode=wysiwyg
node experiments/dom2md-cache/fuzz.ts --report=real --mode=ir

# smoke (what was run in the spike): about 10 s
node experiments/dom2md-cache/fuzz.ts --mode=wysiwyg --cmp=1500 --seed=7

# full differential fuzz, 50,000+ comparisons per mode, all three passes (warm, cold, shared) and 5 option sets.
# --cmp is per mode. Measured speed: about 130 comparisons/s on a quiet machine => 50,000 per mode is about 6.5 min.
# Run in pieces below 8 minutes: one seed per command, summing the totals. 6 seeds => 60,000 comparisons per mode.
for s in 1 2 3 4 5 6; do node experiments/dom2md-cache/fuzz.ts --mode=wysiwyg --cmp=10000 --seed=$s; done   # about 80 s each
for s in 1 2 3 4 5 6; do node experiments/dom2md-cache/fuzz.ts --mode=ir      --cmp=10000 --seed=$s; done   # about 90 s each
# single pass / config: --pass=warm|cold|shared  --config=vditor|vditor+toc+callout|protyle+ial+spin|defaults|no-preview+list-style

# negative controls and fallback-necessity controls (14 mutants x 2 modes x 4,000 comparisons, about 6 min in two halves)
export D2M_SCRATCH=<a scratch directory>
node experiments/dom2md-cache/negative-control.ts --only=constsep,trim-parts,no-next-bit,no-last-bit,dom-last,raw-neighbours,no-adjacent-lists
node experiments/dom2md-cache/negative-control.ts --only=no-fingerprint,no-leak-check,no-clean-check,allow-link-ref-defs,allow-footnotes,allow-other-div,allow-top-inline

# timing: 1 to 2 minutes, run on a quiet machine; add --doc=article for the composable document
node experiments/dom2md-cache/bench.ts --runs=9 --doc=article
node experiments/dom2md-cache/bench.ts --runs=9 --doc=spec     # WYSIWYG only; IR falls back on the spec (see report)
```

The fuzzer prints, per mode and per pass: comparisons, how many were answered by composition and how many by fallback, mismatches, hit rate, bytes re-processed, the fallback reasons, and a reduced child sequence for any mismatch. A mismatch means: fix the rule or widen the fallback. Never weaken the comparison.

## What the cache does

`result(doc) = trim(U_1 + ... + U_n) + "\n"`, `U_i` the untrimmed output of child i, obtained by calling the engine on `<hr> + child + <hr>` (or a blockquote, or nothing, see the four variants) and slicing. See the header of `cached.ts` and the report for the rules, the key and every fallback.

## What was run in the spike (honest counts)

See the report section. In short: the whole-document check on the corpus, and a few thousand fuzz comparisons per mode in bounded pieces, all with 0 mismatches for the final rules; the 50,000-per-mode run, the timing and the negative controls on the final build are still to be run with the commands above.
