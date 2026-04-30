#!/usr/bin/env node
/**
 * Checkpoint resume mechanism for long-running batch wiki operations.
 *
 * For ops such as `/doc-wiki:ingest` on a folder or `/doc-wiki:refresh` across many
 * sources, state is written to `<wikiRoot>/.wiki-checkpoint.json` after each
 * processed unit. On interrupt + resume the caller reads back the completed
 * IDs and skips them from its unit list.
 *
 * The checkpoint file is a single JSON object keyed by operation name so
 * that multiple concurrent long-running ops share one file without racing
 * on file creation:
 *
 *   {
 *     "ingest:folder-2026-04-13": {
 *       "completedIds": ["a.md", "b.md"],
 *       "startedAt":    "2026-04-13T10:00:00+00:00",
 *       "lastUpdateAt": "2026-04-13T10:15:00+00:00"
 *     },
 *     "refresh:all-sources": { ... }
 *   }
 *
 * Writes are atomic: content goes to a `.tmp` sibling first, then
 * `fs.renameSync` replaces the target. On rename failure the tmp is unlinked.
 */
import * as fs from "node:fs";
import * as path from "node:path";
export const CHECKPOINT_FILENAME = ".wiki-checkpoint.json";
function _checkpointPath(wikiRoot) {
    return path.join(wikiRoot, CHECKPOINT_FILENAME);
}
function _nowIso() {
    return new Date().toISOString();
}
function _readFileObject(wikiRoot) {
    const p = _checkpointPath(wikiRoot);
    if (!fs.existsSync(p)) {
        return {};
    }
    let raw;
    try {
        raw = fs.readFileSync(p, { encoding: "utf-8" });
    }
    catch {
        return {};
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return {};
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        // Malformed file — treat as empty. The next write will replace it.
    }
    return {};
}
/**
 * Atomically write the full checkpoint object to disk.
 *
 * Strategy: serialize, write to `.wiki-checkpoint.<opNameSanitized>.<pid>.tmp`,
 * then `fs.renameSync` onto the target. Rename is atomic on the same
 * filesystem on POSIX; on Windows `renameSync` replaces the destination.
 *
 * If the rename unexpectedly fails with EEXIST we retry up to 3 times
 * with a 10ms backoff, unlinking stale tmps between attempts.
 */
function _atomicWriteFileObject(wikiRoot, data, opName) {
    const target = _checkpointPath(wikiRoot);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const body = JSON.stringify(data, null, 2) + "\n";
    // Sanitize opName for filesystem safety. Checkpoint keys can contain
    // colons/slashes; tmp filenames can't rely on that being portable.
    const safeOp = opName.replace(/[^A-Za-z0-9_.-]/g, "_");
    const tmp = path.join(path.dirname(target), `.wiki-checkpoint.${safeOp}.${process.pid}.tmp`);
    const MAX_ATTEMPTS = 3;
    let lastErr = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            fs.writeFileSync(tmp, body);
            fs.renameSync(tmp, target);
            return;
        }
        catch (e) {
            lastErr = e;
            try {
                if (fs.existsSync(tmp))
                    fs.unlinkSync(tmp);
            }
            catch {
                // best-effort cleanup
            }
            const code = e.code;
            if (code !== "EEXIST") {
                throw e;
            }
            // Busy-wait a tiny bit before retrying. 10ms total across retries.
            const deadline = Date.now() + 10;
            while (Date.now() < deadline) {
                // spin
            }
        }
    }
    throw lastErr instanceof Error
        ? lastErr
        : new Error("atomic checkpoint write failed");
}
/**
 * Return the saved state for `opName`, or `null` when absent.
 *
 * Returns `null` if the checkpoint file does not exist, is malformed,
 * or contains no entry for the given op name.
 */
export function readCheckpoint(wikiRoot, opName) {
    const data = _readFileObject(wikiRoot);
    const entry = data[opName];
    if (!entry)
        return null;
    // Defensive: ensure the shape matches — callers rely on completedIds
    // being an array of strings.
    const completedIds = Array.isArray(entry.completedIds)
        ? entry.completedIds.filter((x) => typeof x === "string")
        : [];
    return {
        completedIds,
        startedAt: typeof entry.startedAt === "string" ? entry.startedAt : "",
        lastUpdateAt: typeof entry.lastUpdateAt === "string" ? entry.lastUpdateAt : "",
    };
}
/**
 * Write `state` for `opName`. Merges with any other op entries in the
 * same file. Always updates `lastUpdateAt` to the current time; if
 * `startedAt` is omitted, preserves any existing value or records now.
 */
export function writeCheckpoint(wikiRoot, opName, state) {
    const data = _readFileObject(wikiRoot);
    const existing = data[opName];
    const startedAt = state.startedAt ?? existing?.startedAt ?? _nowIso();
    const next = {
        completedIds: [...state.completedIds],
        startedAt,
        lastUpdateAt: _nowIso(),
    };
    data[opName] = next;
    _atomicWriteFileObject(wikiRoot, data, opName);
}
/**
 * Remove the entry for `opName`. If no other entries remain, delete
 * the checkpoint file entirely so a fresh run starts clean.
 */
export function clearCheckpoint(wikiRoot, opName) {
    const p = _checkpointPath(wikiRoot);
    if (!fs.existsSync(p))
        return;
    const data = _readFileObject(wikiRoot);
    if (!(opName in data))
        return;
    delete data[opName];
    if (Object.keys(data).length === 0) {
        try {
            fs.unlinkSync(p);
        }
        catch {
            // best-effort
        }
        return;
    }
    _atomicWriteFileObject(wikiRoot, data, opName);
}
/**
 * Record that `unitId` has completed for `opName`. Idempotent: the same
 * unit is never recorded twice. Creates the checkpoint entry if missing.
 */
export function recordUnit(wikiRoot, opName, unitId) {
    const existing = readCheckpoint(wikiRoot, opName);
    const completedIds = existing ? [...existing.completedIds] : [];
    if (!completedIds.includes(unitId)) {
        completedIds.push(unitId);
    }
    writeCheckpoint(wikiRoot, opName, {
        completedIds,
        startedAt: existing?.startedAt,
    });
}
