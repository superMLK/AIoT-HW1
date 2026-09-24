"""Parse the documented CWA JSON structures into normalized Python values."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

TAIPEI = ZoneInfo("Asia/Taipei")
MISSING = {"", "-99", "-98", "X", "x", "null", "None"}


def timestamp(value):
    if not value or str(value) in MISSING:
        raise ValueError("missing timestamp")
    parsed = datetime.fromisoformat(str(value).replace(" ", "T"))
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=TAIPEI)).astimezone(timezone.utc).isoformat()


def number(value, *, lower=None, upper=None):
    if value is None or str(value).strip() in MISSING or str(value).strip() == "T":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if lower is not None and result < lower or upper is not None and result > upper:
        return None
    return result


def _stations(payload):
    if str(payload.get("success")).lower() == "false":
        raise ValueError(f"CWA rejected observation response: {payload.get('result')}")
    records = payload.get("records")
    if not isinstance(records, dict) or not isinstance(records.get("Station"), list):
        raise ValueError("CWA observation records.Station is missing")
    return records["Station"]


def parse_observations(payload, dataset_id):
    if dataset_id not in {"O-A0001-001", "O-A0003-001"}:
        raise ValueError("unsupported observation dataset")
    result = []
    for station in _stations(payload):
        geo = station.get("GeoInfo") or {}
        coords = geo.get("Coordinates") or []
        if isinstance(coords, dict):
            coords = [coords]
        wgs84 = next((c for c in coords if c.get("CoordinateName") == "WGS84"), None)
        weather = station.get("WeatherElement") or {}
        if not station.get("StationId") or not (station.get("ObsTime") or {}).get("DateTime"):
            continue
        result.append({
            "station_id": station["StationId"], "name": station.get("StationName") or station["StationId"],
            "county": geo.get("CountyName") or "", "town": geo.get("TownName") or "",
            "latitude": number((wgs84 or {}).get("StationLatitude"), lower=-90, upper=90),
            "longitude": number((wgs84 or {}).get("StationLongitude"), lower=-180, upper=180),
            "altitude": number(geo.get("StationAltitude")),
            "observed_at": timestamp(station["ObsTime"]["DateTime"]), "dataset_id": dataset_id,
            "temperature": number(weather.get("AirTemperature"), lower=-50, upper=60),
            "humidity": number(weather.get("RelativeHumidity"), lower=0, upper=100),
            "precipitation": number((weather.get("Now") or {}).get("Precipitation"), lower=0),
            "precipitation_trace": str((weather.get("Now") or {}).get("Precipitation")) == "T",
            "wind_speed": number(weather.get("WindSpeed"), lower=0),
            "wind_direction": number(weather.get("WindDirection"), lower=0, upper=360),
            "weather": weather.get("Weather") if weather.get("Weather") not in MISSING else None,
        })
    return result


POINT_FIELDS = {
    "溫度": ("temperature", "Temperature"),
    "體感溫度": ("apparent_temperature", "ApparentTemperature"),
    "相對濕度": ("humidity", "RelativeHumidity"),
    "風速": ("wind_speed", "WindSpeed"),
    "風向": ("wind_direction", "WindDirection"),
}
PERIOD_FIELDS = {
    "平均溫度": ("temperature", "Temperature"),
    "平均相對濕度": ("humidity", "RelativeHumidity"),
    "12小時降雨機率": ("pop", "ProbabilityOfPrecipitation"),
    "3小時降雨機率": ("pop", "ProbabilityOfPrecipitation"),
    "天氣現象": ("weather", "Weather"),
}


def parse_forecasts(payload):
    if str(payload.get("success")).lower() == "false":
        raise ValueError(f"CWA rejected forecast response: {payload.get('result')}")
    groups = (payload.get("records") or {}).get("Locations")
    if not isinstance(groups, list):
        raise ValueError("CWA forecast records.Locations is missing")
    result = []
    for group in groups:
        county = group.get("LocationsName") or ""
        for location in group.get("Location") or []:
            base = {"county": county, "town": location.get("LocationName") or "",
                    "geocode": location.get("Geocode") or "",
                    "latitude": number(location.get("Latitude")), "longitude": number(location.get("Longitude"))}
            points, periods = {}, {}
            for element in location.get("WeatherElement") or []:
                name = element.get("ElementName")
                for item in element.get("Time") or []:
                    values = (item.get("ElementValue") or [{}])[0]
                    if "DataTime" in item and name in POINT_FIELDS:
                        field, source = POINT_FIELDS[name]
                        key = timestamp(item["DataTime"])
                        entry = points.setdefault(key, {**base, "kind": "point", "start_at": key, "end_at": ""})
                        value = values.get(source)
                        entry[field] = value if field == "wind_direction" else number(value)
                    elif "StartTime" in item and "EndTime" in item and name in PERIOD_FIELDS:
                        start, end = timestamp(item["StartTime"]), timestamp(item["EndTime"])
                        key = (start, end)
                        entry = periods.setdefault(key, {**base, "kind": "period", "start_at": start, "end_at": end})
                        field, source = PERIOD_FIELDS[name]
                        entry[field] = values.get(source) if field == "weather" else number(values.get(source))
            for entry in points.values():
                applicable = [p for p in periods.values() if p["start_at"] <= entry["start_at"] < p["end_at"]]
                applicable.sort(key=lambda p: p["end_at"])
                for period in applicable:
                    for field in ("pop", "weather"):
                        if field in period and field not in entry:
                            entry[field] = period[field]
                if entry.get("temperature") is not None:
                    result.append(entry)
            result.extend(p for p in periods.values() if p.get("temperature") is not None)
    return result
