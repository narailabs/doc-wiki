/**
 * Tests for external_sources.ts — static detection of external DB datasource
 * URLs and cloud-SDK imports across a codebase.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpPath, cleanupTmpPath, writeConfigYaml } from "./fixtures.js";

import {
  classifySource,
  detectExternalSources,
  _resetRegistry,
  type ExternalSourceEntry,
} from "../external_sources.js";

// ── classifySource ────────────────────────────────────────────────────

describe("classifySource", () => {
  it("classifies jdbc:postgresql URL as db", () => {
    expect(classifySource("jdbc:postgresql://db:5432/appdb")).toBe("db");
  });

  it("classifies redis:// URL as db", () => {
    expect(classifySource("redis://cache:6379")).toBe("db");
  });

  it("classifies mongodb:// URL as db", () => {
    expect(classifySource("mongodb://user:pass@localhost:27017/mydb")).toBe("db");
  });

  it("classifies mongodb+srv:// URL as db", () => {
    expect(classifySource("mongodb+srv://cluster.mongodb.net/dbname")).toBe("db");
  });

  it("classifies postgresql:// URL as db", () => {
    expect(classifySource("postgresql://user:pass@host:5432/db")).toBe("db");
  });

  it("classifies mysql:// URL as db", () => {
    expect(classifySource("mysql://host:3306/schema")).toBe("db");
  });

  it("classifies oracle: URL as db", () => {
    expect(classifySource("oracle:thin:@//host:1521/service")).toBe("db");
  });

  it("classifies sqlserver:// URL as db", () => {
    expect(classifySource("sqlserver://host:1433;database=mydb")).toBe("db");
  });

  it("classifies jdbc:sqlserver URL as db", () => {
    expect(classifySource("jdbc:sqlserver://host:1433;databaseName=mydb")).toBe("db");
  });

  it("classifies r2dbc: URL as db", () => {
    expect(classifySource("r2dbc:postgresql://host:5432/mydb")).toBe("db");
  });

  it("classifies mariadb:// URL as db", () => {
    expect(classifySource("mariadb://host:3306/db")).toBe("db");
  });

  it("classifies rediss:// (TLS) URL as db", () => {
    expect(classifySource("rediss://secure-cache:6380")).toBe("db");
  });

  it("returns empty string for generic https URL", () => {
    // https URLs that don't match a known host pattern return ""
    const result = classifySource("https://random.example.com/api");
    expect(result).not.toBe("db");
    // It should be empty string since no connector matches
    expect(result).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(classifySource("")).toBe("");
  });

  it("delegates known http-based sources to lookupBySource (github)", () => {
    expect(classifySource("https://github.com/org/repo")).toBe("github");
  });

  it("delegates known scheme-based sources to lookupBySource (jira://)", () => {
    expect(classifySource("jira://AUTH-1")).toBe("jira");
  });

  it("delegates db:// scheme to lookupBySource as db", () => {
    expect(classifySource("db://dev/users")).toBe("db");
  });
});

// ── detectExternalSources ─────────────────────────────────────────────

describe("detectExternalSources", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpPath("ext-sources-test-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpDir);
  });

  it("detects a JDBC PostgreSQL URL in application.yml", () => {
    fs.writeFileSync(
      path.join(tmpDir, "application.yml"),
      "spring:\n  datasource:\n    url: jdbc:postgresql://pg/appdb\n",
    );
    const entries = detectExternalSources(tmpDir);
    const dbEntries = entries.filter((e) => e.kind === "database");
    expect(dbEntries.length).toBeGreaterThanOrEqual(1);
    const entry = dbEntries[0]!;
    expect(entry.connector_id).toBe("db");
    expect(entry.configured).toBe(false);
    expect(entry.detail).toContain("jdbc:postgresql");
    expect(entry.file).toMatch(/application\.yml$/);
    expect(entry.line).toBeGreaterThan(0);
  });

  it("detects an AWS SDK import in a Java file", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "S3Handler.java"),
      "package com.example;\nimport software.amazon.awssdk.services.s3.S3Client;\n\npublic class S3Handler {}\n",
    );
    const entries = detectExternalSources(tmpDir);
    const awsEntries = entries.filter((e) => e.kind === "aws");
    expect(awsEntries.length).toBeGreaterThanOrEqual(1);
    const entry = awsEntries[0]!;
    expect(entry.connector_id).toBe("aws");
    expect(entry.configured).toBe(false);
    expect(entry.detail).toContain("software.amazon.awssdk");
    expect(entry.file).toMatch(/S3Handler\.java$/);
  });

  it("detects a GCP SDK import in a TypeScript file", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "storage.ts"),
      "import { Storage } from '@google-cloud/storage';\n\nexport const storage = new Storage();\n",
    );
    const entries = detectExternalSources(tmpDir);
    const gcpEntries = entries.filter((e) => e.kind === "gcp");
    expect(gcpEntries.length).toBeGreaterThanOrEqual(1);
    const entry = gcpEntries[0]!;
    expect(entry.connector_id).toBe("gcp");
    expect(entry.configured).toBe(false);
    expect(entry.detail).toContain("@google-cloud/");
    expect(entry.file).toMatch(/storage\.ts$/);
  });

  it("detects AWS SDK import in a Python file", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "upload.py"),
      "import boto3\n\ns3 = boto3.client('s3')\n",
    );
    const entries = detectExternalSources(tmpDir);
    const awsEntries = entries.filter((e) => e.kind === "aws");
    expect(awsEntries.length).toBeGreaterThanOrEqual(1);
    expect(awsEntries[0]!.connector_id).toBe("aws");
  });

  it("detects AWS SDK import in a JavaScript file", () => {
    fs.writeFileSync(
      path.join(tmpDir, "lambda.js"),
      "const AWS = require('aws-sdk');\nconst s3 = new AWS.S3();\n",
    );
    const entries = detectExternalSources(tmpDir);
    const awsEntries = entries.filter((e) => e.kind === "aws");
    expect(awsEntries.length).toBeGreaterThanOrEqual(1);
    expect(awsEntries[0]!.connector_id).toBe("aws");
  });

  it("detects @aws-sdk/ scoped import in a TypeScript file", () => {
    fs.writeFileSync(
      path.join(tmpDir, "s3.ts"),
      "import { S3Client } from '@aws-sdk/client-s3';\n",
    );
    const entries = detectExternalSources(tmpDir);
    const awsEntries = entries.filter((e) => e.kind === "aws");
    expect(awsEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("detects GCP SDK import in a Python file", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "gcs.py"),
      "from google.cloud import storage\n\nclient = storage.Client()\n",
    );
    const entries = detectExternalSources(tmpDir);
    const gcpEntries = entries.filter((e) => e.kind === "gcp");
    expect(gcpEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("detects GCP SDK import in a Go file", () => {
    fs.writeFileSync(
      path.join(tmpDir, "main.go"),
      "package main\n\nimport \"cloud.google.com/go/storage\"\n",
    );
    const entries = detectExternalSources(tmpDir);
    const gcpEntries = entries.filter((e) => e.kind === "gcp");
    expect(gcpEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("detects mysql URL in application.properties", () => {
    fs.writeFileSync(
      path.join(tmpDir, "application.properties"),
      "spring.datasource.url=jdbc:mysql://localhost:3306/mydb\nspring.datasource.username=root\n",
    );
    const entries = detectExternalSources(tmpDir);
    const dbEntries = entries.filter((e) => e.kind === "database");
    expect(dbEntries.length).toBeGreaterThanOrEqual(1);
    expect(dbEntries[0]!.connector_id).toBe("db");
  });

  it("detects redis URL in .env file", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".env"),
      "REDIS_URL=redis://localhost:6379\nSECRET=abc123\n",
    );
    const entries = detectExternalSources(tmpDir);
    const dbEntries = entries.filter((e) => e.kind === "database");
    expect(dbEntries.length).toBeGreaterThanOrEqual(1);
    expect(dbEntries[0]!.connector_id).toBe("db");
    expect(dbEntries[0]!.detail).toContain("redis://");
  });

  it("all entries have configured=false", () => {
    fs.writeFileSync(
      path.join(tmpDir, "application.yml"),
      "spring:\n  datasource:\n    url: jdbc:postgresql://pg/appdb\n",
    );
    fs.writeFileSync(
      path.join(tmpDir, "s3.ts"),
      "import { S3Client } from '@aws-sdk/client-s3';\n",
    );
    const entries = detectExternalSources(tmpDir);
    for (const entry of entries) {
      expect(entry.configured).toBe(false);
    }
  });

  it("deduplicates entries at same file+line+kind", () => {
    // A line that matches two patterns should only produce one entry per distinct match
    fs.writeFileSync(
      path.join(tmpDir, "s3.ts"),
      "import { S3Client } from '@aws-sdk/client-s3';\n",
    );
    const entries = detectExternalSources(tmpDir);
    const awsEntries = entries.filter(
      (e) => e.kind === "aws" && e.file.endsWith("s3.ts"),
    );
    // Same file+line should not appear twice with same kind
    const keys = new Set(awsEntries.map((e) => `${e.file}:${e.line}:${e.kind}`));
    expect(keys.size).toBe(awsEntries.length);
  });

  it("returns empty array for a repo with no matching files", () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Hello World\n");
    const entries = detectExternalSources(tmpDir);
    expect(entries).toEqual([]);
  });

  it("file paths are repo-relative POSIX paths", () => {
    fs.writeFileSync(
      path.join(tmpDir, "application.yml"),
      "spring:\n  datasource:\n    url: jdbc:postgresql://pg/appdb\n",
    );
    const entries = detectExternalSources(tmpDir);
    const dbEntries = entries.filter((e) => e.kind === "database");
    expect(dbEntries.length).toBeGreaterThanOrEqual(1);
    // Should be relative, not absolute
    expect(path.isAbsolute(dbEntries[0]!.file)).toBe(false);
    // Should use forward slashes
    expect(dbEntries[0]!.file).not.toContain("\\");
  });
});

// ── classifySource — custom agents from wiki.config.yaml ─────────────

describe("classifySource with custom agents", () => {
  let tmpDir: string;
  let prevCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpPath("external-sources-custom-");
    prevCwd = process.cwd();
    _resetRegistry();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    _resetRegistry();
    cleanupTmpPath(tmpDir);
  });

  it("classifies a custom scheme registered in <cwd>/wiki.config.yaml", () => {
    writeConfigYaml(tmpDir, {
      wiki: { name: "test-wiki" },
      ecosystem: {
        agents: {
          custom: [{ name: "kb", source_schemes: ["kb://"] }],
        },
      },
    });
    process.chdir(tmpDir);
    expect(classifySource("kb://article-1")).toBe("kb");
    // Builtins are unaffected by the custom entry
    expect(classifySource("jira://AUTH-1")).toBe("jira");
  });

  it("stays builtins-only when no wiki.config.yaml is present", () => {
    process.chdir(tmpDir);
    expect(classifySource("kb://article-1")).toBe("");
    expect(classifySource("https://github.com/org/repo")).toBe("github");
  });

  it("classifySource accepts an explicit wikiConfigPath outside cwd", () => {
    const configPath = writeConfigYaml(tmpDir, {
      wiki: { name: "test-wiki" },
      ecosystem: {
        agents: {
          custom: [{ name: "kb", source_schemes: ["kb://"] }],
        },
      },
    });
    // No chdir — the wiki root differs from the process cwd
    expect(classifySource("kb://article-1", configPath)).toBe("kb");
  });

  it("reinitializes when a second wiki's config path is passed", () => {
    // A long-lived process classifying for two wikis used to keep the first
    // wiki's custom agents forever, so wiki B's sources were classified with
    // wiki A's connectors.
    const dirA = makeTmpPath("external-sources-wiki-a-");
    const dirB = makeTmpPath("external-sources-wiki-b-");
    try {
      const configA = writeConfigYaml(dirA, {
        wiki: { name: "wiki-a" },
        ecosystem: { agents: { custom: [{ name: "kb", source_schemes: ["kb://"] }] } },
      });
      const configB = writeConfigYaml(dirB, {
        wiki: { name: "wiki-b" },
        ecosystem: { agents: { custom: [{ name: "vault", source_schemes: ["vault://"] }] } },
      });

      expect(classifySource("kb://a-1", configA)).toBe("kb");
      // Wiki B knows vault:// and must NOT still know kb://.
      expect(classifySource("vault://b-1", configB)).toBe("vault");
      expect(classifySource("kb://a-1", configB)).toBe("");
      // Switching back restores wiki A's view.
      expect(classifySource("kb://a-1", configA)).toBe("kb");
      expect(classifySource("vault://b-1", configA)).toBe("");
    } finally {
      cleanupTmpPath(dirA);
      cleanupTmpPath(dirB);
    }
  });

  it("detectExternalSources threads wikiConfigPath into classification", () => {
    // A custom entry claiming the postgres:// scheme wins over the
    // DB-scheme fallback, proving the registry saw the config.
    const configPath = writeConfigYaml(tmpDir, {
      wiki: { name: "test-wiki" },
      ecosystem: {
        agents: {
          custom: [{ name: "pgproxy", source_schemes: ["postgres://"] }],
        },
      },
    });
    fs.writeFileSync(
      path.join(tmpDir, ".env"),
      "DATABASE_URL=postgres://host:5432/app\n",
    );
    const entries = detectExternalSources(tmpDir, { wikiConfigPath: configPath });
    const dbEntry = entries.find((e) => e.kind === "database");
    expect(dbEntry?.connector_id).toBe("pgproxy");
  });
});
