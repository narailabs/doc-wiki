"""Wiki Database Agent — shared library for safe database access.

Public API:
    from wiki_db import query, get_schema, enable_audit, disable_audit
    from wiki_db.policy import check_query, Decision
    from wiki_db.environments import get_environment, list_environments
"""
