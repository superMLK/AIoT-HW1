"""SQLite-compatible persistence for local SQLite and remote Turso."""

import hashlib
import json
import os
import sqlite3
from itertools import islice
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "weather.sqlite3"

SCHEMA_VERSION = 2
SCHEMA = [
    "CREATE TABLE IF NOT EXISTS schema_version(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS radar_cache(filename TEXT PRIMARY KEY,payload BLOB,retry_after TEXT NOT NULL)",
    """CREATE TABLE IF NOT EXISTS wind_grid(valid_at TEXT NOT NULL,latitude REAL NOT NULL,
      longitude REAL NOT NULL,u REAL NOT NULL,v REAL NOT NULL,PRIMARY KEY(valid_at,latitude,longitude))""",
    "CREATE TABLE IF NOT EXISTS radar_frames(filename TEXT PRIMARY KEY, observed_at TEXT NOT NULL)",
    """CREATE TABLE IF NOT EXISTS refresh_leases (
      source TEXT PRIMARY KEY, locked_until TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY, county TEXT NOT NULL, town TEXT NOT NULL,
      geocode TEXT NOT NULL DEFAULT '', latitude REAL, longitude REAL,
      UNIQUE(county, town))""",
    """CREATE TABLE IF NOT EXISTS stations (
      station_id TEXT PRIMARY KEY, name TEXT NOT NULL, county TEXT NOT NULL,
      town TEXT NOT NULL, latitude REAL, longitude REAL, altitude REAL)""",
    """CREATE TABLE IF NOT EXISTS location_station_mapping (
      location_id INTEGER PRIMARY KEY REFERENCES locations(id),
      station_id TEXT NOT NULL REFERENCES stations(station_id))""",
    """CREATE TABLE IF NOT EXISTS observations (
      station_id TEXT NOT NULL REFERENCES stations(station_id),
      observed_at TEXT NOT NULL, dataset_id TEXT NOT NULL,
      temperature REAL, humidity REAL, precipitation REAL,
      precipitation_trace INTEGER NOT NULL DEFAULT 0,
      wind_speed REAL, wind_direction REAL, weather TEXT,
      PRIMARY KEY(station_id, observed_at, dataset_id))""",
    """CREATE TABLE IF NOT EXISTS forecast_batches (
      id INTEGER PRIMARY KEY, source_hash TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL, fetched_at TEXT NOT NULL,
      dataset_id TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS forecasts (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES forecast_batches(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      kind TEXT NOT NULL CHECK(kind IN ('point','period')),
      start_at TEXT NOT NULL, end_at TEXT NOT NULL,
      temperature REAL, apparent_temperature REAL, humidity REAL,
      pop REAL, weather TEXT, wind_speed REAL, wind_direction TEXT,
      UNIQUE(batch_id, location_id, kind, start_at, end_at))""",
    "CREATE INDEX IF NOT EXISTS forecast_by_location_time ON forecasts(location_id, start_at)",
    "CREATE INDEX IF NOT EXISTS obs_by_station_time ON observations(station_id, observed_at)",
    """CREATE TABLE IF NOT EXISTS warnings (
      code TEXT PRIMARY KEY, title TEXT NOT NULL, source_url TEXT NOT NULL,
      scraped_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS source_status (
      source TEXT PRIMARY KEY, status TEXT NOT NULL, checked_at TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '')""",
    """CREATE TABLE IF NOT EXISTS earthquakes (
      quake_id TEXT PRIMARY KEY, origin_at TEXT NOT NULL, latitude REAL NOT NULL,
      longitude REAL NOT NULL, magnitude REAL, depth_km REAL, location TEXT,
      report_url TEXT)""",
    """CREATE TABLE IF NOT EXISTS typhoon_details (
      name TEXT NOT NULL, kind TEXT NOT NULL, valid_at TEXT NOT NULL,
      wind_speed REAL, pressure REAL, radius15 REAL, radius25 REAL, probability_radius REAL,
      PRIMARY KEY(name,kind,valid_at))""",
    """CREATE TABLE IF NOT EXISTS typhoon_points (
      name TEXT NOT NULL, kind TEXT NOT NULL, valid_at TEXT NOT NULL,
      latitude REAL NOT NULL, longitude REAL NOT NULL,
      PRIMARY KEY(name,kind,valid_at))""",
]


def connect():
    url = os.environ.get("TURSO_DATABASE_URL")
    if url:
        token = os.environ.get("TURSO_AUTH_TOKEN")
        if not token:
            raise RuntimeError("TURSO_AUTH_TOKEN is not configured")
        # urllib uses Python's default CA path, which can be absent on macOS.
        # Keep certificate verification enabled with the bundled Mozilla CA list.
        import certifi
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        import turso_serverless
        conn = turso_serverless.connect(url, auth_token=token)
    else:
        if os.environ.get("VERCEL"):
            raise RuntimeError("TURSO_DATABASE_URL is required on Vercel")
        conn = sqlite3.connect(os.environ.get("SQLITE_PATH", str(DB_PATH)))
        conn.execute("PRAGMA foreign_keys=ON")
    return conn


