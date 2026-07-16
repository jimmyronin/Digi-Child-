import sqlite3
import json
import os

# Allow the database path to be overridden via environment variable.
# On Render, set DIGICHILD_DB_PATH=/data/digichild.db (persistent disk mount).
DB_PATH = os.environ.get("DIGICHILD_DB_PATH", "digichild.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS session_state (
            id INTEGER PRIMARY KEY,
            child_id TEXT UNIQUE,
            day INTEGER,
            child_age INTEGER,
            temperament TEXT,
            consecutive_mistreatments INTEGER,
            trust INTEGER,
            curiosity INTEGER,
            logic INTEGER,
            security INTEGER,
            autonomy INTEGER,
            volatility INTEGER,
            temperament_profile TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS interaction_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            child_id TEXT,
            day INTEGER,
            location TEXT,
            parent_message TEXT,
            treatment TEXT,
            child_response TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS clinician_session (
            session_id TEXT PRIMARY KEY,
            parent_id TEXT,
            clinician_id TEXT,
            monitor_id TEXT,
            scheduled_time TEXT,
            status TEXT,
            parent_availability TEXT,
            clinician_availability TEXT,
            monitor_availability TEXT,
            state_json_snapshot TEXT,
            temperament_profile TEXT,
            child_age INTEGER
        )
    ''')
    # column migrations for databases created before these features existed
    _ensure_column(cursor, "interaction_history", "tone_note", "TEXT")
    _ensure_column(cursor, "interaction_history", "tone_aggression", "REAL")
    _ensure_column(cursor, "clinician_session", "parent_name", "TEXT")
    _ensure_column(cursor, "clinician_session", "parent_situation", "TEXT")
    _ensure_column(cursor, "clinician_session", "esl", "INTEGER")
    conn.commit()
    conn.close()


def _ensure_column(cursor, table, column, coltype):
    try:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
    except sqlite3.OperationalError:
        pass  # already exists

def get_state(child_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM session_state WHERE child_id = ?", (child_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return dict(row)
    
    # Default initial state
    default_state = {
        "child_id": child_id,
        "day": 5,
        "child_age": 5,
        "temperament": "neutral",
        "consecutive_mistreatments": 0,
        "trust": 64,
        "curiosity": 78,
        "logic": 41,
        "security": 68,
        "autonomy": 27,
        "volatility": 22,
        "temperament_profile": "cooperative"
    }
    save_state(child_id, default_state)
    return default_state

def save_state(child_id, state):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO session_state (
            child_id, day, child_age, temperament, consecutive_mistreatments,
            trust, curiosity, logic, security, autonomy, volatility, temperament_profile
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(child_id) DO UPDATE SET
            day=excluded.day,
            child_age=excluded.child_age,
            temperament=excluded.temperament,
            consecutive_mistreatments=excluded.consecutive_mistreatments,
            trust=excluded.trust,
            curiosity=excluded.curiosity,
            logic=excluded.logic,
            security=excluded.security,
            autonomy=excluded.autonomy,
            volatility=excluded.volatility,
            temperament_profile=excluded.temperament_profile
    ''', (
        child_id, state["day"], state["child_age"], state["temperament"],
        state.get("consecutive_mistreatments", 0),
        state["trust"], state["curiosity"], state["logic"],
        state["security"], state["autonomy"], state["volatility"],
        state.get("temperament_profile", "cooperative")
    ))
    conn.commit()
    conn.close()

def log_interaction(child_id, day, location, parent_message, treatment, child_response,
                    tone_note="", tone_aggression=0.0):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO interaction_history (child_id, day, location, parent_message, treatment,
                                         child_response, tone_note, tone_aggression)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (child_id, day, location, parent_message, treatment, child_response,
          tone_note or "", float(tone_aggression or 0.0)))
    conn.commit()
    conn.close()

def get_recent_history(child_id, limit=5):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT parent_message, child_response 
        FROM interaction_history 
        WHERE child_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
    ''', (child_id, limit))
    rows = cursor.fetchall()
    conn.close()
    
    history = []
    for row in reversed(rows):
        history.append({"parent": row["parent_message"], "mira": row["child_response"]})
    return history

def get_history_with_tone(child_id, limit=20):
    """Clinician-console history: every turn WITH its vocal-tone reading, so
    tone flags (incongruence, aggression, clarifications) survive into review."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT parent_message, child_response, treatment, tone_note, tone_aggression, timestamp
        FROM interaction_history
        WHERE child_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
    ''', (child_id, limit))
    rows = cursor.fetchall()
    conn.close()

    history = []
    for row in reversed(rows):
        history.append({
            "parent": row["parent_message"],
            "mira": row["child_response"],
            "treatment": row["treatment"],
            "toneNote": row["tone_note"] or "",
            "toneAggression": row["tone_aggression"] or 0.0,
            "time": row["timestamp"],
        })
    return history

def create_session(session_id, parent_id, clinician_id, monitor_id, parent_avail, clinician_avail, monitor_avail, temperament_profile="cooperative", child_age=5):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE clinician_session ADD COLUMN child_age INTEGER")
    except sqlite3.OperationalError:
        pass
    cursor.execute('''
        INSERT OR REPLACE INTO clinician_session (
            session_id, parent_id, clinician_id, monitor_id, status,
            parent_availability, clinician_availability, monitor_availability, temperament_profile, child_age
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        session_id, parent_id, clinician_id, monitor_id, "pending_outreach",
        json.dumps(parent_avail), json.dumps(clinician_avail), json.dumps(monitor_avail), temperament_profile, child_age
    ))
    conn.commit()
    conn.close()

def get_session(session_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE clinician_session ADD COLUMN child_age INTEGER")
    except sqlite3.OperationalError:
        pass
    cursor.execute("SELECT * FROM clinician_session WHERE session_id = ?", (session_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        d = dict(row)
        d["parent_availability"] = json.loads(d["parent_availability"] or "[]")
        d["clinician_availability"] = json.loads(d["clinician_availability"] or "[]")
        d["monitor_availability"] = json.loads(d["monitor_availability"] or "[]")
        try:
            d["parent_situation"] = json.loads(d.get("parent_situation") or "{}")
        except (TypeError, ValueError):
            d["parent_situation"] = {}
        if d.get("child_age") is None:
            d["child_age"] = 5
        return d
    return None

def update_session(session_id, **kwargs):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    fields = []
    values = []
    for k, v in kwargs.items():
        fields.append(f"{k} = ?")
        if isinstance(v, (list, dict)):
            values.append(json.dumps(v))
        else:
            values.append(v)
    values.append(session_id)
    cursor.execute(f"UPDATE clinician_session SET {', '.join(fields)} WHERE session_id = ?", tuple(values))
    conn.commit()
    conn.close()

def list_all_sessions():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM clinician_session ORDER BY scheduled_time DESC")
    rows = cursor.fetchall()
    conn.close()
    sessions = []
    for row in rows:
        d = dict(row)
        d["parent_availability"] = json.loads(d["parent_availability"] or "[]")
        d["clinician_availability"] = json.loads(d["clinician_availability"] or "[]")
        d["monitor_availability"] = json.loads(d["monitor_availability"] or "[]")
        try:
            d["parent_situation"] = json.loads(d.get("parent_situation") or "{}")
        except (TypeError, ValueError):
            d["parent_situation"] = {}
        sessions.append(d)
    return sessions

init_db()
