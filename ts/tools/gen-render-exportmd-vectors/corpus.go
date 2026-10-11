package main

import (
	"fmt"
	"strings"
)

// doc is one input of the corpus: inline Markdown, or a repo file (optionally its first Lines lines).
type doc struct {
	Markdown string `json:"md,omitempty"`
	File     string `json:"file,omitempty"`
	Lines    int    `json:"lines,omitempty"`
	Alt      bool   `json:"alt,omitempty"` // also parsed with the "protyle-alt" option set
}

const (
	id1  = "20200101010101-abcdefg"
	id2  = "20200102020202-hijklmn"
	upd1 = "20200101010102"
)

func ial(parts ...string) string {
	return "{: " + strings.Join(parts, " ") + "}"
}

func idIAL(id string) string {
	return ial(`id="`+id+`"`, `updated="`+upd1+`"`)
}

// inlineFragments are inline Markdown pieces, one per inline node kind.
var inlineFragments = []string{
	"plain text",
	"*em* text",
	"**strong** text",
	"_em_ and __strong__",
	"***both***",
	"`code`",
	"`` co`de ``",
	"` `` `",
	"~~del~~",
	"~del~",
	"==mark==",
	"H~2~O",
	"x^2^ y",
	"#tag# after",
	"$a|b$ math",
	"$$a$$ dollar",
	"[link](http://x.y \"t\")",
	"[link](<a b.md>)",
	"[ref][r]\n\n[r]: http://r.com \"T\"",
	"[r] and [r][]\n\n[r]: /url",
	"![img](a.png \"t\")",
	"![img](a b.png)",
	"<b>html</b> inline",
	"((" + id1 + " \"anchor\"))",
	"((" + id1 + " 'dyn'))",
	"<<" + id1 + " \"p1\">>",
	":smile: emoji",
	"emoji \U0001F600 here",
	"中文English混排，测试",
	"&amp; &copy; &#35;",
	"\\*esc\\* \\# \\<",
	"foo[^1] note\n\n[^1]: def",
	"line\\\nbreak",
	"soft\nbreak",
	"tail  \nhard",
	"**bold**" + ial(`style="color: red;"`) + " styled",
	"a ‸ caret",
	"‸",
	"[a](b)‸",
	"term github mysql javascript",
	"<http://auto.link> https://bare.link",
	"\u200bzwsp\u200b text",
	"a\u200b**b**\u200bc",
	"Ünïcödé ñ",
	"<span data-type=\"strong\">tm strong</span>",
	"<span data-type=\"strong em\">tm both</span>",
	"<span data-type=\"a\" data-href=\"http://x.y?a=1&amp;b=2\" data-title=\"ti&lt;t&gt;le\">tm a</span>",
	"<span data-type=\"code\">tm `co` de</span>",
	"<span data-type=\"s\">tm s</span><span data-type=\"mark\">tm mark</span>",
	"<span data-type=\"u\">u</span> <span data-type=\"sup\">s</span> <span data-type=\"sub\">b</span> <span data-type=\"kbd\">k</span>",
	"<span data-type=\"block-ref\" data-id=\"" + id1 + "\" data-subtype=\"s\">br s</span>",
	"<span data-type=\"block-ref\" data-id=\"" + id1 + "\" data-subtype=\"d\">br d's</span>",
	"<span data-type=\"file-annotation-ref\" data-id=\"" + id1 + "\">far's</span>",
	"<span data-type=\"inline-memo\" data-inline-memo-content=\"memo\">im</span>",
	"<span data-type=\"inline-memo\" data-inline-memo-content=\"备注\">中文</span>",
	"<span data-type=\"inline-math\" data-subtype=\"math\" data-content=\"a|b\">x</span>",
	"<span data-type=\"tag\">tg</span>",
	"<span data-type=\"text\" style=\"color: red;\">txt</span>",
	"<span data-type=\"strong text\" style=\"color: red;\">stxt</span>",
	"<span data-type=\"a strong code\" data-href=\"u\">asc</span>",
	"<span data-type=\"em code\">ec</span>",
	"<span data-type=\"strong\"> sp </span>x",
	"<span data-type=\"em\">，标点</span>y",
	"<span data-type=\"code\">a``b</span>",
	"<span data-type=\"code\">a`b</span>",
	"<br />",
	"<u>u</u>",
}

