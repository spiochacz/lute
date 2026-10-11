// Ported from html/token.go @ 8e7896b6
// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// PORT-NOTE: The Go Tokenizer reads from an io.Reader in chunks. This port takes the
// whole input as a Uint8Array (NewTokenizer(buf), NewTokenizerFragment(buf, contextTag)),
// and z.buf is a private copy of that array (see the second PORT-NOTE below). readByte returns
// the next byte, or sets z.err
// to EOF when the input is exhausted. The following Go code is omitted (Go line numbers):
//   - line 10 `"io"` (replaced by runtime/io.ts, which has EOF only).
//   - line 134 field `r io.Reader`.
//   - lines 145-149 field `readErr error` and its comment.
//   - lines 154-155 field `maxBuf int` and its comment. SetMaxBuf (lines 1192-1196) is
//     omitted too: nothing in Lute calls it, and the buffer is never refilled.
//   - lines 240-284 of readByte: the refill branch (buffer compaction, span rebasing
//     of data, pendingAttr and attr, and the read from z.r).
//   - lines 287-290 of readByte: the maxBuf check.
//   - lines 299-310 readAtLeastOneByte.
//   - in NewTokenizerFragment, the `r` parameter and `make([]byte, 0, 4096)`.
// ErrBufferExceeded is kept as in Go (nothing returns it now).
//
// PORT-NOTE: In place mutation. Go's code changes z.buf in place in three places:
// convertNewlines (called by Text and TagAttr), lower (TagName and TagAttr) and
// unescape (Text and TagAttr). This port does the same on z.buf, which is a private copy
// of the input made by NewTokenizer and NewTokenizerFragment, so the caller's array is
// never modified, as in Go. The Raw, Text, TagName and TagAttr results are views of that
// copy.

import * as atom from "./atom/index.ts";
import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as slices from "../runtime/slices.ts";
import * as strconv from "../runtime/strconv.ts";
import * as strings from "../runtime/strings.ts";
import { EOF } from "../runtime/io.ts";
import * as editor from "../editor/index.ts";
import { escape, EscapeString, lower, unescape } from "./escape.ts";

// A TokenType is the type of a Token.
export type TokenType = number;

// ErrorToken means that an error occurred during tokenization.
export const ErrorToken = 0;
// TextToken means a text node.
export const TextToken = 1;
// A StartTagToken looks like <a>.
export const StartTagToken = 2;
// An EndTagToken looks like </a>.
export const EndTagToken = 3;
// A SelfClosingTagToken tag looks like <br/>.
export const SelfClosingTagToken = 4;
// A CommentToken looks like <!--x-->.
export const CommentToken = 5;
// A DoctypeToken looks like <!DOCTYPE x>
export const DoctypeToken = 6;

// ErrBufferExceeded means that the buffering limit was exceeded.
export const ErrBufferExceeded = new Error("max buffer exceeded");

// TokenTypeString returns a string representation of the TokenType.
// PORT-NOTE: Go's method TokenType.String, ported as a free function (see PORTING.md).
export function TokenTypeString(t: TokenType): string {
  switch (t) {
    case ErrorToken:
      return "Error";
    case TextToken:
      return "Text";
    case StartTagToken:
      return "StartTag";
    case EndTagToken:
      return "EndTag";
    case SelfClosingTagToken:
      return "SelfClosingTag";
    case CommentToken:
      return "Comment";
    case DoctypeToken:
      return "Doctype";
  }
  return "Invalid(" + strconv.Itoa(t) + ")";
}

// An Attribute is an attribute namespace-key-value triple. Namespace is
// non-empty for foreign attributes like xlink, Key is alphabetic (and hence
// does not contain escapable characters like '&', '<' or '>'), and Val is
// unescaped (it looks like "a<b" rather than "a&lt;b").
//
// Namespace is only used by the parser, not the tokenizer.
export class Attribute {
  Namespace: string;
  Key: string;
  Val: string;

  constructor() {
    this.Namespace = "";
    this.Key = "";
    this.Val = "";
  }
}

// A Token consists of a TokenType and some Data (tag name for start and end
// tags, content for text, comments and doctypes). A tag Token may also contain
// a slice of Attributes. Data is unescaped for all Tokens (it looks like "a<b"
// rather than "a&lt;b"). For tag Tokens, DataAtom is the atom for Data, or
// zero if Data is not a known tag name.
export class Token {
  Type: TokenType;
  DataAtom: atom.Atom;
  Data: string;
  Attr: Attribute[];

  constructor() {
    this.Type = ErrorToken;
    this.DataAtom = 0;
    this.Data = "";
    this.Attr = [];
  }

  // tagString returns a string representation of a tag Token's Data and Attr.
  tagString(): string {
    if (this.Attr.length === 0) {
      return this.Data;
    }
    const buf = bytes.NewBufferString(this.Data);
    for (const a of this.Attr) {
      if (a.Key === editor.CaretReplacement) {
        buf.WriteString(editor.CaretReplacement);
        continue;
      }
      buf.WriteByte(0x20); // ' '
      buf.WriteString(a.Key);
      buf.WriteString('="');
      escape(buf, a.Val);
      buf.WriteByte(0x22); // '"'
    }
    return buf.String();
  }

