// Command gen-bytes-vectors runs Go's real bytes package (and Go slice
// semantics) on a fixed corpus and writes the results as JSON. The TypeScript
// port in ts/src/runtime/bytes.ts and slices.ts is asserted against this file.
//
// Usage (from this directory):
//
//	GOTOOLCHAIN=local go run . -out ../../src/runtime/testdata/bytes_vectors.json
package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"runtime"
	"sort"
	"unicode/utf8"
)

const seed = 20260610

// maxCases caps the number of sampled input tuples per function.
const maxCases = 150

// pool is the byte-slice corpus. Raw bytes are written with \x escapes so
// invalid UTF-8 is kept as is.
var pool = []string{
	"", "a", "ab", "abc", "aa", "aaa", "aaaa", "abab", "ababa", "banana", "x",
	"a b", " ", "\t\n\v\f\r ", "  x  ", "\u0085", "x\u0085", "\u0085x\u0085",
	" x", "x ", "　a　", " 　 ",
	"中", "中文字符", "😀", "a😀b", "😀😃😀", "é", "ÉCOLE", "Hello, World", "HELLO",
	"ǅǈ", "ſKK", "ß",
	"\xff", "\x80", "ab\xffcd", "a\xe4\xb8", "\xe4\xb8\x96\xe7", "\xc3", "\xf0\x9f\x98",
	"x\xff\xffx", "\xef\xbf\xbd", "a\x00b", "0123456789", "# 标题\n\n段落 **bold**",
}

// seps is the separator / needle corpus (includes the empty separator).
var seps = []string{
	"", "a", "ab", "aa", "b", " ", "\n", "中", "😀", "é", "--", "\xff", "\xe4",
	"\u0085", "　", "ba", "aba",
}

// newBytes is the replacement corpus for Replace / ReplaceAll.
var newBytes = []string{"", "X", "XY", "中", "\xff", "ab", " "}

// strArgs is the corpus for Go string arguments (cutset / chars). These are
// JS strings on the TypeScript side, so they must be valid UTF-8.
var strArgs = []string{
	"", "a", "ab", "b", " ", "\u0085", " ", "　", "中", "😀", "é", "�",
	"xyz", "\t\n", "ba", "  　", "a\u0085",
}

// nArgs covers the n-taking functions.
var nArgs = []int{-1, 0, 1, 2, 100}

// byteArgs covers the single-byte argument of IndexByte / LastIndexByte.
var byteArgs = []byte{'a', 'b', ' ', '\n', 0x00, 0x80, 0xc0, 0xe4, 0xff, 'x', '0'}

func hx(b []byte) string { return hex.EncodeToString(b) }

// bs converts a corpus of strings to []any holding []byte values.
func bs(xs []string) []any {
	out := make([]any, 0, len(xs))
	for _, x := range xs {
		out = append(out, []byte(x))
	}
	return out
}

// ss converts a corpus of strings to []any holding string values.
func ss(xs []string) []any {
	out := make([]any, 0, len(xs))
	for _, x := range xs {
		out = append(out, x)
	}
	return out
}

func ints(xs []int) []any {
	out := make([]any, 0, len(xs))
	for _, x := range xs {
		out = append(out, x)
	}
	return out
}

func bytesList(xs []byte) []any {
	out := make([]any, 0, len(xs))
	for _, x := range xs {
		out = append(out, x)
	}
	return out
}

// cross returns the cartesian product of the lists as argument tuples.
func cross(ls ...[]any) [][]any {
	out := [][]any{{}}
	for _, l := range ls {
		var next [][]any
		for _, t := range out {
			for _, v := range l {
				nt := append(append([]any{}, t...), v)
				next = append(next, nt)
			}
		}
		out = next
	}
	return out
}

// sample keeps at most maxCases tuples, chosen with the shared seeded RNG.
func sample(rng *rand.Rand, all [][]any) [][]any {
	if len(all) <= maxCases {
		return all
	}
	idx := rng.Perm(len(all))[:maxCases]
	sort.Ints(idx)
	out := make([][]any, 0, maxCases)
	for _, i := range idx {
		out = append(out, all[i])
	}
	return out
}

type cutRet struct {
	after []byte
	found bool
}

// run calls f and reports whether Go panicked.
func run(f func() any) (res any, panicked bool) {
	defer func() {
		if recover() != nil {
			res = nil
			panicked = true
		}
	}()
	return f(), false
}

func encArg(v any) any {
	switch x := v.(type) {
	case []byte:
		return hx(x)
	case string:
		return x
	case int:
		return x
	case byte:
		return int(x)
	}
	panic(fmt.Sprintf("encArg: unexpected %T", v))
}

