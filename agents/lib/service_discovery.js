import * as fs from "node:fs";
import * as path from "node:path";
/**
 * Frontend framework dependency keys that trigger `kind:"frontend"`.
 * Checked against both `dependencies` and `devDependencies` in package.json.
 */
const FRONTEND_DEPS = new Set([
    "vue",
    "react",
    "react-dom",
    "@angular/core",
    "svelte",
    "@sveltejs/kit",
    "next",
    "nuxt",
    "@builder.io/qwik",
    "solid-js",
]);
/**
 * Return true when a parsed package.json lists at least one frontend-framework
 * dependency (in `dependencies` or `devDependencies`).
 */
function isFrontendPackageJson(json) {
    for (const depsKey of ["dependencies", "devDependencies"]) {
        const deps = json[depsKey];
        if (!deps || typeof deps !== "object" || Array.isArray(deps))
            continue;
        for (const key of Object.keys(deps)) {
            if (FRONTEND_DEPS.has(key))
                return true;
        }
    }
    return false;
}
const MANIFESTS = [
    { file: "pom.xml", language: "java" },
    { file: "build.gradle", language: "java" },
    { file: "build.gradle.kts", language: "java" },
    { file: "package.json", language: "typescript" },
    { file: "go.mod", language: "go" },
    { file: "pyproject.toml", language: "python" },
    { file: "Cargo.toml", language: "rust" },
];
const SKIP_DIRS = new Set([".git", "node_modules", "target", "__pycache__"]);
/** Parse `.gitmodules` for `path = X` entries. Returns [] when absent/malformed. */
export function parseGitmodulePaths(repoRoot) {
    const gm = path.join(repoRoot, ".gitmodules");
    if (!fs.existsSync(gm))
        return [];
    let text;
    try {
        text = fs.readFileSync(gm, "utf-8");
    }
    catch {
        return [];
    }
    const out = [];
    for (const line of text.split("\n")) {
        const m = line.match(/^\s*path\s*=\s*(.+?)\s*$/);
        if (m?.[1])
            out.push(m[1]);
    }
    return out;
}
/**
 * Conventional build subdirectory basenames — when a top-level service dir has
 * no manifest at its own root but exactly one child with a manifest, and that
 * child's basename matches this set, the PARENT is registered as the service
 * (id = parent basename, root = parent rel path) using the child's manifest
 * metadata.  This covers layouts like `feed-processor/project/pom.xml`.
 *
 * Guard: exactly one child whose name is in this set may have a manifest —
 * if zero or two+ conventional-named children have manifests, the parent is
 * not registered (avoids mis-registration of dirs with many sibling services).
 * Non-conventional siblings (e.g. "tests/") are ignored entirely.
 */
const BUILD_SUBDIR_NAMES = new Set(["project", "app", "server", "service", "backend", "src", "main"]);
/**
 * Shared-library container directory names that should be recursed into as
 * individual library modules rather than registered as a single service.
 *
 * Heuristic: only dirs whose basename matches this set (or the `*-shared`
 * pattern) are treated as aggregator containers whose children are separate
 * libraries. Every other dir (incl. normal multi-module services like
 * `payments-module`) is registered as ONE service regardless of its pom
 * packaging, because its children are internal modules, not standalone libs.
 */
const SHARED_LIB_CONTAINER_NAMES = new Set(["shared", "libs", "libraries"]);
function isSharedLibContainer(dirName) {
    return SHARED_LIB_CONTAINER_NAMES.has(dirName) || dirName.endsWith("-shared");
}
/**
 * Return true when a pom.xml (parent block already stripped) declares itself
 * as a Maven aggregator — i.e. `<packaging>pom</packaging>` OR a `<modules>`
 * block is present.  Aggregators are containers for library sub-modules, not
 * deployable services in their own right.
 */
