"""Vercel Python function for the Flask REST API."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from api import app  # noqa: E402
