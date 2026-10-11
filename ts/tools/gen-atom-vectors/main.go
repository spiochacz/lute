// Command lute-ts-gen-atom-vectors writes the expected results used by the
// TypeScript port of html/atom (ts/src/html/atom).
//
// The output is JSON on stdout. It holds:
//   - constants: every atom constant (name, value, String()), checked against
//     the values parsed from table.go with go/parser (names_gen.go references
//     the real package constants, so a missing name does not compile);
//   - hash0, maxAtomLen, the table (512 slots) and atomText, parsed from
//     table.go, so the TypeScript copies can be compared with the source;
//   - lookup: atom.Lookup results for each atom's own text, for upper-case
//     and one-edit variants of it, and for other byte strings;
//   - string: atom.String results for every atom and other byte string, as the
//     Go bytes (hex) and as the JavaScript string those bytes decode to, where
//     each invalid byte becomes one U+FFFD (the convention of runtime bytes).
//
// Every input is generated from a fixed PCG seed, so the output is reproducible.
//
// Usage (from this directory):
//
//	go run -tags javascript . > ../../src/html/atom/testdata/atom_vectors.json
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"math/rand/v2"
	"os"
	"runtime"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/html/atom"
)

const tableGoPath = "../../../html/atom/table.go"

const seedA = 20260610
const seedB = 0x6c757465 // "lute"

type constant struct {
	Name   string `json:"name"`
	Value  uint32 `json:"value"`
	String string `json:"string"`
}

type lookupVector struct {
	Kind  string `json:"kind"`
	Input string `json:"input"` // hex
	Atom  uint32 `json:"atom"`
}

type stringVector struct {
	Input string `json:"input"` // hex
	GoHex string `json:"goHex"` // hex of the bytes of Go's string(...) result
	JS    string `json:"js"`    // the same bytes decoded; each invalid byte is U+FFFD
	Valid bool   `json:"valid"` // the input is valid UTF-8
}

type output struct {
	GoVersion  string            `json:"goVersion"`
	Hash0      uint32            `json:"hash0"`
	MaxAtomLen int               `json:"maxAtomLen"`
	TableLen   int               `json:"tableLen"`
	Table      map[string]uint32 `json:"table"` // slot (decimal) -> value, non-zero slots only
	AtomText   string            `json:"atomText"`
	Counts     map[string]int    `json:"counts"`
	Constants  []constant        `json:"constants"`
	Lookup     []lookupVector    `json:"lookup"`
	String     []stringVector    `json:"string"`
}

type namedValue struct {
	name  string
	value uint64
}

// parsed is what go/parser finds in table.go.
type parsed struct {
	consts     []namedValue
	hash0      uint64
	maxAtomLen uint64
	tableLen   int
	table      map[int]uint64
	atomText   string
}

func intLit(e ast.Expr) uint64 {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.INT {
		panic(fmt.Sprintf("not an integer literal: %T", e))
	}
	v, err := strconv.ParseUint(lit.Value, 0, 64)
	if err != nil {
		panic(err)
	}
	return v
}

// evalLen evaluates the array length expression "1 << 9".
func evalLen(e ast.Expr) int {
	be, ok := e.(*ast.BinaryExpr)
	if !ok || be.Op != token.SHL {
		panic("unexpected array length expression")
	}
	return int(intLit(be.X) << intLit(be.Y))
}

// concatText flattens a chain of string literals joined with +.
func concatText(e ast.Expr) string {
	switch x := e.(type) {
	case *ast.BasicLit:
		s, err := strconv.Unquote(x.Value)
		if err != nil {
			panic(err)
		}
		return s
	case *ast.BinaryExpr:
		if x.Op != token.ADD {
			panic("unexpected operator in atomText")
		}
		return concatText(x.X) + concatText(x.Y)
	}
	panic(fmt.Sprintf("unexpected atomText expression %T", e))
}

