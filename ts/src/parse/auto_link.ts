// Ported from parse/auto_link.go @ 8e7896b6
// Lute - a structured Markdown engine, supporting Go and JavaScript
// Copyright (c) 2019-present, b3log.org
//
// Lute is licensed under Mulan PSL v2.
// You can use this software according to the terms and conditions of the Mulan PSL v2.
// You may obtain a copy of Mulan PSL v2 at:
//         http://license.coscl.org.cn/MulanPSL2
// THIS SOFTWARE IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO NON-INFRINGEMENT, MERCHANTABILITY OR FIT FOR A PARTICULAR PURPOSE.
// See the Mulan PSL v2 for more details.

import * as bytes from "../runtime/bytes.ts";
import * as conv from "../runtime/conv.ts";
import * as slices from "../runtime/slices.ts";
import * as strings from "../runtime/strings.ts";
import * as utf8 from "../runtime/utf8.ts";
import * as ast from "../ast/index.ts";
import * as editor from "../editor/index.ts";
import * as html from "../html/index.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import type { InlineContext } from "./parse.ts";
import { Tree } from "./types.ts";

declare module "./types.ts" {
  interface Tree {
    parseGFMAutoEmailLink(node: ast.Node): void;
    parseGFMAutoLink(node: ast.Node): void;
    parseGFMAutoEmailLink0(node: ast.Node): void;
    isValidEmailSegment1(token: number): boolean;
    isValidEmailSegment2(token: number): boolean;
    parseGFMAutoLink0(node: ast.Node): void;
    isValidDomain(protocol: Uint8Array, domain: Uint8Array): boolean;
    parseAutoEmailLink(ctx: InlineContext): ast.Node | null;
    newLink(typ: ast.NodeType, text: Uint8Array, dest: Uint8Array, title: Uint8Array | null, linkType: number): ast.Node;
    parseAutolink(ctx: InlineContext): ast.Node | null;
    addPreviousText(node: ast.Node, tokens: Uint8Array): void;
  }
}

const emptyBytes: Uint8Array = new Uint8Array(0);

const lessAspace: Uint8Array = conv.BytesFromString("<a ");
const lessSlashAGreater: Uint8Array = conv.BytesFromString("</a>");
const slashIssuesSlash: Uint8Array = conv.BytesFromString("/issues/");
const slashPullSlash: Uint8Array = conv.BytesFromString("/pull/");
const questionMark: Uint8Array = conv.BytesFromString("?");
const githubComPrefix: Uint8Array = conv.BytesFromString("https://github.com/");
const encodedCaretTokens: Uint8Array = conv.BytesFromString("%E2%80%B8");
const colonBytes: Uint8Array = conv.BytesFromString(":");
const issueHashBytes: Uint8Array = conv.BytesFromString("Issue #");
const pullRequestHashBytes: Uint8Array = conv.BytesFromString("Pull Request #");
const spaceMiddleDotSpaceBytes: Uint8Array = conv.BytesFromString(" · ");

Tree.prototype.parseGFMAutoEmailLink = function (this: Tree, node: ast.Node): void {
  const t = this;
  for (let child: ast.Node | null = node.FirstChild; null !== child;) {
    const next: ast.Node | null = child.Next;
    if (ast.NodeText === child.Type && null !== child.Parent &&
      ast.NodeLink !== child.Parent.Type /* Do not process link labels */) {
      t.parseGFMAutoEmailLink0(child);
    } else {
      t.parseGFMAutoEmailLink(child); // Process child nodes recursively
    }
    child = next;
  }
};

Tree.prototype.parseGFMAutoLink = function (this: Tree, node: ast.Node): void {
  const t = this;
  for (let child: ast.Node | null = node.FirstChild; null !== child;) {
    const next: ast.Node | null = child.Next;
    if (ast.NodeText === child.Type) {
      t.parseGFMAutoLink0(child);
    } else {
      t.parseGFMAutoLink(child); // Process child nodes recursively
    }
    child = next;
  }
};

const mailto: Uint8Array = util.StrToBytes("mailto:");

Tree.prototype.parseGFMAutoEmailLink0 = function (this: Tree, node: ast.Node): void {
  const t = this;
  if (null !== node.Previous && ast.NodeInlineHTML === node.Previous.Type &&
    null !== node.Next && ast.NodeInlineHTML === node.Next.Type &&
    bytes.HasPrefix(node.Previous.Tokens ?? emptyBytes, lessAspace) &&
    bytes.Equal(node.Next.Tokens ?? emptyBytes, lessSlashAGreater)) {
    return;
  }

  const tokens: Uint8Array = node.Tokens ?? emptyBytes;
  if (0 >= bytes.IndexByte(tokens, 0x40 /* @ */)) {
    return;
  }

  let i = 0;
  let j = 0;
  let k = 0;
  let atIndex = 0;
  let token = 0;
  const length = tokens.length;

  // Split into groups by whitespace and process each group
  loopPart:
  while (i < length) {
    let group: Uint8Array = emptyBytes;
    atIndex = 0;
    j = i;

    // Accumulate the group until whitespace is met
    for (; j < length; j++) {
      token = tokens[j];
      if (!lex.IsWhitespace(token)) {
        group = slices.AppendByte(group, tokens[j]);
        if (0x40 /* @ */ === token) {
          // Record the absolute position of @ in the group, used later
          atIndex = j - i;
        }
        continue;
      }
      break;
    }
    if (i === j) {
      // The first character while accumulating the group was whitespace, so insert this whitespace in front as a text node
      t.addPreviousText(node, Uint8Array.of(tokens[j]));
      i++;
      continue;
    }

    // Move the main loop index
    i = j;

    if (0 >= atIndex) {
      t.addPreviousText(node, group);
      continue;
    }

    // At this point the group contains @, so try to parse an email address

    k = 0;
    for (; k < atIndex; k++) {
      token = group[k];
      if (!t.isValidEmailSegment1(token)) {
        t.addPreviousText(node, group);
        continue loopPart;
      }
    }

    k++; // Skip @ and check the part after it
    let item = 0;
    for (; k < group.length; k++) {
      item = group[k];
      token = group[k];
      if (!t.isValidEmailSegment2(token)) {
        t.addPreviousText(node, group);
        continue loopPart;
      }
    }

    if (lex.ItemDot === token) {
      // If it ends with . then drop that .
      const lastIndex = group.length - 1;
      group = group.subarray(0, lastIndex);
      const link = t.newLink(ast.NodeLink, group, slices.Append(mailto, group), null, 2);
      node.InsertBefore(link);
      // Insert . as a text node
      // UPSTREAM-BUG: when the group ends right after @ (for example "a.@") the loop above never runs, so item is still 0 and token is the last byte before @; a NUL byte is inserted as text (Go output for "a.@": <a href="mailto:a.">a.</a>\x00)
      t.addPreviousText(node, Uint8Array.of(item));
    } else if (lex.ItemHyphen === token || lex.ItemUnderscore === token) {
      // If it ends with - or _ then the whole string is not an email link
      t.addPreviousText(node, group);
      continue loopPart;
    } else {
      // Ends with a letter or digit
      const link = new ast.Node(ast.NodeLink);
      link.LinkType = 2;
      link.AppendChild(new ast.Node(ast.NodeLinkText, group));
      link.AppendChild(new ast.Node(ast.NodeLinkDest, slices.Append(mailto, group)));
      node.InsertBefore(link);
    }
  }

  // After processing, the passed-in text node node has been split into several nodes, so it can be removed
  node.Unlink();
  return;
};

