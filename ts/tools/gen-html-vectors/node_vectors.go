package main

// Node vectors: scenarios of operations on html.Node trees and on the nodeStack
// (html/node.go), run on the real Go code.
//
// A scenario has a set of nodes (their type, data, atom, namespace and attributes),
// a list of operations on them (node indices, -1 for a nil argument) and the result
// of each operation (a panic flag or the returned value). Operations on the tree use
// the exported API (AppendChild, InsertBefore, ...). reparentChildren, clone and the
// nodeStack methods are unexported and are reached through linknames in
// node_linkname.go. After the operations the links of every node, the stack, a nested
// dump of the tree and the consistency of the links are recorded. The TypeScript
// port replays the same operations and must produce the same results.
//
// nodeStack operations on a stack of the nodes: push (append in the harness), pop,
// top, index, contains, insert (any index, including out-of-range ones, which panic),
// remove. A nil value is recorded as -1.

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"runtime"

	"github.com/88250/lute/html"
	"github.com/88250/lute/html/atom"
)

// nodeSpec is the initial state of a node of a scenario.
type nodeSpec struct {
	Type  int         `json:"type"`
	Data  string      `json:"data"`
	Atom  int         `json:"atom"`
	NS    string      `json:"ns"`
	Attrs [][3]string `json:"attrs"`
}

// scenario is one recorded run.
type scenario struct {
	Nodes      []nodeSpec `json:"nodes"`
	Ops        [][]any    `json:"ops"`
	Results    [][]any    `json:"results"`
	Links      [][]int    `json:"links"`
	Stack      []int      `json:"stack"`
	Tree       []any      `json:"tree"`
	Consistent bool       `json:"consistent"`
}

type nodeVectors struct {
	GoVersion string     `json:"goVersion"`
	Scenarios []scenario `json:"scenarios"`
}

// tryOp runs f and reports whether it panicked.
func tryOp(f func()) (panicked bool) {
	defer func() {
		if r := recover(); r != nil {
			panicked = true
		}
	}()
	f()
	return false
}

// idxOf returns the index of n in nodes, -1 for nil, and -2 when n is not a node of the scenario.
func idxOf(nodes []*html.Node, n *html.Node) int {
	if n == nil {
		return -1
	}
	for i, m := range nodes {
		if m == n {
			return i
		}
	}
	return -2
}

// consistent reports whether the links of all nodes agree with each other. It is the
// same check as nodeLinksConsistent in node.vectors.test.ts.
func consistent(nodes []*html.Node) bool {
	for _, n := range nodes {
		if n.FirstChild != nil && (n.FirstChild.PrevSibling != nil || n.FirstChild.Parent != n) {
			return false
		}
		if n.LastChild != nil && (n.LastChild.NextSibling != nil || n.LastChild.Parent != n) {
			return false
		}
		if n.NextSibling != nil && (n.NextSibling.PrevSibling != n || n.NextSibling.Parent != n.Parent) {
			return false
		}
		if n.PrevSibling != nil && n.PrevSibling.NextSibling != n {
			return false
		}
		if n.Parent != nil && ((n.PrevSibling == nil) != (n.Parent.FirstChild == n) || (n.NextSibling == nil) != (n.Parent.LastChild == n)) {
			return false
		}
	}
	return true
}

// dumpTree returns the nested dump of n: type, data, attributes and children. A child
// already on the path or in the sibling list is recorded as a cycle.
func dumpTree(nodes []*html.Node, n *html.Node, seen map[*html.Node]bool) any {
	seen[n] = true
	attrs := [][3]string{}
	for _, a := range n.Attr {
		attrs = append(attrs, [3]string{a.Namespace, a.Key, a.Val})
	}
	children := []any{}
	visited := map[*html.Node]bool{}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if visited[c] || seen[c] {
			children = append(children, map[string]any{"cycle": idxOf(nodes, c)})
			break
		}
		visited[c] = true
		children = append(children, dumpTree(nodes, c, seen))
	}
	delete(seen, n)
	return map[string]any{"n": idxOf(nodes, n), "t": int(n.Type), "d": n.Data, "a": attrs, "c": children}
}

