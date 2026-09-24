"""Explainable temperature forecast-versus-observation matching."""

from datetime import datetime, timedelta

TOLERANCE = timedelta(minutes=30)


def analyze(forecasts, observations):
    """Use the last forecast made before each target; match nearest hourly observation."""
    latest_by_target = {}
    for forecast in forecasts:
        if forecast["temperature"] is None or forecast["kind"] != "point":
            continue
        target = datetime.fromisoformat(forecast["start_at"])
        issued = datetime.fromisoformat(forecast["issued_at"])
        if issued >= target:
            continue
        prior = latest_by_target.get(forecast["start_at"])
        if prior is None or prior["issued_at"] < forecast["issued_at"]:
            latest_by_target[forecast["start_at"]] = forecast
    pairs = []
    for forecast in latest_by_target.values():
        target = datetime.fromisoformat(forecast["start_at"])
        candidates = [o for o in observations if o["temperature"] is not None
                      and abs(datetime.fromisoformat(o["observed_at"]) - target) <= TOLERANCE]
        if not candidates:
            continue
        observed = min(candidates, key=lambda o: (
            abs(datetime.fromisoformat(o["observed_at"]) - target), o["observed_at"]))
        pairs.append({"target_time": forecast["start_at"], "issued_at": forecast["issued_at"],
                      "observed_at": observed["observed_at"],
                      "forecast_temperature": forecast["temperature"],
                      "observed_temperature": observed["temperature"],
                      "absolute_error": round(abs(forecast["temperature"] - observed["temperature"]), 2)})
    pairs.sort(key=lambda pair: pair["target_time"], reverse=True)
    return {"pairs": pairs[:100], "sample_count": len(pairs),
            "mae": round(sum(p["absolute_error"] for p in pairs) / len(pairs), 2) if len(pairs) >= 2 else None,
            "tolerance_minutes": 30}