Tree.prototype.isValidEmailSegment1 = function (this: Tree, token: number): boolean {
  return lex.IsASCIILetterNumHyphen(token) || lex.ItemDot === token || lex.ItemPlus === token || lex.ItemUnderscore === token;
};

Tree.prototype.isValidEmailSegment2 = function (this: Tree, token: number): boolean {
  return lex.IsASCIILetterNumHyphen(token) || lex.ItemDot === token || lex.ItemUnderscore === token;
};

// AddAutoLinkDomainSuffix adds the autolink parsing domain suffix suffix.
export function AddAutoLinkDomainSuffix(suffix: string): void {
  validAutoLinkDomainSuffixTable().set(suffix, true);
}

Tree.prototype.parseGFMAutoLink0 = function (this: Tree, node: ast.Node): void {
  const t = this;
  const tokens: Uint8Array = node.Tokens ?? emptyBytes;
  const length = tokens.length;
  const minLinkLen = 5; // A link cannot be shorter than this, the shortest cases are a://b or www.xxx.xx
  if (minLinkLen > length) {
    return;
  }

  let i = 0;
  let j = 0;
  let k = 0;
  let textStart = 0;
  let textEnd = 0;
  let token = 0;
  let www = false;
  let needUnlink = false;
  // A custom protocol can only use the last separator, and no standard protocol may appear after the candidate.
  const customEnd = bytes.LastIndex(tokens, protoSep);
  let customStart = customEnd;
  while (0 < customStart && lex.IsASCIILetterNum(tokens[customStart - 1])) {
    customStart--;
  }
  let lastStandard = bytes.LastIndex(tokens, httpProto);
  {
    const index = bytes.LastIndex(tokens, httpsProto);
    if (lastStandard < index) {
      lastStandard = index;
    }
  }
  {
    const index = bytes.LastIndex(tokens, ftpProto);
    if (lastStandard < index) {
      lastStandard = index;
    }
  }
  while (i < length) {
    token = tokens[i];
    let protocol: Uint8Array = emptyBytes;
    // Check the prefix
    const tmpLen = length - i;
    if (10 <= tmpLen /* www.xxx.xx */ && 0x77 /* w */ === tokens[i] && 0x77 /* w */ === tokens[i + 1] && 0x77 /* w */ === tokens[i + 2] && 0x2e /* . */ === tokens[i + 3]) {
      protocol = httpProto;
      // UPSTREAM-BUG: www is never reset, so after a www. link in the same text node the later links of that node lose their protocol in the link text (Go: "www.example.com http://example.org" gives the second link the text "example.org")
      www = true;
    } else if (13 <= tmpLen /* http://xxx.xx */ && 0x68 /* h */ === tokens[i] && 0x74 /* t */ === tokens[i + 1] && 0x74 /* t */ === tokens[i + 2] && 0x70 /* p */ === tokens[i + 3] && 0x3a /* : */ === tokens[i + 4] && 0x2f /* / */ === tokens[i + 5] && 0x2f /* / */ === tokens[i + 6]) {
      protocol = tokens.subarray(i, i + 7);
      i += 7;
    } else if (14 <= tmpLen /* https://xxx.xx */ && 0x68 /* h */ === tokens[i] && 0x74 /* t */ === tokens[i + 1] && 0x74 /* t */ === tokens[i + 2] && 0x70 /* p */ === tokens[i + 3] && 0x73 /* s */ === tokens[i + 4] && 0x3a /* : */ === tokens[i + 5] && 0x2f /* / */ === tokens[i + 6] && 0x2f /* / */ === tokens[i + 7]) {
      protocol = tokens.subarray(i, i + 8);
      i += 8;
    } else if (12 <= tmpLen /* ftp://xxx.xx */ && 0x66 /* f */ === tokens[i] && 0x74 /* t */ === tokens[i + 1] && 0x70 /* p */ === tokens[i + 2] && 0x3a /* : */ === tokens[i + 3] && 0x2f /* / */ === tokens[i + 4] && 0x2f /* / */ === tokens[i + 5]) {
      protocol = tokens.subarray(i, i + 6);
      i += 6;
    } else if (customStart <= i && i < customEnd && lastStandard < i && customEnd + 3 < length) {
      // Custom protocols are all considered valid https://github.com/siyuan-note/siyuan/issues/5865
      protocol = tokens.subarray(i, customEnd + 3);
      i = customEnd + 3;
    } else {
      textEnd++;
      if (length - i < minLinkLen) { // Not enough characters left to form a link
        if (needUnlink) {
          if (textStart < textEnd) {
            t.addPreviousText(node, tokens.subarray(textStart));
          } else {
            t.addPreviousText(node, tokens.subarray(textEnd));
          }
          node.Unlink();
        }
        return;
      }
      i++;
      continue;
    }

    if (textStart < textEnd) {
      t.addPreviousText(node, tokens.subarray(textStart, textEnd));
      needUnlink = true;
      textStart = textEnd;
    }

    let url: Uint8Array = emptyBytes;
    let colonSeen = false;
    let pathSeen = false; // Port validation state: the port is validated only after a colon that is not part of :// and before the path/query/fragment part starts
    j = i;
    for (; j < length; j++) {
      token = tokens[j];
      if (lex.IsWhitespace(token) || lex.ItemLess === token) {
        break;
      }

      if (colonSeen && !pathSeen) {
        // The port part may only consist of digits; a path/query/fragment start such as / ? # ends the port parsing
        if (!lex.IsDigit(token) && lex.ItemSlash !== token && lex.ItemQuestion !== token && lex.ItemCrosshatch !== token) {
          break;
        }
      }
      if (!colonSeen && lex.ItemColon === token && !bytes.HasPrefixAt(tokens, j, protoSep)) {
        colonSeen = true;
      }
      if (lex.ItemSlash === token || lex.ItemQuestion === token || lex.ItemCrosshatch === token) {
        pathSeen = true;
      }

      url = slices.AppendByte(url, token);
    }
    if (i === j) { // Broke off at the very first character
      if (utf8.RuneSelf <= token) {
        if (!www) {
          url = slices.Append(url, protocol);
        }
        for (; i < length; i++) {
          token = tokens[i];
          if (utf8.RuneSelf > token) {
            break;
          }
          url = slices.AppendByte(url, token);
        }
      } else {
        url = slices.AppendByte(url, token);
        i++;
      }

      if (null !== node.Previous) {
        // PORT-NOTE: Go appends to a nil slice here; a null Tokens stays null when there is nothing to append (as in Node.AppendTokens)
        if (!(null === node.Previous.Tokens && 0 === url.length)) {
          node.Previous.Tokens = slices.Append(node.Previous.Tokens ?? emptyBytes, url);
        }
      }

      textStart = i;
      textEnd = i;
      continue;
    }

    // Move the main loop index
    i = j;

    k = 0;
    for (; k < url.length; k++) {
      token = url[k];
      if (lex.ItemSlash === token) {
        break;
      }
    }
    let domain: Uint8Array = url.subarray(0, k);
    let port: Uint8Array = emptyBytes;
    {
      const idx = bytes.Index(domain, colonBytes);
      if (0 < idx) {
        port = domain.subarray(idx);
        domain = domain.subarray(0, idx);
      }
    }

    if (!t.isValidDomain(protocol, domain)) {
      t.addPreviousText(node, tokens.subarray(textStart, i));
      needUnlink = true;
      textStart = i;
      textEnd = i;
      continue;
    }

    let openParens = 0;
    let closeParens = 0;
    // If the last character is punctuation then drop it
    let path: Uint8Array = url.subarray(k);
    // PORT-NOTE: Go shadows length here (length := len(path)); renamed to pathLength because the outer length is still read earlier in the same block
    let pathLength = path.length;
    if (0 < pathLength) {
      let l = 0;
      // Count the parentheses
      for (l = 0; l < pathLength; l++) {
        token = path[l];
        if (lex.ItemOpenParen === token) {
          openParens++;
        } else if (lex.ItemCloseParen === token) {
          closeParens++;
        }
      }

      let trimmed = false;
      const lastToken = path[pathLength - 1];
      if (lex.ItemCloseParen === lastToken) {
        // Ending with ) requires matching the parentheses
        let unmatches = closeParens - openParens;
        if (0 < unmatches) {
          // Move backwards
          for (l = pathLength - 1; 0 < unmatches; l--) {
            token = path[l];
            if (lex.ItemCloseParen !== token) {
              break;
            }
            unmatches--;
            i--;
          }
          path = path.subarray(0, l + 1);
          trimmed = true;
        } else { // The number of ) is less than or equal to the number of (
          // Treated as fully matched, no need to handle trailing punctuation
          trimmed = true;
        }
      } else if (lex.ItemSemicolon === lastToken) {
        // Check HTML entities
        let foundAmp = false;
        // Look backwards for &
        for (l = pathLength - 1; 0 <= l; l--) {
          token = path[l];
          if (lex.ItemAmpersand === token) {
            foundAmp = true;
            break;
          }
        }
        if (foundAmp) { // If & exists
          const entity = path.subarray(l, pathLength);
          if (3 <= entity.length) {
            // Check that the substring looks like an entity (the part between & and ; must be letters or digits)
            let isEntity = true;
            for (j = 1; j < entity.length - 1; j++) {
              if (!lex.IsASCIILetterNum(entity[j])) {
                isEntity = false;
                break;
              }
            }
            if (isEntity) {
              path = path.subarray(0, l);
              trimmed = true;
              i -= pathLength - l;
            }
          }
        }
      }

      // If the ) or ; above did not apply, apply the trailing punctuation rule: punctuation is not part of the link and must be dropped
      // Trailing punctuation (specifically, ?, !, ., ,, :, *, _, and ~) will not be considered part of the autolink, though they may be included in the interior of the link:
      // https://github.github.com/gfm/#example-624
      if (!trimmed && (0x3f /* ? */ === lastToken || 0x21 /* ! */ === lastToken || 0x2e /* . */ === lastToken || 0x2c /* , */ === lastToken || 0x3a /* : */ === lastToken || 0x2a /* * */ === lastToken || 0x5f /* _ */ === lastToken || 0x7e /* ~ */ === lastToken)) {
        path = path.subarray(0, pathLength - 1);
        i--;
      }
    } else {
      pathLength = domain.length;
      const lastToken = domain[pathLength - 1];
      if (lex.IsASCIIPunct(lastToken)) {
        domain = domain.subarray(0, pathLength - 1);
        i--;
      }
    }

    // PORT-NOTE: aliasing as in Go: protocol may be a sub-slice of tokens with spare capacity, so this append can write into the buffer of tokens (the bytes written are identical to the ones already there)
    let dest: Uint8Array = slices.Append(protocol, domain);
    dest = slices.Append(dest, port);
    dest = slices.Append(dest, path);
    let addr: Uint8Array = emptyBytes;
    if (!www) {
      addr = slices.Append(addr, protocol);
    }
    addr = slices.Append(addr, domain);
    addr = slices.Append(addr, port);
    addr = slices.Append(addr, path);
    let linkText: Uint8Array = addr;
    if (bytes.HasPrefix(linkText, githubComPrefix)) {
      if (bytes.Contains(linkText, slashIssuesSlash)) {
        // Improve the GitHub Issues autolink text https://github.com/88250/lute/issues/161
        let repo: Uint8Array = linkText.subarray(githubComPrefix.length);
        // UPSTREAM-BUG: for "https://github.com/issues/1" the "/issues/" found in linkText overlaps the prefix, so Index returns -1 and Go panics (slice bounds out of range [:-1])
        const repoEnd = bytes.Index(repo, slashIssuesSlash);
        if (0 > repoEnd) {
          // PORT-NOTE: Go panics here
          throw new Error("slice bounds out of range [:-1]");
        }
        repo = repo.subarray(0, repoEnd);
        // PORT-NOTE: Split element capacity: the elements are only sliced and read, never appended to, so they are not cloned
        let num: Uint8Array = bytes.Split(linkText, slashIssuesSlash)[1];
        num = bytes.Split(num, questionMark)[0];
        if (0 < num.length) {
          let isDigit = true;
          for (let n = 0; n < num.length; n++) {
            if (!lex.IsDigit(num[n])) {
              isDigit = false;
              break;
            }
          }
          if (isDigit) {
            // PORT-NOTE: joined as bytes instead of strings so that bytes which are not valid UTF-8 are kept, as in Go
            linkText = concatBytes(issueHashBytes, num, spaceMiddleDotSpaceBytes, repo);
          }
        }
      } else if (bytes.Contains(linkText, slashPullSlash)) {
        // Improve the GitHub Pull Requests autolink text https://github.com/88250/lute/issues/208
        let repo: Uint8Array = linkText.subarray(githubComPrefix.length);
        // UPSTREAM-BUG: for "https://github.com/pull/1" the "/pull/" found in linkText overlaps the prefix, so Index returns -1 and Go panics (slice bounds out of range [:-1])
        const repoEnd = bytes.Index(repo, slashPullSlash);
        if (0 > repoEnd) {
          // PORT-NOTE: Go panics here
          throw new Error("slice bounds out of range [:-1]");
        }
        repo = repo.subarray(0, repoEnd);
        // PORT-NOTE: Split element capacity: the elements are only sliced and read, never appended to, so they are not cloned
        let num: Uint8Array = bytes.Split(linkText, slashPullSlash)[1];
        num = bytes.Split(num, questionMark)[0];
        if (0 < num.length) {
          let isDigit = true;
          for (let n = 0; n < num.length; n++) {
            if (!lex.IsDigit(num[n])) {
              isDigit = false;
              break;
            }
          }
          if (isDigit) {
            linkText = concatBytes(pullRequestHashBytes, num, spaceMiddleDotSpaceBytes, repo);
          }
        }
      }
    }

    const link = t.newLink(ast.NodeLink, linkText, html.EncodeDestination(dest), null, 2);
    node.InsertBefore(link);
    needUnlink = true;

    textStart = i;
    textEnd = i;
  }

  if (textStart < textEnd) {
    t.addPreviousText(node, tokens.subarray(textStart, textEnd));
    needUnlink = true;
  }
  if (needUnlink) {
    node.Unlink();
  }
  return;
};

