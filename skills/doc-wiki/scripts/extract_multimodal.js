#!/usr/bin/env node
/**
 * extract_multimodal.ts — optional extraction path for images, audio,
 * video, and YouTube URLs (v2 design §9 "Multimodal Extraction").
 *
 * Unlike `extract_binary.ts` which ships with the npm deps it needs
 * (`pdfjs-dist`, `mammoth`, `jszip`), this module treats its external
 * tools as optional-on-PATH:
 *
 *   - **Vision** (`.png .jpg .jpeg .webp .gif .svg`): no tool. Claude
 *     Code's orchestrator reads the image directly via the `Read` tool
 *     (the harness has native multimodal). This module just flags the
 *     handoff.
 *   - **Audio/video** (`.mp4 .mov .mkv .webm .avi .m4v .mp3 .wav .m4a
 *     .ogg`): needs `faster-whisper` on `PATH`. If missing, we skip
 *     with a clear install-hint warning.
 *   - **YouTube / remote AV** (`youtu.be/*`, `youtube.com/watch?v=*`):
 *     needs `yt-dlp` (to download audio-only) AND `faster-whisper` (to
 *     transcribe). Either missing → skip with warning.
 *
 * The feature is gated by `ecosystem.multimodal.enabled` in
 * `wiki.config.yaml`:
 *   - `"off"`: always skip with the `multimodal-disabled` warning.
 *   - `"optional"` (default): probe PATH; skip gracefully if tool
 *     missing.
 *   - `"on"`: same as `optional` but the user has asserted the tools
 *     should be present; missing tool still skips (we don't raise) so
 *     a single bad ingest doesn't abort a batch.
 *
 * CLI usage:
 *   node extract_multimodal.js <input-path-or-url> [--enabled on|off|optional]
 *   node extract_multimodal.js photo.png                   # vision handoff
 *   node extract_multimodal.js lecture.mp4                 # probes whisper
 *   node extract_multimodal.js https://youtu.be/xyz        # probes yt-dlp
 *
 * Exits 0 on success/skip, 2 on CLI misuse, 1 on other error.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isBinaryOnPath } from "./_optional.js";
function normalizeMode(raw) {
    if (raw === "on" || raw === true)
        return "on";
    if (raw === "off" || raw === false)
        return "off";
    return "optional";
}
// ── Extension classification ────────────────────────────────────────
export const VISION_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
]);
export const AUDIO_VIDEO_EXTENSIONS = new Set([
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v",
    ".mp3", ".wav", ".m4a", ".ogg",
]);
const YOUTUBE_URL_RE = /^https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/watch\?v=)/i;
function isYoutubeUrl(s) {
    return YOUTUBE_URL_RE.test(s);
}
function extOf(s) {
    return path.extname(s).toLowerCase();
}
// ── Warning strings (standardized — callers may grep for these) ─────
const WARN_PREFIX = "multimodal:";
function warnDisabled() {
    return `${WARN_PREFIX} disabled in wiki.config.yaml (ecosystem.multimodal.enabled: off). Set to "optional" or "on" to re-enable.`;
}
function warnMissingWhisper() {
    return `${WARN_PREFIX} faster-whisper not on PATH. Install with 'pipx install faster-whisper' (or 'pip install faster-whisper'), or add this file to .wiki-ignore to suppress.`;
}
function warnMissingYtDlp() {
    return `${WARN_PREFIX} yt-dlp not on PATH. Install with 'brew install yt-dlp' or 'pipx install yt-dlp', then re-run the ingest.`;
}
function warnMissingBoth() {
    return `${WARN_PREFIX} both yt-dlp and faster-whisper missing on PATH. YouTube ingest needs both. Install: 'brew install yt-dlp && pipx install faster-whisper'.`;
}
function warnUnknownFormat(input) {
    return `${WARN_PREFIX} '${input}' does not match any multimodal extension or URL pattern. Supported: ${[...VISION_EXTENSIONS].join(", ")} (vision); ${[...AUDIO_VIDEO_EXTENSIONS].join(", ")} (audio/video); YouTube URLs.`;
}
/**
 * Route an input (file path or URL) to the right multimodal handler.
 * Never throws. `format === "skipped"` plus a populated `warning` is
 * the universal "nothing happened" signal; callers should surface the
 * warning to the user and move on.
 *
 * This function is synchronous because every dispatch is cheap: vision
 * is a handoff, and audio/YouTube probe PATH via spawnSync which is
 * already sync. Actual transcription (when it happens) is NOT run here
 * — `/doc-wiki:ingest` invokes `faster-whisper` / `yt-dlp` separately after
 * seeing `format: "audio_video"` / `"youtube"`.
 */
