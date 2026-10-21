# Caching

Redis 7 sits in front of Postgres for hot keys. TTLs default to 60s for user-bound entries and 5 minutes for static catalog data.