// isValidDomain validates a valid domain as defined by the GFM autolink rules.
// https://github.github.com/gfm/#valid-domain
Tree.prototype.isValidDomain = function (this: Tree, protocol: Uint8Array, domain: Uint8Array): boolean {
  if (0 < protocol.length && !bytes.Contains(protocol, httpProto) && !bytes.Contains(protocol, httpsProto) && !bytes.Contains(protocol, ftpProto)) {
    // Custom protocols are all considered valid https://github.com/siyuan-note/siyuan/issues/5865
    return true;
  }

  // Keep the segment count consistent with lex.Split(domain, '.') (a trailing empty segment is not counted)
  let total = bytes.Count(domain, dotBytes) + 1;
  if (0 < domain.length && lex.ItemDot === domain[domain.length - 1]) {
    total--;
  }
  if (2 > total) { // A domain is split by . into at least two parts, fewer than two is invalid
    return false;
  }

  // Split by . manually and validate each segment, avoiding a slice allocation
  let segments = 0;
  const length = domain.length;
  let i = 0;
  for (;;) {
    const start = i;
    while (i < length && lex.ItemDot !== domain[i]) {
      i++;
    }
    const segment = domain.subarray(start, i);

    if (0 < segment.length) {
      for (let j = 0; j < segment.length; j++) {
        const token = segment[j];
        if (!lex.IsASCIILetterNumHyphen(token)) {
          return false;
        }
        if (2 < segments && (segments === total - 2 || segments === total - 1)) {
          // The last two parts cannot contain _
          if (lex.ItemUnderscore === token) {
            return false;
          }
        }
      }

      if (segments === total - 1) {
        let validSuffix = false;
        let suffixIsDigit = true; // Check whether the suffix is all digits
        for (let n = 0; n < segment.length; n++) {
          if (!lex.IsDigit(segment[n])) {
            suffixIsDigit = false;
            break;
          }
        }
        if (!suffixIsDigit) { // If the suffix is not all digits check that it is in the list of valid suffixes
          // PORT-NOTE: lazy TLD table
          validSuffix = validAutoLinkDomainSuffixTable().get(util.BytesToStr(segment)) ?? false;
        } else { // An all-digit suffix may be an IPv4 address
          validSuffix = true;
        }
        if (!validSuffix) {
          return false;
        }
      }
    }

    segments++;
    if (i >= length) {
      break;
    }
    i++; // Skip .
  }
  return true;
};

