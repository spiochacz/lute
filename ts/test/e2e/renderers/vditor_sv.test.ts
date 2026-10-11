import { svBoth, SV_SETS } from "./vditor_helpers.ts";
import { registerSuite } from "./vditor_suite.ts";

// VditorSVRenderer: parse.Parse + NewVditorSVRenderer(...).Render() as Lute.Md2VditorSVDOM does, against the reference bundle's Md2VditorSVDOM.
registerSuite("VditorSVRenderer", svBoth, SV_SETS);
