// Helpers of the tests of the JSON, ECharts JSON, KityMinder JSON and Vditor WYSIWYG renderers.
// The port side of every comparison is the engine method of the same name.

import type { Lute } from "../../../src/index.ts";
import { attempt, assertSameOutcome, newEngines, normalizeOutput } from "../helpers.ts";
import type { Engines, SetterCall } from "../helpers.ts";

export type OracleMethod = "RenderJSON" | "RenderEChartsJSON" | "RenderKityMinderJSON" | "Md2VditorDOM";

const PORT_FUNCS: Record<OracleMethod, (lute: Lute, markdown: string) => string> = {
  RenderJSON: (lute, markdown) => lute.RenderJSON(markdown),
  RenderEChartsJSON: (lute, markdown) => lute.RenderEChartsJSON(markdown),
  RenderKityMinderJSON: (lute, markdown) => lute.RenderKityMinderJSON(markdown),
  Md2VditorDOM: (lute, markdown) => lute.Md2VditorDOM(markdown),
};

export interface Counters {
  compared: number;
  bothThrew: string[];
}

export function newCounters(): Counters {
  return { compared: 0, bothThrew: [] };
}

// Runs the method on both engines and asserts equal outcomes. Returns the port output ("" when it threw).
export function compareMethod(engines: Engines, method: OracleMethod, label: string, markdown: string, counters: Counters): string {
  const port = attempt(() => PORT_FUNCS[method](engines.port, markdown));
  const oracle = attempt(() => {
    const fn = engines.oracle[method] as (md: string) => string;
    return fn.call(engines.oracle, markdown);
  });
  counters.compared++;
  if (assertSameOutcome(`${method} ${label}: ${JSON.stringify(markdown)}`, port, oracle) === "bothThrew") {
    counters.bothThrew.push(label + ": " + JSON.stringify(markdown));
  }
  return port.value;
}

export { newEngines, normalizeOutput };
export type { Engines, SetterCall };
