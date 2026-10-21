"""Fixture — three BaseModel classes, each with a different __table__."""


class ForeignKey:
    def __init__(self, target, on):
        self.target = target
        self.on = on


class BaseModel:
    __table__ = ""
    __columns__ = []


class User(BaseModel):
    __table__ = "users"
    __columns__ = ["id", "email", "created_at"]


class Post(BaseModel):
    __table__ = "posts"
    __columns__ = ["id", "user_id", "title", "body", "created_at"]
    related = ForeignKey("User", on="user_id")


class Comment(BaseModel):
    __table__ = "comments"
    __columns__ = ["id", "post_id", "author", "body", "created_at"]
    related = ForeignKey("Post", on="post_id")
