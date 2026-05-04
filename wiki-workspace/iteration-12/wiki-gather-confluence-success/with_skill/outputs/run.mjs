// Approach A: local HTTP stub for confluence. Mirrors the jira eval — drives
// gather() with a deterministic mock planner so the eval is hermetic.
import http from "node:http";
import { gather } from "narai-primitives";

const PAGE_ID = "1";
const STUB_TITLE = "Stub page title";
const STUB_BODY = "<p>Stub body content.</p>";

const requestLog = [];
const server = http.createServer((req, res) => {
  const auth = req.headers["authorization"] ?? null;
  requestLog.push({ method: req.method, url: req.url, auth_present: typeof auth === "string" && auth.startsWith("Basic ") });
  // Connector calls GET /wiki/rest/api/content/<id>?expand=...
  if (req.method === "GET" && req.url && req.url.startsWith(`/wiki/rest/api/content/${PAGE_ID}`)) {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: PAGE_ID,
      type: "page",
      title: STUB_TITLE,
      space: { key: "PROJ", name: "Project" },
      version: { number: 3, when: "2026-05-01T12:00:00Z" },
      body: { storage: { value: STUB_BODY, representation: "storage" } },
    }));
    return;
  }
  res.statusCode = 404;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ message: `stub: no handler for ${req.method} ${req.url}` }));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
process.env.CONFLUENCE_SITE_URL = baseUrl;
process.env.CONFLUENCE_EMAIL = "stub@example.com";
process.env.CONFLUENCE_API_TOKEN = "ATATTfaketoken000000000000";
process.stderr.write(`[stub] confluence listening on ${baseUrl}\n`);

const mockPlanner = {
  async plan(_systemPrompt, _userPrompt) {
    return JSON.stringify([
      { connector: "confluence", action: "get_page", params: { page_id: PAGE_ID } },
    ]);
  },
};

try {
  const result = await gather(
    {
      prompt: "Get the Confluence page at " + baseUrl + "/wiki/spaces/PROJ/pages/" + PAGE_ID,
      consumer: "doc-wiki",
    },
    { planner: mockPlanner },
  );
  console.log(JSON.stringify({ result, request_log: requestLog }, null, 2));
} finally {
  server.close();
}
