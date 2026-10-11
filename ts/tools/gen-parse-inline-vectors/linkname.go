package main

// The unexported functions and methods of the parse package are reached with
// go:linkname pulls. The bodies are in the parse package. Each declaration here has
// the same signature as the Go function it names. empty.s makes the body-less
// declarations compile.

import (
	_ "unsafe" // for go:linkname

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

//go:linkname linkParseLinkLabel github.com/88250/lute/parse.(*Context).parseLinkLabel
func linkParseLinkLabel(c *parse.Context, tokens []byte) (int, []byte, []byte)

//go:linkname linkParseLinkTitle github.com/88250/lute/parse.(*Context).parseLinkTitle
func linkParseLinkTitle(c *parse.Context, tokens []byte) (bool, []byte, []byte, []byte)

//go:linkname linkParseBlockRefText github.com/88250/lute/parse.(*Context).parseBlockRefText
func linkParseBlockRefText(c *parse.Context, tokens []byte) (bool, []byte, []byte, []byte, string)

//go:linkname linkParseLinkTitleMatch github.com/88250/lute/parse.(*Context).parseLinkTitleMatch
func linkParseLinkTitleMatch(c *parse.Context, opener, closer byte, tokens []byte) (bool, []byte, []byte, []byte)

//go:linkname linkParseLinkDest github.com/88250/lute/parse.(*Context).parseLinkDest
func linkParseLinkDest(c *parse.Context, tokens []byte) ([]byte, []byte, []byte)

//go:linkname linkParseLinkDest1 github.com/88250/lute/parse.(*Context).parseLinkDest1
func linkParseLinkDest1(c *parse.Context, tokens []byte) ([]byte, []byte, []byte)

//go:linkname linkParseLinkDest2 github.com/88250/lute/parse.(*Context).parseLinkDest2
func linkParseLinkDest2(c *parse.Context, tokens []byte) ([]byte, []byte, []byte)

//go:linkname linkParseInlineLinkDest github.com/88250/lute/parse.(*Context).parseInlineLinkDest
func linkParseInlineLinkDest(c *parse.Context, tokens []byte) ([]byte, []byte, []byte)

//go:linkname linkMatchCodeSpanEnd github.com/88250/lute/parse.(*Tree).matchCodeSpanEnd
func linkMatchCodeSpanEnd(t *parse.Tree, tokens []byte, num int) int

//go:linkname linkMatchInlineMathEnd github.com/88250/lute/parse.(*Tree).matchInlineMathEnd
func linkMatchInlineMathEnd(t *parse.Tree, tokens []byte) int

//go:linkname linkLinkRefFoldKey github.com/88250/lute/parse.linkRefFoldKey
func linkLinkRefFoldKey(tokens []byte) string

//go:linkname linkFoldBytes github.com/88250/lute/parse.foldBytes
func linkFoldBytes(tokens []byte) []byte

//go:linkname linkIsDelimiterTextMark github.com/88250/lute/parse.isDelimiterTextMark
func linkIsDelimiterTextMark(n *ast.Node) bool
