"""Flask REST endpoints. External fetch, parsing, storage, and analysis stay separate."""

import hmac
import os
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, request

from weather.analysis import analyze
from weather.cwa import DATASETS, fetch_json
from weather.db import (connect, init_schema, rows, save_forecasts, save_observations,
                        save_earthquakes, save_typhoons)
from weather.hazards import parse_earthquakes, parse_typhoons
from weather.parser import parse_forecasts, parse_observations
from weather.warnings import scrape_warnings


def create_app():
    app = Flask(__name__)
    schema_ready = False

    def database():
        nonlocal schema_ready
        conn = connect()
        if not schema_ready:
            init_schema(conn)
            schema_ready = True
        return conn

    @app.errorhandler(ValueError)
    def bad_data(exc):
        return jsonify(error=str(exc)), 400

    @app.errorhandler(RuntimeError)
    def unavailable(exc):
        return jsonify(error=str(exc)), 503

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/stations")
    def stations():
        dataset = request.args.get("dataset", "O-A0003-001")
        if dataset not in ("O-A0001-001", "O-A0003-001"):
            raise ValueError("unsupported observation dataset")
        conn = database()
        try:
            data = rows(conn.execute("""SELECT s.station_id,s.name,s.county,s.town,s.latitude,s.longitude,
                o.observed_at,o.temperature,o.humidity,o.precipitation,o.precipitation_trace,
                o.wind_speed,o.wind_direction,o.weather FROM stations s JOIN observations o
                ON o.station_id=s.station_id JOIN (SELECT station_id,MAX(observed_at) AS latest
                FROM observations WHERE dataset_id=? GROUP BY station_id) m
                ON m.station_id=o.station_id AND m.latest=o.observed_at WHERE o.dataset_id=?
                ORDER BY s.station_id""", (dataset, dataset)))
            return jsonify(stations=data, dataset_id=dataset)
        finally:
            conn.close()

    @app.get("/api/locations")
    def locations():
        conn = database()
        try:
            return jsonify(locations=rows(conn.execute("""SELECT l.*,s.station_id AS representative_station
                FROM locations l LEFT JOIN location_station_mapping m ON m.location_id=l.id
                LEFT JOIN stations s ON s.station_id=m.station_id ORDER BY l.county,l.town""")))
        finally:
            conn.close()

    @app.get("/api/forecast")
    def forecast():
        location_id = request.args.get("location_id", type=int)
        if not location_id:
            raise ValueError("location_id is required")
        conn = database()
        try:
            latest = conn.execute("""SELECT MAX(b.issued_at) FROM forecast_batches b
                JOIN forecasts f ON f.batch_id=b.id WHERE f.location_id=?""", (location_id,)).fetchone()[0]
            if not latest:
                return jsonify(issued_at=None, forecasts=[])
            data = rows(conn.execute("""SELECT f.kind,f.start_at,f.end_at,f.temperature,
                f.apparent_temperature,f.humidity,f.pop,f.weather,f.wind_speed,f.wind_direction
                FROM forecasts f JOIN forecast_batches b ON b.id=f.batch_id
                WHERE f.location_id=? AND b.issued_at=? AND f.start_at>=?
                ORDER BY f.start_at LIMIT 120""", (location_id, latest, datetime.now(timezone.utc).isoformat())))
            return jsonify(issued_at=latest, forecasts=data)
        finally:
            conn.close()

    @app.get("/api/analysis")
    def analysis():
        location_id = request.args.get("location_id", type=int)
        if not location_id:
            raise ValueError("location_id is required")
        conn = database()
        try:
            mapping = conn.execute("SELECT station_id FROM location_station_mapping WHERE location_id=?", (location_id,)).fetchone()
            if not mapping:
                return jsonify(available=False, reason="此行政區尚無合適代表測站", pairs=[], sample_count=0, mae=None)
            forecasts = rows(conn.execute("""SELECT f.kind,f.start_at,f.temperature,b.issued_at
                FROM forecasts f JOIN forecast_batches b ON b.id=f.batch_id
                WHERE f.location_id=? AND f.kind='point' AND f.start_at<=?
                ORDER BY f.start_at DESC LIMIT 1000""", (location_id, datetime.now(timezone.utc).isoformat())))
            observations = rows(conn.execute("""SELECT observed_at,temperature FROM observations
                WHERE station_id=? AND dataset_id='O-A0001-001' AND temperature IS NOT NULL
                ORDER BY observed_at DESC LIMIT 1000""", (mapping[0],)))
            return jsonify(available=True, station_id=mapping[0], **analyze(forecasts, observations))
        finally:
            conn.close()

    @app.get("/api/warnings")
    def warnings():
        conn = database()
        try:
            status = rows(conn.execute("SELECT * FROM source_status WHERE source='warnings'"))
            return jsonify(status=status[0] if status else None,
                           warnings=rows(conn.execute("SELECT * FROM warnings ORDER BY code")))
        finally:
            conn.close()

    @app.get("/api/earthquakes")
    def earthquakes():
        conn = database()
        try:
            return jsonify(earthquakes=rows(conn.execute(
                "SELECT * FROM earthquakes ORDER BY origin_at DESC LIMIT 30")))
        finally:
            conn.close()

    @app.get("/api/typhoons")
    def typhoons():
        conn = database()
        try:
            return jsonify(points=rows(conn.execute(
                "SELECT * FROM typhoon_points ORDER BY name,kind,valid_at")))
        finally:
            conn.close()

    @app.route("/api/refresh", methods=["POST", "GET"])
    @app.route("/api/refresh/<dataset>", methods=["GET"])
    def refresh(dataset=None):
        if request.method == "GET":
            secret = os.environ.get("CRON_SECRET")
            valid = bool(secret and hmac.compare_digest(
                request.headers.get("Authorization", ""), "Bearer " + secret))
        else:
            secret = os.environ.get("REFRESH_TOKEN")
            valid = bool(secret and hmac.compare_digest(
                request.headers.get("X-Refresh-Token", ""), secret))
        if not valid:
            return jsonify(error="refresh requires the correct server-side token"), 403
        dataset = dataset or request.args.get("dataset", "O-A0003-001")
        if dataset not in DATASETS | {"warnings"}:
            raise ValueError("unsupported sync source")
        conn = database()
        try:
            previous = conn.execute("SELECT checked_at FROM source_status WHERE source=? AND status='ok'", (dataset,)).fetchone()
            if previous and datetime.now(timezone.utc) - datetime.fromisoformat(previous[0]) < timedelta(minutes=5):
                return jsonify(error="source was synced within the last five minutes"), 429
        finally:
            conn.close()
        if dataset == "warnings":
            parsed = scrape_warnings()
            conn = database()
            try:
                conn.execute("DELETE FROM warnings")
                conn.executemany("INSERT INTO warnings VALUES(?,?,?,?)",
                                 [(w["code"], w["title"], w["source_url"], w["scraped_at"]) for w in parsed])
                conn.execute("""INSERT INTO source_status(source,status,checked_at,detail) VALUES(?,?,?,?)
                    ON CONFLICT(source) DO UPDATE SET status=excluded.status,
                    checked_at=excluded.checked_at, detail=excluded.detail""",
                    ("warnings", "ok", datetime.now(timezone.utc).isoformat(), ""))
                conn.commit()
                return jsonify(source=dataset, received=len(parsed))
            finally:
                conn.close()
        payload = fetch_json(dataset)
        is_forecast = dataset.startswith("F-D0047-")
        if is_forecast:
            parsed = parse_forecasts(payload)
        elif dataset == "E-A0015-001":
            parsed = parse_earthquakes(payload)
        elif dataset == "W-C0034-005":
            parsed = parse_typhoons(payload)
        else:
            parsed = parse_observations(payload, dataset)
        conn = database()
        try:
            if is_forecast:
                result = save_forecasts(conn, payload, parsed)
            elif dataset == "E-A0015-001":
                result = save_earthquakes(conn, parsed)
            elif dataset == "W-C0034-005":
                result = save_typhoons(conn, parsed)
            else:
                result = save_observations(conn, parsed)
            conn.execute("""INSERT INTO source_status(source,status,checked_at,detail) VALUES(?,?,?,?)
                ON CONFLICT(source) DO UPDATE SET status=excluded.status,
                checked_at=excluded.checked_at,detail=excluded.detail""",
                (dataset, "ok", datetime.now(timezone.utc).isoformat(), ""))
            conn.commit()
            return jsonify(source=dataset, **result)
        finally:
            conn.close()

    return app


app = create_app()
