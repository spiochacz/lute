// Command gen-parse-blocks-vectors runs the real Go parse package for the block-level files ported in ts/src/parse
// (heading, heading_id, thematic_break, blockquote, list, code_block, html_block, paragraph, math_block, yaml_front_matter,
// toc, footnotes, super_block, custom_block, callout, gitconflict, block_query_embed, tabs).
//
// Usage (from this directory):
//
//	go run -tags javascript .        writes ../../src/parse/testdata/blocks_vectors.json  (pure functions)
//	go run -tags javascript . tree   writes ../../src/parse/testdata/blocks_tree_vectors.json  (whole block trees)
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func main() {
	ast.Testing = true
	if 1 < len(os.Args) && "tree" == os.Args[1] {
		genTree()
		return
	}
	genPure()
}

// vec is one call of a pure function. Args and Ret hold byte slices as hex strings, null for a nil slice.
type vec struct {
	Args  []any `json:"args"`
	Ret   any   `json:"ret"`
	Panic bool  `json:"panic"`
}

type doc struct {
	GoVersion string           `json:"goVersion"`
	Functions map[string][]vec `json:"functions"`
}

func hexOrNull(b []byte) any {
	if nil == b {
		return nil
	}
	return hex.EncodeToString(b)
}

// call runs f and records a panic instead of crashing.
func call(args []any, f func() any) (v vec) {
	v.Args = args
	defer func() {
		if r := recover(); nil != r {
			v.Panic = true
			v.Ret = nil
		}
	}()
	v.Ret = f()
	return
}

// tagCorpus is the set of byte inputs for the HTML tag helpers. Raw bytes are written with escapes so invalid UTF-8 is kept.
var tagCorpus = []string{
	"", " ", "<", ">", "<>", "</>", "<a>", "<a/>", "<a />", "<A>", "<a>b", "<1a>", "< a>", "<a >", "<a  >", "</a>", "</ a>", "</a >", "</A>", "</1>",
	"<div>", "<div class=\"x\">", "<div class='x'>", "<div class=x>", "<div class=\"x y\">", "<div class=x y>", "<div class= x>", "<div class =x>",
	"<div data-x=\"1\" id='a'>", "<div id=\"a\"b=\"c\">", "<div id=\"a>", "<div id=a\">", "<div id=\"\">", "<div id=''>", "<div id=\">", "<div id='>",
	"<div a=b=c>", "<div a=b'c>", "<div a=b`c>", "<div a=b<c>", "<div a=b>c>", "<div a=\"b\"c\">", "<div a='b'c'>", "<div a=\"b'c\">", "<div a='b\"c'>",
	"<div _a=1>", "<div :a=1>", "<div .a=1>", "<div -a=1>", "<div 1a=1>", "<div a.b:c_d-e=1>", "<div a$=1>", "<div a b c>", "<div a  b>", "<div a= >",
	"<div\ta=1>", "<div\na=1>", "<div a=\"1\n2\">", "<div a=\"1\t2\">", "<div a='\n'>",
	"<my-tag>", "<my-tag a=\"1\"/>", "<my_tag>", "<my.tag>", "<a-1>", "<a1-b>", "<a1_b>", "<aé>", "<a中>", "<中>", "<a b=\"中文\">", "<a 中=1>",
	"<a b=\"\U0001F600\">", "<a b=\x80>", "<a\xff>", "<a b=\"\xfe\xff\">", "</a\xff>", "</\xc3\x28>",
	"<a/ >", "<a //>", "<a b/>", "<a b=1/>", "<a b=\"1\"/>", "</a/>", "</a-b>", "</a_b>", "</a b>", "</a1>", "</a\n>", "</a\t>",
	"<img src=\"x\" alt=\"y\">", "<br>", "<br/>", "<hr />", "<input disabled>", "<input disabled=>", "<input =x>", "<a =>",
	"<script>", "</script>", "<!-- x -->", "<?php ?>", "<!DOCTYPE html>", "<![CDATA[x]]>", "<a\x00>",
	"<a b=\"c\" d='e' f=g h>", "<a b = \"c\">", "<a b= \"c\">", "<a b =\"c\">", "<a  b=\"c\"  d=\"e\"  >",
}

