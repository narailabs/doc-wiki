# Per-Language Detection-Marker Reference — Service-to-Service Calls & Message Queues

Research reference for a static-analysis feature that finds **service-to-service HTTP calls** (clients) and **message-queue produce/consume sites** in source code, then resolves them into "calls" edges between services.

## Engine model (the contract these profiles fit)

This mirrors doc-wiki's existing REST-endpoint profiles under `agents/lib/rest_profiles/*.yaml`. A profile is a YAML file:

- **`markers`** — literal substrings (import lines, annotations). Cheap pre-filter: a file is only a candidate if at least one marker substring appears. Tagged with a `type:` for readability (`import` / `annotation` / `facade_call` / ...). Markers are NOT regexes; they are `indexOf`-style substring checks.
- **`patterns`** — practical regexes applied **per source line** (so the captured line number is meaningful), or over a **small N-line window** when a call spans lines (flagged explicitly below as `window: N`). Each pattern names 1-indexed capture-group offsets:
  - For HTTP clients: `method_group`, `url_group` (and optional `service_group`).
  - For queues: `name_group` (queue/topic/exchange/routing-key), optional `role` (`producer` / `consumer`).
- Optional **`file_prefix`** — a class/instance-level base path (Feign `path=`, aspnet `[Route]`, axios `baseURL`) concatenated onto per-method relative paths, exactly like `aspnet.yaml`'s `file_prefix` block.

**Design bias (from the prompt): precision over recall.** Favor anchored, literal-quote-delimited captures. We would rather miss an exotic dynamically-built URL than emit a garbage edge. Every pattern below only fires on a **string literal** or a clearly-resolvable symbol; URLs assembled by string concatenation / `String.format` / f-strings with no literal host are deliberately left to medium/low confidence or skipped.

