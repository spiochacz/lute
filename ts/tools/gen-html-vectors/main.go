// Command gen-html-vectors runs the real Go html package (the escaping and entity
// functions of html/entity.go, escape.go, escape_encode.go and unesc_str.go) on a
// fixed corpus and writes the results as JSON. The TypeScript port in ts/src/html/
// is asserted against this file.
//
// Exported functions are called directly. Unexported functions of the same files
// (unescape, unescapeEntity, lower, parseEntity, isValidEntityCode, unhex, advance)
// are reached through linknames in linkname.go. escape(w writer, s) is checked
// through EscapeString, which calls it.
//
// Usage (from this directory):
//
//	go run -tags javascript . > ../../src/html/testdata/escape_vectors.json
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"

	"github.com/88250/lute/html"
)

// vec is one call of a function. Args are the arguments (byte slices as lowercase
// hex, a Go nil byte slice as null, strings as JSON strings). Ret is the result
// (nested arrays for multi-value results). Panic is set when Go panicked. After is
// the buffer after an in-place call (nil when the function is not in-place or
// panicked).
//
// A vec is written as a JSON array to keep the file small:
//
//	[args, ret]                 normal call
//	[args, null, true]          Go panicked
//	[args, ret, false, after]   in-place call
type vec struct {
	Args  []any
	Ret   any
	Panic bool
	After any
}

// MarshalJSON writes the compact array form of vec.
func (v vec) MarshalJSON() ([]byte, error) {
	switch {
	case v.Panic:
		return json.Marshal([]any{v.Args, nil, true})
	case v.After != nil:
		return json.Marshal([]any{v.Args, v.Ret, false, v.After})
	}
	return json.Marshal([]any{v.Args, v.Ret})
}

type entityRec struct {
	Name string `json:"name"`
	Cps  string `json:"cps"`
}

type doc struct {
	GoVersion   string           `json:"goVersion"`
	BadEntity   string           `json:"badEntity"`
	EntityCount int              `json:"entityCount"`
	Entities    []entityRec      `json:"entities"`
	Functions   map[string][]vec `json:"functions"`
}

// hexOf returns b as a lowercase hex string, or nil (JSON null) for a nil slice.
func hexOf(b []byte) any {
	if b == nil {
		return nil
	}
	return hex.EncodeToString(b)
}

// set is an insertion-ordered set of strings.
type set struct {
	seen map[string]bool
	out  []string
}

func newSet() *set {
	return &set{seen: map[string]bool{}}
}

func (s *set) add(vs ...string) {
	for _, v := range vs {
		if !s.seen[v] {
			s.seen[v] = true
			s.out = append(s.out, v)
		}
	}
}

// numVals are numeric character reference values that matter: the Windows-1252
// range, NUL, surrogates, noncharacters, values above U+10FFFF and values that
// overflow an int32 when they are accumulated.
func numVals() []uint64 {
	vals := []uint64{0, 1, 8, 9, 10, 11, 12, 13, 0x1f, 0x20, 0x41, 0x7f, 0xa0, 0xad,
		0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfdcf, 0xfdd0, 0xfdef, 0xfdf0,
		0xfffd, 0xfffe, 0xffff, 0x1fffe, 0x1ffff, 0x1d504, 0x1f600, 0x4e2d, 0x10fffe,
		0x10ffff, 0x110000, 0x7fffffff, 0x80000000, 0xffffffff, 0x100000041,
		4294967361, 99999999, 2147483647, 2147483648, 9999999999, 99999999999}
	for v := uint64(0x80); v <= 0x9f; v++ {
		vals = append(vals, v)
	}
	return vals
}

