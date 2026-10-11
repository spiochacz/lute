package main

import (
	"fmt"
	"math/rand"
	"reflect"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
)

func doc(children ...*NodeSpec) *NodeSpec { return N("NodeDocument", children...) }
func para(children ...*NodeSpec) *NodeSpec { return N("NodeParagraph", children...) }
func text(s string) *NodeSpec               { return T("NodeText", s) }
func heading(level int, children ...*NodeSpec) *NodeSpec {
	c := append([]*NodeSpec{T("NodeHeadingC8hMarker", "#")}, children...)
	return N("NodeHeading", c...).P("HeadingLevel", level)
}
func em(s string) *NodeSpec {
	return N("NodeEmphasis", T("NodeEmA6kOpenMarker", "*"), text(s), T("NodeEmA6kCloseMarker", "*"))
}
func strong(s string) *NodeSpec {
	return N("NodeStrong", T("NodeStrongA6kOpenMarker", "**"), text(s), T("NodeStrongA6kCloseMarker", "**"))
}
func codeSpan(s string) *NodeSpec {
	return N("NodeCodeSpan", T("NodeCodeSpanOpenMarker", "`"), T("NodeCodeSpanContent", s), T("NodeCodeSpanCloseMarker", "`"))
}
func link(txt, dest, title string) *NodeSpec {
	c := []*NodeSpec{T("NodeOpenBracket", "["), T("NodeLinkText", txt), T("NodeCloseBracket", "]"), T("NodeOpenParen", "("), T("NodeLinkDest", dest)}
	if "" != title {
		c = append(c, T("NodeLinkSpace", " "), T("NodeLinkTitle", title))
	}
	c = append(c, T("NodeCloseParen", ")"))
	return N("NodeLink", c...)
}
func image(alt, dest, title string) *NodeSpec {
	c := []*NodeSpec{T("NodeBang", "!"), T("NodeOpenBracket", "["), T("NodeLinkText", alt), T("NodeCloseBracket", "]"), T("NodeOpenParen", "("), T("NodeLinkDest", dest)}
	if "" != title {
		c = append(c, T("NodeLinkSpace", " "), T("NodeLinkTitle", title))
	}
	c = append(c, T("NodeCloseParen", ")"))
	return N("NodeImage", c...)
}
func listData(typ int, tight bool, bullet int, start int) map[string]any {
	ret := map[string]any{"Typ": typ, "Tight": tight, "BulletChar": bullet, "Start": start, "Num": start}
	if 1 == typ {
		ret["Delimiter"] = int('.')
		ret["Marker"] = fmt.Sprintf("%d.", start)
	} else {
		ret["Marker"] = string(rune(bullet))
	}
	return ret
}
func list(typ int, tight bool, bullet, start int, items ...*NodeSpec) *NodeSpec {
	return N("NodeList", items...).P("ListData", listData(typ, tight, bullet, start))
}
func item(typ int, tight bool, bullet, start int, children ...*NodeSpec) *NodeSpec {
	marker := "NodeListItem"
	return N(marker, children...).P("ListData", listData(typ, tight, bullet, start))
}
func fenced(info, code string) *NodeSpec {
	c := []*NodeSpec{T("NodeCodeBlockFenceOpenMarker", "```")}
	if "" != info {
		c = append(c, T("NodeCodeBlockFenceInfoMarker", info).P("CodeBlockInfo", info))
	} else {
		c = append(c, T("NodeCodeBlockFenceInfoMarker", "").P("CodeBlockInfo", ""))
	}
	c = append(c, T("NodeCodeBlockCode", code), T("NodeCodeBlockFenceCloseMarker", "```"))
	return N("NodeCodeBlock", c...).P("IsFencedCodeBlock", true)
}
func textMark(typ, content string) *NodeSpec {
	return N("NodeTextMark").P("TextMarkType", typ).P("TextMarkTextContent", content)
}
func tableCell(txt string, align int) *NodeSpec {
	n := N("NodeTableCell", text(txt))
	if 0 != align {
		n.P("TableCellAlign", align)
	}
	return n
}

