// Shared helpers of the end-to-end tests: one engine of the port and one of the
// reference bundle (the oracle) are configured by the same list of setter calls,
// and the same call is run on both.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { New } from "../../src/index.ts";
import type { Lute } from "../../src/index.ts";
import { assertSameOutput, newOracleEngine, normalizeIDs } from "../oracle/oracle.ts";
import type { OracleEngine } from "../oracle/oracle.ts";

export type SetterCall = [name: string, ...args: unknown[]];

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function readRepoFile(relative: string): string {
  return readFileSync(REPO_ROOT + relative, "utf8");
}

export interface Engines {
  port: Lute;
  oracle: OracleEngine;
}

// Applies the setter calls to both engines. A setter that does not exist on either engine is an error of the test.
export function newEngines(setters: readonly SetterCall[]): Engines {
  const port = New();
  const oracle = newOracleEngine();
  for (const [name, ...args] of setters) {
    const portSetter = (port as unknown as Record<string, unknown>)[name];
    const oracleSetter = oracle[name];
    if (typeof portSetter !== "function") {
      throw new Error(`port engine has no setter ${name}`);
    }
    if (typeof oracleSetter !== "function") {
      throw new Error(`oracle engine has no setter ${name}`);
    }
    portSetter.apply(port, args);
    oracleSetter.apply(oracle, args);
  }
  return { port, oracle };
}

export interface Outcome {
  threw: boolean;
  value: string;
  message: string;
}

// Generated node IDs and the `updated` timestamps that go with them depend on the clock.
const UPDATED_PATTERN = /updated="\d{14}"/g;
// The JSON renderer writes the same timestamp as a property of a JSON object; without this a run that crosses a second boundary between the two sides fails.
const UPDATED_JSON_PATTERN = /"updated":"\d{14}"/g;

export function normalizeOutput(s: string): string {
  return normalizeIDs(s).replace(UPDATED_PATTERN, 'updated="TIMESTAMP"').replace(UPDATED_JSON_PATTERN, '"updated":"TIMESTAMP"');
}

export function attempt(fn: () => string): Outcome {
  try {
    return { threw: false, value: normalizeOutput(fn()), message: "" };
  } catch (e) {
    return { threw: true, value: "", message: e instanceof Error ? e.message : String(e) };
  }
}

// Runs MarkdownStr on both engines.
export function markdownBoth(engines: Engines, name: string, markdown: string): { port: Outcome; oracle: Outcome } {
  return {
    port: attempt(() => engines.port.MarkdownStr(name, markdown)),
    oracle: attempt(() => engines.oracle.MarkdownStr(name, markdown)),
  };
}

// Asserts that both outcomes are equal; "equal" includes both throwing. Returns "ok" or "bothThrew" for the caller's bookkeeping.
export function assertSameOutcome(label: string, port: Outcome, oracle: Outcome): "ok" | "bothThrew" {
  if (port.threw !== oracle.threw) {
    throw new Error(
      `${label}: ${oracle.threw ? "oracle threw" : "port threw"} (${oracle.threw ? oracle.message : port.message}) but the other side returned output`,
    );
  }
  if (port.threw) {
    return "bothThrew";
  }
  assertSameOutput(label, port.value, oracle.value);
  return "ok";
}

