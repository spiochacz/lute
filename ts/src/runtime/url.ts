// Port of the parts of Go's net/url package used by Lute, for the Lute TypeScript
// port. Ported from Go 1.21 net/url/url.go (the reference build). Go 1.27 changed
// parseHost (netip validation of IP literals, strict colons for http/https) and
// adds the urlstrictcolons GODEBUG; those changes are NOT ported.
//
// Parse, parse, getScheme, parseAuthority, parseHost, setPath, setFragment,
// unescape, escape, shouldEscape, validUserinfo, validOptionalPort and
// stringContainsCTLByte follow the Go code. Not ported: EscapedPath,
// EscapedFragment, String, Query, ResolveReference, JoinPath, ParseQuery and
// the other methods, none of which Lute uses.
//
// PORT-NOTE: deliberate adaptations (byte input, error type):
// - Go parses bytes. Here the input is a JS string and the operations that
//   decode or encode percent escapes convert to UTF-8 bytes and back (conv
//   helpers). Invalid UTF-8 produced by an escape (for example %FF) therefore
//   becomes U+FFFD, the same lossy step as conv.StringFromBytes.
// - Go's *url.Error is returned as a plain Error whose message is
//   `parse "<url>": <cause>`. Only the nil or non-nil result is compared with Go.
// - The JS global URL class is not used: it disagrees with Go on many inputs.

import * as conv from "./conv.ts";
import * as strings from "./strings.ts";

// encoding modes (Go: type encoding int, iota starting at 1)
const encodePath = 1;
const encodePathSegment = 2;
const encodeHost = 3;
const encodeZone = 4;
const encodeUserPassword = 5;
const encodeQueryComponent = 6;
const encodeFragment = 7;

// upperhex is Go's "0123456789ABCDEF" used by escape.
const upperhex = "0123456789ABCDEF";

// Userinfo is Go's *url.Userinfo: username and password information.
export class Userinfo {
  username: string;
  password: string;
  passwordSet: boolean;

  constructor() {
    this.username = "";
    this.password = "";
    this.passwordSet = false;
  }
}

// User returns a Userinfo containing the provided username and no password set.
export function User(username: string): Userinfo {
  const u = new Userinfo();
  u.username = username;
  return u;
}

// UserPassword returns a Userinfo containing the provided username and password.
export function UserPassword(username: string, password: string): Userinfo {
  const u = new Userinfo();
  u.username = username;
  u.password = password;
  u.passwordSet = true;
  return u;
}

// URL represents a parsed URL (technically, a URI reference).
export class URL {
  Scheme: string;
  Opaque: string;
  User: Userinfo | null;
  Host: string;
  Path: string;
  RawPath: string;
  OmitHost: boolean;
  ForceQuery: boolean;
  RawQuery: string;
  Fragment: string;
  RawFragment: string;

  constructor() {
    this.Scheme = "";
    this.Opaque = "";
    this.User = null;
    this.Host = "";
    this.Path = "";
    this.RawPath = "";
    this.OmitHost = false;
    this.ForceQuery = false;
    this.RawQuery = "";
    this.Fragment = "";
    this.RawFragment = "";
  }

  // setPath sets the Path and RawPath fields based on the escaped path p.
  setPath(p: string): Error | null {
    const [pathBytes, err] = unescapeBytes(p, encodePath);
    if (err !== null) {
      return err;
    }
    this.Path = conv.StringFromBytes(pathBytes);
    // The RawPath decision is made on the bytes, as in Go, so an escape such as %FF
    // that is not valid UTF-8 still keeps RawPath as Go does.
    const escp = escapeBytes(pathBytes, encodePath);
    if (p === escp) {
      // Default encoding is fine.
      this.RawPath = "";
    } else {
      this.RawPath = p;
    }
    return null;
  }

  // setFragment is like setPath but for Fragment/RawFragment.
  setFragment(f: string): Error | null {
    const [fragBytes, err] = unescapeBytes(f, encodeFragment);
    if (err !== null) {
      return err;
    }
    this.Fragment = conv.StringFromBytes(fragBytes);
    const escf = escapeBytes(fragBytes, encodeFragment);
    if (f === escf) {
      // Default encoding is fine.
      this.RawFragment = "";
    } else {
      this.RawFragment = f;
    }
    return null;
  }
}

