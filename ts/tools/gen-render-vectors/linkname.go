package main

// The unexported functions and methods of the render package are reached with go:linkname pulls.
// The bodies are in the render package. Each declaration here has the same signature
// as the Go function it names. empty.s makes the body-less declarations compile.

import (
	_ "unsafe" // for go:linkname

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
)

//go:linkname linkAllowSpace github.com/88250/lute/render.allowSpace
func linkAllowSpace(currentChar, nextChar rune) bool

//go:linkname linkIsCJK github.com/88250/lute/render.isCJK
func linkIsCJK(r rune) bool

//go:linkname linkIsFullWidth github.com/88250/lute/render.isFullWidth
func linkIsFullWidth(r rune) bool

//go:linkname linkAddSpaceAtBoundary github.com/88250/lute/render.addSpaceAtBoundary
func linkAddSpaceAtBoundary(prefix string, nextChar rune) string

//go:linkname linkIsNotTerm github.com/88250/lute/render.isNotTerm
func linkIsNotTerm(token byte) bool

//go:linkname linkIsRelativePath github.com/88250/lute/render.(*BaseRenderer).isRelativePath
func linkIsRelativePath(r *render.BaseRenderer, dest []byte) bool

//go:linkname linkNormalizeHeadingID github.com/88250/lute/render.normalizeHeadingID
func linkNormalizeHeadingID(heading *ast.Node) string

//go:linkname linkHeadingText github.com/88250/lute/render.headingText
func linkHeadingText(n *ast.Node) string

//go:linkname linkSetextHeadingLen github.com/88250/lute/render.(*BaseRenderer).setextHeadingLen
func linkSetextHeadingLen(r *render.BaseRenderer, node *ast.Node) int

//go:linkname linkIsLastNode github.com/88250/lute/render.(*BaseRenderer).isLastNode
func linkIsLastNode(r *render.BaseRenderer, treeRoot, node *ast.Node) bool

//go:linkname linkNeedUseHTMLTable github.com/88250/lute/render.(*BaseRenderer).needUseHTMLTable
func linkNeedUseHTMLTable(r *render.BaseRenderer, table *ast.Node) bool

//go:linkname linkTagSrc github.com/88250/lute/render.(*BaseRenderer).tagSrc
func linkTagSrc(r *render.BaseRenderer, tokens []byte) []byte

//go:linkname linkTagSrcPath github.com/88250/lute/render.(*BaseRenderer).tagSrcPath
func linkTagSrcPath(r *render.BaseRenderer, tokens []byte) []byte

//go:linkname linkAppendTableCellAlignStyle github.com/88250/lute/render.appendTableCellAlignStyle
func linkAppendTableCellAlignStyle(node *ast.Node, attrs *[][]string)

//go:linkname linkRemoveSpace github.com/88250/lute/render.removeSpace
func linkRemoveSpace(s string) string

//go:linkname linkAllowAttr github.com/88250/lute/render.allowAttr
func linkAllowAttr(attrName string) bool

//go:linkname linkLinkable github.com/88250/lute/render.linkable
func linkLinkable(elementName string) bool

//go:linkname linkSetextHeadingMarkerOffset github.com/88250/lute/render.setextHeadingMarkerOffset
func linkSetextHeadingMarkerOffset(tokens []byte) int

//go:linkname linkSetextHeadingMarkerOffsetInListParagraph github.com/88250/lute/render.setextHeadingMarkerOffsetInListParagraph
func linkSetextHeadingMarkerOffsetInListParagraph(node *ast.Node) int

//go:linkname linkEscapeSetextHeadingMarkersInListParagraph github.com/88250/lute/render.escapeSetextHeadingMarkersInListParagraph
func linkEscapeSetextHeadingMarkersInListParagraph(node *ast.Node, tokens []byte) []byte

//go:linkname linkIsFileExt github.com/88250/lute/render.isFileExt
func linkIsFileExt(pos, length int, runes *[]rune) bool

//go:linkname linkEscapeTabsParagraphMarkers github.com/88250/lute/render.escapeTabsParagraphMarkers
func linkEscapeTabsParagraphMarkers(node *ast.Node, tokens []byte, withinTabsOnly bool) []byte

//go:linkname linkIsTabsParagraphMarker github.com/88250/lute/render.isTabsParagraphMarker
func linkIsTabsParagraphMarker(line []byte) bool

//go:linkname linkCustomBlockAttrs github.com/88250/lute/render.customBlockAttrs
func linkCustomBlockAttrs(node *ast.Node) [][]string

//go:linkname linkCalloutTitle github.com/88250/lute/render.calloutTitle
func linkCalloutTitle(node *ast.Node) string

//go:linkname linkCalloutDisplayTitle github.com/88250/lute/render.calloutDisplayTitle
func linkCalloutDisplayTitle(node *ast.Node) string

//go:linkname linkCalloutEditableIcon github.com/88250/lute/render.calloutEditableIcon
func linkCalloutEditableIcon(node *ast.Node) string

//go:linkname linkCalloutEditableInfo github.com/88250/lute/render.calloutEditableInfo
func linkCalloutEditableInfo(node *ast.Node) string

//go:linkname linkNeedRoot github.com/88250/lute/render.needRoot
func linkNeedRoot(root *ast.Node) bool

//go:linkname linkMindmapText github.com/88250/lute/render.text
func linkMindmapText(listItemFirstChild *ast.Node) string
