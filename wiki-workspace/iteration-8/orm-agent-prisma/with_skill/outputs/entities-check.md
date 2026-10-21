# Entities Check — orm-agent-prisma (iter-8)

Source: `detected-entities.json`

| class_name | table_name | fixture @@map | match? |
|---|---|---|---|
| User | users | `@@map("users")` | YES |
| Post | posts | `@@map("posts")` | YES |
| Comment | comments | `@@map("comments")` | YES |

All 3 entities extracted. All `table_name` values match the `@@map(...)` declarations in the fixture.
