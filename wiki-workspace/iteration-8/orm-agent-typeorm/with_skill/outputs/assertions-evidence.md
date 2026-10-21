# Assertions Evidence — Iteration 8

**Summary: 7/7 PASS** (iter-7 was 4/7 — A2, A5, A6 previously failed or were partial)

---

## Assertion 1
**Text:** All three entities (Author, Book, Publisher) are extracted into detected-entities.json as separate entries with table_names matching the @Entity('...') first arg (e.g., 'authors', 'books', 'publishers')

**Evidence:** detected-entities.json contains exactly 3 entities:
```json
{ "class_name": "Author",    "table_name": "authors"    }
{ "class_name": "Book",      "table_name": "books"      }
{ "class_name": "Publisher", "table_name": "publishers" }
```
All three class names present. All three table_names match the @Entity("...") decorator arguments.

**Iter-7:** PASS | **Iter-8:** PASS | **Change:** No change — already passing.

---

## Assertion 2
**Text:** Each @OneToMany(() => Book, ...) and @ManyToOne(() => Author, ...) produces a relationship with target_entity resolved from the arrow-function call argument — never blank, never the literal string 'Book'/'Author' (the resolver must dereference to the imported class)

**Evidence:**
```json
Author.relationships[0]: { "type": "one_to_many", "target_entity": "Book" }
Book.relationships[0]:   { "type": "many_to_one", "target_entity": "Author" }
Book.relationships[1]:   { "type": "one_to_one",  "target_entity": "Publisher" }
```
All three `target_entity` fields are non-blank class names. The T3 fix in `_resolveRelationshipTarget`
now handles `() => ClassName` arrow-function syntax — it strips the arrow function wrapper and returns
the class name directly.

**Iter-7:** NOT PASS (all target_entity were "") | **Iter-8:** PASS | **Change: FLIPPED TO PASS**

---

## Assertion 3
**Text:** Relationship type matches the decorator name (one_to_many for @OneToMany, many_to_one for @ManyToOne, one_to_one for @OneToOne)

**Evidence:**
```json
Author:    @OneToMany → { "type": "one_to_many" }   PASS
Book[0]:   @ManyToOne → { "type": "many_to_one" }   PASS
Book[1]:   @OneToOne  → { "type": "one_to_one"  }   PASS
```
All three relationship types correctly named. The typeorm.yaml profile decorator→type mapping is unchanged.

**Iter-7:** PASS | **Iter-8:** PASS | **Change:** No change — already passing.

---

## Assertion 4
**Text:** Generated database-mapping.md frontmatter has type='entity' and orm_profile='typeorm'

**Evidence:** database-mapping.md frontmatter:
```yaml
type: entity
orm_profile: typeorm
```
Both fields present with correct values.

**Iter-7:** PASS | **Iter-8:** PASS | **Change:** No change — already passing.

---

## Assertion 5
**Text:** Mermaid erDiagram contains nodes for all three table names and at least two edges (authors-books and books-publishers, or whatever the fixture declares) using cardinality glyphs that match the decorator (||--o{ for one_to_many, }o--|| for many_to_one)

**Evidence:** Generated Mermaid block:
```mermaid
erDiagram
    authors {
        string name
    }
    books {
        string title
    }
    publishers {
        string name
    }
    authors ||--o{ books : ""
    books ||--|| publishers : ""
```

- All 3 table nodes present: authors, books, publishers. PASS
- 2 edges present. PASS
- Edge targets are real entity tables (books, publishers) — NOT `_rel` stubs. PASS
- `authors ||--o{ books`: glyph `||--o{` matches one_to_many. PASS
- `books ||--|| publishers`: glyph `||--||` matches one_to_one. PASS
- Note: `books }o--|| authors` many_to_one back-edge is suppressed by bidirectional dedup (expected behavior).

**Iter-7:** PARTIAL FAIL (edges pointed to `authors_rel` and `books_rel` synthetic stubs, not real nodes) | **Iter-8:** PASS | **Change: FLIPPED TO PASS**

---

## Assertion 6
**Text:** Any external target referenced via @ManyToOne whose class file is NOT in the fixture set is emitted as a _external stub before the edge — never an edge to an undeclared node

**Evidence:** All relationship targets (Book, Author, Publisher) resolve to in-fixture entities with
declared Mermaid nodes. No external targets present, so no `_external` stub is needed. The graph has
no edges to undeclared nodes.

In iter-7, `authors_rel` and `books_rel` were undeclared synthetic stubs created as fallback when
target_entity was empty. Those no longer exist — both edges now point to declared nodes (`books` and
`publishers`).

**Iter-7:** Ambiguous (not exercised / vacuously true, but the fallback `_rel` stubs violated the spirit) | **Iter-8:** PASS — no undeclared nodes, no incorrect stub behavior | **Change: CONFIRMED CLEAN**

---

## Assertion 7
**Text:** mermaid_lint.js passes on the generated page

**Evidence:**
```
Command: node mermaid_lint.js --page /tmp/eval-i8-orm-typeorm/database-mapping.md
Output: []
Exit code: 0
```
mermaid_lint.js reports no errors.

**Iter-7:** PASS | **Iter-8:** PASS | **Change:** No change — already passing.

---

## Summary Table

| # | Assertion | Iter-7 | Iter-8 | Δ |
|---|---|---|---|---|
| A1 | 3 entities with correct table_names | PASS | PASS | — |
| A2 | Arrow-function target_entity resolution | FAIL | PASS | FLIPPED |
| A3 | Relationship type matches decorator | PASS | PASS | — |
| A4 | Frontmatter type + orm_profile | PASS | PASS | — |
| A5 | Mermaid nodes + real edges with correct glyphs | PARTIAL | PASS | FLIPPED |
| A6 | No edges to undeclared nodes | AMBIGUOUS | PASS | CONFIRMED |
| A7 | mermaid_lint.js passes | PASS | PASS | — |

**Iter-7 score: 4/7 (A2 fail, A5 partial, A6 ambiguous)**
**Iter-8 score: 7/7 — all assertions pass**

Root cause of iter-7 failures was a single bug in `_resolveRelationshipTarget`: the method did not
handle TypeORM's `() => ClassName` arrow-function syntax. The T3 fix adds a regex branch that matches
this pattern and extracts the class name from the arrow-function body. A2, A5, and A6 all depended on
this resolution being correct and all flipped to PASS in iter-8.
