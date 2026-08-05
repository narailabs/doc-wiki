import { gather } from "narai-primitives";

const result = await gather({
  prompt: "Run this SQL query against the 'evaldb' environment: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 50",
  consumer: "doc-wiki",
});
console.log(JSON.stringify(result, null, 2));
