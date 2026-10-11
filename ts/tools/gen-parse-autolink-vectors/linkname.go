package main

// The unexported identifiers of parse/auto_link.go, parse/inline_html.go and
// parse/html_text_style.go, reached with go:linkname pulls. The bodies are in the
// parse package; empty.s makes the body-less declarations compile.

import (
	_ "unsafe" // for go:linkname

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

//go:linkname linkValidAutoLinkDomainSuffix github.com/88250/lute/parse.validAutoLinkDomainSuffix
var linkValidAutoLinkDomainSuffix map[string]bool

//go:linkname linkAllTLDs github.com/88250/lute/parse.allTLDs
var linkAllTLDs string

//go:linkname linkGetValidDomainSuffixFromStr github.com/88250/lute/parse.getValidDomainSuffixFromStr
func linkGetValidDomainSuffixFromStr() map[string]bool

//go:linkname linkIsValidDomain github.com/88250/lute/parse.(*Tree).isValidDomain
func linkIsValidDomain(t *parse.Tree, protocol, domain []byte) bool

//go:linkname linkIsValidEmailSegment1 github.com/88250/lute/parse.(*Tree).isValidEmailSegment1
func linkIsValidEmailSegment1(t *parse.Tree, token byte) bool

//go:linkname linkIsValidEmailSegment2 github.com/88250/lute/parse.(*Tree).isValidEmailSegment2
func linkIsValidEmailSegment2(t *parse.Tree, token byte) bool

//go:linkname linkParseGFMAutoEmailLink github.com/88250/lute/parse.(*Tree).parseGFMAutoEmailLink
func linkParseGFMAutoEmailLink(t *parse.Tree, node *ast.Node)

//go:linkname linkParseGFMAutoLink github.com/88250/lute/parse.(*Tree).parseGFMAutoLink
func linkParseGFMAutoLink(t *parse.Tree, node *ast.Node)

//go:linkname linkNewLink github.com/88250/lute/parse.(*Tree).newLink
func linkNewLink(t *parse.Tree, typ ast.NodeType, text, dest, title []byte, linkType int) *ast.Node

//go:linkname linkParseCDATA github.com/88250/lute/parse.(*Tree).parseCDATA
func linkParseCDATA(t *parse.Tree, tokens []byte) (bool, []byte, []byte)

//go:linkname linkParseDeclaration github.com/88250/lute/parse.(*Tree).parseDeclaration
func linkParseDeclaration(t *parse.Tree, tokens []byte) (bool, []byte, []byte)

//go:linkname linkParseProcessingInstruction github.com/88250/lute/parse.(*Tree).parseProcessingInstruction
func linkParseProcessingInstruction(t *parse.Tree, tokens []byte) (bool, []byte, []byte)

//go:linkname linkParseHTMLComment github.com/88250/lute/parse.(*Tree).parseHTMLComment
func linkParseHTMLComment(t *parse.Tree, tokens []byte) (bool, []byte, []byte)

//go:linkname linkParseTagName github.com/88250/lute/parse.(*Tree).parseTagName
func linkParseTagName(t *parse.Tree, tokens []byte) ([]byte, []byte)

//go:linkname linkParseAttrValSpec github.com/88250/lute/parse.parseAttrValSpec
func linkParseAttrValSpec(tokens []byte) (bool, []byte, []byte)

//go:linkname linkParseAttrName github.com/88250/lute/parse.parseAttrName
func linkParseAttrName(tokens []byte) ([]byte, []byte)

//go:linkname linkStartEndBlank github.com/88250/lute/parse.startEndBlank
func linkStartEndBlank(str string) (string, string)

//go:linkname linkSafeHTMLFontFamily github.com/88250/lute/parse.safeHTMLFontFamily
func linkSafeHTMLFontFamily(value string) bool
