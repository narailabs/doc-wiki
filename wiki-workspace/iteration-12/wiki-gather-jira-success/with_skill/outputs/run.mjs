// Approach A: local HTTP stub. Drives gather() with a deterministic mock
// planner (no LLM round-trip) so the eval is hermetic and exercises only the
// dispatch -> connector subprocess -> credential resolution -> HTTP -> success
// envelope path against a stub on JIRA_SITE_URL.
import http from "node:http";
import { gather } from "narai-primitives";

// 1) Spin up an HTTP stub on a random free port that mimics the slice of
//    Jira REST v3 the connector actually calls.
const requestLog = [];
const server = http.createServer((req, res) => {
  const auth = req.headers["authorization"] ?? null;
  requestLog.push({ method: req.method, url: req.url, auth_present: typeof auth === "string" && auth.startsWith("Basic ") });
  // Match GET /rest/api/3/issue/PROJ-1
  if (req.method === "GET" && req.url && req.url.startsWith("/rest/api/3/issue/PROJ-1")) {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      key: "PROJ-1",
      id: "10001",
      self: `${process.env.JIRA_SITE_URL}/rest/api/3/issue/10001`,
      fields: {
        summary: "Stub issue summary",
        status: { name: "Open" },
        issuetype: { name: "Task" },
        description: { type: "doc", version: 1, content: [] },
      },
    }));
    return;
  }
  // Default: 404 JSON
  res.statusCode = 404;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ errorMessages: [`stub: no handler for ${req.method} ${req.url}`] }));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
process.env.JIRA_SITE_URL = baseUrl;
process.env.JIRA_EMAIL = "stub@example.com";
process.env.JIRA_API_TOKEN = "ATATTfaketoken000000000000";
process.stderr.write(`[stub] jira listening on ${baseUrl}\n`);

// 2) Mock planner — return a fixed JSON array. gather() accepts deps.planner.
const mockPlanner = {
  async plan(_systemPrompt, _userPrompt) {
    return JSON.stringify([
      { connector: "jira", action: "get_issue", params: { issue_key: "PROJ-1" } },
    ]);
  },
};

try {
  const result = await gather(
    {
      prompt: "Get the Jira issue at " + baseUrl + "/browse/PROJ-1",
      consumer: "doc-wiki",
    },
    { planner: mockPlanner },
  );
  console.log(JSON.stringify({ result, request_log: requestLog }, null, 2));
} finally {
  server.close();
}
