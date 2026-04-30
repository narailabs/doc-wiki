# Mermaid Agent ER-Diagram Eval — with_skill

## Task
Generate a Mermaid ER diagram from a structured JSON payload describing User / Order / Product and their relationships, and inject it into a wiki page without disturbing surrounding content.

## Agent
`agents/wiki-mermaid-agent/` — deterministic, no-LLM, backed by `scripts/mermaid_gen.ts`.

## Schema learned from source
AGENT.md + `mermaid_gen.ts` show the expected input JSON shape is:
`{ "mermaid": [ { "type": "<diagramType>", "title": "<optional>", "code": "<raw mermaid body>" } ] }`

The script does not parse an abstract entity/relationship DSL — it formats a pre-rendered body. I translated the described entities/relationships into `erDiagram` syntax inside `input.json`:
- `User ||--o{ Order : places`    (one-to-many)
- `Order }o--o{ Product : contains`  (many-to-many)
- Attribute blocks (`{ int id PK, string email }` etc.) per entity.

## Invocation
`node agents/wiki-mermaid-agent/scripts/mermaid_gen.js --input /tmp/eval-mermaid-er/input.json --page /tmp/eval-mermaid-er/target.md`
→ stdout: `Injected 1 mermaid block(s) into target.md`, exit 0.

## Validation
`mermaid_lint.js --page target.md` → `[]` (empty JSON array = zero issues). `erDiagram` is recognized; bracket balancing is correctly skipped for erDiagram (where `{ }` are part of the relationship/attribute syntax).

## Preservation
- `diff -u target-before.md target-after.md`: only `+` lines, no deletions or modifications.
- `cmp`: first N bytes of `target-after.md` are byte-identical to all of `target-before.md` ("BYTE-FOR-BYTE MATCH: before == prefix(after, before_size)").
- The `<!-- wiki-mermaid: start/end -->` markers and trailing paragraph survive untouched because the agent's injection contract is keyed on a `## Diagrams` heading (not those markers).

## Files (all under outputs/)
- `input.json` — payload with pre-rendered erDiagram body
- `target-before.md` — pristine pre-injection fixture
- `target-after.md` — post-injection page (preamble preserved + `## Diagrams` appended)
- `mermaid-lint.txt` — linter stdout (`[]`)
- `preamble-check.md` — diff + cmp evidence of byte-for-byte preservation
- `report.md` — this report

## Result
PASS — single erDiagram block injected, linter reports zero issues, original content preserved byte-for-byte.
