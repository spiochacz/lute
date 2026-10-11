package main

// Generator of the vectors for render.NewProtyleExportRenderer and render.NewProtyleExportDocxRenderer.
// Each Markdown document is parsed under the Protyle parse options and rendered with both renderers under several render option sets.
// A tree is rendered once only (the renderers modify the tree), so every render parses afresh.
// Output: ../../src/render/testdata/protyle_export_vectors.json
// Run: go run -tags javascript .

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
)

type optSet struct {
	Name   string         `json:"name"`
	Parse  string         `json:"parse"` // parse flavour, "A" or "B"
	Render map[string]any `json:"render"`
}

type doc struct {
	Name string `json:"name"`
	In   string `json:"in,omitempty"`   // the Markdown
	Repo string `json:"repo,omitempty"` // a path under the repository root, instead of In
	Mut  string `json:"mut,omitempty"`  // tree mutation applied after parsing: "", "colspan", "caption"
}

type record struct {
	Doc      int     `json:"doc"`
	Opt      int     `json:"opt"`
	Renderer string  `json:"r"`
	Throws   bool    `json:"throws,omitempty"`
	Len      int     `json:"len"`
	Hash     string  `json:"hash,omitempty"`
	Out      *string `json:"out,omitempty"` // the output itself when it is short
}

func baseRender(extra map[string]any) map[string]any {
	ret := map[string]any{"ProtyleWYSIWYG": true, "KramdownBlockIAL": true, "KramdownSpanIAL": true, "SuperBlock": true}
	for k, v := range extra {
		ret[k] = v
	}
	return ret
}

func optionSets() []optSet {
	return []optSet{
		{"base", "A", baseRender(nil)},
		{"sanitize", "A", baseRender(map[string]any{"Sanitize": true})},
		{"linkbase", "A", baseRender(map[string]any{"LinkBase": "https://b.example/base/", "LinkPrefix": "/pre"})},
		{"lazy loading", "A", baseRender(map[string]any{"ImageLazyLoading": "assets/lazy.png"})},
		{"spaces", "A", baseRender(map[string]any{"KeepParagraphBeginningSpace": true, "ChineseParagraphBeginningSpace": true, "AutoSpace": true})},
		{"netimg spellcheck", "A", baseRender(map[string]any{"ProtyleMarkNetImg": true, "Spellcheck": true, "ProtyleContenteditable": true})},
		{"datatask", "B", baseRender(map[string]any{"DataTask": true, "ExportNormalizeTaskListMarker": true, "ToC": true, "HeadingAnchor": true, "HeadingID": true})},
		{"all", "B", baseRender(map[string]any{"Sanitize": true, "AutoSpace": true, "LinkBase": "https://b.example/", "ImageLazyLoading": "x.png", "SoftBreak2HardBreak": true,
			"ProtyleMarkNetImg": true, "DataTask": true, "ChineseParagraphBeginningSpace": true, "HeadingAnchor": true})},
	}
}

func setFields(target any, set map[string]any) {
	v := reflect.ValueOf(target).Elem()
	for k, val := range set {
		f := v.FieldByName(k)
		if !f.IsValid() {
			panic("unknown option " + k)
		}
		switch x := val.(type) {
		case bool:
			f.SetBool(x)
		case string:
			f.SetString(x)
		default:
			panic("unsupported option type")
		}
	}
}

func parseOptions(flavour string) *parse.Options {
	po := parse.NewOptions()
	setFields(po, map[string]any{"ProtyleWYSIWYG": true, "KramdownBlockIAL": true, "KramdownSpanIAL": true, "BlockRef": true, "FileAnnotationRef": true,
		"Tag": true, "SuperBlock": true, "Mark": true, "Sup": true, "Sub": true, "GitConflict": true, "TextMark": true, "Callout": true, "Tabs": true})
	if "B" == flavour {
		setFields(po, map[string]any{"ArbitraryTaskListItemMarker": true, "ParagraphBeginningSpace": true, "ImgPathAllowSpace": true})
	}
	return po
}

func firstByType(n *ast.Node, t ast.NodeType) (ret *ast.Node) {
	ast.Walk(n, func(c *ast.Node, entering bool) ast.WalkStatus {
		if entering && c.Type == t {
			ret = c
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
}

func mutate(tree *parse.Tree, mut string) {
	switch mut {
	case "colspan":
		if cell := firstByType(tree.Root, ast.NodeTableCell); nil != cell {
			cell.SetIALAttr("colspan", "2")
		}
	case "caption":
		if table := firstByType(tree.Root, ast.NodeTable); nil != table {
			table.SetIALAttr("caption", "&lt;caption contenteditable=&quot;false&quot;&gt;cap&lt;/caption&gt;")
		}
	}
}

func try(f func()) (panicked bool) {
	defer func() {
		if r := recover(); nil != r {
			panicked = true
		}
	}()
	f()
	return
}

func main() {
	ast.Testing = true
	docs := documents()
	opts := optionSets()
	var records []record
	for di, d := range docs {
		in := d.In
		if "" != d.Repo {
			b, err := os.ReadFile(filepath.Join("..", "..", "..", d.Repo))
			if nil != err {
				panic(err)
			}
			in = string(b)
		}
		if !utf8.ValidString(in) {
			panic("invalid UTF-8 in document " + d.Name)
		}
		for oi, o := range opts {
			for _, rn := range []string{"export", "docx"} {
				rec := record{Doc: di, Opt: oi, Renderer: rn}
				var out []byte
				po := parseOptions(o.Parse)
				ro := render.NewOptions()
				setFields(ro, o.Render)
				rec.Throws = try(func() {
					tree := parse.Parse("", []byte(in), po)
					mutate(tree, d.Mut)
					if "export" == rn {
						out = render.NewProtyleExportRenderer(tree, ro, po).Render()
					} else {
						out = render.NewProtyleExportDocxRenderer(tree, ro, po).Render()
					}
				})
				if !rec.Throws {
					rec.Len = len(out)
					sum := sha256.Sum256(out)
					rec.Hash = hex.EncodeToString(sum[:8])
					if len(out) <= 300 {
						s := string(out)
						if !utf8.ValidString(s) {
							panic("invalid UTF-8 output")
						}
						rec.Out = &s
					}
				}
				records = append(records, rec)
			}
		}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(map[string]any{"docs": docs, "optionSets": opts, "records": records}); nil != err {
		panic(err)
	}
	out := filepath.Join("..", "..", "src", "render", "testdata", "protyle_export_vectors.json")
	if err := os.WriteFile(out, buf.Bytes(), 0o644); nil != err {
		panic(err)
	}
	fmt.Printf("%s: %d bytes, %d records\n", out, buf.Len(), len(records))
}
