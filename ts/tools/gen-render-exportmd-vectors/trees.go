package main

import (
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
)

// Hand-built trees: text mark nodes in every combination of types (the Markdown parser reaches them only through the Block DOM conversion that is not ported
// yet), and the nodes that no Markdown input produces (Underline, Kbd, Widget, Br, ...).

type treeCase struct {
	Spec *NodeSpec `json:"spec"`
	R    int       `json:"r"`
	Th   bool      `json:"th,omitempty"`
	O    *string   `json:"o,omitempty"`
	H    string    `json:"h,omitempty"`
	N    int       `json:"n"`
}

func docOf(children ...*NodeSpec) *NodeSpec  { return N("NodeDocument", children...) }
func paraOf(children ...*NodeSpec) *NodeSpec { return N("NodeParagraph", children...) }
func textOf(s string) *NodeSpec              { return T("NodeText", s) }

func tm(typ, content string) *NodeSpec {
	return N("NodeTextMark").P("TextMarkType", typ).P("TextMarkTextContent", content)
}

func tmFull(typ, content string) *NodeSpec {
	n := tm(typ, content)
	for _, t := range strings.Split(typ, " ") {
		switch t {
		case "a":
			n.P("TextMarkAHref", "http://a.b/c?d=1&amp;e=2 f").P("TextMarkATitle", "ti&lt;t&gt;le \"q\"")
		case "inline-math":
			n.P("TextMarkInlineMathContent", "a|b\nc_esc_newline_d")
		case "inline-memo":
			n.P("TextMarkInlineMemoContent", "memo_esc_newline_x")
		case "block-ref":
			n.P("TextMarkBlockRefID", "20200101010101-abcdefg").P("TextMarkBlockRefSubtype", "d")
		case "file-annotation-ref":
			n.P("TextMarkFileAnnotationRefID", "20200101010101-abcdefg")
		}
	}
	return n
}

func ialAnyOf(ial [][]string) []any {
	var ret []any
	for _, kv := range ial {
		ret = append(ret, []any{kv[0], kv[1]})
	}
	return ret
}

var tmTypes = []string{"strong", "em", "code", "s", "mark", "u", "sup", "sub", "kbd", "tag", "text", "a", "inline-memo", "block-ref", "file-annotation-ref", "inline-math"}

var tmContents = []string{"abc", "a`b", "a``b", " lead", "trail ", "，标点", "中文", "a|b", "q'uo\"te", "[x]", ""}