  // String returns a string representation of the Token.
  String(): string {
    switch (this.Type) {
      case ErrorToken:
        return "";
      case TextToken:
        return EscapeString(this.Data);
      case StartTagToken:
        return "<" + this.tagString() + ">";
      case EndTagToken:
        return "</" + this.tagString() + ">";
      case SelfClosingTagToken:
        return "<" + this.tagString() + "/>";
      case CommentToken:
        return "<!--" + this.Data + "-->";
      case DoctypeToken:
        return "<!DOCTYPE " + this.Data + ">";
    }
    return "Invalid(" + strconv.Itoa(this.Type) + ")";
  }
}

// span is a range of bytes in a Tokenizer's buffer. The start is inclusive,
// the end is exclusive.
class span {
  start: number;
  end: number;

  constructor() {
    this.start = 0;
    this.end = 0;
  }
}

// copySpan returns a copy of s. Go's [2]span is a value type, so the attr list
// stores copies of pendingAttr; a TypeScript array of span objects would alias.
// PORT-NOTE: Go value copy of a [2]span element, see Tokenizer.attr.
function copySpan(s: span): span {
  const c = new span();
  c.start = s.start;
  c.end = s.end;
  return c;
}

// nul and replacement are the NUL byte and U+FFFD as byte slices.
const nul: Uint8Array = conv.BytesFromString("\x00");
const replacement: Uint8Array = conv.BytesFromString("�");

// A Tokenizer returns a stream of HTML Tokens.
export class Tokenizer {
  // tt is the TokenType of the current token.
  tt: TokenType;
  // err is the first error encountered during tokenization. It is possible
  // for tt != Error && err != nil to hold: this means that Next returned a
  // valid token but the subsequent Next call will return an error token.
  // For example, if the HTML text input was just "plain", then the first
  // Next call would set z.err to io.EOF but return a TextToken, and all
  // subsequent Next calls would return an ErrorToken.
  // err is never reset. Once it becomes non-nil, it stays non-nil.
  err: Error | null;
  // buf[raw.start:raw.end] holds the raw bytes of the current token.
  // buf[raw.end:] is buffered input that will yield future tokens.
  raw: span;
  buf: Uint8Array;
  // buf[data.start:data.end] holds the raw bytes of the current token's data:
  // a text token's text, a tag token's tag name, etc.
  data: span;
  // pendingAttr is the attribute key and value currently being tokenized.
  // When complete, pendingAttr is pushed onto attr. nAttrReturned is
  // incremented on each call to TagAttr.
  pendingAttr: [span, span];
  attr: [span, span][];
  nAttrReturned: number;
  // rawTag is the "script" in "</script>" that closes the next token. If
  // non-empty, the subsequent call to Next will return a raw or RCDATA text
  // token: one that treats "<p>" as text instead of an element.
  // rawTag's contents are lower-cased.
  rawTag: string;
  // textIsRaw is whether the current text token's data is not escaped.
  textIsRaw: boolean;
  // convertNUL is whether NUL bytes in the current token's data should
  // be converted into � replacement characters.
  convertNUL: boolean;
  // allowCDATA is whether CDATA sections are allowed in the current context.
  allowCDATA: boolean;

  constructor() {
    this.tt = ErrorToken;
    this.err = null;
    this.raw = new span();
    this.buf = new Uint8Array(0);
    this.data = new span();
    this.pendingAttr = [new span(), new span()];
    this.attr = [];
    this.nAttrReturned = 0;
    this.rawTag = "";
    this.textIsRaw = false;
    this.convertNUL = false;
    this.allowCDATA = false;
  }

  // AllowCDATA sets whether or not the tokenizer recognizes <![CDATA[foo]]> as
  // the text "foo". The default value is false, which means to recognize it as
  // a bogus comment "<!-- [CDATA[foo]] -->" instead.
  //
  // Strictly speaking, an HTML5 compliant tokenizer should allow CDATA if and
  // only if tokenizing foreign content, such as MathML and SVG. However,
  // tracking foreign-contentness is difficult to do purely in the tokenizer,
  // as opposed to the parser, due to HTML integration points: an <svg> element
  // can contain a <foreignObject> that is foreign-to-SVG but not foreign-to-
  // HTML. For strict compliance with the HTML5 tokenization algorithm, it is the
  // responsibility of the user of a tokenizer to call AllowCDATA as appropriate.
  // In practice, if using the tokenizer without caring whether MathML or SVG
  // CDATA is text or comments, such as tokenizing HTML to find all the anchor
  // text, it is acceptable to ignore this responsibility.
  AllowCDATA(allowCDATA: boolean): void {
    this.allowCDATA = allowCDATA;
  }

