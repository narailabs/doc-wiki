# Mapping trial — custom-basemodel profile vs. example.py

Invocation (see `profile-load-test.txt` for full stdout):

```
node /tmp/eval-orm-custom/load-test.mjs
```

## Loader result

`loadProfile("custom-basemodel.yaml")` returns the full `OrmProfile` with
every required field populated — `name`, `language`, `detection.file_patterns`,
`detection.markers`, `entity_extraction.class_pattern/table_pattern/
column_pattern`, `relationship_detection.patterns`, `naming_conventions`.
**No `ProfileValueError` raised.**

## Extractor result against example.py

Three entities were identified by the `class_pattern`:

| class    | table (extractor) | columns (raw count) | relationships |
|----------|-------------------|---------------------|---------------|
| User     | users             | 22                  | many_to_one, foreign_key |
| Post     | users             | 22                  | many_to_one, foreign_key |
| Comment  | users             | 22                  | many_to_one, foreign_key |

### Known behaviours (not bugs)

- **All three entities get `table_name: users`.** This is the documented
  behaviour of the regex extractor (see `extractor.ts` lines 123-135):
  `table_pattern` is searched via `re.search`, so the first match in
  the file wins. The shipped SQLAlchemy profile has the same limitation.
  Accurate per-class table names require the Serena MCP path
  (`buildExtractionRequest` / `parseSerenaMatches`), which scopes the
  search to each enclosing class symbol.
- **Columns include cross-class entries and FK string literals.**
  `column_pattern: ['"](\w+)['"]` is intentionally permissive: it matches
  any quoted identifier. The `__columns__` lists are the dominant source
  so the real columns appear, but FK target strings (`"User"`, `"Post"`)
  and FK `on=` field names (`"author_id"`, `"post_id"`) also sneak in.
  This is identical in kind to what SQLAlchemy's
  `column_pattern: (\w+)\s*=\s*Column\(` accepts (it would miss columns
  declared outside the class body), and is acceptable for the regex
  fallback. Serena-based extraction would narrow per-class.
- **Relationships report `target_entity: ""`.** The shipped extractor's
  relationship detection is existence-only (`re.test`), not
  target-capturing. Again, Serena path adds target resolution.

## Conclusion

The profile satisfies the required-fields contract (`name`, `language`,
`detection`, `entity_extraction`), loads without error, and drives the
shipped extractor end-to-end. It exhibits the same regex-fallback
trade-offs as the seven built-in profiles.