export function _isMavenAggregator(pomXml) {
    const withoutParent = pomXml.replace(/<parent>[\s\S]*?<\/parent>/gi, "");
    return (/<packaging>\s*pom\s*<\/packaging>/i.test(withoutParent) ||
        /<modules>/i.test(withoutParent));
}
/** The project's own artifactId: first `<artifactId>` NOT inside a `<parent>` block. */
export function parseMavenArtifactId(pomXml) {
    const withoutParent = pomXml.replace(/<parent>[\s\S]*?<\/parent>/gi, "");
    const m = withoutParent.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/i);
    return m?.[1] ?? "";
}
export function parseMavenGroupId(pomXml) {
    const withoutParent = pomXml.replace(/<parent>[\s\S]*?<\/parent>/gi, "");
    const m = withoutParent.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/i);
    return m?.[1] ?? "";
}
/** Bounded recursive file walker — skips SKIP_DIRS, returns absolute paths. */
function walkDir(dir) {
    const results = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return results;
    }
    for (const e of entries) {
        if (SKIP_DIRS.has(e.name))
            continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            results.push(...walkDir(full));
        }
        else if (e.isFile()) {
            results.push(full);
        }
    }
    return results;
}
/** Search a service subtree for spring.application.name. Returns "" when absent. */
export function resolveSpringAppName(absServiceRoot, walk = walkDir) {
    for (const file of walk(absServiceRoot)) {
        if (!/src\/main\/resources\/(application|bootstrap)[^/]*\.(ya?ml|properties)$/.test(file.replace(/\\/g, "/")))
            continue;
        let text;
        try {
            text = fs.readFileSync(file, "utf-8");
        }
        catch {
            continue;
        }
        const yamlM = text.match(/application\s*:\s*\n\s+name\s*:\s*["']?([\w.-]+)/);
        if (yamlM?.[1])
            return yamlM[1];
        const propM = text.match(/spring\.application\.name\s*=\s*([\w.-]+)/);
        if (propM?.[1])
            return propM[1];
    }
    return "";
}
/** From a service id, derive the property-key + api-path aliases the convention uses.
 *  `payments-module` → `payments-service.url` + `payments-module-service.url` + `billing` */
export function deriveServiceAliases(id) {
    const aliases = new Set([id]);
    const stem = id.replace(/-(module|service|svc|orchestrator|api|app)$/i, "");
    aliases.add(`${stem}-service.url`);
    aliases.add(`${id}-service.url`);
    aliases.add(stem);
    return [...aliases].filter((a) => a !== id);
}
function manifestsAt(absDir) {
    const manifests = [];
    let language = "unknown";
    for (const { file, language: lang } of MANIFESTS) {
        if (fs.existsSync(path.join(absDir, file))) {
            manifests.push(file);
            if (language === "unknown")
                language = lang;
        }
    }
    return { manifests, language };
}
/**
 * When a top-level dir has NO manifest at its own root, inspect its immediate
 * children for a single manifest-bearing build subdir.  Returns the child dir
 * entry + its manifest info if the "nested-pom" layout is detected, else null.
 *
 * Conditions:
 *  - `absParent` itself has no manifests (caller already checked).
 *  - Exactly one immediate child dir whose name is in BUILD_SUBDIR_NAMES has a
 *    manifest.  Other children (e.g. "tests/") may also have manifests — they
 *    are not build subdirs and do not count toward ambiguity.
 */
function findBuildSubdir(absParent) {
    let children;
    try {
        children = fs.readdirSync(absParent, { withFileTypes: true });
    }
    catch {
        return null;
    }
    const hits = [];
    for (const child of children) {
        if (!child.isDirectory() || child.name.startsWith(".") || SKIP_DIRS.has(child.name))
            continue;
        // Only consider children whose names are conventional build subdir names.
        if (!BUILD_SUBDIR_NAMES.has(child.name))
            continue;
        const { manifests, language } = manifestsAt(path.join(absParent, child.name));
        if (manifests.length > 0)
            hits.push({ childName: child.name, manifests, language });
    }
    // Exactly one conventional-named child must have a manifest (no ambiguity).
    if (hits.length !== 1)
        return null;
    return hits[0];
}
export function discoverServices(repoRoot) {
    const byRoot = new Map();
    const consider = (relRoot, source) => {
        if (relRoot.length === 0 || byRoot.has(relRoot))
            return;
        const absDir = path.join(repoRoot, relRoot);
        if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory())
            return;
        const { manifests, language } = manifestsAt(absDir);
        if (manifests.length === 0)
            return;
        const id = relRoot.split("/").pop() ?? relRoot;
        const aliases = deriveServiceAliases(id);
        let kind = "service";
        // Read pom.xml for Maven identity and library classification.
        const pomPath = path.join(absDir, "pom.xml");
        if (manifests.includes("pom.xml") && fs.existsSync(pomPath)) {
            let pom = "";
            try {
                pom = fs.readFileSync(pomPath, "utf-8");
            }
            catch { /* ignore */ }
            if (pom) {
                const artifactId = parseMavenArtifactId(pom);
                if (artifactId && artifactId !== id)
                    aliases.push(artifactId);
                const groupId = parseMavenGroupId(pom);
                // Classify as library when:
                //   - groupId ends with .shared (Maven convention), OR
                //   - the module's parent path segment is a shared-lib container
                //     (same predicate as the recursion: "shared", "libs", "libraries", "*-shared").
                // This ensures the classifier agrees with the discovery loop's container check.
                const parentSegment = relRoot.includes("/") ? relRoot.split("/")[0] : "";
                if (groupId.endsWith(".shared") ||
                    isSharedLibContainer(parentSegment)) {
                    kind = "library";
                }
            }
        }
        // Frontend classification: only when kind is still the default "service".
        // library takes precedence — do not override it.
        if (kind === "service" && manifests.includes("package.json")) {
            const pkgPath = path.join(absDir, "package.json");
            try {
                const json = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                if (isFrontendPackageJson(json))
                    kind = "frontend";
            }
            catch { /* malformed package.json — leave kind as service */ }
        }
        byRoot.set(relRoot, {
            id,
            root: relRoot,
            aliases,
            kind,
            identity_source: source,
            language,
            manifests,
        });
    };
    // 1. .gitmodules submodule paths are authoritative service roots.
    for (const p of parseGitmodulePaths(repoRoot))
        consider(p, "submodule");
    // 2. Top-level dirs with a manifest (covers non-submodule monorepos).
    //    For shared-lib containers (named "shared", "libs", "libraries", or
    //    "*-shared") that are Maven aggregators (packaging=pom or <modules>),
    //    we recurse into their immediate children as individual library services
    //    rather than registering the container itself.  All other dirs — including
    //    normal multi-module services like payments-module — are registered as ONE
    //    service; their children are internal modules, not standalone services.
    let entries = [];
    try {
        entries = fs.readdirSync(repoRoot, { withFileTypes: true });
    }
    catch { /* ignore */ }
    for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules")
            continue;
        const relDir = e.name;
        const absDir = path.join(repoRoot, relDir);
        const { manifests: topManifests } = manifestsAt(absDir);
        if (topManifests.length > 0 && isSharedLibContainer(relDir)) {
            // A shared-lib container dir that has a manifest — check if it's a Maven aggregator.
            // If so, skip registering it as a service and recurse into children as libraries.
            let pom = "";
            const pomPath = path.join(absDir, "pom.xml");
            if (topManifests.includes("pom.xml")) {
                try {
                    pom = fs.readFileSync(pomPath, "utf-8");
                }
                catch { /* ignore */ }
            }
            if (pom && _isMavenAggregator(pom)) {
                // Aggregator container: discover each child module as its own library.
                let children = [];
                try {
                    children = fs.readdirSync(absDir, { withFileTypes: true });
                }
                catch { /* ignore */ }
                for (const child of children) {
                    if (!child.isDirectory() || child.name.startsWith("."))
                        continue;
                    consider(`${relDir}/${child.name}`, "dir-name");
                }
            }
            else {
                // Non-aggregator shared-lib-named dir — treat as a normal service.
                consider(relDir, "dir-name");
            }
        }
        else if (topManifests.length > 0) {
            // Normal service dir — register it and do NOT descend into children.
            consider(relDir, "dir-name");
        }
        else if (isSharedLibContainer(relDir)) {
            // shared-lib container with no manifest itself: scan its immediate children as lib candidates.
            let children = [];
            try {
                children = fs.readdirSync(absDir, { withFileTypes: true });
            }
            catch { /* ignore */ }
            for (const child of children) {
                if (!child.isDirectory() || child.name.startsWith("."))
                    continue;
                consider(`${relDir}/${child.name}`, "dir-name");
            }
        }
        else {
            // No manifest at the top-level dir and it's not a shared-lib container.
            // Check for the nested build-subdir layout (e.g. feed-processor/project/pom.xml).
            // Register the PARENT as the service using the child's manifest metadata.
            const buildSubdir = findBuildSubdir(absDir);
            if (buildSubdir && !byRoot.has(relDir)) {
                const id = relDir.split("/").pop() ?? relDir;
                const aliases = deriveServiceAliases(id);
                // Enrich aliases from pom.xml in the child if available.
                if (buildSubdir.manifests.includes("pom.xml")) {
                    const pomPath = path.join(absDir, buildSubdir.childName, "pom.xml");
                    try {
                        const pom = fs.readFileSync(pomPath, "utf-8");
                        const artifactId = parseMavenArtifactId(pom);
                        if (artifactId && artifactId !== id)
                            aliases.push(artifactId);
                    }
                    catch { /* ignore */ }
                }
                byRoot.set(relDir, {
                    id,
                    root: relDir,
                    aliases,
                    kind: "service",
                    identity_source: "dir-name",
                    language: buildSubdir.language,
                    manifests: buildSubdir.manifests,
                });
            }
        }
    }
    return [...byRoot.values()].sort((a, b) => a.id.localeCompare(b.id));
}
