import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGlobal } from "../../src/index.ts";
import { loadOracle, normalizeIDs } from "../oracle/oracle.ts";

// SetJSRenderers through the global New(options) of both implementations. The `node` argument of the user functions is the port's
// ast.Node on one side and the GopherJS wrapper on the other; only methods (which both expose under the Go names) are used here.
type RenderResult = [string, number];
type Options = Record<string, unknown>;

const portGlobal = makeGlobal();
const oracleGlobal = loadOracle();

const MARKDOWN = "# Title\n\nSome *emphasis* and `code` and [link](http://a.b).\n\n- one\n- two\n\n> quote\n\n![img](src)\n";

function run(newEngine: (options: Options) => { MarkdownStr(name: string, markdown: string): string }, options: Options, markdown: string): string {
  return normalizeIDs(newEngine(options).MarkdownStr("", markdown));
}

function both(options: () => Options, markdown: string = MARKDOWN): { port: string; oracle: string } {
  return {
    port: run((o) => portGlobal.New(o), options(), markdown),
    oracle: run((o) => oracleGlobal.New(o) as { MarkdownStr(name: string, markdown: string): string }, options(), markdown),
  };
}

function bothMessages(options: () => Options): { port: string; oracle: string } {
  const message = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return "<no error>";
  };
  return {
    port: message(() => portGlobal.New(options())),
    oracle: message(() => oracleGlobal.New(options())),
  };
}

test("no options and empty options", () => {
  for (const options of [undefined, null, {}, { renderers: {} }, { renderers: null }, { renderers: 5 }] as Options[]) {
    const { port, oracle } = both(() => options);
    assert.equal(port, oracle);
    assert.equal(port.includes("<h1"), true);
  }
});

test("renderHeading wraps headings", () => {
  const { port, oracle } = both(() => ({
    renderers: {
      Md2HTML: {
        renderHeading: (node: { Text(): string }, entering: boolean): RenderResult =>
          entering ? ["<section data-text=\"" + node.Text() + "\"><h1 class=\"x\">", makeGlobal().WalkContinue] : ["</h1></section>\n", makeGlobal().WalkContinue],
      },
    },
  }));
  assert.equal(port, oracle);
  assert.match(port, /<section data-text="Title">/);
});

test("a function returning WalkSkipChildren", () => {
  const { port, oracle } = both(() => ({
    renderers: {
      Md2HTML: {
        renderBlockquote: (_node: unknown, entering: boolean): RenderResult =>
          entering ? ["<blockquote>skipped</blockquote>\n", portGlobal.WalkSkipChildren] : ["", portGlobal.WalkContinue],
        renderEmphasis: (_node: unknown, entering: boolean): RenderResult => (entering ? ["<i>", portGlobal.WalkContinue] : ["</i>", portGlobal.WalkContinue]),
      },
    },
  }));
  assert.equal(port, oracle);
  assert.match(port, /skipped/);
  assert.doesNotMatch(port, /<p>quote/);
});

test("a function returning WalkStop", () => {
  const { port, oracle } = both(() => ({
    renderers: {
      Md2HTML: { renderList: (): RenderResult => ["STOP", portGlobal.WalkStop] },
    },
  }));
  assert.equal(port, oracle);
});

test("several renderer types: only Md2HTML is used by MarkdownStr", () => {
  const { port, oracle } = both(() => ({
    renderers: {
      HTML2Md: { renderText: (): RenderResult => ["x", portGlobal.WalkContinue] },
      Md2VditorDOM: { renderParagraph: (): RenderResult => ["y", portGlobal.WalkContinue] },
      Md2HTML: { renderCodeSpan: (): RenderResult => ["<kbd>c</kbd>", portGlobal.WalkSkipChildren] },
    },
  }));
  assert.equal(port, oracle);
  assert.match(port, /<kbd>c<\/kbd>/);
});

test("a function name that matches no node type is ignored", () => {
  const { port, oracle } = both(() => ({
    renderers: { Md2HTML: { renderNoSuchNode: (): RenderResult => ["z", portGlobal.WalkContinue], ab: (): RenderResult => ["z", portGlobal.WalkContinue] } },
  }));
  assert.equal(port, oracle);
  assert.equal(port.includes("z"), false);
});

test("user functions receive the node and their results are used", () => {
  // renderText is registered; the function of the node type that the node has when it is rendered must exist: renderParagraph is not
  // defined, so a Paragraph node rendered through the registered closure of another type is not found. Registering only renderText and
  // rendering text nodes works; the lookup for a different type happens only if the node type changed, which this simulates by sharing.
  const calls: string[] = [];
  const { port, oracle } = both(() => ({
    renderers: {
      Md2HTML: {
        renderText: (node: { TokensStr(): string }): RenderResult => {
          calls.push(node.TokensStr());
          return [node.TokensStr().toUpperCase(), portGlobal.WalkContinue];
        },
      },
    },
  }));
  assert.equal(port, oracle);
  assert.match(port, /TITLE/);
  assert.ok(calls.length > 0);
});

test("error cases: invalid type, unknown renderer, wrong results", () => {
  for (const options of [
    () => ({ renderers: { Md2HTML: 1 } }),
    () => ({ renderers: { Md2HTML: () => 1 } }),
    () => ({ renderers: { Md2HTML: [] } }),
    () => ({ renderers: { Md2HTML: null } }),
    () => ({ renderers: { Md2HTML: "str" } }),
    () => ({ renderers: { NoSuchRenderer: {} } }),
    () => ({ renderers: { Md2HTML: {}, Other: {} } }),
  ]) {
    const { port, oracle } = bothMessages(options);
    assert.notEqual(oracle, "<no error>");
    assert.equal(port, oracle);
  }
  assert.equal(bothMessages(() => ({ renderers: { NoSuchRenderer: {} } })).port, "unknown ext renderer func [NoSuchRenderer]");
  assert.equal(bothMessages(() => ({ renderers: { Md2HTML: 1 } })).port, "invalid type [Md2HTML]");

  // Errors that happen when the registered function runs.
  const failing = (options: Options): { port: string; oracle: string } => {
    const message = (newEngine: (o: Options) => { MarkdownStr(name: string, markdown: string): string }): string => {
      try {
        newEngine(options).MarkdownStr("", "# a");
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      return "<no error>";
    };
    return {
      port: message((o) => portGlobal.New(o)),
      oracle: message((o) => oracleGlobal.New(o) as { MarkdownStr(name: string, markdown: string): string }),
    };
  };
  const notAnArray = failing({ renderers: { Md2HTML: { renderHeading: () => "x" } } });
  assert.equal(notAnArray.port, notAnArray.oracle);
  assert.equal(notAnArray.port, "interface conversion: interface is string, not []interface {}");
  const badFirst = failing({ renderers: { Md2HTML: { renderHeading: () => [1, 2] } } });
  assert.equal(badFirst.port, badFirst.oracle);
  assert.equal(badFirst.port, "interface conversion: interface is float64, not string");
  const badSecond = failing({ renderers: { Md2HTML: { renderHeading: () => ["x", "y"] } } });
  assert.equal(badSecond.port, badSecond.oracle);
  // A member that is not a function: both sides throw a TypeError (the messages are engine-specific).
  const notFunction = failing({ renderers: { Md2HTML: { renderHeading: 5 } } });
  assert.notEqual(notFunction.oracle, "<no error>");
  assert.notEqual(notFunction.port, "<no error>");
});