// specialStrings are the strings that contain the escaped characters in each
// position, plus CJK, emoji, caret and newline cases.
func specialStrings(s *set) {
	s.add("", "a", " ", "hello world", "plain ASCII text 123", "\n", "\t", "\r\n",
		"line1\nline2\r\n", "a\nb", "a\n{b}\n\"c\"", "{x}", "{", "}", "x{y}z",
		"&#123;", "&#125;", "_esc_newline_", "‸", "‸\n", "a‸b", "‸{}\n_esc_newline_",
		"中文测试", "中&amp;文", "&amp;中文<>", "汉字 &lt; 汉字", "😀", "🎉 &amp; 🎉",
		"é &eacute; ü", " &nbsp;x", " &amp;", "\u009f&#159;", "\x00", "\x01&amp;",
		"\x7f", "\\", "\\*", "\\&amp;", "\\\\*", "\\a&amp;\\b", "a\\&lt;b", "&amp;\\*",
		"&&&", "&amp;&lt;", "x<y>z\"w'v&", "a&b", "&#39;", "&#34;", "&#13;", "&quot;")
	for _, c := range []string{"&", "'", "<", ">", "\"", "\r"} {
		s.add(c, "a"+c, c+"a", "a"+c+"b", c+c+c, "x"+c+"y"+c+"z", c+"中"+c, c+"😀"+c)
	}
}

// entityStrings returns the strings for the entity names. Each name is written
// with its semicolon and without it, followed by a letter, a digit or '='.
// Used by the sampled wrapper functions.
func entityStrings(s *set, names []string) {
	for _, n := range names {
		b := strings.TrimSuffix(n, ";")
		s.add("&"+n, "&"+b, "&"+b+"x", "&"+b+"=")
	}
}

// entityNameStrings returns the two forms of every entity name that the owners of
// the logic are checked with: the name as the table has it (with its semicolon, or
// the legacy name without one), and the name without its semicolon. Every name is
// covered; the trailing letter and '=' variants are in the sampled inputs.
func entityNameStrings(s *set, names []string) {
	for _, n := range names {
		s.add("&"+n, "&"+strings.TrimSuffix(n, ";"))
	}
}

// numericStrings returns character references in decimal and hex, with and without
// the semicolon, and malformed forms.
func numericStrings(s *set) {
	for _, v := range numVals() {
		s.add(fmt.Sprintf("&#%d;", v), fmt.Sprintf("&#%d", v), fmt.Sprintf("&#x%x;", v),
			fmt.Sprintf("&#X%X;", v), fmt.Sprintf("&#x%x", v), fmt.Sprintf("a&#%d;b", v))
	}
	s.add("&#", "&#;", "&#x;", "&#x", "&#xg;", "&#.", "&#x.", "&#1", "&#1a;", "&#xZ;",
		"&", "&;", "&&;", "&#x1", "&#0x41;", "&#00000000065;", "&#"+strings.Repeat("1", 40)+";",
		"&#x"+strings.Repeat("F", 40)+";", "&#"+strings.Repeat("0", 20)+"65;",
		"&#x"+strings.Repeat("0", 20)+"41;", "&#"+strings.Repeat("9", 30), "&#x"+strings.Repeat("e", 30),
		"&#65abc", "&#x41abc", "&#x41;&#x42;", "&#65;&#66", "&#65&#66;", "&#=65;",
		"&ampx", "&notin;", "&notit;", "&notinva", "&CounterClockwiseContourIntegral;",
		"&abcdefghijklmnopqrstuvwxyzabcdef;", "&lt=", "&amp=", "&lt;=", "&ltx;", "&amp;amp;",
		"&&amp;", "&amp&amp;", "&#x80;&#x9f;&#xa0;", "&#128;&#159;&#160;", "&#65;a&#66;b")
}

// unescapeStrings is the corpus for the functions that unescape text: the base
// strings, the numeric references and the entity names with the variants of
// entityStrings (sampled wrapper functions).
func unescapeStrings(names []string) []string {
	s := newSet()
	specialStrings(s)
	numericStrings(s)
	entityStrings(s, names)
	return s.out
}

// ownerUnescapeStrings is the corpus for UnescapeString and HtmlUnescapeString:
// the base strings, the numeric references and every entity name (entityNameStrings).
func ownerUnescapeStrings(names []string) []string {
	s := newSet()
	specialStrings(s)
	numericStrings(s)
	entityNameStrings(s, names)
	return s.out
}

// sampledNames returns every 16th entity name of the sorted names. The wrapper
// functions (UnescapeHTMLStr, UnescapeAttrVal, UnescapeBytes, UnescapeHTML,
// parseEntity, unescape) use this sample; the owners of the logic
// (UnescapeString, HtmlUnescapeString, unescapeEntity) use every name.
func sampledNames(names []string) []string {
	var out []string
	for i := 0; i < len(names); i += 16 {
		out = append(out, names[i])
	}
	return out
}

