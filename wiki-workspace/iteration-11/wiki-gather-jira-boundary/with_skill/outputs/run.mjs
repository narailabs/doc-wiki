import { gather } from "narai-primitives";

const result = await gather({
  prompt: "Get the Jira issue at https://anthropic.atlassian.net/browse/PROJ-1",
  consumer: "doc-wiki",
});
console.log(JSON.stringify(result, null, 2));
