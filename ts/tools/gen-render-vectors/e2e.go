package main

import (
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
)

type e2eCase struct {
	In  string  `json:"in"`
	Opt string  `json:"opt"`
	Out *string `json:"out"`
}

func e2eInputs() []string {
	return []string{
		"", "hello", "# Title\n\npara *em* **strong** `code` [link](http://x.y \"t\") ![img](a.png \"t\")\n",
		"Setext\n===\n\nSub\n---\n", "- a\n- b\n  - c\n\n1. x\n2. y\n", "- [ ] todo\n- [x] done\n", "> quote\n> more\n>\n> > nested\n",
		"```go\nfmt.Println(\"<hi>\")\n```\n\n    indented\n", "***\n\n---\n", "| a | b |\n| - | :-: |\n| 1 | 2 |\n",
		"text[^1] and more[^2].\n\n[^1]: First note.\n[^2]: Second note\n    with continuation.\n", "a[^x]\n\n[^x]: def *em*\n\n    para two\n",
		"Footnote missing[^nope] here\n", "~~del~~ ==mark== H~2~O x^2^ $inline$\n\n$$\nmath\n$$\n", "<div>html</div>\n\ntext <b>inline</b> <script>x</script>\n",
		"[ref]: http://r.com \"T\"\n\n[ref] and [ref][] and [text][ref]\n", "<http://auto.link> https://bare.link foo@bar.com\n", "line one  \nline two\\\nline three\n",
		"中文English混排，测试：Markdown和JavaScript。\n", "terms: github mysql javascript\n", "# H1\n## H1\n## H1\n### 中文 标题\n",
		"[toc]\n\n# A\n## B\n# C\n", "```mermaid\ngraph TD\n```\n\n```mindmap\n- a\n  - b\n```\n", ":smile: :unknown: 😀\n", "&amp; &copy; &#35; &bogus;\n",
		"1. one\n\n   para\n2. two\n", "* a\n\n  b\n* c\n", "- a\n+ b\n* c\n", "10. ten\n11. eleven\n", "![a](b.png)\n\ntext ![a](b.png) text\n",
		"[a](javascript:alert(1)) [b](JAVASCRIPT:x) [c](rel/path.md) [d](</sp ace>)\n", "<img src=\"x\" onerror=\"y\">\n\n<a href=\"javascript:x\">z</a>\n",
		"---\ntitle: x\n---\n\nbody\n", "a\n\n\n\nb\n", "\\*not em\\* \\# \\<\n", "`` a`b `` ` `\n", "*a **b** c* __d _e_ f__\n",
		"term\n: def\n", "- a\n\n      code in list\n", "> - a\n> - b\n", "| a |\n|---|\n| `x|y` |\n",
	}
}

func e2eOptionSets() []optSet {
	return []optSet{
		{"default", map[string]any{}},
		{"AutoSpace FixTermTypo", map[string]any{"AutoSpace": true, "FixTermTypo": true}},
		{"Sanitize", map[string]any{"Sanitize": true}},
		{"ToC HeadingID LinkBase", map[string]any{"ToC": true, "HeadingID": true, "LinkBase": "http://b/", "LinkPrefix": "/p"}},
		{"SoftBreak2HardBreak off", map[string]any{"SoftBreak2HardBreak": false}},
	}
}

func genE2E() map[string]any {
	var cases []e2eCase
	for _, in := range e2eInputs() {
		for _, os := range e2eOptionSets() {
			opts := render.NewOptions()
			applyOptions(opts, os.Opts)
			var out string
			if try(func() {
				po := parse.NewOptions()
				tree := parse.Parse("", []byte(in), po)
				out = string(render.NewHtmlRenderer(tree, opts, po).Render())
			}) {
				cases = append(cases, e2eCase{in, os.Name, nil})
			} else {
				cases = append(cases, e2eCase{in, os.Name, strp(must(out))})
			}
		}
	}
	return map[string]any{"optionSets": e2eOptionSets(), "cases": cases}
}
