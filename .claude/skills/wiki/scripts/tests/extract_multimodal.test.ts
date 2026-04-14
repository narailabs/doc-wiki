/**
 * Tests for extract_multimodal.ts — dispatch routing and graceful-skip
 * behavior when external tools aren't on PATH.
 *
 * We stub `isBinaryOnPath` via vitest's module mocking so tests don't
 * depend on the real host having / not having whisper + yt-dlp.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  AUDIO_VIDEO_EXTENSIONS,
  dispatchMultimodal,
  main,
  VISION_EXTENSIONS,
} from "../extract_multimodal.js";
import { _resetBinaryProbeCache } from "../_optional.js";
import * as optionalMod from "../_optional.js";

describe("dispatchMultimodal — vision path", () => {
  beforeEach(() => {
    _resetBinaryProbeCache();
  });

  it.each([...VISION_EXTENSIONS])(
    "routes %s to the vision handoff with no PATH probe",
    (ext) => {
      const result = dispatchMultimodal(`/tmp/foo${ext}`);
      expect(result.format).toBe("vision");
      expect(result.handoff).toBe("orchestrator-reads-image");
      expect(result.warning).toBeUndefined();
    },
  );
});

describe("dispatchMultimodal — audio/video path", () => {
  beforeEach(() => {
    _resetBinaryProbeCache();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([...AUDIO_VIDEO_EXTENSIONS])(
    "routes %s to audio_video when faster-whisper is on PATH",
    (ext) => {
      vi.spyOn(optionalMod, "isBinaryOnPath").mockReturnValue(true);
      const result = dispatchMultimodal(`/tmp/foo${ext}`);
      expect(result.format).toBe("audio_video");
      expect(result.handoff).toBe("faster-whisper");
    },
  );

  it("skips audio/video with a warning when whisper is missing", () => {
    vi.spyOn(optionalMod, "isBinaryOnPath").mockImplementation(
      (name) => name !== "faster-whisper",
    );
    const result = dispatchMultimodal("/tmp/lecture.mp4");
    expect(result.format).toBe("skipped");
    expect(result.warning).toContain("faster-whisper");
    expect(result.warning).toContain("pipx install faster-whisper");
    expect(result.warning).toContain(".wiki-ignore");
  });
});

describe("dispatchMultimodal — YouTube path", () => {
  beforeEach(() => {
    _resetBinaryProbeCache();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes youtu.be/... to youtube when both tools are on PATH", () => {
    vi.spyOn(optionalMod, "isBinaryOnPath").mockReturnValue(true);
    const result = dispatchMultimodal("https://youtu.be/dQw4w9WgXcQ");
    expect(result.format).toBe("youtube");
    expect(result.handoff).toContain("yt-dlp");
    expect(result.handoff).toContain("faster-whisper");
  });

  it("routes youtube.com/watch?v=... the same way", () => {
    vi.spyOn(optionalMod, "isBinaryOnPath").mockReturnValue(true);
    const result = dispatchMultimodal(
      "https://www.youtube.com/watch?v=abc123",
    );
    expect(result.format).toBe("youtube");
  });

  it("warns when only yt-dlp is missing", () => {
    vi.spyOn(optionalMod, "isBinaryOnPath").mockImplementation(
      (name) => name !== "yt-dlp",
    );
    const result = dispatchMultimodal("https://youtu.be/xyz");
    expect(result.format).toBe("skipped");
    expect(result.warning).toContain("yt-dlp not on PATH");
    expect(result.warning).not.toContain("faster-whisper");
  });

  it("warns when only whisper is missing (YouTube)", () => {
    vi.spyOn(optionalMod, "isBinaryOnPath").mockImplementation(
      (name) => name !== "faster-whisper",
    );
    const result = dispatchMultimodal("https://youtu.be/xyz");
    expect(result.format).toBe("skipped");
    expect(result.warning).toContain("faster-whisper not on PATH");
  });

  it("warns about both when both are missing", () => {
    vi.spyOn(optionalMod, "isBinaryOnPath").mockReturnValue(false);
    const result = dispatchMultimodal("https://youtu.be/xyz");
    expect(result.format).toBe("skipped");
    expect(result.warning).toContain("both");
    expect(result.warning).toContain("yt-dlp");
    expect(result.warning).toContain("faster-whisper");
  });
});

describe("dispatchMultimodal — feature flag", () => {
  beforeEach(() => {
    _resetBinaryProbeCache();
  });

  it("skips with a disabled warning when enabled='off'", () => {
    const result = dispatchMultimodal("/tmp/foo.png", { enabled: "off" });
    expect(result.format).toBe("skipped");
    expect(result.warning).toContain("disabled");
    expect(result.warning).toContain("wiki.config.yaml");
  });

  it("treats missing enabled as optional (default-on dispatch)", () => {
    // No config at all — should still dispatch vision.
    const result = dispatchMultimodal("/tmp/foo.png");
    expect(result.format).toBe("vision");
  });

  it("treats enabled='on' the same as optional for dispatch", () => {
    const result = dispatchMultimodal("/tmp/foo.png", { enabled: "on" });
    expect(result.format).toBe("vision");
  });
});

describe("dispatchMultimodal — unknown inputs", () => {
  it("skips .txt files with an unknown-format warning", () => {
    const result = dispatchMultimodal("/tmp/notes.txt");
    expect(result.format).toBe("skipped");
    expect(result.warning).toContain("does not match");
  });

  it("skips non-YouTube URLs with unknown-format warning", () => {
    const result = dispatchMultimodal("https://example.com/video.mp4");
    // extension dispatch wins when present.
    // But https://example.com without an extension:
    const bare = dispatchMultimodal("https://example.com/page");
    expect(bare.format).toBe("skipped");
    // Meanwhile the URL with .mp4 extension gets audio_video routing
    // (we treat it as a file path since there's no hosting-awareness).
    // It'll still fail the whisper check downstream; here we just confirm
    // it's not classified as youtube.
    expect(result.format).not.toBe("youtube");
  });
});

describe("main (CLI)", () => {
  let stdout = "";
  let stderr = "";
  let origStdoutWrite: typeof process.stdout.write;
  let origStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    _resetBinaryProbeCache();
    stdout = "";
    stderr = "";
    origStdoutWrite = process.stdout.write.bind(process.stdout);
    origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((s: string | Uint8Array): boolean => {
      stdout += typeof s === "string" ? s : Buffer.from(s).toString("utf-8");
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((s: string | Uint8Array): boolean => {
      stderr += typeof s === "string" ? s : Buffer.from(s).toString("utf-8");
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    vi.restoreAllMocks();
  });

  it("exits 2 with a message when no input is given", () => {
    const code = main([]);
    expect(code).toBe(2);
    expect(stderr).toContain("required");
  });

  it("exits 0 with JSON dispatch result for a vision input", () => {
    const code = main(["/tmp/photo.png"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.format).toBe("vision");
  });

  it("surfaces the warning on stderr when the dispatch is skipped", () => {
    const code = main(["/tmp/lecture.mp4", "--enabled", "off"]);
    expect(code).toBe(0);
    expect(stderr).toContain("disabled");
    const parsed = JSON.parse(stdout);
    expect(parsed.format).toBe("skipped");
  });

  it("shows help on -h", () => {
    const code = main(["-h"]);
    expect(code).toBe(0);
    expect(stdout).toContain("usage:");
  });

  it("rejects unknown flags with exit 2", () => {
    const code = main(["--bogus", "/tmp/foo.png"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unrecognized argument");
  });
});