// escapeStrings is the corpus for the functions that only escape: no entity names.
func escapeStrings() []string {
	s := newSet()
	specialStrings(s)
	numericStrings(s)
	return s.out
}

// invalidBytes are byte sequences that are not valid UTF-8, mixed with ampersands,
// percent signs and backslashes.
func invalidBytes() [][]byte {
	return [][]byte{
		{0xff}, {0xfe}, {0x80}, {0xc3}, {0xc3, 0x28}, {0xe4, 0xb8}, {0xe4, 0xb8, 0x28},
		{0xf0, 0x9f, 0x98}, {0xed, 0xa0, 0x80}, {0xc0, 0xaf}, {'&', 0xff},
		{'&', 'a', 'm', 'p', 0xff}, {'&', 'a', 'm', 'p', ';', 0xff}, {'&', '#', 0xff},
		{'&', '#', '6', '5', 0xff}, {'%', 0xff}, {'%', 'c', '3'}, {'%', 'c', '3', '%', '2', '8'},
		{'%', 'e', '4', '%', 'b', '8'}, {'%', 'f', 'f'}, {'a', 0x80, 'b', '&', 'l', 't', ';'},
		{'\\', 0xff}, {'&', 'a', 'm', 'p', 0x80, ';'}, {0xf8, 0x88, 0x80, 0x80, 0x80},
	}
}

// byteInputs converts the strings into byte slices and adds the invalid UTF-8
// sequences and every single byte.
func byteInputs(strs []string) [][]byte {
	var out [][]byte
	for _, s := range strs {
		out = append(out, []byte(s))
	}
	out = append(out, invalidBytes()...)
	for v := 0; v < 256; v++ {
		out = append(out, []byte{byte(v)})
	}
	return out
}

// percentStrings are inputs for DecodeDestination and EncodeDestination.
func percentStrings() []string {
	s := newSet()
	s.add("%41", "%4a", "%4A", "%zz", "%", "%4", "%%41", "%C3%A9", "%C3", "%E4%B8%AD",
		"%E4%B8", "%F0%9F%98%80", "%F0%9F%98", "%80", "%FF", "%C3%28", "%ZZ", "%E4%B8%2",
		"%C3%A9%", "a%20b", "a b", "http://x.y/z?q=1&r=2#f", "[a](b)", "<>\"`{}|\\^",
		"%25", "%2", "%%", "%%%", "%e4%b8%ad", "%c3%a9", "é", "中", "😀", "a%2Fb%3f",
		"!#$&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~",
		"\x00\x01\x1f\x20\x7f", "\u0080ÿ", "http://例子.测试/路径?q=中文#锚点", "%41%42%43",
		"%ff%fe", "%c0%80", "%e0%80%80", "%f4%90%80%80", "%ed%a0%80", "%f0%9f%98%80%f0%9f%98%80")
	for _, c := range []byte("!#$%&'()*+,-./:;<=>?@[]^_`{|}~ \"\\") {
		s.add(string(c), "a"+string(c), string(c)+"b", "%"+string(c)+"4")
	}
	for c := 0x20; c <= 0x7e; c++ {
		s.add(string(rune(c)))
	}
	return s.out
}

