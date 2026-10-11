// Command gen-parse-inline-vectors runs the real Go parse package on a fixed corpus
// and writes the results as JSON. The TypeScript port in ts/src/parse/ is asserted
// against this file by inline_pure.vectors.test.ts.
//
// Only the pure functions of the inline parsing core are covered: the link label,
// title and destination scanners (link.go, inline_link.go), matchCodeSpanEnd,
// matchInlineMathEnd, linkRefFoldKey, foldBytes and isDelimiterTextMark. They are
// unexported (or methods of types whose state is not needed) and are reached through
// the go:linkname pulls in linkname.go.
//
// Usage (from this directory):
//
//	go run -tags javascript . > ../../src/parse/testdata/inline_vectors.json
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"runtime"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

// optSet is a set of option flags that differ from parse.NewOptions().
type optSet struct {
	ProtyleWYSIWYG    bool `json:"ProtyleWYSIWYG,omitempty"`
	VditorIR          bool `json:"VditorIR,omitempty"`
	ImgPathAllowSpace bool `json:"ImgPathAllowSpace,omitempty"`
	DataImage         bool `json:"DataImage,omitempty"`
	InlineMathDigit   bool `json:"InlineMathAllowDigitAfterOpenMarker,omitempty"`
}

var optSets = []optSet{
	{},
	{ProtyleWYSIWYG: true},
	{VditorIR: true},
	{ImgPathAllowSpace: true},
	{DataImage: true},
	{ImgPathAllowSpace: true, DataImage: true},
	{InlineMathDigit: true},
}

func (o optSet) options() *parse.Options {
	opts := parse.NewOptions()
	opts.ProtyleWYSIWYG = o.ProtyleWYSIWYG
	opts.VditorIR = o.VditorIR
	opts.ImgPathAllowSpace = o.ImgPathAllowSpace
	opts.DataImage = o.DataImage
	opts.InlineMathAllowDigitAfterOpenMarker = o.InlineMathDigit
	return opts
}

// vec is one call. Opt is the index into optSets. Args are the arguments (byte
// slices as lowercase hex, strings as JSON strings). Ret is the result (a Go nil byte
// slice is null). Panic is set when Go panicked.
//
// A vec is written as a JSON array to keep the file small:
//
//	[opt, args, ret]          normal call
//	[opt, args, null, true]   Go panicked
type vec struct {
	Opt   int
	Args  []any
	Ret   any
	Panic bool
}

func (v vec) MarshalJSON() ([]byte, error) {
	if v.Panic {
		return json.Marshal([]any{v.Opt, v.Args, nil, true})
	}
	return json.Marshal([]any{v.Opt, v.Args, v.Ret})
}

type doc struct {
	GoVersion string           `json:"goVersion"`
	OptSets   []optSet         `json:"optSets"`
	Functions map[string][]vec `json:"functions"`
}

func hexOf(b []byte) any {
	if b == nil {
		return nil
	}
	return hex.EncodeToString(b)
}

// call runs f, recording a panic.
func call(opt int, args []any, f func() any) (v vec) {
	v = vec{Opt: opt, Args: args}
	defer func() {
		if r := recover(); r != nil {
			v.Panic = true
			v.Ret = nil
		}
	}()
	v.Ret = f()
	return
}

// pieces are the fragments the corpus strings are built from. They contain the
// characters the scanners treat specially, multi-byte text and invalid UTF-8.
var pieces = []string{"(", ")", "<", ">", "[", "]", "\"", "'", " ", "\n", "\\", "a", "中", "\xff", "&amp;", "‸", "\t", ":", "!", "\x00"}

// piecesShort is a smaller alphabet for the exhaustive length-3 enumeration.
var piecesShort = []string{"(", ")", "<", ">", "[", "]", "\"", " ", "\\", "a"}

