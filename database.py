import sqlite3
import json

DB_PATH = "digichild.db"

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
            volatility INTEGER
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
    conn.commit()
    conn.close()

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
        "volatility": 22
    }
    save_state(child_id, default_state)
    return default_state

def save_state(child_id, state):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO session_state (
            child_id, day, child_age, temperament, consecutive_mistreatments,
            trust, curiosity, logic, security, autonomy, volatility
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            volatility=excluded.volatility
    ''', (
        child_id, state["day"], state["child_age"], state["temperament"],
        state.get("consecutive_mistreatments", 0),
        state["trust"], state["curiosity"], state["logic"],
        state["security"], state["autonomy"], state["volatility"]
    ))
    conn.commit()
    conn.close()

def log_interaction(child_id, day, location, parent_message, treatment, child_response):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO interaction_history (child_id, day, location, parent_message, treatment, child_response)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (child_id, day, location, parent_message, treatment, child_response))
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

init_db()
