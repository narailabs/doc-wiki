import { resolveAgentCli } from "narai-primitives/toolkit";
const result = resolveAgentCli({ name: "db" });
console.log(JSON.stringify(result, null, 2));