// handpicked strings for the link scanners.
var handpicked = []string{
	"", "a", " ", "\n", "[", "]", "[]", "[ ]", "[a]", "[foo]", "[Foo]: /url", "[foo]:", "[ foo   bar ]",
	"[foo\nbar]", "[foo\n\nbar]", "[a[b]", "[a\\]b]", "[a\\[b]", "[中文]", "[\xff]", "[\xff]x", "[a]b", "[a]:b",
	"[" + strings.Repeat("a", 998) + "]", "[" + strings.Repeat("a", 999) + "]", "[" + strings.Repeat("a", 1000) + "]",
	"[‸a]", "[a‸]", "[a  b]", "[a \n b]", "[ \n ]",
	"\"title\"", "'title'", "(title)", "\"title", "'title", "(title", "\"\"", "''", "()", "\"a\\\"b\"", "\"a&amp;b\"",
	"\"a\\*b\"", "\"中文\"", "\"\xff\"", "\"a\" x", "\"a\"\n", "\"a\"  ", "\"title\" )", "\"‸\"", "\"\"‸)", "\"\")‸",
	"<foo>", "<foo bar>", "<>", "<", "<a", "<<a>", "<a<b>", "<a\\>b>", "<a>b", "<a> b", "<a>)", "<中文>", "<\xff>", "<a\nb>",
	"/url", "/url \"title\"", "/url 'title'", "/url (title)", "/u(r)l", "/u(rl", "/url)", "foo\\)", "foo\\(", "%20", "中文", "a b",
	"a\tb", "a\x01b", "\xff", "\xff a", "a\xffb c", "data:image/png;base64,xx", "DATA:IMAGE/png", "javascript:alert(1)",
	"(foo)", "(<foo> \"t\")", "(foo \"t\")", "(foo bar)", "( foo)", "(data:image/png;base64,xx)", "()", "(<>)", "(a(b)c)",
	"(a(b)", "(中文)", "(\xff)", "(foo\n\"t\")", "(foo\n)", "(<foo>)", "(<foo>x)", "(<foo> x)", "(<foo>\n)", "(<foo\n>)",
	"(  )", "( )x", "(\"t\")", "(<>x)", "(a b \"t\")", "(a \"t b\")", "(a  )", "(a\n)", "(a\tb)", "(a'b)", "(<a b>)",
	"(‸)", "(a‸)", "(<a‸>)", "(a \"\"‸)", "(a \"b\")", "(a)", "(a) b", "(a b)", "(a \"b\" c)", "(\\))", "(a\\)b)", "(a(b))",
	"(a(b)) \"t\"", "(a) \"t\"", "(<a> \"t\")", "(<a>\"t\")", "(a\"t\")", "((a))", "(a b c)", "(<a>b)", "(<a>>)", "(<a>))",
	"(\xff \"t\")", "(a \xff)", "(中 \"文\")",
}

func genExhaustive(alpha []string, maxLen int) []string {
	out := []string{""}
	cur := []string{""}
	for l := 1; l <= maxLen; l++ {
		var next []string
		for _, c := range cur {
			for _, p := range alpha {
				next = append(next, c+p)
			}
		}
		out = append(out, next...)
		cur = next
	}
	return out
}

func genRandom(r *rand.Rand, alpha []string, n, minLen, maxLen int) []string {
	out := make([]string, 0, n)
	for i := 0; i < n; i++ {
		l := minLen + r.Intn(maxLen-minLen+1)
		var sb strings.Builder
		for j := 0; j < l; j++ {
			sb.WriteString(alpha[r.Intn(len(alpha))])
		}
		out = append(out, sb.String())
	}
	return out
}