const markers: Uint8Array = util.StrToBytes(".!#$%&'*+/=?^_`{|}~");

Tree.prototype.parseAutoEmailLink = function (this: Tree, ctx: InlineContext): ast.Node | null {
  const t = this;
  const tokens: Uint8Array = ctx.tokens.subarray(1);
  let dest: Uint8Array = emptyBytes;
  let token = 0;
  let length = tokens.length;
  let passed = 0;
  let i = 0;
  let at = false;
  for (; i < length; i++) {
    token = tokens[i];
    dest = slices.AppendByte(dest, tokens[i]);
    passed++;
    if (0x40 /* @ */ === token) {
      at = true;
      break;
    }

    if (!lex.IsASCIILetterNumHyphen(token) && !bytes.Contains(markers, Uint8Array.of(token))) {
      return null;
    }
  }

  if (1 > i || !at) {
    return null;
  }

  const domainPart: Uint8Array = tokens.subarray(i + 1);
  length = domainPart.length;
  i = 0;
  let closed = false;
  for (; i < length; i++) {
    token = domainPart[i];
    passed++;
    if (lex.ItemGreater === token) {
      closed = true;
      break;
    }
    dest = slices.AppendByte(dest, domainPart[i]);
    if (!lex.IsASCIILetterNumHyphen(token) && lex.ItemDot !== token) {
      return null;
    }
    if (63 < i) {
      return null;
    }
  }

  if (1 > i || !closed) {
    return null;
  }

  ctx.pos += passed + 1;
  return t.newLink(ast.NodeLink, dest, slices.Append(mailto, dest), null, 2);
};

Tree.prototype.newLink = function (this: Tree, typ: ast.NodeType, text: Uint8Array, dest: Uint8Array, title: Uint8Array | null, linkType: number): ast.Node {
  const t = this;
  const options = t.Context!.ParseOption;
  const editorMode = options.VditorWYSIWYG || options.VditorIR || options.VditorSV || options.ProtyleWYSIWYG;
  const appendCaret = editorMode && bytes.HasSuffix(text, editor.CaretTokens) && bytes.HasSuffix(dest, encodedCaretTokens);
  if (appendCaret) {
    text = bytes.TrimSuffix(text, editor.CaretTokens);
    dest = bytes.TrimSuffix(dest, encodedCaretTokens);
  }
  const prependCaret = editorMode && bytes.HasPrefix(text, editor.CaretTokens) && bytes.HasPrefix(dest, encodedCaretTokens);
  if (prependCaret) {
    text = bytes.TrimPrefix(text, editor.CaretTokens);
    dest = bytes.TrimPrefix(dest, encodedCaretTokens);
  }
  text = html.DecodeDestination(text);

  const ret = new ast.Node(typ);
  ret.LinkType = linkType;
  if (ast.NodeImage === typ) {
    ret.AppendChild(new ast.Node(ast.NodeBang));
  }
  ret.AppendChild(new ast.Node(ast.NodeOpenBracket));
  ret.AppendChild(new ast.Node(ast.NodeLinkText, text));
  ret.AppendChild(new ast.Node(ast.NodeCloseBracket));
  ret.AppendChild(new ast.Node(ast.NodeOpenParen));
  ret.AppendChild(new ast.Node(ast.NodeLinkDest, dest));
  if (null !== title) {
    ret.AppendChild(new ast.Node(ast.NodeLinkTitle, title));
  }
  ret.AppendChild(new ast.Node(ast.NodeCloseParen));
  if (appendCaret || prependCaret) {
    ret.InsertAfter(new ast.Node(ast.NodeText, editor.CaretTokens));
  }
  if (1 === linkType) {
    ret.LinkRefLabel = text;
  }
  return ret;
};

