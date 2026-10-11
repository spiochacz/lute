// Command gen-strings-vectors writes the expected results used by the TypeScript
// tests of the Go runtime layer (ts/src/runtime/strings.ts and strconv.ts).
//
// Every expected value is computed by the real Go 1.21 standard library. Inputs
// are valid UTF-8 only, generated from a fixed seed, so the output is
// reproducible. Index-returning functions also record the prefix s[:offset], so
// the TypeScript side can compare UTF-16 offsets without knowing byte offsets.
//
// Usage (from this directory):
//
//	GOTOOLCHAIN=local go run . -out ../../src/runtime/testdata
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const seed int64 = 20260610

var rng = rand.New(rand.NewSource(seed))

// skippedReplacer counts NewReplacer combinations whose Go output is invalid UTF-8.
var skippedReplacer int

type vec = map[string]interface{}

// asciiPool holds ASCII characters, including controls and quote characters.
var asciiPool = []rune{'a', 'b', 'A', 'Z', '0', '9', ' ', '\t', '\n', '\r', '"', '\\', '\'', '-', '+', '.', ',', ':', '&', '%', '#', 0x00, 0x07, 0x1b, 0x7f}

// nonASCIIPool holds valid, non-ASCII code points: Latin, Greek, Turkish dotted
// capital I, title case digraphs, Kelvin sign, long s, the whitespace and
// format characters that Go does and does not treat as spaces, combining marks,
// CJK, astral emoji and astral cased letters, U+FFFD, private use, unassigned
// and the largest code point.
var nonASCIIPool = []rune{
	0xe9, 0xdf, 0x130, 0x131, 0x1c4, 0x1c5, 0x1c6, 0x17c, 0x3a3, 0x3c3, 0x3c2,
	0x212a, 0x17f, 0x85, 0xa0, 0x1680, 0x2000, 0x2028, 0x2029, 0x3000, 0x200b,
	0xfeff, 0x200d, 0xad, 0x301, 0x308, 0x20dd, 0x65e5, 0x672c, 0x5b57,
	0x1f600, 0x1f44d, 0x1d400, 0x10400, 0x10428, 0xfffd, 0xe000, 0x378,
	0x10ffff, 0xe0001,
}

var mixedPool = append(append([]rune{}, asciiPool...), nonASCIIPool...)

// smallPool has few distinct symbols, so random patterns overlap often.
var smallPool = []rune{'a', 'b', ' ', 0x17c, 0x1f600}

// asciiSmall is smallPool restricted to ASCII. Empty-old NewReplacer cases use
// it because Go's generic replacer then inserts between UTF-8 bytes of
// multi-byte input, which produces invalid UTF-8 that a JS string cannot hold.
var asciiSmall = []rune{'a', 'b', ' ', '-'}

func randString(alphabet []rune, maxLen int) string {
	n := rng.Intn(maxLen + 1)
	rs := make([]rune, n)
	for i := range rs {
		rs[i] = alphabet[rng.Intn(len(alphabet))]
	}
	return string(rs)
}

// ---- strings ----------------------------------------------------------------

func mapFn(mode string) func(rune) rune {
	switch mode {
	case "drop_space_control":
		return func(r rune) rune {
			if unicode.IsSpace(r) || unicode.IsControl(r) {
				return -1
			}
			return r
		}
	case "upper":
		return unicode.ToUpper
	case "invalid_out":
		return func(r rune) rune {
			if r == 'x' || r == 'X' {
				return 0xd800
			}
			return r
		}
	}
	panic("unknown map mode " + mode)
}

var mapModes = []string{"drop_space_control", "upper", "invalid_out"}

// idx builds an index vector: the Go byte offset, plus the prefix that the
// offset cuts from s, so TypeScript can check the UTF-16 offset.
func idx(args []interface{}, off int) vec {
	v := vec{"args": args, "want": off}
	if off < 0 {
		v["prefix"] = nil
	} else {
		v["prefix"] = args[0].(string)[:off]
	}
	return v
}

func nonNil(a []string) []string {
	if a == nil {
		return []string{}
	}
	return a
}

type builderOp struct {
	Op string `json:"op"`
	S  string `json:"s"`
	N  int    `json:"n"`
}

func runBuilder(ops []builderOp) (string, int) {
	var b strings.Builder
	for _, o := range ops {
		switch o.Op {
		case "WriteString":
			b.WriteString(o.S)
		case "WriteByte":
			b.WriteByte(byte(o.N))
		case "WriteRune":
			b.WriteRune(rune(o.N))
		case "Reset":
			b.Reset()
		case "Grow":
			b.Grow(o.N)
		default:
			panic(o.Op)
		}
	}
	return b.String(), b.Len()
}