Regexes are written in JavaScript flavour (the engine's flavour), double-escaped where shown inline as they'd appear inside YAML double-quoted scalars.

---

# PART A — HTTP service-to-service CLIENT calls

General note on **method extraction**: for fluent builders the HTTP verb is the *method name* in the call chain (`.get(`, `.post(`, `getForObject`, `GetAsync`). For request-builder forms the verb is a **string argument** (`http.NewRequest("POST", ...)`, `$client->request('GET', ...)`, `client.request(method='POST')`). Both forms are captured below.

General note on **target-service identification** (detail in Part C): a captured URL/path resolves to a target service via one of —
1. **Hardcoded host** — `http://billing.internal/...` → host = service.
2. **k8s / service-mesh DNS** — `http://settings-service/...`, `http://settings-service.ns.svc.cluster.local/...` → first DNS label = service name.
3. **Service-name variable / constant** — `BILLING_SVC + "/invoices"`; resolve the symbol if it's a literal assignment in the same file.
4. **Config-key indirection** — `${seed-loader.url}/x`, `process.env.BILLING_URL`, `cfg.BillingURL` → resolve against config files / env manifests.
5. **Feign `name=` / declarative client** — strongest signal; maps directly to target's `spring.application.name`.

---

## A1. Java — Spring Cloud OpenFeign  ★ #1 PRIORITY

The reference system uses this heavily. Feign is the **highest-value detector**: the target service is *named explicitly* in the annotation, so edge resolution is near-deterministic — no host parsing needed.

### Markers
```yaml
markers:
  - { pattern: "import org.springframework.cloud.openfeign", type: import }
  - { pattern: "@FeignClient",        type: annotation }
  - { pattern: "@EnableFeignClients", type: annotation }   # app-level, confirms Feign is in use
```

### Real-world snippets
```java
// Service named by logical name; resolved via Eureka/k8s to spring.application.name
@FeignClient(name = "settings-service")
public interface ConfigClient {
    @GetMapping("/api/v1/config/{key}")
    ConfigDto get(@PathVariable("key") String key);

    @PostMapping(value = "/api/v1/config", consumes = "application/json")
    void put(@RequestBody ConfigDto dto);
}

// name + class-level path prefix + explicit url override
@FeignClient(name = "address-service", url = "${address.url}", path = "/address-service")
public interface AddressClient {
    @GetMapping("/address/{id}")
    ResponseEntity<AddressResponse> byId(@PathVariable("id") int id);   // full path = /address-service/address/{id}
}

// Legacy @RequestMapping verb form
@FeignClient("stores")
public interface StoreClient {
    @RequestMapping(method = RequestMethod.GET, value = "/stores/{storeId:\\d+}")
    Store get(@PathVariable Long storeId);
}
```

### Patterns
The `@FeignClient(...)` line is a **file-level (interface-level) anchor**: capture the service name and optional path prefix once, then attach every `@*Mapping` method below it.

```yaml
# (1) interface anchor — service name + optional path prefix.
#     name= / value= / bare-first-arg all denote the logical service name.
file_anchor:
  # @FeignClient("stores")  |  @FeignClient(name = "stores")  |  @FeignClient(value="stores", ...)
  service_regex: "@FeignClient\\s*\\(\\s*(?:(?:name|value)\\s*=\\s*)?[\"']([^\"']+)[\"']"
  service_group: 1
  # path = "/address-service"  (class-level prefix; optional)
  prefix_regex: "path\\s*=\\s*[\"']([^\"']+)[\"']"
  prefix_group: 1
  # url = "http://..." or "${address.url}" (optional explicit host override)
  url_regex: "url\\s*=\\s*[\"']([^\"']+)[\"']"
  url_group: 1

patterns:
  # (2a) @GetMapping("/x"), @PostMapping(value="/x"), @PatchMapping(path="/x")
  - regex: "@(Get|Post|Put|Delete|Patch|Options|Head)Mapping\\s*\\(\\s*(?:(?:value|path)\\s*=\\s*)?[\"']([^\"']+)[\"']"
    method_group: 1
    path_group: 2
  # (2b) legacy @RequestMapping(method = RequestMethod.GET, value = "/x")
  - regex: "@RequestMapping\\s*\\([^)]*method\\s*=\\s*RequestMethod\\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)[^)]*?(?:value|path)\\s*=\\s*[\"']([^\"']+)[\"']"
    method_group: 1
    path_group: 2
```

### Target service
`file_anchor.service_group` → the value is the **target's `spring.application.name`** (or Eureka/k8s service id). This is the cleanest cross-service signal in the whole document. If `url=` is also present and is a literal host, prefer it for host-based confirmation; if `url=` is a `${...}` placeholder, keep the logical name as the resolver key.

Full path for an edge = `prefix` (from `path=`, if any) **concatenated** with each method's `path_group`, then path-normalized (Part C). Strip Spring's inline regex constraints (`{storeId:\\d+}` → `{storeId}`) during normalization.

### Gotchas
- `@FeignClient` may appear with attributes spread across **multiple lines**; apply `file_anchor` regexes over a small window (`window: 3`) starting at the `@FeignClient` token, not strictly one line.
- Bare-first-arg vs `name=` vs `value=` — all three name the service; the `(?:(?:name|value)\\s*=\\s*)?` optional group handles it.
- A method may use bare `@RequestMapping("/x")` with **no `method=`** → defaults to all verbs; treat as `GET` (most common) at medium confidence, or skip. Pattern (2b) requires an explicit `method=` to fire, so these are skipped by design (precision bias).
- `path=` prefix concatenation: Spring joins with a single `/`; normalize duplicate slashes.
- Kotlin interfaces look identical; the `**/*.kt` glob plus same patterns cover them.

---

## A2. Java — Spring RestTemplate

### Markers
```yaml
markers:
  - { pattern: "org.springframework.web.client.RestTemplate", type: import }
  - { pattern: "RestTemplate", type: type_ref }
```

### Real-world snippets
```java
String url = "http://payments-service/api/invoices/{id}";
Invoice inv = restTemplate.getForObject(url, Invoice.class, id);
ResponseEntity<Invoice> r = restTemplate.exchange(
    "http://payments-service/api/invoices", HttpMethod.POST, req, Invoice.class);
restTemplate.postForEntity("http://payments-service/api/invoices", body, Invoice.class);
```

### Patterns
```yaml
patterns:
  # getForObject / getForEntity / postForObject / postForEntity / put / delete / patchForObject
  # verb is embedded in the method name -> capture the For-method, map to HTTP verb downstream.
  - regex: "restTemplate\\.(getForObject|getForEntity|postForObject|postForEntity|put|delete|patchForObject|headForHeaders|optionsForAllow)\\s*\\(\\s*[\"']([^\"']+)[\"']"
    method_group: 1   # GET/POST/PUT/DELETE derived from prefix of the For-method name
    url_group: 2
  # exchange(url, HttpMethod.POST, ...) -> verb is the 2nd-ish arg; URL is first literal
  - regex: "restTemplate\\.exchange\\s*\\(\\s*[\"']([^\"']+)[\"'][^)]*HttpMethod\\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)"
    url_group: 1
    method_group: 2
```

### Target service
Host of the literal URL: `http://payments-service/...` → `payments-service` (k8s DNS). Hardcoded FQDN host → that host.

### Gotchas
- **The URL is frequently a variable**, not an inline literal (`getForObject(url, ...)` where `url` was built above). When the first argument is an identifier, fall back to a **same-file backward scan** for `String <id> = "http..."` / `String <id> = base + "..."`. If the host segment isn't a literal, downgrade to medium/low or skip. Document this as the dominant RestTemplate gotcha.
- `restTemplate` may be named differently (`this.rest`, `restClient`). Broaden the receiver to `\\b\\w*[Rr]est\\w*\\.` only if false-positive rate is acceptable; default keeps the literal `restTemplate` receiver for precision.
- UriComponentsBuilder-built URLs (`.fromHttpUrl("http://svc").path("/x")`) — capture the `fromHttpUrl("...")` host separately at medium confidence.

---

## A3. Java — Spring WebClient

### Markers
```yaml
markers:
  - { pattern: "org.springframework.web.reactive.function.client.WebClient", type: import }
  - { pattern: "WebClient", type: type_ref }
```

### Real-world snippets
```java
webClient.get().uri("/api/invoices/{id}", id).retrieve()...;
// baseUrl set at build time:
WebClient client = WebClient.builder().baseUrl("http://payments-service").build();
webClient.post().uri("/api/invoices").bodyValue(body).retrieve()...;
```

### Patterns
WebClient is a **fluent chain**: `.get()` / `.post()` sets the verb, `.uri("...")` sets the path. They are usually adjacent but may be on separate lines — use a small window.

```yaml
patterns:
  # window: 2  — verb method immediately followed (same or next line) by .uri("literal")
  - regex: "\\.(get|post|put|delete|patch|head|options)\\(\\)\\s*\\.uri\\(\\s*[\"']([^\"']+)[\"']"
    method_group: 1
    path_group: 2
    window: 2
  # baseUrl / baseURL set on the builder -> file_prefix-style host
file_prefix:
  regex: "\\.baseUrl\\(\\s*[\"']([^\"']+)[\"']"
  prefix_group: 1
```

### Target service
`baseUrl("http://payments-service")` host → service; concatenated with each `.uri(path)`. If `.uri()` itself contains an absolute `http://...`, that host wins.

### Gotchas
- `.get()` with empty parens collides with unrelated getters; the **required adjacent `.uri(`** in the same regex prevents most false positives — keep them in one pattern, not two.
- `.uri(uriBuilder -> uriBuilder.path("/x").build())` lambda form: capture the inner `.path("/x")` literal at medium confidence; the host comes from `baseUrl`.
- WebClient instances often injected per-target with the baseUrl configured in a `@Configuration` bean far from the call site — cross-file resolution of the host; flag as medium when baseUrl isn't in the same file.

---

## A4. Node — axios

### Markers
```yaml
markers:
  - { pattern: "from \"axios\"", type: import }
  - { pattern: "from 'axios'",   type: import }
  - { pattern: "require('axios')", type: import }
  - { pattern: "require(\"axios\")", type: import }
```

### Real-world snippets
```js
await axios.get(`http://payments-service/api/invoices/${id}`);
await axios.post("http://payments-service/api/invoices", body);
// instance with baseURL:
const api = axios.create({ baseURL: process.env.BILLING_URL });
await api.get("/api/invoices");
// config-object form:
axios({ method: "post", url: "http://payments-service/api/invoices" });
```

### Patterns
```yaml
patterns:
  # axios.get('url') / axios.post(`url`) / instance api.get('path')
  - regex: "(?:axios|\\b\\w+)\\.(get|post|put|delete|patch|head|options)\\s*\\(\\s*[`'\"]([^`'\"$]*)[`'\"]?"
    method_group: 1
    url_group: 2
  # config-object form: axios({ method:'post', url:'...' })  (window: 4)
  - regex: "method\\s*:\\s*[`'\"](get|post|put|delete|patch)[`'\"][\\s\\S]*?url\\s*:\\s*[`'\"]([^`'\"]+)[`'\"]"
    method_group: 1
    url_group: 2
    window: 4
file_prefix:
  # axios.create({ baseURL: 'http://payments-service' })  — only literal baseURL captured
  regex: "axios\\.create\\s*\\(\\s*\\{[^}]*baseURL\\s*:\\s*[`'\"]([^`'\"]+)[`'\"]"
  prefix_group: 1
```

### Target service
- Inline absolute URL → host (`http://payments-service/...`).
- Instance `.get("/path")` with no host → resolve via the instance's `baseURL` literal (same file) or via the env var it references (`process.env.BILLING_URL`) against env manifests → medium confidence.

### Gotchas
- **Template-literal interpolation** (`` `${baseUrl}/x` ``) breaks the host capture — the leading `${...}` means `url_group` may capture empty/garbage. The `[^`'\"$]*` in the first pattern stops at `$`, so a leading-interpolation URL yields no usable host → correctly skipped rather than emitting garbage.
- The receiver `\\b\\w+\\.(get|post|...)` is **broad** — it matches *any* `something.get(...)`. Gate hard on the axios marker being present in the file; even then expect some noise (e.g. a local cache `.get`). Consider tightening the receiver to known axios-instance variable names discovered from `axios.create` assignments.
- `axios.request({...})` is equivalent to the config-object form.

---

## A5. Node — fetch / undici

### Markers
```yaml
markers:
  - { pattern: "fetch(", type: builtin }            # global fetch (Node 18+/browser)
  - { pattern: "from \"undici\"", type: import }
  - { pattern: "require('undici')", type: import }
  - { pattern: "from 'node-fetch'", type: import }
```

### Real-world snippets
```js
const r = await fetch("http://payments-service/api/invoices", { method: "POST", body });
const r = await fetch(`http://payments-service/api/invoices/${id}`);   // GET (default)
```

### Patterns
```yaml
patterns:
  # fetch('url', { method:'POST' })  — method optional (defaults GET)
  - regex: "fetch\\(\\s*[`'\"]([^`'\"$]+)[`'\"]\\s*(?:,\\s*\\{[^}]*method\\s*:\\s*[`'\"](GET|POST|PUT|DELETE|PATCH|HEAD)[`'\"])?"
    url_group: 1
    method_group: 2   # may be empty -> default GET
    window: 3
```

### Target service
Host of the first-arg literal. `undici.request(url, opts)` mirrors this — add a `(?:undici\\.)?request\\(` variant if needed.

### Gotchas
- `fetch(` as a substring marker is **very common** and will candidate-flag many files; that's acceptable as a pre-filter but the pattern itself must require a literal-URL first arg.
- Default method is GET when the options object omits `method:`; the optional second group yields empty → treat as GET.
- Same template-literal-interpolation skip rule as axios (the `[^`'\"$]+` guard).

---

## A6. Node — got / superagent

### Markers
```yaml
markers:
  - { pattern: "from \"got\"", type: import }
  - { pattern: "require('got')", type: import }
  - { pattern: "from \"superagent\"", type: import }
  - { pattern: "require('superagent')", type: import }
```

### Snippets + patterns
```js
await got.post("http://payments-service/api/invoices", { json: body });
await got("http://payments-service/api/invoices");          // GET default
superagent.get("http://payments-service/api/invoices").then(...);
```
```yaml
patterns:
  # got.post('url') / got.get('url')
  - regex: "got\\.(get|post|put|delete|patch|head)\\s*\\(\\s*[`'\"]([^`'\"$]+)[`'\"]"
    method_group: 1
    url_group: 2
  # bare got('url') -> GET
  - regex: "\\bgot\\(\\s*[`'\"]([^`'\"$]+)[`'\"]"
    url_group: 1   # method defaults GET
  # superagent: request('GET','url') OR .get('url')
  - regex: "(?:superagent|request)\\.(get|post|put|delete|patch|head)\\s*\\(\\s*[`'\"]([^`'\"$]+)[`'\"]"
    method_group: 1
    url_group: 2
```
**Target service:** host of literal. **Gotchas:** got's `prefixUrl` option is the baseURL analogue — add a `file_prefix` capturing `prefixUrl:\\s*['\"]...`. superagent verb is the method name; `request(METHOD, url)` form (rare) needs a string-arg method variant.

---

## A7. Python — requests

### Markers
```yaml
markers:
  - { pattern: "import requests", type: import }
  - { pattern: "from requests", type: import }
```

### Snippets + patterns
```python
r = requests.get(f"http://payments-service/api/invoices/{id}")
r = requests.post("http://payments-service/api/invoices", json=body)
r = session.get("http://payments-service/api/invoices")     # Session reuse
```
```yaml
patterns:
  # requests.get('url') / requests.post(...) / session.get(...)
  - regex: "(?:requests|session|self\\._?session|s)\\.(get|post|put|delete|patch|head|options)\\s*\\(\\s*[frbu]*[\"']([^\"'{]+)[\"']"
    method_group: 1
    url_group: 2
  # requests.request('POST', url)
  - regex: "requests\\.request\\(\\s*[\"'](GET|POST|PUT|DELETE|PATCH|HEAD)[\"']\\s*,\\s*[frbu]*[\"']([^\"'{]+)[\"']"
    method_group: 1
    url_group: 2
```

### Target service
Host of literal.

### Gotchas
- **f-strings** (`f"http://payments-service/{id}"`) — the `[frbu]*` prefix consumes the `f`, and `[^\"'{]+` stops at the first `{`, so a URL whose host precedes the first `{` is captured (host intact) while the path tail is truncated — acceptable, host is what matters for the edge. A URL where interpolation is *before* the host yields no host → skipped.
- `session = requests.Session()` then `session.get` — receiver alternation covers common names (`session`, `s`, `self._session`); custom names slip through.
- `requests` is also the name of unrelated objects occasionally; the file-level marker gate mitigates.

---

## A8. Python — httpx

### Markers
```yaml
markers:
  - { pattern: "import httpx", type: import }
  - { pattern: "from httpx", type: import }
```

### Snippets + patterns
```python
r = httpx.get("http://payments-service/api/invoices")
async with httpx.AsyncClient(base_url="http://payments-service") as client:
    r = await client.get("/api/invoices")
```
```yaml
patterns:
  - regex: "(?:httpx|client|self\\._?client)\\.(get|post|put|delete|patch|head|options)\\s*\\(\\s*[frbu]*[\"']([^\"'{]+)[\"']"
    method_group: 1
    url_group: 2
file_prefix:
  # AsyncClient(base_url="http://payments-service") / Client(base_url=...)
  regex: "(?:Async)?Client\\([^)]*base_url\\s*=\\s*[frbu]*[\"']([^\"']+)[\"']"
  prefix_group: 1
```
**Target service:** inline host, or `base_url` literal concatenated with relative `.get("/path")`. **Gotchas:** identical f-string handling to requests; `AsyncClient` host is set at construction, often in a different scope → medium confidence when `base_url` not co-located with the call.

---

## A9. Python — aiohttp

### Markers
```yaml
markers:
  - { pattern: "import aiohttp", type: import }
  - { pattern: "from aiohttp", type: import }
```

### Snippets + patterns
```python
async with aiohttp.ClientSession() as session:
    async with session.get("http://payments-service/api/invoices") as resp:
        ...
session = aiohttp.ClientSession(base_url="http://payments-service")
await session.post("/api/invoices", json=body)
```
```yaml
patterns:
  - regex: "(?:session|self\\._?session)\\.(get|post|put|delete|patch|head)\\s*\\(\\s*[frbu]*[\"']([^\"'{]+)[\"']"
    method_group: 1
    url_group: 2
file_prefix:
  regex: "ClientSession\\([^)]*base_url\\s*=\\s*[frbu]*[\"']([^\"']+)[\"']"
  prefix_group: 1
```
**Target service:** inline host or `base_url`. **Gotchas:** the `session.get(...)` receiver collides with dict-like `.get`; the aiohttp marker gate + requiring an `http`-ish literal first arg keeps precision. `base_url` on `ClientSession` is relatively new — many codebases still inline full URLs.

---

## A10. Go — net/http

### Markers
```yaml
markers:
  - { pattern: "net/http", type: import }
```

### Snippets + patterns
```go
resp, err := http.Get("http://payments-service/api/invoices")
req, _ := http.NewRequest("POST", "http://payments-service/api/invoices", body)
req, _ := http.NewRequestWithContext(ctx, http.MethodPost, billingURL+"/api/invoices", body)
resp, err := http.Post("http://payments-service/api/invoices", "application/json", body)
```
```yaml
patterns:
  # http.Get / http.Post / http.Head / http.PostForm — verb is the func name
  - regex: "http\\.(Get|Post|Head|PostForm)\\s*\\(\\s*[\"`]([^\"`]+)[\"`]"
    method_group: 1
    url_group: 2
  # http.NewRequest("POST", "url", ...) — verb is the 1st string arg
  - regex: "http\\.NewRequest(?:WithContext)?\\(\\s*(?:[^,]+,\\s*)?(?:[\"`](GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)[\"`]|http\\.Method(Get|Post|Put|Delete|Patch|Head|Options))\\s*,\\s*[\"`]([^\"`]+)[\"`]"
    method_group: 1   # or group 2 when http.MethodX constant form
    url_group: 3
```

### Target service
Host of literal. Go services frequently build the URL as `baseURL + "/path"` where `baseURL` is from config/env (`os.Getenv("BILLING_URL")`) → when the URL arg is `ident + "..."`, capture the literal **path tail** and resolve the host via the symbol's config origin → medium confidence.

### Gotchas
- `http.NewRequestWithContext(ctx, method, url, body)` shifts arg positions; the `(?:[^,]+,\\s*)?` optional leading-arg group absorbs the `ctx`. Both `"POST"` string and `http.MethodPost` constant forms are handled.
- Raw-string backtick literals (`` `http://...` ``) are common in Go → both `"` and `` ` `` delimiters included.
- `http.MethodPost` etc. constants are idiomatic; the second alternation captures them (map `MethodPost`→POST downstream).

---

## A11. Go — resty

### Markers
```yaml
markers:
  - { pattern: "go-resty/resty", type: import }
```
### Snippets + patterns
```go
client := resty.New().SetBaseURL("http://payments-service")
resp, _ := client.R().Get("/api/invoices")
resp, _ := client.R().SetBody(body).Post("/api/invoices")
```
```yaml
patterns:
  # .R()....Get("/path") / .Post("/path")  (window: 2 — R() and verb may be split)
  - regex: "\\.(Get|Post|Put|Delete|Patch|Head|Options)\\(\\s*[\"`]([^\"`]+)[\"`]\\s*\\)"
    method_group: 1
    path_group: 2
    window: 2
file_prefix:
  regex: "SetBaseURL\\(\\s*[\"`]([^\"`]+)[\"`]"
  prefix_group: 1
```
**Target service:** `SetBaseURL` host + relative verb path. **Gotchas:** the bare `.Get("/x")` pattern is broad — gate on the resty marker. `SetHostURL` is the deprecated alias for `SetBaseURL`; add it.

---

## A12. Ruby — Faraday / HTTParty

### Markers
```yaml
markers:
  - { pattern: "require 'faraday'", type: import }
  - { pattern: "require \"faraday\"", type: import }
  - { pattern: "require 'httparty'", type: import }
  - { pattern: "include HTTParty", type: mixin }
```
### Snippets + patterns
```ruby
HTTParty.get("http://payments-service/api/invoices")
conn = Faraday.new(url: "http://payments-service")
conn.post("/api/invoices", body.to_json)
response = Faraday.get("http://payments-service/api/invoices")
```
```yaml
patterns:
  # HTTParty.get(...) / Faraday.get(...) / conn.post('/path')
  - regex: "(?:HTTParty|Faraday|conn|client|@?conn)\\.(get|post|put|delete|patch|head)\\s*\\(\\s*[\"']([^\"'#]+)[\"']"
    method_group: 1
    url_group: 2
file_prefix:
  # Faraday.new(url: 'http://payments-service')
  regex: "Faraday\\.new\\([^)]*url:\\s*[\"']([^\"']+)[\"']"
  prefix_group: 1
```
**Target service:** inline host or `Faraday.new(url:)`. **Gotchas:** Ruby string interpolation is `#{...}`; `[^\"'#]+` stops at `#`, preserving a literal host before any interpolation. The `conn`/`client` receivers are guesses — Faraday connections take arbitrary names; medium confidence for relative-path posts whose connection host isn't co-located.

---

## A13. C#/.NET — HttpClient / RestSharp

### Markers
```yaml
markers:
  - { pattern: "using System.Net.Http", type: import }
  - { pattern: "HttpClient", type: type_ref }
  - { pattern: "using RestSharp", type: import }
```
### Snippets + patterns
```csharp
var resp = await httpClient.GetAsync("http://payments-service/api/invoices");
var resp = await httpClient.PostAsync("http://payments-service/api/invoices", content);
// RestSharp:
var client = new RestClient("http://payments-service");
var req = new RestRequest("/api/invoices", Method.Post);
```
```yaml
patterns:
  # HttpClient: GetAsync/PostAsync/PutAsync/DeleteAsync/PatchAsync — verb in method name
  - regex: "\\.(Get|Post|Put|Delete|Patch)Async\\s*\\(\\s*[$@]*[\"']([^\"'{]+)[\"']"
    method_group: 1
    url_group: 2
  # RestSharp: new RestRequest("/path", Method.Post)
  - regex: "new RestRequest\\(\\s*[$@]*[\"']([^\"'{]+)[\"'](?:\\s*,\\s*Method\\.(Get|Post|Put|Delete|Patch))?"
    url_group: 1
    method_group: 2
file_prefix:
  # HttpClient BaseAddress / new RestClient("http://...")
  regex: "(?:BaseAddress\\s*=\\s*new Uri\\(|new RestClient\\()\\s*[\"']([^\"']+)[\"']"
  prefix_group: 1
```
**Target service:** inline host, or `BaseAddress` / `new RestClient(host)` + relative path. **Gotchas:** interpolated strings `$"http://{host}/x"` — `[$@]*` consumes the `$`/`@` prefix, `[^\"'{]+` stops at `{`; leading-interpolation host → skipped. `IHttpClientFactory` named/typed clients set `BaseAddress` in `Program.cs`/`Startup` DI registration far from the call site — host resolution is cross-file → medium confidence; the **client name in `AddHttpClient("billing", ...)`** is itself a usable service hint.

---

## A14. PHP — Guzzle

### Markers
```yaml
markers:
  - { pattern: "use GuzzleHttp\\Client", type: import }
  - { pattern: "GuzzleHttp", type: import }
```
### Snippets + patterns
```php
$client = new Client(['base_uri' => 'http://payments-service']);
$res = $client->request('GET', '/api/invoices');
$res = $client->post('http://payments-service/api/invoices', ['json' => $body]);
$res = $client->get('/api/invoices');
```
```yaml
patterns:
  # $client->request('GET', '/path')
  - regex: "->request\\(\\s*['\"](GET|POST|PUT|DELETE|PATCH|HEAD)['\"]\\s*,\\s*['\"]([^'\"]+)['\"]"
    method_group: 1
    url_group: 2
  # $client->get('/path') / ->post(...)
  - regex: "->(get|post|put|delete|patch|head)\\s*\\(\\s*['\"]([^'\"]+)['\"]"
    method_group: 1
    url_group: 2
file_prefix:
  # new Client(['base_uri' => 'http://payments-service'])
  regex: "base_uri['\"]?\\s*=>\\s*['\"]([^'\"]+)['\"]"
  prefix_group: 1
```
**Target service:** inline host, or `base_uri` + relative path. **Gotchas:** PHP interpolates inside **double**-quoted strings (`"$base/x"`); single-quoted are literal. Prefer single-quote captures; for double-quoted with a `$` var, the host may be a variable → medium/skip. The `->get/->post` receiver is generic (any object) — Guzzle marker gate required.

---

## A15. Rust — reqwest

### Markers
```yaml
markers:
  - { pattern: "use reqwest", type: import }
  - { pattern: "reqwest::", type: path_ref }
```
### Snippets + patterns
```rust
let resp = reqwest::get("http://payments-service/api/invoices").await?;
let resp = client.post("http://payments-service/api/invoices").json(&body).send().await?;
let resp = client.get(format!("{}/api/invoices", base)).send().await?;
```
```yaml
patterns:
  # reqwest::get("url")
  - regex: "reqwest::(get)\\s*\\(\\s*[\"']([^\"']+)[\"']"
    method_group: 1
    url_group: 2
  # client.get("url") / client.post("url") — builder
  - regex: "(?:client|self\\.client|\\w*client)\\.(get|post|put|delete|patch|head)\\s*\\(\\s*[\"']([^\"']+)[\"']"
    method_group: 1
    url_group: 2
  # request(Method::POST, "url")
  - regex: "\\.request\\(\\s*Method::(GET|POST|PUT|DELETE|PATCH|HEAD)\\s*,\\s*[\"']([^\"']+)[\"']"
    method_group: 1
    url_group: 2
```
**Target service:** host of literal. **Gotchas:** `format!("{}/x", base)` builds the URL — first arg is not a plain literal; capture the literal **path tail** inside `format!` and resolve `base` via config → medium. reqwest has no built-in baseURL (no `file_prefix`); a host always appears either inline or via a `format!`/concatenation. The `\\w*client` receiver is broad — marker gate required.

---

# PART B — Message QUEUE produce/consume

Edge semantics: a **producer** site and a **consumer** site that reference the **same queue/topic/routing-key string** form a message-flow edge `producer-service --topic--> consumer-service` (Part C). Name capture is the crux; below, `name_group` captures the literal queue/topic/exchange/routing-key.

---

## B1. RabbitMQ — Spring AMQP  ★ #1 PRIORITY

The reference system uses this. **Consumer** side is annotation-based (clean capture); **producer** side is a `convertAndSend` call where the **routing key** (2nd arg of the 3-arg form) is the join key against the consumer's queue name.

### Markers
```yaml
markers:
  - { pattern: "org.springframework.amqp", type: import }
  - { pattern: "@RabbitListener", type: annotation }
  - { pattern: "RabbitTemplate", type: type_ref }
  - { pattern: "amqp.rabbit", type: import }
```

### Snippets
```java
// CONSUMER
@RabbitListener(queues = "invoice.created.q")
public void handle(InvoiceEvent e) { ... }
@RabbitListener(queues = {Queues.INVOICE_Q, "audit.q"})   // multiple / constants
public void handle2(...) { ... }

// PRODUCER — (exchange, routingKey, payload)
rabbitTemplate.convertAndSend("invoice.exchange", "invoice.created", evt);
rabbitTemplate.convertAndSend("invoice.created.q", evt);   // 2-arg: routingKey == default-exchange queue
```

### Patterns
```yaml
patterns:
  # CONSUMER: @RabbitListener(queues = "q")  | queues = {"a","b"}  — capture each literal
  - regex: "@RabbitListener\\([^)]*queues\\s*=\\s*\\{?\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: consumer
  # PRODUCER 3-arg: convertAndSend("exchange", "routingKey", payload) — capture exchange AND routingKey
  - regex: "convertAndSend\\(\\s*[\"']([^\"']+)[\"']\\s*,\\s*[\"']([^\"']+)[\"']\\s*,"
    name_group: 2      # routing key — primary join key
    exchange_group: 1  # exchange — secondary
    role: producer
  # PRODUCER 2-arg: convertAndSend("routingKey", payload)  (default exchange => routingKey == queue)
  - regex: "convertAndSend\\(\\s*[\"']([^\"']+)[\"']\\s*,\\s*(?![\"'])"
    name_group: 1
    role: producer
```

### Name capture / matching
- Consumer queue name ← `queues=` literal(s).
- Producer routing key ← 2nd arg (3-arg form) or 1st arg (2-arg default-exchange form).
- **Match rule:** producer `routingKey` string `==` consumer `queues` string (default-exchange / direct-exchange-with-matching-binding is the common case in monorepos). When they differ, the binding (`exchange + routingKey → queue`) lives in a `@Bean Binding`/config and must be resolved separately — flag medium.

### Gotchas
- **Constants, not literals**: `@RabbitListener(queues = RabbitConfig.INVOICE_Q)` and `convertAndSend(EXCHANGE, ROUTING_KEY, ...)` reference `static final String` constants. The literal-only patterns above **miss these**. Add a secondary pass: capture the **constant identifier** (`[A-Z_][A-Z0-9_]*`) and resolve it from `static final String X = "..."` declarations in the same package → the dominant real-world case; treat constant-resolved names at the same confidence as literals once resolved, else medium.
- `@RabbitListener` can specify `bindings = @QueueBinding(value=@Queue("q"), exchange=@Exchange("e"), key="k")` instead of `queues=` — add a `@Queue\\(\\s*(?:value\\s*=\\s*)?[\"']([^\"']+)[\"']` variant.
- `@RabbitHandler` methods sit under a class-level `@RabbitListener`; capture the class-level queue.
- SpEL in queue names (`queues = "#{queueName}"`) → skip (`#{` start).

---

## B2. RabbitMQ — Python pika

### Markers
```yaml
markers:
  - { pattern: "import pika", type: import }
```
### Snippets + patterns
```python
channel.basic_publish(exchange='', routing_key='invoice.created.q', body=payload)
channel.basic_consume(queue='invoice.created.q', on_message_callback=cb)
channel.queue_declare(queue='invoice.created.q')
```
```yaml
patterns:
  # PRODUCER: basic_publish(..., routing_key='...')  — routing_key is the join key
  - regex: "basic_publish\\([^)]*routing_key\\s*=\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: producer
  # also capture exchange when present
  - regex: "basic_publish\\([^)]*exchange\\s*=\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: producer_exchange
  # CONSUMER: basic_consume(queue='...')
  - regex: "basic_consume\\([^)]*queue\\s*=\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: consumer
```
**Name capture:** kwargs `routing_key` / `queue`. **Gotchas:** kwargs can span lines → use `window: 4` and `[\\s\\S]` in the `[^)]*` segments. Positional args (rare for pika; it strongly favors kwargs) are not captured. `exchange=''` (default exchange) means `routing_key == queue` — same join rule as Spring AMQP.

---

## B3. RabbitMQ — amqplib (Node)

### Markers
```yaml
markers:
  - { pattern: "from 'amqplib'", type: import }
  - { pattern: "require('amqplib')", type: import }
```
### Snippets + patterns
```js
channel.sendToQueue("invoice.created.q", Buffer.from(JSON.stringify(evt)));
channel.publish("invoice.exchange", "invoice.created", Buffer.from(...));
await channel.consume("invoice.created.q", onMessage);
await channel.assertQueue("invoice.created.q");
```
```yaml
patterns:
  # PRODUCER sendToQueue('q', ...)
  - regex: "\\.sendToQueue\\(\\s*[`'\"]([^`'\"]+)[`'\"]"
    name_group: 1
    role: producer
  # PRODUCER publish('exchange','routingKey', ...) — routingKey is 2nd arg
  - regex: "\\.publish\\(\\s*[`'\"]([^`'\"]+)[`'\"]\\s*,\\s*[`'\"]([^`'\"]+)[`'\"]"
    exchange_group: 1
    name_group: 2
    role: producer
  # CONSUMER consume('q', ...)
  - regex: "\\.consume\\(\\s*[`'\"]([^`'\"]+)[`'\"]"
    name_group: 1
    role: consumer
```
**Name capture:** 1st arg of `sendToQueue`/`consume`; 2nd arg (routing key) of `publish`. **Gotchas:** `.publish` collides with Redis/other pub-sub `.publish` — gate on amqplib marker. Queue names often in a `const Q = '...'` → constant-resolution pass like Spring AMQP.

---

## B4. Kafka — Spring Kafka

### Markers
```yaml
markers:
  - { pattern: "org.springframework.kafka", type: import }
  - { pattern: "@KafkaListener", type: annotation }
  - { pattern: "KafkaTemplate", type: type_ref }
```
### Snippets + patterns
```java
@KafkaListener(topics = "invoice-events")
public void on(InvoiceEvent e) { ... }
@KafkaListener(topics = {"invoice-events", "audit-events"}, groupId = "billing")
public void on2(...) { ... }
kafkaTemplate.send("invoice-events", key, evt);
kafkaTemplate.send("invoice-events", evt);
```
```yaml
patterns:
  # CONSUMER: @KafkaListener(topics = "t")  | topics = {"a","b"}
  - regex: "@KafkaListener\\([^)]*topics\\s*=\\s*\\{?\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: consumer
  # PRODUCER: kafkaTemplate.send("topic", ...)  — topic is 1st arg
  - regex: "kafkaTemplate\\.send\\(\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: producer
```
**Name capture:** `topics=` literal(s) / 1st arg of `.send`. **Match:** producer topic == consumer topic (Kafka has no routing-key indirection — cleaner than RabbitMQ). **Gotchas:** topic constants (`@KafkaListener(topics = Topics.INVOICE)`) → constant-resolution pass. `topicPattern` (regex subscription) → skip / low. `.send(ProducerRecord)` form hides the topic inside the record constructor — add `new ProducerRecord<>\\(\\s*[\"']([^\"']+)[\"']`.

---

## B5. Kafka — confluent-kafka (Python) / segmentio kafka-go / kafkajs (Node)

### Markers
```yaml
markers:
  - { pattern: "from confluent_kafka", type: import }        # Python
  - { pattern: "import confluent_kafka", type: import }
  - { pattern: "segmentio/kafka-go", type: import }          # Go
  - { pattern: "from 'kafkajs'", type: import }               # Node
  - { pattern: "require('kafkajs')", type: import }
```

### Snippets + patterns

**confluent-kafka (Python):**
```python
producer.produce("invoice-events", value=payload, key=k)
consumer.subscribe(["invoice-events"])
```
```yaml
patterns:
  - regex: "\\.produce\\(\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: producer
  - regex: "\\.subscribe\\(\\s*\\[\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: consumer
```

**segmentio/kafka-go (Go):** topic is a **struct field**, not a call argument — needs a window over the config struct.
```go
w := kafka.NewWriter(kafka.WriterConfig{ Brokers: ..., Topic: "invoice-events" })
r := kafka.NewReader(kafka.ReaderConfig{ Brokers: ..., Topic: "invoice-events", GroupID: "billing" })
```
```yaml
patterns:
  # WriterConfig{... Topic: "t" ...} -> producer ; ReaderConfig{... Topic: "t" ...} -> consumer
  - regex: "NewWriter\\([\\s\\S]{0,200}?Topic:\\s*[\"`]([^\"`]+)[\"`]"
    name_group: 1
    role: producer
    window: 8
  - regex: "NewReader\\([\\s\\S]{0,200}?Topic:\\s*[\"`]([^\"`]+)[\"`]"
    name_group: 1
    role: consumer
    window: 8
```

**kafkajs (Node):** producer topic is an **object property** on `send({ topic })`, often on its own line — window required (confirmed via KafkaJS docs).
```js
await producer.send({ topic: "invoice-events", messages: [...] });
await consumer.subscribe({ topic: "invoice-events", fromBeginning: true });
```
```yaml
patterns:
  # producer.send({ topic: 't' }) — topic property within the object
  - regex: "\\.send\\(\\s*\\{[\\s\\S]{0,120}?topic\\s*:\\s*[`'\"]([^`'\"]+)[`'\"]"
    name_group: 1
    role: producer
    window: 4
  # consumer.subscribe({ topic: 't' })
  - regex: "\\.subscribe\\(\\s*\\{[\\s\\S]{0,120}?topic\\s*:\\s*[`'\"]([^`'\"]+)[`'\"]"
    name_group: 1
    role: consumer
    window: 4
```
**Match:** topic string equality across producer/consumer. **Gotchas:** kafka-go `Topic` field may be set on a separate assignment (`cfg.Topic = ...`) → add a `\\.Topic\\s*=\\s*[\"`]...` variant. kafkajs `send` collides with many `.send` calls — kafkajs marker gate is essential. confluent `.subscribe([...])` can list many topics; capture only the first literal (precision) or iterate the array literal.

---

## B6. AWS SQS (SDK, cross-language)

The queue is identified by **QueueUrl** (`https://sqs.<region>.amazonaws.com/<acct>/<queue-name>`) or a `QueueName`. The **last path segment of the QueueUrl is the queue name** — that is the join key.

### Markers
```yaml
markers:
  - { pattern: "@aws-sdk/client-sqs", type: import }      # Node v3
  - { pattern: "aws-sdk", type: import }                   # Node v2
  - { pattern: "import boto3", type: import }              # Python
  - { pattern: "software.amazon.awssdk.services.sqs", type: import }  # Java v2
  - { pattern: "aws/aws-sdk-go", type: import }             # Go
```
### Snippets + patterns
```python
sqs.send_message(QueueUrl=url, MessageBody=body)            # producer
resp = sqs.receive_message(QueueUrl=url, MaxNumberOfMessages=10)  # consumer
```
```js
await client.send(new SendMessageCommand({ QueueUrl: url, MessageBody: body }));
await client.send(new ReceiveMessageCommand({ QueueUrl: url }));
```
```yaml
patterns:
  # PRODUCER: any SendMessage* with a literal QueueUrl/queue_url -> capture last path segment downstream
  - regex: "(?:SendMessage|send_message)[\\s\\S]{0,160}?[Qq]ueue[_]?[Uu]rl\\s*[:=]\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: producer
    window: 6
  # CONSUMER: ReceiveMessage* with literal QueueUrl
  - regex: "(?:ReceiveMessage|receive_message)[\\s\\S]{0,160}?[Qq]ueue[_]?[Uu]rl\\s*[:=]\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: consumer
    window: 6
```
**Name capture:** literal QueueUrl → **post-process to last `/` segment** = queue name. **Gotchas:** QueueUrl is almost always a **variable** resolved at runtime (`get_queue_url` / env / Terraform output) → inline literals are rare; expect **mostly variable URLs → low/medium confidence**, resolve the queue name from IaC (`aws_sqs_queue "name"`) cross-referencing. SDK call shapes differ wildly across languages/versions; the windowed `Send/Receive...QueueUrl` proximity pattern is the most portable but noisy. **Flag SQS as medium-reliability.**

---

## B7. GCP Pub/Sub

Identified by **topic** (publish) and **subscription** (subscribe); both encode `projects/<p>/topics/<t>` or a short id.

### Markers
```yaml
markers:
  - { pattern: "@google-cloud/pubsub", type: import }       # Node
  - { pattern: "from google.cloud import pubsub", type: import }  # Python
  - { pattern: "cloud.google.com/go/pubsub", type: import } # Go
  - { pattern: "com.google.cloud.pubsub", type: import }    # Java
```
### Snippets + patterns
```python
publisher.publish(topic_path, data=payload)            # topic_path = topic_path(project, "invoice-events")
subscriber.subscribe(subscription_path, callback=cb)
```
```js
await pubsub.topic("invoice-events").publishMessage({ data });
pubsub.subscription("invoice-events-sub").on("message", cb);
```
```yaml
patterns:
  # Node producer: .topic('name').publish...
  - regex: "\\.topic\\(\\s*[`'\"]([^`'\"]+)[`'\"]\\s*\\)"
    name_group: 1
    role: producer
  # Node consumer: .subscription('name')
  - regex: "\\.subscription\\(\\s*[`'\"]([^`'\"]+)[`'\"]\\s*\\)"
    name_group: 1
    role: consumer
  # Python: topic_path(project, 'name') / subscription_path(project, 'name')
  - regex: "topic_path\\([^,]+,\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: producer
  - regex: "subscription_path\\([^,]+,\\s*[\"']([^\"']+)[\"']"
    name_group: 1
    role: consumer
```
**Name capture:** the literal topic/subscription id. **Match:** producer topic ↔ subscription's bound topic (subscription→topic binding lives in IaC/console; a naming convention like `<topic>-sub` is a **heuristic** medium-confidence link). **Gotchas:** fully-qualified `projects/p/topics/t` → take last segment. Topic/subscription often built from env/config → medium.

---

## B8. NATS

Identified by **subject** string (publish / subscribe / queue-subscribe).

### Markers
```yaml
markers:
  - { pattern: "from 'nats'", type: import }               # Node
  - { pattern: "github.com/nats-io/nats.go", type: import }# Go
  - { pattern: "import nats", type: import }               # Python (nats-py)
  - { pattern: "io.nats.client", type: import }            # Java
```
### Snippets + patterns
```go
nc.Publish("invoice.created", payload)                 // producer
nc.Subscribe("invoice.created", handler)               // consumer
nc.QueueSubscribe("invoice.created", "billing", handler)
```
```yaml
patterns:
  - regex: "\\.(?:Publish|publish)\\(\\s*[\"'`]([^\"'`]+)[\"'`]"
    name_group: 1
    role: producer
  - regex: "\\.(?:Subscribe|subscribe|QueueSubscribe|queueSubscribe)\\(\\s*[\"'`]([^\"'`]+)[\"'`]"
    name_group: 1
    role: consumer
```
**Name capture:** 1st arg subject literal. **Match:** subject equality (NATS subjects support wildcards `*`/`>`; a subscribe wildcard `invoice.*` matches many publish subjects → expand to a prefix-match at medium confidence). **Gotchas:** `.publish`/`.subscribe` are extremely generic verbs → NATS marker gate mandatory; even then, collisions with EventEmitter/Redis are likely. **Flag NATS as medium-reliability** purely due to verb-name collisions.

---

## B9. Redis Streams / BullMQ (Node)

### Markers
```yaml
markers:
  - { pattern: "from 'bullmq'", type: import }
  - { pattern: "require('bullmq')", type: import }
  - { pattern: "ioredis", type: import }                   # Redis Streams via XADD/XREAD
```
### Snippets + patterns
```js
// BullMQ — queue name is the Queue/Worker constructor 1st arg
const queue = new Queue("invoice-jobs", { connection });
await queue.add("created", payload);
const worker = new Worker("invoice-jobs", async job => { ... }, { connection });
// Redis Streams
await redis.xadd("invoice-stream", "*", "data", payload);   // producer
await redis.xread("BLOCK", 0, "STREAMS", "invoice-stream", "$"); // consumer
```
```yaml
patterns:
  # BullMQ producer: new Queue('name')
  - regex: "new Queue\\(\\s*[`'\"]([^`'\"]+)[`'\"]"
    name_group: 1
    role: producer
  # BullMQ consumer: new Worker('name', ...)
  - regex: "new Worker\\(\\s*[`'\"]([^`'\"]+)[`'\"]"
    name_group: 1
    role: consumer
  # Redis Streams producer: xadd('stream', ...)
  - regex: "\\.xadd\\(\\s*[`'\"]([^`'\"]+)[`'\"]"
    name_group: 1
    role: producer
  # Redis Streams consumer: xread(...'STREAMS','stream'...) / xreadgroup
  - regex: "\\.xreadgroup?\\([\\s\\S]{0,120}?[`'\"]([^`'\"]+)[`'\"]\\s*,\\s*[`'\"][$>0-9-]+[`'\"]"
    name_group: 1
    role: consumer
    window: 3
```
**Name capture:** BullMQ Queue/Worker name (constructor 1st arg) — **clean, the strongest queue signal in Part B after Spring AMQP**; Redis stream key (xadd 1st arg). **Match:** BullMQ `Queue(name)` ↔ `Worker(name)` string equality is reliable. **Gotchas:** BullMQ queue names commonly in a shared constant → constant-resolution pass. Raw `xread` arg order is positional and awkward (`STREAMS` keyword then keys then IDs); the consumer regex is fragile — prefer `xreadgroup` and accept lower recall.

---

# PART C — Cross-service edge resolution

Two detected sites become an edge when their normalized targets match. Below: the normalization algorithm, the service-name resolution ladder, queue matching, and confidence assignment.

## C1. Path-parameter normalization algorithm

Goal: `/users/{id}` (server, Spring) ↔ `/users/${userId}` (client, JS template) ↔ `/users/:id` (client, express-style) ↔ `/users/{userId:\\d+}` (Spring constraint) all normalize to one canonical form so a client path matches a server route.

**Algorithm `normalizePath(p)`:**
1. **Strip scheme+host** if present: `http://svc/api/x` → `/api/x` (host handled separately in C2).
2. **Strip query/fragment:** drop everything from the first `?` or `#`.
3. **Collapse slashes:** replace `//+` with `/`; ensure a single leading `/`; strip a trailing `/` (except root).
4. **Canonicalize every path segment that is a parameter** to the sentinel `{}`:
   - `{name}` and `{name:regex}` (Spring/JAX-RS, drop the `:constraint`) → `{}`
   - `:name` (express/rails/koa) → `{}`
   - `${expr}` / `{{expr}}` (JS template / mustache) → `{}`
   - `<name>` / `<int:name>` (Flask/Django path converters; drop converter prefix) → `{}`
   - `[name]` / `[...name]` (Next.js-style) → `{}`
   - A bare segment that is purely a host-language interpolation with no literal (e.g. the whole segment was `${userId}`) → `{}`
5. **Lowercase** the literal (non-parameter) segments for case-insensitive host conventions? **No** — keep literal-segment case (paths are case-sensitive); only parameter segments are sentinelized.
6. Result: a string like `/api/users/{}/orders/{}`. Two paths **match** iff their normalized strings are equal **after also equalizing the host/service** (C2).

> Parameter **names are intentionally discarded** — `{id}` vs `${userId}` must match, so only *position* and *literal segments* matter. This is the key insight: normalize parameters to a nameless sentinel.

**Edge cases:** trailing optional segments and splat/catch-all (`/**`, `/*path`, `/{*rest}`) normalize the catch-all token to `{*}`; a client path is a match if it shares the literal prefix before the catch-all. Matrix params / regex-heavy segments → medium confidence.

## C2. Service-name resolution ladder (host/target side)

Resolve a client call's target to a concrete service id, in priority order (highest confidence first):

1. **Feign `name=` / declarative client name** → maps directly to the target module's `spring.application.name` (look it up in the callee's `application.yml`/`application.properties` / `bootstrap.yml`). **Highest confidence** — explicit, no parsing.
2. **k8s / mesh DNS host** — `http://settings-service/...` or `http://settings-service.namespace.svc.cluster.local/...`. Take the **first DNS label** (`settings-service`) → match against the set of known service names (deployment/service manifests, or `spring.application.name` values). High confidence when the label exactly equals a known service id.
3. **Service-name constant / variable** — `BILLING_SVC + "/x"`, `billingBaseUrl`. Resolve the symbol by a same-file literal assignment; if it resolves to a host matching case 2, promote to that. Medium until resolved.
4. **Config-key indirection** — `${seed-loader.url}/x` (Spring placeholder), `process.env.BILLING_URL`, `cfg.BillingURL`. Resolve the key against config files / env manifests / Helm values / Terraform; the resolved value re-enters at case 1 or 2. Medium; high if the config value is a literal in-repo and resolves to a known service.
5. **Raw hostname / FQDN literal** — `http://billing.internal.acme.com/x`. Match the host (or its first label) to a service by hostname convention. Medium.
6. **Unresolvable** (pure runtime construction, no literal host or name) → **do not emit an edge** (precision bias). Optionally record a "dangling client call" with the path only, for reporting.

**Service identity source of truth:** build a registry mapping `{spring.application.name, k8s service name, Feign client name, hostname}` → canonical service node, harvested from the repo's manifests + each module's app config. The detectors emit `(host-or-name, normalizedPath, method)`; resolution joins against this registry.

## C3. Queue / topic matching

A producer site and a consumer site form a message edge when their **name strings** match under these rules:

- **Same-name equality** (default): producer name == consumer name.
  - Spring AMQP: producer `convertAndSend(routingKey)` (2nd arg of 3-arg form, or sole arg of 2-arg default-exchange form) ↔ consumer `@RabbitListener(queues = name)`. Match when `routingKey == queues` (the default/direct-exchange-with-identity-binding case). **High** when string-equal.
  - Kafka / Pub/Sub / NATS / BullMQ / Redis Streams: producer topic/subject/stream == consumer topic/subject/stream. **High** (Kafka & BullMQ have no routing indirection).
- **Exchange + routing-key → queue binding indirection** (RabbitMQ non-default exchange): producer emits `(exchange, routingKey)`; consumer listens on `queue`; the link is a `Binding` (`@Bean Binding` / `BindingBuilder.bind(queue).to(exchange).with(routingKey)` / IaC). When `routingKey != queue`, resolve the binding declaration; if a binding `exchange+routingKey→queue` exists, emit the edge at **high**; if no binding is found in-repo, emit at **medium** keyed on the routing-key/queue name similarity.
- **Constant resolution:** when either side is a `static final String` / `const` identifier rather than a literal, resolve the constant to its literal value first (same package/module), then apply equality. Resolved → same confidence as literal; unresolved → medium.
- **Wildcards:** NATS `invoice.*` / Kafka topic patterns / AMQP topic-exchange `invoice.#` — treat the wildcard side as a prefix/glob; a concrete producer subject matching the consumer glob → **medium**.
- **AWS SQS / Pub/Sub subscription→topic:** the queue *name* is the last path segment of the QueueUrl / the `projects/p/topics/t` tail. Pub/Sub subscription↔topic binding is external (IaC); naming-convention links (`<topic>-sub`) are **medium**.

## C4. Confidence levels (summary)

| Confidence | HTTP edge | Queue edge |
|---|---|---|
| **High** | Feign `name=` → matched `spring.application.name`; OR literal k8s-DNS host whose first label == known service, with normalized path equal to a detected endpoint. | Literal (or resolved-constant) names equal on both sides; or binding declaration found connecting exchange+routingKey→queue. |
| **Medium** | Host via resolved config-key/env/variable; OR path-only heuristic (path matches an endpoint but host is unresolved); OR cross-file baseURL. | Constant unresolved; routing-key≠queue with no in-repo binding; wildcard/glob subject match; SQS/PubSub name via IaC convention. |
| **Low / skip** | No literal host AND no name/config handle (pure runtime URL) → **skip** (no edge). | Name is pure runtime/SpEL/interpolation → **skip**. |

**Emission rule:** only High and Medium edges are emitted; Medium edges carry a `confidence: medium` tag and the resolution path (`via: feign-name | k8s-dns | config-key:<k> | path-heuristic | binding | name-convention`) for auditability. Low/unresolved are dropped or recorded as dangling for reporting, never as edges.

---

# Reliability triage — where marker-based detection is too unreliable (scope-out flags)

| Framework | Status | Reason |
|---|---|---|
| **Java Feign** | ★ Strongest | Service named in annotation; near-deterministic. Build first. |
| **Spring RestTemplate / WebClient** | Good with caveats | URL is often a variable/`baseUrl` set elsewhere → host resolution is the weak link, but the verb+path capture is solid. |
| **Spring AMQP / Spring Kafka** | ★ Strong | Consumer annotation is clean; producer call is clean. **Constant-resolution pass is required** to hit real codebases (names are usually `static final String`s). |
| axios / fetch / got / requests / httpx / Guzzle / reqwest / net-http / resty / Faraday / HttpClient | Good (precision-biased) | Inline-literal captures are reliable; template/f-string/interpolated and config-driven hosts degrade to medium/skip by design. Broad receivers (`x.get(...)`) demand the import-marker gate. |
| **AWS SQS** | ⚠️ Medium-reliability — partial scope | QueueUrl is almost always runtime/env/IaC, rarely an inline literal; cross-language SDK shapes diverge. Capture only literal QueueUrls; resolve names from Terraform `aws_sqs_queue`. Don't expect high recall. |
| **NATS** | ⚠️ Medium-reliability | `.publish` / `.subscribe` verb names collide heavily with EventEmitter/Redis/other pub-sub; even with the marker gate, false positives are likely. Subject wildcards add ambiguity. Scope as best-effort. |
| **GCP Pub/Sub subscription↔topic** | ⚠️ Partial | Publish-topic and subscribe-subscription are capturable, but the **subscription→topic binding is external** (IaC/console); the producer↔consumer edge relies on naming convention → medium only. |
| **Redis raw Streams (`xread`/`xreadgroup`)** | ⚠️ Low recall | Positional arg soup; fragile regex. BullMQ (`new Queue`/`new Worker`) is reliable; raw Streams is not — prefer BullMQ, treat raw Streams as best-effort. |
| **GraphQL / gRPC / SOAP service calls** | Out of scope (not requested) | Different shape (no REST verb+path); flag for a separate detector family if needed later. |

**Cross-cutting scope-out:** any call where the URL/queue name is produced by pure runtime composition (string concatenation across functions, builder objects configured via DI in another module, values read from a remote config server at runtime) is **not** marker-detectable with acceptable precision — emit nothing rather than guess.

## Sources
- [Spring Cloud OpenFeign reference](https://docs.spring.io/spring-cloud-openfeign/reference/spring-cloud-openfeign.html)
- [Baeldung — Introduction to Spring Cloud OpenFeign](https://www.baeldung.com/spring-cloud-openfeign)
- [Baeldung — RabbitMQ Message Dispatching with Spring AMQP](https://www.baeldung.com/rabbitmq-spring-amqp)
- [Spring AMQP — Sending Messages](https://docs.spring.io/spring-amqp/reference/amqp/sending-messages.html)
- [KafkaJS — Producing Messages](https://kafka.js.org/docs/producing) and [Consuming Messages](https://kafka.js.org/docs/consuming)
