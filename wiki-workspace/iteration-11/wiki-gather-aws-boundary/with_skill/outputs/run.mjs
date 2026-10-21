import { gather } from "narai-primitives";

const result = await gather({
  prompt: "List S3 buckets in us-east-1 (account-wide).",
  consumer: "doc-wiki",
});
console.log(JSON.stringify(result, null, 2));
