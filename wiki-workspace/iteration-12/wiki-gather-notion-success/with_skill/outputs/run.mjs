// Approach B: TEST_LIVE_NOTION=1 gate. Skip when unset; exercise the real
// Notion API when the gate is on AND NOTION_TOKEN is present.
import { gather } from "narai-primitives";

const gateName = "TEST_LIVE_NOTION";
const tokenName = "NOTION_TOKEN";
const gate = process.env[gateName] === "1";
const tokenPresent = typeof process.env[tokenName] === "string" && process.env[tokenName].length > 0;

if (!gate) {
  const skip = {
    status: "skipped",
    skip_reason: `${gateName} not set; success-path covered only via the live-API gate. Set ${gateName}=1 plus a real ${tokenName} in env to exercise.`,
    approach: "B",
    rationale: "Notion API base URL (api.notion.com) is hardcoded inside @notionhq/client; a clean override requires DNS/hosts intercept or fetch monkey-patch in the connector subprocess — both higher-friction than this gate.",
  };
  console.log(JSON.stringify(skip, null, 2));
  process.exit(0);
}

if (!tokenPresent) {
  const fail = {
    status: "skipped",
    skip_reason: `${gateName}=1 but ${tokenName} missing in env; cannot exercise live API`,
    approach: "B",
  };
  console.log(JSON.stringify(fail, null, 2));
  process.exit(0);
}

const mockPlanner = {
  async plan(_systemPrompt, _userPrompt) {
    // Pick a deterministic action that exists on the connector and that the
    // operator's NOTION_TOKEN should be authorized for. The runner is
    // expected to set NOTION_PAGE_ID alongside the token.
    const pageId = process.env.NOTION_PAGE_ID ?? "abcdef0123456789abcdef0123456789";
    return JSON.stringify([
      { connector: "notion", action: "get_page", params: { page_id: pageId } },
    ]);
  },
};

const result = await gather(
  { prompt: "Get the Notion page from environment NOTION_PAGE_ID", consumer: "doc-wiki" },
  { planner: mockPlanner },
);
console.log(JSON.stringify({ status: "ran", result }, null, 2));
