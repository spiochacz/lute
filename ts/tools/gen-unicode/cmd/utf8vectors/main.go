// Command utf8vectors writes Go's unicode/utf8 results as JSON test vectors
// for ts/src/runtime/utf8.test.ts.
//
// Run from ts/tools/gen-unicode:
//
//	go run ./cmd/utf8vectors -out ../../src/runtime/testdata/utf8_vectors.json
package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"log"
	"math/rand"
	"os"
	"runtime"
	"unicode/utf8"
)

const maxRune = 0x10FFFF

type byteVector struct {
	Hex        string `json:"hex"`
	DecodeRune [2]int `json:"decodeRune"`
	DecodeLast [2]int `json:"decodeLast"`
	Valid      bool   `json:"valid"`
	RuneCount  int    `json:"runeCount"`
	FullRune   bool   `json:"fullRune"`
}

type stringVector struct {
	CodeUnits []int `json:"codeUnits"` // UTF-16 code units of a JS string
	ByteLen   int   `json:"byteLen"`   // len(string) in Go, lone surrogates count as 3
	RuneCount int   `json:"runeCount"` // utf8.RuneCountInString in Go, lone surrogates count as 1
}

type encodeChecksum struct {
	Checksum uint32 `json:"checksum"`
	Count    int    `json:"count"`
}

type output struct {
	GoVersion string         `json:"goVersion"`
	Vectors   []byteVector   `json:"vectors"`
	Strings   []stringVector `json:"strings"`
	Encode    encodeChecksum `json:"encode"`
}

func fnvByte(h uint32, b byte) uint32 {
	h ^= uint32(b)
	return h * 16777619
}

func fnvWord(h uint32, v uint32) uint32 {
	for i := 0; i < 4; i++ {
		h = fnvByte(h, byte(v>>(8*i)))
	}
	return h
}

func makeVector(b []byte) byteVector {
	r, n := utf8.DecodeRune(b)
	lr, ln := utf8.DecodeLastRune(b)
	return byteVector{
		Hex:        hex.EncodeToString(b),
		DecodeRune: [2]int{int(r), n},
		DecodeLast: [2]int{int(lr), ln},
		Valid:      utf8.Valid(b),
		RuneCount:  utf8.RuneCount(b),
		FullRune:   utf8.FullRune(b),
	}
}

