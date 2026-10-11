// Command gen-render-exportmd-vectors runs the real Go ProtyleExportMdRenderer over a corpus of Markdown documents. Every document is parsed in Go
// under a Protyle parse option set (ast.Testing = true), optionally flattened to text marks, and rendered with NewProtyleExportMdRenderer under
// several render option sets. ts/test/e2e/renderers/protyle_export_md.test.ts does the same with the port and compares.
//
// Usage (from this directory): go run -tags javascript .
// writes ../../test/e2e/renderers/testdata/exportmd_corpus.json and exportmd_vectors_<n>.json
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
)

type parseSet struct {
	Name    string         `json:"name"`
	Opts    map[string]any `json:"opts"`
	Flatten bool           `json:"flatten"`
}

type renderSet struct {
	Name      string         `json:"name"`
	Opts      map[string]any `json:"opts"`
	StdPrep   bool           `json:"stdPrep"`   // what BlockDOM2StdMd does to the tree before rendering: empty IAL tokens, remove zwsp
	RoundTrip bool           `json:"roundTrip"` // render again the parse of the output
}

var protyleBase = map[string]any{
	"ProtyleWYSIWYG": true, "KramdownBlockIAL": true, "KramdownSpanIAL": true, "BlockRef": true, "FileAnnotationRef": true, "Tag": true, "SuperBlock": true,
	"Mark": true, "Sup": true, "Sub": true, "GitConflict": true, "TextMark": true, "Callout": true, "Tabs": true, "InlineMath": true,
	"ImgPathAllowSpace": true, "InlineMathAllowDigitAfterOpenMarker": true, "ArbitraryTaskListItemMarker": true, "HTMLTag2TextMark": true,
	"CustomBlock": true, "ParagraphBeginningSpace": true,
}

func merge(a, b map[string]any) map[string]any {
	ret := map[string]any{}
	for k, v := range a {
		ret[k] = v
	}
	for k, v := range b {
		ret[k] = v
	}
	return ret
}

var parseSets = []parseSet{
	{"protyle", protyleBase, false},
	{"protyle-flat", protyleBase, true},
	{"protyle-real", merge(protyleBase, map[string]any{"Footnotes": false, "ToC": false, "IndentCodeBlock": false, "HeadingID": false, "Setext": false, "YamlFrontMatter": false, "LinkRef": false}), true},
	{"plain", map[string]any{
		"Mark": true, "Sup": true, "Sub": true, "Tag": true, "InlineMath": true, "BlockRef": true, "FileAnnotationRef": true, "ToC": true, "HeadingID": true,
		"SuperBlock": true, "Callout": true, "Tabs": true, "GitConflict": true, "CustomBlock": true,
	}, false},
	{"protyle-alt", merge(protyleBase, map[string]any{"Sub": false, "GFMStrikethrough1": true, "FullWidthStrikethrough": true, "EmojiSite": "http://e.x/emoji"}), false},
	{"plain-flat", map[string]any{
		"Mark": true, "Sup": true, "Sub": true, "Tag": true, "InlineMath": true, "TextMark": true, "HTMLTag2TextMark": true, "Callout": true,
	}, true},
}

