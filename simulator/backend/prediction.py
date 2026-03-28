"""
WiFi-based congestion prediction module.

Uses SQLite for persistent post storage and a time-based prediction
algorithm that blends hardcoded base patterns with real user submissions.
"""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ── Constants ────────────────────────────────────────────────────────────

JST = timezone(timedelta(hours=9))
DB_PATH = Path(__file__).parent / "crowd_data.db"

LOCATION_NAMES = {
    1: "アロハカフェ",
    2: "キッチンカー（セントラル前）",
    3: "AITプラザ",
    4: "四号館売店",
    5: "キッチンカー（四号館前）",
    6: "愛和会館",
    7: "セントラル食堂",
}

CROWD_LABELS = {1: "空いている", 2: "普通", 3: "混雑"}

# ── Base Patterns ────────────────────────────────────────────────────────
# BASE_PATTERNS[location_id][day_of_week][hour] = expected level (1.0-3.0)
# day_of_week: 0=Mon .. 6=Sun
# Weekdays (0-4) share patterns; weekends (5-6) are lighter.


def _weekday_curve(peak: float, peak_hour: int = 12, spread: float = 1.5) -> Dict[int, float]:
    """Generate a bell-curve-ish congestion pattern for a weekday."""
    curve = {}
    for h in range(24):
        if h < 7 or h > 20:
            curve[h] = 1.0
        else:
            dist = abs(h - peak_hour)
            val = peak - (peak - 1.0) * min(dist / spread, 1.0) ** 0.8
            curve[h] = round(max(1.0, min(3.0, val)), 2)
    return curve


def _weekend_curve(peak: float, peak_hour: int = 12) -> Dict[int, float]:
    """Lighter weekend curve."""
    base = _weekday_curve(peak * 0.6, peak_hour, spread=2.0)
    return {h: round(max(1.0, v * 0.7), 2) for h, v in base.items()}


def _build_base_patterns() -> Dict[int, Dict[int, Dict[int, float]]]:
    """Build the full base pattern matrix."""
    # (peak_level, peak_hour, spread) per location
    location_profiles = {
        1: (2.5, 12, 1.5),   # アロハカフェ – moderate, peaks at noon
        2: (2.8, 12, 1.0),   # キッチンカー（セントラル前）– sharp noon peak
        3: (2.9, 12, 2.0),   # AITプラザ – high, broad peak
        4: (2.3, 12, 1.5),   # 四号館売店 – moderate
        5: (2.6, 12, 1.0),   # キッチンカー（四号館前）– sharp peak
        6: (2.4, 13, 2.0),   # 愛和会館 – slightly later peak
        7: (2.7, 12, 2.0),   # セントラル食堂 – high, broad
    }

    patterns: Dict[int, Dict[int, Dict[int, float]]] = {}
    for loc_id, (peak, peak_h, spread) in location_profiles.items():
        patterns[loc_id] = {}
        for dow in range(7):
            if dow < 5:  # weekday
                patterns[loc_id][dow] = _weekday_curve(peak, peak_h, spread)
            else:  # weekend
                patterns[loc_id][dow] = _weekend_curve(peak, peak_h)
    return patterns


BASE_PATTERNS = _build_base_patterns()

# ── SQLite ───────────────────────────────────────────────────────────────

