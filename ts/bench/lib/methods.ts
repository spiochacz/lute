// The method table shared by the macro benchmark and the CPU profiler: how each Lute
// method is called, which input kind it takes and which engine configuration it needs.
// Importing this file starts nothing.

// Loosely typed on purpose, as in test/oracle/oracle.ts.
export type Engine = Record<string, any>;

export interface LuteGlobal {
  New(): Engine;
}

// markdown: the Markdown text itself. The others are made by the reference from the Markdown
// (see makeRoundTripInputs in bench/lib/inputs.ts).
export type InputKind = "markdown" | "html" | "vditorDOM" | "blockDOM";

export interface MethodSpec {
  name: string;
  config: "default" | "wysiwyg";
  input: InputKind;
  call: (e: Engine, input: string) => unknown;
}

// The methods of bench/oracle-baseline.ts, plus Md2HTML when the bundle has it.
export const METHODS: MethodSpec[] = [
  { name: "MarkdownStr", config: "default", input: "markdown", call: (e, i) => e.MarkdownStr("", i) },
  { name: "FormatStr", config: "default", input: "markdown", call: (e, i) => e.FormatStr("", i) },
  { name: "Md2HTML", config: "default", input: "markdown", call: (e, i) => e.Md2HTML(i) },
  { name: "Md2VditorDOM", config: "default", input: "markdown", call: (e, i) => e.Md2VditorDOM(i) },
  { name: "Md2VditorIRDOM", config: "default", input: "markdown", call: (e, i) => e.Md2VditorIRDOM(i) },
  { name: "Md2VditorSVDOM", config: "default", input: "markdown", call: (e, i) => e.Md2VditorSVDOM(i) },
  { name: "Md2BlockDOM", config: "default", input: "markdown", call: (e, i) => e.Md2BlockDOM(i) },
  { name: "SpinVditorDOM", config: "wysiwyg", input: "vditorDOM", call: (e, i) => e.SpinVditorDOM(i) },
  { name: "VditorDOM2Md", config: "wysiwyg", input: "vditorDOM", call: (e, i) => e.VditorDOM2Md(i) },
  { name: "SpinBlockDOM", config: "default", input: "blockDOM", call: (e, i) => e.SpinBlockDOM(i) },
  { name: "BlockDOM2Md", config: "default", input: "blockDOM", call: (e, i) => e.BlockDOM2Md(i) },
  { name: "HTML2Md", config: "default", input: "html", call: (e, i) => e.HTML2Md(i) },
];

export function findMethod(name: string): MethodSpec | undefined {
  return METHODS.find((m) => m.name === name);
}

// The engine a method is measured on: SpinVditorDOM and VditorDOM2Md on a wysiwyg engine,
// as in test/e2e/bundle_driver.mjs; everything else on a default engine.
export function makeEngine(lute: LuteGlobal, spec: MethodSpec): Engine {
  const engine = lute.New();
  if (spec.config === "wysiwyg") {
    engine.SetVditorWYSIWYG(true);
  }
  return engine;
}
