# class_pattern capture — proof

Evidence that `entity_extraction.class_pattern` has a **single capture
group** that matches **all three** BaseModel class names in
`example.py`.

## Pattern (as stored in YAML)

```
class\s+(\w+)\s*\(\s*BaseModel\s*\)
```

- Exactly one `(...)` group: `(\w+)` captures the class identifier.
- Anchored to `class` keyword + whitespace, followed by an open paren and
  `BaseModel` parent class (with optional whitespace around it).

## Run

```js
const re = new RegExp('class\\s+(\\w+)\\s*\\(\\s*BaseModel\\s*\\)', 'gm');
const content = fs.readFileSync('/tmp/eval-i3-orm-custom/example.py','utf-8');
let m; const captures = [];
while ((m = re.exec(content)) !== null) captures.push({ full: m[0], capture: m[1], index: m.index });
```

## Output

```json
[
  { "full": "class User(BaseModel)",    "capture": "User",    "index": 241 },
  { "full": "class Post(BaseModel)",    "capture": "Post",    "index": 338 },
  { "full": "class Comment(BaseModel)", "capture": "Comment", "index": 501 }
]
```

## Assertions

- **3 matches.** Pattern fires on every `class X(BaseModel):` declaration.
- **Capture group 1 returns the class name literally** — `User`, `Post`,
  `Comment`.
- **Helper classes are excluded.** The fixture defines `class ForeignKey:`
  and `class BaseModel:` (no parent list and inheriting from `object`
  respectively); neither matches the pattern because both require
  `(BaseModel)` as the parent syntax.
- **Capture count = 1 per match** — the pattern has exactly one group, as
  required by `extractor.ts:111` (`const className = match[1]`).

```
n_captures = 3
names      = User, Post, Comment
n_groups   = 1  (single (\w+) group)
```
