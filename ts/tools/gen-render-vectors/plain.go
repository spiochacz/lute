package main

import (
	"math/rand"
	"runtime"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
)

type pair struct {
	In  string  `json:"in"`
	Out *string `json:"out"` // nil: Go panicked
}

func strp(s string) *string { return &s }

func b2i(v bool) int {
	if v {
		return 1
	}
	return 0
}

func genPlain(rnd *rand.Rand) map[string]any {
	ret := map[string]any{"goVersion": runtime.Version()}

	// ---- Sanitize
	var san []pair
	for _, in := range sanitizeInputs() {
		var out string
		if try(func() { out = render.Sanitize(in) }) {
			san = append(san, pair{must(in), nil})
		} else {
			san = append(san, pair{must(in), strp(must(out))})
		}
	}
	ret["sanitize"] = san

	var removeSpaceVec [][2]string
	for _, s := range []string{"", "a b", "a\tb", "a\nb", "a b", "a b", "ja va\tscript", "　x", " ", "\t\r\n ", "中 文", "x y", "x\u0085y"} {
		removeSpaceVec = append(removeSpaceVec, [2]string{s, linkRemoveSpace(s)})
	}
	ret["removeSpace"] = removeSpaceVec

	var allowAttrVec [][]any
	for _, s := range []string{"href", "src", "onclick", "ONCLICK", "On", "on", "onerror", "formaction", "http-equiv", "HTTP-EQUIV", "FormAction", "srcdoc", "style", "class", "data-on", "xon", "", "OnLoad", "action", "xlink:href"} {
		allowAttrVec = append(allowAttrVec, []any{s, linkAllowAttr(s)})
	}
	ret["allowAttr"] = allowAttrVec
	var linkableVec [][]any
	for _, s := range []string{"a", "area", "blockquote", "img", "link", "script", "A", "div", "", "span", "iframe"} {
		linkableVec = append(linkableVec, []any{s, linkLinkable(s)})
	}
	ret["linkable"] = linkableVec

	// ---- space.go
	var space0 []pair
	for _, in := range spaceInputs(rnd) {
		space0 = append(space0, pair{must(in), strp(must(render.Space0(in)))})
	}
	ret["space0"] = space0

	pool := runePool()
	var allow [][]int
	for _, a := range pool {
		for _, b := range pool {
			allow = append(allow, []int{int(a), int(b), b2i(linkAllowSpace(a, b))})
		}
	}
	ret["allowSpace"] = allow

	var runeVec [][]int
	extra := []rune{0x2e80, 0x2fdf, 0x3000, 0x3001, 0x3040, 0x30a0, 0x3100, 0x3130, 0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xa960, 0xac00, 0xd7a3, 0xf900, 0xfaff, 0xfe30, 0xfe10, 0xff00, 0xff5e, 0xff61, 0xffe0, 0xffe6, 0xffe8, 0x1f300, 0x1f600, 0x20000, 0x2a6df, 0x2f800, 0x30000, 0x0, 0x7f, 0x80, 0xa0, 0xad, 0x2b0, 0x2ff, 0x1100, 0x115f, 0x1160, 0x20a9, 0x2329, 0x232a, 0x231a, 0x23e9, 0xe000, 0xfeff, 0x200b, 0x200d, 0xfe0f, 0xfffd, 0x10ffff}
	for _, r := range append(append([]rune{}, pool...), extra...) {
		runeVec = append(runeVec, []int{int(r), b2i(linkIsCJK(r)), b2i(linkIsFullWidth(r))})
	}
	ret["runeKinds"] = runeVec

	var addVec [][]any
	prefixes := []string{"", "a", "中", "1", "9", "5", "12", "1abc", "9x", "0", "x1", "…", "文 ", "A", "!", "‸", "1️", "中文abc", "ａ", "😀"}
	for _, p := range prefixes {
		for _, r := range []rune{'a', '中', '1', 65039, '‸', ' ', '!', '。', 'Ａ', '😀', 'ひ', '한', '%', '@', '#', '~', '=', 0x2028} {
			addVec = append(addVec, []any{p, int(r), must(linkAddSpaceAtBoundary(p, r))})
		}
	}
	ret["addSpaceAtBoundary"] = addVec

	// ---- term_typographer.go
	terms := render.NewTerms()
	var termsVec [][2]string
	for _, k := range sortedKeys(terms) {
		termsVec = append(termsVec, [2]string{k, terms[k]})
	}
	ret["terms"] = termsVec

	var notTerm []int
	for i := 0; i < 256; i++ {
		notTerm = append(notTerm, b2i(linkIsNotTerm(byte(i))))
	}
	ret["isNotTerm"] = notTerm

	r0 := render.NewBaseRenderer(nil, render.NewOptions(), nil)
	var fix []pair
	for _, in := range termInputs(terms) {
		var out string
		if try(func() { out = string(r0.FixTermTypo([]byte(in))) }) {
			fix = append(fix, pair{must(in), nil})
		} else {
			fix = append(fix, pair{must(in), strp(must(out))})
		}
	}
	ret["fixTermTypo"] = fix

	type custom struct {
		Terms [][2]string `json:"terms"`
		In    string      `json:"in"`
		Out   *string     `json:"out"`
	}
	var customVec []custom
	for _, c := range []struct {
		terms [][2]string
		in    string
	}{
		{[][2]string{{"foo", "BAR"}}, "a foo b"},
		{[][2]string{{"foo", "ba"}}, "a foo b"},
		{[][2]string{{"foo", "barbaz"}}, "a foo b"},
		{[][2]string{{"foo", ""}}, "foo"},
		{[][2]string{{"foo", "FOO"}, {"bar", "BARR"}}, "foo bar"},
		{[][2]string{{"c++", "C++"}}, "c++ is"},
		{[][2]string{{"ab", "中"}}, "ab"},
		{[][2]string{{"Foo", "FOO"}}, "Foo foo"},
	} {
		o := render.NewOptions()
		o.Terms = map[string]string{}
		for _, kv := range c.terms {
			o.Terms[kv[0]] = kv[1]
		}
		rr := render.NewBaseRenderer(nil, o, nil)
		var out string
		if try(func() { out = string(rr.FixTermTypo([]byte(c.in))) }) {
			customVec = append(customVec, custom{c.terms, c.in, nil})
		} else {
			customVec = append(customVec, custom{c.terms, c.in, strp(out)})
		}
	}
	ret["fixTermTypoCustom"] = customVec

	// ---- link.go
	ret["link"] = genLink()

	// ---- renderer.go helpers on plain values
	var sub [][]any
	for _, s := range []string{"", "a", "abc", "中文测试", "a中b文c", "😀😀😀", "x😀y", "‸abc"} {
		for _, n := range []int{-1, 0, 1, 2, 3, 4, 10} {
			sub = append(sub, []any{s, n, must(render.SubStr(s, n))})
		}
	}
	ret["subStr"] = sub
	var noHL [][]any
	for _, s := range []string{"", "mermaid", "echarts", "abc", "graphviz", "mindmap", "flowchart", "plantuml", "infographic", "go", "Mermaid", "mermaid ", "js"} {
		noHL = append(noHL, []any{s, render.NoHighlight(s)})
	}
	ret["noHighlight"] = noHL

	// ---- filetype.go
	var fileExt [][]any
	for _, s := range fileExtInputs() {
		runes := []rune(s)
		for _, pos := range []int{0, 1, 2, len(runes) / 2} {
			if pos > len(runes) {
				continue
			}
			rs := runes
			fileExt = append(fileExt, []any{s, pos, len(runes), linkIsFileExt(pos, len(runes), &rs)})
		}
	}
	ret["isFileExt"] = fileExt

	// ---- setext.go
	var setextOff [][]any
	for _, s := range setextLines() {
		setextOff = append(setextOff, []any{s, linkSetextHeadingMarkerOffset([]byte(s))})
	}
	ret["setextHeadingMarkerOffset"] = setextOff

	// ---- tabs.go
	var tabsMarker [][]any
	for _, s := range tabsLines() {
		tabsMarker = append(tabsMarker, []any{s, linkIsTabsParagraphMarker([]byte(s))})
	}
	ret["isTabsParagraphMarker"] = tabsMarker

	// ---- mindmap.go
	var mm [][]any
	for _, s := range mindmapInputs() {
		var a, b string
		pa := try(func() { a = render.EChartsMindmapStr(s) })
		pb := try(func() { b = string(render.EChartsMindmap([]byte(s))) })
		if pa || pb {
			mm = append(mm, []any{must(s), nil, nil})
		} else {
			mm = append(mm, []any{must(s), must(a), must(b)})
		}
	}
	ret["mindmap"] = mm

	// ---- renderer.go: appendTableCellAlignStyle
	ret["appendTableCellAlignStyle"] = genAlign()

	return ret
}

