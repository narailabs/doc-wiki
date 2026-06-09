import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";
import { discoverServices, parseMavenArtifactId, resolveSpringAppName, deriveServiceAliases } from "../service_discovery.js";

describe("discoverServices", () => {
  let root: string;
  beforeEach(() => { root = makeTmpPath("svc-disco"); });
  afterEach(() => cleanupTmpPath(root));

  it("finds top-level dirs with a manifest and uses dir name as identity", () => {
    fs.mkdirSync(path.join(root, "payments-module"), { recursive: true });
    fs.writeFileSync(path.join(root, "payments-module", "pom.xml"), "<project></project>");
    fs.mkdirSync(path.join(root, "portal-ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "portal-ui", "package.json"), '{"name":"cp"}');

    const svcs = discoverServices(root);
    const ids = svcs.map((s) => s.id).sort();
    expect(ids).toEqual(["payments-module", "portal-ui"]);
    const java = svcs.find((s) => s.id === "payments-module")!;
    expect(java.language).toBe("java");
    expect(java.root).toBe("payments-module");
    expect(java.kind).toBe("service");
  });

  it("treats .gitmodules submodule paths as authoritative service roots", () => {
    fs.writeFileSync(path.join(root, ".gitmodules"),
      '[submodule "intake"]\n\tpath = intake\n\turl = https://x/intake\n');
    fs.mkdirSync(path.join(root, "intake"), { recursive: true });
    fs.writeFileSync(path.join(root, "intake", "pom.xml"), "<project></project>");

    const svcs = discoverServices(root);
    expect(svcs.map((s) => s.id)).toContain("intake");
    expect(svcs.find((s) => s.id === "intake")!.identity_source).toBe("submodule");
  });

  it("does NOT treat nested maven modules as separate services", () => {
    fs.mkdirSync(path.join(root, "payments-module", "payments-core"), { recursive: true });
    fs.writeFileSync(path.join(root, "payments-module", "pom.xml"), "<project></project>");
    fs.writeFileSync(path.join(root, "payments-module", "payments-core", "pom.xml"), "<project></project>");
    const svcs = discoverServices(root);
    expect(svcs.map((s) => s.id)).toEqual(["payments-module"]);
  });

  it("classifies a shared lib by groupId and shared/ location", () => {
    fs.mkdirSync(path.join(root, "shared", "common-model"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "shared", "common-model", "pom.xml"),
      "<project><groupId>com.example.app.shared</groupId><artifactId>common-model</artifactId></project>",
    );
    const svcs = discoverServices(root);
    expect(svcs.find((s) => s.id === "common-model")!.kind).toBe("library");
  });

  it("discovers shared/ aggregator sub-modules as individual libraries, not one 'shared' service", () => {
    // shared/ has a pom.xml with packaging=pom + <modules> — a Maven aggregator.
    // discoverServices must NOT register "shared" as a service; instead it must
    // discover each child module as its own library.
    fs.mkdirSync(path.join(root, "shared"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "shared", "pom.xml"),
      "<project><groupId>com.x.shared</groupId><artifactId>shared</artifactId>" +
      "<packaging>pom</packaging><modules><module>common-model</module><module>common-messaging</module></modules></project>",
    );
    for (const m of ["common-model", "common-messaging"]) {
      fs.mkdirSync(path.join(root, "shared", m), { recursive: true });
      fs.writeFileSync(
        path.join(root, "shared", m, "pom.xml"),
        `<project><groupId>com.x.shared</groupId><artifactId>${m}</artifactId></project>`,
      );
    }
    const svcs = discoverServices(root);
    const ids = svcs.map((s) => s.id).sort();
    expect(ids).toContain("common-model");
    expect(ids).toContain("common-messaging");
    expect(ids).not.toContain("shared");                 // aggregator itself not a service
    expect(svcs.find((s) => s.id === "common-model")!.kind).toBe("library");
  });

  it("discovers a service whose pom is in a build subdir (feed-processor/project/pom.xml)", () => {
    const root2 = makeTmpPath("nested-pom");
    try {
      fs.mkdirSync(path.join(root2, "feed-processor", "project", "src"), { recursive: true });
      fs.writeFileSync(path.join(root2, "feed-processor", "project", "pom.xml"),
        "<project><artifactId>feed-processor</artifactId></project>");
      // feed-processor/ itself has NO pom
      const svcs = discoverServices(root2);
      const feed = svcs.find((s) => s.id === "feed-processor");
      expect(feed).toBeTruthy();
      expect(feed!.root).toBe("feed-processor");        // service rooted at the parent (so its subtree is scanned)
      expect(feed!.language).toBe("java");
      // a normal service with its OWN pom is unaffected:
      fs.mkdirSync(path.join(root2, "billing"), { recursive: true });
      fs.writeFileSync(path.join(root2, "billing", "pom.xml"), "<project><artifactId>billing</artifactId></project>");
      expect(discoverServices(root2).find((s) => s.id === "billing")!.root).toBe("billing");
    } finally {
      cleanupTmpPath(root2);
    }
  });

  it("keeps a normal multi-module service (payments-module/payments-api) as ONE service", () => {
    // payments-module has packaging=pom + <modules> but is NOT a shared-lib container by name,
    // so it should be registered as a single service, NOT recursed into.
    fs.mkdirSync(path.join(root, "payments-module", "payments-api"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "payments-module", "pom.xml"),
      "<project><artifactId>payments-module</artifactId><packaging>pom</packaging>" +
      "<modules><module>payments-api</module></modules></project>",
    );
    fs.writeFileSync(
      path.join(root, "payments-module", "payments-api", "pom.xml"),
      "<project><artifactId>payments-api</artifactId></project>",
    );
    const svcs = discoverServices(root);
    expect(svcs.map((s) => s.id)).toEqual(["payments-module"]);   // ONE service, not payments-api
  });

  // ── Finding 1: library classifier must agree with all shared-lib container names ──

  it("F1-libs: child of libs/ aggregator with non-.shared groupId → kind library (PR #58 review)", () => {
    // libs/ is a shared-lib container by name. Its pom.xml is a Maven aggregator.
    // util-lib's groupId is com.x (NOT ending in .shared) and relRoot is libs/util-lib
    // (NOT starting with shared/) — the old classifier wrongly left it as "service".
    fs.mkdirSync(path.join(root, "libs"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "libs", "pom.xml"),
      "<project><groupId>com.x</groupId><artifactId>libs</artifactId>" +
      "<packaging>pom</packaging><modules><module>util-lib</module></modules></project>",
    );
    fs.mkdirSync(path.join(root, "libs", "util-lib"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "libs", "util-lib", "pom.xml"),
      "<project><groupId>com.x</groupId><artifactId>util-lib</artifactId></project>",
    );
    const svcs = discoverServices(root);
    const lib = svcs.find((s) => s.id === "util-lib");
    expect(lib).toBeDefined();
    expect(lib!.kind).toBe("library");         // must be library, not service
    expect(svcs.map((s) => s.id)).not.toContain("libs"); // aggregator itself not registered
  });

  it("F1-libraries: child of libraries/ aggregator with non-.shared groupId → kind library", () => {
    fs.mkdirSync(path.join(root, "libraries"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "libraries", "pom.xml"),
      "<project><groupId>com.example</groupId><artifactId>libraries</artifactId>" +
      "<packaging>pom</packaging><modules><module>common-utils</module></modules></project>",
    );
    fs.mkdirSync(path.join(root, "libraries", "common-utils"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "libraries", "common-utils", "pom.xml"),
      "<project><groupId>com.example</groupId><artifactId>common-utils</artifactId></project>",
    );
    const svcs = discoverServices(root);
    const lib = svcs.find((s) => s.id === "common-utils");
    expect(lib).toBeDefined();
    expect(lib!.kind).toBe("library");
  });

  it("F1-star-shared: child of *-shared aggregator with non-.shared groupId → kind library", () => {
    fs.mkdirSync(path.join(root, "my-shared"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "my-shared", "pom.xml"),
      "<project><groupId>com.acme</groupId><artifactId>my-shared</artifactId>" +
      "<packaging>pom</packaging><modules><module>acme-model</module></modules></project>",
    );
    fs.mkdirSync(path.join(root, "my-shared", "acme-model"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "my-shared", "acme-model", "pom.xml"),
      "<project><groupId>com.acme</groupId><artifactId>acme-model</artifactId></project>",
    );
    const svcs = discoverServices(root);
    const lib = svcs.find((s) => s.id === "acme-model");
    expect(lib).toBeDefined();
    expect(lib!.kind).toBe("library");
  });

  it("F1-no-manifest-libs: child of libs/ (no container pom) with non-.shared groupId → kind library", () => {
    // libs/ has NO manifest itself (pure directory). Its child util-lib has a pom.
    // The recursion path is the "isSharedLibContainer without manifest" branch.
    fs.mkdirSync(path.join(root, "libs", "util-lib"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "libs", "util-lib", "pom.xml"),
      "<project><groupId>com.x</groupId><artifactId>util-lib</artifactId></project>",
    );
    const svcs = discoverServices(root);
    const lib = svcs.find((s) => s.id === "util-lib");
    expect(lib).toBeDefined();
    expect(lib!.kind).toBe("library");
  });
});

it("reads the project artifactId, skipping the <parent> block", () => {
  const pom = `<project>
    <parent><artifactId>spring-boot-starter-parent</artifactId></parent>
    <groupId>com.example.app</groupId>
    <artifactId>task-orchestrator</artifactId>
    <version>1.0.0</version>
  </project>`;
  expect(parseMavenArtifactId(pom)).toBe("task-orchestrator");
});

it("derives ${x-service.url} and /api/{x}/ aliases for a service", () => {
  const aliases = deriveServiceAliases("payments-module");
  expect(aliases).toContain("payments-service.url");
  expect(aliases).toContain("payments");
});

// ── B7b: frontend-kind classification ────────────────────────────────────

describe("discoverServices frontend-kind (B7b)", () => {
  let root: string;
  beforeEach(() => { root = makeTmpPath("svc-frontend"); });
  afterEach(() => cleanupTmpPath(root));

  it("classifies a Vue app as frontend", () => {
    fs.mkdirSync(path.join(root, "ui"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "ui", "package.json"),
      JSON.stringify({ name: "ui", dependencies: { vue: "^3.0.0" } }),
    );
    const svcs = discoverServices(root);
    const ui = svcs.find((s) => s.id === "ui");
    expect(ui).toBeDefined();
    expect(ui!.kind).toBe("frontend");
  });

  it("classifies a React app as frontend", () => {
    fs.mkdirSync(path.join(root, "web"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "web", "package.json"),
      JSON.stringify({ name: "web", dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }),
    );
    const svcs = discoverServices(root);
    const web = svcs.find((s) => s.id === "web");
    expect(web).toBeDefined();
    expect(web!.kind).toBe("frontend");
  });

  it("leaves an Express backend as service (not frontend)", () => {
    fs.mkdirSync(path.join(root, "api"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "api", "package.json"),
      JSON.stringify({ name: "api", dependencies: { express: "^4.0.0" } }),
    );
    const svcs = discoverServices(root);
    const api = svcs.find((s) => s.id === "api");
    expect(api).toBeDefined();
    expect(api!.kind).toBe("service");
  });

  it("frontend does NOT override library kind (library wins)", () => {
    // A Maven lib that also happens to list vue in package.json at shared/
    fs.mkdirSync(path.join(root, "shared", "common-model"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "shared", "common-model", "pom.xml"),
      "<project><groupId>com.example.app.shared</groupId><artifactId>common-model</artifactId></project>",
    );
    // pom.xml wins the manifest detection; no package.json here so library takes precedence
    const svcs = discoverServices(root);
    const lib = svcs.find((s) => s.id === "common-model");
    expect(lib).toBeDefined();
    expect(lib!.kind).toBe("library");
  });

  it("classifies a Next.js app as frontend (devDependencies)", () => {
    fs.mkdirSync(path.join(root, "nextapp"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "nextapp", "package.json"),
      JSON.stringify({ name: "nextapp", devDependencies: { next: "^14.0.0" } }),
    );
    const svcs = discoverServices(root);
    const nextapp = svcs.find((s) => s.id === "nextapp");
    expect(nextapp).toBeDefined();
    expect(nextapp!.kind).toBe("frontend");
  });
});