Tree.prototype.parseAutolink = function (this: Tree, ctx: InlineContext): ast.Node | null {
  const t = this;
  let schemed = false;
  let scheme = "";
  let dest: Uint8Array = emptyBytes;
  let token = 0;
  let i = ctx.pos + 1;
  for (; i < ctx.tokensLen && lex.ItemGreater !== ctx.tokens[i]; i++) {
    token = ctx.tokens[i];
    if (lex.ItemSpace === token) {
      return null;
    }

    dest = slices.AppendByte(dest, ctx.tokens[i]);
    if (!schemed) {
      if (lex.ItemColon !== token) {
        // PORT-NOTE: Go's string(token) converts the byte to a rune, so a byte >= 0x80 becomes a two-byte UTF-8 sequence; the length check below counts bytes
        scheme += conv.StringFromRune(token);
      } else {
        schemed = true;
      }
    }
  }
  // PORT-NOTE: byte offset
  if (!schemed || 3 > utf8.ByteLen(scheme) || i === ctx.tokensLen) {
    return null;
  }

  if (lex.ItemGreater !== ctx.tokens[i]) {
    return null;
  }
  ctx.pos = 1 + i;
  return t.newLink(ast.NodeLink, dest, html.EncodeDestination(dest), null, 2);
};

Tree.prototype.addPreviousText = function (this: Tree, node: ast.Node, tokens: Uint8Array): void {
  if (null === node.Previous || ast.NodeText !== node.Previous.Type) {
    node.InsertBefore(new ast.Node(ast.NodeText, tokens));
    return;
  }
  node.Previous.AppendTokens(tokens);
};

const httpProto: Uint8Array = util.StrToBytes("http://");
const httpsProto: Uint8Array = util.StrToBytes("https://");
const ftpProto: Uint8Array = util.StrToBytes("ftp://");
const protoSep: Uint8Array = util.StrToBytes("://");
const dotBytes: Uint8Array = util.StrToBytes(".");

// concatBytes is a port addition: it joins byte slices into a fresh array whose capacity equals its length, like Go's []byte(string) conversion.
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) {
    n += p.length;
  }
  const ret = new Uint8Array(n);
  let off = 0;
  for (const p of parts) {
    ret.set(p, off);
    off += p.length;
  }
  return ret;
}

// validAutoLinkDomainSuffix is used to validate the domain suffix during GFM autolink parsing.
// PORT-NOTE: lazy TLD table. Go builds it at package initialisation; here it is built on first use by validAutoLinkDomainSuffixTable.
let validAutoLinkDomainSuffix: Map<string, boolean> | null = null;

// validAutoLinkDomainSuffixTable is a port addition that returns validAutoLinkDomainSuffix and builds it on first use.
export function validAutoLinkDomainSuffixTable(): Map<string, boolean> {
  if (null === validAutoLinkDomainSuffix) {
    validAutoLinkDomainSuffix = getValidDomainSuffixFromStr();
  }
  return validAutoLinkDomainSuffix;
}

// getValidDomainSuffixFromStr converts the top-level domains in string form to a map.
export function getValidDomainSuffixFromStr(): Map<string, boolean> {
  const ret = new Map<string, boolean>();
  const split = strings.Split(allTLDs, "\n");
  let l1 = "";
  let l2 = "";
  for (const line of split) {
    l1 = strings.Trim(line, " ");
    l2 = strings.ToLower(l1);
    if (1 > l2.length || strings.HasPrefix(l2, "#")) {
      continue;
    }
    ret.set(l2, true);
  }
  return ret;
}