func termInputs(terms map[string]string) []string {
	var ret []string
	keys := sortedKeys(terms)
	for i, k := range keys {
		up := strings.ToUpper(k)
		title := strings.ToUpper(k[:1]) + k[1:]
		ret = append(ret, k, up, title, "use "+k+" now", "中文"+k+"中文", "("+k+")", k+"."+k, k+".js", "x"+k, k+"x", "# "+up+", "+k+"; "+title+"!")
		if 0 == i%3 {
			ret = append(ret, "a "+k+" b "+keys[(i+7)%len(keys)]+" c", k+" "+keys[(i+1)%len(keys)])
		}
	}
	ret = append(ret, "", " ", "...", "git.", ".git", "github.com", "test.html", "Java and JavaScript", "javascript:void(0)", "https://github.com/x", "ＧＩＴ", "git　hub", "git\thub", "gitgit git", "git-hub", "git_hub", "api/css", "[html]", "{json}", "<xml>", "a\nhtml\nb", "中html中", "html😀css", "7z", "A1 b2")
	return ret
}

func fileExtInputs() []string {
	return []string{"jpg", "png.", "gif", "webp", "xyz", "textbundle", "textbundles", "tex", "html", "htm", "js", "java", "javascript", "go", "golang", "md", "markdown", "txt", "pdf", "Z", "z", "7z", "tar.gz", "docx", "doc", "wasm", "woff2", "ttf", "中文", "中png", "a.jpg", "", "x", "ps", "psd", "sqlite", "ar", "arch", "gz", "bz2", "mp4", "mp3", "css", "csv", "cr2", "ogg", "flac", "epub", "iso"}
}

