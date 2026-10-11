// Command gen-parse-tree-vectors runs the real Go parse package over a corpus of Markdown inputs under several option sets and writes
// a canonical dump of every parsed tree, including whether the nullable byte slices of a node (Tokens, CodeBlockCloseFence) and the
// KramdownIAL are nil. ts/src/parse/tree.vectors.test.ts compares the TypeScript port with it.
//
// Usage (from this directory): go run -tags javascript .
// writes ../../src/parse/testdata/tree_vectors.json
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

// optionSet is a named list of assignments to parse.Options fields (bool or string values).
type optionSet struct {
	Name string         `json:"name"`
	Opts map[string]any `json:"opts"`
}

var optionSets = []optionSet{
	{"default", map[string]any{}},
	{"all", map[string]any{
		"GFMStrikethrough1": true, "FullWidthStrikethrough": true, "ArbitraryTaskListItemMarker": true, "ToC": true, "Mark": true, "Sup": true, "Sub": true,
		"Tag": true, "InlineMath": true, "InlineMathAllowDigitAfterOpenMarker": true, "BlockRef": true, "FileAnnotationRef": true, "SuperBlock": true,
		"CustomBlock": true, "GitConflict": true, "Callout": true, "Tabs": true, "KramdownBlockIAL": true, "KramdownSpanIAL": true, "ImgPathAllowSpace": true,
		"EnsureListItemParagraph": true, "ParagraphBeginningSpace": true, "TextMark": true, "HTMLTag2TextMark": true,
	}},
	{"protyle", map[string]any{
		"ProtyleWYSIWYG": true, "KramdownBlockIAL": true, "KramdownSpanIAL": true, "BlockRef": true, "FileAnnotationRef": true, "Tag": true, "SuperBlock": true,
		"ImgPathAllowSpace": true, "GitConflict": true, "Mark": true, "Sup": true, "Sub": true, "InlineMathAllowDigitAfterOpenMarker": true, "InlineMath": true,
		"Footnotes": false, "ToC": false, "IndentCodeBlock": false, "ParagraphBeginningSpace": true, "HeadingID": false, "Setext": false,
		"YamlFrontMatter": false, "LinkRef": false, "TextMark": true, "Callout": true, "Tabs": true, "CustomBlock": true,
	}},
	{"vditor-ir", map[string]any{"VditorIR": true, "InlineMath": true, "Mark": true, "Sup": true, "Sub": true, "Tag": true, "ToC": true, "KramdownBlockIAL": true}},
	{"vditor-wysiwyg", map[string]any{"VditorWYSIWYG": true, "InlineMath": true, "Mark": true, "Sup": true, "Sub": true, "Tag": true, "ToC": true}},
	{"vditor-sv", map[string]any{"VditorSV": true, "InlineMath": true, "Mark": true, "ToC": true, "KramdownBlockIAL": true, "KramdownSpanIAL": true}},
}

func makeOptions(set optionSet) *parse.Options {
	o := parse.NewOptions()
	v := reflect.ValueOf(o).Elem()
	for k, val := range set.Opts {
		f := v.FieldByName(k)
		if !f.IsValid() {
			panic("no option " + k)
		}
		switch x := val.(type) {
		case bool:
			f.SetBool(x)
		case string:
			f.SetString(x)
		default:
			panic("bad option value")
		}
	}
	return o
}

// ---- canonical dump ----
// One line per node, depth first: the depth, then key=value pairs. Fields with their zero value are left out. Byte slices are lowercase hex in single quotes,
// N is a nil slice. Tokens, CodeBlockCloseFence and KramdownIAL always keep nil and empty apart. The other byte slices (not nullable in the TypeScript port) do not:
// nil and empty are both left out.

func hexq(b []byte) string {
	return "'" + hex.EncodeToString(b) + "'"
}

func hexs(s string) string {
	return "'" + hex.EncodeToString([]byte(s)) + "'"
}