// All top-level domains (TLD),
// one per line, # starts a comment;
// xn-- entries are Punycode and correspond to non-English domains; for example the Chinese URL "中国移动.中国" is converted to xn--fiq02ib9d179b.xn--fiqs8s
// From: List of Top-Level Domains - ICANN
// https://www.icann.org/resources/pages/tlds-2012-02-25-en
// PORT-NOTE: lazy TLD table. The string below is generated mechanically from parse/auto_link.go (the carriage returns of the CRLF source are dropped, as Go does for raw strings).
export const allTLDs = `
# Version 2023021700, Last Updated Fri Feb 17 07:07:01 2023 UTC
AAA
AARP
ABARTH
ABB
ABBOTT
ABBVIE
ABC
ABLE
ABOGADO
ABUDHABI
AC
ACADEMY
ACCENTURE
ACCOUNTANT
ACCOUNTANTS
ACO
ACTOR
AD
ADS
ADULT
AE
AEG
AERO
AETNA
AF
AFL
AFRICA
AG
AGAKHAN
AGENCY
AI
AIG
AIRBUS
AIRFORCE
AIRTEL
AKDN
AL
ALFAROMEO
ALIBABA
ALIPAY
ALLFINANZ
ALLSTATE
ALLY
ALSACE
ALSTOM
AM
AMAZON
AMERICANEXPRESS
AMERICANFAMILY
AMEX
AMFAM
AMICA
AMSTERDAM
ANALYTICS
ANDROID
ANQUAN
ANZ
AO
AOL
APARTMENTS
APP
APPLE
AQ
AQUARELLE
AR
ARAB
ARAMCO
ARCHI
ARMY
ARPA
ART
ARTE
AS
ASDA
ASIA
ASSOCIATES
AT
ATHLETA
ATTORNEY
AU
AUCTION
AUDI
AUDIBLE
AUDIO
AUSPOST
AUTHOR
AUTO
AUTOS
AVIANCA
AW
AWS
AX
AXA
AZ
AZURE
BA
BABY
BAIDU
BANAMEX
BANANAREPUBLIC
BAND
BANK
BAR
BARCELONA
BARCLAYCARD
BARCLAYS
BAREFOOT
BARGAINS
BASEBALL
BASKETBALL
BAUHAUS
BAYERN
BB
BBC
BBT
BBVA
BCG
BCN
BD
BE
BEATS
BEAUTY
BEER
BENTLEY
BERLIN
BEST
BESTBUY
BET
BF
BG
BH
BHARTI
BI
BIBLE
BID
BIKE
BING
BINGO
BIO
BIZ
BJ
BLACK
BLACKFRIDAY
BLOCKBUSTER
BLOG
BLOOMBERG
BLUE
BM
BMS
BMW
BN
BNPPARIBAS
BO
BOATS
BOEHRINGER
BOFA
BOM
BOND
BOO
BOOK
BOOKING
BOSCH
BOSTIK
BOSTON
BOT
BOUTIQUE
BOX
BR
BRADESCO
BRIDGESTONE
BROADWAY
BROKER
BROTHER
BRUSSELS
BS
BT
BUILD
BUILDERS
BUSINESS
BUY
BUZZ
BV
BW
BY
BZ
BZH
CA
CAB
CAFE
CAL
CALL
CALVINKLEIN
CAM
CAMERA
CAMP
CANON
CAPETOWN
CAPITAL
CAPITALONE
CAR
CARAVAN
CARDS
CARE
CAREER
CAREERS
CARS
CASA
CASE
CASH
CASINO
CAT
CATERING
CATHOLIC
CBA
CBN
CBRE
CBS
CC
CD
CENTER
CEO
CERN
CF
CFA
CFD
CG
CH
CHANEL
CHANNEL
CHARITY
CHASE
CHAT
CHEAP
CHINTAI
CHRISTMAS
CHROME
CHURCH
CI
CIPRIANI
CIRCLE
CISCO
CITADEL
CITI
CITIC
CITY
CITYEATS
CK
CL
CLAIMS
CLEANING
CLICK
CLINIC
CLINIQUE
CLOTHING
CLOUD
CLUB
CLUBMED
CM
CN
CO
COACH
CODES
COFFEE
COLLEGE
COLOGNE
COM
COMCAST
COMMBANK
COMMUNITY
COMPANY
COMPARE
COMPUTER
COMSEC
CONDOS
CONSTRUCTION
CONSULTING
CONTACT
CONTRACTORS
COOKING
COOKINGCHANNEL
COOL
COOP
CORSICA
COUNTRY
COUPON
COUPONS
COURSES
CPA
CR
CREDIT
CREDITCARD
CREDITUNION
CRICKET
CROWN
CRS
CRUISE
CRUISES
CU
CUISINELLA
CV
CW
CX
CY
CYMRU
CYOU
CZ
DABUR
DAD
DANCE
DATA
DATE
DATING
DATSUN
DAY
DCLK
DDS
DE
DEAL
DEALER
DEALS
DEGREE
DELIVERY
DELL
DELOITTE
DELTA
DEMOCRAT
DENTAL
DENTIST
DESI
DESIGN
DEV
DHL
DIAMONDS
DIET
DIGITAL
DIRECT
DIRECTORY
DISCOUNT
DISCOVER
DISH
DIY
DJ
DK
DM
DNP
DO
DOCS
DOCTOR
DOG
DOMAINS
DOT
DOWNLOAD
DRIVE
DTV
DUBAI
DUNLOP
DUPONT
DURBAN
DVAG
DVR
DZ
EARTH
EAT
EC
ECO
EDEKA
EDU
EDUCATION
EE
EG
EMAIL
EMERCK
ENERGY
ENGINEER
ENGINEERING
ENTERPRISES
EPSON
EQUIPMENT
ER
ERICSSON
ERNI
ES
ESQ
ESTATE
ET
ETISALAT
EU
EUROVISION
EUS
EVENTS
EXCHANGE
EXPERT
EXPOSED
EXPRESS
EXTRASPACE
FAGE
FAIL
FAIRWINDS
FAITH
FAMILY
FAN
FANS
FARM
FARMERS
FASHION
FAST
FEDEX
FEEDBACK
FERRARI
FERRERO
FI
FIAT
FIDELITY
FIDO
FILM
FINAL
FINANCE
FINANCIAL
FIRE
FIRESTONE
FIRMDALE
FISH
FISHING
FIT
FITNESS
FJ
FK
FLICKR
FLIGHTS
FLIR
FLORIST
FLOWERS
FLY
FM
FO
FOO
FOOD
FOODNETWORK
FOOTBALL
FORD
FOREX
FORSALE
FORUM
FOUNDATION
FOX
FR
FREE
FRESENIUS
FRL
FROGANS
FRONTDOOR
FRONTIER
FTR
FUJITSU
FUN
FUND
FURNITURE
FUTBOL
FYI
GA
GAL
GALLERY
GALLO
GALLUP
GAME
GAMES
GAP
GARDEN
GAY
GB
GBIZ
GD
GDN
GE
GEA
GENT
GENTING
GEORGE
GF
GG
GGEE
GH
GI
GIFT
GIFTS
GIVES
GIVING
GL
GLASS
GLE
GLOBAL
GLOBO
GM
GMAIL
GMBH
GMO
GMX
GN
GODADDY
GOLD
GOLDPOINT
GOLF
GOO
GOODYEAR
GOOG
GOOGLE
GOP
GOT
GOV
GP
GQ
GR
GRAINGER
GRAPHICS
GRATIS
GREEN
GRIPE
GROCERY
GROUP
GS
GT
GU
GUARDIAN
GUCCI
GUGE
GUIDE
GUITARS
GURU
GW
GY
HAIR
HAMBURG
HANGOUT
HAUS
HBO
HDFC
HDFCBANK
HEALTH
HEALTHCARE
HELP
HELSINKI
HERE
HERMES
HGTV
HIPHOP
HISAMITSU
HITACHI
HIV
HK
HKT
HM
HN
HOCKEY
HOLDINGS
HOLIDAY
HOMEDEPOT
HOMEGOODS
HOMES
HOMESENSE
HONDA
HORSE
HOSPITAL
HOST
HOSTING
HOT
HOTELES
HOTELS
HOTMAIL
HOUSE
HOW
HR
HSBC
HT
HU
HUGHES
HYATT
HYUNDAI
IBM
ICBC
ICE
ICU
ID
IE
IEEE
IFM
IKANO
IL
IM
IMAMAT
IMDB
IMMO
IMMOBILIEN
IN
INC
INDUSTRIES
INFINITI
INFO
ING
INK
INSTITUTE
INSURANCE
INSURE
INT
INTERNATIONAL
INTUIT
INVESTMENTS
IO
IPIRANGA
IQ
IR
IRISH
IS
ISMAILI
IST
ISTANBUL
IT
ITAU
ITV
JAGUAR
JAVA
JCB
JE
JEEP
JETZT
JEWELRY
JIO
JLL
JM
JMP
JNJ
JO
JOBS
JOBURG
JOT
JOY
JP
JPMORGAN
JPRS
JUEGOS
JUNIPER
KAUFEN
KDDI
KE
KERRYHOTELS
KERRYLOGISTICS
KERRYPROPERTIES
KFH
KG
KH
KI
KIA
KIDS
KIM
KINDER
KINDLE
KITCHEN
KIWI
KM
KN
KOELN
KOMATSU
KOSHER
KP
KPMG
KPN
KR
KRD
KRED
KUOKGROUP
KW
KY
KYOTO
KZ
LA
LACAIXA
LAMBORGHINI
LAMER
LANCASTER
LANCIA
LAND
LANDROVER
LANXESS
LASALLE
LAT
LATINO
LATROBE
LAW
LAWYER
LB
LC
LDS
LEASE
LECLERC
LEFRAK
LEGAL
LEGO
LEXUS
LGBT
LI
LIDL
LIFE
LIFEINSURANCE
LIFESTYLE
LIGHTING
LIKE
LILLY
LIMITED
LIMO
LINCOLN
LINDE
LINK
LIPSY
LIVE
LIVING
LK
LLC
LLP
LOAN
LOANS
LOCKER
LOCUS
LOL
LONDON
LOTTE
LOTTO
LOVE
LPL
LPLFINANCIAL
LR
LS
LT
LTD
LTDA
LU
LUNDBECK
LUXE
LUXURY
LV
LY
MA
MACYS
MADRID
MAIF
MAISON
MAKEUP
MAN
MANAGEMENT
MANGO
MAP
MARKET
MARKETING
MARKETS
MARRIOTT
MARSHALLS
MASERATI
MATTEL
MBA
MC
MCKINSEY
MD
ME
MED
MEDIA
MEET
MELBOURNE
MEME
MEMORIAL
MEN
MENU
MERCKMSD
MG
MH
MIAMI
MICROSOFT
MIL
MINI
MINT
MIT
MITSUBISHI
MK
ML
MLB
MLS
MM
MMA
MN
MO
MOBI
MOBILE
MODA
MOE
MOI
MOM
MONASH
MONEY
MONSTER
MORMON
MORTGAGE
MOSCOW
MOTO
MOTORCYCLES
MOV
MOVIE
MP
MQ
MR
MS
MSD
MT
MTN
MTR
MU
MUSEUM
MUSIC
MUTUAL
MV
MW
MX
MY
MZ
NA
NAB
NAGOYA
NAME
NATURA
NAVY
NBA
NC
NE
NEC
NET
NETBANK
NETFLIX
NETWORK
NEUSTAR
NEW
NEWS
NEXT
NEXTDIRECT
NEXUS
NF
NFL
NG
NGO
NHK
NI
NICO
NIKE
NIKON
NINJA
NISSAN
NISSAY
NL
NO
NOKIA
NORTHWESTERNMUTUAL
NORTON
NOW
NOWRUZ
NOWTV
NP
NR
NRA
NRW
NTT
NU
NYC
NZ
OBI
OBSERVER
OFFICE
OKINAWA
OLAYAN
OLAYANGROUP
OLDNAVY
OLLO
OM
OMEGA
ONE
ONG
ONL
ONLINE
OOO
OPEN
ORACLE
ORANGE
ORG
ORGANIC
ORIGINS
OSAKA
OTSUKA
OTT
OVH
PA
PAGE
PANASONIC
PARIS
PARS
PARTNERS
PARTS
PARTY
PASSAGENS
PAY
PCCW
PE
PET
PF
PFIZER
PG
PH
PHARMACY
PHD
PHILIPS
PHONE
PHOTO
PHOTOGRAPHY
PHOTOS
PHYSIO
PICS
PICTET
PICTURES
PID
PIN
PING
PINK
PIONEER
PIZZA
PK
PL
PLACE
PLAY
PLAYSTATION
PLUMBING
PLUS
PM
PN
PNC
POHL
POKER
POLITIE
PORN
POST
PR
PRAMERICA
PRAXI
PRESS
PRIME
PRO
PROD
PRODUCTIONS
PROF
PROGRESSIVE
PROMO
PROPERTIES
PROPERTY
PROTECTION
PRU
PRUDENTIAL
PS
PT
PUB
PW
PWC
PY
QA
QPON
QUEBEC
QUEST
RACING
RADIO
RE
READ
REALESTATE
REALTOR
REALTY
RECIPES
RED
REDSTONE
REDUMBRELLA
REHAB
REISE
REISEN
REIT
RELIANCE
REN
RENT
RENTALS
REPAIR
REPORT
REPUBLICAN
REST
RESTAURANT
REVIEW
REVIEWS
REXROTH
RICH
RICHARDLI
RICOH
RIL
RIO
RIP
RO
ROCHER
ROCKS
RODEO
ROGERS
ROOM
RS
RSVP
RU
RUGBY
RUHR
RUN
RW
RWE
RYUKYU
SA
SAARLAND
SAFE
SAFETY
SAKURA
SALE
SALON
SAMSCLUB
SAMSUNG
SANDVIK
SANDVIKCOROMANT
SANOFI
SAP
SARL
SAS
SAVE
SAXO
SB
SBI
SBS
SC
SCA
SCB
SCHAEFFLER
SCHMIDT
SCHOLARSHIPS
SCHOOL
SCHULE
SCHWARZ
SCIENCE
SCOT
SD
SE
SEARCH
SEAT
SECURE
SECURITY
SEEK
SELECT
SENER
SERVICES
SEVEN
SEW
SEX
SEXY
SFR
SG
SH
SHANGRILA
SHARP
SHAW
SHELL
SHIA
SHIKSHA
SHOES
SHOP
SHOPPING
SHOUJI
SHOW
SHOWTIME
SI
SILK
SINA
SINGLES
SITE
SJ
SK
SKI
SKIN
SKY
SKYPE
SL
SLING
SM
SMART
SMILE
SN
SNCF
SO
SOCCER
SOCIAL
SOFTBANK
SOFTWARE
SOHU
SOLAR
SOLUTIONS
SONG
SONY
SOY
SPA
SPACE
SPORT
SPOT
SR
SRL
SS
ST
STADA
STAPLES
STAR
STATEBANK
STATEFARM
STC
STCGROUP
STOCKHOLM
STORAGE
STORE
STREAM
STUDIO
STUDY
STYLE
SU
SUCKS
SUPPLIES
SUPPLY
SUPPORT
SURF
SURGERY
SUZUKI
SV
SWATCH
SWISS
SX
SY
SYDNEY
SYSTEMS
SZ
TAB
TAIPEI
TALK
TAOBAO
TARGET
TATAMOTORS
TATAR
TATTOO
TAX
TAXI
TC
TCI
TD
TDK
TEAM
TECH
TECHNOLOGY
TEL
TEMASEK
TENNIS
TEVA
TF
TG
TH
THD
THEATER
THEATRE
TIAA
TICKETS
TIENDA
TIFFANY
TIPS
TIRES
TIROL
TJ
TJMAXX
TJX
TK
TKMAXX
TL
TM
TMALL
TN
TO
TODAY
TOKYO
TOOLS
TOP
TORAY
TOSHIBA
TOTAL
TOURS
TOWN
TOYOTA
TOYS
TR
TRADE
TRADING
TRAINING
TRAVEL
TRAVELCHANNEL
TRAVELERS
TRAVELERSINSURANCE
TRUST
TRV
TT
TUBE
TUI
TUNES
TUSHU
TV
TVS
TW
TZ
UA
UBANK
UBS
UG
UK
UNICOM
UNIVERSITY
UNO
UOL
UPS
US
UY
UZ
VA
VACATIONS
VANA
VANGUARD
VC
VE
VEGAS
VENTURES
VERISIGN
VERSICHERUNG
VET
VG
VI
VIAJES
VIDEO
VIG
VIKING
VILLAS
VIN
VIP
VIRGIN
VISA
VISION
VIVA
VIVO
VLAANDEREN
VN
VODKA
VOLKSWAGEN
VOLVO
VOTE
VOTING
VOTO
VOYAGE
VU
VUELOS
WALES
WALMART
WALTER
WANG
WANGGOU
WATCH
WATCHES
WEATHER
WEATHERCHANNEL
WEBCAM
WEBER
WEBSITE
WED
WEDDING
WEIBO
WEIR
WF
WHOSWHO
WIEN
WIKI
WILLIAMHILL
WIN
WINDOWS
WINE
WINNERS
WME
WOLTERSKLUWER
WOODSIDE
WORK
WORKS
WORLD
WOW
WS
WTC
WTF
XBOX
XEROX
XFINITY
XIHUAN
XIN
XN--11B4C3D
XN--1CK2E1B
XN--1QQW23A
XN--2SCRJ9C
XN--30RR7Y
XN--3BST00M
XN--3DS443G
XN--3E0B707E
XN--3HCRJ9C
XN--3PXU8K
XN--42C2D9A
XN--45BR5CYL
XN--45BRJ9C
XN--45Q11C
XN--4DBRK0CE
XN--4GBRIM
XN--54B7FTA0CC
XN--55QW42G
XN--55QX5D
XN--5SU34J936BGSG
XN--5TZM5G
XN--6FRZ82G
XN--6QQ986B3XL
XN--80ADXHKS
XN--80AO21A
XN--80AQECDR1A
XN--80ASEHDB
XN--80ASWG
XN--8Y0A063A
XN--90A3AC
XN--90AE
XN--90AIS
XN--9DBQ2A
XN--9ET52U
XN--9KRT00A
XN--B4W605FERD
XN--BCK1B9A5DRE4C
XN--C1AVG
XN--C2BR7G
XN--CCK2B3B
XN--CCKWCXETD
XN--CG4BKI
XN--CLCHC0EA0B2G2A9GCD
XN--CZR694B
XN--CZRS0T
XN--CZRU2D
XN--D1ACJ3B
XN--D1ALF
XN--E1A4C
XN--ECKVDTC9D
XN--EFVY88H
XN--FCT429K
XN--FHBEI
XN--FIQ228C5HS
XN--FIQ64B
XN--FIQS8S
XN--FIQZ9S
XN--FJQ720A
XN--FLW351E
XN--FPCRJ9C3D
XN--FZC2C9E2C
XN--FZYS8D69UVGM
XN--G2XX48C
XN--GCKR3F0F
XN--GECRJ9C
XN--GK3AT1E
XN--H2BREG3EVE
XN--H2BRJ9C
XN--H2BRJ9C8C
XN--HXT814E
XN--I1B6B1A6A2E
XN--IMR513N
XN--IO0A7I
XN--J1AEF
XN--J1AMH
XN--J6W193G
XN--JLQ480N2RG
XN--JVR189M
XN--KCRX77D1X4A
XN--KPRW13D
XN--KPRY57D
XN--KPUT3I
XN--L1ACC
XN--LGBBAT1AD8J
XN--MGB9AWBF
XN--MGBA3A3EJT
XN--MGBA3A4F16A
XN--MGBA7C0BBN0A
XN--MGBAAKC7DVF
XN--MGBAAM7A8H
XN--MGBAB2BD
XN--MGBAH1A3HJKRD
XN--MGBAI9AZGQP6J
XN--MGBAYH7GPA
XN--MGBBH1A
XN--MGBBH1A71E
XN--MGBC0A9AZCG
XN--MGBCA7DZDO
XN--MGBCPQ6GPA1A
XN--MGBERP4A5D4AR
XN--MGBGU82A
XN--MGBI4ECEXP
XN--MGBPL2FH
XN--MGBT3DHD
XN--MGBTX2B
XN--MGBX4CD0AB
XN--MIX891F
XN--MK1BU44C
XN--MXTQ1M
XN--NGBC5AZD
XN--NGBE9E0A
XN--NGBRX
XN--NODE
XN--NQV7F
XN--NQV7FS00EMA
XN--NYQY26A
XN--O3CW4H
XN--OGBPF8FL
XN--OTU796D
XN--P1ACF
XN--P1AI
XN--PGBS0DH
XN--PSSY2U
XN--Q7CE6A
XN--Q9JYB4C
XN--QCKA1PMC
XN--QXA6A
XN--QXAM
XN--RHQV96G
XN--ROVU88B
XN--RVC1E0AM3E
XN--S9BRJ9C
XN--SES554G
XN--T60B56A
XN--TCKWE
XN--TIQ49XQYJ
XN--UNUP4Y
XN--VERMGENSBERATER-CTB
XN--VERMGENSBERATUNG-PWB
XN--VHQUV
XN--VUQ861B
XN--W4R85EL8FHU5DNRA
XN--W4RS40L
XN--WGBH1C
XN--WGBL6A
XN--XHQ521B
XN--XKC2AL3HYE2A
XN--XKC2DL3A5EE0H
XN--Y9A3AQ
XN--YFRO4I67O
XN--YGBI2AMMX
XN--ZFR164B
XXX
XYZ
YACHTS
YAHOO
YAMAXUN
YANDEX
YE
YODOBASHI
YOGA
YOKOHAMA
YOU
YOUTUBE
YT
YUN
ZA
ZAPPOS
ZARA
ZERO
ZIP
ZM
ZONE
ZUERICH
ZW
`;