// entityNames returns every key of html.Entities, sorted.
func entityNames() []string {
	names := make([]string, 0, len(html.Entities))
	for k := range html.Entities {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

// call runs f and records a Go panic instead of stopping the generator.
func call(f func() (ret any, after any)) (ret any, after any, panicked bool) {
	defer func() {
		if r := recover(); r != nil {
			ret = nil
			after = nil
			panicked = true
		}
	}()
	ret, after = f()
	return
}

func rec(t map[string][]vec, name string, args []any, f func() (ret any, after any)) {
	ret, after, pan := call(f)
	v := vec{Args: args, Ret: ret, Panic: pan}
	if !pan {
		v.After = after
	}
	t[name] = append(t[name], v)
}

func main() {
	// go run -tags javascript . token > token_vectors.json
	// go run -tags javascript . node > node_vectors.json
	// go run -tags javascript . parse > parse_vectors.json
	// With no argument the escape vectors are written.
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "token":
			writeTokenVectors()
			return
		case "node":
			writeNodeVectors()
			return
		case "parse":
			writeParseVectors()
			return
		}
	}
	names := entityNames()
	funcs := map[string][]vec{}

	// Functions of escape.go, escape_encode.go and unesc_str.go that take a string.
	escStrs := escapeStrings()
	unescStrs := ownerUnescapeStrings(names)
	sampStrs := unescapeStrings(sampledNames(names))
	for _, s := range escStrs {
		s := s
		rec(funcs, "EscapeString", []any{s}, func() (any, any) { return html.EscapeString(s), nil })
		rec(funcs, "EscapeHTMLStr", []any{s}, func() (any, any) { return html.EscapeHTMLStr(s), nil })
		rec(funcs, "EscapeAttrVal", []any{s}, func() (any, any) { return html.EscapeAttrVal(s), nil })
	}
	for _, s := range unescStrs {
		s := s
		rec(funcs, "UnescapeString", []any{s}, func() (any, any) { return html.UnescapeString(s), nil })
		rec(funcs, "HtmlUnescapeString", []any{s}, func() (any, any) { return html.HtmlUnescapeString(s), nil })
	}
	for _, s := range sampStrs {
		s := s
		rec(funcs, "UnescapeHTMLStr", []any{s}, func() (any, any) { return html.UnescapeHTMLStr(s), nil })
		rec(funcs, "UnescapeAttrVal", []any{s}, func() (any, any) { return html.UnescapeAttrVal(s), nil })
	}

	// Functions that take a byte slice.
	escBytes := byteInputs(escStrs)
	for _, b := range escBytes {
		b := b
		rec(funcs, "EscapeHTML", []any{hexOf(b)}, func() (any, any) { return hexOf(html.EscapeHTML(b)), nil })
		rec(funcs, "EncodeDestination", []any{hexOf(b)}, func() (any, any) { return hexOf(html.EncodeDestination(b)), nil })
		rec(funcs, "DecodeDestination", []any{hexOf(b)}, func() (any, any) { return hexOf(html.DecodeDestination(b)), nil })
	}
	for _, b := range byteInputs(percentStrings()) {
		b := b
		rec(funcs, "EncodeDestination", []any{hexOf(b)}, func() (any, any) { return hexOf(html.EncodeDestination(b)), nil })
		rec(funcs, "DecodeDestination", []any{hexOf(b)}, func() (any, any) { return hexOf(html.DecodeDestination(b)), nil })
	}
	rec(funcs, "EscapeHTML", []any{nil}, func() (any, any) { return hexOf(html.EscapeHTML(nil)), nil })
	rec(funcs, "EncodeDestination", []any{nil}, func() (any, any) { return hexOf(html.EncodeDestination(nil)), nil })
	rec(funcs, "DecodeDestination", []any{nil}, func() (any, any) { return hexOf(html.DecodeDestination(nil)), nil })

	// Unescape functions that take bytes, with nil and the entity corpus.
	unescBytes := byteInputs(sampStrs)
	for _, b := range unescBytes {
		b := b
		rec(funcs, "UnescapeBytes", []any{hexOf(b)}, func() (any, any) { return hexOf(html.UnescapeBytes(b)), nil })
		rec(funcs, "UnescapeHTML", []any{hexOf(b)}, func() (any, any) { return hexOf(html.UnescapeHTML(b)), nil })
	}
	rec(funcs, "UnescapeBytes", []any{nil}, func() (any, any) { return hexOf(html.UnescapeBytes(nil)), nil })
	rec(funcs, "UnescapeHTML", []any{nil}, func() (any, any) { return hexOf(html.UnescapeHTML(nil)), nil })

	// Unexported functions, reached through linknames (linkname.go).
	for _, s := range sampStrs {
		s := s
		rec(funcs, "parseEntity", []any{s}, func() (any, any) {
			r, n := linkParseEntity(s)
			return []any{r, n}, nil
		})
	}
	// unescape: both attribute modes on the sampled inputs (the base strings are part
	// of them). lower: the base inputs.
	for _, b := range byteInputs(sampStrs) {
		for _, attr := range []bool{false, true} {
			b := b
			attr := attr
			rec(funcs, "unescape", []any{hexOf(b), attr}, func() (any, any) {
				buf := append([]byte(nil), b...)
				if buf == nil {
					buf = []byte{}
				}
				out := linkUnescape(buf, attr)
				return hexOf(out), hexOf(buf)
			})
		}
	}
	for _, b := range byteInputs(escStrs) {
		b := b
		rec(funcs, "lower", []any{hexOf(b)}, func() (any, any) {
			buf := append([]byte(nil), b...)
			if buf == nil {
				buf = []byte{}
			}
			out := linkLower(buf)
			return hexOf(out), hexOf(buf)
		})
	}
	// unescapeEntity: every '&' of the corpus strings, with dst equal to src, and with
	// dst at 0 (an earlier position, so the write overlaps the output), for both
	// attribute modes. The entity names are used as "&name;" and "&name".
	// Every entity name is used once as "&name" (with its semicolon, or the legacy name
	// without one), with dst equal to src. The overlapping dst at 0 is used for the
	// base strings and for the sampled names only, to keep the file small.
	ueStrs := append([]string{}, escStrs...)
	overlap := map[string]bool{}
	for _, s := range escStrs {
		overlap[s] = true
	}
	sampled := map[string]bool{}
	for _, n := range sampledNames(names) {
		sampled["&"+n] = true
	}
	for _, n := range names {
		ueStrs = append(ueStrs, "&"+n)
		overlap["&"+n] = sampled["&"+n]
	}
	for _, s := range ueStrs {
		dsts := []int{0, 0}
		for src := 0; src < len(s); src++ {
			if s[src] != '&' {
				continue
			}
			for _, attr := range []bool{false, true} {
				dsts[0] = src
				dsts[1] = 0
				list := dsts[:1]
				if overlap[s] {
					list = dsts
				}
				for _, dst := range list {
					s, src, dst, attr := s, src, dst, attr
					rec(funcs, "unescapeEntity", []any{hexOf([]byte(s)), dst, src, attr}, func() (any, any) {
						buf := []byte(s)
						d1, s1 := linkUnescapeEntity(buf, dst, src, attr)
						return []any{d1, s1}, hexOf(buf)
					})
				}
			}
		}
	}
	// isValidEntityCode: the numeric values, and every value from 0 to 0x20 and 0x7e to 0xa0.
	cvals := []int64{}
	for _, v := range numVals() {
		if v <= 0x7fffffff {
			cvals = append(cvals, int64(v))
		}
	}
	for v := int64(0); v <= 0x20; v++ {
		cvals = append(cvals, v)
	}
	for v := int64(0x7e); v <= 0xa0; v++ {
		cvals = append(cvals, v)
	}
	for _, c := range cvals {
		c := c
		rec(funcs, "isValidEntityCode", []any{c}, func() (any, any) { return linkIsValidEntityCode(c), nil })
	}
	// unhex: every byte value (non-hex bytes panic in Go).
	for v := 0; v < 256; v++ {
		b := byte(v)
		rec(funcs, "unhex", []any{v}, func() (any, any) { return int(linkUnhex(b)), nil })
	}
	// advance: each byte slice of the percent corpus, at every position up to len+1.
	for _, b := range byteInputs(percentStrings()) {
		for pos := 0; pos <= len(b)+1; pos++ {
			b := b
			pos := pos
			rec(funcs, "advance", []any{hexOf(b), pos}, func() (any, any) {
				c, p := linkAdvance(b, pos)
				return []any{int(c), p}, nil
			})
		}
	}

	// Entity table as Go sees it.
	ents := make([]entityRec, 0, len(html.Entities))
	for _, name := range names {
		v := html.Entities[name]
		var cps []string
		for _, r := range v {
			cps = append(cps, fmt.Sprintf("%x", r))
		}
		ents = append(ents, entityRec{Name: name, Cps: strings.Join(cps, ",")})
	}

	out := doc{
		GoVersion:   runtime.Version(),
		BadEntity:   hex.EncodeToString([]byte(html.BadEntity)),
		EntityCount: len(html.Entities),
		Entities:    ents,
		Functions:   funcs,
	}
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