func smokeTrees() map[string]*NodeSpec {
	ial := [][]string{{"id", "20200101000000-abcdefg"}, {"style", "color:red"}}
	ialAny := func(a [][]string) []any {
		var ret []any
		for _, kv := range a {
			ret = append(ret, []any{kv[0], kv[1]})
		}
		return ret
	}
	m := map[string]*NodeSpec{}
	m["paragraph plain"] = doc(para(text("hello world")))
	m["paragraph emphasis strong code link image"] = doc(para(text("a "), em("em"), text(" b "), strong("st"), text(" c "), codeSpan("x<y>&z"), text(" d "), link("lnk", "http://x.y/?a=1&b=2", "a \"title\""), text(" e "), image("alt", "img.png", "t")))
	m["paragraph cjk autospace"] = doc(para(text("中文"), em("English"), text("中文"), codeSpan("code"), text("中"), strong("字"), text("abc"), link("链接", "u", ""), text("文")))
	m["paragraph cjk terms"] = doc(para(text("使用github和javascript的api"), text(" mysql.html"), text("中文git中文")))
	m["paragraph breaks"] = doc(para(text("a"), N("NodeSoftBreak"), text("b"), N("NodeHardBreak"), text("c")))
	m["paragraph escape"] = doc(para(text("<b>&\"'"), N("NodeBackslash", T("NodeBackslashContent", "*")), N("NodeHTMLEntity").P("TaskListItemChecked", false), T("NodeInlineHTML", "<b>x</b>")))
	m["paragraph ial"] = doc(para(text("with ial")).P("KramdownIAL", ialAny(ial)))
	m["paragraph ial em"] = doc(para(N("NodeEmphasis", T("NodeEmA6kOpenMarker", "*"), text("e"), T("NodeEmA6kCloseMarker", "*")).P("KramdownIAL", ialAny(ial))))
	m["heading 1-6"] = doc(heading(1, text("one")), heading(2, text("two")), heading(3, text("three")), heading(4, text("four")), heading(5, text("five")), heading(6, text("six")))
	m["heading ids duplicates"] = doc(heading(1, text("Same")), heading(2, text("Same")), heading(2, text("Same")), heading(3, text("中文 标题!")), heading(2, text("a-b")))
	m["heading custom id"] = doc(heading(1, text("Title"), T("NodeHeadingID", "custom-id")), heading(2, text("#x ‸y"), T("NodeHeadingID", "")))
	m["heading ial"] = doc(heading(2, text("Hi")).P("KramdownIAL", ialAny(ial)), heading(3, text("Two")).P("KramdownIAL", ialAny([][]string{{"id", "x"}})))
	m["heading inline"] = doc(heading(2, text("a "), codeSpan("b"), text(" "), strong("c"), N("NodeInlineMath", T("NodeInlineMathOpenMarker", "$"), T("NodeInlineMathContent", "x<y"), T("NodeInlineMathCloseMarker", "$"))))
	m["toc"] = doc(N("NodeToC"), heading(1, text("A")), heading(2, text("B"), codeSpan("c")), heading(3, text("D")), heading(2, text("E")), heading(1, text("F")), heading(3, text("G")))
	m["toc empty"] = doc(N("NodeToC"), para(text("x")))
	m["bullet list tight"] = doc(list(0, true, '*', 0, item(0, true, '*', 0, para(text("one"))), item(0, true, '*', 0, para(text("two")))))
	m["bullet list loose"] = doc(list(0, false, '-', 0, item(0, false, '-', 0, para(text("one"))), item(0, false, '-', 0, para(text("two")))))
	m["ordered list"] = doc(list(1, true, 0, 3, item(1, true, 0, 3, para(text("a"))), item(1, true, 0, 4, para(text("b")))))
	m["ordered list start1"] = doc(list(1, false, 0, 1, item(1, false, 0, 1, para(text("a")))))
	m["nested list"] = doc(list(0, true, '*', 0, item(0, true, '*', 0, para(text("a")), list(0, true, '*', 0, item(0, true, '*', 0, para(text("b")))))))
	m["task list"] = doc(list(3, true, '*', 0,
		item(3, true, '*', 0, para(N("NodeTaskListItemMarker").P("TaskListItemChecked", true).P("TaskListItemMarker", int('X')), text(" done"))),
		item(3, true, '*', 0, para(N("NodeTaskListItemMarker").P("TaskListItemChecked", false).P("TaskListItemMarker", int(' ')), text(" todo"))),
		item(3, true, '*', 0, para(N("NodeTaskListItemMarker").P("TaskListItemChecked", true).P("TaskListItemMarker", int('/')), text(" half")))))
	m["task list ordered"] = doc(list(3, true, 0, 1, item(3, true, 0, 1, para(N("NodeTaskListItemMarker").P("TaskListItemChecked", true), text("x")))))
	m["list ial"] = doc(list(0, true, '*', 0, item(0, true, '*', 0, para(text("x"))).P("KramdownIAL", ialAny(ial))).P("KramdownIAL", ialAny(ial)))
	m["blockquote"] = doc(N("NodeBlockquote", T("NodeBlockquoteMarker", ">"), para(text("quoted")), para(text("two"))))
	m["blockquote nested"] = doc(N("NodeBlockquote", T("NodeBlockquoteMarker", ">"), N("NodeBlockquote", T("NodeBlockquoteMarker", ">"), para(text("deep")))).P("KramdownIAL", ialAny(ial)))
	m["thematic break"] = doc(para(text("a")), N("NodeThematicBreak"), para(text("b")))
	m["code block fenced go"] = doc(fenced("go", "package main\n<&>\n"))
	m["code block fenced none"] = doc(fenced("", "plain\n"))
	m["code block fenced info words"] = doc(fenced("js title=x", "let a;\n"))
	m["code block mermaid"] = doc(fenced("mermaid", "graph TD;\nA-->B;\n"))
	m["code block mindmap"] = doc(fenced("mindmap", "- a\n  - b\n- c\n"))
	m["code block echarts ial"] = doc(fenced("echarts", "{}\n").P("KramdownIAL", ialAny(ial)))
	m["code block indented"] = doc(N("NodeCodeBlock", T("NodeCodeBlockCode", "indented <code>\n")))
	m["html block"] = doc(T("NodeHTMLBlock", "<div class=\"x\" onclick=\"y()\">text</div>\n"), T("NodeHTMLBlock", "<img src=\"a.png\" onerror=\"x\">\n"), T("NodeHTMLBlock", "<script>alert(1)</script>\n"))
	m["html block src"] = doc(T("NodeHTMLBlock", "<img src=\"a.png\">"), T("NodeHTMLBlock", "<img src=\"//cdn/x.png\">"), T("NodeHTMLBlock", "<img src=\"\">"), T("NodeHTMLBlock", "<img src=\"‸\">"))
	m["inline html"] = doc(para(T("NodeInlineHTML", "<a href=\"javascript:alert(1)\">"), text("x"), T("NodeInlineHTML", "</a>"), T("NodeInlineHTML", "<span onclick=\"x\">")))
	m["math block"] = doc(N("NodeMathBlock", T("NodeMathBlockOpenMarker", "$$"), T("NodeMathBlockContent", "a<b\n"), T("NodeMathBlockCloseMarker", "$$")).P("KramdownIAL", ialAny(ial)))
	m["inline math"] = doc(para(N("NodeInlineMath", T("NodeInlineMathOpenMarker", "$"), T("NodeInlineMathContent", "a<b"), T("NodeInlineMathCloseMarker", "$"))))
	m["strikethrough"] = doc(para(text("中文"), N("NodeStrikethrough", T("NodeStrikethrough1OpenMarker", "~"), text("del"), T("NodeStrikethrough1CloseMarker", "~")), text("abc"), N("NodeStrikethrough", T("NodeStrikethrough2OpenMarker", "~~"), text("d2"), T("NodeStrikethrough2CloseMarker", "~~"))))
	m["mark sup sub"] = doc(para(N("NodeMark", T("NodeMark1OpenMarker", "="), text("m"), T("NodeMark1CloseMarker", "=")), N("NodeMark", T("NodeMark2OpenMarker", "=="), text("m2"), T("NodeMark2CloseMarker", "==")), N("NodeSup", T("NodeSupOpenMarker", "^"), text("up"), T("NodeSupCloseMarker", "^")), N("NodeSub", T("NodeSubOpenMarker", "~"), text("dn"), T("NodeSubCloseMarker", "~"))))
	m["kbd underline tag"] = doc(para(N("NodeKbd", T("NodeKbdOpenMarker", "<kbd>"), text("k"), T("NodeKbdCloseMarker", "</kbd>")), N("NodeUnderline", T("NodeUnderlineOpenMarker", "<u>"), text("u"), T("NodeUnderlineCloseMarker", "</u>")), N("NodeTag", T("NodeTagOpenMarker", "#"), text("tag"), T("NodeTagCloseMarker", "#")), N("NodeBr")))
	m["table"] = doc(N("NodeTable",
		N("NodeTableHead", N("NodeTableRow", tableCell("h1", 1), tableCell("h2", 2), tableCell("h3", 3))),
		N("NodeTableRow", tableCell("a", 1), tableCell("b", 2), tableCell("c", 0)),
		N("NodeTableRow", tableCell("d", 0), tableCell("e", 0), tableCell("f", 3))))
	m["table head only"] = doc(N("NodeTable", N("NodeTableHead", N("NodeTableRow", tableCell("h", 0)))))
	m["table caption"] = doc(N("NodeTable",
		N("NodeTableHead", N("NodeTableRow", tableCell("h1", 0), tableCell("h2", 1))),
		N("NodeTableRow", tableCell("a", 0), tableCell("b", 0))).P("KramdownIAL", ialAny([][]string{{"id", "x"}, {"caption", "My caption"}, {"colgroup", "width:10px|"}})))
	m["table colspan"] = doc(N("NodeTable",
		N("NodeTableHead", N("NodeTableRow", tableCell("h1", 0), tableCell("h2", 0))),
		N("NodeTableRow", tableCell("a", 0).P("KramdownIAL", ialAny([][]string{{"colspan", "2"}, {"style", "color:red"}})), tableCell("b", 0).P("KramdownIAL", ialAny([][]string{{"class", "fn__none"}})))).P("KramdownIAL", ialAny(ial)))
	m["table text mark"] = doc(N("NodeTable", N("NodeTableHead", N("NodeTableRow", N("NodeTableCell", textMark("code", "a|b")), N("NodeTableCell", textMark("strong", "x\\|y\nz"))))))
	m["emoji"] = doc(para(N("NodeEmoji", T("NodeEmojiUnicode", "😀"), T("NodeEmojiAlias", ":smile:")), N("NodeEmoji", T("NodeEmojiImg", "<img alt=\"x\" src=\"y\" />"))))
	m["yaml front matter"] = doc(N("NodeYamlFrontMatter", T("NodeYamlFrontMatterOpenMarker", "---"), T("NodeYamlFrontMatterContent", "title: <x>\n"), T("NodeYamlFrontMatterCloseMarker", "---")), para(text("body")))
	m["block ref"] = doc(para(N("NodeBlockRef", T("NodeOpenParen", "("), T("NodeOpenParen", "("), T("NodeBlockRefID", "20200101000000-abcdefg"), T("NodeBlockRefSpace", " "), T("NodeBlockRefText", "ref <text>"), T("NodeCloseParen", ")"), T("NodeCloseParen", ")")), N("NodeBlockRef", T("NodeBlockRefID", "id"), T("NodeBlockRefDynamicText", "dyn"))))
	m["file annotation ref"] = doc(para(N("NodeFileAnnotationRef", T("NodeFileAnnotationRefID", "f/a"), T("NodeFileAnnotationRefSpace", " "), T("NodeFileAnnotationRefText", "an<n>"))))
	m["block query embed"] = doc(N("NodeBlockQueryEmbed", T("NodeBlockQueryEmbedScript", "select * from blocks")))
	m["super block"] = doc(N("NodeSuperBlock", T("NodeSuperBlockOpenMarker", "{{{"), T("NodeSuperBlockLayoutMarker", "row"), para(text("in")), T("NodeSuperBlockCloseMarker", "}}}")))
	m["git conflict"] = doc(N("NodeGitConflict", T("NodeGitConflictOpenMarker", "<<<<<<< HEAD"), T("NodeGitConflictContent", "a <b>\n"), T("NodeGitConflictCloseMarker", ">>>>>>> x")))
	m["git conflict ial"] = doc(N("NodeGitConflict", T("NodeGitConflictOpenMarker", "<<<<<<<"), T("NodeGitConflictContent", "x"), T("NodeGitConflictCloseMarker", ">>>>>>>")).P("KramdownIAL", ialAny(ial)))
	m["iframe video audio widget"] = doc(T("NodeIFrame", "<iframe src=\"http://x/y\" onload=\"z\"></iframe>"), T("NodeVideo", "<video src=\"v.mp4\" controls></video>"), T("NodeAudio", "<audio src=\"a.mp3\"></audio>"), T("NodeWidget", "<iframe src=\"w.html\"></iframe>"))
	m["text marks"] = doc(para(
		textMark("strong", "s"), textMark("em", "e<m>"), textMark("code", "c"), textMark("strong em", "se"),
		N("NodeTextMark").P("TextMarkType", "a").P("TextMarkTextContent", "link").P("TextMarkAHref", "http://a.b/c?d=1&e=2").P("TextMarkATitle", "tt"),
		N("NodeTextMark").P("TextMarkType", "a").P("TextMarkTextContent", "l2").P("TextMarkAHref", "rel/path.md"),
		N("NodeTextMark").P("TextMarkType", "block-ref").P("TextMarkTextContent", "br").P("TextMarkBlockRefID", "id1").P("TextMarkBlockRefSubtype", "s"),
		N("NodeTextMark").P("TextMarkType", "inline-math").P("TextMarkInlineMathContent", "a|b\nc").P("TextMarkTextContent", ""),
		N("NodeTextMark").P("TextMarkType", "inline-memo").P("TextMarkTextContent", "中文").P("TextMarkInlineMemoContent", "memo_esc_newline_x"),
		N("NodeTextMark").P("TextMarkType", "inline-memo").P("TextMarkTextContent", "abc").P("TextMarkInlineMemoContent", "memo"),
		N("NodeTextMark").P("TextMarkType", "file-annotation-ref").P("TextMarkTextContent", "fa").P("TextMarkFileAnnotationRefID", "i<d>"),
		N("NodeTextMark").P("TextMarkType", "tag").P("TextMarkTextContent", "t"),
		N("NodeTextMark").P("TextMarkType", "strong").P("TextMarkTextContent", "ial").P("KramdownIAL", ialAny([][]string{{"style", "color:red"}}))))
	m["attribute view"] = doc(N("NodeAttributeView").P("AttributeViewID", "av1").P("AttributeViewType", "table"))
	m["custom block"] = doc(T("NodeCustomBlock", "content <x>\n").P("CustomBlockInfo", "info \"q\""))
	m["callout builtin"] = doc(N("NodeCallout", para(text("body"))).P("CalloutType", "NOTE").P("CalloutTitle", "Note").P("CalloutIcon", "ℹ️").P("CalloutIconType", 0))
	m["callout custom"] = doc(N("NodeCallout", para(text("body"))).P("CalloutType", "custom").P("CalloutTitle", "My *title*").P("CalloutTitleExplicit", true).P("CalloutIcon", "🔥").P("CalloutIconType", 0))
	m["callout image icon"] = doc(N("NodeCallout", para(text("body"))).P("CalloutType", "x\"y").P("CalloutTitle", "").P("CalloutIcon", "assets/a.png").P("CalloutIconType", 1))
	m["callout empty title"] = doc(N("NodeCallout", para(text("body"))).P("CalloutType", "TIP").P("CalloutTitle", "").P("CalloutTitleExplicit", true).P("CalloutIcon", "💡").P("CalloutIconType", 0))
	m["tabs"] = doc(N("NodeTabs",
		N("NodeTabItem", para(text("one"))).P("TabItemTitle", "First *tab*").P("ID", "20200101000000-aaaaaaa"),
		N("NodeTabItem", para(text("two"))).P("TabItemTitle", "Second").P("ID", "20200101000000-bbbbbbb")).P("ID", "20200101000000-ccccccc").P("KramdownIAL", ialAny([][]string{{"tabs-active-id", "20200101000000-aaaaaaa"}, {"tabs-position", "top"}, {"tabs-task", "tt\"q"}})))
	m["document empty"] = doc()
	m["unknown node"] = doc(N("NodeLinkRefDefBlock"), N("NodeLinkRefDef"), para(text("x")), N("NodeVditorCaret"))
	m["paragraph list loose"] = doc(list(0, false, '*', 0, item(0, false, '*', 0, para(text("loose item")).P("KramdownIAL", ialAny(ial)))))
	m["image with ial"] = doc(para(N("NodeImage", T("NodeBang", "!"), T("NodeOpenBracket", "["), T("NodeLinkText", "alt"), T("NodeCloseBracket", "]"), T("NodeOpenParen", "("), T("NodeLinkDest", "a b.png"), T("NodeCloseParen", ")")).P("KramdownIAL", ialAny([][]string{{"style", "width:10px"}, {"parent-style", "display:block"}}))))
	m["image only paragraph"] = doc(para(image("a", "x.png", "")), para(text("x"), image("b", "y.png", "")), para(image("c", "z.png", ""), text(" ")), para(image("d", "z.png", ""), textMark("strong", "s")))
	m["links"] = doc(para(link("a", "javascript:alert(1)", ""), link("b", "  JavaScript:alert(1)", ""), link("c", "rel/x.md", "ti\"tle"), link("d", "/abs", ""), link("e", "http://x/<y>", ""), link("f", "", "")))
	m["sanitize image"] = doc(para(image("alt", "javascript:alert(1)", ""), image("a\" onerror=\"x", "y.png", ""), image("ok", "a.png", "t")))
	return m
}

