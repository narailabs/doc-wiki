import { gather } from "narai-primitives";

const result = await gather({
  prompt: "Get repo metadata for https://github.com/anthropics/anthropic-sdk-python",
  consumer: "doc-wiki",
});
console.log(JSON.stringify(result, null, 2));
