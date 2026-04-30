from sqlalchemy import Column, Integer, String, ForeignKey, Float, Table
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

user_roles = Table(
    "user_roles", Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id")),
    Column("role_id", Integer, ForeignKey("roles.id")),
)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String, nullable=False, unique=True)
    email = Column(String)

    orders = relationship("Order", back_populates="user")
    roles = relationship("Role", secondary=user_roles)

class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    total_amount = Column(Float)
    user_id = Column(Integer, ForeignKey("users.id"))

    user = relationship("User", back_populates="orders")

class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