type optSet struct {
	Name string         `json:"name"`
	Opts map[string]any `json:"opts"`
}

func optionSets() []optSet {
	return []optSet{
		{"default", map[string]any{}},
		{"AutoSpace", map[string]any{"AutoSpace": true}},
		{"Sanitize", map[string]any{"Sanitize": true}},
		{"SoftBreak2HardBreak off", map[string]any{"SoftBreak2HardBreak": false}},
		{"ToC HeadingID", map[string]any{"ToC": true, "HeadingID": true}},
		{"KramdownBlockIAL renamed id", map[string]any{"KramdownBlockIAL": true, "KramdownIALIDRenderName": "data-node-id"}},
		{"KramdownBlockIAL", map[string]any{"KramdownBlockIAL": true}},
		{"LinkBase LinkPrefix", map[string]any{"LinkBase": "http://b.com/base/", "LinkPrefix": "/p"}},
		{"ImageLazyLoading", map[string]any{"ImageLazyLoading": "lazy.png"}},
		{"ChineseParagraphBeginningSpace", map[string]any{"ChineseParagraphBeginningSpace": true}},
		{"FixTermTypo AutoSpace", map[string]any{"FixTermTypo": true, "AutoSpace": true}},
		{"HeadingAnchor", map[string]any{"HeadingAnchor": true}},
		{"RenderListStyle DataTask", map[string]any{"RenderListStyle": true, "DataTask": true}},
		{"GFMTaskListItemClass empty", map[string]any{"GFMTaskListItemClass": ""}},
		{"VditorWYSIWYG ToC", map[string]any{"VditorWYSIWYG": true, "ToC": true}},
		{"VditorIR ToC KramdownBlockIAL", map[string]any{"VditorIR": true, "ToC": true, "KramdownBlockIAL": true}},
		{"ProtyleWYSIWYG", map[string]any{"ProtyleWYSIWYG": true}},
		{"ExportNormalizeTaskListMarker off", map[string]any{"ExportNormalizeTaskListMarker": false}},
	}
}

