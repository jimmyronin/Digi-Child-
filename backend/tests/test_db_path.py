"""The database path crash-guard.

DIGICHILD_DB_PATH points at a Render persistent disk, but disks require a paid
instance. On the free tier /data does not exist, and because init_db() runs at
import, an unopenable path would stop uvicorn booting and take the ENTIRE API
down over what is only a persistence concern. These tests pin the rule:
never crash; fall back and log.
"""

import importlib

import database


def _resolve(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("DIGICHILD_DB_PATH", raising=False)
    else:
        monkeypatch.setenv("DIGICHILD_DB_PATH", value)
    return database._resolve_db_path()


def test_unwritable_path_falls_back_instead_of_crashing(monkeypatch, capsys, tmp_path):
    """The free-Render case: the mount point cannot be created.

    A regular FILE is placed where a directory would need to be, which fails
    identically on Windows and Linux -- unlike a Unix-only path such as /proc,
    which Windows would happily create.
    """
    blocker = tmp_path / "blocker"
    blocker.write_text("a file, not a directory")
    bad = str(blocker / "data" / "digichild.db")

    resolved = _resolve(monkeypatch, bad)

    assert resolved != bad, "an unusable path must not be handed to sqlite"
    assert resolved.endswith("digichild.db")
    # the operator must be told why persistence is off, not left guessing
    assert "not writable" in capsys.readouterr().out


def test_unset_path_uses_a_local_file(monkeypatch):
    resolved = _resolve(monkeypatch, None)
    assert resolved.endswith("digichild.db")


def test_empty_path_is_treated_as_unset(monkeypatch):
    # an env var present but blank must not be passed to sqlite as ""
    assert _resolve(monkeypatch, "").endswith("digichild.db")


def test_a_writable_path_is_honoured(monkeypatch, tmp_path):
    """The paid case: when a disk really is mounted, use it -- so persistence
    starts working automatically if one is ever attached, with no code change."""
    target = tmp_path / "disk" / "digichild.db"
    resolved = _resolve(monkeypatch, str(target))
    assert resolved == str(target)
    assert target.parent.exists(), "the mount directory should be created"


def test_resolution_never_raises(monkeypatch):
    """Whatever garbage is configured, import must survive.

    (A null byte is deliberately not tested: the OS rejects it at setenv, so the
    value can never reach us in the first place.)
    """
    for junk in ["", "   ", "/", "relative/path.db", ".", "C:", "//?/nope"]:
        monkeypatch.setenv("DIGICHILD_DB_PATH", junk)
        resolved = database._resolve_db_path()
        assert isinstance(resolved, str) and resolved


def test_module_import_yields_a_usable_db():
    importlib.reload(database)
    assert isinstance(database.DB_PATH, str) and database.DB_PATH
