# Class bodies check

Grep results from `after.md` confirming method/attribute placement per class.

## `classDiagram` directive
Line 8: `classDiagram`  — directive present as first token of mermaid block

## class Animal (lines 9–12)
Line 9:  `    class Animal {`
Line 10: `        +name: string`
Line 11: `        +eat()`
Line 12: (closing `}`)

## class Dog (lines 13–15)
Line 13: `    class Dog {`
Line 14: `        +bark()`
Line 15: (closing `}`)

## class Cat (lines 16–18)
Line 16: `    class Cat {`
Line 17: `        +meow()`
Line 18: (closing `}`)

## Cross-contamination check
- `bark()` appears only inside the Dog block (line 14) — not under Animal or Cat
- `meow()` appears only inside the Cat block (line 17) — not under Animal or Dog
- `name: string` and `eat()` appear only inside the Animal block (lines 10–11) — not under Dog or Cat

RESULT: No crossed attributes/methods. Each class body contains exactly its declared members.
