// Ported from parse/linkrefdef_case_foldjs.go @ 8e7896b6

// foldBytes does not do full Unicode case folding in the JS build, keeping the original bytes.EqualFold semantics,
// because importing golang.org/x/text/cases makes the bundle too large.
export function foldBytes(tokens: Uint8Array): Uint8Array {
  return tokens;
}