func treeSpecs() []*NodeSpec {
	var ret []*NodeSpec
	ctx := func(inner ...*NodeSpec) []*NodeSpec {
		return []*NodeSpec{
			docOf(paraOf(inner...)),
			docOf(paraOf(append(append([]*NodeSpec{textOf("before ")}, inner...), textOf(" after"))...)),
			docOf(paraOf(append(append([]*NodeSpec{}, inner...), tm("strong", "next"))...)),
			docOf(paraOf(append(append([]*NodeSpec{}, inner...), tm("a", "next"))...)),
			docOf(N("NodeTable",
				N("NodeTableHead", N("NodeTableRow", N("NodeTableCell", textOf("h")).P("TableCellAlign", 0))),
				N("NodeTableRow", N("NodeTableCell", inner...).P("TableCellAlign", 0)))),
		}
	}
	// every single type with every content
	for ti, typ := range tmTypes {
		for ci, c := range tmContents {
			n := tmFull(typ, c)
			if (ti+ci)%3 == 0 {
				ret = append(ret, ctx(n)...)
			} else {
				ret = append(ret, docOf(paraOf(n)), docOf(paraOf(textOf("x "), n, textOf(" y"))))
			}
		}
	}
	// every ordered pair of types, content "abc" and "a`b"
	for _, a := range tmTypes {
		for _, b := range tmTypes {
			for _, c := range []string{"abc", "a`b"} {
				if c == "a`b" && (len(a)+len(b))%3 != 0 {
					continue
				}
				ret = append(ret, docOf(paraOf(tmFull(a+" "+b, c))), docOf(paraOf(textOf("p "), tmFull(a+" "+b, c), tmFull(b, "n"))))
			}
		}
	}
	// triples and a few longer lists, including text and code positions
	for i, a := range tmTypes {
		b := tmTypes[(i*5+3)%len(tmTypes)]
		c := tmTypes[(i*7+1)%len(tmTypes)]
		ret = append(ret,
			docOf(paraOf(tmFull(a+" "+b+" "+c, "abc"))),
			docOf(paraOf(tmFull(c+" "+a+" "+b, "a`b"))),
			docOf(paraOf(tmFull("text "+a, "abc").P("KramdownIAL", ialAnyOf([][]string{{"style", "color: red;"}})))),
			docOf(paraOf(tmFull(a+" code text", "abc"))),
		)
	}
	ret = append(ret,
		docOf(paraOf(tmFull("strong em s code", "abc"))),
		docOf(paraOf(tmFull("code strong", "a``b"))),
		docOf(paraOf(tmFull("a code", "abc"), tmFull("a code", "def"))),
		docOf(paraOf(tmFull("inline-memo", "abc"), tmFull("inline-memo", "def"))),
		docOf(paraOf(tmFull("inline-memo strong", "abc"), tmFull("inline-memo em", "def"))),
		docOf(paraOf(tmFull("text", "abc").P("KramdownIAL", ialAnyOf([][]string{{"style", "color: red;"}, {"id", "i1"}})))),
		docOf(paraOf(tmFull("strong", " x "), textOf("tail"))),
		docOf(paraOf(tmFull("em", "，x，"), textOf("tail"))),
		docOf(paraOf(tmFull("s", "x"), tmFull("strong", "y"), tmFull("em", "z"))),
	)

	// nodes without a Markdown source
	ret = append(ret,
		docOf(paraOf(textOf("a "), N("NodeUnderline", T("NodeUnderlineOpenMarker", "<u>"), textOf("under"), T("NodeUnderlineCloseMarker", "</u>")), textOf(" b"))),
		docOf(paraOf(textOf("a "), N("NodeKbd", T("NodeKbdOpenMarker", "<kbd>"), textOf("Ctrl"), T("NodeKbdCloseMarker", "</kbd>")), textOf(" b"))),
		docOf(paraOf(textOf("a"), N("NodeBr"), textOf("b"))),
		docOf(T("NodeWidget", "<iframe data-subtype=\"widget\" src=\"/widgets/a/\"></iframe>")),
		docOf(T("NodeWidget", "<iframe data-subtype=\"widget\" src=\"/widgets/a/\"></iframe>"), paraOf(textOf("after"))),
		docOf(T("NodeIFrame", "<iframe src=\"http://x.y/z\"></iframe>"), T("NodeVideo", "<video src=\"a.mp4\"></video>"), T("NodeAudio", "<audio src=\"a.mp3\"></audio>")),
		docOf(N("NodeAttributeView").P("AttributeViewID", "av1").P("AttributeViewType", "table"), paraOf(textOf("after"))),
		docOf(N("NodeAttributeView").P("AttributeViewID", "av1").P("AttributeViewType", "table")),
		docOf(N("NodeCustomBlock").P("CustomBlockInfo", "echarts"), paraOf(textOf("after"))),
		docOf(T("NodeCustomBlock", "{}").P("CustomBlockInfo", "echarts")),
		docOf(N("NodeBlockQueryEmbed", T("NodeBlockQueryEmbedScript", "select * from blocks"))),
		docOf(T("NodeToC", "")),
		docOf(paraOf(N("NodeEmoji", T("NodeEmojiImg", "<img alt=\"huaji\" class=\"emoji\" src=\"http://e/huaji.gif\" title=\"huaji\" />", T("NodeEmojiAlias", ":huaji:"))))),
		docOf(paraOf(N("NodeEmoji", T("NodeEmojiUnicode", "\U0001F600", T("NodeEmojiAlias", ":grinning:"))))),
		docOf(paraOf(textOf("&amp;"), T("NodeHTMLEntity", "&amp;"))),
		docOf(paraOf(T("NodeBackslash", "", T("NodeBackslashContent", "*")))),
		docOf(N("NodeYamlFrontMatter", T("NodeYamlFrontMatterOpenMarker", "---"), T("NodeYamlFrontMatterContent", "a: b"), T("NodeYamlFrontMatterCloseMarker", "---")), paraOf(textOf("x"))),
		docOf(N("NodeLinkRefDefBlock", T("NodeLinkRefDef", "ref", T("NodeLinkDest", "http://x"))), paraOf(textOf("x"))),
		docOf(N("NodeGitConflict", T("NodeGitConflictOpenMarker", "<<<<<<< HEAD"), T("NodeGitConflictContent", "a\n=======\nb"), T("NodeGitConflictCloseMarker", ">>>>>>> x"))),
		docOf(N("NodeHeading", T("NodeHeadingC8hMarker", "#"), textOf("h"), T("NodeHeadingID", "custom")).P("HeadingLevel", 2)),
		docOf(N("NodeHeading", textOf("setext h")).P("HeadingLevel", 1).P("HeadingSetext", true)),
		docOf(N("NodeHeading", textOf("setext h2")).P("HeadingLevel", 2).P("HeadingSetext", true)),
		docOf(N("NodeHeading", textOf("中文 h")).P("HeadingLevel", 1).P("HeadingSetext", true)),
		docOf(paraOf(textOf("a"), N("NodeSoftBreak"), textOf("b"), N("NodeHardBreak"), textOf("c"))),
		docOf(N("NodeThematicBreak"), paraOf(textOf("x"))),
		docOf(N("NodeMindmap", N("NodeMindmapItem", paraOf(textOf("m"))).P("ListData", listDataOf(0, true, '*', 1)))),
		docOf(N("NodeSuperBlock", T("NodeSuperBlockOpenMarker", "{{{"), T("NodeSuperBlockLayoutMarker", "row"), paraOf(textOf("i")), T("NodeSuperBlockCloseMarker", "}}}")), paraOf(textOf("after"))),
		docOf(N("NodeFootnotesDefBlock", N("NodeFootnotesDef", paraOf(textOf("def"))), N("NodeFootnotesDef", paraOf(textOf("d2"), N("NodeSoftBreak"), textOf("more"))))),
		docOf(paraOf(textOf("a"), T("NodeFootnotesRef", "^1"), textOf("b"))),
		docOf(paraOf(textOf("a "), N("NodeMark", T("NodeMark1OpenMarker", "="), textOf("m1"), T("NodeMark1CloseMarker", "=")), textOf(" b"))),
		docOf(paraOf(textOf("a "), N("NodeMark", T("NodeMark2OpenMarker", "=="), textOf("m2"), T("NodeMark2CloseMarker", "==")), textOf(" b"))),
		docOf(paraOf(textOf("a "), N("NodeStrikethrough", T("NodeStrikethrough1OpenMarker", "~"), textOf("s1"), T("NodeStrikethrough1CloseMarker", "~")), textOf(" b"))),
		docOf(paraOf(textOf("a "), N("NodeStrikethrough", T("NodeStrikethrough2OpenMarker", "~~"), textOf("s2"), T("NodeStrikethrough2CloseMarker", "~~")), textOf(" b"))),
		docOf(paraOf(textOf("a "), N("NodeEmphasis", T("NodeEmU8eOpenMarker", "_"), textOf("e"), T("NodeEmU8eCloseMarker", "_")), N("NodeStrong", T("NodeStrongU8eOpenMarker", "__"), textOf("s"), T("NodeStrongU8eCloseMarker", "__")))),
		docOf(paraOf(textOf("a "), N("NodeSup", T("NodeSupOpenMarker", "^"), textOf("p"), T("NodeSupCloseMarker", "^")), N("NodeSub", T("NodeSubOpenMarker", "~"), textOf("b"), T("NodeSubCloseMarker", "~")))),
		docOf(paraOf(textOf("a "), N("NodeTag", T("NodeTagOpenMarker", "#"), textOf("t"), T("NodeTagCloseMarker", "#")), textOf(" b"))),
		docOf(paraOf(N("NodeFileAnnotationRef", T("NodeLess", "<"), T("NodeLess", "<"), T("NodeFileAnnotationRefID", "assets/a.pdf/20200101010101-abcdefg"), T("NodeFileAnnotationRefSpace", " "), T("NodeFileAnnotationRefText", "it's <b>"), T("NodeGreater", ">"), T("NodeGreater", ">")))),
		docOf(paraOf(N("NodeBlockRef", T("NodeOpenParen", "("), T("NodeOpenParen", "("), T("NodeBlockRefID", "20200101010101-abcdefg"), T("NodeBlockRefSpace", " "), T("NodeBlockRefText", "it's <b>"), T("NodeCloseParen", ")"), T("NodeCloseParen", ")")))),
		docOf(paraOf(N("NodeBlockRef", T("NodeOpenParen", "("), T("NodeOpenParen", "("), T("NodeBlockRefID", "20200101010101-abcdefg"), T("NodeBlockRefSpace", " "), T("NodeBlockRefDynamicText", "dyn's"), T("NodeCloseParen", ")"), T("NodeCloseParen", ")")))),
		docOf(paraOf(N("NodeLink", N("NodeOpenBrace"), T("NodeLinkText", "x"), N("NodeCloseBrace")).P("LinkType", 0))),
		docOf(paraOf(N("NodeLink", T("NodeLinkText", "x"), T("NodeLinkDest", "http://a.b")).P("LinkType", 1))),
		docOf(paraOf(N("NodeLink", T("NodeLinkText", "x")).P("LinkType", 3).P("LinkRefLabel", "lbl"))),
		docOf(paraOf(N("NodeLink", T("NodeLinkText", "x")).P("LinkType", 3).P("LinkRefLabel", "x"))),
	)
	return ret
}