  // NextIsNotRawText instructs the tokenizer that the next token should not be
  // considered as 'raw text'. Some elements, such as script and title elements,
  // normally require the next token after the opening tag to be 'raw text' that
  // has no child elements. For example, tokenizing "<title>a<b>c</b>d</title>"
  // yields a start tag token for "<title>", a text token for "a<b>c</b>d", and
  // an end tag token for "</title>". There are no distinct start tag or end tag
  // tokens for the "<b>" and "</b>".
  //
  // This tokenizer implementation will generally look for raw text at the right
  // times. Strictly speaking, an HTML5 compliant tokenizer should not look for
  // raw text if in foreign content: <title> generally needs raw text, but a
  // <title> inside an <svg> does not. Another example is that a <textarea>
  // generally needs raw text, but a <textarea> is not allowed as an immediate
  // child of a <select>; in normal parsing, a <textarea> implies </select>, but
  // one cannot close the implicit element when parsing a <select>'s InnerHTML.
  // Similarly to AllowCDATA, tracking the correct moment to override raw-text-
  // ness is difficult to do purely in the tokenizer, as opposed to the parser.
  // For strict compliance with the HTML5 tokenization algorithm, it is the
  // responsibility of the user of a tokenizer to call NextIsNotRawText as
  // appropriate. In practice, like AllowCDATA, it is acceptable to ignore this
  // responsibility for basic usage.
  //
  // Note that this 'raw text' concept is different from the one offered by the
  // Tokenizer.Raw method.
  NextIsNotRawText(): void {
    this.rawTag = "";
  }

  // Err returns the error associated with the most recent ErrorToken token.
  // This is typically io.EOF, meaning the end of tokenization.
  Err(): Error | null {
    if (this.tt !== ErrorToken) {
      return null;
    }
    return this.err;
  }

  // readByte returns the next byte from the input stream. z.buf[z.raw.start:z.raw.end]
  // remains a contiguous byte slice that holds all the bytes read so far for the
  // current token. It sets z.err when the input is exhausted.
  // Pre-condition: z.err == nil.
  readByte(): number {
    if (this.raw.end >= this.buf.length) {
      this.err = EOF;
      return 0;
    }
    const x = this.buf[this.raw.end];
    this.raw.end++;
    return x;
  }

  // Buffered returns a slice containing data buffered but not yet tokenized.
  Buffered(): Uint8Array {
    return this.buf.subarray(this.raw.end);
  }

  // skipWhiteSpace skips past any white space.
  skipWhiteSpace(): void {
    if (this.err !== null) {
      return;
    }
    for (;;) {
      const c = this.readByte();
      if (this.err !== null) {
        return;
      }
      switch (c) {
        case 0x20: // ' '
        case 0x0a: // '\n'
        case 0x0d: // '\r'
        case 0x09: // '\t'
        case 0x0c: // '\f'
          // No-op.
          break;
        default:
          this.raw.end--;
          return;
      }
    }
  }

  // readRawOrRCDATA reads until the next "</foo>", where "foo" is z.rawTag and
  // is typically something like "script" or "textarea".
  readRawOrRCDATA(): void {
    if (this.rawTag === "script") {
      this.readScript();
      this.textIsRaw = true;
      this.rawTag = "";
      return;
    }
    loop: for (;;) {
      let c = this.readByte();
      if (this.err !== null) {
        break loop;
      }
      if (c !== 0x3c) {
        // '<'
        continue loop;
      }
      c = this.readByte();
      if (this.err !== null) {
        break loop;
      }
      if (c !== 0x2f) {
        // '/'
        continue loop;
      }
      if (this.readRawEndTag() || this.err !== null) {
        break loop;
      }
    }
    this.data.end = this.raw.end;
    // A textarea's or title's RCDATA can contain escaped entities.
    this.textIsRaw = this.rawTag !== "textarea" && this.rawTag !== "title";
    this.rawTag = "";
  }

  // readRawEndTag attempts to read a tag like "</foo>", where "foo" is z.rawTag.
  // If it succeeds, it backs up the input position to reconsume the tag and
  // returns true. Otherwise it returns false. The opening "</" has already been
  // consumed.
  readRawEndTag(): boolean {
    for (let i = 0; i < this.rawTag.length; i++) {
      const c = this.readByte();
      if (this.err !== null) {
        return false;
      }
      const t = this.rawTag.charCodeAt(i);
      if (c !== t && c !== t - (0x61 - 0x41)) {
        this.raw.end--;
        return false;
      }
    }
    const c = this.readByte();
    if (this.err !== null) {
      return false;
    }
    switch (c) {
      case 0x20: // ' '
      case 0x0a: // '\n'
      case 0x0d: // '\r'
      case 0x09: // '\t'
      case 0x0c: // '\f'
      case 0x2f: // '/'
      case 0x3e: // '>'
        // The 3 is 2 for the leading "</" plus 1 for the trailing character c.
        this.raw.end -= 3 + this.rawTag.length;
        return true;
    }
    this.raw.end--;
    return false;
  }

