// Command gen-ast-vectors calls the real Go ast package (built with -tags
// javascript) and writes the oracle files that ts/src/ast/*.test.ts check.
//
// Files written to -out (default ../../src/ast/testdata):
//   nodetype_vectors.json   NodeType constants, String(), Str2NodeType
//   predicates_vectors.json per-type predicates and CanContain
//   tree_vectors.json       scripted tree operation scenarios (tree.go)
//   realtree_vectors.json   parsed Markdown trees with every field and method (realtree.go)
//   ial_vectors.json        KramdownIAL helpers (misc.go)
//   misc_vectors.json       IsNodeIDPattern, callout helpers (misc.go)
//   table_rich_vectors.json TableCellRich Encode and Decode (misc.go)
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	goast "go/ast"
	"go/constant"
	goparser "go/parser"
	"go/token"
	"go/types"
	"os"
	"path/filepath"

	"github.com/88250/lute/ast"
)

// panicMarker is the value recorded for a call that panics in Go.
const panicMarker = "PANIC"

var outDir string

// safe runs f and returns panicMarker if f panics.
func safe(f func() any) (v any) {
	defer func() {
		if r := recover(); r != nil {
			v = panicMarker
		}
	}()
	return f()
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

// writeJSON writes v as compact JSON with HTML escaping off.
func writeJSON(name string, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	must(enc.Encode(v))
	must(os.WriteFile(filepath.Join(outDir, name), buf.Bytes(), 0644))
	fmt.Fprintf(os.Stderr, "%s %d bytes\n", name, buf.Len())
}

func main() {
	repo := "../../.."
	out := "../../src/ast/testdata"
	for i := 1; i < len(os.Args); i += 2 {
		if i+1 >= len(os.Args) {
			panic("flags come in pairs: -repo DIR -out DIR")
		}
		switch os.Args[i] {
		case "-repo":
			repo = os.Args[i+1]
		case "-out":
			out = os.Args[i+1]
		default:
			panic("unknown flag " + os.Args[i])
		}
	}
	outDir = out
	must(os.MkdirAll(outDir, 0755))

	consts := readNodeTypeConsts(filepath.Join(repo, "ast", "node.go"))
	writeNodeType(consts)
	writePredicates(int(ast.NodeTypeMaxVal))
	writeTreeScenarios()
	writeRealtrees()
	writeIAL()
	writeMisc()
	writeTableRich()
}

type constPair struct {
	Name string
	Val  int64
}

// readNodeTypeConsts reads the NodeType const block of node.go with go/parser,
// copies its source text into a standalone file that declares only
// `type NodeType int`, and evaluates every constant with go/types.
func readNodeTypeConsts(path string) []constPair {
	src, err := os.ReadFile(path)
	must(err)
	fset := token.NewFileSet()
	f, err := goparser.ParseFile(fset, path, src, goparser.ParseComments)
	must(err)

	var block *goast.GenDecl
	for _, d := range f.Decls {
		gd, ok := d.(*goast.GenDecl)
		if !ok || gd.Tok != token.CONST || len(gd.Specs) == 0 {
			continue
		}
		vs, ok := gd.Specs[0].(*goast.ValueSpec)
		if !ok || vs.Type == nil {
			continue
		}
		if id, ok := vs.Type.(*goast.Ident); ok && id.Name == "NodeType" {
			block = gd
			break
		}
	}
	if block == nil {
		panic("NodeType const block not found in " + path)
	}

	start := fset.Position(block.Pos()).Offset
	end := fset.Position(block.End()).Offset
	synth := "package ast\n\ntype NodeType int\n\n" + string(src[start:end]) + "\n"

	fset2 := token.NewFileSet()
	sf, err := goparser.ParseFile(fset2, "synth.go", synth, 0)
	must(err)
	pkg, err := (&types.Config{}).Check("ast", fset2, []*goast.File{sf}, nil)
	must(err)

	var out []constPair
	for _, spec := range block.Specs {
		vs := spec.(*goast.ValueSpec)
		for _, name := range vs.Names {
			if name.Name == "_" {
				continue
			}
			c, ok := pkg.Scope().Lookup(name.Name).(*types.Const)
			if !ok {
				panic("not a constant: " + name.Name)
			}
			v, exact := constant.Int64Val(c.Val())
			if !exact {
				panic("constant does not fit int64: " + name.Name)
			}
			out = append(out, constPair{name.Name, v})
		}
	}
	fmt.Fprintf(os.Stderr, "NodeType constants: %d\n", len(out))
	return out
}

func writeNodeType(consts []constPair) {
	maxVal := int(ast.NodeTypeMaxVal)

	constants := []any{}
	mismatchName := 0
	mismatchStr2 := 0
	for _, c := range consts {
		constants = append(constants, []any{c.Name, c.Val})
		if ast.NodeType(c.Val).String() != c.Name {
			mismatchName++
		}
		if int64(ast.Str2NodeType(c.Name)) != c.Val {
			mismatchStr2++
		}
	}
	fmt.Fprintf(os.Stderr, "String() differs from constant name for %d constants; Str2NodeType differs for %d\n", mismatchName, mismatchStr2)

	strs := []any{}
	for v := -2; v <= maxVal+2; v++ {
		strs = append(strs, []any{v, ast.NodeType(v).String()})
	}

	str2 := []any{}
	for _, c := range consts {
		str2 = append(str2, []any{c.Name, int(ast.Str2NodeType(c.Name))})
	}
	for _, name := range []string{"NoSuchNodeType", "", "nodedocument"} {
		str2 = append(str2, []any{name, int(ast.Str2NodeType(name))})
	}

	writeJSON("nodetype_vectors.json", map[string]any{
		"maxVal":    maxVal,
		"constants": constants,
		"strings":   strs,
		"str2type":  str2,
	})
}

func writePredicates(maxVal int) {
	list := []any{}
	for v := -2; v <= maxVal+2; v++ {
		n := &ast.Node{Type: ast.NodeType(v)}
		canContain := make([]byte, 0, maxVal+5)
		for i := -2; i <= maxVal+2; i++ {
			if n.CanContain(ast.NodeType(i)) {
				canContain = append(canContain, '1')
			} else {
				canContain = append(canContain, '0')
			}
		}
		list = append(list, map[string]any{
			"type":             v,
			"isBlock":          n.IsBlock(),
			"isContainerBlock": n.IsContainerBlock(),
			"isMarker":         n.IsMarker(),
			"isCloseMarker":    n.IsCloseMarker(),
			"acceptLines":      n.AcceptLines(),
			"markerTrue":       safe(func() any { return n.Marker(true) }),
			"markerFalse":      safe(func() any { return n.Marker(false) }),
			"canContain":       string(canContain),
		})
	}
	writeJSON("predicates_vectors.json", map[string]any{"types": list})
}
