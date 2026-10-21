import { resolveAgentCli } from "narai-primitives/toolkit";
const result = resolveAgentCli({ name: "confluence" });
console.log(JSON.stringify(result, null, 2));