func setextLines() []string {
	return []string{"-", "=", "--", "===", "---", "====", " -", "  =", "   --", "    --", "\t-", "\t\t=", "-\t", "- ", "-  -", "- -", "=-", "-=", "a-", "-a", "--a", "x", "", " ", "‸-", "-‸", "‸ -", " ‸-", "-‸-", "- ‸", "=‸=", "‸‸", "--‸ ", "　-", "-　", "- ‸ -", "-  ", "-\t\t", "-\t-", "= =", "==  ", "   ===  "}
}

func tabsLines() []string {
	return []string{"@tab", "@tab:active", "@tab foo", "@tab\tfoo", "@tab:active bar", "@tab:activex", "@tabx", " @tab", "\t@tab", "@tab ", "@tab:", "@ tab", "@TAB", ":::", "::: tabs", "::::", ":::: tabs", "::", ":::tabs", "::: tabs ", ":::\ttabs", ":::  tabs", "::: tab", "::: tabsx", ":::x", "::: ", "", " ", "‸@tab", "‸@tab foo", "‸:::", "‸::: tabs", "  :::  tabs  ", "foo", "@tab　x", "::::::::: tabs", ":", ": : :"}
}

func mindmapInputs() []string {
	return []string{
		"", "foo", "- foo", "- foo\n- bar", "- foo\n  - bar\n  - baz\n- qux", "- foo\n  - bar\n    - baz", "* a\n* b\n* c", "1. a\n2. b",
		"- a\n\n- b", "- [x] done\n- [ ] todo", "- **bold** item\n- `code`", "- [link](http://x.y)\n- ![img](a.png)", "- a\\b\n- \"quote\"", "- 中文\n  - 子节点",
		"- a\n\ntext\n\n- b", "text\n- a", "# h\n- a", "> q\n- a", "- a\n- b\n\n\n- c", "- ‸a\n- b‸", "- a\n  text\n  - b", "- a\n   - b\n      - c\n   - d",
		"- a\n\n  para\n  - b", "- 😀\n- x", "- a <b>\n- &amp;", "- \\\\\n", "-\n- b", "- \n  - c", "- a\n- b\n  - c\n    - d\n  - e\n- f",
		"- a\n\n---\n\n- b", "```\ncode\n```\n- a", "1) a\n2) b", "+ x\n+ y\n  + z", "- a\n+ b\n* c", "- `a\"b`", "- a\tb", "- a  \n  b",
	}
}

func genAlign() []map[string]any {
	var ret []map[string]any
	attrSets := [][][]string{
		nil,
		{},
		{{"class", "x"}},
		{{"style", ""}},
		{{"style", "color:red"}},
		{{"style", "color:red;"}},
		{{"style", "color:red; "}},
		{{"style", "  color:red  "}},
		{{"style", "text-align:left"}},
		{{"style", "color:red; TEXT-ALIGN : center;"}},
		{{"style", "text-align"}},
		{{"style", "x-text-align:left"}},
		{{"class", "a"}, {"style", "b:c"}},
		{{"style", "a:b"}, {"style", "c:d"}},
		{{"style", ";;"}},
		{{"style", "a;b:c;;"}},
	}
	for _, align := range []int{0, 1, 2, 3, 4, -1} {
		for _, attrs := range attrSets {
			n := &ast.Node{Type: ast.NodeTableCell, TableCellAlign: align}
			in := cloneAttrs(attrs)
			arg := cloneAttrs(attrs)
			linkAppendTableCellAlignStyle(n, &arg)
			ret = append(ret, map[string]any{"align": align, "in": in, "out": arg})
		}
	}
	return ret
}

func cloneAttrs(a [][]string) [][]string {
	ret := make([][]string, 0, len(a))
	for _, kv := range a {
		ret = append(ret, append([]string{}, kv...))
	}
	return ret
}
