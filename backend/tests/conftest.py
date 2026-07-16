"""Shared test setup for the Digi-Child backend suite.

Three things MUST happen before any backend module is imported, because
database.py resolves DB_PATH and claude_ai.py reads AI_MODE at module level:

  1. sys.path gets the backend/ directory, so `import main` works from tests/.
  2. DIGICHILD_DB_PATH points at a throwaway file, so tests never read or
     corrupt the real dev database.
  3. DIGICHILD_AI=local forces demo mode. This keeps the suite hermetic: no API
     key, no network, no spend, and deterministic results in CI. Every assertion
     below therefore tests OUR logic, not Claude's output.
"""

import os
import pathlib
import sys
import tempfile
import uuid

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

_TMP_DIR = pathlib.Path(tempfile.mkdtemp(prefix="digichild-tests-"))
os.environ["DIGICHILD_DB_PATH"] = str(_TMP_DIR / "test.db")
os.environ["DIGICHILD_AI"] = "local"


@pytest.fixture
def child_id():
    """A unique child id per test, so simulation state never bleeds between tests."""
    return f"test-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    import main

    return TestClient(main.app)


def interact_payload(child_id, message, tone=None, **overrides):
    """Build a valid /api/interact body; `tone` may be a partial dict."""
    body = {
        "message": message,
        "day": 5,
        "year": 5,
        "ageBand": "Age 5-7",
        "mode": "home",
        "location": "home",
        "values": {"trust": 64, "curiosity": 78, "logic": 41,
                   "security": 68, "autonomy": 27, "volatility": 22},
        "session": {"childId": child_id, "runId": "test"},
    }
    if tone is not None:
        full_tone = {"source": "voice", "aggression": 0.0, "volume": 0.5, "peak": 0.5,
                     "pitch": 200.0, "pitchVar": 30.0, "sharpness": 0.3,
                     "wordsPerSec": 2.5, "esl": False}
        full_tone.update(tone)
        body["tone"] = full_tone
    body.update(overrides)
    return body