// htmlCorpus is the set of inputs for parseHTML: the start of a line that begins with < (line end included).
var htmlCorpus = []string{
	"", "<", "<\n", "<a", "<a\n", "<a>\n", "<a>", "<?\n", "<!\n", "<!-", "<!--", "<!--\n", "<!-- x -->\n", "<?php\n", "<?php ?>\n", "<!DOCTYPE html>\n", "<!doctype html>\n", "<!A\n", "<!a\n", "<!Z\n", "<![CDATA[\n", "<![CDATA[x]]>\n", "<![cdata[\n", "<![CDAT\n",
	"<div", "<p", "</div", "<ul", "<h1", "<pre", "<style",
	"<script>\n", "<script \n", "<script", "<scripts>\n", "<SCRIPT>\n", "<pre>\n", "<pre\n", "<pre>x</pre>\n", "<style>\n", "<style type=\"x\">\n", "<textarea>\n", "<textarea\n", "<texta>\n", "<prex>\n",
	"<div>\n", "<div\n", "<div >\n", "<div/>\n", "<div/", "<div/x\n", "<divx>\n", "<DIV>\n", "</div>\n", "</div\n", "</div/>\n", "<address>\n", "<p>\n", "<p/>\n", "<pa>\n", "<param>\n", "<table>\n", "<td>\n", "<th>\n", "<tr>\n", "<title>\n", "<li>\n", "<link>\n", "<ul>\n", "<ol>\n", "<h1>\n", "<h7>\n", "<hr>\n", "<hr/>\n", "<hr />\n", "<html>\n", "<iframe>\n", "<audio>\n", "<video>\n", "<source>\n", "<summary>\n", "<details>\n", "<dialog>\n", "<main>\n", "<nav>\n", "<section>\n",
	"<a href=\"x\">\n", "<a href=\"x\">y</a>\n", "<my-tag>\n", "<my-tag a=\"1\">\n", "<a\tb>\n", "<a>b\n", "<a b\n", "<a b=\"c\"\n", "<a/>\n", "<img src=\"x\">\n", "<span>x</span>\n", "<em>\n", "</em>\n", "</a>\n", "</a> x\n", "</1>\n", "<1>\n", "<>\n", "</>\n",
	"  <div>\n", "\t<div>\n", "  <!-- x\n", " <a>\n", "<a>   \n", "<a>\t\n", "<a>\r\n", "<div>\r\n",
	"<中>\n", "<a中>\n", "<\xff>\n", "<div\xff>\n", "<a b=\"\U0001F600\">\n",
}

// orderedCorpus is the set of inputs for parseOrderedListMarker.
var orderedCorpus = []string{
	"", "1", "1.", "1)", "1. a", "1) a", "12. a", "123456789. a", "1234567890. a", "12345678. a", "0. a", "00. a", "01. a", "a. a", "1a. a", "1 . a", " 1. a", "1.a", "1.\n", "1)\n", "1]", "1中", "中", "1。", ".", ")", "..", "1..", "1.)", "-1.", "1,", "999999999)x", "9999999999)x", "\xff1.", "1\xff.",
}

func genPure() {
	out := doc{GoVersion: runtime.Version(), Functions: map[string][]vec{}}
	tree := &parse.Tree{}
	for _, s := range tagCorpus {
		b := []byte(s)
		out.Functions["isOpenTag"] = append(out.Functions["isOpenTag"], call([]any{hexOrNull(b)}, func() any { return linkIsOpenTag(tree, b) }))
		out.Functions["isCloseTag"] = append(out.Functions["isCloseTag"], call([]any{hexOrNull(b)}, func() any { return linkIsCloseTag(tree, b) }))
	}
	for _, s := range orderedCorpus {
		b := []byte(s)
		out.Functions["parseOrderedListMarker"] = append(out.Functions["parseOrderedListMarker"], call([]any{hexOrNull(b)}, func() any {
			marker, delim := linkParseOrderedListMarker(tree, b)
			return []any{hexOrNull(marker), int(delim)}
		}))
	}
	// parseHTML reads only the type of the tip node: a paragraph (type 7 blocks are not allowed) or any other node.
	for _, s := range append(append([]string{}, htmlCorpus...), tagCorpus...) {
		b := []byte(s)
		for _, tipType := range []ast.NodeType{ast.NodeDocument, ast.NodeParagraph} {
			t := &parse.Tree{Context: &parse.Context{Tip: &ast.Node{Type: tipType}}}
			out.Functions["parseHTML"] = append(out.Functions["parseHTML"], call([]any{hexOrNull(b), int(tipType)}, func() any { return linkParseHTML(t, b) }))
		}
	}
	data, err := json.Marshal(out)
	if nil != err {
		panic(err)
	}
	if err = os.WriteFile("../../src/parse/testdata/blocks_vectors.json", data, 0644); nil != err {
		panic(err)
	}
}

// ---- whole block trees ----

type treeVec struct {
	Input   string   `json:"input"`
	Options string   `json:"options"`
	Lines   []string `json:"lines"`
	Panic   bool     `json:"panic"`
}

func hexb(b []byte) string {
	if nil == b {
		return "NIL"
	}
	return hex.EncodeToString(b)
}

func hexs(s string) string {
	return hex.EncodeToString([]byte(s))
}

