// Helpers of the Protyle renderer comparisons: the port side is the engine method (Md2BlockDOM, Md2BlockDOMWithAutoLink, ProtylePreviewStr).

import { attempt, assertSameOutcome } from "../helpers.ts";
import type { Engines, Outcome } from "../helpers.ts";

// Comparison with the oracle


export type Kind = "dom" | "domReserve" | "domAutoLink" | "preview";

export function runPort(engines: Engines, kind: Kind, markdown: string): Outcome {
  switch (kind) {
    case "dom":
      return attempt(() => engines.port.Md2BlockDOM(markdown, false));
    case "domReserve":
      return attempt(() => engines.port.Md2BlockDOM(markdown, true));
    case "domAutoLink":
      return attempt(() => engines.port.Md2BlockDOMWithAutoLink(markdown, false));
    case "preview":
      return attempt(() => engines.port.ProtylePreviewStr("", markdown));
  }
}

export function runOracle(engines: Engines, kind: Kind, markdown: string): Outcome {
  switch (kind) {
    case "dom":
      return attempt(() => engines.oracle.Md2BlockDOM(markdown, false));
    case "domReserve":
      return attempt(() => engines.oracle.Md2BlockDOM(markdown, true));
    case "domAutoLink":
      return attempt(() => engines.oracle.Md2BlockDOMWithAutoLink(markdown, false));
    case "preview":
      return attempt(() => engines.oracle.ProtylePreviewStr("", markdown));
  }
}

export interface Tally {
  compared: number;
  bothThrew: string[];
  failures: string[];
}

export function newTally(): Tally {
  return { compared: 0, bothThrew: [], failures: [] };
}

export function compareOne(tally: Tally, engines: Engines, kind: Kind, label: string, markdown: string): void {
  const port = runPort(engines, kind, markdown);
  const oracle = runOracle(engines, kind, markdown);
  tally.compared++;
  try {
    if (assertSameOutcome(label, port, oracle) === "bothThrew") {
      tally.bothThrew.push(label + ": " + port.message + " | " + oracle.message);
    }
  } catch (e) {
    tally.failures.push((e as Error).message + "\n  input: " + JSON.stringify(markdown));
  }
}
