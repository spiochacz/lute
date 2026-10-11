// Command gen-parse-tables-vectors writes ts/src/parse/testdata/tables_pure_vectors.json, the oracle for
// ts/src/parse/tables_pure.vectors.test.ts. It runs the real Go parse package (tables, emoji tables,
// kramdown IAL, block and file annotation references, rich table cell style protection) on a fixed corpus.
//
// Conventions: byte slices are lowercase hex, "" is an empty slice and null is a Go nil slice. Strings are
// JSON strings. A vector is {"in": [...], "out": ...}; "panic": true marks a Go panic.
package main

import (
	"encoding/hex"
	"encoding/json"
	htmlstd "html"
	"math/rand/v2"
	"os"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	lutehtml "github.com/88250/lute/html"
	"github.com/88250/lute/parse"
)

type rec struct {
	In    []any `json:"in"`
	Out   any   `json:"out"`
	Panic bool  `json:"panic,omitempty"`
}

func call(in []any, f func() any) (r rec) {
	r.In = in
	defer func() {
		if e := recover(); nil != e {
			r.Panic = true
			r.Out = nil
		}
	}()
	r.Out = f()
	return
}

func hx(b []byte) any {
	if nil == b {
		return nil
	}
	return hex.EncodeToString(b)
}

func hxs(bs [][]byte) []any {
	ret := make([]any, 0, len(bs))
	for _, b := range bs {
		ret = append(ret, hx(b))
	}
	return ret
}

func ctx(protyle bool) *parse.Context {
	opt := parse.NewOptions()
	opt.ProtyleWYSIWYG = protyle
	return &parse.Context{ParseOption: opt}
}

type nd struct {
	T      int    `json:"t"`
	Tok    any    `json:"tok"`
	Align  int    `json:"align"`
	IAL    any    `json:"ial"`
	Aligns []int  `json:"aligns"`
	Kids   []*nd  `json:"kids"`
}

func dump(n *ast.Node) *nd {
	if nil == n {
		return nil
	}
	ret := &nd{T: int(n.Type), Tok: hx(n.Tokens), Align: n.TableCellAlign, Aligns: n.TableAligns, Kids: []*nd{}}
	if nil != n.KramdownIAL {
		ret.IAL = n.KramdownIAL
	}
	for c := n.FirstChild; nil != c; c = c.Next {
		ret.Kids = append(ret.Kids, dump(c))
	}
	return ret
}

func sortedPairs(m map[string]string) [][]string {
	ret := make([][]string, 0, len(m))
	for k, v := range m {
		ret = append(ret, []string{k, v})
	}
	sort.Slice(ret, func(i, j int) bool { return ret[i][0] < ret[j][0] })
	return ret
}

func lim(x []rec, n int) []rec {
	if len(x) > n {
		return x[:n]
	}
	return x
}

func pick(r *rand.Rand, xs []string) string { return xs[r.IntN(len(xs))] }

func join(r *rand.Rand, xs []string, min, max int) string {
	n := min + r.IntN(max-min+1)
	var sb strings.Builder
	for i := 0; i < n; i++ {
		sb.WriteString(pick(r, xs))
	}
	return sb.String()
}

var ialFrags = []string{
	"{:", "{: ", " ", "  ", "\n", "}", "}\n", "{", "id=\"20210101010101-abc1234\"", " id=\"20210101010101-abc1234\"", " custom-x=\"y z\"", " style='color:red'",
	" name=\"\"", " a=\"b\\\"c\"", " a='b\"c'", " title=\"&quot;x&quot;\"", " k=\"_esc_newline_\"", " k=\"a\nb\"", " 中文=\"值\"", "=", "\"", "'", "&", "a", "b=",
	" k=v", " dup=\"1\"", " dup=\"2\"", " k=\"", " k = \"sp\"", " é=\"ü\"", " data-x=\"{}\"", " a=\"}\"", "‸", " x=\"‸\"", " empty= \"\"", "\t", "\r", " a=\"b\" c", "\\",
	" updated=\"20210101010101\"", " type=\"doc\"", " 'q'=\"1\"",
}

