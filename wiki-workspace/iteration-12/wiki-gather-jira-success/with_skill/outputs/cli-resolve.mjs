import { resolveAgentCli } from "narai-primitives/toolkit";
const result = resolveAgentCli({ name: "jira" });
console.log(JSON.stringify(result, null, 2));
