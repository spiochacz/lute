// Port of the parts of Go's io package used by Lute, for the Lute TypeScript port.
//
// Go's io.EOF is a sentinel error value that callers compare by identity. Here it
// is an Error object with the same message, and callers compare it with ===.
// Port addition: there are no io.Reader or io.Writer types; every Lute caller
// passes its input as a string or a byte array.

// EOF is returned by a reader when no more input is available.
export const EOF = new Error("EOF");
