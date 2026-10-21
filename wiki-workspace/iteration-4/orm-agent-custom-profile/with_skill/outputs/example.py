"""Fixture: three BaseModel classes, each with its OWN __table__ and __columns__.

Defined sequentially with ForeignKey references so the extractor must window
table_pattern / column_pattern / relationship_patterns per-class — the R3 fix.
"""


class BaseModel:
    """Minimal base class used by this custom ORM."""
    pass


class User(BaseModel):
    __table__ = "users"
    __columns__ = ["id", "email", "name", "created_at"]

    id = "integer primary key"
    email = "varchar unique"
    name = "varchar"
    created_at = "timestamp"


class Post(BaseModel):
    __table__ = "posts"
    __columns__ = ["id", "title", "body", "author_id"]

    id = "integer primary key"
    title = "varchar"
    body = "text"
    author_id = ForeignKey("users.id")


class Comment(BaseModel):
    __table__ = "comments"
    __columns__ = ["id", "post_id", "author_id", "body"]

    id = "integer primary key"
    post_id = ForeignKey("posts.id")
    author_id = ForeignKey("users.id")
    body = "text"