// runScenario builds a random scenario from rng and records it.
func runScenario(rng *rand.Rand) scenario {
	var sc scenario
	nNodes := 3 + rng.Intn(6)
	var nodes []*html.Node
	for i := 0; i < nNodes; i++ {
		spec := nodeSpec{
			Type: rng.Intn(6),
			Data: []string{"div", "p", "span", "a", "", "x", "table", "td"}[rng.Intn(8)],
			NS:   []string{"", "", "svg", "math", "html"}[rng.Intn(5)],
		}
		spec.Atom = int(atom.Lookup([]byte(spec.Data)))
		if rng.Intn(3) == 0 {
			spec.Attrs = append(spec.Attrs, [3]string{"", "id", fmt.Sprint("n", i)})
		}
		if rng.Intn(4) == 0 {
			spec.Attrs = append(spec.Attrs, [3]string{"", "class", "c"})
		}
		sc.Nodes = append(sc.Nodes, spec)
		n := &html.Node{Type: html.NodeType(spec.Type), Data: spec.Data, DataAtom: atom.Atom(spec.Atom), Namespace: spec.NS}
		for _, a := range spec.Attrs {
			n.Attr = append(n.Attr, &html.Attribute{Namespace: a[0], Key: a[1], Val: a[2]})
		}
		nodes = append(nodes, n)
	}

	var stk []*html.Node
	atoms := []atom.Atom{atom.Div, atom.P, 0, atom.Span, atom.A}
	nOps := 10 + rng.Intn(30)
	for k := 0; k < nOps; k++ {
		nn := len(nodes)
		pick := func() int {
			return rng.Intn(nn)
		}
		var op []any
		var res []any
		switch rng.Intn(15) {
		case 0:
			p, c := pick(), pick()
			op = []any{"append", p, c}
			pan := tryOp(func() { nodes[p].AppendChild(nodes[c]) })
			res = []any{pan, nil}
		case 1:
			n, s := pick(), pick()
			op = []any{"insertBefore", n, s}
			pan := tryOp(func() { nodes[n].InsertBefore(nodes[s]) })
			res = []any{pan, nil}
		case 2:
			n, s := pick(), pick()
			op = []any{"insertAfter", n, s}
			pan := tryOp(func() { nodes[n].InsertAfter(nodes[s]) })
			res = []any{pan, nil}
		case 3:
			p, c, o := pick(), pick(), rng.Intn(nn+1)-1
			op = []any{"insertChildBefore", p, c, o}
			var oldChild *html.Node
			if o >= 0 {
				oldChild = nodes[o]
			}
			pan := tryOp(func() { nodes[p].InsertChildBefore(nodes[c], oldChild) })
			res = []any{pan, nil}
		case 4:
			p, c := pick(), pick()
			op = []any{"removeChild", p, c}
			pan := tryOp(func() { nodes[p].RemoveChild(nodes[c]) })
			res = []any{pan, nil}
		case 5:
			n := pick()
			op = []any{"unlink", n}
			pan := tryOp(func() { nodes[n].Unlink() })
			res = []any{pan, nil}
		case 6:
			d, s := pick(), pick()
			if d == s {
				continue
			}
			op = []any{"reparent", d, s}
			pan := tryOp(func() { linkReparentChildren(nodes[d], nodes[s]) })
			res = []any{pan, nil}
		case 7:
			n := pick()
			op = []any{"clone", n}
			var m *html.Node
			pan := tryOp(func() { m = linkClone(nodes[n]) })
			if !pan {
				nodes = append(nodes, m)
				res = []any{false, len(nodes) - 1}
			} else {
				res = []any{true, nil}
			}
		case 8:
			n := pick()
			op = []any{"push", n}
			stk = append(stk, nodes[n])
			res = []any{false, nil}
		case 9:
			op = []any{"pop"}
			var r *html.Node
			pan := tryOp(func() { r = linkStackPop(&stk) })
			res = []any{pan, idxOf(nodes, r)}
		case 10:
			op = []any{"top"}
			var r *html.Node
			pan := tryOp(func() { r = linkStackTop(&stk) })
			res = []any{pan, idxOf(nodes, r)}
		case 11:
			n := pick()
			op = []any{"index", n}
			var r int
			pan := tryOp(func() { r = linkStackIndex(&stk, nodes[n]) })
			res = []any{pan, r}
		case 12:
			ai := rng.Intn(len(atoms))
			op = []any{"contains", int(atoms[ai])}
			var r bool
			pan := tryOp(func() { r = linkStackContains(&stk, atoms[ai]) })
			res = []any{pan, r}
		case 13:
			i := rng.Intn(len(stk)+3) - 1
			n := pick()
			op = []any{"insert", i, n}
			pan := tryOp(func() { linkStackInsert(&stk, i, nodes[n]) })
			res = []any{pan, nil}
		case 14:
			n := pick()
			op = []any{"remove", n}
			pan := tryOp(func() { linkStackRemove(&stk, nodes[n]) })
			res = []any{pan, nil}
		}
		sc.Ops = append(sc.Ops, op)
		sc.Results = append(sc.Results, res)
	}

	// The final state.
	for _, n := range nodes {
		sc.Links = append(sc.Links, []int{
			idxOf(nodes, n.Parent), idxOf(nodes, n.FirstChild), idxOf(nodes, n.LastChild),
			idxOf(nodes, n.PrevSibling), idxOf(nodes, n.NextSibling),
		})
	}
	for _, n := range stk {
		sc.Stack = append(sc.Stack, idxOf(nodes, n))
	}
	if sc.Stack == nil {
		sc.Stack = []int{}
	}
	for _, n := range nodes {
		if n.Parent == nil {
			sc.Tree = append(sc.Tree, dumpTree(nodes, n, map[*html.Node]bool{}))
		}
	}
	sc.Consistent = consistent(nodes)
	return sc
}

// writeNodeVectors writes the node vectors to stdout.
func writeNodeVectors() {
	rng := rand.New(rand.NewSource(20260511))
	var out nodeVectors
	out.GoVersion = runtime.Version()
	for i := 0; i < 300; i++ {
		out.Scenarios = append(out.Scenarios, runScenario(rng))
	}
	jenc := json.NewEncoder(os.Stdout)
	jenc.SetEscapeHTML(false)
	if err := jenc.Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
