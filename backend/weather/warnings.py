"""Scrape the CWA public warning site's own data file, not the Open Data API."""

import ast
import re
from weather.cwa import tls_context
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SOURCE = "https://www.cwa.gov.tw/Data/js/warn/Warning_Content.js"
PAGES = {
    "W25": ("陸上強風特報", "https://www.cwa.gov.tw/V8/C/P/Warning/W25.html"),
    "W26": ("豪（大）雨特報", "https://www.cwa.gov.tw/V8/C/P/Warning/W26.html"),
    "W28": ("低溫特報", "https://www.cwa.gov.tw/V8/C/P/Warning/W28.html"),
    "W29": ("高溫資訊", "https://www.cwa.gov.tw/V8/C/P/Warning/W29.html"),
    "W33": ("大雷雨即時訊息", "https://www.cwa.gov.tw/V8/C/P/Warning/W33.html"),
    "TY_NEWS": ("颱風消息", "https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_NEWS.html"),
}


def parse_warning_index(script, scraped_at=None):
    match = re.search(r"\bvar\s+WarnAll\s*=\s*(\[[^;]*\])\s*;", script)
    if not match:
        raise ValueError("CWA warning index has no WarnAll array")
    codes = ast.literal_eval(match.group(1))
    if not isinstance(codes, list) or not all(isinstance(code, str) for code in codes):
        raise ValueError("CWA warning index has unexpected WarnAll value")
    scraped_at = scraped_at or datetime.now(timezone.utc).isoformat()
    return [{"code": code, "title": PAGES.get(code, (code, ""))[0],
             "source_url": PAGES.get(code, ("", "https://www.cwa.gov.tw/V8/C/P/Warning/FIFOWS.html"))[1],
             "scraped_at": scraped_at} for code in codes]


def scrape_warnings():
    request = Request(SOURCE, headers={"User-Agent": "AIoT-Weather-MVP/1.0"})
    try:
        with urlopen(request, timeout=15, context=tls_context()) as response:
            script = response.read(500_000).decode("utf-8")
    except (HTTPError, URLError, TimeoutError, UnicodeDecodeError) as exc:
        raise RuntimeError(f"CWA warning website request failed: {exc}") from exc
    return parse_warning_index(script)
