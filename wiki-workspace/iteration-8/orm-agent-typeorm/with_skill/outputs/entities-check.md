# Entities Check

All 3 entities extracted correctly with matching table_names.

| class_name | table_name | @Entity argument | Match |
|---|---|---|---|
| Author | authors | @Entity("authors") | PASS |
| Book | books | @Entity("books") | PASS |
| Publisher | publishers | @Entity("publishers") | PASS |

Columns detected:
- Author: name (string)
- Book: title (string)
- Publisher: name (string)

Source: detected-entities.json — 3 top-level entries under `entities[]`.
