import { gather } from "narai-primitives";

const result = await gather({
  prompt: "List Cloud Run services in GCP project example-prod-123",
  consumer: "doc-wiki",
});
console.log(JSON.stringify(result, null, 2));
