import { describe, expect, it } from "vitest";
import { buildPrompt, classifySession } from "../session.js";
import type { TicketRecord } from "../types.js";

const ticket = {
  title: "Crash when config file is empty",
  body_sanitized: "When the config file exists but is empty, the loader crashes.",
} as TicketRecord;

describe("buildPrompt", () => {
  it("is title + sanitized body + the fixed instruction, nothing else", () => {
    expect(buildPrompt(ticket)).toBe(
      "Crash when config file is empty\n\n" +
        "When the config file exists but is empty, the loader crashes.\n\n" +
        "Investigate and fix this issue in this repository. Run the relevant tests to check your fix.",
    );
  });
});

describe("classifySession", () => {
  it("ok: parses cost + session id from the json envelope", () => {
    const r = classifySession(JSON.stringify({ result: "done", total_cost_usd: 1.23, session_id: "s1" }), 0, "");
    expect(r).toEqual({ kind: "ok", costUsd: 1.23, sessionId: "s1", detail: undefined });
  });

  it("rate-limited: detected in result text", () => {
    const r = classifySession(
      JSON.stringify({ result: "You've hit your session limit · resets 3:45pm", session_id: "s2" }),
      0, "",
    );
    expect(r.kind).toBe("rate-limited");
    expect(r.detail).toContain("resets 3:45pm");
  });

  it("rate-limited: detected on stderr even with bad envelope", () => {
    const r = classifySession("", 1, "You've hit your weekly limit · resets Mon 12:00am");
    expect(r.kind).toBe("rate-limited");
  });

  it("error: nonzero exit or unparseable envelope", () => {
    expect(classifySession("not json", 0, "").kind).toBe("error");
    expect(classifySession(JSON.stringify({ result: "x" }), 9, "boom").kind).toBe("error");
  });

  it("rate-limited: curly apostrophe variant (You’ve) is also detected", () => {
    const r = classifySession(
      JSON.stringify({ result: "You’ve hit your session limit · resets 4:00pm", session_id: "s3" }),
      0, "",
    );
    expect(r.kind).toBe("rate-limited");
    expect(r.detail).toContain("resets 4:00pm");
  });

  it("error: json null envelope does not throw", () => {
    expect(classifySession("null", 0, "").kind).toBe("error");
  });

  it("error: json string envelope", () => {
    expect(classifySession('"hi"', 0, "").kind).toBe("error");
  });

  it("error: json array envelope", () => {
    expect(classifySession("[1]", 0, "").kind).toBe("error");
  });

  it("ok: long successful result that merely quotes a rate-limit message", () => {
    const r = classifySession(
      JSON.stringify({
        result:
          'Fixed the retry handler. Previously when the API returned "You\'ve hit your daily limit" the client crashed. ' +
          "x".repeat(300),
        total_cost_usd: 1,
        session_id: "s9",
      }),
      0, "",
    );
    expect(r.kind).toBe("ok");
  });
});
