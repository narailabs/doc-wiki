import { resolveAgentCli } from "narai-primitives/toolkit";
const result = resolveAgentCli({ name: "gcp" });
console.log(JSON.stringify(result, null, 2));