func applyOptions(o *render.Options, set map[string]any) {
	v := reflect.ValueOf(o).Elem()
	for k, val := range set {
		f := v.FieldByName(k)
		if !f.IsValid() {
			panic("unknown option " + k)
		}
		switch x := val.(type) {
		case bool:
			f.SetBool(x)
		case string:
			f.SetString(x)
		default:
			panic("unsupported option type")
		}
	}
}

type smokeCase struct {
	Name string    `json:"name"`
	Opt  string    `json:"opt"`
	Out  *string   `json:"out"`
}

func genTrees(rnd *rand.Rand) map[string]any {
	_ = rnd
	ret := map[string]any{}

	// ---- html renderer smoke
	trees := smokeTrees()
	var names []string
	for k := range trees {
		names = append(names, k)
	}
	sortStrings(names)
	ret["optionSets"] = optionSets()
	var smoke []smokeCase
	for _, name := range names {
		for _, os := range optionSets() {
			spec := roundTrip(trees[name])
			root := buildNode(spec)
			opts := render.NewOptions()
			applyOptions(opts, os.Opts)
			tree := &parse.Tree{Root: root}
			var out string
			if try(func() { out = string(render.NewHtmlRenderer(tree, opts, parse.NewOptions()).Render()) }) {
				smoke = append(smoke, smokeCase{name, os.Name, nil})
			} else {
				smoke = append(smoke, smokeCase{name, os.Name, strp(must(out))})
			}
		}
	}
	ret["smoke"] = smoke
	ret["smokeTrees"] = trees

	ret["headings"] = genHeadings()
	ret["setext"] = genSetext()
	ret["tabsEscape"] = genTabsEscape()
	ret["callout"] = genCallout()
	ret["customBlock"] = genCustomBlock()
	ret["mindmapNodes"] = genMindmapNodes()
	ret["baseMethods"] = genBaseMethods()
	return ret
}

