package main

// The unexported functions of the html package are reached with go:linkname pulls.
// The bodies are in the html package. Each declaration here has the same signature
// as the Go function it names. empty.s makes the body-less declarations compile.

import (
	_ "unsafe" // for go:linkname
)

//go:linkname linkParseEntity github.com/88250/lute/html.parseEntity
func linkParseEntity(s string) (string, int)

//go:linkname linkUnescape github.com/88250/lute/html.unescape
func linkUnescape(b []byte, attribute bool) []byte

//go:linkname linkUnescapeEntity github.com/88250/lute/html.unescapeEntity
func linkUnescapeEntity(b []byte, dst, src int, attribute bool) (int, int)

//go:linkname linkLower github.com/88250/lute/html.lower
func linkLower(b []byte) []byte

//go:linkname linkIsValidEntityCode github.com/88250/lute/html.isValidEntityCode
func linkIsValidEntityCode(c int64) bool

//go:linkname linkUnhex github.com/88250/lute/html.unhex
func linkUnhex(b byte) byte

//go:linkname linkAdvance github.com/88250/lute/html.advance
func linkAdvance(s []byte, pos int) (byte, int)
