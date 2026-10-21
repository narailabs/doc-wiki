# Q&A transcript: custom BaseModel ORM profile

Simulated onboarding to produce `custom-basemodel.yaml` for a hand-rolled
Python ORM that uses a `BaseModel` superclass and per-class `__table__` /
`__columns__` attributes.

---

**Q1.** What language is your ORM written in, and what should we call this
profile?

> Python. Call it `custom-basemodel`.

**Q2.** What file glob(s) should the profile scan?

> Standard Python: `**/*.py`.

**Q3.** How do we *detect* that a codebase uses this ORM? Give me three to
four literal substrings we can look for in file contents.

> - `class BaseModel`  (the base-class declaration we inherit from)
> - `__table__`        (table-mapping class attribute)
> - `__columns__`      (the declared columns list)
> - `ForeignKey(`      (how we declare FK relationships)

**Q4.** Entity extraction — what regex identifies one entity class?

> Entities are classes whose ONLY base is `BaseModel`. One capture group for
> the class name:
>
> ```regex
> class\s+(\w+)\s*\(\s*BaseModel\s*\)
> ```

**Q5.** And the table name?

> Every entity has a `__table__ = "..."` assignment. Keep it simple:
>
> ```regex
> __table__\s*=\s*["'](\w+)["']
> ```
>
> This is a straightforward pattern that matches every `__table__`
> occurrence in the file. We deliberately do NOT try to sneak in a
> class-name anchor or lookbehind — we rely on the extractor's per-class
> windowing (R3) to scope each match to the right class.

**Q6.** Column pattern?

> Columns are `field = "…"` lines at the class body's 4-space indent. Since
> the extractor runs this with the `g` flag (no multiline), anchor with an
> explicit newline:
>
> ```regex
> \n {4}(\w+)\s*=
> ```

**Q7.** Relationship pattern(s)?

> One style only for this ORM — foreign keys declared via `ForeignKey(...)`
> as field values.
>
> ```regex
> ForeignKey\(
> ```
>
> Tagged `type: foreign_key`.

**Q8.** Naming conventions — how do class names map to table names, and
field names to column names?

> - `table_from_class: snake_case_plural`  (`BlogPost` → `blog_posts`)
> - `column_from_field: snake_case`        (`createdAt` → `created_at`)

**Q9.** Anything else for the `description` field?

> `"Custom BaseModel ORM using __table__ class attribute and __columns__ list"`.

---

That covers all five required top-level fields (`name`, `language`,
`description`, `detection`, `entity_extraction`) plus
`relationship_detection` and `naming_conventions`. The generated YAML is in
`custom-basemodel.yaml`.
