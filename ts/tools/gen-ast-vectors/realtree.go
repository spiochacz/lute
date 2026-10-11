package main

import (
	"encoding/hex"
	"fmt"
	"os"
	"reflect"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

var (
	nodePtrType   = reflect.TypeOf((*ast.Node)(nil))
	listDataPtr   = reflect.TypeOf((*ast.ListData)(nil))
	tableRichPtr  = reflect.TypeOf((*ast.TableCellRich)(nil))
)

// indexer assigns node indexes in first-encounter order (BFS over the pointer
// fields, because the encoder visits the node list in index order).
type indexer struct {
	idx  map[*ast.Node]int
	list []*ast.Node
}

func newIndexer() *indexer {
	return &indexer{idx: map[*ast.Node]int{}}
}

func (ix *indexer) id(n *ast.Node) int {
	if i, ok := ix.idx[n]; ok {
		return i
	}
	i := len(ix.list)
	ix.idx[n] = i
	ix.list = append(ix.list, n)
	return i
}

// ref returns the index of n, or nil for a nil pointer.
func (ix *indexer) ref(n *ast.Node) any {
	if n == nil {
		return nil
	}
	return ix.id(n)
}

func (ix *indexer) refs(list []*ast.Node) []any {
	out := []any{}
	for _, n := range list {
		out = append(out, ix.ref(n))
	}
	return out
}

// encodeValue encodes one field value with the contract's rules: nil is null,
// bytes are lowercase hex, *Node is an index.
func encodeValue(v reflect.Value, ix *indexer) any {
	switch v.Kind() {
	case reflect.Ptr:
		if v.IsNil() {
			return nil
		}
		switch v.Type() {
		case nodePtrType:
			return ix.ref(v.Interface().(*ast.Node))
		case listDataPtr, tableRichPtr:
			return encodeStruct(v.Elem(), ix)
		}
		panic("unhandled pointer type " + v.Type().String())
	case reflect.Slice:
		if v.IsNil() {
			return nil
		}
		if v.Type().Elem().Kind() == reflect.Uint8 {
			return hex.EncodeToString(v.Bytes())
		}
		out := make([]any, 0, v.Len())
		for i := 0; i < v.Len(); i++ {
			out = append(out, encodeValue(v.Index(i), ix))
		}
		return out
	case reflect.Map:
		if v.IsNil() {
			return nil
		}
		out := map[string]any{}
		iter := v.MapRange()
		for iter.Next() {
			out[iter.Key().String()] = encodeValue(iter.Value(), ix)
		}
		return out
	case reflect.String:
		return v.String()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return v.Int()
	case reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uint:
		return v.Uint()
	case reflect.Bool:
		return v.Bool()
	}
	panic("unhandled kind " + v.Kind().String() + " of " + v.Type().String())
}

// encodeStruct encodes every field of struct value v in declaration order,
// keyed by the Go field name.
func encodeStruct(v reflect.Value, ix *indexer) map[string]any {
	t := v.Type()
	out := map[string]any{}
	for i := 0; i < t.NumField(); i++ {
		out[t.Field(i).Name] = encodeValue(v.Field(i), ix)
	}
	return out
}

// nodeMethods records the method results listed in the contract. Methods that
// return a *Node or []*Node go through ix so that the referenced nodes are
// indexed too.
func nodeMethods(n *ast.Node, ix *indexer) map[string]any {
	m := map[string]any{}
	m["Text"] = safe(func() any { return n.Text() })
	m["TextLen"] = safe(func() any { return n.TextLen() })
	m["TokensStr"] = safe(func() any { return n.TokensStr() })
	m["Content"] = safe(func() any { return n.Content() })
	m["EscapeMarkerContent"] = safe(func() any { return n.EscapeMarkerContent() })
	m["Stat"] = safe(func() any {
		a, b, c, d, e := n.Stat()
		return []int{a, b, c, d, e}
	})
	m["TokenLen"] = safe(func() any { return n.TokenLen() })
	m["DocChild"] = safe(func() any { return ix.ref(n.DocChild()) })
	m["NextNodeText"] = safe(func() any { return n.NextNodeText() })
	m["PreviousNodeText"] = safe(func() any { return n.PreviousNodeText() })
	m["List"] = safe(func() any { return ix.refs(n.List()) })
	m["BlockIDs"] = safe(func() any {
		out := []any{}
		for _, s := range n.BlockIDs() {
			out = append(out, s)
		}
		return out
	})
	m["IsBlock"] = safe(func() any { return n.IsBlock() })
	m["IsContainerBlock"] = safe(func() any { return n.IsContainerBlock() })
	m["IsMarker"] = safe(func() any { return n.IsMarker() })
	m["IsCloseMarker"] = safe(func() any { return n.IsCloseMarker() })
	m["AcceptLines"] = safe(func() any { return n.AcceptLines() })
	m["IsEmptyBlockIAL"] = safe(func() any { return n.IsEmptyBlockIAL() })
	m["LastDeepestChild"] = safe(func() any { return ix.ref(n.LastDeepestChild()) })
	m["FirstDeepestChild"] = safe(func() any { return ix.ref(n.FirstDeepestChild()) })
	m["EffectiveTaskListItemMarker"] = safe(func() any { return n.EffectiveTaskListItemMarker() })
	m["TabTitleBlock"] = safe(func() any { return ix.ref(n.TabTitleBlock()) })
	m["IsTabTitleBlock"] = safe(func() any { return n.IsTabTitleBlock() })
	m["IsNextSameInlineMemo"] = safe(func() any { return n.IsNextSameInlineMemo() })
	m["Marker(true)"] = safe(func() any { return n.Marker(true) })
	m["Marker(false)"] = safe(func() any { return n.Marker(false) })
	m["IALAttr(id)"] = safe(func() any { return n.IALAttr("id") })
	m["IALAttr(style)"] = safe(func() any { return n.IALAttr("style") })
	return m
}

type treeSnippet struct {
	Name     string
	Markdown string
	Options  string
}

// optionsFor returns parse options for one of the named variants.
func optionsFor(name string) *parse.Options {
	o := parse.NewOptions()
	switch name {
	case "default":
	case "kramdown":
		o.KramdownBlockIAL = true
		o.KramdownSpanIAL = true
	case "extras":
		o.KramdownBlockIAL = true
		o.KramdownSpanIAL = true
		o.Callout = true
		o.BlockRef = true
		o.ToC = true
		o.Tabs = true
		o.Sup = true
		o.Sub = true
		o.Mark = true
		o.Tag = true
		o.SuperBlock = true
	default:
		panic("unknown option variant " + name)
	}
	return o
}

var treeSnippets = []treeSnippet{
	{"emphasis", "*emphasis* and **strong** text", "default"},
	{"emphasis-underscore", "_a_ __b__ ***c***", "default"},
	{"code-span", "`code span` and ``a ` b``", "default"},
	{"link-title", "[link](https://example.com \"title\")", "default"},
	{"image", "![image](/a/b.png \"t\")", "default"},
	{"autolink", "<https://auto.example.com>", "default"},
	{"ref-link", "[ref link][r]\n\n[r]: /url \"Title\"", "default"},
	{"nested-list", "- a\n- b\n  - nested", "default"},
	{"ordered-list", "1. one\n2. two\n\n   para", "default"},
	{"task-items", "- [ ] todo\n- [x] done\n- [X] DONE\n- [/] wip", "default"},
	{"loose-list", "* loose\n\n* list", "default"},
	{"table-align", "| a | b |\n| :-- | --: |\n| 1 | 2 |", "default"},
	{"table-code-pipe", "| h |\n|---|\n| `x` &#124; y |", "default"},
	{"table-short-row", "| a |\n|---|\n|", "default"},
	{"blockquote", "> quote\n> more\n>\n> > nested", "default"},
	{"headings-setext", "# H1\n\n## H2 {#custom-id}\n\nText\nSetext\n===\n\nSetext2\n---", "default"},
	{"fenced-code", "```go\nfmt.Println()\n```", "default"},
	{"indented-code", "    indented code", "default"},
	{"tilde-fence", "~~~\nfenced tilde\n~~~", "default"},
	{"html-block", "<div>\nhtml block\n</div>\n\ninline <span>x</span>", "default"},
	{"inline-html", "para with <b>bold</b>", "default"},
	{"footnote", "Text with footnote[^1].\n\n[^1]: The note.", "default"},
	{"footnote-only-def", "[^a]: def only", "default"},
	{"block-math", "$$\nx^2\n$$", "default"},
	{"inline-math", "inline $e=mc^2$ math", "default"},
	{"yaml-front-matter", "---\ntitle: x\n---\n\n# after yaml", "default"},
	{"thematic-break", "***", "default"},
	{"entities", "a\\*b\\_c &amp; &copy; &#x41;", "default"},
	{"hard-break", "line one  \nhard break\nsoft", "default"},
	{"backslash-break", "a\\\nb", "default"},
	{"cjk-emphasis", "中文 *强调* 🙂 **粗**", "default"},
	{"strikethrough", "~~strike~~ and ~one~ text", "default"},
	{"mark-text", "==mark== and ==more==", "extras"},
	{"html-comment", "<!-- comment -->", "default"},
	{"empty-link-text", "[](empty)", "default"},
	{"image-with-emphasis", "![alt *x*](src \"t\")", "default"},
	{"autolink-www", "auto www.example.com link", "default"},
	{"plus-list", "+ plus bullet\n+ two", "default"},
	{"hr-list", "- - -\n- - -", "default"},
	{"ordered-paren", "1) x\n2) y", "default"},
	{"empty-document", "", "default"},
	{"blank-lines", "a\n\n\n\nb", "default"},
	{"quote-heading-list", "> # quoted heading\n> - list in quote", "default"},
	{"task-with-inline", "- [ ] task with *em* and `code`", "default"},
	{"raw-html-tags", "<img src=x>\n\n<?php x ?>", "default"},
	{"tab-in-text", "Line with\ttab", "default"},
	{"kramdown-block-ial", "{: id=\"blk\"}\n\nparagraph with IAL", "kramdown"},
	{"kramdown-heading-ial", "# Head {: id=\"hid\" style=\"color:red\"}", "kramdown"},
	{"kramdown-span-ial", "text *span*{: style=\"a\"} end", "kramdown"},
	{"kramdown-list-ial", "- item\n{: class=\"x\"}", "kramdown"},
	{"kramdown-image-ial", "![img](a.png){: width=\"50\"}", "kramdown"},
	{"kramdown-quote-ial", "> quoted\n{: id=\"q1\"}", "kramdown"},
	{"kramdown-table-ial", "| a |\n|---|\n| b |\n{: id=\"t1\"}", "kramdown"},
	{"callout-note", "> [!NOTE] Title\n> body text", "extras"},
	{"callout-warning", "> [!WARNING]\n> careful", "extras"},
	{"block-ref", "((20210101000000-abcdefg 'anchor'))", "extras"},
	{"toc", "[toc]\n\n# A\n\n## B", "extras"},
	{"superscript-subscript", "x^2^ and H~2~O", "extras"},
	{"super-block", "{{{row\ncontent\n}}}", "extras"},
	{"tag-text", "#hashtag #tag2 text", "extras"},
	{"tabs-block", "{{{tabs\n[tab1]\nfirst\n[tab2]\nsecond\n}}}", "extras"},
	{"footnote-with-list", "A[^n].\n\n[^n]: note\n    - item", "default"},
	{"emoji-alias", "emoji :smile: text", "default"},
	{"nested-quote-list", "- item\n  > quoted in item", "default"},
	{"code-in-list", "1. step\n\n   ```\n   code\n   ```", "default"},
	{"link-ref-case", "[Foo][FOO]\n\n[foo]: /x", "default"},
	{"heading-levels", "#### four\n##### five\n###### six", "default"},
	{"escaped-marker", "\\# not a heading", "default"},
	{"multi-paragraph-quote", "> para one\n>\n> para two", "default"},
	{"mixed-kramdown-lists", "* a\n{: id=\"l1\"}\n\n1. b", "kramdown"},
	{"link-dest-spaces", "[a](<dest with spaces> 'title')", "default"},
	{"setext-after-list", "- x\n\nHeading\n===", "default"},
}

// writeRealtrees parses each snippet with ast.Testing = true and records every
// node's fields and method results.
func writeRealtrees() {
	trees := []any{}
	for _, s := range treeSnippets {
		ast.Testing = true
		tree := parse.Parse(s.Name, []byte(s.Markdown), optionsFor(s.Options))
		ix := newIndexer()
		ix.id(tree.Root)
		nodes := []any{}
		for i := 0; i < len(ix.list); i++ {
			n := ix.list[i]
			fields := encodeStruct(reflect.ValueOf(n).Elem(), ix)
			methods := nodeMethods(n, ix)
			nodes = append(nodes, map[string]any{"fields": fields, "methods": methods})
		}
		trees = append(trees, map[string]any{
			"name":     s.Name,
			"markdown": s.Markdown,
			"options":  s.Options,
			"nodes":    nodes,
		})
	}
	ast.Testing = false
	fmt.Fprintf(os.Stderr, "realtree: %d trees\n", len(trees))
	writeJSON("realtree_vectors.json", map[string]any{"trees": trees})
}