  // readScript reads until the next </script> tag, following the byzantine
  // rules for escaping/hiding the closing tag.
  // PORT-NOTE: Go's goto labels are the state names of a loop with a switch.
  readScript(): void {
    try {
      let c = 0;
      let state = "scriptData";
      sm: for (;;) {
        switch (state) {
          case "scriptData":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            if (c === 0x3c) {
              // '<'
              state = "scriptDataLessThanSign";
            } else {
              state = "scriptData";
            }
            continue sm;

          case "scriptDataLessThanSign":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            switch (c) {
              case 0x2f: // '/'
                state = "scriptDataEndTagOpen";
                continue sm;
              case 0x21: // '!'
                state = "scriptDataEscapeStart";
                continue sm;
            }
            this.raw.end--;
            state = "scriptData";
            continue sm;

          case "scriptDataEndTagOpen":
            if (this.readRawEndTag() || this.err !== null) {
              return;
            }
            state = "scriptData";
            continue sm;

          case "scriptDataEscapeStart":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            if (c === 0x2d) {
              // '-'
              state = "scriptDataEscapeStartDash";
              continue sm;
            }
            this.raw.end--;
            state = "scriptData";
            continue sm;

          case "scriptDataEscapeStartDash":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            if (c === 0x2d) {
              // '-'
              state = "scriptDataEscapedDashDash";
              continue sm;
            }
            this.raw.end--;
            state = "scriptData";
            continue sm;

          case "scriptDataEscaped":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            switch (c) {
              case 0x2d: // '-'
                state = "scriptDataEscapedDash";
                continue sm;
              case 0x3c: // '<'
                state = "scriptDataEscapedLessThanSign";
                continue sm;
            }
            state = "scriptDataEscaped";
            continue sm;

          case "scriptDataEscapedDash":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            switch (c) {
              case 0x2d: // '-'
                state = "scriptDataEscapedDashDash";
                continue sm;
              case 0x3c: // '<'
                state = "scriptDataEscapedLessThanSign";
                continue sm;
            }
            state = "scriptDataEscaped";
            continue sm;

          case "scriptDataEscapedDashDash":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            switch (c) {
              case 0x2d: // '-'
                state = "scriptDataEscapedDashDash";
                continue sm;
              case 0x3c: // '<'
                state = "scriptDataEscapedLessThanSign";
                continue sm;
              case 0x3e: // '>'
                state = "scriptData";
                continue sm;
            }
            state = "scriptDataEscaped";
            continue sm;

          case "scriptDataEscapedLessThanSign":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            if (c === 0x2f) {
              // '/'
              state = "scriptDataEscapedEndTagOpen";
              continue sm;
            }
            if ((0x61 <= c && c <= 0x7a) || (0x41 <= c && c <= 0x5a)) {
              state = "scriptDataDoubleEscapeStart";
              continue sm;
            }
            this.raw.end--;
            state = "scriptData";
            continue sm;

          case "scriptDataEscapedEndTagOpen":
            if (this.readRawEndTag() || this.err !== null) {
              return;
            }
            state = "scriptDataEscaped";
            continue sm;

          case "scriptDataDoubleEscapeStart":
            this.raw.end--;
            for (let i = 0; i < "script".length; i++) {
              c = this.readByte();
              if (this.err !== null) {
                return;
              }
              if (c !== "script".charCodeAt(i) && c !== "SCRIPT".charCodeAt(i)) {
                this.raw.end--;
                state = "scriptDataEscaped";
                continue sm;
              }
            }
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            switch (c) {
              case 0x20: // ' '
              case 0x0a: // '\n'
              case 0x0d: // '\r'
              case 0x09: // '\t'
              case 0x0c: // '\f'
              case 0x2f: // '/'
              case 0x3e: // '>'
                state = "scriptDataDoubleEscaped";
                continue sm;
            }
            this.raw.end--;
            state = "scriptDataEscaped";
            continue sm;

          case "scriptDataDoubleEscaped":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            switch (c) {
              case 0x2d: // '-'
                state = "scriptDataDoubleEscapedDash";
                continue sm;
              case 0x3c: // '<'
                state = "scriptDataDoubleEscapedLessThanSign";
                continue sm;
            }
            state = "scriptDataDoubleEscaped";
            continue sm;

          case "scriptDataDoubleEscapedDash":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            switch (c) {
              case 0x2d: // '-'
                state = "scriptDataDoubleEscapedDashDash";
                continue sm;
              case 0x3c: // '<'
                state = "scriptDataDoubleEscapedLessThanSign";
                continue sm;
            }
            state = "scriptDataDoubleEscaped";
            continue sm;

          case "scriptDataDoubleEscapedDashDash":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            switch (c) {
              case 0x2d: // '-'
                state = "scriptDataDoubleEscapedDashDash";
                continue sm;
              case 0x3c: // '<'
                state = "scriptDataDoubleEscapedLessThanSign";
                continue sm;
              case 0x3e: // '>'
                state = "scriptData";
                continue sm;
            }
            state = "scriptDataDoubleEscaped";
            continue sm;

          case "scriptDataDoubleEscapedLessThanSign":
            c = this.readByte();
            if (this.err !== null) {
              return;
            }
            if (c === 0x2f) {
              // '/'
              state = "scriptDataDoubleEscapeEnd";
              continue sm;
            }
            this.raw.end--;
            state = "scriptDataDoubleEscaped";
            continue sm;

          case "scriptDataDoubleEscapeEnd":
            if (this.readRawEndTag()) {
              this.raw.end += "</script>".length;
              state = "scriptDataEscaped";
              continue sm;
            }
            if (this.err !== null) {
              return;
            }
            state = "scriptDataDoubleEscaped";
            continue sm;

          default:
            throw new Error("readScript: unknown state " + state);
        }
      }
    } finally {
      this.data.end = this.raw.end;
    }
  }