// containers wrap one inline fragment. %s is replaced by the fragment.
var containers = []struct {
	name string
	fmt  string
}{
	{"para", "before %s after\n"},
	{"para-only", "%s\n"},
	{"list", "- item %s\n- second\n"},
	{"ordered", "1. item %s\n2. second\n"},
	{"task", "- [ ] todo %s\n- [x] done\n"},
	{"quote", "> %s\n> more\n"},
	{"heading", "## head %s\n"},
	{"cell", "| h1 | h2 |\n| -- | :-: |\n| %s | y |\n"},
}

func fragmentDocs() []doc {
	var ret []doc
	for i, f := range inlineFragments {
		for j, c := range containers {
			// every fragment in two containers chosen by index, the first fragments in all of them
			if i >= 12 && (i+j)%4 != 0 {
				continue
			}
			ret = append(ret, doc{Markdown: strings.Replace(c.fmt, "%s", f, 1)})
		}
	}
	return ret
}

func blockDocs() []doc {
	var ret []doc
	add := func(s ...string) {
		for _, x := range s {
			ret = append(ret, doc{Markdown: x})
		}
	}
	add(
		"", "\n", "hello", "# Title\n\npara\n", "Setext\n===\n\nSub\n---\n", "# H {#custom-id}\n\n## Two ##\n",
		"- a\n- b\n  - c\n    - d\n\n1. x\n2. y\n   1. z\n", "- a\n\n- b\n\n  para\n", "* a\n+ b\n- c\n", "- [ ] todo\n- [x] done\n- [/] half\n- [>] fwd\n- [!] bang\n",
		"1. [ ] a\n2. [X] b\n", "- \n- b\n", "* \n\n  p\n", "-\n  a\n", "10. ten\n11. eleven\n", "3. three\n4. four\n   - nested\n",
		"> quote\n> more\n>\n> > nested\n", "> - a\n> - b\n\n> 1. x\n", "> # h\n> para\n", ">\n", "> a\n\n> b\n",
		"```go\nfmt.Println(\"<hi>\")\n```\n", "```\nno lang\n```\n", "~~~\ntilde\n~~~\n", "````md\n```\ninner\n```\n````\n", "    indented code\n\npara\n",
		"```mermaid\ngraph TD\n  A-->B\n```\n", "```mindmap\n- a\n  - b\n```\n", "```echarts\n{\"a\":\"<b>\"}\n```\n", "```\n\n```\n", "```go\n```\n",
		"```js\nfoo &amp; bar &lt;\n```\n",
		"$$\nmath\n$$\n", "$$\na &amp; b &lt; c\n$$\n", "$$\n$$\n", "para\n\n$$\nx\n$$\n\npara2\n",
		"<div>html</div>\n\ntext\n", "<div>\nmulti\n</div>\n", "<video src=\"a.mp4\"></video>\n", "<iframe src=\"http://x.y/a&amp;b\"></iframe>\n", "<audio src=\"a.mp3\"></audio>\n",
		"<!-- comment -->\n\ntext\n",
		"***\n\n---\n\n___\n", "a\n\n***\n\nb\n",
		"| a | b |\n| - | :-: |\n| 1 | 2 |\n", "| a | b | c |\n| :- | -: | :-: |\n| 1 | 2 | 3 |\n| long cell here | x | y |\n",
		"| a |\n|---|\n| `x|y` |\n", "| a |\n|---|\n| `x\\|y` |\n", "| a |\n|---|\n| $x\\|y$ |\n", "| a | b |\n| - | - |\n| a\\|b | c |\n", "| 中文 | b |\n| - | - |\n| x | 长长长 |\n",
		"| a | b |\n| - | - |\n|{: colspan=\"2\"}x| |\n", "| a | b |\n| - | - |\n|{: style=\"text-align: right;\"}x|y|\n", "| a | b |\n| - | - |\n| x | y |\n{: id=\""+id1+"\"}\n",
		"| a | b |\n| - | - |\n| - item | <br/> |\n", "| a |\n| - |\n| ![i](x.png) |\n", "| a |\n| - |\n|  |\n", "| a | b |\n| - | - |\n",
		"text[^1] and more[^2].\n\n[^1]: First note.\n[^2]: Second note\n    with continuation.\n", "a[^x]\n\n[^x]: def *em*\n\n    para two\n\n    - list\n",
		"[ref]: http://r.com \"T\"\n\n[ref] and [ref][] and [text][ref]\n", "[a]: b\n[c]: d\n",
		"---\ntitle: x\n---\n\nbody\n", "---\n---\n",
		"[toc]\n\n# A\n## B\n# C\n", "[TOC]\n",
		"{{{row\npara\n\n{{{col\ninner\n}}}\n}}}\n", "{{{col\na\n\nb\n}}}\n", "{{{row\n- l\n\n> q\n}}}\n",
		"<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n",
		"> [!NOTE]\n> text\n", "> [!WARNING] Custom Title\n> text\n>\n> more\n", "> [!TIP]\n> - a\n> - b\n", "> [!NOTE] \U0001F600 Icon\n> body\n", "> [!CUSTOM]\n> x\n",
		"> [!NOTE]\n> > [!TIP]\n> > nested\n", "- > [!NOTE]\n  > in list\n", "* > [!NOTE]\n  > star\n",
		":::tabs\n\n@tab One\n\nbody one\n\n@tab:active Two\n\nbody two\n\n:::\n", ":::tabs\n\n@tab **Bold** title\n\nbody\n\n:::\n",
		"::::tabs\n\n@tab Outer\n\n:::tabs\n\n@tab Inner\n\nx\n\n:::\n\n::::\n", ":::tabs\n\n@tab T\n{: tabs-task=\"true\"}\n\n- [ ] a\n\n:::\n{: tabs-task=\"true\"}\n",
		"@tab not in tabs\n\ntext\n", "::: tabs\n",
		";;;echarts\n{}\n;;;\n", "para\n\n;;;info\nbody\n;;;\n\nnext\n",
		"<div data-type=\"NodeAttributeView\" data-av-id=\"x\" data-av-type=\"table\"></div>\n",
		"{{ select * from blocks }}\n", "{{ SELECT * }}\n\ntext\n",
		"para\n"+idIAL(id1)+"\n", "para\n"+ial(`id="`+id1+`"`, `updated="`+upd1+`"`, `custom-a="b"`)+"\n\npara 2\n"+idIAL(id2)+"\n",
		"# h\n"+idIAL(id1)+"\n\npara\n"+idIAL(id2)+"\n", "- a\n"+idIAL(id1)+"\n- b\n"+idIAL(id2)+"\n{: id=\""+id1+"\"}\n",
		"- a\n  {: id=\""+id1+"\"}\n- b\n{: id=\""+id2+"\"}\n", "1. a\n   {: id=\""+id1+"\"}\n{: id=\""+id2+"\"}\n",
		"> q\n  {: id=\""+id1+"\"}\n{: id=\""+id2+"\"}\n", "```\ncode\n```\n"+idIAL(id1)+"\n", "***\n"+idIAL(id1)+"\n", "$$\nx\n$$\n"+idIAL(id1)+"\n",
		"<div>x</div>\n"+idIAL(id1)+"\n", "{{{row\ninner\n"+idIAL(id1)+"\n}}}\n"+idIAL(id2)+"\n",
		"a\n\n\n\nb\n", "a  \nb\n", "a\\\nb\n", "   leading space\n", "　　全角空格开头\n", "trailing space   \n",
		"line1\nline2\nline3\n", "‸", "‸\n", "# ‸\n", "- ‸\n", "- [ ] ‸a\n- [x] ‸ b\n", "> ‸\n", "```\n‸\n```\n", "a‸b\n", "‸**b**\n", "**b**‸\n",
		"![](a.png)\n", "![img](a.png)\n\ntext ![img](a b.png \"title\") more\n", "![a [b] c](x.png)\n", "[a [b] c](x)\n", "[a](<x y> \"t\\\"q\")\n", "[a](x 'sq')\n", "[a](x (par))\n", "[a]()\n", "[](x)\n",
		"<http://auto.link>\n\nhttps://bare.link/a_b_c\n", "foo@bar.com\n",
		"\\*not em\\* \\# \\<\n", "&amp; &copy; &#35; &bogus;\n",
		"term\n: def\n",
		"#tag1# #tag2#\n", "a#b#c\n", "==a== ==b==\n", "=a=\n", "^x^~y~\n",
		"$a$ and $b$\n", "$a$b\n", "5$ and 6$\n", "$$ inline $$\n",
		"**a**b**c**\n", "*a*b*c*\n", "__a__b\n", "_a_b_\n", "**a *b* c**\n", "*a **b** c*\n", "~~a *b* c~~\n", "[**a**](u)\n", "[`a`](u)\n", "**[a](u)**\n", "`a` `b`\n",
		"a**b**\n", "中**文**字\n", "**中文**，字\n", "中 `code` 文\n", "中文$x$中文\n", "English中文English\n", "1中文2\n",
		"* a\n\n  b\n* c\n", "- a\n+ b\n* c\n", "- a\n\n      code in list\n", "1. one\n\n   para\n2. two\n",
		"- ![i](a.png)\n", "- ```\n  code\n  ```\n", "- | a |\n  | - |\n  | x |\n", "- > q\n- # h\n",
		"1) a\n2) b\n", "1. a\n1. b\n1. c\n", "0. z\n",
		"<img src=\"x.png\" onerror=\"y\">\n", "<a href=\"javascript:x\">z</a>\n",
		"`a` b `c`\n", "``a`b``\n", "` a `\n", "`  `\n", "`a``b`\n",
		"a\n<b>x</b>\nc\n", "<b>x\n\ny</b>\n",
	)
	return ret
}