func sortStrings(a []string) {
	for i := 1; i < len(a); i++ {
		for j := i; 0 < j && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

func headingNodes(root *ast.Node) []*ast.Node {
	var ret []*ast.Node
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeHeading == n.Type {
			ret = append(ret, n)
		}
		return ast.WalkContinue
	})
	return ret
}

func genHeadings() []map[string]any {
	docs := []*NodeSpec{
		doc(heading(1, text("Hello World"))),
		doc(heading(1, text("Same")), heading(2, text("Same")), heading(2, text("Same")), heading(3, text("Same-"))),
		doc(heading(1, text("中文 标题!")), heading(2, text("#### x")), heading(2, text("a_b c.d"))),
		doc(heading(1, text("Title"), T("NodeHeadingID", "custom-id")), heading(2, text("x"), T("NodeHeadingID", "custom-id")), heading(3, text("y"), T("NodeHeadingID", "##x y"))),
		doc(heading(1, text("‸caret")), heading(2, text("a‸b")), heading(2, text("‸"))),
		doc(heading(1, text("")), heading(2), heading(3, text("  ")), heading(1, text("---"))),
		doc(heading(1, text("a "), codeSpan("b"), text(" "), strong("c")), heading(2, link("l", "u", ""))),
		doc(heading(1, text("Ünï Çødé")), heading(2, text("١٢٣ 123 ½")), heading(2, text("😀 emoji"))),
		doc(para(text("p")), heading(1, text("After para")), N("NodeBlockquote", heading(2, text("In quote")))),
		doc(heading(1, text("A")), heading(2, text("A")), heading(3, text("A")), heading(1, text("A")), heading(1, text("A-")), heading(1, text("A--"))),
		doc(heading(1, text("Fo"), T("NodeHeadingID", "")), heading(1, text("Fo"), T("NodeHeadingID", ""))),
		doc(heading(1, text("x")).P("HeadingNormalizedID", "preset")),
	}
	var ret []map[string]any
	for _, spec := range docs {
		walkProps(spec)
		rt := roundTrip(spec)
		root := buildNode(rt)
		hs := headingNodes(root)
		var normalized, raws, texts, renderTexts []string
		for _, h := range hs {
			normalized = append(normalized, linkNormalizeHeadingID(h))
			raws = append(raws, render.HeadingIDRaw(h))
			texts = append(texts, linkHeadingText(h))
			renderTexts = append(renderTexts, render.RenderHeadingText(h))
		}
		var ids []string
		for _, h := range hs {
			ids = append(ids, render.HeadingID(h))
		}
		// the same ids through a second renderer-free call order: last heading first
		root2 := buildNode(roundTrip(spec))
		hs2 := headingNodes(root2)
		var idsReverse []string
		for i := len(hs2) - 1; 0 <= i; i-- {
			idsReverse = append(idsReverse, render.HeadingID(hs2[i]))
		}
		ret = append(ret, map[string]any{"spec": spec, "normalized": normalized, "raw": raws, "headingText": texts, "renderHeadingText": renderTexts, "ids": ids, "idsReverse": idsReverse})
	}
	return ret
}

