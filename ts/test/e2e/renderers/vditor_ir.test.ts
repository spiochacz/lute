import { irBoth, IR_SETS } from "./vditor_helpers.ts";
import { registerSuite } from "./vditor_suite.ts";

// VditorIRRenderer: parse.Parse + NewVditorIRRenderer(...).Render() as Lute.Md2VditorIRDOM does, against the reference bundle's Md2VditorIRDOM.
registerSuite("VditorIRRenderer", irBoth, IR_SETS);