  // readComment reads the next comment token starting with "<!--". The opening
  // "<!--" has already been consumed.
  readComment(): void {
    this.data.start = this.raw.end;
    try {
      for (let dashCount = 2; ; ) {
        let c = this.readByte();
        if (this.err !== null) {
          // Ignore up to two dashes at EOF.
          if (dashCount > 2) {
            dashCount = 2;
          }
          this.data.end = this.raw.end - dashCount;
          return;
        }
        switch (c) {
          case 0x2d: // '-'
            dashCount++;
            continue;
          case 0x3e: // '>'
            if (dashCount >= 2) {
              this.data.end = this.raw.end - "-->".length;
              return;
            }
            break;
          case 0x21: // '!'
            if (dashCount >= 2) {
              c = this.readByte();
              if (this.err !== null) {
                this.data.end = this.raw.end;
                return;
              }
              if (c === 0x3e) {
                // '>'
                this.data.end = this.raw.end - "--!>".length;
                return;
              }
            }
            break;
        }
        dashCount = 0;
      }
    } finally {
      if (this.data.end < this.data.start) {
        // It's a comment with no data, like <!-->.
        this.data.end = this.data.start;
      }
    }
  }

  // readUntilCloseAngle reads until the next ">".
  readUntilCloseAngle(): void {
    this.data.start = this.raw.end;
    for (;;) {
      const c = this.readByte();
      if (this.err !== null) {
        this.data.end = this.raw.end;
        return;
      }
      if (c === 0x3e) {
        // '>'
        this.data.end = this.raw.end - ">".length;
        return;
      }
    }
  }

  // readMarkupDeclaration reads the next token starting with "<!". It might be
  // a "<!--comment-->", a "<!DOCTYPE foo>", a "<![CDATA[section]]>" or
  // "<!a bogus comment". The opening "<!" has already been consumed.
  readMarkupDeclaration(): TokenType {
    this.data.start = this.raw.end;
    const c: Uint8Array = new Uint8Array(2);
    for (let i = 0; i < 2; i++) {
      c[i] = this.readByte();
      if (this.err !== null) {
        this.data.end = this.raw.end;
        return CommentToken;
      }
    }
    if (c[0] === 0x2d && c[1] === 0x2d) {
      // "--"
      this.readComment();
      return CommentToken;
    }
    this.raw.end -= 2;
    if (this.readDoctype()) {
      return DoctypeToken;
    }
    if (this.allowCDATA && this.readCDATA()) {
      this.convertNUL = true;
      return TextToken;
    }
    // It's a bogus comment.
    this.readUntilCloseAngle();
    return CommentToken;
  }

  // readDoctype attempts to read a doctype declaration and returns true if
  // successful. The opening "<!" has already been consumed.
  readDoctype(): boolean {
    const s = "DOCTYPE";
    for (let i = 0; i < s.length; i++) {
      const c = this.readByte();
      if (this.err !== null) {
        this.data.end = this.raw.end;
        return false;
      }
      if (c !== s.charCodeAt(i) && c !== s.charCodeAt(i) + (0x61 - 0x41)) {
        // Back up to read the fragment of "DOCTYPE" again.
        this.raw.end = this.data.start;
        return false;
      }
    }
    this.skipWhiteSpace();
    if (this.err !== null) {
      this.data.start = this.raw.end;
      this.data.end = this.raw.end;
      return true;
    }
    this.readUntilCloseAngle();
    return true;
  }

  // readCDATA attempts to read a CDATA section and returns true if
  // successful. The opening "<!" has already been consumed.
  readCDATA(): boolean {
    const s = "[CDATA[";
    for (let i = 0; i < s.length; i++) {
      const c = this.readByte();
      if (this.err !== null) {
        this.data.end = this.raw.end;
        return false;
      }
      if (c !== s.charCodeAt(i)) {
        // Back up to read the fragment of "[CDATA[" again.
        this.raw.end = this.data.start;
        return false;
      }
    }
    this.data.start = this.raw.end;
    let brackets = 0;
    for (;;) {
      const c = this.readByte();
      if (this.err !== null) {
        this.data.end = this.raw.end;
        return true;
      }
      switch (c) {
        case 0x5d: // ']'
          brackets++;
          break;
        case 0x3e: // '>'
          if (brackets >= 2) {
            this.data.end = this.raw.end - "]]>".length;
            return true;
          }
          brackets = 0;
          break;
        default:
          brackets = 0;
          break;
      }
    }
  }

  // startTagIn returns whether the start tag in z.buf[z.data.start:z.data.end]
  // case-insensitively matches any element of ss.
  startTagIn(...ss: string[]): boolean {
    loop: for (const s of ss) {
      if (this.data.end - this.data.start !== s.length) {
        continue loop;
      }
      for (let i = 0; i < s.length; i++) {
        let c = this.buf[this.data.start + i];
        if (0x41 <= c && c <= 0x5a) {
          // 'A' <= c <= 'Z'
          c += 0x61 - 0x41;
        }
        if (c !== s.charCodeAt(i)) {
          continue loop;
        }
      }
      return true;
    }
    return false;
  }

