import { resolveAgentCli } from "narai-primitives/toolkit";
const result = resolveAgentCli({ name: "notion" });
console.log(JSON.stringify(result, null, 2));
