# Per-child cache for VditorDOM2Md / VditorIRDOM2Md: fuzzer, negative controls, prototype

Not imported by `ts/src`, not part of `npm test`, not in `tsc`'s `include` (so `npm run typecheck` does not check this directory). Nothing under `ts/src` is changed by anything here: the controls run on copies. The engine itself is `ts/src/incremental/`; its design is in `tasks/004-incremental-and-fast-paths.md` ("Milestone B specification", "Milestone B implementation", and "Negative controls and context witnesses: analysis (2026-10-11)" with "Implementation (negative controls and fuzzer)").

## Files

| File | Purpose |
|---|---|
| `engine-adapter.ts` | `EngineDom2Md`: engine A (the cache, strict, verify off) and engine B (the reference, same setters). The surface the fuzzer uses (`convert`, `uncached`, `stats`, `lastFallbackReason`, `clear`, `size`), plus `lastInconsistency` and `counters()` |
| `fuzz.ts` | differential fuzzer: passes warm, cold, shared, evict; `--impl=engine` (default) or `--impl=prototype`; `--check=replay`; `--report=real` |
| `negative-control.ts` | the controls of the 2026-10-11 analysis: one changed statement per scratch copy, the tests and the fuzzer run against each |
| `cached.ts`, `scan.ts`, `corpus.ts`, `repro/` | the spike's prototype (`CachedDom2Md`, its own splitter, the corpus and the regression cases of the prototype); used by `--impl=prototype` and by `repro/` |
| `bench.ts` | rough timing of a warm one-edit call of the prototype |

The generator of the fuzzer and of `test/incremental/edits.test.ts` is one module, `test/incremental/edit_generator.ts` (16 edits; a mixed pick takes one of three channel children with probability `CHANNEL_WEIGHT` = 0.2). The corpus of the fuzzer is `corpus.ts` (Markdown from the repository, converted by the reference bundle; `--corpus-snapshot=<file>` freezes it and prints its sha256).

## Commands

Run from `ts/`. Node 24 type stripping, no build.

```
# fuzzer, engine (default): warm, cold, shared and evict passes, 2 modes; the corpus frozen in a snapshot file
node experiments/dom2md-cache/fuzz.ts --mode=wysiwyg --cmp=3000 --seed=1 --no-precheck --corpus-snapshot=<scratch>/corpus.json
node experiments/dom2md-cache/fuzz.ts --mode=ir      --cmp=3000 --seed=1 --no-precheck --corpus-snapshot=<scratch>/corpus.json
node experiments/dom2md-cache/fuzz.ts --pass=evict --mode=wysiwyg --cmp=3000 --seed=2 --no-precheck --corpus-snapshot=<scratch>/corpus.json   # one pass

# replay of the recording renderer's log against the uncached output (milestone A; no cache involved)
node experiments/dom2md-cache/fuzz.ts --check=replay --mode=wysiwyg --cmp=5000 --seed=1 --corpus-snapshot=<scratch>/corpus.json

# fallback rate on whole documents (no edits)
node experiments/dom2md-cache/fuzz.ts --report=real --mode=wysiwyg

# the prototype (the spike's CachedDom2Md); its repro cases run first (precheck) unless --no-precheck
node experiments/dom2md-cache/fuzz.ts --impl=prototype --mode=wysiwyg --cmp=1500 --seed=7

# negative controls: each one is a changed statement of a scratch copy; output is a table
export D2M_SCRATCH=<a scratch directory>        # default: the OS temp directory, d2m-nc
node experiments/dom2md-cache/negative-control.ts --jobs=4 --cmp=2000
node experiments/dom2md-cache/negative-control.ts --only=NC1,NC2     # a subset (the baseline always runs first)
```

The negative controls copy `ts/src`, `ts/test` and the top-level files of this directory into `$D2M_SCRATCH/<id>/ts`, link the directories of the repository root into `$D2M_SCRATCH/<id>/` (the tests reach the Markdown files through `REPO_ROOT`), apply one change, and run `context_channels`, `witnesses`, `edits`, `dom2md_incremental_regressions`, `piece_assembly`, `dom2md_incremental` with `node --test`, then the fuzzer (two modes, seeds 1 and 2, `--cmp` each). The baseline copy (no change) must be green with 0 mismatches before any control runs. The copies are kept for inspection.

## What each pass checks

Every comparison: the engine under test (A, strict) and the reference (B) are called on the same HTML; outputs and exceptions must be equal (after node-ID normalisation, as the oracle tests do). An `IncrementalInconsistency` of A is a mismatch even when B throws too.