// urlError builds the message of Go's *url.Error (Op is always "parse" here).
export function urlError(rawURL: string, cause: string): Error {
  return new Error(`parse "${rawURL}": ${cause}`);
}

function ishex(c: number): boolean {
  if (0x30 <= c && c <= 0x39) {
    return true;
  }
  if (0x61 <= c && c <= 0x66) {
    return true;
  }
  if (0x41 <= c && c <= 0x46) {
    return true;
  }
  return false;
}

function unhex(c: number): number {
  if (0x30 <= c && c <= 0x39) {
    return c - 0x30;
  }
  if (0x61 <= c && c <= 0x66) {
    return c - 0x61 + 10;
  }
  if (0x41 <= c && c <= 0x46) {
    return c - 0x41 + 10;
  }
  return 0;
}

// shouldEscape reports whether byte c should be escaped in mode (RFC 3986).
function shouldEscape(c: number, mode: number): boolean {
  // §2.3 Unreserved characters (alphanum)
  if ((0x61 <= c && c <= 0x7a) || (0x41 <= c && c <= 0x5a) || (0x30 <= c && c <= 0x39)) {
    return false;
  }

  if (mode === encodeHost || mode === encodeZone) {
    // §3.2.2 Host allows sub-delims as part of reg-name. Also : [ ] < > ".
    switch (c) {
      case 0x21 /* ! */:
      case 0x24 /* $ */:
      case 0x26 /* & */:
      case 0x27 /* ' */:
      case 0x28 /* ( */:
      case 0x29 /* ) */:
      case 0x2a /* * */:
      case 0x2b /* + */:
      case 0x2c /* , */:
      case 0x3b /* ; */:
      case 0x3d /* = */:
      case 0x3a /* : */:
      case 0x5b /* [ */:
      case 0x5d /* ] */:
      case 0x3c /* < */:
      case 0x3e /* > */:
      case 0x22 /* " */:
        return false;
    }
  }

  switch (c) {
    case 0x2d /* - */:
    case 0x5f /* _ */:
    case 0x2e /* . */:
    case 0x7e /* ~ */:
      // §2.3 Unreserved characters (mark)
      return false;

    case 0x24 /* $ */:
    case 0x26 /* & */:
    case 0x2b /* + */:
    case 0x2c /* , */:
    case 0x2f /* / */:
    case 0x3a /* : */:
    case 0x3b /* ; */:
    case 0x3d /* = */:
    case 0x3f /* ? */:
    case 0x40 /* @ */:
      // §2.2 Reserved characters (reserved)
      switch (mode) {
        case encodePath:
          // §3.3: only ? needs escaping.
          return c === 0x3f;

        case encodePathSegment:
          // §3.3
          return c === 0x2f || c === 0x3b || c === 0x2c || c === 0x3f;

        case encodeUserPassword:
          // §3.2.1
          return c === 0x40 || c === 0x2f || c === 0x3f || c === 0x3a;

        case encodeQueryComponent:
          // §3.4: everything is reserved.
          return true;

        case encodeFragment:
          // §4.1: escape nothing.
          return false;
      }
  }

  if (mode === encodeFragment) {
    // RFC 3986 §2.2 sub-delims that do not need escaping in a fragment.
    switch (c) {
      case 0x21 /* ! */:
      case 0x28 /* ( */:
      case 0x29 /* ) */:
      case 0x2a /* * */:
        return false;
    }
  }

  // Everything else must be escaped.
  return true;
}

// EscapeError is Go's url.EscapeError, reduced to its message.
function escapeError(s: string): Error {
  return new Error(`invalid URL escape "${s}"`);
}

// InvalidHostError is Go's url.InvalidHostError, reduced to its message.
function invalidHostError(s: string): Error {
  return new Error(`invalid character "${s}" in host name`);
}

