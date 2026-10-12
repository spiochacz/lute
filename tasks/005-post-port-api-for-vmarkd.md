# 005 — What vMarkd needs from Lute after the 1:1 port

Notes from a brainstorm with the user on 2026-10-11. Nothing here is decided or scheduled. The full
discussion (Vditor fork, SV mode, staying on Vditor 3.x) is recorded in the vMarkd repo:
`tasks/534-own-the-editor-stack-brainstorm.md`
(WSL `Ubuntu-24.04`, `/home/piochu/projects/vscode-markdown-editor-extanded-settings`).

## Context

- vMarkd (the user's VS Code extension) embeds Vditor 3.11.3 and a pinned `lute.min.js`. The user
  plans to fork Vditor and is leaning towards staying on 3.x.
- With both Lute and the editor owned, the boundary between them (HTML strings today) can change.
- **Nothing below starts before the port matches the Go original.** The port's value is that it can
  be checked against the oracle; new API comes after that.

## Scope consequence for the port

Vditor 4.0.0 turned SV mode into a plain `<textarea>` and no longer needs Lute's SV rendering. vMarkd
stays on 3.x, so **`Md2VditorSVDOM` and `SpinVditorSVDOM` remain in scope**: swapping the port into
vMarkd behind an unchanged API is the acceptance test for the port, and SV-mode tests need them.

## Lute functions vMarkd calls today

Read from the vMarkd source on 2026-10-11:

- `Md2VditorIRDOM`, `SpinVditorIRDOM`, `VditorIRDOM2Md`
- `Md2VditorDOM`, `SpinVditorDOM`, `VditorDOM2Md`
- `Md2VditorSVDOM`, `SpinVditorSVDOM`
- `Md2HTML`, `SetJSRenderers`, `SetSoftBreak2HardBreak`
- `Lute.New`, `Lute.Caret`

## API to add after parity, in this order

1. **Source ranges on block nodes** (start and end offset in the input). Go's AST stores none: the
   parser has an offset only while running (`lex/lexer.go`, `parse/parse.go`). This lets the editor
   save a file by copying untouched blocks byte for byte and serializing only edited ones, which
   removes the "one keystroke rewrites the whole file" class of bugs.
2. **Token ranges for inline syntax**, returned as data instead of HTML. Used for source-mode
   colouring (CSS Custom Highlight API or a highlight layer under a `<textarea>`) and for mapping a
   cursor to a source offset.
3. **Parsing one block with its context** (link reference definitions, footnotes, front matter), so
   the editor stops gluing neighbouring blocks together by hand.
4. **AST or DOM nodes as output** instead of an HTML string.

## Fixes that move into Lute

vMarkd corrects Lute's output from outside. Once the port may diverge from Go, these become parser or
renderer fixes (cross-check with `002-upstream-bugs.md` before adding entries there):

- `Md2VditorDOM` invents a space before inline code glued to text: `` a`b` `` → `` a `b` ``.
- `Md2VditorIRDOM` emits an indented code block without marker spans, so `VditorIRDOM2Md` writes it
  back as a paragraph.
- `Md2VditorIRDOM` drops the title of a link reference definition; for an image reference the title
  leaks into the inline node as text.
- The same title and fence-info defects in `Md2VditorSVDOM`.

Source in vMarkd: `src/shared/lute-gap-repair.ts`, `src/shared/lute-block-repair.ts`.
