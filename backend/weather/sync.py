"""Local bootstrap: python -m weather.sync --all or --dataset F-D0047-061."""

import argparse
from datetime import datetime, timezone

from weather.cwa import DATASETS, fetch_json
from weather.db import (connect, init_schema, save_earthquakes, save_forecasts,
                        save_observations, save_typhoons)
from weather.hazards import parse_earthquakes, parse_typhoons
from weather.parser import parse_forecasts, parse_observations
from weather.warnings import scrape_warnings


def sync_one(dataset):
    conn = connect()
    try:
        init_schema(conn)
        if dataset == "warnings":
            items = scrape_warnings()
            conn.execute("DELETE FROM warnings")
            conn.executemany("INSERT INTO warnings VALUES(?,?,?,?)",
                             [(x["code"], x["title"], x["source_url"], x["scraped_at"]) for x in items])
            result = {"received": len(items)}
        else:
            payload = fetch_json(dataset)
            if dataset.startswith("F-D0047-"):
                result = save_forecasts(conn, payload, parse_forecasts(payload))
            elif dataset == "E-A0015-001":
                result = save_earthquakes(conn, parse_earthquakes(payload))
            elif dataset == "W-C0034-005":
                result = save_typhoons(conn, parse_typhoons(payload))
            else:
                result = save_observations(conn, parse_observations(payload, dataset))
        conn.execute("""INSERT INTO source_status(source,status,checked_at,detail) VALUES(?,?,?,?)
            ON CONFLICT(source) DO UPDATE SET status=excluded.status,
            checked_at=excluded.checked_at,detail=excluded.detail""",
            (dataset, "ok", datetime.now(timezone.utc).isoformat(), ""))
        conn.commit()
        return result
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="initialize all 22 counties and other sources")
    group.add_argument("--dataset", choices=sorted(DATASETS | {"warnings"}))
    args = parser.parse_args()
    ids = (["O-A0001-001", "O-A0003-001"] +
           [f"F-D0047-{n:03d}" for n in range(1, 86, 4)] +
           ["E-A0015-001", "W-C0034-005", "warnings"]) if args.all else [args.dataset]
    failed = 0
    for dataset in ids:
        try:
            print(dataset, sync_one(dataset), flush=True)
        except Exception as exc:
            failed += 1
            print(dataset, "FAILED", type(exc).__name__, str(exc), flush=True)
    if failed:
        raise SystemExit(f"{failed} source(s) failed")


if __name__ == "__main__":
    main()
