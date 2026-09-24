"""Normalize the live CWA earthquake and cyclone JSON shapes."""

from datetime import datetime, timedelta

from weather.parser import number, timestamp


def parse_earthquakes(payload):
    events = (payload.get("records") or {}).get("Earthquake")
    if not isinstance(events, list):
        raise ValueError("CWA earthquake records.Earthquake is missing")
    result = []
    for event in events:
        info = event.get("EarthquakeInfo") or {}
        epicenter = info.get("Epicenter") or {}
        lat = number(epicenter.get("EpicenterLatitude"), lower=-90, upper=90)
        lon = number(epicenter.get("EpicenterLongitude"), lower=-180, upper=180)
        if lat is None or lon is None:
            continue
        result.append({"quake_id": str(event["EarthquakeNo"]),
                       "origin_at": timestamp(info["OriginTime"]), "latitude": lat,
                       "longitude": lon,
                       "magnitude": number((info.get("EarthquakeMagnitude") or {}).get("MagnitudeValue")),
                       "depth_km": number(info.get("FocalDepth")),
                       "location": epicenter.get("Location") or "", "report_url": event.get("Web") or ""})
    return result


def parse_typhoons(payload):
    storms = ((payload.get("records") or {}).get("TropicalCyclones") or {}).get("TropicalCyclone")
    if not isinstance(storms, list):
        raise ValueError("CWA tropical cyclone records are missing")
    points = []
    for storm in storms:
        name = storm.get("CwaTyphoonName") or storm.get("TyphoonName") or "未命名"
        for kind, section in (("analysis", "AnalysisData"), ("forecast", "ForecastData")):
            for fix in (storm.get(section) or {}).get("Fix") or []:
                lat = number(fix.get("CoordinateLatitude"), lower=-90, upper=90)
                lon = number(fix.get("CoordinateLongitude"), lower=-180, upper=180)
                instant = fix.get("DateTime") or fix.get("InitialTime")
                if lat is None or lon is None or not instant:
                    continue
                valid_at = timestamp(instant)
                if kind == "forecast":
                    valid_at = (datetime.fromisoformat(valid_at) +
                                timedelta(hours=int(fix.get("ForecastHour") or 0))).isoformat()
                points.append({"name": name, "kind": kind, "valid_at": valid_at,
                               "latitude": lat, "longitude": lon})
    return points