// unescapeBytes decodes percent escapes in s according to mode (Go unescape), returning bytes.
function unescapeBytes(s: string, mode: number): [Uint8Array, Error | null] {
  // PERF-TODO: converts the whole string to bytes even when it has no '%'.
  const b = conv.BytesFromString(s);

  // Count %, check that they're well-formed.
  let n = 0;
  let hasPlus = false;
  for (let i = 0; i < b.length; ) {
    switch (b[i]) {
      case 0x25 /* % */: {
        n++;
        if (i + 2 >= b.length || !ishex(b[i + 1]) || !ishex(b[i + 2])) {
          const end = Math.min(i + 3, b.length);
          return [new Uint8Array(0), escapeError(conv.StringFromBytes(b.subarray(i, end)))];
        }
        // Per RFC 3986 %-encoding in host is only for non-ASCII bytes, but
        // RFC 6874 allows %25 to escape a percent sign in IPv6 zone literals.
        const is25 = b[i + 1] === 0x32 && b[i + 2] === 0x35;
        if (mode === encodeHost && unhex(b[i + 1]) < 8 && !is25) {
          return [new Uint8Array(0), escapeError(conv.StringFromBytes(b.subarray(i, i + 3)))];
        }
        if (mode === encodeZone) {
          // RFC 6874 zone identifiers: the escaped byte must be one that is
          // valid as a host name byte, except space (Windows).
          const v = (unhex(b[i + 1]) << 4) | unhex(b[i + 2]);
          if (!is25 && v !== 0x20 && shouldEscape(v, encodeHost)) {
            return [new Uint8Array(0), escapeError(conv.StringFromBytes(b.subarray(i, i + 3)))];
          }
        }
        i += 3;
        break;
      }
      case 0x2b /* + */:
        hasPlus = mode === encodeQueryComponent;
        i++;
        break;
      default:
        if ((mode === encodeHost || mode === encodeZone) && b[i] < 0x80 && shouldEscape(b[i], mode)) {
          return [new Uint8Array(0), invalidHostError(conv.StringFromBytes(b.subarray(i, i + 1)))];
        }
        i++;
        break;
    }
  }

  if (n === 0 && !hasPlus) {
    return [b, null];
  }

  const t: number[] = [];
  for (let i = 0; i < b.length; i++) {
    switch (b[i]) {
      case 0x25 /* % */:
        t.push((unhex(b[i + 1]) << 4) | unhex(b[i + 2]));
        i += 2;
        break;
      case 0x2b /* + */:
        if (mode === encodeQueryComponent) {
          t.push(0x20 /* space */);
        } else {
          t.push(0x2b);
        }
        break;
      default:
        t.push(b[i]);
        break;
    }
  }
  return [new Uint8Array(t), null];
}

// unescape is unescapeBytes returning a JS string. Invalid UTF-8 produced by an escape becomes U+FFFD
// (conv.StringFromBytes), the lossy step described in the file header.
function unescape(s: string, mode: number): [string, Error | null] {
  const [b, err] = unescapeBytes(s, mode);
  if (err !== null) {
    return ["", err];
  }
  return [conv.StringFromBytes(b), null];
}

// escapeBytes escapes the bytes b so they can be placed in the given mode (Go escape).
// The result is always ASCII, because every byte that is not ASCII is escaped.
function escapeBytes(b: Uint8Array, mode: number): string {
  // PERF-TODO: scans the bytes twice (count, then build) and concatenates per character.
  let spaceCount = 0;
  let hexCount = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (shouldEscape(c, mode)) {
      if (c === 0x20 && mode === encodeQueryComponent) {
        spaceCount++;
      } else {
        hexCount++;
      }
    }
  }

  if (spaceCount === 0 && hexCount === 0) {
    return conv.StringFromBytes(b);
  }

  if (hexCount === 0) {
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) {
      out[i] = b[i] === 0x20 ? 0x2b : b[i];
    }
    return conv.StringFromBytes(out);
  }

  let res = "";
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 0x20 && mode === encodeQueryComponent) {
      res += "+";
    } else if (shouldEscape(c, mode)) {
      res += "%" + upperhex[c >> 4] + upperhex[c & 15];
    } else {
      res += String.fromCharCode(c);
    }
  }
  return res;
}

// validUserinfo reports whether s is valid userinfo (Go validUserinfo).
function validUserinfo(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const r = s.charCodeAt(i);
    if (0x41 <= r && r <= 0x5a) {
      continue;
    }
    if (0x61 <= r && r <= 0x7a) {
      continue;
    }
    if (0x30 <= r && r <= 0x39) {
      continue;
    }
    switch (r) {
      case 0x2d /* - */:
      case 0x2e /* . */:
      case 0x5f /* _ */:
      case 0x3a /* : */:
      case 0x7e /* ~ */:
      case 0x21 /* ! */:
      case 0x24 /* $ */:
      case 0x26 /* & */:
      case 0x27 /* ' */:
      case 0x28 /* ( */:
      case 0x29 /* ) */:
      case 0x2a /* * */:
      case 0x2b /* + */:
      case 0x2c /* , */:
      case 0x3b /* ; */:
      case 0x3d /* = */:
      case 0x25 /* % */:
      case 0x40 /* @ */:
        continue;
      default:
        return false;
    }
  }
  return true;
}

