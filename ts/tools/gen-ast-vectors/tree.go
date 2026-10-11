package main

import (
	"encoding/hex"
	"fmt"
	"math/rand"
	"strings"

	"github.com/88250/lute/ast"
)

// treeOp is one recorded operation of a tree scenario.
type treeOp struct {
	Kind   string
	A, B   int
	Type   int
	Tokens string // hex
	ID     string // optional; empty means no ID
}

func (o treeOp) json() map[string]any {
	m := map[string]any{"op": o.Kind}
	switch o.Kind {
	case "new":
		m["type"] = o.Type
		m["tokens"] = o.Tokens
		if o.ID != "" {
			m["id"] = o.ID
		}
	case "AppendChild", "PrependChild", "InsertBefore", "InsertAfter":
		m["a"] = o.A
		m["b"] = o.B
	case "Unlink":
		m["a"] = o.A
	case "AppendTokens", "PrependTokens":
		m["a"] = o.A
		m["tokens"] = o.Tokens
	}
	return m
}

// applyOps replays ops on a fresh forest. ok is false if Go panics.
func applyOps(ops []treeOp) (nodes []*ast.Node, ok bool) {
	ok = true
	defer func() {
		if r := recover(); r != nil {
			ok = false
			nodes = nil
		}
	}()
	for _, o := range ops {
		switch o.Kind {
		case "new":
			tok, _ := hex.DecodeString(o.Tokens)
			nodes = append(nodes, &ast.Node{Type: ast.NodeType(o.Type), Tokens: tok, ID: o.ID})
		case "AppendChild":
			nodes[o.A].AppendChild(nodes[o.B])
		case "PrependChild":
			nodes[o.A].PrependChild(nodes[o.B])
		case "InsertBefore":
			nodes[o.A].InsertBefore(nodes[o.B])
		case "InsertAfter":
			nodes[o.A].InsertAfter(nodes[o.B])
		case "Unlink":
			nodes[o.A].Unlink()
		case "AppendTokens":
			tok, _ := hex.DecodeString(o.Tokens)
			nodes[o.A].AppendTokens(tok)
		case "PrependTokens":
			tok, _ := hex.DecodeString(o.Tokens)
			nodes[o.A].PrependTokens(tok)
		default:
			panic("unknown op " + o.Kind)
		}
	}
	return
}

// acyclic reports whether the Parent chains and the FirstChild/Next chains are
// free of cycles and every child chain is consistent in length.
func acyclic(nodes []*ast.Node) bool {
	limit := len(nodes) + 1
	for _, n := range nodes {
		steps := 0
		for p := n; p != nil; p = p.Parent {
			steps++
			if steps > limit {
				return false
			}
		}
		if !childrenAcyclic(n, limit, 0) {
			return false
		}
	}
	return true
}

func childrenAcyclic(n *ast.Node, limit, depth int) bool {
	if depth > limit {
		return false
	}
	cnt := 0
	for c := n.FirstChild; c != nil; c = c.Next {
		cnt++
		if cnt > limit {
			return false
		}
		if !childrenAcyclic(c, limit, depth+1) {
			return false
		}
	}
	return true
}

// linksJSON records Go's actual link fields after one step: for every node in
// creation order, [Parent, Previous, Next, FirstChild, LastChild] as node
// indexes or null. Go's values are recorded as they are, without any check.
func linksJSON(nodes []*ast.Node) []any {
	idx := map[*ast.Node]int{}
	for i, n := range nodes {
		idx[n] = i
	}
	ref := func(p *ast.Node) any {
		if p == nil {
			return nil
		}
		i, ok := idx[p]
		if !ok {
			panic("link outside the scenario forest")
		}
		return i
	}
	out := make([]any, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, []any{ref(n.Parent), ref(n.Previous), ref(n.Next), ref(n.FirstChild), ref(n.LastChild)})
	}
	return out
}

// forestDump renders every root (Parent == nil) in creation order, pre-order:
// "<depth> <type> <tokens-hex>\n" per node.
func forestDump(nodes []*ast.Node) string {
	var sb strings.Builder
	for _, n := range nodes {
		if n.Parent == nil {
			dumpTree(&sb, n, 0)
		}
	}
	return sb.String()
}