func randReplacerPairs(ascii bool) []string {
	alpha := smallPool
	if ascii {
		alpha = asciiSmall
	}
	k := 1 + rng.Intn(4)
	pairs := make([]string, 0, 2*k)
	for i := 0; i < k; i++ {
		old := randString(alpha, 3)
		if !ascii && old == "" {
			old = "a"
		}
		pairs = append(pairs, old, randString(alpha, 2))
	}
	return pairs
}

func genStrings() map[string][]vec {
	out := map[string][]vec{}
	add := func(fn string, args []interface{}, want interface{}) {
		out[fn] = append(out[fn], vec{"args": args, "want": want})
	}
	addIdx := func(fn string, args []interface{}, off int) {
		out[fn] = append(out[fn], idx(args, off))
	}

	// ReplaceAll and Replace.
	replaceCases := [][3]string{
		{"", "", "X"}, {"abc", "", "-"}, {"\u017c\u00f3\u0142w", "", "-"}, {"\U0001f600a\U0001f600", "", "|"},
		{"aaaa", "a", "b"}, {"aaaa", "aa", "b"}, {"abab", "ab", "ab"}, {"xyz", "q", "r"},
		{"\u65e5\u672c\u8a9e", "\u672c", "$1"}, {"a$b", "$", "&"}, {"\u00df stra\u00dfe", "\u00df", "ss"}, {"a\u0301a", "a", ""},
		{"x\x00y", "\x00", ""}, {"tab\tx", "\t", "\\t"}, {"", "a", "b"}, {"aaa", "a", "a"},
	}
	for _, c := range replaceCases {
		add("ReplaceAll", []interface{}{c[0], c[1], c[2]}, strings.ReplaceAll(c[0], c[1], c[2]))
		for _, n := range []int{-1, 0, 1, 2, 1000} {
			add("Replace", []interface{}{c[0], c[1], c[2], n}, strings.Replace(c[0], c[1], c[2], n))
		}
	}
	for i := 0; i < 50; i++ {
		s := randString(smallPool, 8)
		old := randString(smallPool, 2)
		nw := randString(smallPool, 2)
		add("ReplaceAll", []interface{}{s, old, nw}, strings.ReplaceAll(s, old, nw))
		n := []int{-1, 0, 1, 2, 1000}[rng.Intn(5)]
		add("Replace", []interface{}{s, old, nw, n}, strings.Replace(s, old, nw, n))
	}

	// Split and SplitN.
	splitCases := [][2]string{
		{"", ""}, {"", ","}, {"abc", ""}, {"a,b,c", ","}, {"a,,b", ","}, {",a,", ","},
		{"\u017c\u00f3\u0142w", ""}, {"\U0001f600\U0001f600", ""}, {"a--b---c", "--"}, {"aaa", "aa"}, {"a b\tc", " "},
		{"\u65e5,\u672c", ","}, {"a\u0301b", ""}, {"abc", "abc"}, {"abc", "abcd"},
	}
	for _, c := range splitCases {
		add("Split", []interface{}{c[0], c[1]}, nonNil(strings.Split(c[0], c[1])))
		for _, n := range []int{-1, 0, 1, 2, 1000} {
			add("SplitN", []interface{}{c[0], c[1], n}, nonNil(strings.SplitN(c[0], c[1], n)))
		}
	}
	for i := 0; i < 50; i++ {
		s := randString(smallPool, 8)
		sep := randString(smallPool, 2)
		add("Split", []interface{}{s, sep}, nonNil(strings.Split(s, sep)))
		n := []int{-1, 0, 1, 2, 1000}[rng.Intn(5)]
		add("SplitN", []interface{}{s, sep, n}, nonNil(strings.SplitN(s, sep, n)))
	}

	// Trimming functions (cutset and whitespace).
	spaceStrings := []string{"", " ", "  a  ", "\t\n\v\f\r x \r\n", "\u0085a\u00a0", "\u200bx\u200b", "\ufeffx\ufeff", "\u2028 x \u3000",
		"\u1680x\u2000", "\u65e5\u672c ", "  \U0001f600 ", "\u0301a\u0301", "\x00 x \x00", "\u00ad x\u00ad", "x\u0085", "\u0085\u00a0\u0085"}
	for _, s := range spaceStrings {
		add("TrimSpace", []interface{}{s}, strings.TrimSpace(s))
		add("Fields", []interface{}{s}, nonNil(strings.Fields(s)))
	}
	cutsets := []string{"", " ", "ab", "\u0085 ", "\u00e9\U0001f600", "\u65e5", "\u200b\ufeff", "-+", "a\u0301"}
	for _, s := range []string{"", "xxabcxx", "  abc  ", "\U0001f600a\U0001f600b\U0001f600", "\u00e9\u00e9a\u00e9", "\u65e5\u672c\u8a9e\u65e5", "\u0085\u00a0x\u0085", "-+x+-", "ab\u0301ab", "\u200bx\u200b"} {
		for _, cs := range cutsets {
			add("Trim", []interface{}{s, cs}, strings.Trim(s, cs))
			add("TrimLeft", []interface{}{s, cs}, strings.TrimLeft(s, cs))
			add("TrimRight", []interface{}{s, cs}, strings.TrimRight(s, cs))
		}
	}
	for i := 0; i < 30; i++ {
		s := randString(mixedPool, 8)
		cs := randString(mixedPool, 3)
		add("Trim", []interface{}{s, cs}, strings.Trim(s, cs))
		add("TrimLeft", []interface{}{s, cs}, strings.TrimLeft(s, cs))
		add("TrimRight", []interface{}{s, cs}, strings.TrimRight(s, cs))
		add("TrimSpace", []interface{}{s}, strings.TrimSpace(s))
		add("Fields", []interface{}{s}, nonNil(strings.Fields(s)))
	}
	prefixCases := [][2]string{{"", ""}, {"abc", ""}, {"abc", "ab"}, {"abc", "abc"}, {"abc", "abcd"},
		{"\u017c\u00f3\u0142w", "\u017c"}, {"\u017c\u00f3\u0142w", "\u00f3"}, {"\U0001f600x", "\U0001f600"}, {"\U0001f600x", "\U0001f600x"}, {"ab", "b"}, {"ab\u0301", "ab"}}
	for _, c := range prefixCases {
		add("TrimPrefix", []interface{}{c[0], c[1]}, strings.TrimPrefix(c[0], c[1]))
		add("TrimSuffix", []interface{}{c[0], c[1]}, strings.TrimSuffix(c[0], c[1]))
		add("HasPrefix", []interface{}{c[0], c[1]}, strings.HasPrefix(c[0], c[1]))
		add("HasSuffix", []interface{}{c[0], c[1]}, strings.HasSuffix(c[0], c[1]))
	}
	for i := 0; i < 30; i++ {
		s := randString(smallPool, 6)
		p := randString(smallPool, 2)
		add("TrimPrefix", []interface{}{s, p}, strings.TrimPrefix(s, p))
		add("TrimSuffix", []interface{}{s, p}, strings.TrimSuffix(s, p))
		add("HasPrefix", []interface{}{s, p}, strings.HasPrefix(s, p))
		add("HasSuffix", []interface{}{s, p}, strings.HasSuffix(s, p))
	}

	// Searching.
	for _, c := range prefixCases {
		s, sub := c[0], c[1]
		addIdx("Index", []interface{}{s, sub}, strings.Index(s, sub))
		addIdx("LastIndex", []interface{}{s, sub}, strings.LastIndex(s, sub))
		add("Contains", []interface{}{s, sub}, strings.Contains(s, sub))
		add("Count", []interface{}{s, sub}, strings.Count(s, sub))
	}
	for i := 0; i < 50; i++ {
		s := randString(smallPool, 8)
		sub := randString(smallPool, 2)
		addIdx("Index", []interface{}{s, sub}, strings.Index(s, sub))
		addIdx("LastIndex", []interface{}{s, sub}, strings.LastIndex(s, sub))
		add("Contains", []interface{}{s, sub}, strings.Contains(s, sub))
		add("Count", []interface{}{s, sub}, strings.Count(s, sub))
	}
	for _, s := range []string{"", "a:b", "\u017c\u00f3\u0142w", "x-y/z", "\u65e5\u672c\u00e9", "\U0001f600:\U0001f600", "a\x00b"} {
		for _, b := range []byte{'a', ':', 'w', '/', 0x00, 'z', 'x'} {
			addIdx("IndexByte", []interface{}{s, int(b)}, strings.IndexByte(s, b))
		}
	}
	for _, s := range []string{"", "\u017c\u00f3\u0142w", "abc", "a\ufffdb", "\U0001f600x", "\u65e5\u672c\u8a9e", "a\u0301"} {
		for _, r := range []rune{'a', 'w', '\u017c', 0x1f600, 0xfffd, 'x', 0x672c, 0x301, 0xd800, -1, 0x110000} {
			addIdx("IndexRune", []interface{}{s, int(r)}, strings.IndexRune(s, r))
			add("ContainsRune", []interface{}{s, int(r)}, strings.ContainsRune(s, r))
		}
	}
	anyCases := [][2]string{{"", ""}, {"abc", ""}, {"abc", "xyz"}, {"\u017c\u00f3\u0142w", "\u00f3"}, {"\u017c\u00f3\u0142w", "w\u0142"}, {"a\U0001f600b", "\U0001f600"},
		{"\u65e5\u672c\u8a9e", "\u8a9e\u672c"}, {"a\ufffdb", "\ufffd"}, {"a\u0301", "\u0301"}, {"a\tb", " \t"}, {"xyz", "\u0085"}}
	for _, c := range anyCases {
		addIdx("IndexAny", []interface{}{c[0], c[1]}, strings.IndexAny(c[0], c[1]))
		add("ContainsAny", []interface{}{c[0], c[1]}, strings.ContainsAny(c[0], c[1]))
	}
	for i := 0; i < 40; i++ {
		s := randString(mixedPool, 8)
		chars := randString(mixedPool, 3)
		addIdx("IndexAny", []interface{}{s, chars}, strings.IndexAny(s, chars))
		add("ContainsAny", []interface{}{s, chars}, strings.ContainsAny(s, chars))
	}

	// Cut returns [before, after, found].
	cutCases := [][2]string{{"", ""}, {"a:b", ":"}, {"a:b:c", ":"}, {"abc", ""}, {"abc", "x"}, {"\u65e5:\u672c", ":"}, {"\u017c:\U0001f600", "\U0001f600"}}
	for _, c := range cutCases {
		b, a, f := strings.Cut(c[0], c[1])
		add("Cut", []interface{}{c[0], c[1]}, []interface{}{b, a, f})
	}
	for i := 0; i < 40; i++ {
		s := randString(smallPool, 6)
		sep := randString(smallPool, 2)
		b, a, f := strings.Cut(s, sep)
		add("Cut", []interface{}{s, sep}, []interface{}{b, a, f})
	}

	// Case mapping and folding.
	caseStrings := []string{"", "abc", "ABC", "\u0130stanbul", "\u00df \u1e9e", "\u01c5 \u01c6 \u01c4", "\u03a3\u0391\u03a3 \u03c3 \u03c2", "Stra\u00dfe", "\u017c\u00f3\u0142w \u017b\u00d3\u0141W", "\u65e5\u672c \u8a9e",
		"\U0001f600 \U00010400\U00010428", "\ufb01", "K k \u212a", "\u017f s S", "\u00e9 e\u0301", "\ufffd", "\x00\x7f", "AbC123"}
	for _, s := range caseStrings {
		add("ToLower", []interface{}{s}, strings.ToLower(s))
		add("ToUpper", []interface{}{s}, strings.ToUpper(s))
	}
	foldPairs := [][2]string{{"", ""}, {"abc", "ABC"}, {"abc", "abd"}, {"abc", "ab"}, {"\u00df", "\u1e9e"}, {"K", "\u212a"},
		{"k", "\u212a"}, {"s", "\u017f"}, {"Stra\u00dfe", "STRASSE"}, {"\u017c\u00f3\u0142w", "\u017b\u00d3\u0141W"}, {"\u65e5", "\u65e5"}, {"\u03a3", "\u03c3"}, {"\u03c2", "\u03a3"},
		{"\U0001f600", "\U0001f600"}, {"\U00010400", "\U00010428"}, {"\u00e9", "\u00c9"}, {"e\u0301", "\u00c9"}, {"i", "\u0130"}, {"\u0131", "I"}, {"\u0085", "\u0085"}}
	for _, c := range foldPairs {
		add("EqualFold", []interface{}{c[0], c[1]}, strings.EqualFold(c[0], c[1]))
	}
	for i := 0; i < 40; i++ {
		s := randString(mixedPool, 6)
		// Build t by replacing each rune with a random member of its fold orbit,
		// so the pair is equal under folding in most cases.
		var rs []rune
		for _, r := range s {
			orbit := []rune{r}
			for f := unicode.SimpleFold(r); f != r; f = unicode.SimpleFold(f) {
				orbit = append(orbit, f)
			}
			rs = append(rs, orbit[rng.Intn(len(orbit))])
		}
		t := string(rs)
		add("EqualFold", []interface{}{s, t}, strings.EqualFold(s, t))
		u := randString(mixedPool, 6)
		add("EqualFold", []interface{}{s, u}, strings.EqualFold(s, u))
	}
	for i := 0; i < 30; i++ {
		s := randString(mixedPool, 8)
		add("ToLower", []interface{}{s}, strings.ToLower(s))
		add("ToUpper", []interface{}{s}, strings.ToUpper(s))
	}

	// Map with the named modes.
	mapInputs := []string{"", "a b\tc", "x\u0085y\u00a0z", "\u200bx\ufeff", "\u00dfx\u3000\u65e5", "\U0001f600 X x", "\x00\x7fa", "xXx"}
	for _, mode := range mapModes {
		for _, s := range mapInputs {
			add("Map", []interface{}{mode, s}, strings.Map(mapFn(mode), s))
		}
		for i := 0; i < 15; i++ {
			s := randString(mixedPool, 8)
			add("Map", []interface{}{mode, s}, strings.Map(mapFn(mode), s))
		}
	}

	// Repeat and Join.
	for _, s := range []string{"", "a", "\u017c\u00f3", "\U0001f600", "a b"} {
		for _, n := range []int{0, 1, 2, 3, 7} {
			add("Repeat", []interface{}{s, n}, strings.Repeat(s, n))
		}
	}
	for i := 0; i < 15; i++ {
		s := randString(smallPool, 3)
		n := rng.Intn(6)
		add("Repeat", []interface{}{s, n}, strings.Repeat(s, n))
	}
	joinCases := []struct {
		elems []string
		sep   string
	}{
		{nil, ","}, {[]string{}, ","}, {[]string{"a"}, ","}, {[]string{"a", "b", "c"}, ", "}, {[]string{"", ""}, "-"},
		{[]string{"\u65e5", "\u672c"}, ""}, {[]string{"\U0001f600", "x", "\U0001f600"}, "\u0301"},
	}
	for _, c := range joinCases {
		elems := c.elems
		if elems == nil {
			elems = []string{}
		}
		add("Join", []interface{}{elems, c.sep}, strings.Join(c.elems, c.sep))
	}
	for i := 0; i < 35; i++ {
		n := rng.Intn(4)
		elems := make([]string, n)
		for j := range elems {
			elems[j] = randString(smallPool, 3)
		}
		sep := randString(smallPool, 2)
		add("Join", []interface{}{elems, sep}, strings.Join(elems, sep))
	}

	// NewReplacer: the args are old/new pairs, then the input.
	type rcase struct {
		pairs []string
		in    []string
	}
	var rcases []rcase
	rcases = append(rcases,
		rcase{[]string{"a", "1", "ab", "2"}, []string{"abc"}},
		rcase{[]string{"ab", "2", "a", "1"}, []string{"abc"}},
		rcase{[]string{"b", "1", "ab", "2"}, []string{"abc"}},
		rcase{[]string{"ab", "1", "ba", "2", "b", "3"}, []string{"aba", "bab"}},
		rcase{[]string{"a", "", "a", "X"}, []string{"aa"}},
		rcase{[]string{"\\", "", "\"", "", "'", "", "\n", "", "\t", ""}, []string{"a\\\"b'c\nd\te", "", "plain"}},
		rcase{[]string{"\u017c", "z", "\u00f3", "o"}, []string{"\u017c\u00f3\u0142w", "\u017b\u00d3"}},
		rcase{[]string{"\U0001f600", ":)", "\U0001f600\U0001f600", "!!"}, []string{"\U0001f600\U0001f600x\U0001f600", "a\U0001f600"}},
		rcase{[]string{"&amp;", "&", "&", "&amp;"}, []string{"&amp;&amp;&"}},
		rcase{[]string{"\ue001", "X"}, []string{"a\ue001b\ue001"}},
		rcase{[]string{"S1\ue001", "[a]", "S10\ue001", "[b]"}, []string{"S10\ue001S1\ue001"}},
		rcase{[]string{"x", "1", "xy", "2", "y", "3", "xyz", "4"}, []string{"xyzxy"}},
		rcase{[]string{"abc", "1", "bc", "2", "c", "3"}, []string{"abcbcc"}},
		rcase{[]string{"ab", "X", "a", "Y"}, []string{""}},
		rcase{[]string{"a", "b", "b", "c"}, []string{"ab", "abb"}},
		rcase{[]string{"ab", "[ab]", "ba", "[ba]"}, []string{"aabbaa"}},
		rcase{[]string{"ab", "[ab]", "ba", "[ba]"}, []string{"aabbaa", "ab"}},
		rcase{[]string{"", "X"}, []string{""}},
		rcase{[]string{"a", "1", "", "X"}, []string{"ba"}},
		rcase{[]string{"", "X", "a", "Y"}, []string{"", "ab", "ba", "aaa"}},
		rcase{[]string{"", "-", "b", "B"}, []string{"abc", "bbb", ""}},
		rcase{[]string{"\u00e9", "E", "e", "x"}, []string{"\u00e9e\u00e9"}},
		rcase{[]string{"\u65e5\u672c", "JP", "\u672c", "B"}, []string{"\u65e5\u672c\u8a9e\u672c"}},
	)
	for i := 0; i < 40; i++ {
		ascii := rng.Intn(3) == 0
		pairs := randReplacerPairs(ascii)
		alpha := smallPool
		if ascii {
			alpha = asciiSmall
		}
		ins := []string{randString(alpha, 8), randString(alpha, 8)}
		rcases = append(rcases, rcase{pairs, ins})
	}
	for _, c := range rcases {
		r := strings.NewReplacer(c.pairs...)
		for _, in := range c.in {
			// With an empty old string, Go's generic replacer steps one byte at a
			// time, so it inserts the replacement between the bytes of multi-byte
			// characters. That output is not valid UTF-8 and cannot be a JS string,
			// so such combinations are skipped and counted in skippedReplacer.
			got := r.Replace(in)
			if !utf8.ValidString(got) {
				skippedReplacer++
				continue
			}
			add("NewReplacer", []interface{}{c.pairs, in}, got)
		}
	}

	// strings.Builder: a sequence of operations, then String and Len.
	builderCases := [][]builderOp{
		{},
		{{Op: "WriteString", S: "abc"}},
		{{Op: "WriteString", S: "\u017c\u00f3\u0142w"}, {Op: "WriteByte", N: 'x'}, {Op: "WriteRune", N: 0x1f600}},
		{{Op: "WriteRune", N: 0x65e5}, {Op: "WriteRune", N: 0x10ffff}, {Op: "WriteRune", N: 0xfffd}},
		{{Op: "WriteRune", N: 0xd800}, {Op: "WriteRune", N: 0x7f}},
		{{Op: "WriteString", S: "a"}, {Op: "Reset"}, {Op: "WriteString", S: "bc"}},
		{{Op: "Grow", N: 64}, {Op: "WriteString", S: "x"}, {Op: "Grow", N: 0}},
		{{Op: "WriteByte", N: '\n'}, {Op: "WriteByte", N: 0}},
		{{Op: "WriteString", S: ""}, {Op: "WriteRune", N: 0x301}},
	}
	for i := 0; i < 40; i++ {
		var ops []builderOp
		for j := 0; j < rng.Intn(6); j++ {
			switch rng.Intn(4) {
			case 0:
				ops = append(ops, builderOp{Op: "WriteString", S: randString(mixedPool, 4)})
			case 1:
				ops = append(ops, builderOp{Op: "WriteByte", N: int(asciiPool[rng.Intn(len(asciiPool))])})
			case 2:
				ops = append(ops, builderOp{Op: "WriteRune", N: int(mixedPool[rng.Intn(len(mixedPool))])})
			default:
				ops = append(ops, builderOp{Op: "WriteString", S: randString(smallPool, 3)})
			}
		}
		builderCases = append(builderCases, ops)
	}
	for _, ops := range builderCases {
		s, n := runBuilder(ops)
		if ops == nil {
			ops = []builderOp{}
		}
		add("Builder", []interface{}{ops}, vec{"string": s, "len": n})
	}

	return out
}