// encRet returns the JSON form of a result and whether Go returned nil.
func encRet(v any) (any, bool) {
	switch x := v.(type) {
	case []byte:
		return hx(x), x == nil
	case [][]byte:
		list := make([]string, len(x))
		for i, e := range x {
			list[i] = hx(e)
		}
		return list, x == nil
	case cutRet:
		return map[string]any{"after": hx(x.after), "found": x.found}, false
	case bool:
		return x, false
	case int:
		return x, false
	}
	panic(fmt.Sprintf("encRet: unexpected %T", v))
}

// Case is one recorded call. Ret is absent when Go panicked.
type Case struct {
	Args  []any `json:"args"`
	Ret   any   `json:"ret,omitempty"`
	Nil   bool  `json:"nil,omitempty"`
	Panic bool  `json:"panic,omitempty"`
}

type spec struct {
	name   string
	combos [][]any
	call   func(a []any) any
}

func specs(rng *rand.Rand) []spec {
	var out []spec
	add := func(name string, combos [][]any, call func(a []any) any) {
		out = append(out, spec{name, sample(rng, combos), call})
	}
	B := func(v any) []byte { return v.([]byte) }

	add("ReplaceAll", cross(bs(pool), bs(seps), bs(newBytes)), func(a []any) any {
		return bytes.ReplaceAll(B(a[0]), B(a[1]), B(a[2]))
	})
	add("Replace", cross(bs(pool), bs(seps), bs(newBytes), ints(nArgs)), func(a []any) any {
		return bytes.Replace(B(a[0]), B(a[1]), B(a[2]), a[3].(int))
	})
	add("HasPrefix", cross(bs(pool), bs(pool)), func(a []any) any { return bytes.HasPrefix(B(a[0]), B(a[1])) })
	add("HasSuffix", cross(bs(pool), bs(pool)), func(a []any) any { return bytes.HasSuffix(B(a[0]), B(a[1])) })
	add("TrimPrefix", cross(bs(pool), bs(seps)), func(a []any) any { return bytes.TrimPrefix(B(a[0]), B(a[1])) })
	add("TrimSuffix", cross(bs(pool), bs(seps)), func(a []any) any { return bytes.TrimSuffix(B(a[0]), B(a[1])) })
	add("CutPrefix", cross(bs(pool), bs(seps)), func(a []any) any {
		after, found := bytes.CutPrefix(B(a[0]), B(a[1]))
		return cutRet{after, found}
	})
	add("TrimSpace", cross(bs(pool)), func(a []any) any { return bytes.TrimSpace(B(a[0])) })
	add("Contains", cross(bs(pool), bs(seps)), func(a []any) any { return bytes.Contains(B(a[0]), B(a[1])) })
	add("Index", cross(bs(pool), bs(seps)), func(a []any) any { return bytes.Index(B(a[0]), B(a[1])) })
	add("LastIndex", cross(bs(pool), bs(seps)), func(a []any) any { return bytes.LastIndex(B(a[0]), B(a[1])) })
	add("Count", cross(bs(pool), bs(seps)), func(a []any) any { return bytes.Count(B(a[0]), B(a[1])) })
	add("Equal", cross(bs(pool), bs(pool)), func(a []any) any { return bytes.Equal(B(a[0]), B(a[1])) })
	add("EqualFold", cross(bs(pool), bs(pool)), func(a []any) any { return bytes.EqualFold(B(a[0]), B(a[1])) })
	add("Repeat", cross(bs(pool), ints([]int{-1, 0, 1, 2, 3, 7, 300})), func(a []any) any {
		return bytes.Repeat(B(a[0]), a[1].(int))
	})
	add("IndexByte", cross(bs(pool), bytesList(byteArgs)), func(a []any) any {
		return bytes.IndexByte(B(a[0]), a[1].(byte))
	})
	add("LastIndexByte", cross(bs(pool), bytesList(byteArgs)), func(a []any) any {
		return bytes.LastIndexByte(B(a[0]), a[1].(byte))
	})
	add("Split", cross(bs(pool), bs(seps)), func(a []any) any { return bytes.Split(B(a[0]), B(a[1])) })
	add("SplitAfter", cross(bs(pool), bs(seps)), func(a []any) any { return bytes.SplitAfter(B(a[0]), B(a[1])) })
	add("SplitN", cross(bs(pool), bs(seps), ints(nArgs)), func(a []any) any {
		return bytes.SplitN(B(a[0]), B(a[1]), a[2].(int))
	})
	add("ToLower", cross(bs(pool)), func(a []any) any { return bytes.ToLower(B(a[0])) })
	add("TrimLeft", cross(bs(pool), ss(strArgs)), func(a []any) any {
		return bytes.TrimLeft(B(a[0]), a[1].(string))
	})
	add("TrimRight", cross(bs(pool), ss(strArgs)), func(a []any) any {
		return bytes.TrimRight(B(a[0]), a[1].(string))
	})
	add("Trim", cross(bs(pool), ss(strArgs)), func(a []any) any {
		return bytes.Trim(B(a[0]), a[1].(string))
	})
	add("ContainsAny", cross(bs(pool), ss(strArgs)), func(a []any) any {
		return bytes.ContainsAny(B(a[0]), a[1].(string))
	})
	add("IndexAny", cross(bs(pool), ss(strArgs)), func(a []any) any {
		return bytes.IndexAny(B(a[0]), a[1].(string))
	})

	// Join: explicit edge lists first, then seeded random lists.
	var joinCombos [][]any
	joinCombos = append(joinCombos,
		[]any{[][]byte{}, []byte(",")},
		[]any{[][]byte{[]byte("a")}, []byte(", ")},
		[]any{[][]byte{[]byte(""), []byte("")}, []byte("")},
		[]any{[][]byte{[]byte("a"), []byte("")}, []byte("--")},
		[]any{[][]byte{[]byte("中"), []byte("\xff"), []byte("😀")}, []byte("")},
	)
	for i := 0; i < 150; i++ {
		k := rng.Intn(5)
		list := make([][]byte, k)
		for j := range list {
			list[j] = []byte(pool[rng.Intn(len(pool))])
		}
		joinCombos = append(joinCombos, []any{list, []byte(seps[rng.Intn(len(seps))])})
	}
	out = append(out, spec{"Join", joinCombos, func(a []any) any {
		return bytes.Join(a[0].([][]byte), B(a[1]))
	}})
	return out
}

