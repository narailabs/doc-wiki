import { resolveAgentCli } from "narai-primitives/toolkit";
const result = resolveAgentCli({ name: "github" });
console.log(JSON.stringify(result, null, 2));
