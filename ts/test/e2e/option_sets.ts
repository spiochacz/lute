// Option sets (lists of setter calls applied to both the port engine and the oracle engine) shared by the end-to-end tests.

import type { SetterCall } from "./helpers.ts";

export interface OptionSet {
  name: string;
  setters: SetterCall[];
}

// Every set toggles a few options of lute.go; together they use the setters listed in COVERED_SETTERS.
export const OPTION_SETS: OptionSet[] = [
  { name: "default", setters: [] },
  { name: "no GFM table", setters: [["SetGFMTable", false]] },
  { name: "no GFM task list item", setters: [["SetGFMTaskListItem", false]] },
  { name: "no GFM strikethrough", setters: [["SetGFMStrikethrough", false]] },
  { name: "no GFM auto link", setters: [["SetGFMAutoLink", false]] },
  { name: "strikethrough1 and full width", setters: [["SetGFMStrikethrough1", true], ["SetFullWidthStrikethrough", true]] },
  {
    name: "task list options",
    setters: [
      ["SetArbitraryTaskListItemMarker", true],
      ["SetDataTask", true],
      ["SetGFMTaskListItemClass", "task-item"],
      ["SetExportNormalizeTaskListMarker", true],
    ],
  },
  { name: "no footnotes", setters: [["SetFootnotes", false]] },
  { name: "ToC", setters: [["SetToC", true]] },
  { name: "no heading ID", setters: [["SetHeadingID", false]] },
  { name: "heading anchor", setters: [["SetHeadingAnchor", true]] },
  { name: "no auto space", setters: [["SetAutoSpace", false]] },
  { name: "no fix term typo", setters: [["SetFixTermTypo", false]] },
  { name: "Chinese paragraph beginning space", setters: [["SetChineseParagraphBeginningSpace", true]] },
  { name: "no soft break to hard break", setters: [["SetSoftBreak2HardBreak", false]] },
  { name: "sanitize", setters: [["SetSanitize", true]] },
  { name: "link base and prefix", setters: [["SetLinkBase", "https://example.com/base"], ["SetLinkPrefix", "https://example.org/prefix/"]] },
  { name: "image lazy loading", setters: [["SetImageLazyLoading", "data-src"]] },
  { name: "no code syntax highlight", setters: [["SetCodeSyntaxHighlight", false]] },
  {
    name: "code highlight variants",
    setters: [
      ["SetCodeSyntaxHighlightInlineStyle", true],
      ["SetCodeSyntaxHighlightLineNum", true],
      ["SetCodeSyntaxHighlightStyleName", "github"],
      ["SetCodeSyntaxHighlightDetectLang", true],
    ],
  },
  { name: "no emoji", setters: [["SetEmoji", false]] },
  { name: "emoji site", setters: [["SetEmojiSite", "https://emoji.example.com"]] },
  { name: "mark sup sub tag", setters: [["SetMark", true], ["SetSup", true], ["SetSub", true], ["SetTag", true]] },
  { name: "inline math", setters: [["SetInlineMath", true]] },
  { name: "inline math digit after open marker", setters: [["SetInlineMath", true], ["SetInlineMathAllowDigitAfterOpenMarker", true]] },
  { name: "block ref and file annotation ref", setters: [["SetBlockRef", true], ["SetFileAnnotationRef", true]] },
  { name: "super block", setters: [["SetSuperBlock", true]] },
  { name: "git conflict", setters: [["SetGitConflict", true]] },
  { name: "kramdown IAL", setters: [["SetKramdownIAL", true]] },
  { name: "kramdown block IAL", setters: [["SetKramdownBlockIAL", true], ["SetKramdownIALIDRenderName", "data-id"]] },
  { name: "kramdown span IAL", setters: [["SetKramdownSpanIAL", true]] },
  { name: "render list style", setters: [["SetRenderListStyle", true]] },
  { name: "no indent code block", setters: [["SetIndentCodeBlock", false]] },
  { name: "no setext", setters: [["SetSetext", false]] },
  { name: "no yaml front matter", setters: [["SetYamlFrontMatter", false]] },
  { name: "no link ref", setters: [["SetLinkRef", false]] },
  { name: "paragraph beginning space", setters: [["SetParagraphBeginningSpace", true]] },
  { name: "img path allow space", setters: [["SetImgPathAllowSpace", true]] },
  { name: "custom block", setters: [["SetCustomBlock", true]] },
  { name: "no inline asterisk", setters: [["SetInlineAsterisk", false]] },
  { name: "no inline underscore", setters: [["SetInlineUnderscore", false]] },
  { name: "data image", setters: [["SetDataImage", true]] },
  { name: "text mark", setters: [["SetTextMark", true], ["SetHTMLTag2TextMark", true]] },
  { name: "spin", setters: [["SetSpin", true]] },
  { name: "callout and tabs", setters: [["SetCallout", true], ["SetTabs", true]] },
  { name: "ensure list item paragraph", setters: [["SetEnsureListItemParagraph", true]] },
  { name: "list marker, img tag, link space", setters: [["SetUnorderedListMarker", "*"], ["SetImgTag", true], ["SetPreventEncodeLinkSpace", true]] },
  { name: "spellcheck and protyle net img", setters: [["SetSpellcheck", true], ["SetProtyleMarkNetImg", true]] },
  { name: "vditor previews", setters: [["SetVditorCodeBlockPreview", true], ["SetVditorMathBlockPreview", true], ["SetVditorHTMLBlockPreview", true]] },
  { name: "html2markdown attrs", setters: [["SetHTML2MarkdownAttrs", ["id", "class"]]] },
  { name: "Vditor WYSIWYG", setters: [["SetVditorWYSIWYG", true]] },
  { name: "Vditor IR", setters: [["SetVditorIR", true]] },
  { name: "Vditor SV", setters: [["SetVditorSV", true]] },
  {
    name: "Protyle",
    setters: [
      ["SetProtyleWYSIWYG", true],
      ["SetBlockRef", true],
      ["SetFileAnnotationRef", true],
      ["SetKramdownIAL", true],
      ["SetTag", true],
      ["SetSuperBlock", true],
      ["SetImgPathAllowSpace", true],
      ["SetGitConflict", true],
      ["SetMark", true],
      ["SetSup", true],
      ["SetSub", true],
      ["SetInlineMathAllowDigitAfterOpenMarker", true],
      ["SetFootnotes", false],
      ["SetToC", false],
      ["SetIndentCodeBlock", false],
      ["SetParagraphBeginningSpace", true],
      ["SetAutoSpace", false],
      ["SetHeadingID", false],
      ["SetSetext", false],
      ["SetYamlFrontMatter", false],
      ["SetLinkRef", false],
      ["SetCodeSyntaxHighlight", false],
      ["SetSanitize", true],
    ],
  },
  {
    name: "everything on",
    setters: [
      ["SetGFMStrikethrough1", true],
      ["SetFullWidthStrikethrough", true],
      ["SetArbitraryTaskListItemMarker", true],
      ["SetDataTask", true],
      ["SetToC", true],
      ["SetHeadingAnchor", true],
      ["SetChineseParagraphBeginningSpace", true],
      ["SetMark", true],
      ["SetSup", true],
      ["SetSub", true],
      ["SetTag", true],
      ["SetInlineMath", true],
      ["SetBlockRef", true],
      ["SetFileAnnotationRef", true],
      ["SetSuperBlock", true],
      ["SetGitConflict", true],
      ["SetKramdownIAL", true],
      ["SetRenderListStyle", true],
      ["SetCustomBlock", true],
      ["SetCallout", true],
      ["SetTabs", true],
      ["SetTextMark", true],
      ["SetEnsureListItemParagraph", true],
      ["SetParagraphBeginningSpace", true],
      ["SetImgPathAllowSpace", true],
    ],
  },
];

// Setters used by OPTION_SETS (the other setters of lute.go are covered by the dedicated renderer tests).
export const COVERED_SETTERS: string[] = Array.from(
  new Set(OPTION_SETS.flatMap((s) => s.setters.map((c) => c[0]))),
).sort();

// A small set of sets, for the big files.
export const BIG_FILE_SET_NAMES: string[] = ["default", "no GFM auto link", "kramdown IAL", "Protyle", "everything on"];

// The option sets used by the fuzz test.
export const FUZZ_SET_NAMES: string[] = ["default", "everything on", "Protyle", "no GFM auto link"];
