import { gather } from "narai-primitives";

const result = await gather({
  prompt: "Get the Notion page at https://www.notion.so/Page-abcdef0123456789abcdef0123456789",
  consumer: "doc-wiki",
});
console.log(JSON.stringify(result, null, 2));