var kvKeys = []string{"id", "updated", "style", "class", "custom-a", "title", "name", "dup", "中文", "k", "", "a b", "data-type", "type"}
var kvVals = []string{"", "x", "a b", "a\"b", "a'b", "a\nb", "_esc_newline_", "{}", "}", "{:", "&amp;", "&quot;", "a&b", "中文值", "20210101010101-abc1234", "😀", "a=b", " ", "\\", "<>", "é"}

func main() {
	r := rand.New(rand.NewPCG(20260701, 42))
	out := map[string]any{}

	// Emoji tables
	{
		alias := make([][]string, 0, len(parse.EmojiAliasUnicode))
		byValue := map[string][]string{}
		for k, v := range parse.EmojiAliasUnicode {
			alias = append(alias, []string{k, v})
			byValue[v] = append(byValue[v], k)
		}
		sort.Slice(alias, func(i, j int) bool { return alias[i][0] < alias[j][0] })
		var single, multi [][]any
		var values []string
		for v := range byValue {
			values = append(values, v)
		}
		sort.Strings(values)
		for _, v := range values {
			as := byValue[v]
			sort.Strings(as)
			if 1 == len(as) {
				single = append(single, []any{v, as[0]})
			} else {
				multi = append(multi, []any{v, as})
			}
		}
		// the reverse table in Go has one entry per unicode value
		var isEmoji []rec
		var strs []string
		strs = append(strs, "", " ", "a", "abc", "👍", "👍x", "x👍", "中文", "🇨", "🇨🇳", "🧑", "🧑🏼", "🧑🏼‍", "‍", "️", "©", "®", "™", "#", "*", "0", "1", "9", "#️", "#️⃣", "⃣", "‍", "❤", "❤️", "✈", "☺", "e", ":", ":+1:")
		for i := 0; i < 330; i++ {
			e := alias[r.IntN(len(alias))][1]
			rs := []rune(e)
			switch r.IntN(5) {
			case 0:
				strs = append(strs, e)
			case 1:
				strs = append(strs, string(rs[:1+r.IntN(len(rs))]))
			case 2:
				strs = append(strs, string(rs[r.IntN(len(rs)):]))
			case 3:
				strs = append(strs, e+pick(r, []string{"a", " ", "x", "️", "😀"}))
			default:
				strs = append(strs, pick(r, []string{"a", "z", "中", "é", "ab", "emoji", "😀😀"})+e)
			}
		}
		for _, s := range strs {
			s := s
			isEmoji = append(isEmoji, call([]any{s}, func() any { return parse.IsEmoji(s) }))
		}
		var imgs []rec
		for _, a := range [][2]string{{"a", "b"}, {"", ""}, {"huaji", "http://x/huaji.gif"}, {"中文", "/e/中.png"}, {"a\"b", "c&d"}} {
			a := a
			imgs = append(imgs, call([]any{a[0], a[1]}, func() any { return hx((&parse.Tree{}).EmojiImgTokens(a[0], a[1])) }))
		}
		out["emoji"] = map[string]any{
			"aliasUnicode":    alias,
			"unicodeAliasLen": len(parse.EmojiUnicodeAlias),
			"single":          single,
			"multi":           multi,
			"isEmoji":         isEmoji,
			"imgTokens":       imgs,
			"sitePlaceholder": hx(parse.EmojiSitePlaceholder),
		}
	}

	// IAL
	var tokensCorpus [][]byte
	{
		hand := []string{
			"", " ", "{:}", "{: }", "{: id=\"a\"}", "{: id=\"a\" updated=\"b\"}\n", "{: id=\"20210101010101-abc1234\" title=\"a&quot;b\"}", " id=\"x\"", "id=\"x\"",
			"{: a=\"b\nc\"}", "{: a=\"b_esc_newline_c\"}", "{: a='b' c=\"d\"", "{: a=\"b\" a=\"c\"}", "{: 中文=\"值\"}", "{: a=\"\"}", "{: a=}", "{: a}", "{: a=\"b}", "{:a=\"b\"}",
			"{: a=\"b\"}}", "{: a=\"b\"}{: c=\"d\"}", "{: a=\"b\"}   \n\n", "{: a=\"b\"} x", "}", "{", "\n\n", "{: a = \"b\" }", "{: a=b}", "{: a=\"&amp;\"}", "{: a=\"{}\"}", "{: ‸a=\"b\"}",
			"{: id=\"20210101010101-abc1234\" updated=\"20210101010101\" type=\"doc\"}", "{: style=\"color: red;\" custom-k=\"v\"}",
		}
		for _, h := range hand {
			tokensCorpus = append(tokensCorpus, []byte(h))
		}
		for i := 0; i < 420; i++ {
			s := join(r, ialFrags, 1, 7)
			switch r.IntN(4) {
			case 0:
				s = "{: " + strings.TrimLeft(s, " ") + "}"
			case 1:
				s = "{:" + s + "}\n"
			case 2:
				s = "{: " + s
			}
			tokensCorpus = append(tokensCorpus, []byte(s))
		}
		// invalid UTF-8
		for _, h := range []string{"{: a=\"\xff\"}", "{: \xc3=\"b\"}", "{: a=\"b\xe4\xb8\"}", "\xff\xfe", "{: a=\"\xf0\x9f\"}", "{: k=\"\xc0\xaf\"}", "{: id=\"\x80\"}", "{: a=\"\xed\xa0\x80\"}"} {
			tokensCorpus = append(tokensCorpus, []byte(h))
		}
	}
	var t2i, i2t, i2m, i2mu, m2i, merge, ialVal, ialValMap, simple, blockIAL, spanIAL, listIAL []rec
	var ialCorpus [][][]string
	for _, tk := range tokensCorpus {
		tk := tk
		valid := utf8.Valid(tk)
		rc := call([]any{hx(tk)}, func() any { return parse.Tokens2IAL(tk) })
		if !valid {
			rc.In = append(rc.In, "invalid")
		}
		t2i = append(t2i, rc)
		if ial, ok := rc.Out.([][]string); ok && valid {
			ialCorpus = append(ialCorpus, ial)
		}
		blockIAL = append(blockIAL, call([]any{hx(tk)}, func() any { return linkParseKramdownBlockIAL(ctx(false), tk) }))
		spanIAL = append(spanIAL, call([]any{hx(tk)}, func() any {
			pos, ial := linkParseKramdownSpanIAL(ctx(false), tk)
			return []any{pos, ial}
		}))
		listIAL = append(listIAL, call([]any{hx(tk)}, func() any { return linkParseKramdownIALInListItem(ctx(false), tk) }))
		simple = append(simple, call([]any{hx(tk)}, func() any { return linkSimpleCheckIsBlockIAL(tk) }))
		name := pick(r, []string{"id", "a", "title", "dup", "k", "中文", "none"})
		ialVal = append(ialVal, call([]any{hx(tk), name}, func() any { return parse.IALVal(&ast.Node{Tokens: tk}, name) }))
		ialValMap = append(ialValMap, call([]any{hx(tk)}, func() any { return sortedPairs(parse.IALValMap(&ast.Node{Tokens: tk})) }))
	}
	randIAL := func() [][]string {
		n := r.IntN(5)
		ial := make([][]string, 0, n)
		for j := 0; j < n; j++ {
			ial = append(ial, []string{pick(r, kvKeys), pick(r, kvVals)})
		}
		return ial
	}
	ials := [][][]string{nil, {}, {{"id", "x"}}, {{"id", "x"}, {"id", "y"}}, {{"a", "b\nc"}}, {{"", ""}}}
	ials = append(ials, ialCorpus...)
	for i := 0; i < 330; i++ {
		ials = append(ials, randIAL())
	}
	for _, ial := range ials {
		ial := ial
		i2t = append(i2t, call([]any{ial}, func() any { return hx(parse.IAL2Tokens(ial)) }))
		i2m = append(i2m, call([]any{ial}, func() any { return sortedPairs(parse.IAL2Map(ial)) }))
		i2mu = append(i2mu, call([]any{ial}, func() any { return sortedPairs(parse.IAL2MapUnEsc(ial)) }))
		m := map[string]string{}
		for _, kv := range ial {
			m[kv[0]] = kv[1]
		}
		var pairs [][]string
		for k, v := range m {
			pairs = append(pairs, []string{k, v})
		}
		sort.Slice(pairs, func(i, j int) bool { return pairs[i][0] < pairs[j][0] })
		m2i = append(m2i, call([]any{pairs}, func() any {
			got := parse.Map2IAL(m)
			sort.Slice(got, func(i, j int) bool { return got[i][0] < got[j][0] })
			return got
		}))
		src := randIAL()
		if 0 == r.IntN(3) {
			src = ial
		}
		merge = append(merge, call([]any{ial, src}, func() any { return linkMergeIAL(ial, src) }))
	}
	// the cases of the Go test TestMergeIALPreservingOrder
	for _, c := range [][2][][]string{
		{{{"id", "old"}, {"class", "foo&amp;bar"}}, {{"id", "new"}, {"updated", "20260405"}, {"title", "a&amp;b"}}},
		{{{"data-node-id", "20250824233004-3qfd5gf"}, {"data-node-index", "1"}, {"data-type", "NodeBlockquote"}, {"class", "bq"}, {"updated", "20250824233509"}}, {{"custom-b", "info"}}},
		{{{"id", "old"}, {"id", "shadow"}, {"class", "foo"}}, {{"class", "bar"}, {"id", "new"}}},
	} {
		c := c
		merge = append(merge, call([]any{c[0], c[1]}, func() any { return linkMergeIAL(c[0], c[1]) }))
	}
	// size rules: every function keeps at least 300 vectors; the wrappers and the repeated corpora keep fewer
	mergeTail := merge[len(merge)-3:]
	merge = append(lim(merge[:len(merge)-3], 400), mergeTail...)
	out["ial"] = map[string]any{
		"Tokens2IAL": t2i, "IAL2Tokens": lim(i2t, 400), "IAL2Map": lim(i2m, 320), "IAL2MapUnEsc": lim(i2mu, 320), "Map2IAL": lim(m2i, 320), "mergeIALPreservingOrder": merge,
		"IALVal": lim(ialVal, 150), "IALValMap": lim(ialValMap, 150), "simpleCheckIsBlockIAL": lim(simple, 150),
		"parseKramdownBlockIAL": lim(blockIAL, 330), "parseKramdownSpanIAL": lim(spanIAL, 330), "parseKramdownIALInListItem": lim(listIAL, 330),
	}

	// Table helpers
	{
		var styleAlign, alignValue, cellIAL, inInline, delimAlign, delimRow, findDelim, row, table0, table, table2 []rec
		styleFrags := []string{"text-align:left", "text-align: center", "TEXT-ALIGN : Right", "text-align:right !important", "text-align:center!important", "text-align:LEFT ! important",
			"color:red", ";", ";;", " ", "text-align", "text-align:", "text-align:justify", "a:b:c", "text-align:left;text-align:right", "text-align: ", "background:url(a;b)", "text-align:start",
			"中文:值", "text-align:center ", "\ttext-align:\tcenter", "text-align:right!IMPORTANT", "text-align:left !important !important"}
		for i := 0; i < 400; i++ {
			s0 := ""
			if i < len(styleFrags) {
				s0 = styleFrags[i]
			} else {
				s0 = join(r, append([]string{";"}, styleFrags...), 1, 3)
			}
			s := s0
			styleAlign = append(styleAlign, call([]any{s}, func() any { a, f := parse.TableCellStyleAlign(s); return []any{a, f} }))
			al := pick(r, []string{"", "left", "center", "right", " LEFT ", "Center", "justify", "x"})
			alignValue = append(alignValue, call([]any{al, s}, func() any { return parse.TableCellAlignValue(al, s) }))
		}
		attrNames := []string{"colspan", "rowspan", "style", "table-cell-rich", "class", "id", "x"}
		classVals := []string{"fn__none", "a fn__none b", "a b", "", "fn__none2", " fn__none "}
		for i := 0; i < 330; i++ {
			n := r.IntN(4)
			ial := make([][]string, 0, n)
			for j := 0; j < n; j++ {
				nm := pick(r, attrNames)
				v := pick(r, classVals)
				ial = append(ial, []string{nm, v})
			}
			cellIAL = append(cellIAL, call([]any{ial}, func() any { return linkIsTableCellIAL(ial) }))
		}
		inFrags := []string{"a", "`", "$", "\\|", "|", " ", "x", "``", "$$", "中"}
		for i := 0; i < 400; i++ {
			s := []byte(join(r, inFrags, 0, 8))
			idx := r.IntN(len(s) + 2)
			m := byte(pick(r, []string{"`", "$"})[0])
			inInline = append(inInline, call([]any{hx(s), idx, int(m)}, func() any { return linkInInline(s, idx, m) }))
		}
		cols := []string{"", "-", "--", ":-", "-:", ":-:", ":", "::", ":--:", "-a-", " ", "---", ":---:", "- -", ":-x-:", "a", "-:-", ":::"}
		for _, c := range cols {
			c := []byte(c)
			delimAlign = append(delimAlign, call([]any{hx(c)}, func() any { return linkTableDelimAlign(ctx(false), c) }))
		}
		delimFrags := []string{"|", "-", ":", " ", "---", ":-:", "|---", "--:|", "|:--|", "\\|", "`|`", "$|$", "||", "a", "  ", "-|-", ":-|-:", "\\", "`", "&#124;"}
		var delimLines [][]byte
		for i := 0; i < 450; i++ {
			delimLines = append(delimLines, []byte(join(r, delimFrags, 0, 6)))
		}
		for _, l := range []string{"", "|", "||", "|-|", "| - |", "|---|---|", "|:-:|", "-|-", "---", ":-:", " | ", "|--|\\|", "a|b"} {
			delimLines = append(delimLines, []byte(l))
		}
		for _, l := range delimLines {
			l := l
			delimRow = append(delimRow, call([]any{hx(l)}, func() any { return linkParseTableDelimRow(ctx(false), l) }))
		}
		cellFrags := []string{"a", "b", " ", "  ", "|", "\\|", "`a|b`", "$a|b$", "`", "$", "中", "&#124;", "{: style=\"text-align:center\"}", "{: colspan=\"2\"}", " {: rowspan=\"2\"} ", "{: id=\"x\"}", "x {: style=\"color:red\"} y", "{: class=\"fn__none\"}", "{:", "}", "\\", "‸", "{: style='text-align:right'}", "{: table-cell-rich=\"abc\"}", "\\\\|"}
		alignSets := [][]int{{0}, {0, 0}, {1, 2, 3}, {0, 1}, {2}, {3, 3, 3, 3}}
		for i := 0; i < 450; i++ {
			l := []byte(join(r, cellFrags, 0, 9))
			al := alignSets[r.IntN(len(alignSets))]
			head := 0 == r.IntN(2)
			row = append(row, call([]any{hx(l), al, head}, func() any { return dump(linkParseTableRow(ctx(false), l, al, head)) }))
		}
		for _, lines := range [][][]byte{nil, {}, {[]byte("a")}, {[]byte("a"), []byte("|-|")}, {[]byte("|a|"), []byte("---"), []byte("x")}, {[]byte("a"), []byte("b"), []byte("|:-:|")}} {
			lines := lines
			findDelim = append(findDelim, call([]any{hxs(lines)}, func() any { return linkFindTableDelimRow(ctx(false), lines) }))
		}
		rowFrags := []string{"a", "b", "| a | b |", "|a|b|", "a|b", "| a |", "||", "| x {: style=\"text-align:center\"} |", "| h1 {: colspan=\"2\"} | h2 |", "|---|---|", "|:-:|--:|", "---|---", ":-:|:-:", "-", "---", "|-|", "| a \\| b | c |", "| `a|b` | c |", "| $a|b$ | c |",
			"|", " ", "foo", "bar baz", "中文|值", "| {: style=\"text-align:right\"} a |", "| a {: style=\"color:red\"} b |", "| {: id=\"x\"} |", "|-|-|-|", "|---|", "{: colspan=\"2\"}", "| a | b | c |", "| a | b | c | d |", "|:--|:-:|--:|"}
		mk := func() []byte {
			n := 1 + r.IntN(5)
			lines := make([]string, 0, n)
			for j := 0; j < n; j++ {
				lines = append(lines, pick(r, rowFrags))
			}
			if 0 == r.IntN(3) && n > 1 {
				lines[1] = pick(r, []string{"|---|---|", "---|---", "|:-:|", "---", "|-|", "|:--|:-:|--:|", ":-"})
			}
			if 0 == r.IntN(4) {
				lines = append(lines, "")
			}
			return []byte(strings.Join(lines, "\n"))
		}
		for i := 0; i < 450; i++ {
			tk := mk()
			table0 = append(table0, call([]any{hx(tk)}, func() any { return dump(linkParseTable0(ctx(false), tk)) }))
			prot := 0 == r.IntN(2)
			rs := call([]any{hx(tk), prot}, func() any {
				p, t := linkParseTable(ctx(prot), &ast.Node{Type: ast.NodeParagraph, Tokens: tk})
				return []any{dump(p), dump(t)}
			})
			table = append(table, rs)
		}
		for _, s := range []string{"", "a", "a\n", "|", "\n", "|a|\n|-|", "a\n|-|\nb"} {
			s := []byte(s)
			for _, prot := range []bool{false, true} {
				prot := prot
				table2 = append(table2, call([]any{hx(s), prot}, func() any {
					p, t := linkParseTable(ctx(prot), &ast.Node{Type: ast.NodeParagraph, Tokens: s})
					return []any{dump(p), dump(t)}
				}))
				// nil tokens
			}
		}
		table2 = append(table2, call([]any{nil, false}, func() any {
			p, t := linkParseTable(ctx(false), &ast.Node{Type: ast.NodeParagraph})
			return []any{dump(p), dump(t)}
		}))
		out["table"] = map[string]any{
			"TableCellStyleAlign": styleAlign, "TableCellAlignValue": alignValue, "isTableCellIAL": cellIAL, "inInline": inInline,
			"tableDelimAlign": delimAlign, "parseTableDelimRow": delimRow, "findTableDelimRow": findDelim, "parseTableRow": lim(row, 330),
			"parseTable0": lim(table0, 300), "parseTable": append(lim(table, 300), table2...),
		}
	}

	// References
	{
		var blockRefID, fileRefID []rec
		idPool := []string{"20210101010101-abc1234", "20210101010101-abc123", "2021010101010-abc1234", "20210101010101-abc12345", "20210101010101_abc1234", "abcdefghijklmnopqrstuv", "2021010101010a-abc1234", "20210101010101-ABC1234", "x"}
		tails := []string{"))", ")", ") ", " ", " \"t\"))", " ))", "‸))", "‸ ", "\n", "", "x))", " x", "))))", ")x", "‸", " 'text'))"}
		for i := 0; i < 400; i++ {
			s := []byte(pick(r, idPool) + pick(r, tails))
			if 0 == r.IntN(8) {
				s = []byte(pick(r, []string{"", "‸", " ", "(("}) + string(s))
			}
			if 0 == r.IntN(10) {
				s = s[:r.IntN(len(s)+1)]
			}
			blockRefID = append(blockRefID, call([]any{hx(s)}, func() any {
				a, b, c := linkParseBlockRefID(ctx(false), s)
				return []any{hx(a), hx(b), hx(c)}
			}))
		}
		fileFrags := []string{"assets/", "a/", "b.pdf", "x.PDF", "../", "./", "//", "/", "20210101010101-abc1234", "20210101010101-abc123", "?p=1", "#x", "<", ">", ">>", " \"t\"", " \"", "\"", "‸", "\\", "\n", " ", "中文.pdf", "a b.pdf", "..", ".", "c.pdf/", "d", ".pdf"}
		fileHand := []string{
			"assets/a.pdf/20210101010101-abc1234>>", "assets/a.pdf/20210101010101-abc1234>> x", "assets/a.pdf/20210101010101-abc1234 \"t\">>", "assets/a/b.pdf/20210101010101-abc1234>>",
			"assets/a.pdf?x=1/20210101010101-abc1234>>", "assets/a.pdf#p/20210101010101-abc1234>>", "assets/../a.pdf/20210101010101-abc1234>>", "assets//a.pdf/20210101010101-abc1234>>",
			"assets/.pdf/20210101010101-abc1234>>", "assets/ab.pdf/20210101010101-abc1234>>", "assets/abcd.pdf/20210101010101-abc1234>>", "assets/中文文件.pdf/20210101010101-abc1234>>", "<<<<<<<<", "",
			"assets/abcdef.pdf/20210101010101-abc1234>", "assets/abcdef.pdf/20210101010101-abc1234", "assets/abcdef.pdf/20210101010101-abc1234 ", "assets/abcdef.pdf/20210101010101-abc1234x>>",
			"assets/abcdef.PDF/20210101010101-abc1234>>", "assets/abcdef.pdf/20210101010101-abc1234‸>>", "assets/ab/./cdef.pdf/20210101010101-abc1234>>",
		}
		for _, h := range fileHand {
			s := []byte(h)
			fileRefID = append(fileRefID, call([]any{hx(s)}, func() any {
				a, b, c := linkParseFileAnnotationRefID(ctx(false), s)
				return []any{hx(a), hx(b), hx(c)}
			}))
		}
		for i := 0; i < 400; i++ {
			s := []byte("assets/" + join(r, fileFrags, 1, 8) + pick(r, []string{"/20210101010101-abc1234", "/20210101010101-abc123", ""}) + pick(r, []string{">>", ">", " \"t\">>", " ", "", "‸>>"}))
			fileRefID = append(fileRefID, call([]any{hx(s)}, func() any {
				a, b, c := linkParseFileAnnotationRefID(ctx(false), s)
				return []any{hx(a), hx(b), hx(c)}
			}))
		}
		// the Go test TestFileAnnotationRefRejectsNestedOpenersWithoutConsumingInput
		big := []byte(strings.Repeat("<", 65536))
		fileRefID = append(fileRefID, call([]any{"lt65536"}, func() any {
			a, b, c := linkParseFileAnnotationRefID(&parse.Context{}, big)
			return []any{len(a), len(b), len(c)}
		}))
		out["refs"] = map[string]any{"parseBlockRefID": blockRefID, "parseFileAnnotationRefID": fileRefID}
	}

	// Rich table cell style protection
	{
		var protect, sentinel, mergeTypes, stdUnescape []rec
		srcFrags := []string{"</span>{:", "</span>{: ", "</span>{:\tstyle=\"", "</span>{:style='", " style=\"", "style=\"", "color:red", "&amp;", "&lt;", "&#65;", "&", "`", "\"", "'", ";", " ", "\n", "中文", "é", "😀", "}", "table-cell-style-0", "table-cell-style-12", "table-cell-style-", "", "&quot;", "&notit;", "&unknown;", "a;b", "font-family:`x`;", "</span>", "<span style=\"color:red\">x</span>{: style=\"background:&amp;`\"}"}
		hand := []string{"", "x", "</span>{: style=\"a&b;\"}", "</span>{: style='&amp;'}", "</span>{: style=\"é&é;éééééééééééééééééééé;\"}", "</span>{: style=\"&aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;\"}",
			"</span>{: style=\"中中中中中中中中中中中&;\"}", "</span>{: style=\"中中中中中中中中中中&;\"}", "</span>{: style=\"中中中中中中中中中中 &;\"}", "</span>{: style=\"a`b`c\"}", "</span>{: style=\"unterminated", "</span>{: style=x}", "</span>{: style=",
			"table-cell-style-0</span>{: style=\"&\"}", "table-cell-style-0table-cell-style-1table-cell-style-x", "</span>{: id=\"1\" style=\"&\"}"}
		srcs := append([]string{}, hand...)
		for i := 0; i < 400; i++ {
			srcs = append(srcs, join(r, srcFrags, 1, 8))
		}
		for _, s := range srcs {
			s := s
			protect = append(protect, call([]any{s}, func() any { t, _ := linkProtect(s); return t }))
			sentinel = append(sentinel, call([]any{s}, func() any { return linkSentinel(s) }))
		}
		typeFrags := []string{"", "text", "strong", "em", "code", "a", "s", "u", "tag", "mark", "strong em", "em  strong", " a "}
		for i := 0; i < 330; i++ {
			n := r.IntN(4)
			groups := make([][]string, 0, n)
			for j := 0; j < n; j++ {
				g := strings.Split(pick(r, typeFrags), " ")
				if 0 == r.IntN(4) {
					g = nil
				}
				groups = append(groups, g)
			}
			mergeTypes = append(mergeTypes, call([]any{groups}, func() any { return linkMergeTextMarkTypes(groups...) }))
		}
		// stdlib html.UnescapeString on the shapes of the literals that protectTableCellRichStyles unescapes
		lits := []string{"&", "`", "&;", "&#;", "&#x;", "&#65;", "&#x41;", "&#X41;", "&#0;", "&#x110000;", "&#128512;", "&#xD800;", "&#128;", "&#159;", "&a b;", "&unknown;", "&amp;", "&AMP;", "&lt;", "&quot;", "&apos;", "&nbsp;", "&notit;", "&not;", "&NotEqualTilde;", "&fjlig;", "&Aacute;", "&aacute;", "&#1234567890123;", "&#-1;", "&中;", "&é;", "&&amp;", "&amp;amp;", "&#x1F600;", "&Gt;", "&gt;"}
		names := make([]string, 0, len(lutehtml.Entities))
		for k := range lutehtml.Entities {
			names = append(names, k)
		}
		sort.Strings(names)
		for k, n := range names {
			if strings.HasSuffix(n, ";") && 0 == k%3 {
				lits = append(lits, "&"+n)
			}
		}
		for _, l := range lits {
			l := l
			stdUnescape = append(stdUnescape, call([]any{l}, func() any { return htmlstd.UnescapeString(l) }))
		}
		out["rich_style"] = map[string]any{"protectTableCellRichStyles": protect, "tableCellRichStyleSentinel": lim(sentinel, 150), "mergeTextMarkTypes": mergeTypes, "stdlibUnescapeString": stdUnescape}
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); nil != err {
		panic(err)
	}
}
