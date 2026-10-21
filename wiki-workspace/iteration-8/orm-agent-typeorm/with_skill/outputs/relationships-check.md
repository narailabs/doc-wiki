# Relationships Check — T3 Fix Confirmation

Arrow-function target resolution (`() => ClassName`) now produces non-blank `target_entity` values.

| Entity | Decorator | type | target_entity | Resolved? |
|---|---|---|---|---|
| Author | @OneToMany(() => Book, ...) | one_to_many | Book | PASS (was "" in iter-7) |
| Book | @ManyToOne(() => Author, ...) | many_to_one | Author | PASS (was "" in iter-7) |
| Book | @OneToOne(() => Publisher, ...) | one_to_one | Publisher | PASS (was "" in iter-7) |

The `_resolveRelationshipTarget` fix added handling for TypeORM's `() => ClassName` arrow-function
syntax. Previously the leading `(` caused the call-arg regex to fail and returned "". Now the
arrow-function body is extracted and the class name is returned correctly.

Source: detected-entities.json — entities[0].relationships[0], entities[1].relationships[0..1].
