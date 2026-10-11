// Helpers of the FormatRenderer and TextBundleRenderer end-to-end tests: Lute.FormatStr and Lute.TextBundleStr of the port against the reference bundle.

import { assertSameOutcome, attempt, normalizeOutput } from "../helpers.ts";
import type { Engines, Outcome } from "../helpers.ts";

export function formatBoth(engines: Engines, name: string, markdown: string): { port: Outcome; oracle: Outcome } {
  return {
    port: attempt(() => engines.port.FormatStr(name, markdown)),
    oracle: attempt(() => engines.oracle.FormatStr(name, markdown) as string),
  };
}

// The result is compared as JSON of [text, originalLinks]; the generated IDs and timestamps are normalised in the text before it is escaped.
export function textBundleBoth(engines: Engines, name: string, markdown: string, linkPrefixes: string[]): { port: Outcome; oracle: Outcome } {
  return {
    port: attempt(() => {
      const [text, links] = engines.port.TextBundleStr(name, markdown, linkPrefixes);
      return JSON.stringify([normalizeOutput(text), links]);
    }),
    oracle: attempt(() => {
      const [text, links] = engines.oracle.TextBundleStr(name, markdown, linkPrefixes) as [string, string[] | null];
      return JSON.stringify([normalizeOutput(text), links]);
    }),
  };
}

// Inputs on which the oracle and the port both throw count as equal; they are collected to be reported.
export const bothThrew: string[] = [];

export function compare(engines: Engines, label: string, name: string, markdown: string, failures: string[]): { port: Outcome; oracle: Outcome } {
  const r = formatBoth(engines, name, markdown);
  try {
    if (assertSameOutcome(label, r.port, r.oracle) === "bothThrew") {
      bothThrew.push(label);
    }
  } catch (e) {
    failures.push((e as Error).message + "\n  input: " + JSON.stringify(markdown));
  }
  return r;
}
