"""Read CWA's published frame index; never synthesize unverified frame timestamps."""
import re
from datetime import datetime, timezone
from urllib.request import urlopen
from functools import lru_cache
from weather.cwa import tls_context

INDEX_URL = 'https://www.cwa.gov.tw/Data/js/obs_img/Observe_radar.js'
FRAME_PATTERN = r'CV1_3600_\d{12}\.png'


def parse_frames(text):
    names = sorted(set(re.findall(FRAME_PATTERN, text)))[-13:]
    if not names:
        raise ValueError('官方雷達索引未包含可辨識影像')
    return [{'filename': name, 'observed_at': datetime.strptime(name[9:21], '%Y%m%d%H%M').isoformat() + '+08:00'} for name in names]


def sync_radar(conn):
    with urlopen(INDEX_URL, timeout=20, context=tls_context()) as response:
        frames = parse_frames(response.read().decode())
    from weather.db import bulk_insert
    conn.execute('DELETE FROM radar_frames')
    bulk_insert(conn, 'INSERT INTO radar_frames(filename,observed_at) VALUES',
                [(f['filename'], f['observed_at']) for f in frames], 2)
    conn.execute('DELETE FROM radar_cache WHERE filename NOT IN (SELECT filename FROM radar_frames)')
    conn.commit()
    return {'source': 'radar', 'received': len(frames)}


@lru_cache(maxsize=16)
def fetch_frame(filename):
    if not re.fullmatch(FRAME_PATTERN, filename):
        raise ValueError('invalid radar filename')
    with urlopen('https://www.cwa.gov.tw/Data/radar/' + filename,
                 timeout=20, context=tls_context()) as response:
        data = response.read(5_000_001)
    if len(data) > 5_000_000 or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('invalid radar image')
    return data
