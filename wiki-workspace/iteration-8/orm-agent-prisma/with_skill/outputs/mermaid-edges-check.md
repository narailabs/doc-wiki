# Mermaid Edges Check — orm-agent-prisma (iter-8)

Source: `database-mapping.md` (erDiagram block)

## Actual Mermaid block

```
erDiagram
    users ||--o{ posts : ""
    posts ||--o{ comments : ""
```

## Edge verification

| Required edge | Present? |
|---|---|
| `users ||--o{ posts` | YES |
| `posts ||--o{ comments` | YES |

Both required cardinality edges are present. Nodes use real table names (`users`, `posts`, `comments`)
derived from `@@map(...)` values — NOT the model names (User, Post, Comment).

## Comparison to Iter-7

In iter-7 the Mermaid block was:

```
erDiagram
    users ||--o{ users_rel : ""
    posts ||--o{ posts_rel : ""
    comments ||--o{ comments_rel : ""
```

Targets were synthetic `_rel` stubs because `target_entity` was empty and the output renderer
fell back to generating a placeholder. In iter-8:
- `users_rel` → replaced by real `posts`
- `posts_rel` → replaced by real `comments`
- `comments_rel` → stub removed entirely (Comment has no one_to_many relationship)

NO `_rel` stubs remain in the output.
