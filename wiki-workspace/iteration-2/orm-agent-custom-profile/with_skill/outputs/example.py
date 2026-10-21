# Example project using a custom in-house ORM with BaseModel classes.
#
# The ORM convention:
# - Entity classes inherit from BaseModel.
# - An assignment to the dunder table attribute declares the physical table name.
# - An assignment to the dunder columns attribute lists column names.
# - A class attribute set to a foreign-key helper declares a relationship.

from orm.base import BaseModel, ForeignKey


class User(BaseModel):
    __table__ = "users"
    __columns__ = ["id", "email", "display_name", "created_at"]

    # No outgoing FKs for users in this example.


class Post(BaseModel):
    __table__ = "posts"
    __columns__ = ["id", "author_id", "title", "body", "published_at"]

    author = ForeignKey("User", on="author_id")


class Comment(BaseModel):
    __table__ = "comments"
    __columns__ = ["id", "post_id", "author_id", "body"]

    post = ForeignKey("Post", on="post_id")
    author = ForeignKey("User", on="author_id")
