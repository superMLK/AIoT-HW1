"""Copy genuinely captured local history to configured remote DB, preserving timestamps.

Run with TURSO_* configured. Source is opened read-only; existing versions/observations
are not overwritten. No publication or observation timestamps are manufactured.
"""
import os
import sqlite3
from weather.db import DB_PATH, connect, init_schema, bulk_insert, rows, assign_representatives


def main():
    if not os.environ.get("TURSO_DATABASE_URL"):
        raise RuntimeError("TURSO_DATABASE_URL is required for history import")
    source = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True)
    target = connect()
    init_schema(target)
    station_rows = source.execute('SELECT * FROM stations').fetchall()
    bulk_insert(target, 'INSERT OR IGNORE INTO stations VALUES', station_rows, 7)
    bulk_insert(target, 'INSERT OR IGNORE INTO observations VALUES', source.execute('SELECT * FROM observations').fetchall(), 10)
    location_ids = {(county,town): ident for ident,county,town in target.execute('SELECT id,county,town FROM locations')}
    local_locations = {ident: location_ids[(county,town)] for ident,county,town in source.execute('SELECT id,county,town FROM locations') if (county,town) in location_ids}
    imported = 0
    for batch in rows(source.execute('SELECT * FROM forecast_batches')):
        if target.execute('SELECT 1 FROM forecast_batches WHERE source_hash=?',(batch['source_hash'],)).fetchone():
            continue
        target.execute('INSERT INTO forecast_batches(source_hash,issued_at,fetched_at,dataset_id) VALUES(?,?,?,?)',
                       (batch['source_hash'],batch['issued_at'],batch['fetched_at'],batch['dataset_id']))
        ident = target.execute('SELECT id FROM forecast_batches WHERE source_hash=?',(batch['source_hash'],)).fetchone()[0]
        values = [(ident,local_locations[r[2]],*r[3:]) for r in source.execute('SELECT * FROM forecasts WHERE batch_id=?',(batch['id'],)) if r[2] in local_locations]
        bulk_insert(target, 'INSERT OR IGNORE INTO forecasts(batch_id,location_id,kind,start_at,end_at,temperature,apparent_temperature,humidity,pop,weather,wind_speed,wind_direction) VALUES',values,12)
        target.commit();imported += 1
    assign_representatives(target);target.commit()
    print({'imported_historical_batches':imported,'mapped_locations':target.execute('SELECT COUNT(*) FROM location_station_mapping').fetchone()[0]})
    source.close();target.close()


if __name__ == '__main__':
    main()
