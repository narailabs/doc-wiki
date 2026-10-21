from django.db import models


class Article(models.Model):
    title = models.CharField(max_length=200)
    body = models.TextField()
    published_at = models.DateTimeField()

    class Meta:
        db_table = 'articles'

    def __str__(self):
        return self.title


class Author(models.Model):
    name = models.CharField(max_length=100)
    bio = models.TextField(blank=True)

    class Meta:
        db_table = 'authors'

    def __str__(self):
        return self.name
