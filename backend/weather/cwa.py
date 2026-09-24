"""Server-side access to CWA Open Data. No API key reaches the browser."""

import json
import os
import ssl
import certifi
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/"
DATASETS = {"O-A0001-001", "O-A0003-001", "E-A0015-001", "W-C0034-005"} | {
    f"F-D0047-{number:03d}" for number in range(1, 86, 4)
}


def tls_context():
    context = ssl.create_default_context(cafile=certifi.where())
    # Python 3.13 strict validation rejects a CWA chain without Subject Key Identifier.
    # Keep certificate and hostname verification enabled.
    context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return context


def fetch_json(dataset_id):
    if dataset_id not in DATASETS:
        raise ValueError("unsupported CWA dataset")
    key = os.environ.get("CWA_API_KEY")
    if not key:
        raise RuntimeError("CWA_API_KEY is not configured")
    request = Request(BASE + dataset_id + "?" + urlencode({"format": "JSON"}),
                      headers={"Authorization": key, "Accept": "application/json", "User-Agent": "AIoT-Weather-MVP/1.0"})
    try:
        with urlopen(request, timeout=25, context=tls_context()) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"CWA {dataset_id} request failed: {exc}") from exc
    if str(payload.get("success")).lower() == "false":
        raise ValueError(f"CWA {dataset_id} reported failure: {payload.get('result')}")
    if not isinstance(payload.get("records"), dict):
        raise ValueError(f"CWA {dataset_id} response lacks records")
    return payload
