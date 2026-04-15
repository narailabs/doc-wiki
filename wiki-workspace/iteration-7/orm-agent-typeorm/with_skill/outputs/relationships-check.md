# Relationships Check

## Summary

The extractor found all three relationship decorators with the correct type values. However, **target_entity is empty ("") for all relationships** because `_resolveRelationshipTarget` in extractor.ts does not handle TypeORM's arrow-function syntax `() => ClassName`.

## Raw JSON evidence

```json
Author relationships:
  { "type": "one_to_many", "target_entity": "" }
  -- Expected: target_entity = "Book"
  -- Source: @OneToMany(() => Book, (book) => book.author)

Book relationships:
  { "type": "many_to_one", "target_entity": "" }
  -- Expected: target_entity = "Author"
  -- Source: @ManyToOne(() => Author, (author) => author.books)

  { "type": "one_to_one", "target_entity": "" }
  -- Expected: target_entity = "Publisher"
  -- Source: @OneToOne(() => Publisher)

Publisher relationships:
  (none — correct, no relationship decorators in Publisher.ts)
```

## Root cause

The `_resolveRelationshipTarget(context)` function in extractor.ts receives the tail after the decorator's opening paren. For TypeORM:

  @OneToMany(() => Book, ...)
              ^--- tail starts here

The tail is: `() => Book, (book) => book.author)\n  books: Book[]`

The function tries three patterns in order:
1. Call first-arg: `^\s*(?:[:"'])?([A-Za-z_][\w.]*)` — fails because tail starts with `(`
2. Generic type `<Foo>`: no angle brackets in tail at this point
3. Simple field declaration: no `private/protected/public` keywords

None match, so target_entity is returned as "".

## Fix needed

Add pattern #0 (before the existing call-arg check) in `_resolveRelationshipTarget`:

```typescript
const arrowMatch = /^\s*\([^)]*\)\s*=>\s*([A-Z][A-Za-z_]\w*)\s*[,)]/.exec(context);
if (arrowMatch && arrowMatch[1]) {
  return arrowMatch[1];
}
```

This would match `() => Book,` and `() => Author,` and `() => Publisher)`.
