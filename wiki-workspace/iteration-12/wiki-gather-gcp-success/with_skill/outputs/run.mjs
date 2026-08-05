// Approach B: TEST_LIVE_GCP=1 gate. Skip when unset; exercise the real
// GCP account when the gate is on AND gcloud is on PATH AND ADC is configured.
import { gather } from "narai-primitives";
import { execSync } from "node:child_process";

const gateName = "TEST_LIVE_GCP";
const gate = process.env[gateName] === "1";

function gcloudOnPath() {
  try { execSync("which gcloud", { stdio: "ignore" }); return true; }
  catch { return false; }
}

if (!gate) {
  const skip = {
    status: "skipped",
    skip_reason: `${gateName} not set; success-path covered only via the live-API gate. Set ${gateName}=1 plus install gcloud and configure Application Default Credentials to exercise.`,
    approach: "B",
    rationale: "The gcp connector probes for the gcloud binary on PATH and relies on Application Default Credentials; faithfully stubbing both (a fake gcloud shim plus signed-token mock) is far more friction than this gate.",
  };
  console.log(JSON.stringify(skip, null, 2));
  process.exit(0);
}

if (!gcloudOnPath()) {
  console.log(JSON.stringify({
    status: "skipped",
    skip_reason: `${gateName}=1 but gcloud not on PATH; cannot exercise live API`,
    approach: "B",
  }, null, 2));
  process.exit(0);
}

const projectId = process.env.GCP_PROJECT_ID;
if (!projectId) {
  console.log(JSON.stringify({
    status: "skipped",
    skip_reason: `${gateName}=1 but GCP_PROJECT_ID missing in env`,
    approach: "B",
  }, null, 2));
  process.exit(0);
}

const mockPlanner = {
  async plan(_systemPrompt, _userPrompt) {
    return JSON.stringify([
      { connector: "gcp", action: "list_services", params: { project_id: projectId } },
    ]);
  },
};

const result = await gather(
  { prompt: `List enabled GCP services in project ${projectId}`, consumer: "doc-wiki" },
  { planner: mockPlanner },
);
console.log(JSON.stringify({ status: "ran", result }, null, 2));
