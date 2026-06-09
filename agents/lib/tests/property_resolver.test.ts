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

  it("resolves a qualified constant (QueueNames.ORDER_EVENTS) by stripping the qualifier", () => {
    const ctx = buildResolutionContext({}, {
      "svc/QueueNames.java":
        'public static final String ORDER_EVENTS = "orders.events";\n',
    });
    expect(resolveRef("QueueNames.ORDER_EVENTS", ctx)).toBe("orders.events");
  });

  it("returns undefined for a qualified constant whose simple name is not in context", () => {
    const ctx = buildResolutionContext({}, {});
    expect(resolveRef("Unknown.MISSING_CONST", ctx)).toBeUndefined();
  });

  // ── Kotlin const val constants ────────────────────────────────────────

  it("resolves a Kotlin const val (untyped) constant to its literal", () => {
    const ctx = buildResolutionContext({}, {
      "svc/Queues.kt":
        'const val ORDER_QUEUE = "orders"\n',
    });
    expect(resolveRef("ORDER_QUEUE", ctx)).toBe("orders");
  });

  it("resolves a Kotlin const val (typed, String annotation) constant to its literal", () => {
    const ctx = buildResolutionContext({}, {
      "svc/Topics.kt":
        'const val FEED_TOPIC: String = "feed"\n',
    });
    expect(resolveRef("FEED_TOPIC", ctx)).toBe("feed");
  });

  it("resolves both a Java static final and a Kotlin const val from the same context", () => {
    const ctx = buildResolutionContext({}, {
      "svc/Queues.java":
        'public static final String QUEUE_TASK = "task-orchestrator";\n',
      "svc/Topics.kt":
        'const val ORDER_QUEUE = "orders"\n',
    });
    expect(resolveRef("QUEUE_TASK", ctx)).toBe("task-orchestrator");
    expect(resolveRef("ORDER_QUEUE", ctx)).toBe("orders");
  });
});
