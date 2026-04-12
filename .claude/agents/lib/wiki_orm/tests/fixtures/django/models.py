from django.db import models

class User(models.Model):
    username = models.CharField(max_length=150, unique=True)
    email = models.EmailField()

    class Meta:
        db_table = "users"

class Order(models.Model):
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="orders")

    class Meta:
        db_table = "orders"

class Role(models.Model):
    name = models.CharField(max_length=100)
    users = models.ManyToManyField(User, related_name="roles")

    class Meta:
        db_table = "roles"