// walkProps is a hook for specs that need post-processing; it does nothing.
func walkProps(*NodeSpec) {}

func genSetext() []map[string]any {
	type c struct {
		texts []string // text nodes, "\n" is a soft break node, "\r" a hard break node
		pick  int      // index of the text node to ask about
	}
	cases := []c{
		{[]string{"foo", "\n", "---"}, 2},
		{[]string{"foo", "\n", "==="}, 2},
		{[]string{"foo", "\n", "  ---  "}, 2},
		{[]string{"foo", "\n", "    ---"}, 2},
		{[]string{"foo", "\n", "- x"}, 2},
		{[]string{"foo", "\n", "-"}, 2},
		{[]string{"foo", "\n", "--", "bar"}, 2},
		{[]string{"foo", "\n", "-", "-"}, 2},
		{[]string{"foo", "\n", "‸---"}, 2},
		{[]string{"foo", "\n", "-‸--"}, 2},
		{[]string{"foo", "\n", "--- ‸"}, 2},
		{[]string{"foo", "\r", "---"}, 2},
		{[]string{"foo", "\n", "bar", "\n", "==="}, 4},
		{[]string{"foo", "\n", "bar", "\n", "==="}, 2},
		{[]string{"---"}, 0},
		{[]string{"foo", "\n", " "}, 2},
		{[]string{"foo", "\n", "\t-"}, 2},
		{[]string{"foo", "\n", "--a"}, 2},
		{[]string{"foo", "\n", "-\n---"}, 2},
		{[]string{"foo", "\n", "=-"}, 2},
		{[]string{"foo\n---\nbar\n===", "\n", "x"}, 0},
		{[]string{"foo\n---", "\n", "x"}, 0},
		{[]string{"foo\n  ---\n   ===", "\n", "x"}, 0},
		{[]string{"a\n--\nb"}, 0},
		{[]string{"a\n--\nb\n==\nc\n-- "}, 0},
		{[]string{"foo\n"}, 0},
		{[]string{"\n---"}, 0},
		{[]string{"x\n    ---\n\t==="}, 0},
		{[]string{"x\n-\t-"}, 0},
		{[]string{"x\n‸---\n-‸-"}, 0},
		{[]string{"x\n---", "\n", "y\n==="}, 2},
		{[]string{"foo", "\n", "---", "\n", "bar"}, 2},
	}
	var ret []map[string]any
	for _, cc := range cases {
		for _, inList := range []bool{true, false} {
			var kids []*NodeSpec
			for _, s := range cc.texts {
				switch s {
				case "\n":
					kids = append(kids, N("NodeSoftBreak"))
				case "\r":
					kids = append(kids, N("NodeHardBreak"))
				default:
					kids = append(kids, text(s))
				}
			}
			p := para(kids...)
			var spec *NodeSpec
			if inList {
				spec = doc(list(0, true, '*', 0, item(0, true, '*', 0, p)))
			} else {
				spec = doc(p)
			}
			spec = roundTrip(spec)
			root := buildNode(spec)
			var pnode *ast.Node
			if inList {
				pnode = root.FirstChild.FirstChild.FirstChild
			} else {
				pnode = root.FirstChild
			}
			n := pnode.FirstChild
			for i := 0; i < cc.pick; i++ {
				n = n.Next
			}
			path := []int{0}
			if inList {
				path = []int{0, 0, 0}
			}
			path = append(path, cc.pick)
			tokens := []byte(string(n.Tokens))
			ret = append(ret, map[string]any{
				"spec":    spec,
				"path":    path,
				"offset":  linkSetextHeadingMarkerOffsetInListParagraph(n),
				"escaped": string(linkEscapeSetextHeadingMarkersInListParagraph(n, tokens)),
			})
		}
	}
	return ret
}

