import { gather } from "narai-primitives";

const result = await gather({
  prompt: "Get the Confluence page at https://anthropic.atlassian.net/wiki/spaces/PROJ/pages/1",
  consumer: "doc-wiki",
});
console.log(JSON.stringify(result, null, 2));
