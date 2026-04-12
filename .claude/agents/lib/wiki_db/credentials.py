"""Credential providers for wiki_db."""
from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

_DEFAULT_CREDS_PATH: str = os.path.join(
    os.path.expanduser("~"), ".config", "wiki_db", "credentials.json"
)


class CredentialProvider(ABC):
    """Abstract base class for credential providers."""

    @abstractmethod
    def get(self, env: str) -> Tuple[str, str]:
        """Return (username, password) for the given environment."""


class FileCredentialProvider(CredentialProvider):
    """Read credentials from a JSON file.

    Expected format::

        {
            "db-<env>": {"username": "...", "password": "..."},
            ...
        }
    """

    def __init__(self, path: str) -> None:
        self._path = path

    def get(self, env: str) -> Tuple[str, str]:
        path = Path(self._path)
        if not path.exists():
            raise FileNotFoundError(f"Credentials file not found: {self._path}")
        data: Dict[str, Any] = json.loads(path.read_text())
        key = f"db-{env}"
        if key not in data:
            raise KeyError(f"No credentials found for environment {env!r} (key {key!r})")
        entry = data[key]
        return (entry["username"], entry["password"])


class EnvVarCredentialProvider(CredentialProvider):
    """Read credentials from WIKI_DB_{ENV}_USER / WIKI_DB_{ENV}_PASSWORD."""

    def get(self, env: str) -> Tuple[str, str]:
        env_upper = env.upper()
        user_var = f"WIKI_DB_{env_upper}_USER"
        pass_var = f"WIKI_DB_{env_upper}_PASSWORD"
        user = os.environ.get(user_var)
        password = os.environ.get(pass_var)
        if user is None or password is None:
            missing = [v for v in (user_var, pass_var)
                       if os.environ.get(v) is None]
            raise EnvironmentError(
                f"Missing environment variable(s): {', '.join(missing)}"
            )
        return (user, password)


def get_credentials(
    env: str,
    *,
    provider: str = "file",
    config: Optional[str] = None,
) -> Tuple[str, str]:
    """Convenience function to fetch credentials.

    Parameters
    ----------
    env:
        Environment name (e.g. "dev", "prod").
    provider:
        Either "file" (default) or "env".
    config:
        Path override for the file provider.
    """
    if provider == "env":
        return EnvVarCredentialProvider().get(env)
    # default: file
    path = config if config is not None else _DEFAULT_CREDS_PATH
    return FileCredentialProvider(path).get(env)