var renderSets = []renderSet{
	{"kramdown", map[string]any{"KramdownBlockIAL": true, "KramdownSpanIAL": true, "ProtyleWYSIWYG": true, "SuperBlock": true}, false, true},
	{"stdmd", map[string]any{
		"AutoSpace": false, "FixTermTypo": false, "KramdownBlockIAL": true, "KramdownSpanIAL": true, "KeepParagraphBeginningSpace": true,
		"OmitTableCellIAL": true, "TabsMarkdown": true,
	}, true, false},
	{"plain", map[string]any{}, false, true},
	{"plain-omit", map[string]any{"OmitTableCellIAL": true}, false, false},
	{"tabsmd", map[string]any{"KramdownBlockIAL": true, "KramdownSpanIAL": true, "TabsMarkdown": true, "ProtyleWYSIWYG": true}, false, false},
	{"tabsmd-plain", map[string]any{"TabsMarkdown": true}, false, false},
	{"no-normalize", map[string]any{"KramdownBlockIAL": true, "KramdownSpanIAL": true, "ProtyleWYSIWYG": true, "ExportNormalizeTaskListMarker": false}, false, false},
	{"keepspace", map[string]any{"KeepParagraphBeginningSpace": true}, false, false},
	{"dash", map[string]any{"KramdownBlockIAL": true, "KramdownSpanIAL": true, "ProtyleWYSIWYG": true, "UnorderedListMarker": "-"}, false, false},
	{"wysiwyg-off", map[string]any{"KramdownBlockIAL": true, "KramdownSpanIAL": true, "ProtyleWYSIWYG": false}, false, false},
	{"autospace", map[string]any{"AutoSpace": true, "FixTermTypo": true, "KramdownBlockIAL": true, "KramdownSpanIAL": true, "ProtyleWYSIWYG": true}, false, false},
	{"misc", map[string]any{"SoftBreak2HardBreak": false, "ChineseParagraphBeginningSpace": true, "ImgTag": true, "PreventEncodeLinkSpace": true, "LinkBase": "http://b/", "LinkPrefix": "/p"}, false, false},
	{"span-only", map[string]any{"KramdownSpanIAL": true}, false, false},
	{"block-only", map[string]any{"KramdownBlockIAL": true}, false, false},
	{"plain-autospace", map[string]any{"AutoSpace": true, "FixTermTypo": true, "ImgTag": true, "SoftBreak2HardBreak": false}, false, false},
}

func setByName(v any, opts map[string]any) {
	rv := reflect.ValueOf(v).Elem()
	for k, val := range opts {
		f := rv.FieldByName(k)
		if !f.IsValid() {
			panic("unknown option " + k)
		}
		switch x := val.(type) {
		case bool:
			f.SetBool(x)
		case string:
			f.SetString(x)
		default:
			panic("unsupported option value for " + k)
		}
	}
}

func psIndex(name string) int {
	for i, p := range parseSets {
		if p.Name == name {
			return i
		}
	}
	panic(name)
}

func rsIndex(name string) int {
	for i, r := range renderSets {
		if r.Name == name {
			return i
		}
	}
	panic(name)
}

type vecCase struct {
	D  int     `json:"d"`            // doc index
	P  int     `json:"p"`            // parse set
	R  int     `json:"r"`            // render set
	Th bool    `json:"th,omitempty"` // the render panicked
	O  *string `json:"o,omitempty"`  // output (short)
	H  string  `json:"h,omitempty"`  // sha256 of the output (long)
	N  int     `json:"n"`            // byte length of the output
	// round trip: the output of rendering the parse of the output
	RT *rtResult `json:"rt,omitempty"`
}

type rtResult struct {
	Same bool    `json:"same"`
	Th   bool    `json:"th,omitempty"`
	O    *string `json:"o,omitempty"`
	H    string  `json:"h,omitempty"`
	N    int     `json:"n"`
}

const rawLimit = 300

var invalidOutputs int

func pack(out string) (o *string, h string, n int) {
	if !utf8.ValidString(out) {
		invalidOutputs++
	}
	n = len(out)
	if len(out) <= rawLimit {
		s := out
		return &s, "", n
	}
	sum := sha256.Sum256([]byte(out))
	return nil, hex.EncodeToString(sum[:]), n
}

func renderOnce(md []byte, ps parseSet, rs renderSet) (out string, panicked bool) {
	defer func() {
		if r := recover(); nil != r {
			panicked = true
			out = ""
		}
	}()
	ast.Testing = true
	// parse.Parse (lex.Lexer.NextLine) rewrites a CR in the caller's buffer to LF, so every parse gets its own copy
	md = append([]byte(nil), md...)
	po := parse.NewOptions()
	setByName(po, ps.Opts)
	tree := parse.Parse("", md, po)
	if ps.Flatten {
		parse.NestedInlines2FlattedSpans(tree, true)
	}
	if rs.StdPrep {
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			if ast.NodeKramdownBlockIAL == n.Type || ast.NodeKramdownSpanIAL == n.Type {
				n.Tokens = nil
			}
			return ast.WalkContinue
		})
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering {
				n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(editor.Zwsp), nil)
				n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, editor.Zwsp, "")
			}
			return ast.WalkContinue
		})
	}
	ro := render.NewOptions()
	setByName(ro, rs.Opts)
	out = string(render.NewProtyleExportMdRenderer(tree, ro, po).Render())
	return
}