func nilq(b []byte) string {
	if nil == b {
		return "N"
	}
	return hexq(b)
}

func b2i(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func dumpIAL(ial [][]string) string {
	if nil == ial {
		return "N"
	}
	var parts []string
	for _, kv := range ial {
		parts = append(parts, hexs(strings.Join(kv, "\x00")))
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func dumpNode(n *ast.Node, depth int, lines *[]string) {
	var sb strings.Builder
	sb.WriteString(strconv.Itoa(depth))
	add := func(k, v, zero string) {
		if v != zero {
			sb.WriteString(" " + k + "=" + v)
		}
	}
	sb.WriteString(" t=" + strconv.Itoa(int(n.Type)))
	sb.WriteString(" tok=" + nilq(n.Tokens))
	add("close", b2i(n.Close), "0")
	add("id", hexs(n.ID), "''")
	add("ial", dumpIAL(n.KramdownIAL), "N")
	add("h", strconv.Itoa(n.HeadingLevel)+"/"+b2i(n.HeadingSetext)+"/"+hexs(n.HeadingNormalizedID), "0/0/''")
	if nil != n.ListData {
		ld := n.ListData
		sb.WriteString(fmt.Sprintf(" list=%d,%s,%d,%d,%d,%d,%d,%s,%s,%d", ld.Typ, b2i(ld.Tight), ld.BulletChar, ld.Start, ld.Delimiter, ld.Padding, ld.MarkerOffset, b2i(ld.Checked), hexq(ld.Marker), ld.Num))
	}
	add("task", fmt.Sprintf("%s,%d", b2i(n.TaskListItemChecked), n.TaskListItemMarker), "0,0")
	add("fence", fmt.Sprintf("%s,%d,%d,%d,%s,%s,%s", b2i(n.IsFencedCodeBlock), n.CodeBlockFenceChar, n.CodeBlockFenceLen, n.CodeBlockFenceOffset, hexq(n.CodeBlockOpenFence), hexq(n.CodeBlockInfo), nilq(n.CodeBlockCloseFence)), "0,0,0,0,'','',N")
	add("code", strconv.Itoa(n.CodeMarkerLen), "0")
	add("html", strconv.Itoa(n.HtmlBlockType), "0")
	add("math", strconv.Itoa(n.MathBlockDollarOffset), "0")
	add("link", fmt.Sprintf("%d,%s", n.LinkType, hexq(n.LinkRefLabel)), "0,''")
	add("fn", fmt.Sprintf("%s,%s,%d", hexq(n.FootnotesRefLabel), hexs(n.FootnotesRefId), len(n.FootnotesRefs)), "'','',0")
	add("ent", hexq(n.HtmlEntityTokens), "''")
	add("table", fmt.Sprintf("%v,%d,%d,%d", n.TableAligns, n.TableCellAlign, n.TableCellContentWidth, n.TableCellContentMaxWidth), "[],0,0,0")
	if nil != n.TableCellRich {
		r := n.TableCellRich
		sb.WriteString(fmt.Sprintf(" rich=%d,%s,%s,%s,%s", r.Spec, hexs(r.Format), hexs(r.Content), hexs(r.Raw), b2i(r.Invalid)))
	}
	add("custom", fmt.Sprintf("%d,%s", n.CustomBlockFenceOffset, hexs(n.CustomBlockInfo)), "0,''")
	add("callout", fmt.Sprintf("%s,%s,%s,%s,%d", hexs(n.CalloutType), hexs(n.CalloutTitle), b2i(n.CalloutTitleExplicit), hexs(n.CalloutIcon), n.CalloutIconType), "'','',0,'',0")
	add("tab", hexs(n.TabItemTitle), "''")
	add("av", hexs(n.AttributeViewID)+","+hexs(n.AttributeViewType), "'',''")
	add("tm", strings.Join([]string{hexs(n.TextMarkType), hexs(n.TextMarkAHref), hexs(n.TextMarkATitle), hexs(n.TextMarkInlineMathContent), hexs(n.TextMarkInlineMemoContent), hexs(n.TextMarkBlockRefID), hexs(n.TextMarkBlockRefSubtype), hexs(n.TextMarkFileAnnotationRefID), hexs(n.TextMarkFlashcardOcclusionID), hexs(n.TextMarkTextContent)}, ","), strings.Repeat("'',", 9)+"''")
	if 0 < len(n.Properties) {
		var keys []string
		for k := range n.Properties {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var parts []string
		for _, k := range keys {
			parts = append(parts, hexs(k)+":"+hexs(n.Properties[k]))
		}
		sb.WriteString(" props=" + strings.Join(parts, ","))
	}
	*lines = append(*lines, sb.String())
	for c := n.FirstChild; nil != c; c = c.Next {
		dumpNode(c, depth+1, lines)
	}
}

// ---- output ----

// A tree entry is [input index, option set index, kind, data]. Kind "P": the parser panicked; "D": data is the dump; "H": data is "<sha256 hex>:<length of the dump>".
type output struct {
	GoVersion string         `json:"goVersion"`
	OptionSets []optionSet   `json:"optionSets"`
	Inputs    []string       `json:"inputs"`  // hex
	Invalid   []bool         `json:"invalid"` // whether the input is not valid UTF-8
	Trees     [][]any        `json:"trees"`
}

const maxInlineDump = 360

func dumpOne(md string, o *parse.Options) (dump string, panicked bool) {
	defer func() {
		if r := recover(); nil != r {
			panicked = true
		}
	}()
	t := parse.Parse("", []byte(md), o)
	var lines []string
	dumpNode(t.Root, 0, &lines)
	dump = strings.Join(lines, "\n")
	return
}

func main() {
	ast.Testing = true
	var corpus []string
	seen := map[string]bool{}
	for _, md := range append(append(append([]string{}, blockCorpus...), inlineCorpus...), extraCorpus...) {
		if seen[md] {
			continue
		}
		seen[md] = true
		corpus = append(corpus, md)
	}
	out := output{GoVersion: runtime.Version(), OptionSets: optionSets}
	for _, md := range corpus {
		out.Inputs = append(out.Inputs, hex.EncodeToString([]byte(md)))
		out.Invalid = append(out.Invalid, !utf8.ValidString(md))
	}
	fullDumps := map[string]string{} // for debugging: set LUTE_TREE_FULL to a file name to get every full dump
	for oi, set := range optionSets {
		for i, md := range corpus {
			dump, panicked := dumpOne(md, makeOptions(set)) // fresh options for every parse
			fullDumps[strconv.Itoa(i)+"/"+strconv.Itoa(oi)] = dump
			switch {
			case panicked:
				out.Trees = append(out.Trees, []any{i, oi, "P", ""})
			case len(dump) <= maxInlineDump || out.Invalid[i]: // an invalid UTF-8 input keeps its full dump: the test applies the lossy rule to it
				out.Trees = append(out.Trees, []any{i, oi, "D", dump})
			default:
				sum := sha256.Sum256([]byte(dump))
				out.Trees = append(out.Trees, []any{i, oi, "H", hex.EncodeToString(sum[:]) + ":" + strconv.Itoa(len(dump))})
			}
		}
	}
	if name := os.Getenv("LUTE_TREE_FULL"); "" != name {
		full, _ := json.Marshal(fullDumps)
		if err := os.WriteFile(name, full, 0644); nil != err {
			panic(err)
		}
	}
	data, err := json.Marshal(out)
	if nil != err {
		panic(err)
	}
	if err = os.WriteFile("../../src/parse/testdata/tree_vectors.json", data, 0644); nil != err {
		panic(err)
	}
	fmt.Println("inputs", len(corpus), "trees", len(out.Trees), "bytes", len(data))
}
