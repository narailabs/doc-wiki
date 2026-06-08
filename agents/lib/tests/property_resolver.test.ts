import { describe, it, expect } from "vitest";
import { buildResolutionContext, resolveRef } from "../property_resolver.js";

describe("property resolver", () => {
  it("resolves a ${prop} placeholder from yaml + properties key/value", () => {
    const ctx = buildResolutionContext({
      "svc/src/main/resources/application.yml":
        "payments-service:\n  url: http://payments-api/api/payments\n",
      "svc/src/main/resources/application.properties":
        "config-service.url=http://settings-svc/api/configuration\n",
    }, {});
    expect(resolveRef("${payments-service.url}", ctx)).toBe("http://payments-api/api/payments");
    expect(resolveRef("${config-service.url}/v1", ctx)).toBe("http://settings-svc/api/configuration/v1");
  });

  it("resolves a static final String constant to its literal", () => {
    const ctx = buildResolutionContext({}, {
      "svc/.../Queues.java":
        'public static final String QUEUE_TASK = "task-orchestrator";\n',
    });
    expect(resolveRef("QUEUE_TASK", ctx)).toBe("task-orchestrator");
  });

  it("returns undefined for an unresolvable ref (precision bias)", () => {
    const ctx = buildResolutionContext({}, {});
    expect(resolveRef("${unknown.url}", ctx)).toBeUndefined();
    expect(resolveRef("SomeRuntimeValue", ctx)).toBeUndefined();
  });
});