// stringContainsCTLByte reports whether s contains any ASCII control character.
// Code units >= 0x80 are not control characters, so UTF-16 and bytes agree.
function stringContainsCTLByte(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const b = s.charCodeAt(i);
    if (b < 0x20 || b === 0x7f) {
      return true;
    }
  }
  return false;
}

// validOptionalPort reports whether port is "" or matches /^:\d*$/.
function validOptionalPort(port: string): boolean {
  if (port === "") {
    return true;
  }
  if (port[0] !== ":") {
    return false;
  }
  for (let i = 1; i < port.length; i++) {
    const b = port.charCodeAt(i);
    if (b < 0x30 || b > 0x39) {
      return false;
    }
  }
  return true;
}

// getScheme splits off a leading scheme if rawURL has the form scheme:path
// (scheme must be [a-zA-Z][a-zA-Z0-9+.-]*). Otherwise it returns "", rawURL.
function getScheme(rawURL: string): [string, string, Error | null] {
  for (let i = 0; i < rawURL.length; i++) {
    const c = rawURL.charCodeAt(i);
    if ((0x61 <= c && c <= 0x7a) || (0x41 <= c && c <= 0x5a)) {
      // do nothing
    } else if ((0x30 <= c && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
      if (i === 0) {
        return ["", rawURL, null];
      }
    } else if (c === 0x3a /* : */) {
      if (i === 0) {
        return ["", "", new Error("missing protocol scheme")];
      }
      return [rawURL.slice(0, i), rawURL.slice(i + 1), null];
    } else {
      // we have encountered an invalid character, so there is no valid scheme
      return ["", rawURL, null];
    }
  }
  return ["", rawURL, null];
}

// parseHost parses host as an authority without user information: host[:port].
function parseHost(host: string): [string, Error | null] {
  if (host.startsWith("[")) {
    // Parse an IP-Literal in RFC 3986 and RFC 6874.
    const i = strings.LastIndex(host, "]");
    if (i < 0) {
      return ["", new Error("missing ']' in host")];
    }
    const colonPort = host.slice(i + 1);
    if (!validOptionalPort(colonPort)) {
      return ["", new Error(`invalid port "${colonPort}" after host`)];
    }

    // RFC 6874: %25 introduces the zone identifier.
    const zone = strings.Index(host.slice(0, i), "%25");
    if (zone >= 0) {
      const [host1, err1] = unescape(host.slice(0, zone), encodeHost);
      if (err1 !== null) {
        return ["", err1];
      }
      const [host2, err2] = unescape(host.slice(zone, i), encodeZone);
      if (err2 !== null) {
        return ["", err2];
      }
      const [host3, err3] = unescape(host.slice(i), encodeHost);
      if (err3 !== null) {
        return ["", err3];
      }
      return [host1 + host2 + host3, null];
    }
  } else {
    const i = strings.LastIndex(host, ":");
    if (i !== -1) {
      const colonPort = host.slice(i);
      if (!validOptionalPort(colonPort)) {
        return ["", new Error(`invalid port "${colonPort}" after host`)];
      }
    }
  }

  const [h, err] = unescape(host, encodeHost);
  if (err !== null) {
    return ["", err];
  }
  return [h, null];
}

// parseAuthority parses the authority component: [userinfo@]host[:port].
function parseAuthority(authority: string): [Userinfo | null, string, Error | null] {
  const i = strings.LastIndex(authority, "@");
  let host = "";
  let err: Error | null = null;
  if (i < 0) {
    [host, err] = parseHost(authority);
  } else {
    [host, err] = parseHost(authority.slice(i + 1));
  }
  if (err !== null) {
    return [null, "", err];
  }
  if (i < 0) {
    return [null, host, null];
  }
  let userinfo = authority.slice(0, i);
  if (!validUserinfo(userinfo)) {
    return [null, "", new Error("net/url: invalid userinfo")];
  }
  if (!strings.Contains(userinfo, ":")) {
    let uerr: Error | null = null;
    [userinfo, uerr] = unescape(userinfo, encodeUserPassword);
    if (uerr !== null) {
      return [null, "", uerr];
    }
    return [User(userinfo), host, null];
  }
  const [username0, password0] = strings.Cut(userinfo, ":");
  const [username, uerr] = unescape(username0, encodeUserPassword);
  if (uerr !== null) {
    return [null, "", uerr];
  }
  const [password, perr] = unescape(password0, encodeUserPassword);
  if (perr !== null) {
    return [null, "", perr];
  }
  return [UserPassword(username, password), host, null];
}

// parse parses a URL from a string. If viaRequest is true the URL is assumed to
// have arrived via an HTTP request (only absolute URLs or path-absolute
// relative URLs are allowed); otherwise all forms of relative URLs are allowed.
function parse(rawURL: string, viaRequest: boolean): [URL | null, Error | null] {
  if (stringContainsCTLByte(rawURL)) {
    return [null, new Error("net/url: invalid control character in URL")];
  }

  if (rawURL === "" && viaRequest) {
    return [null, new Error("empty url")];
  }
  const url = new URL();

  if (rawURL === "*") {
    url.Path = "*";
    return [url, null];
  }

  // Split off possible leading "http:", "mailto:", etc.
  let rest: string;
  let err: Error | null;
  [url.Scheme, rest, err] = getScheme(rawURL);
  if (err !== null) {
    return [null, err];
  }
  url.Scheme = strings.ToLower(url.Scheme);

  if (rest.endsWith("?") && strings.Count(rest, "?") === 1) {
    url.ForceQuery = true;
    rest = rest.slice(0, rest.length - 1);
  } else {
    const [before, after] = strings.Cut(rest, "?");
    rest = before;
    url.RawQuery = after;
  }

  if (!rest.startsWith("/")) {
    if (url.Scheme !== "") {
      // We consider rootless paths per RFC 3986 as opaque.
      url.Opaque = rest;
      return [url, null];
    }
    if (viaRequest) {
      return [null, new Error("invalid URI for request")];
    }

    // Avoid confusion with malformed schemes, like cache_object:foo/bar.
    // RFC 3986 §3.3: the first path segment of a relative reference cannot contain a colon.
    const [segment] = strings.Cut(rest, "/");
    if (strings.Contains(segment, ":")) {
      // First path segment has colon. Not allowed in relative URL.
      return [null, new Error("first path segment in URL cannot contain colon")];
    }
  }

  if ((url.Scheme !== "" || (!viaRequest && !rest.startsWith("///"))) && rest.startsWith("//")) {
    let authority = rest.slice(2);
    rest = "";
    const i = strings.Index(authority, "/");
    if (i >= 0) {
      rest = authority.slice(i);
      authority = authority.slice(0, i);
    }
    let user: Userinfo | null = null;
    let host = "";
    let aerr: Error | null = null;
    [user, host, aerr] = parseAuthority(authority);
    if (aerr !== null) {
      return [null, aerr];
    }
    url.User = user;
    url.Host = host;
  } else if (url.Scheme !== "" && rest.startsWith("/")) {
    // OmitHost is set to true when rawURL has an empty host (authority).
    // See golang.org/issue/46059.
    url.OmitHost = true;
  }

  // Set Path and, optionally, RawPath.
  const perr = url.setPath(rest);
  if (perr !== null) {
    return [null, perr];
  }
  return [url, null];
}

// Parse parses a raw url into a URL structure (Go url.Parse, Go 1.21).
//
// The url may be relative (a path, without a host) or absolute (starting with a
// scheme). Returns [null, error] exactly where Go returns a non-nil error.
export function Parse(rawURL: string): [URL | null, Error | null] {
  // Cut off #frag
  const [u, frag] = strings.Cut(rawURL, "#");
  const [url, err] = parse(u, false);
  if (err !== null) {
    return [null, urlError(u, err.message)];
  }
  if (frag === "") {
    return [url, null];
  }
  const ferr = url!.setFragment(frag);
  if (ferr !== null) {
    return [null, urlError(rawURL, ferr.message)];
  }
  return [url, null];
}
