// Ported from render/term_typographer.go @ 8e7896b6
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
import * as utf8 from "../runtime/utf8.ts";
import * as lex from "../lex/index.ts";
import * as util from "../util/index.ts";
import { BaseRenderer } from "./types.ts";

declare module "./types.ts" {
  interface BaseRenderer {
    FixTermTypo(tokens: Uint8Array): Uint8Array;
    fixTermTypo0(tokens: Uint8Array): Uint8Array;
  }
}

// FixTermTypo fixes the spelling of terms in tokens.
BaseRenderer.prototype.FixTermTypo = function (this: BaseRenderer, tokens: Uint8Array): Uint8Array {
  const r = this;
  return r.fixTermTypo0(tokens);
};

BaseRenderer.prototype.fixTermTypo0 = function (this: BaseRenderer, tokens: Uint8Array): Uint8Array {
  const r = this;
  const length = tokens.length;
  let token = 0;
  let i = 0;
  let j = 0;
  let k = 0;
  let l = 0;
  let before = 0;
  let after = 0;
  let originalTerm: Uint8Array = new Uint8Array(0);
  for (; i < length; i++) {
    token = tokens[i];
    if (isNotTerm(token)) {
      continue;
    }
    if (1 <= i) {
      before = tokens[i - 1];
      if (!isNotTerm(before)) {
        // The previous byte must be a non-term, otherwise there is no separator
        continue;
      }
    }
    if (lex.IsASCIIPunct(before)) {
      // For example if the term is preceded by a . then do not fix it, because it may be a link
      // For example test.html cannot be recognized as an autolink, but it must not be fixed either
      continue;
    }

    for (j = i; j < length; j++) {
      after = tokens[j];
      if (isNotTerm(after) || lex.ItemDot === after) {
        break;
      }
    }
    if (lex.IsASCIIPunct(after)) {
      // For example if the term is followed by a . then do not fix it, because it may be a link
      // For example github.com cannot be recognized as an autolink, but it must not be fixed either
      continue;
    }

    originalTerm = bytes.ToLower(tokens.subarray(i, j));
    const to = r.Options.Terms.get(util.BytesToStr(originalTerm));
    if (undefined !== to) {
      // Go indexes the string to by byte (a replacement with non-ASCII characters writes UTF-8 bytes into tokens)
      const toBytes = conv.BytesFromString(to);
      l = 0;
      for (k = i; k < j; k++) {
        if (l >= toBytes.length) {
          // PORT-NOTE: Go panics here (index out of range), a user supplied term whose replacement is shorter than its key
          throw new Error("index out of range [" + l + "] with length " + toBytes.length);
        }
        tokens[k] = toBytes[l];
        l++;
      }
    }
  }

  return tokens;
};

export function isNotTerm(token: number): boolean {
  return token >= utf8.RuneSelf || lex.IsWhitespace(token) || lex.IsASCIIPunct(token);
}

export function NewTerms(): Map<string, string> {
  let ret: Map<string, string> = new Map<string, string>();
  ret = new Map<string, string>();
  for (const [k, v] of terms) {
    ret.set(k, v);
  }
  return ret;
}

// terms defines the term dictionary used for fixing term spelling. Keys must be all lower case.
const terms: Map<string, string> = new Map<string, string>([
  ["flutter", "Flutter"],
  ["netty", "Netty"],
  ["jetty", "Jetty"],
  ["tomcat", "Tomcat"],
  ["jdbc", "JDBC"],
  ["mariadb", "MariaDB"],
  ["ipfs", "IPFS"],
  ["saas", "SaaS"],
  ["paas", "PaaS"],
  ["iaas", "IaaS"],
  ["ioc", "IoC"],
  ["freemarker", "FreeMarker"],
  ["ruby", "Ruby"],
  ["rails", "Rails"],
  ["mina", "Mina"],
  ["puppet", "Puppet"],
  ["vagrant", "Vagrant"],
  ["chef", "Chef"],
  ["beego", "Beego"],
  ["gin", "Gin"],
  ["iris", "Iris"],
  ["php", "PHP"],
  ["ssh", "SSH"],
  ["web", "Web"],
  ["websocket", "WebSocket"],
  ["api", "API"],
  ["css", "CSS"],
  ["html", "HTML"],
  ["json", "JSON"],
  ["jsonp", "JSONP"],
  ["xml", "XML"],
  ["yaml", "YAML"],
  ["csv", "CSV"],
  ["soap", "SOAP"],
  ["ajax", "AJAX"],
  ["messagepack", "MessagePack"],
  ["javascript", "JavaScript"],
  ["java", "Java"],
  ["jsp", "JSP"],
  ["restful", "RESTFul"],
  ["graphql", "GraphQL"],
  ["gorm", "GORM"],
  ["orm", "ORM"],
  ["oauth", "OAuth"],
  ["facebook", "Facebook"],
  ["github", "GitHub"],
  ["gist", "Gist"],
  ["heroku", "Heroku"],
  ["twitter", "Twitter"],
  ["youtube", "YouTube"],
  ["dynamodb", "DynamoDB"],
  ["mysql", "MySQL"],
  ["postgresql", "PostgreSQL"],
  ["sqlite", "SQLite"],
  ["memcached", "Memcached"],
  ["mongodb", "MongoDB"],
  ["redis", "Redis"],
  ["elasticsearch", "Elasticsearch"],
  ["solr", "Solr"],
  ["b3log", "B3log"],
  ["hacpai", "HacPai"],
  ["sphinx", "Sphinx"],
  ["linux", "Linux"],
  ["ubuntu", "Ubuntu"],
  ["centos", "CentOS"],
  ["centos7", "CentOS7"],
  ["redhat", "RedHat"],
  ["gitlab", "GitLab"],
  ["jquery", "jQuery"],
  ["angularjs", "AngularJS"],
  ["ffmpeg", "FFmpeg"],
  ["git", "Git"],
  ["svn", "SVN"],
  ["vim", "VIM"],
  ["emacs", "Emacs"],
  ["sublime", "Sublime"],
  ["virtualbox", "VirtualBox"],
  ["safari", "Safari"],
  ["chrome", "Chrome"],
  ["ie", "IE"],
  ["firefox", "Firefox"],
  ["iterm", "iTerm"],
  ["iterm2", "iTerm2"],
  ["iwork", "iWork"],
  ["itunes", "iTunes"],
  ["iphoto", "iPhoto"],
  ["ibook", "iBook"],
  ["imessage", "iMessage"],
  ["photoshop", "Photoshop"],
  ["excel", "Excel"],
  ["powerpoint", "PowerPoint"],
  ["ios", "iOS"],
  ["iphone", "iPhone"],
  ["ipad", "iPad"],
  ["android", "Android"],
  ["imac", "iMac"],
  ["macbook", "MacBook"],
  ["vps", "VPS"],
  ["vpn", "VPN"],
  ["cpu", "CPU"],
  ["spring", "Spring"],
  ["springboot", "SpringBoot"],
  ["springcloud", "SpringCloud"],
  ["springmvc", "SpringMVC"],
  ["mybatis", "MyBatis"],
  ["qq", "QQ"],
  ["sql", "SQL"],
  ["markdown", "Markdown"],
  ["jdk", "JDK"],
  ["openjdk", "OpenJDK"],
  ["cors", "CORS"],
  ["protobuf", "Protobuf"],
  ["google", "Google"],
  ["ibm", "IBM"],
  ["oracle", "Oracle"],
  ["typora", "Typora"],
]);
