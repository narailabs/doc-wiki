"""Custom ORM fixture — three BaseModel classes with different __table__ values.

Tests per-class windowing — each class has its own __table__ assignment, and
the extractor must yield 3 distinct table names (NOT collapse all 3 to the
first one).
"""


class BaseModel:
    """Custom ORM base class — every concrete entity inherits from this."""
    __table__ = ""


class Customer(BaseModel):
    __table__ = "customers"

    id = Column("id")
    email = Column("email")
    name = Column("name")

    addresses = has_many("Address")


class Address(BaseModel):
    __table__ = "customer_addresses"

    id = Column("id")
    customer_id = Column("customer_id")
    line1 = Column("line1")
    city = Column("city")

    customer = belongs_to("Customer")


class Invoice(BaseModel):
    __table__ = "billing_invoices"

    id = Column("id")
    customer_id = Column("customer_id")
    total_cents = Column("total_cents")
    issued_at = Column("issued_at")

    customer = belongs_to("Customer")
