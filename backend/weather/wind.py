"""NOAA GFS 0.5 degree, 10 m eastward/northward wind through official ERDDAP."""
import json
import math
from datetime import datetime, timezone
from urllib.parse import quote
from urllib.request import urlopen
from weather.cwa import tls_context
from weather.db import bulk_insert

BASE = 'https://upwell.pfeg.noaa.gov/erddap/griddap/ncep_global.json'


def parse_wind(payload):
    table = payload['table']
    names = table['columnNames']
    required = ['time', 'latitude', 'longitude', 'ugrd10m', 'vgrd10m']
    if any(x not in names for x in required):
        raise ValueError('NOAA wind schema changed')
    result = []
    for values in table['rows']:
        row = dict(zip(names, values))
        u, v = row['ugrd10m'], row['vgrd10m']
        if u is None or v is None or not math.isfinite(u) or not math.isfinite(v) or max(abs(u), abs(v)) > 150:
            continue
        result.append((row['time'], row['latitude'], row['longitude'], u, v))
    if not result:
        raise ValueError('NOAA wind contains no valid vectors')
    return result


def sync_wind(conn):
    now = datetime.now(timezone.utc)
    target = now.replace(hour=now.hour//3*3, minute=0, second=0, microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ')
    # Latitude is descending in this dataset. Bounded regional query, no client URL input.
    subset = f'[({target})][(35):1:(10)][(110):1:(145)]'
    url = BASE + '?' + quote('ugrd10m' + subset + ',vgrd10m' + subset, safe=',:()')
    with urlopen(url, timeout=25, context=tls_context()) as response:
        items = parse_wind(json.load(response))
    conn.execute('DELETE FROM wind_grid')
    bulk_insert(conn, 'INSERT INTO wind_grid(valid_at,latitude,longitude,u,v) VALUES', items, 5)
    conn.commit()
    return {'source': 'wind', 'received': len(items)}