export function dispatchMultimodal(input, cfg = {}) {
    const mode = normalizeMode(cfg.enabled);
    if (mode === "off") {
        return { format: "skipped", warning: warnDisabled() };
    }
    // YouTube URL (checked before extension dispatch — a URL has no
    // meaningful `path.extname`).
    if (isYoutubeUrl(input)) {
        const hasYtDlp = isBinaryOnPath("yt-dlp");
        const hasWhisper = isBinaryOnPath("faster-whisper");
        if (!hasYtDlp && !hasWhisper) {
            return { format: "skipped", warning: warnMissingBoth() };
        }
        if (!hasYtDlp) {
            return { format: "skipped", warning: warnMissingYtDlp() };
        }
        if (!hasWhisper) {
            return { format: "skipped", warning: warnMissingWhisper() };
        }
        return {
            format: "youtube",
            handoff: "yt-dlp -x --audio-format wav | faster-whisper",
            input,
        };
    }
    const ext = extOf(input);
    if (VISION_EXTENSIONS.has(ext)) {
        // Vision needs no external tool — the orchestrator reads the image
        // via Claude Code's native `Read` tool and writes the extracted
        // notes into raw/<topic>/images/<name>.md itself.
        return {
            format: "vision",
            handoff: "orchestrator-reads-image",
            input,
        };
    }
    if (AUDIO_VIDEO_EXTENSIONS.has(ext)) {
        if (!isBinaryOnPath("faster-whisper")) {
            return { format: "skipped", warning: warnMissingWhisper() };
        }
        return {
            format: "audio_video",
            handoff: "faster-whisper",
            input,
        };
    }
    return { format: "skipped", warning: warnUnknownFormat(input) };
}
function parseArgs(argv) {
    const out = {};
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a === undefined) {
            i++;
            continue;
        }
        if (a === "-h" || a === "--help") {
            out.help = true;
            i++;
            continue;
        }
        if (a === "--enabled") {
            out.enabled = argv[i + 1] ?? "";
            i += 2;
            continue;
        }
        if (a.startsWith("--enabled=")) {
            out.enabled = a.slice("--enabled=".length);
            i++;
            continue;
        }
        if (a.startsWith("--")) {
            throw new Error(`unrecognized argument: ${a}`);
        }
        // First non-flag positional is the input.
        if (out.input === undefined) {
            out.input = a;
            i++;
            continue;
        }
        throw new Error(`unexpected extra positional: ${a}`);
    }
    return out;
}
const HELP_TEXT = `usage: extract_multimodal.js <input> [--enabled on|off|optional]

Classify an image / audio / video / YouTube URL and probe for the
required external tool. Returns JSON describing the dispatch result
(format + optional warning). Never transcribes — orchestrator invokes
faster-whisper / yt-dlp after this classifier returns.

positional arguments:
  <input>               File path or URL

options:
  --enabled MODE        Override ecosystem.multimodal.enabled (on|off|optional)
  -h, --help            Show this help and exit
`;
export function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseArgs(argv);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (args.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    if (args.input === undefined || args.input === "") {
        process.stderr.write("required: <input> (file path or URL)\n");
        return 2;
    }
    const cfg = {};
    if (args.enabled !== undefined && args.enabled !== "") {
        cfg.enabled = args.enabled;
    }
    const result = dispatchMultimodal(args.input, cfg);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.warning !== undefined) {
        process.stderr.write(`${result.warning}\n`);
    }
    return 0;
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