func main() {
	outPath := flag.String("out", "../../src/runtime/testdata/utf8_vectors.json", "output JSON file")
	flag.Parse()

	seen := map[string]bool{}
	var vectors []byteVector
	add := func(b []byte) {
		k := hex.EncodeToString(b)
		if seen[k] {
			return
		}
		seen[k] = true
		vectors = append(vectors, makeVector(b))
	}

	// Every single byte value, plus the empty input.
	add(nil)
	for v := 0; v < 256; v++ {
		add([]byte{byte(v)})
	}

	// Hand-picked sequences: overlongs, surrogates, out-of-range, invalid leads.
	fixed := [][]byte{
		{0xC0, 0x80}, {0xC1, 0xBF}, {0xC2, 0x80}, {0xC2, 0xC0}, {0xC2, 0x41},
		{0xE0, 0x80, 0x80}, {0xE0, 0x9F, 0xBF}, {0xE0, 0xA0, 0x80}, {0xE0, 0xA0, 0x41},
		{0xED, 0x9F, 0xBF}, {0xED, 0xA0, 0x80}, {0xED, 0xBF, 0xBF}, {0xEE, 0x80, 0x80},
		{0xEF, 0xBF, 0xBD}, {0xEF, 0xBF, 0xBE}, {0xE2, 0x82, 0xAC}, {0xE2, 0x82, 0xAC, 0x41},
		{0xE2, 0x82},
		{0xF0, 0x80, 0x80, 0x80}, {0xF0, 0x8F, 0xBF, 0xBF}, {0xF0, 0x90, 0x80, 0x80},
		{0xF0, 0x9F, 0x98, 0x80}, {0xF0, 0x9F, 0x98}, {0xF0, 0x9F},
		{0xF4, 0x8F, 0xBF, 0xBF}, {0xF4, 0x90, 0x80, 0x80}, {0xF4, 0x8F, 0xBF, 0x41},
		{0xF5, 0x80, 0x80, 0x80}, {0xF7, 0xBF, 0xBF, 0xBF}, {0xF8, 0x88, 0x80, 0x80, 0x80},
		{0xFB, 0xBF, 0xBF, 0xBF, 0xBF}, {0xFC, 0x84, 0x80, 0x80, 0x80, 0x80},
		{0xFE}, {0xFF}, {0xFF, 0xFF, 0xFF, 0xFF}, {0x80}, {0xBF}, {0x80, 0x80},
		{0x41, 0x80}, {0x41, 0x42, 0xC3, 0xA9}, {0xC3, 0xA9, 0x41},
		{0xF0, 0x9F, 0x98, 0x80, 0xF0, 0x9F, 0x98, 0x80},
	}
	for _, b := range fixed {
		add(b)
		// Every proper prefix (truncated sequences).
		for n := 1; n < len(b); n++ {
			add(b[:n])
		}
	}

	// Deterministic random sequences built from interesting bytes and uniform bytes.
	interesting := []byte{0x00, 0x41, 0x7F, 0x80, 0x8F, 0x90, 0x9F, 0xA0, 0xBF, 0xC0, 0xC1, 0xC2, 0xDF, 0xE0, 0xED, 0xEF, 0xF0, 0xF4, 0xF5, 0xFF}
	rng := rand.New(rand.NewSource(1))
	for i := 0; i < 300; i++ {
		n := 1 + rng.Intn(5)
		b := make([]byte, n)
		for j := range b {
			if rng.Intn(2) == 0 {
				b[j] = interesting[rng.Intn(len(interesting))]
			} else {
				b[j] = byte(rng.Intn(256))
			}
		}
		add(b)
	}

	// JS string adaptation checks. The cases are UTF-16 code units, as in a JS
	// string. A high surrogate directly followed by a low surrogate is one code
	// point; any other surrogate is lone and becomes U+FFFD in Go (3 bytes).
	var strs []stringVector
	strCases := [][]int{
		{}, {0x41}, {0x7F, 0x80, 0x7FF, 0x800, 0xFFFF}, {0xD800, 0xDC00}, {0xDBFF, 0xDFFF},
		{0xD800}, {0xDBFF}, {0xDC00}, {0xDFFF}, {0xD800, 0x41}, {0x41, 0xDFFF},
		{0xDC00, 0xD800}, {0xD83D, 0xDE00}, {0xDE00, 0xD83D}, {0xD800, 0xD800, 0xDC00},
		{0x4E2D, 0x6587, 0xD83D, 0xDE00, 0x41, 0xE000},
	}
	for i := 0; i < 200; i++ {
		n := rng.Intn(8)
		units := make([]int, n)
		for j := range units {
			switch rng.Intn(4) {
			case 0:
				units[j] = 0xD800 + rng.Intn(0x800) // surrogates, paired or lone
			case 1:
				units[j] = rng.Intn(0x80)
			case 2:
				units[j] = 0xD800 + rng.Intn(0x400) // high surrogate
			default:
				units[j] = rng.Intn(0x10000)
			}
		}
		strCases = append(strCases, units)
	}
	for _, units := range strCases {
		var s []rune
		for i := 0; i < len(units); i++ {
			u := units[i]
			if u >= 0xD800 && u <= 0xDBFF && i+1 < len(units) && units[i+1] >= 0xDC00 && units[i+1] <= 0xDFFF {
				s = append(s, rune((u-0xD800)<<10|(units[i+1]-0xDC00))+0x10000)
				i++
				continue
			}
			s = append(s, rune(u))
		}
		goStr := string(s) // Go replaces lone surrogates with U+FFFD
		strs = append(strs, stringVector{
			CodeUnits: units,
			ByteLen:   len(goStr),
			RuneCount: utf8.RuneCountInString(goStr),
		})
	}

	// EncodeRune and RuneLen over every code point. The checksum is FNV-1a over
	// the bytes EncodeRune writes followed by the 4 little-endian bytes of
	// RuneLen(r), for r = 0..MaxRune in order.
	h := uint32(2166136261)
	buf := make([]byte, utf8.UTFMax)
	for r := 0; r <= maxRune; r++ {
		n := utf8.EncodeRune(buf, rune(r))
		for _, b := range buf[:n] {
			h = fnvByte(h, b)
		}
		h = fnvWord(h, uint32(int32(utf8.RuneLen(rune(r)))))
	}

	out := output{
		GoVersion: runtime.Version(),
		Vectors:   vectors,
		Strings:   strs,
		Encode:    encodeChecksum{Checksum: h, Count: maxRune + 1},
	}
	data, err := json.MarshalIndent(out, "", " ")
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*outPath, append(data, '\n'), 0o644); err != nil {
		log.Fatal(err)
	}
	log.Printf("wrote %d byte vectors, %d string vectors to %s", len(vectors), len(strs), *outPath)
}