// extraDocs combine blocks, to exercise the boundaries between them.
func extraDocs() []doc {
	var ret []doc
	blocks := []string{
		"para\n", "# head\n", "- l1\n- l2\n", "1. o1\n2. o2\n", "> q\n", "```go\nc\n```\n", "$$\nm\n$$\n", "***\n", "| a |\n| - |\n| x |\n", "<div>h</div>\n",
		"- [ ] t\n- [x] u\n", "{{{row\ns\n}}}\n", "> [!NOTE]\n> n\n", "[^1]: f\n",
		"para\n" + idIAL(id1) + "\n", "# h\n" + idIAL(id1) + "\n", "- l\n" + idIAL(id1) + "\n", "> q\n" + idIAL(id1) + "\n",
	}
	for i, a := range blocks {
		for j, b := range blocks {
			if (i*7+j*3)%5 != 0 {
				continue
			}
			ret = append(ret, doc{Markdown: a + "\n" + b})
		}
	}
	// nested depth
	for d := 1; d <= 4; d++ {
		s := ""
		for k := 0; k < d; k++ {
			s += strings.Repeat("  ", k) + "- item " + fmt.Sprint(k) + "\n"
		}
		ret = append(ret, doc{Markdown: s})
		q := strings.Repeat("> ", d) + "deep quote\n"
		ret = append(ret, doc{Markdown: q})
	}
	return ret
}

