// Command gen-lex-vectors runs the real Go lex package (every exported function
// of lex/token.go and the lexer) on a fixed corpus and writes the results as
// JSON. The TypeScript port in ts/src/lex/ is asserted against this file.
//
// Usage (from this directory):
//
//	go run -tags javascript . > ../../src/lex/testdata/lex_vectors.json
package main

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"runtime"
	"sort"
	"unicode"
	"unicode/utf8"

	"github.com/88250/lute/lex"
)

// vec is one call of a function. Ret is the result (nested arrays for
// multi-value results). A nil slice in the result is written as null, so the
// TypeScript side can tell Go's nil from an empty slice where it matters. Panic
// is set when Go panicked. After is the input buffer after an in-place call.
type vec struct {
	Args  []any `json:"args"`
	Ret   any   `json:"ret"`
	Panic bool  `json:"panic"`
	After any   `json:"after,omitempty"`
}

// lexVec is one lexer run: NextLine is called until it returns nil.
type lexVec struct {
	Input      string `json:"input"`
	Lines      []any  `json:"lines"`
	InputAfter string `json:"inputAfter"`
}

type doc struct {
	GoVersion      string           `json:"goVersion"`
	UnicodeVersion string           `json:"unicodeVersion"`
	Functions      map[string][]vec `json:"functions"`
	Lexer          []lexVec         `json:"lexer"`
}

var out = doc{
	GoVersion:      runtime.Version(),
	UnicodeVersion: unicode.Version,
	Functions:      map[string][]vec{},
}

// corpus is the set of byte inputs. Raw bytes are written with \x escapes so
// invalid UTF-8 is kept as is.
var corpus = []string{
	"", " ", "\t", "\n", "\r", "\r\n", "\n\n", " \n", "\n ", "  \n  ",
	"\t\v\f\r ", "a", "abc", "Hello World", "hello\nworld", "a b c",
	"a|b|c", "a\\|b", "\\|", "||", "|a|", "a\\\\|b", "\\\\", "\\*a\\*",
	"*a*", "_a_", "`code`", "~~x~~", "$x$", "=x=", "^x^", "<a>",
	"[x](y)", "![alt](src)", "{a}", "# title", "- item", "1. item",
	"> quote", "a.b.c", ".", "..", "a:b", "a;b", "a&b", "?",
	"中文", "中 文", " 中文 ", "😀", "a😀b", "　", " 　 ",
	" x", "\xff", "a\xffb", "\xc0\x80", "\xe4\xb8", "\xed\xa0\x80",
	"\x00", "a\x00b", "\x00\x00", "a\r\nb\rc\n", "\r\r\n\n", "x\r",
	"A-Z_0-9", "\x7f", "\x1f", "ab\tcd", "tab\there", "  leading",
	"trailing  ", "\n\nx\n\n", "a\n b\n c", "\\", "\\\\\\", "x\\", "a\\b",
	"\"'", "(a)", "<!-- c -->", "|---|---|", "a | b", "%", "@",
	"line one\nline two\n\nline three\n", "\xef\xbb\xbfbom", "a b",
	"\\|\\|", "x\\\\\\|y",
}

// exact returns a copy of s whose capacity equals its length, as a fresh
// []byte. Append then always reallocates, which keeps the aliasing of the
// caller's buffer the same as in the TypeScript port.
func exact(s string) []byte {
	b := make([]byte, len(s))
	copy(b, s)
	return b
}

// hx writes a byte slice as hex, and a nil slice as null.
func hx(b []byte) any {
	if b == nil {
		return nil
	}
	return hex.EncodeToString(b)
}

// hxs writes a slice of byte slices as an array of hex strings.
func hxs(xs [][]byte) []any {
	out := make([]any, 0, len(xs))
	for _, x := range xs {
		out = append(out, hx(x))
	}
	return out
}

// run calls f and reports a Go panic instead of stopping the generator.
func run(f func() any) (ret any, pan bool) {
	defer func() {
		if recover() != nil {
			ret = nil
			pan = true
		}
	}()
	ret = f()
	return
}

// add records one call of name. f must build its own input, so that calls
// do not share state.
func add(name string, args []any, f func() any) {
	ret, pan := run(f)
	out.Functions[name] = append(out.Functions[name], vec{Args: args, Ret: ret, Panic: pan})
}

// addInPlace records one call that may modify buf. After is buf after the call.
func addInPlace(name string, args []any, buf []byte, f func() any) {
	ret, pan := run(f)
	out.Functions[name] = append(out.Functions[name], vec{Args: args, Ret: ret, Panic: pan, After: hx(buf)})
}