// render renders three times: the "text" text mark type iterates a Go map, so an unstable case is dropped.
func renderStable(md []byte, ps parseSet, rs renderSet) (out string, panicked, stable bool) {
	out, panicked = renderOnce(md, ps, rs)
	for i := 0; i < 4; i++ {
		o2, p2 := renderOnce(md, ps, rs)
		if o2 != out || p2 != panicked {
			return "", false, false
		}
	}
	return out, panicked, true
}

func main() {
	docs := allDocs()
	if dump := os.Getenv("EXPORTMD_DUMP"); "" != dump {
		// debugging aid: EXPORTMD_DUMP=<doc>:<parse set>:<render set>:<out file> writes one raw output
		parts := strings.SplitN(dump, ":", 4)
		var di int
		fmt.Sscan(parts[0], &di)
		d := docs[di]
		var b []byte
		if "" != d.File {
			b, _ = os.ReadFile(filepath.Join("..", "..", "..", d.File))
			if 0 < d.Lines {
				lines := strings.SplitAfter(string(b), "\n")
				b = []byte(strings.Join(lines[:d.Lines], ""))
			}
		} else {
			b = []byte(d.Markdown)
		}
		if "" != os.Getenv("EXPORTMD_WARM") {
			for wi := 0; wi < di; wi++ {
				wd := docs[wi]
				if "" != wd.File {
					continue
				}
				renderOnce([]byte(wd.Markdown), parseSets[psIndex(parts[1])], renderSets[rsIndex(parts[2])])
			}
		}
		switch os.Getenv("EXPORTMD_PRE") {
		case "k":
			renderOnce(b, parseSets[0], renderSets[rsIndex("kramdown")])
		case "kr":
			o1, _ := renderOnce(b, parseSets[0], renderSets[rsIndex("kramdown")])
			renderOnce([]byte(o1), parseSets[0], renderSets[rsIndex("kramdown")])
		}
		out, _ := renderOnce(b, parseSets[psIndex(parts[1])], renderSets[rsIndex(parts[2])])
		os.WriteFile(parts[3], []byte(out), 0o644)
		return
	}
	nFileStart := len(docs) - len(fileDocs())
	mds := make([][]byte, len(docs))
	for i, d := range docs {
		if "" != d.File {
			b, err := os.ReadFile(filepath.Join("..", "..", "..", d.File))
			if nil != err {
				panic(err)
			}
			if 0 < d.Lines {
				lines := strings.SplitAfter(string(b), "\n")
				if len(lines) > d.Lines {
					lines = lines[:d.Lines]
				}
				b = []byte(strings.Join(lines, ""))
			}
			mds[i] = b
		} else {
			mds[i] = []byte(d.Markdown)
		}
	}

	type combo struct{ p, r string }
	var cases []vecCase
	unstable, panics, roundTrips, roundSame := 0, 0, 0, 0
	docPanics := map[string]int{}
	for i := range docs {
		if from := os.Getenv("EXPORTMD_FROM"); "" != from {
			var fi int
			fmt.Sscan(from, &fi)
			if i < fi {
				continue
			}
		}
		var combos []combo
		if i >= nFileStart {
			for _, p := range []string{"protyle", "plain"} {
				for _, r := range []string{"kramdown", "plain", "stdmd"} {
					combos = append(combos, combo{p, r})
				}
			}
		} else {
			for _, r := range []string{"kramdown", "stdmd", "plain", "plain-omit", "tabsmd", "tabsmd-plain"} {
				combos = append(combos, combo{"protyle", r})
			}
			combos = append(combos, combo{"protyle-flat", "kramdown"}, combo{"protyle-flat", "plain"})
			if 0 == i%2 {
				combos = append(combos, combo{"protyle-real", "kramdown"}, combo{"protyle-real", "plain"})
			}
			combos = append(combos, combo{"plain", "plain"}, combo{"plain", "wysiwyg-off"})
			if 0 == i%3 {
				combos = append(combos, combo{"plain-flat", "plain"}, combo{"plain-flat", "stdmd"})
			}
			extra := []string{"no-normalize", "keepspace", "dash", "wysiwyg-off", "autospace", "misc", "span-only", "block-only", "plain-autospace"}
			if docs[i].Alt || 0 == i%4 {
				combos = append(combos, combo{"protyle-alt", "kramdown"}, combo{"protyle-alt", "plain"})
			}
			if docs[i].Alt {
				combos = append(combos, combo{"protyle-alt", "stdmd"}, combo{"protyle-alt", "autospace"})
			}
			combos = append(combos, combo{"protyle", extra[i%len(extra)]}, combo{"protyle-flat", extra[(i+4)%len(extra)]})
		}
		for _, c := range combos {
			ps, rs := parseSets[psIndex(c.p)], renderSets[rsIndex(c.r)]
			out, panicked, stable := renderStable(mds[i], ps, rs)
			if tr := os.Getenv("EXPORTMD_TRACE"); "" != tr && fmt.Sprint(i, ":", c.p, ":", c.r) == tr[:strings.Index(tr, "=")] {
				os.WriteFile(tr[strings.Index(tr, "=")+1:], []byte(out), 0o644)
			}
			if !stable {
				unstable++
				continue
			}
			vc := vecCase{D: i, P: psIndex(c.p), R: rsIndex(c.r), Th: panicked}
			if panicked {
				panics++
				docPanics[c.p+"/"+c.r]++
			} else {
				vc.O, vc.H, vc.N = pack(out)
				if rs.RoundTrip {
					roundTrips++
					out2, p2 := renderOnce([]byte(out), ps, rs)
					rt := &rtResult{Same: !p2 && out2 == out, Th: p2}
					if !p2 {
						rt.O, rt.H, rt.N = pack(out2)
					}
					if rt.Same {
						roundSame++
					}
					vc.RT = rt
				}
			}
			cases = append(cases, vc)
		}
	}

	dir := filepath.Join("..", "..", "test", "e2e", "renderers", "testdata")
	if err := os.MkdirAll(dir, 0o755); nil != err {
		panic(err)
	}
	writeJSON(filepath.Join(dir, "exportmd_corpus.json"), map[string]any{
		"goVersion": runtime.Version(), "docs": docs, "parseSets": parseSets, "renderSets": renderSets,
	})
	trees, treePanics := genTrees()
	for ti, size, start := 0, 0, 0; ti <= len(trees); ti++ {
		if ti < len(trees) {
			b, _ := json.Marshal(trees[ti])
			if size+len(b) < 1_200_000 {
				size += len(b) + 1
				continue
			}
		}
		writeJSON(filepath.Join(dir, fmt.Sprintf("exportmd_trees_%d.json", start)), trees[start:ti])
		start, size = ti, 0
		if ti < len(trees) {
			b, _ := json.Marshal(trees[ti])
			size = len(b) + 1
		}
	}
	fmt.Printf("trees=%d treePanics=%d unstableTrees(dropped)=%d\n", len(trees), treePanics, unstableTrees)
	// chunk the cases, each file below about 1.2 MB
	var chunk []vecCase
	size, n := 0, 0
	flush := func() {
		if 0 == len(chunk) {
			return
		}
		writeJSON(filepath.Join(dir, fmt.Sprintf("exportmd_vectors_%d.json", n)), chunk)
		n++
		chunk = nil
		size = 0
	}
	for _, c := range cases {
		b, _ := json.Marshal(c)
		if size+len(b) > 1_200_000 {
			flush()
		}
		chunk = append(chunk, c)
		size += len(b) + 1
	}
	flush()

	var keys []string
	for k := range docPanics {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Printf("invalid UTF-8 outputs: %d\n", invalidOutputs)
	fmt.Printf("docs=%d cases=%d unstable(dropped)=%d panics=%d roundTrips=%d roundTripIdempotent=%d\n", len(docs), len(cases), unstable, panics, roundTrips, roundSame)
	for _, k := range keys {
		fmt.Printf("  panics %s: %d\n", k, docPanics[k])
	}
}

func writeJSON(path string, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); nil != err {
		panic(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); nil != err {
		panic(err)
	}
	fmt.Printf("%s: %d bytes\n", path, buf.Len())
}