  // readStartTag reads the next start tag token. The opening "<a" has already been
  // consumed, where 'a' means anything in [A-Za-z].
  readStartTag(): TokenType {
    this.readTag(true);
    if (this.err !== null) {
      return ErrorToken;
    }
    // Several tags flag the tokenizer's next token as raw.
    let c = this.buf[this.data.start];
    let raw = false;
    if (0x41 <= c && c <= 0x5a) {
      // 'A' <= c <= 'Z'
      c += 0x61 - 0x41;
    }
    switch (c) {
      case 0x69: // 'i'
        raw = this.startTagIn("iframe");
        break;
      case 0x6e: // 'n'
        raw = this.startTagIn("noembed", "noframes", "noscript");
        break;
      case 0x70: // 'p'
        raw = this.startTagIn("plaintext");
        break;
      case 0x73: // 's'
        raw = this.startTagIn("script", "style");
        break;
      case 0x74: // 't'
        raw = this.startTagIn("textarea", "title");
        break;
      case 0x78: // 'x'
        raw = this.startTagIn("xmp");
        break;
    }
    if (raw) {
      this.rawTag = strings.ToLower(conv.StringFromBytes(this.buf.subarray(this.data.start, this.data.end)));
    }
    // Look for a self-closing token like "<br/>".
    if (this.err === null && this.buf[this.raw.end - 2] === 0x2f) {
      // '/'
      return SelfClosingTagToken;
    }
    return StartTagToken;
  }

  // readTag reads the next tag token and its attributes. If saveAttr, those
  // attributes are saved in z.attr, otherwise z.attr is set to an empty slice.
  // The opening "<a" or "</a" has already been consumed, where 'a' means anything
  // in [A-Za-z].
  readTag(saveAttr: boolean): void {
    this.attr.length = 0;
    this.nAttrReturned = 0;
    // Read the tag name and attribute key/value pairs.
    this.readTagName();
    this.skipWhiteSpace();
    if (this.err !== null) {
      return;
    }
    for (;;) {
      const c = this.readByte();
      if (this.err !== null || c === 0x3e) {
        // '>'
        break;
      }
      this.raw.end--;
      this.readTagAttrKey();
      this.readTagAttrVal();
      // Save pendingAttr if saveAttr and that attribute has a non-empty key.
      if (saveAttr && this.pendingAttr[0].start !== this.pendingAttr[0].end) {
        this.attr.push([copySpan(this.pendingAttr[0]), copySpan(this.pendingAttr[1])]);
      }
      this.skipWhiteSpace();
      if (this.err !== null) {
        break;
      }
    }
  }

  // readTagName sets z.data to the "div" in "<div k=v>". The reader (z.raw.end)
  // is positioned such that the first byte of the tag name (the "d" in "<div")
  // has already been consumed.
  readTagName(): void {
    this.data.start = this.raw.end - 1;
    for (;;) {
      const c = this.readByte();
      if (this.err !== null) {
        this.data.end = this.raw.end;
        return;
      }
      switch (c) {
        case 0x20: // ' '
        case 0x0a: // '\n'
        case 0x0d: // '\r'
        case 0x09: // '\t'
        case 0x0c: // '\f'
          this.data.end = this.raw.end - 1;
          return;
        case 0x2f: // '/'
        case 0x3e: // '>'
          this.raw.end--;
          this.data.end = this.raw.end;
          return;
      }
    }
  }

  // readTagAttrKey sets z.pendingAttr[0] to the "k" in "<div k=v>".
  // Precondition: z.err == nil.
  readTagAttrKey(): void {
    this.pendingAttr[0].start = this.raw.end;
    for (;;) {
      const c = this.readByte();
      if (this.err !== null) {
        this.pendingAttr[0].end = this.raw.end;
        return;
      }
      switch (c) {
        case 0x20: // ' '
        case 0x0a: // '\n'
        case 0x0d: // '\r'
        case 0x09: // '\t'
        case 0x0c: // '\f'
        case 0x2f: // '/'
          this.pendingAttr[0].end = this.raw.end - 1;
          return;
        case 0x3d: // '='
        case 0x3e: // '>'
          this.raw.end--;
          this.pendingAttr[0].end = this.raw.end;
          return;
      }
    }
  }

  // readTagAttrVal sets z.pendingAttr[1] to the "v" in "<div k=v>".
  readTagAttrVal(): void {
    this.pendingAttr[1].start = this.raw.end;
    this.pendingAttr[1].end = this.raw.end;
    this.skipWhiteSpace();
    if (this.err !== null) {
      return;
    }
    let c = this.readByte();
    if (this.err !== null) {
      return;
    }
    if (c !== 0x3d) {
      // '='
      this.raw.end--;
      return;
    }
    this.skipWhiteSpace();
    if (this.err !== null) {
      return;
    }
    const quote = this.readByte();
    if (this.err !== null) {
      return;
    }
    switch (quote) {
      case 0x3e: // '>'
        this.raw.end--;
        return;

      case 0x27: // '\''
      case 0x22: // '"'
        this.pendingAttr[1].start = this.raw.end;
        for (;;) {
          c = this.readByte();
          if (this.err !== null) {
            this.pendingAttr[1].end = this.raw.end;
            return;
          }
          if (c === quote) {
            this.pendingAttr[1].end = this.raw.end - 1;
            return;
          }
        }

      default:
        this.pendingAttr[1].start = this.raw.end - 1;
        for (;;) {
          c = this.readByte();
          if (this.err !== null) {
            this.pendingAttr[1].end = this.raw.end;
            return;
          }
          switch (c) {
            case 0x20: // ' '
            case 0x0a: // '\n'
            case 0x0d: // '\r'
            case 0x09: // '\t'
            case 0x0c: // '\f'
              this.pendingAttr[1].end = this.raw.end - 1;
              return;
            case 0x3e: // '>'
              this.raw.end--;
              this.pendingAttr[1].end = this.raw.end;
              return;
          }
        }
    }
  }