// ---- strconv ----------------------------------------------------------------

func encodeFloat(f float64) interface{} {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "+Inf"
	case math.IsInf(f, -1):
		return "-Inf"
	}
	return f
}

func errText(err error) interface{} {
	if err == nil {
		return nil
	}
	return err.Error()
}

func genStrconv() map[string][]vec {
	out := map[string][]vec{}
	add := func(fn string, args []interface{}, want interface{}) {
		out[fn] = append(out[fn], vec{"args": args, "want": want})
	}

	// Itoa and FormatInt. Values stay within +/-2^53 so JSON and JS numbers agree.
	ints := []int64{0, 1, -1, 9, 10, -10, 255, -255, 65535, 1 << 31, -(1 << 31), 1<<53 - 1, -(1<<53 - 1), 1234567890, -987654321}
	for i := 0; i < 40; i++ {
		ints = append(ints, rng.Int63n(1<<53)-(1<<52))
	}
	for _, v := range ints {
		add("Itoa", []interface{}{v}, strconv.Itoa(int(v)))
		for _, base := range []int{2, 8, 10, 16, 36} {
			add("FormatInt", []interface{}{v, base}, strconv.FormatInt(v, base))
		}
	}
	for _, b := range []bool{true, false} {
		add("FormatBool", []interface{}{b}, strconv.FormatBool(b))
	}

	// Quote.
	quoteCases := []string{"", "abc", "a\"b", "a\\b", "\a\b\f\n\r\t\v", "\x00\x01\x1f\x7f", "'single'", "\u65e5\u672c\u8a9e",
		"\u017c\u00f3\u0142w", "\U0001f600", "\u0085", "\u00a0", "\u200b", "\u2028", "\ufeff", "\u00ad", "\ufffd", "e\u0301", "\ue000", "\u0378",
		"\U000e0001", "\U0010ffff", "tab\there", "line\nbreak", "\u3000", "\u2000x", "\u0301"}
	for _, s := range quoteCases {
		add("Quote", []interface{}{s}, strconv.Quote(s))
	}
	for i := 0; i < 40; i++ {
		s := randString(mixedPool, 8)
		add("Quote", []interface{}{s}, strconv.Quote(s))
	}

	// Atoi.
	atoiCases := []string{"", "0", "-0", "+0", "+", "-", "abc", "12a", " 1", "1 ", "+12", "-12", "007", "1_000",
		"\u0661", "99999999999", "-99999999999", "9007199254740991", "-9007199254740991", "1e3", "0x10", "--1", "+-1", "3.5"}
	for _, s := range atoiCases {
		v, err := strconv.Atoi(s)
		add("Atoi", []interface{}{s}, vec{"value": v, "err": errText(err)})
	}
	for i := 0; i < 40; i++ {
		var b strings.Builder
		switch rng.Intn(4) {
		case 0:
			b.WriteByte('-')
		case 1:
			b.WriteByte('+')
		}
		for j := 0; j < 1+rng.Intn(10); j++ {
			alpha := "0123456789"
			if rng.Intn(10) == 0 {
				alpha = "0123456789abcxX_ "
			}
			b.WriteByte(alpha[rng.Intn(len(alpha))])
		}
		s := b.String()
		v, err := strconv.Atoi(s)
		add("Atoi", []interface{}{s}, vec{"value": v, "err": errText(err)})
	}

	// ParseInt with the bases and bit sizes that Lute uses (10 and 16 with 32),
	// plus other bases and sizes that the TypeScript port supports.
	parseIntInputs := []string{"", "0", "-", "+", "+1f", "-0x1", "ff", "FF", "7fffffff", "80000000", "-80000000",
		"-80000001", "99999999999", "-99999999999", "1_0", "007", "zz", "z", "10", "-10", "+10", "0b101", "a_b", "2147483647",
		"-2147483648", "128", "-129", "255", "256", "-1", "1 "}
	type pi struct {
		s            string
		base, bitTag int
	}
	var piCases []pi
	for _, s := range parseIntInputs {
		piCases = append(piCases, pi{s, 10, 32}, pi{s, 16, 32})
	}
	for _, s := range []string{"ff", "7f", "80", "-80", "-81", "1", "-1", "100"} {
		piCases = append(piCases, pi{s, 16, 8}, pi{s, 10, 8})
	}
	for _, s := range []string{"zz", "Z", "10", "-10", "35", "-z", "1000000000000000"} {
		piCases = append(piCases, pi{s, 36, 64}, pi{s, 2, 0}, pi{s, 36, 0})
	}
	piCases = append(piCases, pi{"10", 1, 64}, pi{"10", 37, 64}, pi{"10", 10, 65}, pi{"10", 10, -1})
	alphaPI := "0123456789abcdefABCDEFxz+-_"
	for i := 0; i < 50; i++ {
		var b strings.Builder
		if rng.Intn(3) == 0 {
			b.WriteByte("+-"[rng.Intn(2)])
		}
		for j := 0; j < rng.Intn(9); j++ {
			b.WriteByte(alphaPI[rng.Intn(len(alphaPI))])
		}
		base := []int{10, 16, 2, 36, 8}[rng.Intn(5)]
		bit := []int{0, 8, 16, 32, 64}[rng.Intn(5)]
		piCases = append(piCases, pi{b.String(), base, bit})
	}
	for _, c := range piCases {
		v, err := strconv.ParseInt(c.s, c.base, c.bitTag)
		add("ParseInt", []interface{}{c.s, c.base, c.bitTag}, vec{"value": v, "err": errText(err)})
	}

	// ParseFloat with bit size 64.
	pfInputs := []string{"", "-", "+", ".", "5.", ".5", "+.e1", "1e", "1e+", "0", "-0", "00012.50", "1e5", "1E-5", "1e400",
		"-1e400", "1e-400", "1.8e308", "1.7976931348623157e308", "2.2250738585072014e-308", "0.1", "0.2", "3.14159",
		"inf", "+inf", "-Inf", "Infinity", "-infinity", "nan", "NaN", "+nan", "infinit", " 5", "5 ", "0.0000001",
		"123456789012345678901234567890", "4.9e-324", "2e-324"}
	for _, s := range pfInputs {
		v, err := strconv.ParseFloat(s, 64)
		add("ParseFloat", []interface{}{s, 64}, vec{"value": encodeFloat(v), "err": errText(err)})
	}
	for i := 0; i < 50; i++ {
		var b strings.Builder
		switch rng.Intn(5) {
		case 0:
			b.WriteByte('-')
		case 1:
			b.WriteByte('+')
		}
		for j := 0; j < rng.Intn(6); j++ {
			b.WriteByte(byte('0' + rng.Intn(10)))
		}
		if rng.Intn(2) == 0 {
			b.WriteByte('.')
			for j := 0; j < rng.Intn(8); j++ {
				b.WriteByte(byte('0' + rng.Intn(10)))
			}
		}
		if rng.Intn(3) == 0 {
			b.WriteByte('e')
			if rng.Intn(2) == 0 {
				b.WriteByte("+-"[rng.Intn(2)])
			}
			for j := 0; j < rng.Intn(4); j++ {
				b.WriteByte(byte('0' + rng.Intn(10)))
			}
		}
		s := b.String()
		v, err := strconv.ParseFloat(s, 64)
		add("ParseFloat", []interface{}{s, 64}, vec{"value": encodeFloat(v), "err": errText(err)})
	}

	// FormatFloat with format 'f' and bit size 64, including exact half-way cases.
	floats := []float64{0, 1, -1, 0.5, 1.5, 2.5, 0.0078125, 0.0000005, 1.0000005, -0.0000001, 1e22, 1e21,
		123.456, 0.1, 0.2, 1.2, 0.888889, 1.0 / 3.0, 2.0 / 3.0, 1e-7, 5e-324, math.MaxFloat64, -math.MaxFloat64,
		math.Copysign(0, -1), math.Inf(1), math.Inf(-1), math.NaN(), 0.125, 0.375, 1.0 / 128.0, 1e15 + 0.5}
	for _, f := range floats {
		for _, prec := range []int{0, 1, 2, 6} {
			add("FormatFloat", []interface{}{encodeFloat(f), "f", prec, 64}, strconv.FormatFloat(f, 'f', prec, 64))
		}
	}
	for i := 0; i < 50; i++ {
		var f float64
		switch rng.Intn(3) {
		case 0:
			f = rng.Float64() * 10
		case 1:
			f = float64(rng.Intn(2000000)) / 2000000.0 // many values near six-digit ties
		default:
			f = (rng.Float64() - 0.5) * math.Pow(10, float64(rng.Intn(30)-10))
		}
		prec := []int{0, 1, 2, 3, 6, 8}[rng.Intn(6)]
		add("FormatFloat", []interface{}{encodeFloat(f), "f", prec, 64}, strconv.FormatFloat(f, 'f', prec, 64))
	}

	return out
}

// ---- main -------------------------------------------------------------------

type file struct {
	GoVersion string            `json:"goVersion"`
	Seed      int64             `json:"seed"`
	Generator string            `json:"generator"`
	Functions map[string][]vec `json:"functions"`
}

func write(path string, f file) {
	data, err := json.MarshalIndent(f, "", " ")
	if err != nil {
		panic(err)
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o644); err != nil {
		panic(err)
	}
	total := 0
	for _, v := range f.Functions {
		total += len(v)
	}
	fmt.Printf("wrote %s: %d functions, %d vectors\n", path, len(f.Functions), total)
}

func main() {
	outDir := flag.String("out", "../../src/runtime/testdata", "directory for the JSON vector files")
	flag.Parse()
	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		panic(err)
	}
	gen := "gen-strings-vectors (ts/tools/gen-strings-vectors)"
	write(filepath.Join(*outDir, "strings_vectors.json"), file{runtime.Version(), seed, gen, genStrings()})
	write(filepath.Join(*outDir, "strconv_vectors.json"), file{runtime.Version(), seed, gen, genStrconv()})
	fmt.Printf("skipped %d NewReplacer combinations whose Go output is not valid UTF-8\n", skippedReplacer)
}
