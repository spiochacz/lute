package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"unicode/utf8"

	"github.com/88250/lute/render"
)

func must(s string) string {
	if !utf8.ValidString(s) {
		panic("invalid UTF-8 in vector: " + fmt.Sprintf("%q", s))
	}
	return s
}

// try runs f and reports whether it panicked.
func try(f func()) (panicked bool) {
	defer func() {
		if r := recover(); nil != r {
			panicked = true
		}
	}()
	f()
	return
}

func write(name string, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); nil != err {
		panic(err)
	}
	out := filepath.Join("..", "..", "src", "render", "testdata", name)
	if err := os.WriteFile(out, buf.Bytes(), 0o644); nil != err {
		panic(err)
	}
	fmt.Printf("%s: %d bytes\n", out, buf.Len())
}

func main() {
	rnd := rand.New(rand.NewSource(20260101))
	write("render_vectors.json", genPlain(rnd))
	write("render_tree_vectors.json", genTrees(rnd))
	write("render_e2e_vectors.json", genE2E())
}

func sortedKeys(m map[string]string) []string {
	var ret []string
	for k := range m {
		ret = append(ret, k)
	}
	sort.Strings(ret)
	return ret
}

func newRenderOptions() *render.Options {
	return render.NewOptions()
}

func newBaseRenderer(o *render.Options) *render.BaseRenderer {
	return render.NewBaseRenderer(nil, o, nil)
}