func genTabsEscape() []map[string]any {
	lines := []string{"@tab", "foo\n@tab\nbar", "::: tabs", "a\n:::\nb", "  @tab x", "plain", "", "\n", "@tab\n@tab:active y\n::: tabs\n:::\n", "‸@tab", "x\n‸::: tabs", "x\n\t@tab\t\n@tabx", "x\r\n@tab\r\ny", "中\n@tab 中"}
	var ret []map[string]any
	for _, parentKind := range []string{"paragraph", "paragraph in tabs", "document", "heading", "list"} {
		for _, s := range lines {
			for _, withinTabsOnly := range []bool{false, true} {
				for _, afterBreak := range []bool{false, true} {
					textNode := text(s)
					var spec *NodeSpec
					var path []int
					var kids []*NodeSpec
					if afterBreak {
						kids = append(kids, text("prev"), N("NodeSoftBreak"), textNode)
					} else {
						kids = append(kids, textNode)
					}
					idx := len(kids) - 1
					switch parentKind {
					case "paragraph":
						spec = doc(para(kids...))
						path = []int{0, idx}
					case "paragraph in tabs":
						spec = doc(N("NodeTabs", N("NodeTabItem", para(kids...))))
						path = []int{0, 0, 0, idx}
					case "document":
						spec = doc(append([]*NodeSpec{}, kids...)...)
						path = []int{idx}
					case "heading":
						spec = doc(N("NodeHeading", kids...).P("HeadingLevel", 1))
						path = []int{0, idx}
					default:
						spec = doc(list(0, true, '*', 0, item(0, true, '*', 0, para(kids...))))
						path = []int{0, 0, 0, idx}
					}
					spec = roundTrip(spec)
					root := buildNode(spec)
					n := nodeAt(root, path)
					var out string
					var panicked bool
					panicked = try(func() { out = string(linkEscapeTabsParagraphMarkers(n, []byte(s), withinTabsOnly)) })
					m := map[string]any{"spec": spec, "path": path, "tokens": s, "withinTabsOnly": withinTabsOnly}
					if panicked {
						m["out"] = nil
					} else {
						m["out"] = out
					}
					ret = append(ret, m)
				}
			}
		}
	}
	return ret
}

func genCallout() []map[string]any {
	var ret []map[string]any
	types := []string{"NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION", "custom", "", "note", "X\"Y"}
	titles := []string{"", "Note", "Tip", "Custom title", "中文标题", " padded "}
	icons := []string{"", "ℹ️", "💡", "assets/a.png", "http://x/y.png", "javascript:x", "a b.png", "x<y>"}
	for _, ty := range types {
		for _, ti := range titles {
			for _, explicit := range []bool{false, true} {
				for _, ic := range icons {
					for _, it := range []int{0, 1} {
						if (len(ti)+len(ic)+len(ty)+it)%3 != 0 && ty != "NOTE" && ty != "custom" {
							continue
						}
						spec := N("NodeCallout").P("CalloutType", ty).P("CalloutTitle", ti).P("CalloutTitleExplicit", explicit).P("CalloutIcon", ic).P("CalloutIconType", it)
						spec = roundTrip(spec)
						n := buildNode(spec)
						ret = append(ret, map[string]any{
							"spec":         spec,
							"title":        linkCalloutTitle(n),
							"displayTitle": linkCalloutDisplayTitle(n),
							"editableIcon": linkCalloutEditableIcon(n),
							"editableInfo": linkCalloutEditableInfo(n),
						})
					}
				}
			}
		}
	}
	return ret
}