func parseTable(path string) parsed {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, nil, 0)
	if err != nil {
		panic(err)
	}
	var p parsed
	p.table = map[int]uint64{}
	for _, decl := range f.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gd.Specs {
			vs, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			name := vs.Names[0].Name
			switch {
			case gd.Tok == token.CONST && name == "hash0":
				p.hash0 = intLit(vs.Values[0])
			case gd.Tok == token.CONST && name == "maxAtomLen":
				p.maxAtomLen = intLit(vs.Values[0])
			case gd.Tok == token.CONST && name == "atomText":
				p.atomText = concatText(vs.Values[0])
			case gd.Tok == token.CONST && vs.Type != nil:
				p.consts = append(p.consts, namedValue{name, intLit(vs.Values[0])})
			case gd.Tok == token.VAR && name == "table":
				// The array type sits on the composite literal: [1 << 9]Atom{...}.
				cl := vs.Values[0].(*ast.CompositeLit)
				at := cl.Type.(*ast.ArrayType)
				p.tableLen = evalLen(at.Len)
				for _, elt := range cl.Elts {
					kv := elt.(*ast.KeyValueExpr)
					idx := int(intLit(kv.Key))
					if _, dup := p.table[idx]; dup {
						panic("duplicate table index")
					}
					p.table[idx] = intLit(kv.Value)
				}
			}
		}
	}
	return p
}

// goToJS decodes the bytes of a Go string into the JavaScript string used by
// the TypeScript port: each invalid byte becomes one U+FFFD.
func goToJS(b []byte) string {
	var sb strings.Builder
	for i := 0; i < len(b); {
		r, size := utf8.DecodeRune(b[i:])
		if r == utf8.RuneError && size == 1 {
			sb.WriteRune(utf8.RuneError)
		} else {
			sb.WriteRune(r)
		}
		i += size
	}
	return sb.String()
}

