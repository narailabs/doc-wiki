# Custom ORM Profile Scaffolding — Q&A Transcript

Simulated walkthrough between `wiki-orm-agent` (scaffold mode) and a user
adopting a custom in-house BaseModel ORM. The agent's questions follow the
fields declared in `OrmProfile` (see `.claude/agents/lib/wiki_orm/profiles.ts`
— required: `name`, `language`, `detection`, `entity_extraction`).

---

**Agent:** I can scaffold a custom ORM profile YAML for you. It will follow
the same shape as the seven built-in profiles under
`.claude/agents/lib/wiki_orm/profiles/`. A handful of questions to fill the
required fields.

**Q1. What short name should I use for this profile?** (Lowercase, no
spaces — this becomes the filename stem and the `name:` key.)

**User:** `custom-basemodel`

---

**Q2. What language is the ORM written in / scanned against?**

**User:** Python.

---

**Q3. One-line description?** (Shows up in the profile list, nothing more.)

**User:** "In-house BaseModel ORM — classes with `__table__` and
`__columns__` attributes plus `ForeignKey(...)` relationships."

---

**Q4. Which file globs should the detector scan?** (Built-in Django scans
`**/models.py`; SQLAlchemy scans `**/*.py`. If your entity classes live
anywhere in the codebase, `**/*.py` is the safe default.)

**User:** `**/*.py` — entities can be defined in any module under `src/`.

---

**Q5. Which literal substrings are reliable "this is our ORM" markers?**
(These are matched as substrings — not regex — for the detection score;
one or more marker matches in any scanned file causes the profile to be
considered a candidate.)

**User:**
- `BaseModel` (the base class import/inherit)
- `__table__` (the table-name attribute — unusual enough to be a strong
  signal; SQLAlchemy uses `__tablename__` with an "n")
- `__columns__` (the column-list attribute)
- `ForeignKey(` (our relationship helper; distinct from SQLAlchemy's
  `ForeignKey` because ours always takes a string class name plus `on=`)

---

**Q6. Regex for the entity class declaration? Must capture the class name
as group 1.** (Extractor runs this with `gm` flags — `re.MULTILINE` +
`finditer`.)

**User:** `class\s+(\w+)\s*\(\s*BaseModel\s*\)` — matches
`class User(BaseModel):`.

---

**Q7. Regex for the table name? Must capture the table string as group 1.**
(Extractor runs this with `s` flag — `re.DOTALL` + first `re.search`.)

**User:** `__table__\s*=\s*['"]([\w.]+)['"]` — matches
`__table__ = "users"`.

---

**Q8. Regex for columns? Group 1 captures the column name; extractor
loops over every match.**

**User:** Our columns live in a list literal, e.g.
`__columns__ = ["id", "email", ...]`. A single regex over each quoted
entry works: `['"](\w+)['"]\s*,?` restricted enough that we match
column strings. To avoid matching unrelated strings in the file, I'll
anchor on the list syntax and rely on `__columns__` being the marker
that scopes detection. Safer pattern:
`(?:__columns__\s*=\s*\[|,\s*)['"](\w+)['"]`.

On reflection, that still leaks into unrelated lists. Since each column
entry on its own line in our codebase uses `["id", "email", ...]`, and
the extractor loops over all matches in the file, I'll accept the small
false-positive risk (other quoted words inside `__columns__` only) and
use the simpler pattern that only fires inside the `__columns__` list
context:
`['"](\w+)['"]`. Scoped by the fact that real BaseModel files have one
`__columns__` assignment and little other string-list content.

Final choice: `['"](\w+)['"]` with a note that future Serena-based
extraction will narrow this via enclosing-symbol queries.

---

**Q9. Relationship patterns? Each becomes a `{pattern, type}` entry under
`relationship_detection.patterns`.** (Built-in types are `one_to_many`,
`many_to_one`, `one_to_one`, `many_to_many`, plus the generic
`relationship` and `foreign_key`.)

**User:** We only have one relationship primitive: `ForeignKey(...)`.
Semantically it's a many-to-one (the owning side). Map
`ForeignKey\(` to `many_to_one` and also keep a generic
`foreign_key` tag so downstream tooling matches the SQLAlchemy vocabulary.

---

**Q10. Naming conventions — when `__table__` is missing, how should the
mapper derive a table name from a class name?** (Built-ins: `snake_case`,
`snake_case_plural`, `lower_case`.)

**User:** `snake_case_plural` — our codebase uses `User` ↔ `users`,
`Post` ↔ `posts`, `Comment` ↔ `comments`. Column names are already
snake_case in the code, so `column_from_field: snake_case`.

---

**Agent:** Great — writing the profile now. You can drop it at either:
- `.claude/agents/lib/wiki_orm/profiles/custom-basemodel.yaml` (ships
  alongside the seven built-ins), or
- a project-local `wiki/profiles/custom-basemodel.yaml` if you want to
  keep it out of the shared library.

I'll verify it loads by calling `loadProfile()` from `profiles.js`.
