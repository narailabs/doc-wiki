import { describe, it, expect } from "vitest";
import { discoverShippedClientProfiles, loadClientProfile, detectHttpClients, resolveClientProfiles } from "../atlas_inventory.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";
import * as fs from "node:fs";
import * as path from "node:path";

describe("client profiles", () => {
  it("ships and loads the feign profile with a file_anchor", () => {
    expect(discoverShippedClientProfiles()).toContain("feign");
    const p = loadClientProfile("feign")!;
    expect(p.language).toBe("java");
    expect(p.detection.markers.some((m) => m.pattern.includes("FeignClient"))).toBe(true);
    expect(p.client_extraction.file_anchor?.service_regex).toBeTruthy();
  });
});

it("detects a Feign client: anchor url + concatenated path + normalized verb", () => {
  const root = makeTmpPath("feign-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "AddressClient.java"), [
    '@FeignClient(name = "address-bean", url = "${address-service.url}", path = "/address-service")',
    'public interface AddressClient {',
    '    @GetMapping("/address/{id}")',
    '    ResponseEntity<AddressResponse> byId(@PathVariable("id") int id);',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["feign"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBe(1);
  const c = clients[0];
  expect(c.framework).toBe("feign");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("${address-service.url}");          // anchor url wins
  expect(c.path).toBe("/address-service/address/{id}");          // prefix + method path
  expect(c.file).toBe("src/AddressClient.java");
  expect(c.line).toBe(3);                                         // the @GetMapping line
  cleanupTmpPath(root);
});

it("detects a RestTemplate getForObject call: verb from method name, url from literal", () => {
  const root = makeTmpPath("resttemplate-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "BillingClient.java"), [
    'import org.springframework.web.client.RestTemplate;',
    'public class BillingClient {',
    '    public Invoice get(String id) {',
    '        return restTemplate.getForObject("http://billing-service/api/invoices", Invoice.class);',
    '    }',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["resttemplate"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("resttemplate");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects a RestTemplate exchange call: verb from HttpMethod arg", () => {
  const root = makeTmpPath("resttemplate-exchange");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "BillingClient.java"), [
    'import org.springframework.web.client.RestTemplate;',
    'public class BillingClient {',
    '    public ResponseEntity<Invoice> post(Invoice body) {',
    '        return restTemplate.exchange("http://billing-service/api/invoices", HttpMethod.POST, req, Invoice.class);',
    '    }',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["resttemplate"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("resttemplate");
  expect(c.method).toBe("POST");
  expect(c.target_ref).toBe("billing-service");
  cleanupTmpPath(root);
});

it("detects a WebClient single-line fluent call: verb from method name, baseUrl as target_ref", () => {
  const root = makeTmpPath("webclient-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "InvoiceClient.java"), [
    'import org.springframework.web.reactive.function.client.WebClient;',
    'public class InvoiceClient {',
    '    private final WebClient webClient = WebClient.builder().baseUrl("http://billing-service").build();',
    '    public Mono<Invoice> getInvoice() {',
    '        return webClient.get().uri("/api/invoices").retrieve().bodyToMono(Invoice.class);',
    '    }',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["webclient"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("webclient");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("http://billing-service");
  expect(c.path).toBe("/api/invoices");
  cleanupTmpPath(root);
});

it("detects an axios.post call: verb from method name, baseURL as target_ref", () => {
  const root = makeTmpPath("axios-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billingApi.ts"), [
    'import axios from "axios";',
    'const api = axios.create({ baseURL: "http://billing-service" });',
    'export async function createInvoice(body: unknown) {',
    '    await axios.post("http://billing-service/api/invoices", body);',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["axios"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients.find((e) => e.method === "POST")!;
  expect(c).toBeDefined();
  expect(c.framework).toBe("axios");
  expect(c.target_ref).toBe("http://billing-service");           // from baseURL anchor
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects a fetch GET call with default method when method arg is absent", () => {
  const root = makeTmpPath("fetch-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "invoiceApi.ts"), [
    'fetch("http://billing-service/api/invoices");',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["fetch"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("fetch");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects a fetch POST call with explicit method option", () => {
  const root = makeTmpPath("fetch-post");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "invoiceApi.ts"), [
    "const r = await fetch(\"http://billing-service/api/invoices\", { method: \"POST\", body });",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["fetch"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("fetch");
  expect(c.method).toBe("POST");
  cleanupTmpPath(root);
});

it("detects a got.post call with explicit verb", () => {
  const root = makeTmpPath("got-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billingClient.ts"), [
    'import got from "got";',
    'await got.post("http://billing-service/api/invoices", { json: body });',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["got"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("got");
  expect(c.method).toBe("POST");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects a bare got() GET call (default method)", () => {
  const root = makeTmpPath("got-bare");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billingClient.ts"), [
    'import got from "got";',
    'await got("http://billing-service/api/invoices");',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["got"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("got");
  expect(c.method).toBe("GET");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects a superagent.get call", () => {
  const root = makeTmpPath("superagent-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billingClient.ts"), [
    'import superagent from "superagent";',
    'superagent.get("http://billing-service/api/invoices").then(cb);',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["got"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("got");
  expect(c.method).toBe("GET");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

// ── Python: requests ─────────────────────────────────────────────────────────

it("detects a requests.post call: verb from method name, inline url", () => {
  const root = makeTmpPath("requests-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billing_client.py"), [
    "import requests",
    'r = requests.post("http://billing-service/api/invoices", json=body)',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["requests"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("requests");
  expect(c.method).toBe("POST");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects requests.request('GET', url) form", () => {
  const root = makeTmpPath("requests-request");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billing_client.py"), [
    "import requests",
    "r = requests.request('GET', 'http://billing-service/api/invoices')",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["requests"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("requests");
  expect(c.method).toBe("GET");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

// ── Python: httpx ─────────────────────────────────────────────────────────────

it("detects httpx.get call: verb from method name, inline url", () => {
  const root = makeTmpPath("httpx-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billing_client.py"), [
    "import httpx",
    'r = httpx.get("http://billing-service/api/invoices")',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["httpx"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("httpx");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects httpx AsyncClient base_url anchor + relative path", () => {
  const root = makeTmpPath("httpx-base-url");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billing_client.py"), [
    "import httpx",
    'async with httpx.AsyncClient(base_url="http://billing-service") as client:',
    '    r = await client.get("/api/invoices")',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["httpx"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("httpx");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("http://billing-service");
  cleanupTmpPath(root);
});

// ── Python: aiohttp ───────────────────────────────────────────────────────────

it("detects aiohttp session.get call: verb from method name, inline url", () => {
  const root = makeTmpPath("aiohttp-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billing_client.py"), [
    "import aiohttp",
    "async with aiohttp.ClientSession() as session:",
    '    async with session.get("http://billing-service/api/invoices") as resp:',
    "        data = await resp.json()",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["aiohttp"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("aiohttp");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

// ── Go: net/http ──────────────────────────────────────────────────────────────

it("detects http.Get call: verb from func name, inline url", () => {
  const root = makeTmpPath("go-nethttp-get");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "client.go"), [
    'import "net/http"',
    'func fetchInvoices() {',
    '    resp, err := http.Get("http://billing-service/api/invoices")',
    '    _ = resp; _ = err',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["go_nethttp"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("go_nethttp");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects http.NewRequest POST: verb from string arg", () => {
  const root = makeTmpPath("go-nethttp-newrequest");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "client.go"), [
    'import "net/http"',
    'func createInvoice() {',
    '    req, _ := http.NewRequest("POST", "http://billing-service/api/invoices", body)',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["go_nethttp"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("go_nethttp");
  expect(c.method).toBe("POST");
  expect(c.target_ref).toBe("billing-service");
  cleanupTmpPath(root);
});

// ── Go: resty ─────────────────────────────────────────────────────────────────

it("detects resty client.R().Get call: verb from method name, SetBaseURL as target_ref", () => {
  const root = makeTmpPath("resty-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "client.go"), [
    'import "github.com/go-resty/resty/v2"',
    'func fetchInvoices() {',
    '    client := resty.New().SetBaseURL("http://billing-service")',
    '    resp, _ := client.R().Get("/api/invoices")',
    '    _ = resp',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["resty"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("resty");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("http://billing-service");
  expect(c.path).toBe("/api/invoices");
  cleanupTmpPath(root);
});

// ── Ruby: Faraday ─────────────────────────────────────────────────────────────

it("detects Faraday.get call with inline url", () => {
  const root = makeTmpPath("faraday-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billing_client.rb"), [
    "require 'faraday'",
    "response = Faraday.get('http://billing-service/api/invoices')",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["faraday"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("faraday");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects Faraday.new url anchor + conn.post relative path", () => {
  const root = makeTmpPath("faraday-anchor");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billing_client.rb"), [
    "require 'faraday'",
    "conn = Faraday.new(url: 'http://billing-service')",
    "conn.post('/api/invoices', body.to_json)",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["faraday"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("faraday");
  expect(c.method).toBe("POST");
  expect(c.target_ref).toBe("http://billing-service");
  expect(c.path).toBe("/api/invoices");
  cleanupTmpPath(root);
});

// ── Ruby: HTTParty ────────────────────────────────────────────────────────────

it("detects HTTParty.get call with inline url", () => {
  const root = makeTmpPath("httparty-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "billing_client.rb"), [
    "require 'httparty'",
    "response = HTTParty.get('http://billing-service/api/invoices')",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["httparty"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("httparty");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

// ── .NET: HttpClient ──────────────────────────────────────────────────────────

it("detects HttpClient.PostAsync call: verb from method name, inline url", () => {
  const root = makeTmpPath("dotnet-httpclient-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "BillingClient.cs"), [
    "using System.Net.Http;",
    "public class BillingClient {",
    "    public async Task CreateInvoice() {",
    '        var resp = await httpClient.PostAsync("http://billing-service/api/invoices", content);',
    "    }",
    "}",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["dotnet_httpclient"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("dotnet_httpclient");
  expect(c.method).toBe("POST");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects HttpClient BaseAddress anchor + GetAsync relative path", () => {
  const root = makeTmpPath("dotnet-httpclient-base");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "BillingClient.cs"), [
    "using System.Net.Http;",
    "public class BillingClient {",
    '    public BillingClient() { httpClient.BaseAddress = new Uri("http://billing-service"); }',
    "    public async Task GetInvoices() {",
    '        var resp = await httpClient.GetAsync("/api/invoices");',
    "    }",
    "}",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["dotnet_httpclient"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("dotnet_httpclient");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("http://billing-service");
  cleanupTmpPath(root);
});

// ── .NET: RestSharp ───────────────────────────────────────────────────────────

it("detects RestSharp RestRequest with explicit Method.Post", () => {
  const root = makeTmpPath("restsharp-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "BillingClient.cs"), [
    "using RestSharp;",
    "public class BillingClient {",
    '    public void CreateInvoice() {',
    '        var client = new RestClient("http://billing-service");',
    '        var req = new RestRequest("/api/invoices", Method.Post);',
    "    }",
    "}",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["restsharp"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("restsharp");
  expect(c.method).toBe("POST");
  expect(c.target_ref).toBe("http://billing-service");
  expect(c.path).toBe("/api/invoices");
  cleanupTmpPath(root);
});

// ── PHP: Guzzle ───────────────────────────────────────────────────────────────

it("detects Guzzle $client->request('GET', ...) with base_uri anchor", () => {
  const root = makeTmpPath("guzzle-detect");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "BillingClient.php"), [
    "<?php",
    "use GuzzleHttp\\Client;",
    "$client = new Client(['base_uri' => 'http://billing-service']);",
    "$res = $client->request('GET', '/api/invoices');",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["guzzle"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("guzzle");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("http://billing-service");
  expect(c.path).toBe("/api/invoices");
  cleanupTmpPath(root);
});

it("detects Guzzle $client->post() shorthand", () => {
  const root = makeTmpPath("guzzle-shorthand");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "BillingClient.php"), [
    "<?php",
    "use GuzzleHttp\\Client;",
    "$res = $client->post('http://billing-service/api/invoices', ['json' => $body]);",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["guzzle"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("guzzle");
  expect(c.method).toBe("POST");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

// ── Frontend JS/TS: Angular HttpClient ───────────────────────────────────────

it("detects Angular HttpClient.get with generic type argument", () => {
  const root = makeTmpPath("angular-httpclient-generic");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "userService.ts"), [
    'import { HttpClient } from "@angular/common/http";',
    'export class UserService {',
    '  constructor(private http: HttpClient) {}',
    '  getUsers() { return this.http.get<User[]>("/api/users"); }',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["angular_httpclient"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("angular_httpclient");
  expect(c.method).toBe("GET");
  expect(c.path).toBe("/api/users");
});

it("detects Angular HttpClient.post without generic", () => {
  const root = makeTmpPath("angular-httpclient-post");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "invoiceService.ts"), [
    'import { HttpClient } from "@angular/common/http";',
    'export class InvoiceService {',
    '  constructor(private http: HttpClient) {}',
    '  create(body: unknown) { return this.http.post("/api/invoices", body); }',
    '}',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["angular_httpclient"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients.find((e) => e.method === "POST")!;
  expect(c).toBeDefined();
  expect(c.framework).toBe("angular_httpclient");
  expect(c.path).toBe("/api/invoices");
});

// ── Frontend JS/TS: jQuery AJAX ──────────────────────────────────────────────

it("detects jQuery $.get shorthand", () => {
  const root = makeTmpPath("jquery-get");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), [
    'import $ from "jquery";',
    '$.get("/api/users", (data) => console.log(data));',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["jquery"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("jquery");
  expect(c.method).toBe("GET");
  expect(c.path).toBe("/api/users");
});

it("detects jQuery $.post shorthand", () => {
  const root = makeTmpPath("jquery-post");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), [
    'import $ from "jquery";',
    '$.post("/api/invoices", body);',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["jquery"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("jquery");
  expect(c.method).toBe("POST");
  expect(c.path).toBe("/api/invoices");
});

it("detects jQuery $.getJSON shorthand (default GET)", () => {
  const root = makeTmpPath("jquery-getjson");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), [
    'import $ from "jquery";',
    '$.getJSON("/api/users");',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["jquery"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("jquery");
  expect(c.method).toBe("GET");
  expect(c.path).toBe("/api/users");
});

// ── Frontend JS/TS: ky ───────────────────────────────────────────────────────

it("detects ky.post call with explicit verb", () => {
  const root = makeTmpPath("ky-post");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "apiClient.ts"), [
    'import ky from "ky";',
    'await ky.post("http://billing-service/api/invoices", { json: body });',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["ky"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("ky");
  expect(c.method).toBe("POST");
  expect(c.path).toBe("http://billing-service/api/invoices");
});

it("detects bare ky() call (default GET)", () => {
  const root = makeTmpPath("ky-bare");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "apiClient.ts"), [
    'import ky from "ky";',
    'await ky("http://billing-service/api/users");',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["ky"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("ky");
  expect(c.method).toBe("GET");
  expect(c.path).toBe("http://billing-service/api/users");
});

it("detects ky.create prefixUrl as file_anchor (target_ref) + ky.get call in same file", () => {
  const root = makeTmpPath("ky-create");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "apiClient.ts"), [
    'import ky from "ky";',
    'const api = ky.create({ prefixUrl: "http://billing-service" });',
    'await ky.get("api/invoices");',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["ky"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients.find((e) => e.method === "GET")!;
  expect(c).toBeDefined();
  expect(c.framework).toBe("ky");
  expect(c.target_ref).toBe("http://billing-service");
});

// ── Frontend JS/TS: XMLHttpRequest ───────────────────────────────────────────

it("detects XMLHttpRequest xhr.open GET", () => {
  const root = makeTmpPath("xhr-get");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), [
    'const xhr = new XMLHttpRequest();',
    'xhr.open("GET", "/api/users");',
    'xhr.send();',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["xhr"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("xhr");
  expect(c.method).toBe("GET");
  expect(c.path).toBe("/api/users");
});

it("detects XMLHttpRequest req.open POST", () => {
  const root = makeTmpPath("xhr-post");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), [
    'const req = new XMLHttpRequest();',
    'req.open("POST", "/api/invoices");',
    'req.send(body);',
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["xhr"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("xhr");
  expect(c.method).toBe("POST");
  expect(c.path).toBe("/api/invoices");
});

// ── Frontend JS/TS: vue-resource ─────────────────────────────────────────────

it("detects vue-resource this.$http.get call", () => {
  const root = makeTmpPath("vue-resource-get");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "UserComponent.ts"), [
    "import VueResource from 'vue-resource';",
    "export default {",
    "  methods: {",
    "    fetchUsers() { return this.$http.get('/api/users'); }",
    "  }",
    "}",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["vue_resource"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("vue_resource");
  expect(c.method).toBe("GET");
  expect(c.path).toBe("/api/users");
});

it("detects vue-resource Vue.http.post call", () => {
  const root = makeTmpPath("vue-resource-vue-http");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "invoiceService.ts"), [
    "import Vue from 'vue';",
    "import VueResource from 'vue-resource';",
    "Vue.http.post('/api/invoices', body).then((res) => res.json());",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["vue_resource"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("vue_resource");
  expect(c.method).toBe("POST");
  expect(c.path).toBe("/api/invoices");
});

// ── Rust: reqwest ─────────────────────────────────────────────────────────────

it("detects reqwest::get call", () => {
  const root = makeTmpPath("reqwest-get");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "main.rs"), [
    "use reqwest;",
    "async fn fetch() {",
    '    let resp = reqwest::get("http://billing-service/api/invoices").await.unwrap();',
    "}",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["reqwest"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("reqwest");
  expect(c.method).toBe("GET");
  expect(c.target_ref).toBe("billing-service");
  expect(c.path).toBe("http://billing-service/api/invoices");
  cleanupTmpPath(root);
});

it("detects reqwest client.post builder call", () => {
  const root = makeTmpPath("reqwest-post");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "main.rs"), [
    "use reqwest;",
    "async fn create(client: &reqwest::Client) {",
    '    let resp = client.post("http://billing-service/api/invoices").json(&body).send().await.unwrap();',
    "}",
  ].join("\n"));
  const profiles = resolveClientProfiles({ profileNames: ["reqwest"] });
  const clients = detectHttpClients(root, profiles);
  expect(clients.length).toBeGreaterThanOrEqual(1);
  const c = clients[0];
  expect(c.framework).toBe("reqwest");
  expect(c.method).toBe("POST");
  expect(c.target_ref).toBe("billing-service");
  cleanupTmpPath(root);
});

// ── Multiline WebClient detection (PR #58 Finding 1) ──────────────────────

it("detects a multi-line WebClient .get().uri() chain", () => {
  const root = makeTmpPath("webclient-ml");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "C.java"), [
    "import org.springframework.web.reactive.function.client.WebClient;",
    "var r = webClient.get()",
    '    .uri("/api/orders/42")',
    "    .retrieve();",
  ].join("\n"));
  const eps = detectHttpClients(root, resolveClientProfiles({ profileNames: ["webclient"] }));
  expect(eps.some((e) => e.method === "GET" && e.path === "/api/orders/42")).toBe(true);
  cleanupTmpPath(root);
});

it("still detects a single-line WebClient .get().uri() call", () => {
  const root = makeTmpPath("webclient-sl");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "D.java"), [
    "import org.springframework.web.reactive.function.client.WebClient;",
    'var r = webClient.post().uri("/api/orders").retrieve();',
  ].join("\n"));
  const eps = detectHttpClients(root, resolveClientProfiles({ profileNames: ["webclient"] }));
  expect(eps.some((e) => e.method === "POST" && e.path === "/api/orders")).toBe(true);
  cleanupTmpPath(root);
});

// ── Fix 2: URL-shape guard — no false positives for non-URL .get() calls ──

it("does not emit http_clients for non-URL .get() calls in an axios-imported file", () => {
  const root = makeTmpPath("axios-fp");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "svc.ts"), [
    'import axios from "axios";',
    'const x = cache.get("some-key");',
    'const y = settings.get("timeout");',
    'const r = await axios.get("/api/invoices/42");',
  ].join("\n"));
  const eps = detectHttpClients(root, resolveClientProfiles({ profileNames: ["axios"] }));
  expect(eps.length).toBe(1);
  expect(eps[0]!.path).toBe("/api/invoices/42");
  cleanupTmpPath(root);
});
