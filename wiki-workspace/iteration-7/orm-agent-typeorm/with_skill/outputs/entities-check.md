# Entities Check

Three entities extracted from detected-entities.json:

| class_name | table_name | Expected table | Match? |
|---|---|---|---|
| Author | authors | authors | YES |
| Book | books | books | YES |
| Publisher | publishers | publishers | YES |

All three entities present with correct table_names matching @Entity("...") first arg.

## Raw JSON evidence

```json
[
  { "class_name": "Author",    "table_name": "authors"    },
  { "class_name": "Book",      "table_name": "books"      },
  { "class_name": "Publisher", "table_name": "publishers" }
]
```