func main() {
	p := parseTable(tableGoPath)

	// The constants of the real package must match table.go.
	if len(p.consts) != len(goConstRefs) {
		panic(fmt.Sprintf("constant count: table.go has %d, package refs %d", len(p.consts), len(goConstRefs)))
	}
	consts := make([]constant, 0, len(goConstRefs))
	for i, ref := range goConstRefs {
		if p.consts[i].name != ref.name || uint64(ref.value) != p.consts[i].value {
			panic(fmt.Sprintf("constant %s: table.go %s=%#x, package %#x", ref.name, p.consts[i].name, p.consts[i].value, ref.value))
		}
		consts = append(consts, constant{Name: ref.name, Value: uint32(ref.value), String: ref.value.String()})
	}
	// hash0, maxAtomLen and the table are unexported in the package; they are
	// only known from table.go and are written out for the TypeScript test.
	if p.tableLen != 512 {
		panic(fmt.Sprintf("table length %d", p.tableLen))
	}

	tableOut := map[string]uint32{}
	for idx, v := range p.table {
		tableOut[strconv.Itoa(idx)] = uint32(v)
	}

	counts := map[string]int{}
	var lookups []lookupVector
	var strs []stringVector

	addLookup := func(kind string, s []byte) {
		a := atom.Lookup(s)
		lookups = append(lookups, lookupVector{Kind: kind, Input: hex.EncodeToString(s), Atom: uint32(a)})
		counts[kind]++
	}
	addString := func(s []byte) {
		res := atom.String(s)
		strs = append(strs, stringVector{
			Input: hex.EncodeToString(s),
			GoHex: hex.EncodeToString([]byte(res)),
			JS:    goToJS([]byte(res)),
			Valid: utf8.Valid(s),
		})
	}

	// 1. Every atom's own text, its upper-case form, and one-edit variants.
	for _, c := range consts {
		text := c.String
		if text == "" {
			panic("atom with empty name: " + c.Name)
		}
		b := []byte(text)
		addLookup("atom", b)
		addString(b)
		addLookup("upper", []byte(strings.ToUpper(text)))
		for i := 0; i < len(text); i++ {
			v := []byte(text)
			switch {
			case v[i] >= 'a' && v[i] <= 'y':
				v[i]++
			case v[i] == 'z':
				v[i] = 'a'
			default:
				v[i] = 'x'
			}
			addLookup("variant", v)
		}
		addLookup("variant", append([]byte(text), 'x'))
		addLookup("variant", append([]byte(text), 'x', 'x'))
		addLookup("variant", []byte(text[:len(text)-1]))
		addLookup("variant", []byte(text[1:]))
		// The first letter upper-cased, the rest unchanged.
		addLookup("variant", []byte(strings.ToUpper(text[:1])+text[1:]))
	}

	rng := rand.New(rand.NewPCG(seedA, seedB))

	// 2. Other byte strings. Every one of them is also a String input.
	other := func(b []byte) {
		addLookup("other", b)
		addString(b)
	}
	other(nil)
	for i := 0; i < 256; i++ {
		other([]byte{byte(i)})
	}
	common := []string{
		"div", "span", "p", "a", "img", "table", "tr", "td", "th", "ul", "li", "ol",
		"custom-element", "my-tag", "x-foo", "svg:rect", "math:mi", "xlink:href", "xml:lang",
		"DIV", "Div", "SPAN", "P", "Body", "HTML", "NAV", "Article", "ONCLICK",
		"p ", " p", "p\x00", "\x00p", "di", "divv", "dix", "xdiv", "a\tb", "a\nb",
		"data-x", "aria-label", "role", "tabindex", "class ", "class\x00", "id=", "=id",
		"hreflang2", "h7", "h0", "h10", "onclick2", "onfoo", "ondragfoo", "on", "__proto__",
		"constructor", "toString", "valueOf", "hasOwnProperty", "length", "prototype",
		"0", "1", "123", "-", "--", "_", "a-", "-a", "a b", "A B", "%41", "\\u0041",
	}
	for _, s := range common {
		other([]byte(s))
	}
	for _, n := range []int{26, 27, 30, 50, 100, 1000} {
		other([]byte(strings.Repeat("a", n)))
		other([]byte(strings.Repeat("div", n/3+1))[:n])
		b := make([]byte, n)
		for i := range b {
			b[i] = byte('a' + rng.IntN(26))
		}
		other(b)
	}
	nonASCII := []string{
		"\xc3\xa9", "\xc3\xbc", "\xc3\x9f", "\xe6\x97\xa5\xe6\x9c\xac", "\xe6\xbc\xa2\xe5\xad\x97", "\xed\x95\x9c\xea\xb5\xad\xec\x96\xb4", "\xce\xa9", "\xc5\xbc",
		"\xf0\x9f\x98\x80", "\xf0\x9f\x91\x8d\xf0\x9f\x8f\xbd", "\xc2\xa0", "\xe2\x80\xa8", "\x64\xc3\xad\x76", "\x64\x69\xcc\x87\x76", "\xef\xbb\xbf\x64\x69\x76", "\x64\x69\x76\xe2\x80\x8b",
		"\xc4\xb0", "\xc5\xbf", "\xef\xac\x81", "\xe2\x84\xaa", "\x00\xc3\xa9", "\xc3\xa9\x00", "\xf4\x8f\xbf\xbf", "\xef\xbf\xbd",
		"\xc2\xad",
	}
	for _, s := range nonASCII {
		other([]byte(s))
	}
	invalid := [][]byte{
		{0x80}, {0xbf}, {0xc0, 0x80}, {0xc1, 0xbf}, {0xe0, 0x80, 0x80}, {0xed, 0xa0, 0x80},
		{0xf4, 0x90, 0x80, 0x80}, {0xf5, 0x80, 0x80, 0x80}, {0xff}, {0xfe, 0xff},
		{'d', 'i', 0xc3}, {'d', 0xc3, 'v'}, {0xe2, 0x82}, {0xf0, 0x9f, 0x98}, {'d', 'i', 'v', 0xff},
		{0xc3, 0xa9, 0xff, 'a'}, {0xed, 0xbf, 0xbf}, {0xf0, 0x80, 0x80, 0x80},
		{'a', 0x00, 0xff}, {0x9f, 0xbf, 0xbf, 0xbf}, {0xe0, 0xa0}, {0xf0, 0x90, 0x80},
		{0xc3}, {0xe0}, {0xf0},
	}
	for _, b := range invalid {
		other(b)
	}
	for i := 0; i < 1200; i++ {
		b := make([]byte, rng.IntN(41))
		for j := range b {
			b[j] = byte(rng.UintN(256))
		}
		other(b)
	}
	const atomAlphabet = "abcdefghijklmnopqrstuvwxyz-"
	for i := 0; i < 600; i++ {
		n := 1 + rng.IntN(12)
		b := make([]byte, n)
		for j := range b {
			b[j] = atomAlphabet[rng.IntN(len(atomAlphabet))]
		}
		other(b)
	}

	out := output{
		GoVersion:  runtime.Version(),
		Hash0:      uint32(p.hash0),
		MaxAtomLen: int(p.maxAtomLen),
		TableLen:   p.tableLen,
		Table:      tableOut,
		AtomText:   p.atomText,
		Counts:     counts,
		Constants:  consts,
		Lookup:     lookups,
		String:     strs,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		panic(err)
	}
}
