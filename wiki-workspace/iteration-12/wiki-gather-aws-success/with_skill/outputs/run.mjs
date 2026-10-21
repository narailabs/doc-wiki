// Approach B: TEST_LIVE_AWS=1 gate. Skip when unset; exercise the real
// AWS account (read-only list_buckets) when the gate is on AND credentials
// are present in env.
import { gather } from "narai-primitives";

const gateName = "TEST_LIVE_AWS";
const gate = process.env[gateName] === "1";
const credsPresent = (
  (typeof process.env.AWS_ACCESS_KEY_ID === "string" && process.env.AWS_ACCESS_KEY_ID.length > 0) ||
  (typeof process.env.AWS_PROFILE === "string" && process.env.AWS_PROFILE.length > 0)
);

if (!gate) {
  const skip = {
    status: "skipped",
    skip_reason: `${gateName} not set; success-path covered only via the live-API gate. Set ${gateName}=1 plus AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (or AWS_PROFILE) to exercise.`,
    approach: "B",
    rationale: "Faithfully stubbing S3's signed-request protocol or any other AWS SDK call requires localstack/moto (Docker dep) or a SigV4-aware HTTP stub — both higher-friction than this gate. AWS_ENDPOINT_URL would point an SDK at a stub, but the stub itself is the expensive part.",
  };
  console.log(JSON.stringify(skip, null, 2));
  process.exit(0);
}

if (!credsPresent) {
  console.log(JSON.stringify({
    status: "skipped",
    skip_reason: `${gateName}=1 but no AWS credentials in env; cannot exercise live API`,
    approach: "B",
  }, null, 2));
  process.exit(0);
}

const mockPlanner = {
  async plan(_systemPrompt, _userPrompt) {
    return JSON.stringify([
      { connector: "aws", action: "list_buckets", params: { region: "us-east-1" } },
    ]);
  },
};

const result = await gather(
  { prompt: "List S3 buckets in us-east-1", consumer: "doc-wiki" },
  { planner: mockPlanner },
);
console.log(JSON.stringify({ status: "ran", result }, null, 2));