// encodeArgs converts call arguments to their JSON form ([][]byte becomes a list of hex strings).
func encodeArgs(args []any) []any {
	out := make([]any, len(args))
	for i, a := range args {
		if list, ok := a.([][]byte); ok {
			ls := make([]string, len(list))
			for j, e := range list {
				ls[j] = hx(e)
			}
			out[i] = ls
			continue
		}
		out[i] = encArg(a)
	}
	return out
}

// bufSeq is one seeded sequence of bytes.Buffer operations.
type bufSeq struct {
	Ops    []map[string]any `json:"ops"`
	Bytes  string           `json:"bytes"`
	String string           `json:"string"`
	Len    int              `json:"len"`
}

// buildBufferSeqs replays seeded random operation sequences on bytes.Buffer.
func buildBufferSeqs(rng *rand.Rand) []bufSeq {
	var seqs []bufSeq
	// WriteString takes a JS string on the TypeScript side, so only valid UTF-8
	// is used here. Invalid bytes are written with the Write op instead.
	var validPool []string
	for _, p := range pool {
		if utf8.ValidString(p) {
			validPool = append(validPool, p)
		}
	}
	runes := []int{'a', 0xe9, 0x4e2d, 0x1f600, 0xd800, 0x110000, -1, 0xfffd, 0}
	for s := 0; s < 40; s++ {
		var buf bytes.Buffer
		var ops []map[string]any
		n := 1 + rng.Intn(12)
		for k := 0; k < n; k++ {
			var op map[string]any
			var panicked bool
			switch rng.Intn(7) {
			case 0:
				str := validPool[rng.Intn(len(validPool))]
				op = map[string]any{"op": "WriteString", "s": str}
				_, panicked = run(func() any { buf.WriteString(str); return nil })
			case 1:
				c := byteArgs[rng.Intn(len(byteArgs))]
				op = map[string]any{"op": "WriteByte", "c": int(c)}
				_, panicked = run(func() any { _ = buf.WriteByte(c); return nil })
			case 2:
				r := runes[rng.Intn(len(runes))]
				op = map[string]any{"op": "WriteRune", "r": r}
				_, panicked = run(func() any { buf.WriteRune(rune(r)); return nil })
			case 3:
				p := []byte(pool[rng.Intn(len(pool))])
				op = map[string]any{"op": "Write", "b": hx(p)}
				_, panicked = run(func() any { buf.Write(p); return nil })
			case 4:
				t := rng.Intn(buf.Len()+3) - 1 // -1 .. Len+1, out-of-range panics
				op = map[string]any{"op": "Truncate", "n": t}
				_, panicked = run(func() any { buf.Truncate(t); return nil })
			case 5:
				op = map[string]any{"op": "Reset"}
				_, panicked = run(func() any { buf.Reset(); return nil })
			case 6:
				g := rng.Intn(25) - 1 // -1 panics
				op = map[string]any{"op": "Grow", "n": g}
				_, panicked = run(func() any { buf.Grow(g); return nil })
			}
			op["panic"] = panicked
			ops = append(ops, op)
		}
		seqs = append(seqs, bufSeq{
			Ops:    ops,
			Bytes:  hx(buf.Bytes()),
			String: buf.String(),
			Len:    buf.Len(),
		})
	}
	return seqs
}