func genCustomBlock() []map[string]any {
	var ret []map[string]any
	for _, info := range []string{"", "x", "a b", "q\"uote", "<tag>", "a&b", "中文", "it's"} {
		for _, tokens := range []string{"", "content", "<b>&\"x\"</b>", "多行\n内容\n", "a'b"} {
			spec := roundTrip(T("NodeCustomBlock", tokens).P("CustomBlockInfo", info))
			n := buildNode(spec)
			ret = append(ret, map[string]any{"spec": spec, "attrs": linkCustomBlockAttrs(n)})
		}
	}
	return ret
}

func genMindmapNodes() []map[string]any {
	var ret []map[string]any
	docs := []*NodeSpec{
		doc(),
		doc(para(text("x"))),
		doc(list(0, true, '*', 0, item(0, true, '*', 0, para(text("a"))))),
		doc(list(0, true, '*', 0, item(0, true, '*', 0, para(text("a"))), item(0, true, '*', 0, para(text("b"))))),
		doc(list(0, true, '*', 0, item(0, true, '*', 0, para(text("a")))), list(0, true, '*', 0, item(0, true, '*', 0, para(text("b"))))),
		doc(para(text("x")), list(0, true, '*', 0, item(0, true, '*', 0, para(text("a"))))),
		doc(list(0, true, '*', 0)),
		doc(list(0, true, '*', 0, item(0, true, '*', 0, para(text("a\\b \"q\" ‸")), list(0, true, '*', 0, item(0, true, '*', 0, para(link("l", "u", "")))))),),
	}
	for _, spec := range docs {
		spec = roundTrip(spec)
		root := buildNode(spec)
		m := map[string]any{"spec": spec, "needRoot": linkNeedRoot(root)}
		var texts []string
		ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeListItem == n.Type {
				texts = append(texts, linkMindmapText(n.FirstChild))
			}
			return ast.WalkContinue
		})
		m["texts"] = texts
		m["textNil"] = linkMindmapText(nil)
		ret = append(ret, m)
	}
	return ret
}

func genBaseMethods() []map[string]any {
	var ret []map[string]any
	trees := smokeTrees()
	var names []string
	for k := range trees {
		names = append(names, k)
	}
	sortStrings(names)
	for _, name := range names {
		spec := roundTrip(trees[name])
		root := buildNode(spec)
		r := render.NewBaseRenderer(&parse.Tree{Root: root}, render.NewOptions(), parse.NewOptions())
		var nodes []*ast.Node
		ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering {
				nodes = append(nodes, n)
			}
			return ast.WalkContinue
		})
		var per []map[string]any
		for i, n := range nodes {
			m := map[string]any{"i": i}
			m["text"] = r.Text(n)
			m["attrsStr"] = r.NodeAttrsStr(n)
			m["attrs"] = r.NodeAttrs(n)
			m["paragraphContainImgOnly"] = r.ParagraphContainImgOnly(n)
			m["needUseHTMLTable"] = linkNeedUseHTMLTable(r, n)
			m["isLastNode"] = linkIsLastNode(r, root, n)
			if ast.NodeHeading == n.Type {
				m["setextHeadingLen"] = linkSetextHeadingLen(r, n)
			}
			if "" != n.IALAttr("id") || true {
				m["ialID"] = n.IALAttr("id")
			}
			per = append(per, m)
		}
		ret = append(ret, map[string]any{"name": name, "spec": trees[name], "nodes": per})
	}
	// tagSrc / tagSrcPath on plain strings
	r := render.NewBaseRenderer(nil, render.NewOptions(), nil)
	var src []map[string]any
	for _, s := range []string{"", "<img>", "<img src=\"a.png\">", "<img src=\"a&amp;b\">", "<img src=\"\">", "<img src=\"a", "<img alt=\"x\" src=\"//cdn/x.png\" />", "src=\"x\"", "<video src=\"v\"><source src=\"w\"></video>", "<img src=\"‸\">", "<img src=\"中文.png\">"} {
		m := map[string]any{"in": s}
		var out []byte
		if try(func() { out = linkTagSrc(r, []byte(s)) }) {
			m["tagSrc"] = "PANIC"
		} else if nil == out {
			m["tagSrc"] = nil
		} else {
			m["tagSrc"] = string(out)
		}
		for _, base := range []string{"", "http://b/"} {
			for _, prefix := range []string{"", "/pre"} {
				o := render.NewOptions()
				o.LinkBase = base
				o.LinkPrefix = prefix
				rr := render.NewBaseRenderer(nil, o, nil)
				m[fmt.Sprintf("tagSrcPath|%s|%s", base, prefix)] = string(linkTagSrcPath(rr, []byte(s)))
			}
		}
		src = append(src, m)
	}
	ret = append(ret, map[string]any{"name": "tagSrc", "src": src})
	return ret
}