func main() {
	r := rand.New(rand.NewSource(20260101))

	// The inputs for the scanners: handpicked, every string of up to 3 short pieces, and random longer strings.
	exhaustive := genExhaustive(piecesShort[:8], 3)
	random := genRandom(r, pieces, 300, 4, 10)
	// The sample used for the non-default option sets.
	var sample []string
	sample = append(sample, handpicked...)
	sample = append(sample, genRandom(r, pieces, 40, 3, 8)...)

	d := doc{GoVersion: runtime.Version(), OptSets: optSets, Functions: map[string][]vec{}}
	add := func(name string, v vec) { d.Functions[name] = append(d.Functions[name], v) }

	type scanner struct {
		name string
		run  func(c *parse.Context, tokens []byte) any
	}
	scanners := []scanner{
		{"parseLinkLabel", func(c *parse.Context, tokens []byte) any {
			n, remains, label := linkParseLinkLabel(c, tokens)
			return []any{n, hexOf(remains), hexOf(label)}
		}},
		{"parseLinkTitle", func(c *parse.Context, tokens []byte) any {
			ok, passed, remains, title := linkParseLinkTitle(c, tokens)
			return []any{ok, hexOf(passed), hexOf(remains), hexOf(title)}
		}},
		{"parseBlockRefText", func(c *parse.Context, tokens []byte) any {
			ok, passed, remains, title, subtype := linkParseBlockRefText(c, tokens)
			return []any{ok, hexOf(passed), hexOf(remains), hexOf(title), subtype}
		}},
		{"parseLinkDest", func(c *parse.Context, tokens []byte) any {
			ret, remains, dest := linkParseLinkDest(c, tokens)
			return []any{hexOf(ret), hexOf(remains), hexOf(dest)}
		}},
		{"parseLinkDest1", func(c *parse.Context, tokens []byte) any {
			ret, remains, dest := linkParseLinkDest1(c, tokens)
			return []any{hexOf(ret), hexOf(remains), hexOf(dest)}
		}},
		{"parseLinkDest2", func(c *parse.Context, tokens []byte) any {
			ret, remains, dest := linkParseLinkDest2(c, tokens)
			return []any{hexOf(ret), hexOf(remains), hexOf(dest)}
		}},
		{"parseInlineLinkDest", func(c *parse.Context, tokens []byte) any {
			passed, remains, dest := linkParseInlineLinkDest(c, tokens)
			return []any{hexOf(passed), hexOf(remains), hexOf(dest)}
		}},
	}
	for _, s := range scanners {
		for optIdx, o := range optSets {
			// The image path options only matter to parseInlineLinkDest; the editor modes matter to all scanners.
			if (optIdx >= 3 && "parseInlineLinkDest" != s.name) || 6 == optIdx {
				continue
			}
			c := &parse.Context{ParseOption: o.options()}
			var inputs []string
			if 0 == optIdx {
				inputs = append(inputs, handpicked...)
				inputs = append(inputs, exhaustive...)
				inputs = append(inputs, random...)
			} else {
				inputs = sample
			}
			for _, in := range inputs {
				tokens := []byte(in)
				tokensCopy := append([]byte(nil), tokens...)
				_ = tokensCopy
				add(s.name, call(optIdx, []any{hexOf(tokens)}, func() any { return s.run(c, []byte(in)) }))
			}
		}
	}

	// parseLinkTitleMatch with every quote pair.
	pairs := [][2]byte{{'"', '"'}, {'\'', '\''}, {'(', ')'}}
	for _, p := range pairs {
		c := &parse.Context{ParseOption: optSets[0].options()}
		var inputs []string
		inputs = append(inputs, handpicked...)
		inputs = append(inputs, genExhaustive(piecesShort[:8], 3)...)
		inputs = append(inputs, random[:100]...)
		for _, in := range inputs {
			add("parseLinkTitleMatch", call(0, []any{int(p[0]), int(p[1]), hexOf([]byte(in))}, func() any {
				ok, passed, remains, title := linkParseLinkTitleMatch(c, p[0], p[1], []byte(in))
				return []any{ok, hexOf(passed), hexOf(remains), hexOf(title)}
			}))
		}
	}

	// matchCodeSpanEnd
	{
		backticks := []string{"`", "``", "```", "a", " ", "\n", "中", "\xff", "\\"}
		var inputs []string
		inputs = append(inputs, genExhaustive(backticks[:5], 4)...)
		inputs = append(inputs, genRandom(r, backticks, 100, 5, 14)...)
		for _, in := range inputs {
			for num := 1; num <= 3; num++ {
				add("matchCodeSpanEnd", call(0, []any{hexOf([]byte(in)), num}, func() any {
					return linkMatchCodeSpanEnd(nil, []byte(in), num)
				}))
			}
		}
	}

	// matchInlineMathEnd
	{
		alpha := []string{"$", "\\", "1", "a", " ", "\n", "中", "\xff"}
		var inputs []string
		inputs = append(inputs, genExhaustive(alpha[:5], 4)...)
		inputs = append(inputs, genRandom(r, alpha, 100, 5, 12)...)
		for _, optIdx := range []int{0, 6} {
			t := &parse.Tree{Context: &parse.Context{ParseOption: optSets[optIdx].options()}}
			for _, in := range inputs {
				if 0 != optIdx && len(in) > 3 {
					continue
				}
				add("matchInlineMathEnd", call(optIdx, []any{hexOf([]byte(in))}, func() any {
					return linkMatchInlineMathEnd(t, []byte(in))
				}))
			}
		}
	}

	// linkRefFoldKey and foldBytes
	{
		inputs := []string{"", "a", "A", "foo", "FOO", "Foo Bar", "ẞ", "ß", "SS", "ss", "ſ", "s", "S", "σ", "ς", "Σ", "ΑΣ", "ας", "K", "k", "K", "İ", "ı", "I", "i",
			"ǅ", "ǆ", "Ǆ", "ǈ", "ᾈ", "ῼ", "ω", "Ω", "Ω", "Å", "Å", "å", "中文", "ＡＢＣ", "ａｂｃ", "😀", "\xff", "a\xffb", "\xc3", "\xe4\xb8", "\xf0\x9f\x98",
			"[foo]", "\n", "\t", "Straße", "STRASSE", "ǰ", "ΐ", "ﬃ", "ffi", "Ꭰ", "ꭰ", "Ა", "ა"}
		// all code points of selected ranges, one rune each, to cover the simple fold orbits
		for cp := rune(0x20); cp < 0x250; cp++ {
			inputs = append(inputs, string(cp))
		}
		for cp := rune(0x370); cp < 0x560; cp++ {
			inputs = append(inputs, string(cp))
		}
		for cp := rune(0x10a0); cp < 0x1100; cp++ {
			inputs = append(inputs, string(cp))
		}
		for cp := rune(0x1e00); cp < 0x2000; cp += 3 {
			inputs = append(inputs, string(cp))
		}
		for cp := rune(0x2100); cp < 0x2190; cp++ {
			inputs = append(inputs, string(cp))
		}
		for cp := rune(0xff00); cp < 0xff60; cp++ {
			inputs = append(inputs, string(cp))
		}
		for _, in := range inputs {
			add("linkRefFoldKey", call(0, []any{hexOf([]byte(in))}, func() any { return linkLinkRefFoldKey([]byte(in)) }))
		}
		for _, in := range inputs[:60] {
			add("foldBytes", call(0, []any{hexOf([]byte(in))}, func() any { return hexOf(linkFoldBytes([]byte(in))) }))
		}
	}

	// isDelimiterTextMark
	{
		types := []string{"", "strong", "em", "s", "mark", "sup", "sub", "u", "text", "a", "code", "kbd", "strong em", "em  strong", "strong a", "a strong", " strong ", "strong\tem", "u text s", "block-ref", "tag"}
		for _, typ := range types {
			for _, nodeType := range []ast.NodeType{ast.NodeTextMark, ast.NodeText} {
				for _, fc := range []string{"", "x"} {
					add("isDelimiterTextMark", call(0, []any{typ, int(nodeType), fc}, func() any {
						n := &ast.Node{Type: nodeType, TextMarkType: typ, TextMarkFlashcardOcclusionID: fc}
						return linkIsDelimiterTextMark(n)
					}))
				}
			}
		}
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(d); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
