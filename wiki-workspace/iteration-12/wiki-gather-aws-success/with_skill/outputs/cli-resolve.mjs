import { resolveAgentCli } from "narai-primitives/toolkit";
const result = resolveAgentCli({ name: "aws" });
console.log(JSON.stringify(result, null, 2));
