# 006 — Block-list API for the DOM to Markdown conversion (option D)

Status: **task, not started.** Decided by the owner on 2026-10-12 ("task na D"). Related: `004-incremental-and-fast-paths.md` (the per-child cache), `005-post-port-api-for-vmarkd.md` (what vMarkd needs from Lute), `ts/src/incremental/README.md`.

## Problem

`VditorDOM2Md(html)` and `VditorIRDOM2Md(html)` take the whole editor DOM as ONE string. The per-child cache therefore has to:

1. cut that string into top-level children with a hand-written scanner (`ts/src/incremental/scanner.ts`, 319 lines of HTML grammar knowledge that exists a second time next to the engine's parser);
2. look every child up by its text on every call, also the unchanged ones.

Step 2 makes a warm call linear in the document size: 6.5 ms for a 212 KB document, about 30 ms for 1 MB, about 0.19 s for 5 MB (the last one measured in a slow CPU window; the ratio to the normal path, about 10 times, is the reliable part). The browser already has both pieces of information the engine reconstructs: the top-level children as separate nodes, and (through the editor's input events or a MutationObserver) which of them changed.

## Goal

An additional entry point through which the host gives the engine the top-level children as a list, and optionally the indices that changed since the previous call, so that:

- the scanner is not on the path of a host that uses the new entry point (the parser certificate stays: it is what makes a per-child parse equal to the parse in context);
- a warm call costs time proportional to the changed children plus the assembly of the output, not to the document.

The existing string methods stay unchanged and keep working with the cache as today (drop-in compatibility with `javascript/lute.min.js` and with unmodified Vditor).

## Sketch (to be designed, nothing below is decided)

```
VditorDOM2MdBlocks(blocks: string[]): string
VditorIRDOM2MdBlocks(blocks: string[]): string
// blocks[i] is the outerHTML of the i-th child of the editor element, in document order.
```

Open questions for the design:

1. **Text between children.** The string API accepts and reacts to text nodes between top-level elements (the cache refuses such documents as `scan:top-level-text`). With a list of `outerHTML` strings that text is lost. Decide: the host passes `childNodes` (elements and text) and the engine refuses or handles text entries, or the API is defined on elements only and the host must guarantee there is no significant text.
2. **Equality with the string API.** The contract must be: the result equals `VditorDOM2Md(blocks.join(""))` whenever that call would have composed, and otherwise the engine falls back to exactly that call. Is `outerHTML` of each child concatenated equal to `innerHTML` of the parent for every DOM Vditor produces? (Serialisation is per node, so it should be; verify, including the caret marker and `<wbr>`.)
3. **Change hints.** `VditorDOM2MdBlocks(blocks, changed?: number[])`: are hints trusted (then a wrong hint gives a wrong document: not acceptable without a check) or only an optimisation of the lookup order with the text still compared? A safe middle: the engine keeps the previous list by reference; JavaScript strings that are identical objects need no comparison, and comparing two different string objects of equal length is a `memcmp`. Measure whether hints are needed at all once the scanner and the hashing of unchanged children are gone.
4. **Output assembly.** Even with nothing to look up, the output is rebuilt from all logs on every call (about 2 to 3 ms of the 6.5 ms at 212 KB: replay and the final string). A sublinear call needs either a returned patch (changed range of the Markdown) or a rope; both change what the host receives. Decide whether "linear with a small constant" is enough.
5. **Who calls it.** Vditor calls `VditorDOM2Md` / `VditorIRDOM2Md` itself (`getMarkdown`, the 800 ms sync after typing, and synchronously on some inputs). Using the new entry point means either a patch to Vditor or vMarkd intercepting those paths. Find the call sites in the Vditor version vMarkd ships and say which is feasible.
6. **Where the parser certificate fits.** Each list entry is parsed alone, as today. Entries the certificate refuses (raw HTML previews that change the parser state) make the call fall back, as today.

## Acceptance (draft)

- For every document of the cache's audit corpus and every edit sequence of the fuzzer: the block-list entry point returns exactly what the string entry point returns for the joined string.
- The scanner is not executed for calls through the new entry point (assert by a counter).
- Warm one-edit call measured in short processes (`ts/experiments/dom2md-cache/cold-proto/proc_time.ts` is the pattern) at 212 KB, 1 MB and 5 MB, against the string entry point with the cache.
- A negative control for every new channel (for example: a hint that is wrong must not change the result).

## Not in scope

- Removing the scanner: the string API keeps needing it.
- Any change of the Markdown output.