func listDataOf(typ int, tight bool, bullet int, start int) map[string]any {
	ret := map[string]any{"Typ": typ, "Tight": tight, "BulletChar": bullet, "Start": start, "Num": start}
	if 1 == typ {
		ret["Delimiter"] = int('.')
		ret["Marker"] = fmt.Sprintf("%d.", start)
	} else {
		ret["Marker"] = string(rune(bullet))
	}
	return ret
}

func renderTreeOnce(spec *NodeSpec, rs renderSet) (out string, panicked bool) {
	defer func() {
		if r := recover(); nil != r {
			panicked = true
			out = ""
		}
	}()
	ast.Testing = true
	po := parse.NewOptions()
	setByName(po, parseSets[0].Opts)
	root := buildNode(roundTrip(spec))
	tree := &parse.Tree{Root: root, Context: &parse.Context{ParseOption: po}}
	ro := render.NewOptions()
	setByName(ro, rs.Opts)
	out = string(render.NewProtyleExportMdRenderer(tree, ro, po).Render())
	return
}

var unstableTrees int

func genTrees() (ret []treeCase, panics int) {
	sets := []string{"kramdown", "plain", "autospace", "wysiwyg-off"}
	for i, spec := range treeSpecs() {
		for si, name := range sets {
			if (i+si)%2 != 0 && "plain" != name {
				continue
			}
			rs := renderSets[rsIndex(name)]
			out, panicked := renderTreeOnce(spec, rs)
			stable := true
			for k := 0; k < 8; k++ {
				o2, p2 := renderTreeOnce(spec, rs)
				if o2 != out || p2 != panicked {
					stable = false
				}
			}
			if !stable {
				// the "text" text mark type iterates a Go map of its attributes: the order of two or more attributes is random
				unstableTrees++
				continue
			}
			tc := treeCase{Spec: roundTrip(spec), R: rsIndex(name), Th: panicked}
			if panicked {
				panics++
			} else {
				tc.O, tc.H, tc.N = pack(out)
			}
			ret = append(ret, tc)
		}
	}
	return
}