def rows(cursor):
    names = [item[0] for item in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def init_schema(conn):
    for ddl in SCHEMA:
        conn.execute(ddl)
    conn.execute("INSERT OR REPLACE INTO schema_version(id,version) VALUES(1,?)", (SCHEMA_VERSION,))
    conn.commit()


def bulk_insert(conn, prefix, values, width, suffix="", chunk_size=200):
    """Write bounded multi-row statements; Turso's executemany sends one HTTP request per row."""
    iterator = iter(values)
    placeholders = "(" + ",".join("?" for _ in range(width)) + ")"
    while chunk := list(islice(iterator, chunk_size)):
        conn.execute(prefix + ",".join([placeholders] * len(chunk)) + suffix,
                     [value for row in chunk for value in row])


def assign_representatives(conn):
    """Freeze a same-town hourly station; never borrow a station across town boundaries."""
    conn.execute("""INSERT OR IGNORE INTO location_station_mapping(location_id,station_id)
        SELECT l.id, MIN(s.station_id) FROM locations l JOIN stations s
        ON s.county=l.county AND s.town=l.town
        WHERE EXISTS(SELECT 1 FROM observations o WHERE o.station_id=s.station_id
          AND o.dataset_id='O-A0001-001' AND o.temperature IS NOT NULL)
        GROUP BY l.id""")


def save_observations(conn, items):
    station_values = [(o["station_id"], o["name"], o["county"], o["town"],
                       o["latitude"], o["longitude"], o["altitude"]) for o in items]
    bulk_insert(conn, "INSERT INTO stations VALUES", station_values, 7, """
        ON CONFLICT(station_id) DO UPDATE SET name=excluded.name, county=excluded.county,
        town=excluded.town, latitude=excluded.latitude, longitude=excluded.longitude,
        altitude=excluded.altitude""")
    values = [(o["station_id"], o["observed_at"], o["dataset_id"], o["temperature"],
               o["humidity"], o["precipitation"], int(o["precipitation_trace"]),
               o["wind_speed"], o["wind_direction"], o["weather"]) for o in items]
    bulk_insert(conn, """INSERT OR IGNORE INTO observations
        (station_id,observed_at,dataset_id,temperature,humidity,precipitation,
         precipitation_trace,wind_speed,wind_direction,weather)
        VALUES""", values, 10)
    assign_representatives(conn)
    conn.commit()
    return {"received": len(items)}


def save_forecasts(conn, payload, items, fetched_at=None):
    fingerprint = hashlib.sha256(json.dumps(payload["records"], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if conn.execute("SELECT id FROM forecast_batches WHERE source_hash=?", (fingerprint,)).fetchone():
        return {"received": len(items), "duplicate_batch": True}
    fetched_at = fetched_at or datetime.now(timezone.utc).isoformat()
    issued_at = fetched_at  # REST forecast records have no trustworthy publication timestamp.
    dataset_id = (payload["records"].get("Locations") or [{}])[0].get("Dataid", "unknown")
    conn.execute("INSERT INTO forecast_batches(source_hash,issued_at,fetched_at,dataset_id) VALUES(?,?,?,?)",
                 (fingerprint, issued_at, fetched_at, dataset_id))
    batch_id = conn.execute("SELECT id FROM forecast_batches WHERE source_hash=?", (fingerprint,)).fetchone()[0]
    locations = {}
    for item in items:
        key = (item["county"], item["town"])
        if key in locations:
            continue
        locations[key] = (item["county"], item["town"], item["geocode"],
                          item["latitude"], item["longitude"])
    bulk_insert(conn, "INSERT INTO locations(county,town,geocode,latitude,longitude) VALUES",
                locations.values(), 5, """ ON CONFLICT(county,town) DO UPDATE SET
            geocode=excluded.geocode, latitude=excluded.latitude, longitude=excluded.longitude""")
    locations = {(county, town): location_id for location_id, county, town in
                 conn.execute("SELECT id,county,town FROM locations")}
    values = [(batch_id, locations[(i["county"], i["town"])], i["kind"], i["start_at"],
               i["end_at"], i.get("temperature"), i.get("apparent_temperature"),
               i.get("humidity"), i.get("pop"), i.get("weather"), i.get("wind_speed"),
               i.get("wind_direction")) for i in items]
    bulk_insert(conn, """INSERT OR IGNORE INTO forecasts
        (batch_id,location_id,kind,start_at,end_at,temperature,apparent_temperature,
         humidity,pop,weather,wind_speed,wind_direction) VALUES""", values, 12)
    # Explicit, documented representative station; never assign by nearest distance.
    conn.execute("""INSERT OR IGNORE INTO location_station_mapping(location_id,station_id)
        SELECT l.id, s.station_id FROM locations l JOIN stations s ON s.station_id='466920'
        WHERE l.county='臺北市' AND l.town='中正區'""")
    assign_representatives(conn)
    conn.commit()
    return {"received": len(items), "duplicate_batch": False, "issued_at": issued_at}


def save_earthquakes(conn, items):
    bulk_insert(conn, "INSERT INTO earthquakes VALUES", [(x["quake_id"], x["origin_at"],
        x["latitude"], x["longitude"], x["magnitude"], x["depth_km"],
        x["location"], x["report_url"]) for x in items], 8, """
        ON CONFLICT(quake_id) DO UPDATE SET origin_at=excluded.origin_at,
        latitude=excluded.latitude,longitude=excluded.longitude,magnitude=excluded.magnitude,
        depth_km=excluded.depth_km,location=excluded.location,report_url=excluded.report_url""")
    conn.commit()
    return {"received": len(items)}


def save_typhoons(conn, items):
    conn.execute("DELETE FROM typhoon_points")
    conn.execute("DELETE FROM typhoon_details")
    bulk_insert(conn, "INSERT INTO typhoon_details VALUES", [(x["name"], x["kind"], x["valid_at"],
        x.get("wind_speed"), x.get("pressure"), x.get("radius15"), x.get("radius25"),
        x.get("probability_radius")) for x in items], 8)
    bulk_insert(conn, "INSERT INTO typhoon_points VALUES",
                [(x["name"], x["kind"], x["valid_at"], x["latitude"], x["longitude"])
                 for x in items], 5)
    conn.commit()
    return {"received": len(items)}