func dumpTree(sb *strings.Builder, n *ast.Node, depth int) {
	fmt.Fprintf(sb, "%d %d %s\n", depth, int(n.Type), hex.EncodeToString(n.Tokens))
	for c := n.FirstChild; c != nil; c = c.Next {
		dumpTree(sb, c, depth+1)
	}
}

var scenarioTypes = []ast.NodeType{
	ast.NodeDocument, ast.NodeParagraph, ast.NodeHeading, ast.NodeBlockquote, ast.NodeList,
	ast.NodeListItem, ast.NodeText, ast.NodeEmA6kOpenMarker, ast.NodeEmA6kCloseMarker, ast.NodeCodeBlock,
	ast.NodeTable, ast.NodeTabs, ast.NodeTabItem, ast.NodeKramdownBlockIAL, ast.NodeSuperBlock,
	ast.NodeSuperBlockCloseMarker, ast.NodeFootnotesDef, ast.NodeTaskListItemMarker, ast.NodeCallout,
	ast.NodeHTMLBlock, ast.NodeThematicBreak, ast.NodeCodeSpan,
}

var scenarioTokens = []string{"", "a", "abc", "hello world", "中文", "*x*", "🙂", "{: id=\"x\"}", "\n", "1."}

var scenarioIDs = []string{"20240101120000-abcdefg", "20240101120001-hijklmn", "20240101120002-0123456"}

const scenarioMaxNodes = 12

// randomOp draws a candidate operation given nodeCount existing nodes.
func randomOp(rng *rand.Rand, nodeCount int) treeOp {
	if nodeCount < 2 || (nodeCount < scenarioMaxNodes && rng.Intn(100) < 25) {
		var t ast.NodeType
		if rng.Intn(10) < 7 {
			t = scenarioTypes[rng.Intn(len(scenarioTypes))]
		} else {
			t = ast.NodeType(rng.Intn(int(ast.NodeTypeMaxVal)))
		}
		o := treeOp{Kind: "new", Type: int(t), Tokens: hex.EncodeToString([]byte(scenarioTokens[rng.Intn(len(scenarioTokens))]))}
		if rng.Intn(2) == 0 {
			o.ID = scenarioIDs[rng.Intn(len(scenarioIDs))]
		}
		return o
	}
	kinds := []struct {
		name string
		w    int
	}{{"AppendChild", 20}, {"PrependChild", 15}, {"InsertBefore", 15}, {"InsertAfter", 15}, {"Unlink", 10}, {"AppendTokens", 5}, {"PrependTokens", 5}}
	total := 0
	for _, k := range kinds {
		total += k.w
	}
	r := rng.Intn(total)
	kind := kinds[0].name
	for _, k := range kinds {
		if r < k.w {
			kind = k.name
			break
		}
		r -= k.w
	}
	o := treeOp{Kind: kind, A: rng.Intn(nodeCount)}
	switch kind {
	case "Unlink":
	case "AppendTokens", "PrependTokens":
		o.Tokens = hex.EncodeToString([]byte(scenarioTokens[rng.Intn(len(scenarioTokens))]))
	default:
		o.B = rng.Intn(nodeCount)
	}
	return o
}

var queryTypes = []struct {
	Name string
	T    ast.NodeType
}{
	{"NodeDocument", ast.NodeDocument}, {"NodeParagraph", ast.NodeParagraph}, {"NodeText", ast.NodeText},
	{"NodeListItem", ast.NodeListItem}, {"NodeHeading", ast.NodeHeading},
}

