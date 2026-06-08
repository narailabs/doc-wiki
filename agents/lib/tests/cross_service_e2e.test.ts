/**
 * cross_service_e2e.test.ts — multi-language (Java/Node/Python/Go) end-to-end test.
 *
 * Builds a tiny 6-service repo fixture in a tmp dir, runs the full pipeline:
 *   generateInventory → buildServiceGraph → writeCrossServicePages
 * and asserts cross-service edges + pages are correct across all languages.
 *
 * Services:
 *   orders-service   Java/Maven  — Feign client → payments-service, @RabbitListener consumer, datasource
 *   payments-service  Java/Maven  — REST endpoint /api/payments/charge/{id}, AMQP producer, JPA entity
 *   web-ui           Node/TS     — axios.get("/api/orders/123") frontend → orders-service
 *   notifier         Python      — requests.get("http://orders-service/api/orders/1")
 *   gateway          Go          — http.Get("http://payments-service/api/payments/charge/1")
 *   shared/common-model  Java    — shared library (groupId com.x.shared)
 */

import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";
import { generateInventory } from "../atlas_inventory.js";
import { buildServiceGraph } from "../cross_service_edges.js";
import type { ServiceEdge } from "../cross_service_edges.js";
import { writeCrossServicePages } from "../cross_service_pages.js";

// ── Fixture builder ──────────────────────────────────────────────────

function buildFixture(root: string): void {
  const mk = (rel: string) =>
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  const write = (rel: string, content: string) =>
    fs.writeFileSync(path.join(root, rel), content, "utf-8");

  // ── orders-service (Java/Maven) ────────────────────────────────────
  mk("orders-service/src/main/java/com/example/orders");
  mk("orders-service/src/main/resources");

  write("orders-service/pom.xml", `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>orders-service</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>com.x.shared</groupId>
      <artifactId>common-model</artifactId>
      <version>1.0.0</version>
    </dependency>
    <dependency>
      <groupId>org.springframework.cloud</groupId>
      <artifactId>spring-cloud-starter-openfeign</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.amqp</groupId>
      <artifactId>spring-rabbit</artifactId>
    </dependency>
  </dependencies>
</project>`);

  write("orders-service/src/main/resources/application.yml", `spring:
  application:
    name: orders-service
  datasource:
    url: jdbc:postgresql://pg/orders
  rabbitmq:
    host: localhost

payments-service:
  url: http://payments-svc/api/payments
`);

  write(
    "orders-service/src/main/java/com/example/orders/OrdersController.java",
    `package com.example.orders;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;

@RestController
public class OrdersController {
    @GetMapping("/api/orders/{id}")
    public Order getOrder(@PathVariable String id) {
        return new Order();
    }
}`,
  );

  // Feign client: url = "${payments-service.url}" → resolved → http://payments-svc/api/payments
  // resolveTargetService strips "app-" → matches "payments-service"
  write(
    "orders-service/src/main/java/com/example/orders/BillingFeignClient.java",
    `package com.example.orders;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;

@FeignClient(name = "billing-client", url = "\${payments-service.url}")
public interface BillingFeignClient {
    @GetMapping("/charge/{id}")
    ChargeDto charge(@PathVariable String id);
}`,
  );

  // RabbitMQ consumer
  write(
    "orders-service/src/main/java/com/example/orders/OrderEventConsumer.java",
    `package com.example.orders;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEventConsumer {
    @RabbitListener(queues = "order-events")
    public void handleOrderEvent(Object event) {
        // process
    }
}`,
  );

  // ── payments-service (Java/Maven) ──────────────────────────────────
  mk("payments-service/src/main/java/com/example/billing");
  mk("payments-service/src/main/resources");

  write("payments-service/pom.xml", `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>payments-service</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.amqp</groupId>
      <artifactId>spring-rabbit</artifactId>
    </dependency>
  </dependencies>
</project>`);

  write("payments-service/src/main/resources/application.yml", `spring:
  application:
    name: payments-service
`);

  write(
    "payments-service/src/main/java/com/example/billing/BillingController.java",
    `package com.example.billing;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;

@RestController
public class BillingController {
    @GetMapping("/api/payments/charge/{id}")
    public Charge chargeById(@PathVariable String id) {
        return new Charge();
    }
}`,
  );

  // AMQP producer
  write(
    "payments-service/src/main/java/com/example/billing/OrderEventPublisher.java",
    `package com.example.billing;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

@Component
public class OrderEventPublisher {
    private final RabbitTemplate rabbitTemplate;

    public void publishOrderEvent(Object event) {
        rabbitTemplate.convertAndSend("order-events", event);
    }
}`,
  );

  // JPA entity with name + schema (name must come first to match the JPA profile's table_pattern).
  // Profile regex: @Table\s*\(\s*name\s*=\s*"(\w+)"(?:.*?schema\s*=\s*"(\w+)")?
  write(
    "payments-service/src/main/java/com/example/billing/Charge.java",
    `package com.example.billing;
import javax.persistence.Entity;
import javax.persistence.Table;

@Entity
@Table(name = "charge", schema = "billing")
public class Charge {
    @javax.persistence.Id
    private Long id;
    private String amount;
}`,
  );

  // ── web-ui (Node/TypeScript frontend) ────────────────────────────
  mk("web-ui/src");

  write("web-ui/package.json", `{
  "name": "web-ui",
  "version": "0.1.0",
  "dependencies": {
    "vue": "^3.0.0",
    "axios": "^1.0.0"
  }
}`);

  // axios.get with a plain literal URL (no ${} — required by the profile's regex)
  write(
    "web-ui/src/api.ts",
    `import axios from "axios";

export async function fetchOrder(id: string) {
  const res = await axios.get("/api/orders/123");
  return res.data;
}`,
  );

  // ── notifier (Python) ────────────────────────────────────────────
  mk("notifier");

  write("notifier/pyproject.toml", `[project]
name = "notifier"
version = "0.1.0"
`);

  // requests.get with k8s-style host: host label = "orders-service" → direct id match
  write(
    "notifier/app.py",
    `import requests

def notify_order(order_id):
    resp = requests.get("http://orders-service/api/orders/1")
    return resp.json()
`,
  );

  // ── gateway (Go) ─────────────────────────────────────────────────
  mk("gateway");

  write("gateway/go.mod", `module gateway

go 1.21
`);

  // net/http client: http.Get with k8s-style host
  write(
    "gateway/main.go",
    `package main

import (
	"net/http"
)

func main() {
	resp, err := http.Get("http://payments-service/api/payments/charge/1")
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
}
`,
  );

  // ── shared/common-model (Java library) ──────────────────────────
  mk("shared/common-model/src/main/java/com/x/shared");

  write("shared/common-model/pom.xml", `<?xml version="1.0"?>
<project>
  <groupId>com.x.shared</groupId>
  <artifactId>common-model</artifactId>
  <version>1.0.0</version>
</project>`);

  write(
    "shared/common-model/src/main/java/com/x/shared/Order.java",
    `package com.x.shared;

public class Order {
    private String id;
    private String status;
}`,
  );
}

