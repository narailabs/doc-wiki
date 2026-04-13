/**
 * Tests for CloudSecretsProvider. We inject pre-built mock SDK clients via
 * the `_client` escape hatch so the tests never load real SDKs or touch
 * the network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudSecretsProvider } from "../cloud_secrets.js";

describe("credential_providers/cloud_secrets", () => {
  describe("aws sub-provider", () => {
    it("returns SecretString from GetSecretValueCommand", async () => {
      const send = vi.fn().mockResolvedValue({ SecretString: "aws-secret" });
      const p = new CloudSecretsProvider({
        subProvider: "aws",
        awsRegion: "us-east-1",
        _client: { send },
      });
      expect(await p.getSecret("db-password")).toBe("aws-secret");
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("returns null when ResourceNotFoundException is thrown", async () => {
      const err = Object.assign(new Error("missing"), {
        name: "ResourceNotFoundException",
      });
      const send = vi.fn().mockRejectedValue(err);
      const p = new CloudSecretsProvider({
        subProvider: "aws",
        awsRegion: "us-east-1",
        _client: { send },
      });
      expect(await p.getSecret("absent")).toBeNull();
    });

    it("decodes SecretBinary to UTF-8 when present", async () => {
      const send = vi.fn().mockResolvedValue({
        SecretBinary: new TextEncoder().encode("binary-secret"),
      });
      const p = new CloudSecretsProvider({
        subProvider: "aws",
        awsRegion: "us-east-1",
        _client: { send },
      });
      expect(await p.getSecret("x")).toBe("binary-secret");
    });

    it("rethrows non-not-found errors", async () => {
      const send = vi.fn().mockRejectedValue(new Error("kaboom"));
      const p = new CloudSecretsProvider({
        subProvider: "aws",
        awsRegion: "us-east-1",
        _client: { send },
      });
      await expect(p.getSecret("x")).rejects.toThrow(/kaboom/);
    });
  });

  describe("gcp sub-provider", () => {
    it("reads the secret and decodes the payload", async () => {
      const accessSecretVersion = vi.fn().mockResolvedValue([
        { payload: { data: new TextEncoder().encode("gcp-secret") } },
      ]);
      const p = new CloudSecretsProvider({
        subProvider: "gcp",
        gcpProjectId: "proj-1",
        _client: { accessSecretVersion },
      });
      expect(await p.getSecret("api-key")).toBe("gcp-secret");
      expect(accessSecretVersion).toHaveBeenCalledWith({
        name: "projects/proj-1/secrets/api-key/versions/latest",
      });
    });

    it("supports gcpVersion override", async () => {
      const accessSecretVersion = vi.fn().mockResolvedValue([
        { payload: { data: "v7-value" } },
      ]);
      const p = new CloudSecretsProvider({
        subProvider: "gcp",
        gcpProjectId: "proj-1",
        gcpVersion: "7",
        _client: { accessSecretVersion },
      });
      await p.getSecret("api-key");
      expect(accessSecretVersion).toHaveBeenCalledWith({
        name: "projects/proj-1/secrets/api-key/versions/7",
      });
    });

    it("returns null on NOT_FOUND (grpc code 5)", async () => {
      const err = Object.assign(new Error("not found"), { code: 5 });
      const accessSecretVersion = vi.fn().mockRejectedValue(err);
      const p = new CloudSecretsProvider({
        subProvider: "gcp",
        gcpProjectId: "p",
        _client: { accessSecretVersion },
      });
      expect(await p.getSecret("x")).toBeNull();
    });
  });

  describe("azure sub-provider", () => {
    it("reads via getSecret()", async () => {
      const getSecret = vi.fn().mockResolvedValue({ value: "azure-secret" });
      const p = new CloudSecretsProvider({
        subProvider: "azure",
        azureVaultUrl: "https://my.vault.azure.net",
        _client: { getSecret },
      });
      expect(await p.getSecret("cert-key")).toBe("azure-secret");
      expect(getSecret).toHaveBeenCalledWith("cert-key");
    });

    it("returns null on SecretNotFound", async () => {
      const err = Object.assign(new Error("nope"), { code: "SecretNotFound" });
      const getSecret = vi.fn().mockRejectedValue(err);
      const p = new CloudSecretsProvider({
        subProvider: "azure",
        azureVaultUrl: "https://my.vault.azure.net",
        _client: { getSecret },
      });
      expect(await p.getSecret("x")).toBeNull();
    });

    it("returns null on statusCode 404", async () => {
      const err = Object.assign(new Error("nope"), { statusCode: 404 });
      const getSecret = vi.fn().mockRejectedValue(err);
      const p = new CloudSecretsProvider({
        subProvider: "azure",
        azureVaultUrl: "https://my.vault.azure.net",
        _client: { getSecret },
      });
      expect(await p.getSecret("x")).toBeNull();
    });
  });

  describe("config validation", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("throws when awsRegion is missing and no _client is provided", async () => {
      const p = new CloudSecretsProvider({ subProvider: "aws" });
      await expect(p.getSecret("x")).rejects.toThrow(/awsRegion is required/);
    });

    it("throws when gcpProjectId is missing and no _client is provided", async () => {
      const p = new CloudSecretsProvider({ subProvider: "gcp" });
      await expect(p.getSecret("x")).rejects.toThrow(
        /gcpProjectId is required/,
      );
    });

    it("throws when azureVaultUrl is missing and no _client is provided", async () => {
      const p = new CloudSecretsProvider({ subProvider: "azure" });
      await expect(p.getSecret("x")).rejects.toThrow(
        /azureVaultUrl is required/,
      );
    });
  });
});
