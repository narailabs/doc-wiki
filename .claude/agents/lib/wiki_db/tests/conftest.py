"""Shared fixtures for wiki_db tests."""
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

# Add the lib directory to path so wiki_db is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