// ── Test suite ────────────────────────────────────────────────────────

describe("cross-service end-to-end (multi-language)", () => {
  const root = makeTmpPath("cs-e2e-");
  const wiki = makeTmpPath("cs-e2e-wiki-");
  const runId = "2026-06-07T10-00-00";

  buildFixture(root);

  const inv = generateInventory(root, runId, { enableCrossService: true });
  const g = buildServiceGraph(inv);

  afterAll(() => {
    cleanupTmpPath(root);
    cleanupTmpPath(wiki);
  });

  // ── Service discovery ─────────────────────────────────────────────

  it("discovers all 6 services", () => {
    expect(inv.services).toHaveLength(6);
    const ids = inv.services.map((s) => s.identity.id);
    expect(ids).toContain("orders-service");
    expect(ids).toContain("payments-service");
    expect(ids).toContain("web-ui");
    expect(ids).toContain("notifier");
    expect(ids).toContain("gateway");
    expect(ids).toContain("common-model");
  });

  it("classifies web-ui as frontend", () => {
    const webUi = inv.services.find((s) => s.identity.id === "web-ui");
    expect(webUi?.identity.kind).toBe("frontend");
  });

  it("classifies common-model as library", () => {
    const lib = inv.services.find((s) => s.identity.id === "common-model");
    expect(lib?.identity.kind).toBe("library");
  });

  it("classifies orders-service, payments-service, notifier, gateway as service", () => {
    for (const id of ["orders-service", "payments-service", "notifier", "gateway"]) {
      const svc = inv.services.find((s) => s.identity.id === id);
      expect(svc?.identity.kind, `${id} should be service`).toBe("service");
    }
  });

  // ── Cross-language calls edges ────────────────────────────────────

  it("emits calls edge: orders-service → payments-service (Java Feign via ${payments-service.url} property resolution)", () => {
    const edge = g.edges.find(
      (e): e is ServiceEdge =>
        e.kind === "calls" &&
        e.from_service === "orders-service" &&
        e.to_service === "payments-service",
    );
    expect(edge, "orders-service → payments-service calls edge").toBeDefined();
  });

  it("emits calls edge: web-ui → orders-service (Node/Vue axios → Java backend)", () => {
    const edge = g.edges.find(
      (e): e is ServiceEdge =>
        e.kind === "calls" &&
        e.from_service === "web-ui" &&
        e.to_service === "orders-service",
    );
    expect(edge, "web-ui → orders-service calls edge").toBeDefined();
  });

  it("emits calls edge: notifier → orders-service (Python requests → Java backend via k8s host)", () => {
    const edge = g.edges.find(
      (e): e is ServiceEdge =>
        e.kind === "calls" &&
        e.from_service === "notifier" &&
        e.to_service === "orders-service",
    );
    expect(edge, "notifier → orders-service calls edge").toBeDefined();
  });

  it("emits calls edge: gateway → payments-service (Go net/http → Java backend via k8s host)", () => {
    const edge = g.edges.find(
      (e): e is ServiceEdge =>
        e.kind === "calls" &&
        e.from_service === "gateway" &&
        e.to_service === "payments-service",
    );
    expect(edge, "gateway → payments-service calls edge").toBeDefined();
  });

  // ── Queue produces/consumes ───────────────────────────────────────

  it("emits produces edge: payments-service → queue:order-events", () => {
    const edge = g.edges.find(
      (e) =>
        e.kind === "produces" &&
        e.from_service === "payments-service" &&
        e.to_service === "queue:order-events",
    );
    expect(edge, "payments-service produces order-events").toBeDefined();
  });

  it("emits consumes edge: queue:order-events → orders-service", () => {
    const edge = g.edges.find(
      (e) =>
        e.kind === "consumes" &&
        e.from_service === "queue:order-events" &&
        e.to_service === "orders-service",
    );
    expect(edge, "orders-service consumes order-events").toBeDefined();
  });

  // ── Library dependency ────────────────────────────────────────────

  it("emits depends_on edge: orders-service → common-model", () => {
    const edge = g.edges.find(
      (e) =>
        e.kind === "depends_on" &&
        e.from_service === "orders-service" &&
        e.to_service === "common-model",
    );
    expect(edge, "orders-service depends_on common-model").toBeDefined();
  });

  // ── External source (DB datasource) ──────────────────────────────

  it("emits external_source edge: orders-service → ext:db (JDBC datasource)", () => {
    const edge = g.edges.find(
      (e) =>
        e.kind === "external_source" &&
        e.from_service === "orders-service" &&
        e.to_service === "ext:db",
    );
    expect(edge, "orders-service external_source ext:db").toBeDefined();
  });

  // ── ORM reads_table ───────────────────────────────────────────────

  it("emits reads_table edge: payments-service → table:billing.charge (JPA entity)", () => {
    const edge = g.edges.find(
      (e) =>
        e.kind === "reads_table" &&
        e.from_service === "payments-service" &&
        e.to_service === "table:billing.charge",
    );
    expect(edge, "payments-service reads_table billing.charge").toBeDefined();
  });

  // ── Pages written ─────────────────────────────────────────────────

  it("writeCrossServicePages writes all 6 pages and client-registry mentions key services", () => {
    const written = writeCrossServicePages(wiki, inv, g);
    expect(written).toHaveLength(6);

    // All expected page slugs exist
    const slugs = written.map((p) => path.basename(p, ".md"));
    expect(slugs).toContain("service-map");
    expect(slugs).toContain("client-registry");
    expect(slugs).toContain("queue-registry");
    expect(slugs).toContain("database-traces");
    expect(slugs).toContain("shared-libraries");
    expect(slugs).toContain("service-dependencies");

    // client-registry.md mentions payments-service as a target and
    // web-ui / notifier / gateway as cross-language sources
    const registryPath = written.find((p) => p.includes("client-registry"))!;
    const registryContent = fs.readFileSync(registryPath, "utf-8");

    expect(registryContent).toContain("payments-service");
    expect(registryContent).toContain("web-ui");
    expect(registryContent).toContain("notifier");
    expect(registryContent).toContain("gateway");
  });
});
