"""Tests for wiki_db.credentials module."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from wiki_db.credentials import (
    EnvVarCredentialProvider,
    FileCredentialProvider,
    get_credentials,
)


# ---------- helpers ----------
def _write_creds_file(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data))


# ---------- 1. file_provider_reads_json ----------
def test_file_provider_reads_json(tmp_path: Path):
    creds_file = tmp_path / "creds.json"
    _write_creds_file(creds_file, {
        "db-dev": {"username": "admin", "password": "s3cret"},
    })
    provider = FileCredentialProvider(str(creds_file))
    user, pw = provider.get("dev")
    assert user == "admin"
    assert pw == "s3cret"


# ---------- 2. file_provider_returns_tuple ----------
def test_file_provider_returns_tuple(tmp_path: Path):
    creds_file = tmp_path / "creds.json"
    _write_creds_file(creds_file, {
        "db-dev": {"username": "u", "password": "p"},
    })
    provider = FileCredentialProvider(str(creds_file))
    result = provider.get("dev")
    assert isinstance(result, tuple)
    assert len(result) == 2


# ---------- 3. file_provider_missing_file ----------
def test_file_provider_missing_file():
    provider = FileCredentialProvider("/no/such/file.json")
    with pytest.raises(FileNotFoundError):
        provider.get("dev")


# ---------- 4. file_provider_missing_key ----------
def test_file_provider_missing_key(tmp_path: Path):
    creds_file = tmp_path / "creds.json"
    _write_creds_file(creds_file, {
        "db-dev": {"username": "u", "password": "p"},
    })
    provider = FileCredentialProvider(str(creds_file))
    with pytest.raises(KeyError):
        provider.get("staging")


# ---------- 5. file_provider_per_env_keys ----------
def test_file_provider_per_env_keys(tmp_path: Path):
    creds_file = tmp_path / "creds.json"
    _write_creds_file(creds_file, {
        "db-dev": {"username": "dev_user", "password": "dev_pw"},
        "db-prod": {"username": "prod_user", "password": "prod_pw"},
    })
    provider = FileCredentialProvider(str(creds_file))
    assert provider.get("dev") == ("dev_user", "dev_pw")
    assert provider.get("prod") == ("prod_user", "prod_pw")


# ---------- 6. env_var_provider ----------
def test_env_var_provider(monkeypatch):
    monkeypatch.setenv("WIKI_DB_DEV_USER", "env_user")
    monkeypatch.setenv("WIKI_DB_DEV_PASSWORD", "env_pass")
    provider = EnvVarCredentialProvider()
    assert provider.get("dev") == ("env_user", "env_pass")


# ---------- 7. env_var_missing_var ----------
def test_env_var_missing_var(monkeypatch):
    monkeypatch.delenv("WIKI_DB_DEV_USER", raising=False)
    monkeypatch.delenv("WIKI_DB_DEV_PASSWORD", raising=False)
    provider = EnvVarCredentialProvider()
    with pytest.raises(EnvironmentError):
        provider.get("dev")


# ---------- 8. get_credentials_dispatches ----------
def test_get_credentials_dispatches(monkeypatch):
    monkeypatch.setenv("WIKI_DB_CI_USER", "ci_u")
    monkeypatch.setenv("WIKI_DB_CI_PASSWORD", "ci_p")
    user, pw = get_credentials("ci", provider="env")
    assert (user, pw) == ("ci_u", "ci_p")


# ---------- 9. default_provider_is_file ----------
def test_default_provider_is_file(tmp_path: Path, monkeypatch):
    creds_file = tmp_path / "creds.json"
    _write_creds_file(creds_file, {
        "db-local": {"username": "loc_u", "password": "loc_p"},
    })
    monkeypatch.setattr(
        "wiki_db.credentials._DEFAULT_CREDS_PATH", str(creds_file)
    )
    user, pw = get_credentials("local")
    assert (user, pw) == ("loc_u", "loc_p")
