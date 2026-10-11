package main

// The unexported functions and methods of html/node.go, reached with go:linkname
// pulls. The receiver of a nodeStack method is a pointer to the slice (the nodeStack
// type is a slice of *Node, so *nodeStack and *[]*html.Node have the same layout).
// The bodies are in the html package; empty.s makes the body-less declarations compile.

import (
	_ "unsafe" // for go:linkname

	"github.com/88250/lute/html"
	"github.com/88250/lute/html/atom"
)

//go:linkname linkReparentChildren github.com/88250/lute/html.reparentChildren
func linkReparentChildren(dst, src *html.Node)

//go:linkname linkClone github.com/88250/lute/html.(*Node).clone
func linkClone(n *html.Node) *html.Node

//go:linkname linkStackPop github.com/88250/lute/html.(*nodeStack).pop
func linkStackPop(s *[]*html.Node) *html.Node

//go:linkname linkStackTop github.com/88250/lute/html.(*nodeStack).top
func linkStackTop(s *[]*html.Node) *html.Node

//go:linkname linkStackIndex github.com/88250/lute/html.(*nodeStack).index
func linkStackIndex(s *[]*html.Node, n *html.Node) int

//go:linkname linkStackContains github.com/88250/lute/html.(*nodeStack).contains
func linkStackContains(s *[]*html.Node, a atom.Atom) bool

//go:linkname linkStackInsert github.com/88250/lute/html.(*nodeStack).insert
func linkStackInsert(s *[]*html.Node, i int, n *html.Node)

//go:linkname linkStackRemove github.com/88250/lute/html.(*nodeStack).remove
func linkStackRemove(s *[]*html.Node, n *html.Node)
