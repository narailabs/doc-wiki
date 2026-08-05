# Assertions evidence

## Assertion 1: Generated block starts with the `classDiagram` directive

Evidence: `after.md` line 8 contains `classDiagram` as the first token inside the
` ```mermaid ` fence. The line is directly after the `%% Title: Class Hierarchy` comment
and the opening ` ```mermaid ` fence.

```
Line 7:  ```mermaid
Line 8:  classDiagram
```

grep result: `8:classDiagram` — PASS

---

## Assertion 2: All three classes (Animal, Dog, Cat) declared as separate `class Foo { ... }` blocks

Evidence: Three separate `class X { }` blocks found in `after.md`:

```
Line 9:  class Animal {
Line 13: class Dog {
Line 16: class Cat {
```

All three blocks closed with `}`. Each is a separate declaration. — PASS

---

## Assertion 3: Each class body lists its declared methods and attributes; no method under wrong class

Evidence from grep on `after.md`:

Animal block (lines 9–12):
  - `+name: string` (line 10) — correct, Animal attribute
  - `+eat()` (line 11) — correct, Animal method

Dog block (lines 13–15):
  - `+bark()` (line 14) — correct, Dog method only

Cat block (lines 16–18):
  - `+meow()` (line 17) — correct, Cat method only

Cross-contamination: None found. `bark()` only at line 14 (Dog), `meow()` only at line 17 (Cat),
`name: string` and `eat()` only at lines 10–11 (Animal). — PASS

---

## Assertion 4: Inheritance rendered as `Animal <|-- Dog` and `Animal <|-- Cat` (correct `<|--` glyph)

Evidence from grep on `after.md`:

```
Line 19: Animal <|-- Dog
Line 20: Animal <|-- Cat
```

Wrong glyphs (`<--`, `--|>`) — absent (grep returned nothing).
Correct glyph `<|--` used for both inheritance relationships. — PASS

---

## Assertion 5: Block injected BETWEEN markers; content outside markers preserved byte-for-byte

Evidence:

Marker positions in `after.md`:
  - `<!-- wiki-mermaid: start -->` — line 5 (exactly once)
  - `<!-- wiki-mermaid: end -->` — line 22 (exactly once)

The mermaid block (lines 6–21) is entirely between these markers. No EOF append.

Outside-markers content comparison (before.md vs after.md, excluding inter-marker content):
  Both have identical 8 lines including preamble "# Class hierarchy", "Some preamble text.",
  markers themselves, blank line, and "Post-marker text that must be preserved byte-for-byte."

Result: IDENTICAL — no diff. — PASS

---

## Assertion 6: mermaid_lint.js passes on the resulting page

Evidence:

Command: `node mermaid_lint.js --page /tmp/eval-i7-class-hierarchy/class-hierarchy.md`
Output: `[]`
Exit code: 0

`[]` means zero lint issues. The classDiagram block has a valid diagram type and balanced
brackets `{ }`. — PASS
