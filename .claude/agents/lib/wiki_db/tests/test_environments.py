"""Tests for wiki_db.environments module."""
from __future__ import annotations

import pytest

from wiki_db.environments import (
    EnvironmentConfig,
    clear_environments,
    get_environment,
    list_environments,
    register_environment,
)


@pytest.fixture(autouse=True)
def _clean_registry():
    """Ensure a clean registry for every test."""
    clear_environments()
    yield
    clear_environments()


# ---------- 1. register_environment ----------
def test_register_environment():
    register_environment("dev", host="localhost", port=5432, database="wiki_dev")
    env = get_environment("dev")
    assert isinstance(env, EnvironmentConfig)
    assert env.host == "localhost"
    assert env.port == 5432
    assert env.database == "wiki_dev"


# ---------- 2. list_environments ----------
def test_list_environments():
    register_environment("dev", host="localhost", port=5432, database="wiki_dev")
    register_environment("staging", host="staging-db", port=5432, database="wiki_stg")
    names = list_environments()
    assert sorted(names) == ["dev", "staging"]


# ---------- 3. get_environment ----------
def test_get_environment():
    register_environment("prod", host="prod-db", port=5432, database="wiki_prod")
    env = get_environment("prod")
    assert env.host == "prod-db"
    assert env.database == "wiki_prod"


# ---------- 4. get_missing_raises ----------
def test_get_missing_raises():
    with pytest.raises(KeyError):
        get_environment("nonexistent")


# ---------- 5. default_approval_mode ----------
def test_default_approval_mode():
    register_environment("dev", host="localhost", port=5432, database="wiki_dev")
    env = get_environment("dev")
    assert env.approval_mode == "auto"


# ---------- 6. register_with_all_modes ----------
@pytest.mark.parametrize(
    "mode",
    ["auto", "confirm-once", "confirm-each", "grant-required"],
)
def test_register_with_all_modes(mode: str):
    register_environment(
        "test", host="localhost", port=5432, database="db", approval_mode=mode
    )
    env = get_environment("test")
    assert env.approval_mode == mode
    clear_environments()


# ---------- 7. invalid_mode_raises ----------
def test_invalid_mode_raises():
    with pytest.raises(ValueError, match="approval_mode"):
        register_environment(
            "dev",
            host="localhost",
            port=5432,
            database="wiki_dev",
            approval_mode="yolo",
        )


# ---------- 8. clear_environments ----------
def test_clear_environments():
    register_environment("dev", host="localhost", port=5432, database="wiki_dev")
    assert len(list_environments()) == 1
    clear_environments()
    assert list_environments() == []