  // Next scans the next token and returns its type.
  Next(): TokenType {
    this.raw.start = this.raw.end;
    this.data.start = this.raw.end;
    this.data.end = this.raw.end;
    if (this.err !== null) {
      this.tt = ErrorToken;
      return this.tt;
    }
    if (this.rawTag !== "") {
      if (this.rawTag === "plaintext") {
        // Read everything up to EOF.
        while (this.err === null) {
          this.readByte();
        }
        this.data.end = this.raw.end;
        this.textIsRaw = true;
      } else {
        this.readRawOrRCDATA();
      }
      if (this.data.end > this.data.start) {
        this.tt = TextToken;
        this.convertNUL = true;
        return this.tt;
      }
    }
    this.textIsRaw = false;
    this.convertNUL = false;

    loop: for (;;) {
      let c = this.readByte();
      if (this.err !== null) {
        break loop;
      }
      if (c !== 0x3c) {
        // '<'
        continue loop;
      }

      // Check if the '<' we have just read is part of a tag, comment
      // or doctype. If not, it's part of the accumulated text token.
      c = this.readByte();
      if (this.err !== null) {
        break loop;
      }
      let tokenType: TokenType;
      if ((0x61 <= c && c <= 0x7a) || (0x41 <= c && c <= 0x5a)) {
        tokenType = StartTagToken;
      } else if (c === 0x2f) {
        // '/'
        tokenType = EndTagToken;
      } else if (c === 0x21 || c === 0x3f) {
        // '!' or '?'
        // We use CommentToken to mean any of "<!--actual comments-->",
        // "<!DOCTYPE declarations>" and "<?xml processing instructions?>".
        tokenType = CommentToken;
      } else {
        // Reconsume the current character.
        this.raw.end--;
        continue loop;
      }

      // We have a non-text token, but we might have accumulated some text
      // before that. If so, we return the text first, and return the non-
      // text token on the subsequent call to Next.
      const x = this.raw.end - 2; // len("<a")
      if (this.raw.start < x) {
        this.raw.end = x;
        this.data.end = x;
        this.tt = TextToken;
        return this.tt;
      }
      switch (tokenType) {
        case StartTagToken:
          this.tt = this.readStartTag();
          return this.tt;
        case EndTagToken:
          c = this.readByte();
          if (this.err !== null) {
            break loop;
          }
          if (c === 0x3e) {
            // "</>" does not generate a token at all. Generate an empty comment
            // to allow passthrough clients to pick up the data using Raw.
            // Reset the tokenizer state and start again.
            this.tt = CommentToken;
            return this.tt;
          }
          if ((0x61 <= c && c <= 0x7a) || (0x41 <= c && c <= 0x5a)) {
            this.readTag(false);
            if (this.err !== null) {
              this.tt = ErrorToken;
            } else {
              this.tt = EndTagToken;
            }
            return this.tt;
          }
          this.raw.end--;
          this.readUntilCloseAngle();
          this.tt = CommentToken;
          return this.tt;
        case CommentToken:
          if (c === 0x21) {
            // '!'
            this.tt = this.readMarkupDeclaration();
            return this.tt;
          }
          this.raw.end--;
          this.readUntilCloseAngle();
          this.tt = CommentToken;
          return this.tt;
      }
    }
    if (this.raw.start < this.raw.end) {
      this.data.end = this.raw.end;
      this.tt = TextToken;
      return this.tt;
    }
    this.tt = ErrorToken;
    return this.tt;
  }

  // Raw returns the unmodified text of the current token. Calling Next, Token,
  // Text, TagName or TagAttr may change the contents of the returned slice.
  Raw(): Uint8Array {
    return this.buf.subarray(this.raw.start, this.raw.end);
  }

  // Text returns the unescaped text of a text, comment or doctype token. The
  // contents of the returned slice may change on the next call to Next.
  // PORT-NOTE: Go returns nil for other token types; here an empty array is returned.
  // No caller compares the result with nil (html/doc.go and Token only use the bytes).
  Text(): Uint8Array {
    switch (this.tt) {
      case TextToken:
      case CommentToken:
      case DoctypeToken: {
        let s: Uint8Array = this.buf.subarray(this.data.start, this.data.end);
        this.data.start = this.raw.end;
        this.data.end = this.raw.end;
        s = convertNewlines(s);
        if ((this.convertNUL || this.tt === CommentToken) && bytes.Contains(s, nul)) {
          s = bytes.Replace(s, nul, replacement, -1);
        }
        if (!this.textIsRaw) {
          s = unescape(s, false);
        }
        return s;
      }
    }
    return new Uint8Array(0);
  }

