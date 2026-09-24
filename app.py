"""Flask entrypoint for local development and Vercel."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))
from api import app  # noqa: E402