_db_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("""
            CREATE TABLE IF NOT EXISTS crowd_posts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                location_id INTEGER NOT NULL,
                level       INTEGER NOT NULL,
                comment     TEXT    DEFAULT '',
                day_of_week INTEGER NOT NULL,
                time_slot   INTEGER NOT NULL,
                created_at  TEXT    DEFAULT (datetime('now','localtime'))
            )
        """)
        _conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_loc_dow_hour
            ON crowd_posts(location_id, day_of_week, time_slot)
        """)
        _conn.commit()
    return _conn


# ── Data Access ──────────────────────────────────────────────────────────

def save_post(location_id: int, level: int, comment: str = "") -> Dict[str, Any]:
    """Save a crowd post and return the inserted record."""
    now = datetime.now(JST)
    dow = now.weekday()
    hour = now.hour

    with _db_lock:
        conn = _get_conn()
        cur = conn.execute(
            """INSERT INTO crowd_posts (location_id, level, comment, day_of_week, time_slot, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (location_id, level, comment, dow, hour, now.strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
        row_id = cur.lastrowid

    return {
        "id": row_id,
        "location_id": location_id,
        "level": level,
        "comment": comment,
        "day_of_week": dow,
        "time_slot": hour,
        "created_at": now.strftime("%Y-%m-%d %H:%M:%S"),
    }


def get_recent_posts(location_id: Optional[int] = None, limit: int = 20) -> List[Dict[str, Any]]:
    """Return recent posts, optionally filtered by location."""
    with _db_lock:
        conn = _get_conn()
        if location_id is not None:
            rows = conn.execute(
                "SELECT * FROM crowd_posts WHERE location_id = ? ORDER BY id DESC LIMIT ?",
                (location_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM crowd_posts ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()

    return [
        {
            "id": r["id"],
            "location_id": r["location_id"],
            "level": r["level"],
            "comment": r["comment"],
            "day_of_week": r["day_of_week"],
            "time_slot": r["time_slot"],
            "created_at": r["created_at"],
            "location_name": LOCATION_NAMES.get(r["location_id"], "不明"),
            "level_label": CROWD_LABELS.get(r["level"], "不明"),
        }
        for r in rows
    ]


# ── Prediction ───────────────────────────────────────────────────────────

def get_prediction(
    location_id: int,
    day_of_week: Optional[int] = None,
    hour: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Predict congestion for a location at a given day/hour.
    Defaults to current JST time.
    """
    now = datetime.now(JST)
    if day_of_week is None:
        day_of_week = now.weekday()
    if hour is None:
        hour = now.hour

    # Base pattern value
    base = BASE_PATTERNS.get(location_id, {}).get(day_of_week, {}).get(hour, 1.5)

    # Query real data: exact hour + adjacent hours with half weight
    with _db_lock:
        conn = _get_conn()
        # Exact match
        rows_exact = conn.execute(
            """SELECT level FROM crowd_posts
               WHERE location_id = ? AND day_of_week = ? AND time_slot = ?""",
            (location_id, day_of_week, hour),
        ).fetchall()
        # Adjacent hours
        adj_hours = [(hour - 1) % 24, (hour + 1) % 24]
        rows_adj = conn.execute(
            """SELECT level FROM crowd_posts
               WHERE location_id = ? AND day_of_week = ? AND time_slot IN (?, ?)""",
            (location_id, day_of_week, adj_hours[0], adj_hours[1]),
        ).fetchall()

    # Weighted average of real data
    weights = [1.0] * len(rows_exact) + [0.5] * len(rows_adj)
    values = [r["level"] for r in rows_exact] + [r["level"] for r in rows_adj]

    if values:
        total_weight = sum(weights)
        real_avg = sum(v * w for v, w in zip(values, weights)) / total_weight
        data_points = len(rows_exact) + len(rows_adj)
        alpha = min(len(rows_exact) / 20.0, 0.9)
        predicted = alpha * real_avg + (1.0 - alpha) * base
    else:
        predicted = base
        data_points = 0

    predicted = round(max(1.0, min(3.0, predicted)), 2)

    # Map to label
    if predicted <= 1.5:
        label = "空いている"
        level_int = 1
    elif predicted <= 2.3:
        label = "普通"
        level_int = 2
    else:
        label = "混雑"
        level_int = 3

    return {
        "location_id": location_id,
        "location_name": LOCATION_NAMES.get(location_id, "不明"),
        "predicted_level": predicted,
        "level_int": level_int,
        "label": label,
        "data_points": data_points,
        "day_of_week": day_of_week,
        "hour": hour,
    }


def get_all_predictions(
    day_of_week: Optional[int] = None,
    hour: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Return predictions for all 7 locations."""
    return [get_prediction(loc_id, day_of_week, hour) for loc_id in range(1, 8)]