// sliceCase records the full underlying array (capacity) and a returned slice.
type sliceCase struct {
	Name string `json:"name"`
	Base string `json:"base"`
	Ret  string `json:"ret"`
}

// buildSliceCases runs the aliasing scenarios on real Go slices. Each one is
// independent of how append grows capacity beyond the existing array.
func buildSliceCases() []sliceCase {
	var out []sliceCase
	add := func(name string, base []byte, ret []byte) {
		out = append(out, sliceCase{name, hx(base), hx(ret)})
	}

	{
		s := make([]byte, 3, 10)
		copy(s, "abc")
		a := s[:1]
		a = append(a, 'x')
		add("append_within_cap_shares_array", s[:cap(s)], a)
	}
	{
		s := make([]byte, 3, 3)
		copy(s, "abc")
		t := append(s, 'x')
		t[0] = 'Z'
		add("append_beyond_cap_detaches", s[:cap(s)], t)
	}
	{
		s := mk("0123456789")
		s = append(s[:2], s[5:]...)
		add("delete_in_place", s[:cap(s)], s)
	}
	{
		s := mk("a1b2c3d4")
		tmp := s[:0]
		for _, c := range s {
			if c >= '0' && c <= '9' {
				tmp = append(tmp, c)
			}
		}
		add("filter_in_place_tmp_s0", s[:cap(s)], tmp)
	}
	{
		s := mk("abcdef")
		copy(s[2:], s[:4])
		add("copy_overlap_shift_right", s[:cap(s)], s)
	}
	{
		s := mk("abcdef")
		copy(s, s[2:])
		add("copy_overlap_shift_left", s[:cap(s)], s)
	}
	{
		s := make([]byte, 0, 8)
		a := append(s, 'a')
		b := append(s, 'b')
		_ = b
		add("two_appends_share_array", s[:cap(s)], a)
	}
	{
		s := make([]byte, 4, 8)
		a := s[1:3]
		a = append(a, 'q')
		add("append_sub_view_writes_tail", s[:cap(s)], a)
	}
	{
		s := make([]byte, 2, 8)
		copy(s, "hi")
		t := s[:6]
		add("reslice_past_len_exposes_bytes", s[:cap(s)], t)
	}
	{
		s := make([]byte, 0, 6)
		s = append(s, 'a', 'b')
		t := append(s, 'c')
		u := append(s, 'd')
		_ = u
		add("append_multiple_shared_tail", s[:cap(s)], t)
	}
	{
		s := mk("abcdefgh")
		s2 := append(s[:2], s[5:]...)
		add("delete_in_place_cap8", s[:cap(s)], s2)
	}
	{
		dst := make([]byte, 5)
		n := copy(dst[1:], "hello")
		add("copy_into_offset_returns_count", dst[:cap(dst)], []byte{byte('0' + n)})
	}
	return out
}

type output struct {
	Generator string            `json:"generator"`
	GoVersion string            `json:"goVersion"`
	Seed      int64             `json:"seed"`
	Functions map[string][]Case `json:"functions"`
	Buffer    []bufSeq          `json:"buffer"`
	Slices    []sliceCase       `json:"slices"`
}

func main() {
	outPath := flag.String("out", "bytes_vectors.json", "output JSON path")
	flag.Parse()

	rng := rand.New(rand.NewSource(seed))
	res := output{
		Generator: "ts/tools/gen-bytes-vectors",
		GoVersion: runtime.Version(),
		Seed:      seed,
		Functions: map[string][]Case{},
	}

	for _, sp := range specs(rng) {
		cases := make([]Case, 0, len(sp.combos))
		for _, args := range sp.combos {
			ret, panicked := run(func() any { return sp.call(args) })
			c := Case{Args: encodeArgs(args)}
			if panicked {
				c.Panic = true
			} else {
				c.Ret, c.Nil = encRet(ret)
			}
			cases = append(cases, c)
		}
		res.Functions[sp.name] = cases
		fmt.Fprintf(os.Stderr, "%-16s %4d cases\n", sp.name, len(cases))
	}

	res.Buffer = buildBufferSeqs(rng)
	fmt.Fprintf(os.Stderr, "%-16s %4d sequences\n", "Buffer", len(res.Buffer))

	res.Slices = buildSliceCases()
	fmt.Fprintf(os.Stderr, "%-16s %4d scenarios\n", "slices", len(res.Slices))

	data, err := json.MarshalIndent(res, "", " ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	data = append(data, '\n')
	if err := os.WriteFile(*outPath, data, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "wrote %s (%d bytes)\n", *outPath, len(data))
}

// mk returns a slice of exactly len(s) bytes. Go's []byte(s) conversion may
// round the capacity up to an allocator size class, so scenarios use this helper.
func mk(s string) []byte {
	b := make([]byte, len(s))
	copy(b, s)
	return b
}
