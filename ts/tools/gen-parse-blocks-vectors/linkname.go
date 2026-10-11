package main

// The unexported methods of parse.Tree that do not read parser state are reached with go:linkname pulls.
// Each declaration has the same signature as the Go function it names, with the receiver as first parameter.
// empty.s makes the body-less declarations compile.

import (
	_ "unsafe" // for go:linkname

	"github.com/88250/lute/parse"
)

//go:linkname linkIsOpenTag github.com/88250/lute/parse.(*Tree).isOpenTag
func linkIsOpenTag(t *parse.Tree, tokens []byte) bool

//go:linkname linkIsCloseTag github.com/88250/lute/parse.(*Tree).isCloseTag
func linkIsCloseTag(t *parse.Tree, tokens []byte) bool

//go:linkname linkParseOrderedListMarker github.com/88250/lute/parse.(*Tree).parseOrderedListMarker
func linkParseOrderedListMarker(t *parse.Tree, tokens []byte) ([]byte, byte)

//go:linkname linkParseHTML github.com/88250/lute/parse.(*Tree).parseHTML
func linkParseHTML(t *parse.Tree, tokens []byte) int
