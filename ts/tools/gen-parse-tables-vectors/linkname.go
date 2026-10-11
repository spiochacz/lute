package main

// The unexported functions and methods of the parse package are reached with go:linkname pulls.
// The bodies are in the parse package. Each declaration here has the same signature as the Go function
// it names (a method takes its receiver as the first parameter). empty.s makes the body-less
// declarations compile.

import (
	_ "unsafe" // for go:linkname

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

//go:linkname linkMergeIAL github.com/88250/lute/parse.mergeIALPreservingOrder
func linkMergeIAL(dst, src [][]string) [][]string

//go:linkname linkSimpleCheckIsBlockIAL github.com/88250/lute/parse.simpleCheckIsBlockIAL
func linkSimpleCheckIsBlockIAL(tokens []byte) bool

//go:linkname linkIsTableCellIAL github.com/88250/lute/parse.isTableCellIAL
func linkIsTableCellIAL(ial [][]string) bool

//go:linkname linkInInline github.com/88250/lute/parse.inInline
func linkInInline(tokens []byte, i int, marker byte) bool

//go:linkname linkSentinel github.com/88250/lute/parse.tableCellRichStyleSentinel
func linkSentinel(source string) string

//go:linkname linkProtect github.com/88250/lute/parse.protectTableCellRichStyles
func linkProtect(source string) (string, func(*parse.Tree))

//go:linkname linkMergeTextMarkTypes github.com/88250/lute/parse.mergeTextMarkTypes
func linkMergeTextMarkTypes(typeGroups ...[]string) string

//go:linkname linkTableDelimAlign github.com/88250/lute/parse.(*Context).tableDelimAlign
func linkTableDelimAlign(c *parse.Context, col []byte) int

//go:linkname linkParseTableDelimRow github.com/88250/lute/parse.(*Context).parseTableDelimRow
func linkParseTableDelimRow(c *parse.Context, line []byte) []int

//go:linkname linkFindTableDelimRow github.com/88250/lute/parse.(*Context).findTableDelimRow
func linkFindTableDelimRow(c *parse.Context, lines [][]byte) int

//go:linkname linkParseTableRow github.com/88250/lute/parse.(*Context).parseTableRow
func linkParseTableRow(c *parse.Context, line []byte, aligns []int, isHead bool) *ast.Node

//go:linkname linkParseTable0 github.com/88250/lute/parse.(*Context).parseTable0
func linkParseTable0(c *parse.Context, tokens []byte) *ast.Node

//go:linkname linkParseTable github.com/88250/lute/parse.(*Context).parseTable
func linkParseTable(c *parse.Context, paragraph *ast.Node) (*ast.Node, *ast.Node)

//go:linkname linkParseBlockRefID github.com/88250/lute/parse.(*Context).parseBlockRefID
func linkParseBlockRefID(c *parse.Context, tokens []byte) (passed, remains, id []byte)

//go:linkname linkParseFileAnnotationRefID github.com/88250/lute/parse.(*Context).parseFileAnnotationRefID
func linkParseFileAnnotationRefID(c *parse.Context, tokens []byte) (passed, remains, id []byte)

//go:linkname linkParseKramdownBlockIAL github.com/88250/lute/parse.(*Context).parseKramdownBlockIAL
func linkParseKramdownBlockIAL(c *parse.Context, tokens []byte) [][]string

//go:linkname linkParseKramdownSpanIAL github.com/88250/lute/parse.(*Context).parseKramdownSpanIAL
func linkParseKramdownSpanIAL(c *parse.Context, tokens []byte) (int, [][]string)

//go:linkname linkParseKramdownIALInListItem github.com/88250/lute/parse.(*Context).parseKramdownIALInListItem
func linkParseKramdownIALInListItem(c *parse.Context, tokens []byte) [][]string