// tokensCase adds a call of a function that takes only the tokens, for every corpus input.
func tokensCase(name string, f func(tokens []byte) any) {
	for _, s := range corpus {
		s := s
		add(name, []any{hx([]byte(s))}, func() any { return f(exact(s)) })
	}
}

// tokensByteCase adds a call of a function that takes tokens and a byte, for
// every corpus input and every byte in bs.
func tokensByteCase(name string, bs []byte, f func(tokens []byte, c byte) any) {
	for _, s := range corpus {
		for _, c := range bs {
			s, c := s, c
			add(name, []any{hx([]byte(s)), int(c)}, func() any { return f(exact(s), c) })
		}
	}
}

func main() {
	// Predicates over one byte: every value 0..255.
	byteFns := map[string]func(byte) bool{
		"IsWhitespace":           func(b byte) bool { return lex.IsWhitespace(b) },
		"IsDigit":                func(b byte) bool { return lex.IsDigit(b) },
		"IsHexDigit":             func(b byte) bool { return lex.IsHexDigit(b) },
		"IsASCIIPunct":           func(b byte) bool { return lex.IsASCIIPunct(b) },
		"IsASCIILetter":          func(b byte) bool { return lex.IsASCIILetter(b) },
		"IsASCIILetterNum":       func(b byte) bool { return lex.IsASCIILetterNum(b) },
		"IsASCIILetterNumHyphen": func(b byte) bool { return lex.IsASCIILetterNumHyphen(b) },
		"IsControl":              func(b byte) bool { return lex.IsControl(b) },
		"IsCommonInlineMarker":   func(b byte) bool { return lex.IsCommonInlineMarker(b) },
		"IsProtyleInlineMarker":  func(b byte) bool { return lex.IsProtyleInlineMarker(b) },
		"IsMarker":               func(b byte) bool { return lex.IsMarker(b) },
	}
	for name, f := range byteFns {
		f := f
		for v := 0; v < 256; v++ {
			b := byte(v)
			add(name, []any{v}, func() any { return f(b) })
		}
	}
	for v := 0; v < 256; v++ {
		b := byte(v)
		add("TokenToUpper", []any{v}, func() any { return lex.TokenToUpper(b) })
	}

	// IsUnicodeWhitespace over runes: every code point U+0000-U+2FFF, plus the
	// blocks named in the task and a few known spaces and joiners.
	runeSet := map[rune]bool{}
	for r := rune(0); r <= 0x2fff; r++ {
		runeSet[r] = true
	}
	blocks := [][2]rune{{0x3000, 0x303f}, {0x4e00, 0x4e7f}, {0xff00, 0xffef}, {0x1f600, 0x1f64f}}
	for _, bl := range blocks {
		for r := bl[0]; r <= bl[1]; r++ {
			runeSet[r] = true
		}
	}
	for _, r := range []rune{0x85, 0xa0, 0x1680, 0x180e, 0x2028, 0x2029, 0x202f, 0x205f, 0x2060, 0x200b, 0x1f600, 0x10ffff} {
		runeSet[r] = true
	}
	runes := make([]int, 0, len(runeSet))
	for r := range runeSet {
		runes = append(runes, int(r))
	}
	sort.Ints(runes)
	for _, r := range runes {
		rr := rune(r)
		add("IsUnicodeWhitespace", []any{r}, func() any { return lex.IsUnicodeWhitespace(rr) })
	}

	// Byte slice inputs.
	tokensCase("IsASCIILetterNums", func(t []byte) any { return lex.IsASCIILetterNums(t) })
	tokensCase("IsBlank", func(t []byte) any { return lex.IsBlank(t) })
	tokensCase("IsBlankLine", func(t []byte) any { return lex.IsBlankLine(t) })
	tokensCase("SplitWhitespace", func(t []byte) any { return hxs(lex.SplitWhitespace(t)) })
	tokensCase("TrimWhitespace", func(t []byte) any { return hx(lex.TrimWhitespace(t)) })
	tokensCase("Trim", func(t []byte) any {
		l, r, rem := lex.Trim(t)
		return []any{hx(l), hx(r), hx(rem)}
	})
	tokensCase("TrimLeft", func(t []byte) any {
		w, rem := lex.TrimLeft(t)
		return []any{hx(w), hx(rem)}
	})
	tokensCase("TrimRight", func(t []byte) any {
		w, rem := lex.TrimRight(t)
		return []any{hx(w), hx(rem)}
	})
	tokensCase("StatWhitespace", func(t []byte) any {
		n, s, tb := lex.StatWhitespace(t)
		return []any{n, s, tb}
	})
	tokensCase("Spnl", func(t []byte) any {
		ok, passed, remains := lex.Spnl(t)
		return []any{ok, hx(passed), hx(remains)}
	})
	tokensCase("ReplaceNewlineSpace", func(t []byte) any { return hx(lex.ReplaceNewlineSpace(t)) })
	tokensCase("EscapeCommonMarkers", func(t []byte) any { return hx(lex.EscapeCommonMarkers(t)) })
	tokensCase("EscapeProtyleMarkers", func(t []byte) any { return hx(lex.EscapeProtyleMarkers(t)) })
	tokensCase("BytesShowLength", func(t []byte) any { return lex.BytesShowLength(t) })

	// Tokens and one byte.
	splitSeps := []byte{'\n', '|', ' ', '.', 'a', '\\'}
	tokensByteCase("Split", splitSeps, func(t []byte, c byte) any { return hxs(lex.Split(t, c)) })
	tokensByteCase("SplitWithoutBackslashEscape", []byte{'|', ' ', '.', '\n', 'a'}, func(t []byte, c byte) any {
		return hxs(lex.SplitWithoutBackslashEscape(t, c))
	})
	tokensByteCase("Accept", []byte{'#', ' ', '`', 'a', '\n', '\\'}, func(t []byte, c byte) any { return lex.Accept(t, c) })
	// Peek takes an index, so it has its own loop over positions -1..len+1.
	for _, s := range corpus {
		for pos := -1; pos <= len(s)+1; pos++ {
			s, pos := s, pos
			add("Peek", []any{hx([]byte(s)), pos}, func() any { return int(lex.Peek(exact(s), pos)) })
		}
	}
	// IsBackslashEscapePunct takes an index too.
	for _, s := range corpus {
		for pos := -1; pos <= len(s); pos++ {
			s, pos := s, pos
			add("IsBackslashEscapePunct", []any{hx([]byte(s)), pos}, func() any { return lex.IsBackslashEscapePunct(exact(s), pos) })
		}
	}

	// ReplaceAll mutates its input in place.
	replacePairs := [][2]byte{{'\n', ' '}, {' ', '\n'}, {'a', 'b'}, {'|', '\\'}, {0, 'x'}, {'\\', '|'}}
	for _, s := range corpus {
		for _, p := range replacePairs {
			s, p := s, p
			buf := exact(s)
			addInPlace("ReplaceAll", []any{hx([]byte(s)), int(p[0]), int(p[1])}, buf, func() any {
				return hx(lex.ReplaceAll(buf, p[0], p[1]))
			})
		}
	}

	// AcceptTokens and AcceptTokenss take sets of token strings.
	someSets := []string{"#", " a", "a", "\n", "<!--", "ab", "", "\\|", "中", "\xff"}
	for _, s := range corpus {
		for _, set := range someSets {
			s, set := s, set
			add("AcceptTokens", []any{hx([]byte(s)), hx([]byte(set))}, func() any {
				return lex.AcceptTokens(exact(s), exact(set))
			})
		}
	}
	tokenss := [][]string{
		{"#"}, {" ", "a"}, {"<!--", "<?"}, {"<p", "<pre"}, {"ab", ""}, {"\n", "a"}, {"中", "x"}, {"\xff"},
	}
	for _, s := range corpus {
		for _, set := range tokenss {
			s, set := s, set
			sets := make([]any, 0, len(set))
			for _, x := range set {
				sets = append(sets, hx([]byte(x)))
			}
			add("AcceptTokenss", []any{hx([]byte(s)), sets}, func() any {
				ss := make([][]byte, 0, len(set))
				for _, x := range set {
					ss = append(ss, exact(x))
				}
				return lex.AcceptTokenss(exact(s), ss)
			})
		}
	}

	// RepeatBackslashBeforePipe takes a Go string, so only valid UTF-8 inputs are used.
	for _, s := range corpus {
		if !utf8.ValidString(s) {
			continue
		}
		s := s
		add("RepeatBackslashBeforePipe", []any{s}, func() any { return lex.RepeatBackslashBeforePipe(s) })
	}

	// Lexer: NewLexer and NextLine until nil. InputAfter is the caller's buffer
	// after the run; NextLine rewrites CR to LF in place.
	for _, s := range corpus {
		buf := exact(s)
		lx := lex.NewLexer(buf)
		lines := []any{}
		for line := lx.NextLine(); line != nil; line = lx.NextLine() {
			lines = append(lines, hx(line))
		}
		out.Lexer = append(out.Lexer, lexVec{Input: hex.EncodeToString([]byte(s)), Lines: lines, InputAfter: hex.EncodeToString(buf)})
	}

	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(out); err != nil {
		panic(err)
	}
}