// scenarioQueries evaluates every query key on every node of the final forest.
func scenarioQueries(nodes []*ast.Node) []any {
	idx := map[*ast.Node]int{}
	for i, n := range nodes {
		idx[n] = i
	}
	ref := func(p *ast.Node) any {
		if p == nil {
			return nil
		}
		i, ok := idx[p]
		if !ok {
			panic("node outside the scenario forest")
		}
		return i
	}
	refs := func(list []*ast.Node) []any {
		out := []any{}
		for _, p := range list {
			out = append(out, ref(p))
		}
		return out
	}

	out := []any{}
	for _, n := range nodes {
		q := map[string]any{}
		q["text"] = safe(func() any { return n.Text() })
		q["textLen"] = safe(func() any { return n.TextLen() })
		q["tokensStr"] = safe(func() any { return n.TokensStr() })
		q["content"] = safe(func() any { return n.Content() })
		q["tokenLen"] = safe(func() any { return n.TokenLen() })
		q["stat"] = safe(func() any {
			a, b, c, d, e := n.Stat()
			return []int{a, b, c, d, e}
		})
		q["docChild"] = safe(func() any { return ref(n.DocChild()) })
		q["lastDeepest"] = safe(func() any { return ref(n.LastDeepestChild()) })
		q["firstDeepest"] = safe(func() any { return ref(n.FirstDeepestChild()) })
		q["list"] = safe(func() any { return refs(n.List()) })
		q["blockIDs"] = safe(func() any {
			out := []any{}
			for _, s := range n.BlockIDs() {
				out = append(out, s)
			}
			return out
		})
		q["nextNodeText"] = safe(func() any { return n.NextNodeText() })
		q["prevNodeText"] = safe(func() any { return n.PreviousNodeText() })
		q["isEmptyBlockIAL"] = safe(func() any { return n.IsEmptyBlockIAL() })
		q["ialID"] = safe(func() any { return n.IALAttr("id") })
		q["isTabTitleBlock"] = safe(func() any { return n.IsTabTitleBlock() })
		q["tabTitleBlock"] = safe(func() any { return ref(n.TabTitleBlock()) })

		childByType := map[string]any{}
		childrenByType := map[string]any{}
		parentIs := map[string]any{}
		for _, qt := range queryTypes {
			t := qt.T
			childByType[qt.Name] = safe(func() any { return ref(n.ChildByType(t)) })
			childrenByType[qt.Name] = safe(func() any { return refs(n.ChildrenByType(t)) })
			parentIs[qt.Name] = safe(func() any { return n.ParentIs(t) })
		}
		q["childByType"] = childByType
		q["childrenByType"] = childrenByType
		q["parentIs"] = parentIs
		q["parentIsMulti"] = safe(func() any { return n.ParentIs(ast.NodeListItem, ast.NodeBlockquote, ast.NodeDocument) })

		isChild := map[string]any{}
		for j := range nodes {
			for d := 0; d <= 1; d++ {
				other := nodes[j]
				depth := d
				isChild[fmt.Sprintf("%d/%d", j, d)] = safe(func() any { return n.IsChildBlockOf(other, depth) })
			}
		}
		q["isChildBlockOf"] = isChild
		out = append(out, q)
	}
	return out
}

// writeTreeScenarios writes 150 scenarios generated from a fixed seed.
func writeTreeScenarios() {
	rng := rand.New(rand.NewSource(20260101))
	scenarios := []any{}
	for s := 0; s < 150; s++ {
		target := 8 + rng.Intn(17)
		var ops []treeOp
		var nodes []*ast.Node
		var dumps []string
		var links []any
		attempts := 0
		for len(ops) < target && attempts < 400 {
			attempts++
			cand := randomOp(rng, len(nodes))
			next := append(append([]treeOp{}, ops...), cand)
			ns, ok := applyOps(next)
			if !ok || !acyclic(ns) {
				continue
			}
			ops = next
			nodes = ns
			dumps = append(dumps, forestDump(ns))
			links = append(links, linksJSON(ns))
		}
		opsJSON := []any{}
		for _, o := range ops {
			opsJSON = append(opsJSON, o.json())
		}
		scenarios = append(scenarios, map[string]any{
			"name":        fmt.Sprintf("s%03d", s),
			"ops":         opsJSON,
			"dumps":       dumps,
			"links":       links,
			"final": map[string]any{
				"count":   len(nodes),
				"queries": scenarioQueries(nodes),
			},
		})
	}
	writeJSON("tree_vectors.json", map[string]any{"scenarios": scenarios})
}