func fileDocs() []doc {
	ret := []doc{
		{File: "test/case1.md"},
		{File: "benchmark/commonmark-spec.md", Lines: 600},
		{File: "benchmark/commonmark-spec.md", Lines: 150},
		{File: "README.md"},
	}
	for i := 0; i <= 7; i++ {
		ret = append(ret, doc{File: fmt.Sprintf("test/format-case%d.md", i)})
		ret = append(ret, doc{File: fmt.Sprintf("test/format-case%d-formatted.md", i)})
	}
	return ret
}

func altDocs() []doc {
	var ret []doc
	for _, s := range []string{
		"~a~ b ~c~\n", "=a= b =c=\n", "=a== ==b=\n", "x ~~y~~ z~w~\n", ":huaji: :siyuan: :smile: :unknown:\n", "中文:huaji:中文\n",
		"<<assets/a.pdf/20200101010101-abcdefg \"text\">>\n", "a <<assets/dir/b.PDF/20200101010101-abcdefg>> b\n", "<<assets/a.pdf/20200101010101-abcdefg \"it's\">> x\n",
		"<<assets/a.pdf/20200101010101-abcdefg \"p\">>*em*\n", "- <<assets/a.pdf/20200101010101-abcdefg \"in list\">>\n", "| a |\n| - |\n| <<assets/a.pdf/20200101010101-abcdefg \"cell\">> |\n",
		"H~2~O and ~x~\n", "x^2^ and ^y^\n", "[~a~](u) [=b=](u)\n", "# ~h~ =m=\n",
	} {
		ret = append(ret, doc{Markdown: s, Alt: true})
	}
	return ret
}

func allDocs() []doc {
	var ret []doc
	ret = append(ret, blockDocs()...)
	ret = append(ret, fragmentDocs()...)
	ret = append(ret, extraDocs()...)
	ret = append(ret, altDocs()...)
	ret = append(ret, fileDocs()...)
	return ret
}