func b2i(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func dumpIAL(ial [][]string) string {
	if nil == ial {
		return "NIL"
	}
	var parts []string
	for _, kv := range ial {
		parts = append(parts, hexs(strings.Join(kv, "\x00")))
	}
	return "[" + strings.Join(parts, ",") + "]"
}

// dumpNode returns one line per node, depth first. Fields with their zero value are left out.
func dumpNode(n *ast.Node, depth int, lines *[]string) {
	var sb strings.Builder
	sb.WriteString(strconv.Itoa(depth))
	add := func(k, v, zero string) {
		if v != zero {
			sb.WriteString(" " + k + "=" + v)
		}
	}
	sb.WriteString(" t=" + strconv.Itoa(int(n.Type)))
	add("tok", hexb(n.Tokens), "NIL")
	add("close", b2i(n.Close), "0")
	add("id", hexs(n.ID), "")
	add("ial", dumpIAL(n.KramdownIAL), "NIL")
	add("h", strconv.Itoa(n.HeadingLevel)+"/"+b2i(n.HeadingSetext)+"/"+hexs(n.HeadingNormalizedID), "0/0/")
	if nil != n.ListData {
		ld := n.ListData
		sb.WriteString(fmt.Sprintf(" list=%d,%s,%d,%d,%d,%d,%d,%s,%s,%d", ld.Typ, b2i(ld.Tight), ld.BulletChar, ld.Start, ld.Delimiter, ld.Padding, ld.MarkerOffset, b2i(ld.Checked), hexn(ld.Marker), ld.Num))
	}
	add("task", fmt.Sprintf("%s,%d", b2i(n.TaskListItemChecked), n.TaskListItemMarker), "0,0")
	add("fence", fmt.Sprintf("%s,%d,%d,%d,%s,%s,%s", b2i(n.IsFencedCodeBlock), n.CodeBlockFenceChar, n.CodeBlockFenceLen, n.CodeBlockFenceOffset, hexn(n.CodeBlockOpenFence), hexn(n.CodeBlockInfo), hexb(n.CodeBlockCloseFence)), "0,0,0,0,,,NIL")
	add("html", strconv.Itoa(n.HtmlBlockType), "0")
	add("math", strconv.Itoa(n.MathBlockDollarOffset), "0")
	add("link", fmt.Sprintf("%d,%s", n.LinkType, hexn(n.LinkRefLabel)), "0,")
	add("fn", fmt.Sprintf("%s,%s", hexn(n.FootnotesRefLabel), hexs(n.FootnotesRefId)), ",")
	add("table", fmt.Sprintf("%v,%d,%d,%d", n.TableAligns, n.TableCellAlign, n.TableCellContentWidth, n.TableCellContentMaxWidth), "[],0,0,0")
	add("custom", fmt.Sprintf("%d,%s", n.CustomBlockFenceOffset, hexs(n.CustomBlockInfo)), "0,")
	add("callout", fmt.Sprintf("%s,%s,%s,%s,%d", hexs(n.CalloutType), hexs(n.CalloutTitle), b2i(n.CalloutTitleExplicit), hexs(n.CalloutIcon), n.CalloutIconType), ",,0,,0")
	add("tab", hexs(n.TabItemTitle), "")
	add("av", hexs(n.AttributeViewID)+","+hexs(n.AttributeViewType), ",")
	*lines = append(*lines, sb.String())
	for c := n.FirstChild; nil != c; c = c.Next {
		dumpNode(c, depth+1, lines)
	}
}

func optionVariants() (names []string, opts []*parse.Options) {
	add := func(name string, f func(o *parse.Options)) {
		o := parse.NewOptions()
		f(o)
		names = append(names, name)
		opts = append(opts, o)
	}
	add("default", func(o *parse.Options) {})
	all := func(o *parse.Options) {
		o.Callout = true
		o.Tabs = true
		o.SuperBlock = true
		o.CustomBlock = true
		o.GitConflict = true
		o.KramdownBlockIAL = true
		o.ToC = true
		o.BlockRef = true
		o.EnsureListItemParagraph = true
	}
	add("blocks", all)
	add("blocks-noindent", func(o *parse.Options) {
		all(o)
		o.IndentCodeBlock = false
		o.Setext = false
		o.GFMTable = false
		o.GFMTaskListItem = false
		o.Footnotes = false
		o.YamlFrontMatter = false
	})
	add("protyle", func(o *parse.Options) {
		all(o)
		o.ProtyleWYSIWYG = true
	})
	add("vditor-ir", func(o *parse.Options) {
		all(o)
		o.VditorIR = true
	})
	return
}

func dumpOne(md string, o *parse.Options) (lines []string, panicked bool) {
	defer func() {
		if r := recover(); nil != r {
			panicked = true
			lines = nil
		}
	}()
	t := parse.Parse("", []byte(md), o)
	dumpNode(t.Root, 0, &lines)
	return
}

func genTree() {
	names, opts := optionVariants()
	var out []treeVec
	for i, name := range names {
		for _, md := range treeCorpus {
			lines, panicked := dumpOne(md, opts[i])
			out = append(out, treeVec{Input: hex.EncodeToString([]byte(md)), Options: name, Lines: lines, Panic: panicked})
		}
	}
	data, err := json.Marshal(out)
	if nil != err {
		panic(err)
	}
	if err = os.WriteFile("../../src/parse/testdata/blocks_tree_vectors.json", data, 0644); nil != err {
		panic(err)
	}
}

// hexn is hexb for fields that are not nullable in the TypeScript port: a nil and an empty slice are the same.
func hexn(b []byte) string {
	if 0 == len(b) {
		return "NIL"
	}
	return hex.EncodeToString(b)
}
