package main

// extraCorpus holds inputs added for the nil-versus-empty audit (see PORTING.md, "nil slices"): one for each place where a Go function can return a nil byte slice
// that the parser stores in a node, or where a nil input must stay nil.
var extraCorpus = []string{
	"# `a`{#b}", "# [a](b){#c}", "# ![a](b){#c}", "# a`b`{#c}", "# $a$ {#b}", "# $a${#b}", "# ==a=={#b}", "# *a* {#b}", "# `a` {#b}", "# ![a](b) {#c}", "# **a** {#b}", "# <b>a</b> {#c}", "# [a](b) {#c}", "# {#b}", "# a {#}", "## *a*  {#b}  ",
	"    \n", "    a\n    \n", "<div>\n</div>", "<div></div>", "foo\n<div>\n</div>", "<div>\n\n</div>", "<div>  \n  </div>",
	">\n> [!NOTE]\n>\n", "> [!NOTE]\n>\n> ", "> [!NOTE] t\n>\n>", "> [!NOTE]\n> \n",
	"- [ ]\n  ", "- [ ] ‸", "- [ ]‸", "- [‸ ]", "- [ ‸]", "-‸ [ ]", "- [x]‸\n  a", "- [ ] ‸a", "- [ ]  ‸  ", "* [ ]‸\n* [x] ‸",
	"{{‸}}", "{{ ‸}}", "{{‸ }}", "‸{{}}", "{{}}‸", "<<<<<<< HEAD‸\n>>>>>>>", "<<<<<<<‸\n>>>>>>>‸", "<<<<<<< HEAD\n‸\n>>>>>>> x", "<<<<<<< HEAD\n   \t\n>>>>>>> x   ",
	"$$\n$$", "$$\n  \n$$", "$$\n‸\n$$", "---\n---\n", "---\n\n---", ";;;a\n\n;;;", ";;;a\n   \n;;;", "{{{\n\n}}}", "{{{\n  \n}}}", "{{{row\n\n}}}",
	"```\n```", "```\n\n```", "```\n  \n```", "~~~\n~~~", "```\n‸\n```", "```‸\n```", "    ‸", "\t‸",
	"a\n===\n", "a\n---\n‸", "a‸\n---", "a\n-‸--", "‸a\n===",
	"[toc]\n[TOC]", "[‸toc]", "[toc‸]",
	"|a|\n|-|\n|‸|", "|a|\n|-|\n|  |", "| |\n|-|\n|‸ |",
	":::tabs\n@tab\n\n:::", ":::tabs\n@tab \n  \n:::",
	"- \n- \n  \n", "1. \n2. \n", "- a\n\n  \n", "-\n  \n  b",
	"[a]: <>\n\n[a]", "[a]: <> \"\"\n\n[a]", "[a]: /u \"\"\n\n[a]", "[a](<> \"\")", "[a](b \"\")", "[a](b '')", "[a](b ())", "![a](b \"\")",
	"<a href=\"\">x</a>", "<img src=\"\">", "<img src=\"\" alt=\"\">", "<a href=\"\" title=\"\">x</a>",
	"* * *\n{: id=\"20200101010101-abcdefg\"}", "{: id=\"20200101010101-abcdefg\"}\n\n", "\n{: id=\"20200101010101-abcdefg\"}",
	"<span data-type=\"text\"></span>", "<span data-type=\"strong\"> </span>", "<span data-type=\"code\"></span>", "<span data-type=\"a\" data-href=\"\"></span>", "<span data-type=\"inline-math\" data-content=\"\"></span>", "<span data-type=\"block-ref\" data-id=\"20200101010101-abcdefg\"></span>",
	"`a`‸", "‸`a`", "`‸`", "*‸*", "**‸**", "[‸](b)", "[a](‸)", "[a](‸b)", "![‸](b)", "![a](‸)", "[a](b‸)", "[a](b \"‸\")", "[a](b‸ \"c\")", "[a](b \"c\"‸)", "[a](b \"c\")‸", "[a]‸(b)", "[a‸]", "[‸a]\n\n[a]: b",
	"# ‸", "# ‸\n", "#‸", "#‸#", "# a‸ #", "## ‸ ##", "###### ‸",
	"\n\n", "\n\n\n  \n", "  \n  \n", "\t\n", " \n",
}