| pass | what it exercises |
|---|---|
| `warm` | a new engine A for each edit sequence (8 to 28 edits), so that every child of a sequence is first a miss and later a hit with the variants of the sequence |
| `cold` | a new engine A for each comparison: nothing is reused, so a difference can only come from the current document |
| `shared` | one engine A per option set for all sequences: entries and variants of unrelated documents are reused |
| `evict` | one engine A per option set with `maxBytes` = 256 KiB: eviction, the `too-large` fallback and the clear at the bound run constantly. A pass with no eviction is reported as VACUOUS |

Each pass prints: comparisons, composed and fallback calls, mismatches (by cause), composed-call hits and misses, the engine's evictions, `too-large` fallbacks and inconsistencies (with their reasons). "bytes probed" is not available for the engine (its statistics have no per-miss byte counter; this would need a `ts/src` change). Option toggles (`SetProtyleWYSIWYG`) are applied to both engines at random points of a sequence.

The start documents are windows of the corpus documents, or of their children with foreign children inserted (`startDoc`, kept from the spike). The edits are the 16 of the shared generator.

What the fuzzer does NOT check any more (removed with the prototype's edit generator, which had 16 kinds in the spike): first-byte whitespace edits (`first-ws`, `prepend-ws-paragraph`, `empty-first`), list and blockquote trimmers (`append-trimmer`), targeted neighbourhood edits (`targeted-*`), transient junk (a comparison of a view with a filler child), empty blocks, splits, list moves, tag restyles, typing bursts. The R1 cases (leading Unicode white space) are covered by the regression list of the tests (`dom2md_incremental_regressions.test.ts`), not by the fuzzer.

The repro scripts (`repro/run.ts`, `repro/sweep.ts`) import the prototype; they are not run for the engine. `precheck` runs them only for `--impl=prototype`.

## Negative controls: caught or not, and where

The controls of `negative-control.ts` (expectations of section 6 step 5 of the analysis). "Caught" means a test of the list above fails or the fuzzer prints a mismatch or an inconsistency for one of the two seeds. The evidence of the last run (table printed by `negative-control.ts`, copy in `$D2M_SCRATCH/summary.json`):

| control | what | expected | observed | caught by (first evidence) |
|---|---|---|---|---|
| NC1 isLast forced true | assemble.ts | caught | caught | witnesses; fuzz 3842 mismatches (both modes, seeds 1-2) |
| NC2 prev forced -1 | assemble.ts | caught | caught | witnesses; fuzz 481 mismatches |
| NC3 next forced -1 | assemble.ts | silent (equivalent) | silent | 0 mismatches, no test fails |
| NC4 domNext forced -1 | assemble.ts | caught | caught | regressions (p with br before list); fuzz 174 |
| NC5 domNext not recorded | sandbox.ts | caught | caught | regressions and fuzz (same documents as NC4) |
| NC9 TrimSpaceAll does not trim | assemble.ts | caught | caught | regressions (U+3000 paragraph); fuzz 2450 (repro scripts are prototype-only, not run) |
| NC11 variants[0] always | assemble.ts | caught | caught | regressions; fuzz 4923 |
| NC12' hoist across barriers | sandbox.ts | caught | caught | regressions; fuzz 6230 mismatches and 3166 inconsistencies (replay:lastout-diverged) |
| NC13' trim LF only | assemble.ts | caught | caught | edit simulation; fuzz 13 (evict pass, leading-go-space) |
| NC14 generated-id scan removed | sandbox.ts | caught (unit) | caught | context_channels NC14 unit test only |
| NC15 lastOut returns 10 | sandbox.ts | caught (unit) | caught | context_channels pinned lastOut witness only |


Controls of the spike (`cached.ts` mutants, `negative-control.ts` before this revision: `constsep`, `trim-parts`, `no-next-bit`, `no-last-bit`, `dom-last`, `raw-neighbours`, `no-adjacent-lists`, `no-fingerprint`, `no-leak-check`, `no-clean-check`, `allow-*`) were run against the prototype. They are not in the engine's table; the prototype's results are in the spike section of `tasks/004`. Their mutants were removed from `negative-control.ts` with the switch to the engine (not kept behind `--impl=prototype`).

## Prototype results (spike, not re-run for the engine)

The spike's numbers (fallback rate, 50,000-comparison fuzz, bench) are in `tasks/004-incremental-and-fast-paths.md`, section "Spike: per-child cache for VditorDOM2Md (2026-10-11)". The corpus and the regression cases of `repro/` are the prototype's own.
