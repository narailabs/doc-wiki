# Custom ORM Profile Q&A Flow

The agent walked the user through these questions. Answers in brackets are the
ones the user gave; they drive the YAML profile generated below.

## 1. Detection markers

**Q1.** What language is your ORM written in?
A: **python**

**Q2.** What file pattern(s) hold the entity classes?
A: `**/*.py`

**Q3.** Which substring(s) make a file "ORM-relevant" (used by detect_orm to
score the profile against fileContents)?
A:
- `class ` followed by `(BaseModel)` — base-class inheritance
- `__table__` — table-name attribute
- `Column(` — column declaration

## 2. Entity extraction patterns

**Q4.** What regex captures the entity class name? Single capture group
required by extractor.ts pass-1.
A: `^class\s+(\w+)\s*\(\s*BaseModel\s*\)\s*:`

**Q5.** What regex captures the table name from the class window? First
capture group is treated as the table name.
A: `__table__\s*=\s*['"]([\w.]+)['"]`

**Q6.** What regex captures column names within the class window?
A: `(\w+)\s*=\s*Column\(`

## 3. Relationships

**Q7.** What relationship shapes does your ORM use? Provide one regex per
relationship type, anchored at the call's open paren so the extractor's
tail-resolver can pick up the target class.
A:
- `has_many\(` → `one_to_many`
- `belongs_to\(` → `many_to_one`
- `has_one\(` → `one_to_one`

## 4. Naming conventions

**Q8.** When `__table__` is missing, how should the table name be inferred from
the class name?
A: **snake_case** (e.g., `MyModel` → `my_model`)

**Q9.** When `Column("...")` is missing, how should the column name be
inferred from the field name?
A: **snake_case**

## 5. Verification — per-class windowing

We confirmed against `example.py` (3 BaseModel classes — Customer, Address,
Invoice — with __table__ values "customers", "customer_addresses",
"billing_invoices") that:

- `class_pattern` matches all 3 class names.
- `table_pattern` is per-class-windowed (extractor.ts pass 2), so each entity
  receives its OWN __table__ value rather than collapsing to the first.

Verified by running the generated profile through `node orm_detect.js
--profile basemodel` against the fixture (see detected-entities.json).