  // TagName returns the lower-cased name of a tag token (the `img` out of
  // `<IMG SRC="foo">`) and whether the tag has attributes.
  // The contents of the returned slice may change on the next call to Next.
  // PORT-NOTE: Go returns (nil, false) for other token types; here (empty array, false).
  TagName(): [Uint8Array, boolean] {
    if (this.data.start < this.data.end) {
      switch (this.tt) {
        case StartTagToken:
        case EndTagToken:
        case SelfClosingTagToken: {
          const s = this.buf.subarray(this.data.start, this.data.end);
          this.data.start = this.raw.end;
          this.data.end = this.raw.end;
          return [lower(s), this.nAttrReturned < this.attr.length];
        }
      }
    }
    return [new Uint8Array(0), false];
  }

  // TagAttr returns the lower-cased key and unescaped value of the next unparsed
  // attribute for the current tag token and whether there are more attributes.
  // The contents of the returned slices may change on the next call to Next.
  // PORT-NOTE: Go returns (nil, nil, false) for other cases; here empty arrays.
  TagAttr(): [Uint8Array, Uint8Array, boolean] {
    if (this.nAttrReturned < this.attr.length) {
      switch (this.tt) {
        case StartTagToken:
        case SelfClosingTagToken: {
          const x = this.attr[this.nAttrReturned];
          this.nAttrReturned++;
          const key: Uint8Array = this.buf.subarray(x[0].start, x[0].end);
          const val: Uint8Array = this.buf.subarray(x[1].start, x[1].end);
          return [lower(key), unescape(convertNewlines(val), true), this.nAttrReturned < this.attr.length];
        }
      }
    }
    return [new Uint8Array(0), new Uint8Array(0), false];
  }

  // Token returns the current Token. The result's Data and Attr values remain
  // valid after subsequent Next calls.
  Token(): Token {
    const t = new Token();
    t.Type = this.tt;
    switch (this.tt) {
      case TextToken:
      case CommentToken:
      case DoctypeToken:
        t.Data = conv.StringFromBytes(this.Text());
        break;
      case StartTagToken:
      case SelfClosingTagToken:
      case EndTagToken: {
        const [name, moreAttr0] = this.TagName();
        let moreAttr = moreAttr0;
        while (moreAttr) {
          let key: Uint8Array = new Uint8Array(0);
          let val: Uint8Array = new Uint8Array(0);
          [key, val, moreAttr] = this.TagAttr();
          const a = new Attribute();
          a.Namespace = "";
          a.Key = atom.String(key);
          a.Val = conv.StringFromBytes(val);
          t.Attr.push(a);
        }
        const a = atom.Lookup(name);
        if (a !== 0) {
          t.DataAtom = a;
          t.Data = atom.AtomString(a);
        } else {
          t.DataAtom = 0;
          t.Data = conv.StringFromBytes(name);
        }
        break;
      }
    }
    return t;
  }
}

// convertNewlines converts "\r" and "\r\n" in s to "\n".
// The conversion happens in place, but the resulting slice may be shorter.
function convertNewlines(s: Uint8Array): Uint8Array {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== 0x0d) {
      // '\r'
      continue;
    }

    let src = i + 1;
    if (src >= s.length || s[src] !== 0x0a) {
      // '\n'
      s[i] = 0x0a;
      continue;
    }

    let dst = i;
    while (src < s.length) {
      if (s[src] === 0x0d) {
        if (src + 1 < s.length && s[src + 1] === 0x0a) {
          src++;
        }
        s[dst] = 0x0a;
      } else {
        s[dst] = s[src];
      }
      src++;
      dst++;
    }
    return s.subarray(0, dst);
  }
  return s;
}

// NewTokenizer returns a new HTML Tokenizer for the given input.
// The input is assumed to be UTF-8 encoded. The tokenizer works on a private copy of
// buf (see the PORT-NOTE at the top of this file), so buf is not modified.
export function NewTokenizer(buf: Uint8Array): Tokenizer {
  return NewTokenizerFragment(buf, "");
}

// NewTokenizerFragment returns a new HTML Tokenizer for the given input, for
// tokenizing an existing element's InnerHTML fragment. contextTag is that
// element's tag, such as "div" or "iframe".
//
// For example, how the InnerHTML "a<b" is tokenized depends on whether it is
// for a <p> tag or a <script> tag.
//
// The input is assumed to be UTF-8 encoded.
export function NewTokenizerFragment(buf: Uint8Array, contextTag: string): Tokenizer {
  const z = new Tokenizer();
  // PERF-TODO: one copy of the input per tokenizer.
  // PORT-NOTE: Go reads the input into its own buffer, so the caller's array is never
  // changed. Here the tokenizer edits z.buf in place, so it gets a private copy.
  z.buf = slices.Clone(buf);
  if (contextTag !== "") {
    const s = strings.ToLower(contextTag);
    switch (s) {
      case "iframe":
      case "noembed":
      case "noframes":
      case "noscript":
      case "plaintext":
      case "script":
      case "style":
      case "title":
      case "textarea":
      case "xmp":
        z.rawTag = s;
        break;
    }
  }
  return z;
}
