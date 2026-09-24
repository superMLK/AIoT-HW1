import os
import sqlite3
import unittest
from unittest.mock import patch

from api import create_app
from weather.analysis import analyze
from weather.db import init_schema, save_forecasts, save_observations
from weather.parser import parse_forecasts, parse_observations
from weather.warnings import parse_warning_index


def forecast_payload(temperature):
    return {"success": "true", "records": {"Locations": [{
        "LocationsName": "臺北市", "Dataid": "D0047-061", "Location": [{
            "LocationName": "中正區", "Geocode": "63000050", "Latitude": "25.03", "Longitude": "121.52",
            "WeatherElement": [{"ElementName": "溫度", "Time": [
                {"DataTime": "2026-09-24T15:00:00+08:00", "ElementValue": [{"Temperature": str(temperature)}]},
                {"DataTime": "2026-09-24T16:00:00+08:00", "ElementValue": [{"Temperature": "30"}]}
            ]}, {"ElementName": "3小時降雨機率", "Time": [{
                "StartTime": "2026-09-24T15:00:00+08:00", "EndTime": "2026-09-24T18:00:00+08:00",
                "ElementValue": [{"ProbabilityOfPrecipitation": "20"}]
            }]}]}]}]}}


def observation_payload():
    return {"success": "true", "records": {"Station": [{
        "StationId": "466920", "StationName": "臺北", "ObsTime": {"DateTime": "2026-09-24T15:00:00+08:00"},
        "GeoInfo": {"CountyName": "臺北市", "TownName": "中正區", "StationAltitude": "6",
                    "Coordinates": [{"CoordinateName": "WGS84", "StationLatitude": "25.03",
                                     "StationLongitude": "121.51"}]},
        "WeatherElement": {"AirTemperature": "32.2", "RelativeHumidity": "-99",
                           "WindSpeed": "3.4", "WindDirection": "990",
                           "Now": {"Precipitation": "T"}}
    }]}}


class PipelineTests(unittest.TestCase):
    def test_parse_persist_and_match_latest_pre_target(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("PRAGMA foreign_keys=ON")
        init_schema(conn)
        observations = parse_observations(observation_payload(), "O-A0001-001")
        self.assertIsNone(observations[0]["humidity"])
        self.assertIsNone(observations[0]["precipitation"])
        self.assertTrue(observations[0]["precipitation_trace"])
        self.assertIsNone(observations[0]["wind_direction"])
        save_observations(conn, observations)
        for temp, issued in ((29, "2026-09-23T00:00:00+00:00"),
                             (31, "2026-09-24T00:00:00+00:00")):
            payload = forecast_payload(temp)
            items = parse_forecasts(payload)
            self.assertEqual(items[0]["pop"], 20)
            save_forecasts(conn, payload, items, fetched_at=issued)
        duplicate = save_forecasts(conn, forecast_payload(31), parse_forecasts(forecast_payload(31)))
        self.assertTrue(duplicate["duplicate_batch"])
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM forecast_batches").fetchone()[0], 2)
        self.assertEqual(conn.execute("SELECT station_id FROM location_station_mapping").fetchone()[0], "466920")
        forecasts = [{"kind": "point", "start_at": row[0], "temperature": row[1], "issued_at": row[2]}
                     for row in conn.execute("""SELECT f.start_at,f.temperature,b.issued_at
                         FROM forecasts f JOIN forecast_batches b ON f.batch_id=b.id""")]
        observed = [{"observed_at": observations[0]["observed_at"], "temperature": 32.2},
                    {"observed_at": "2026-09-24T08:05:00+00:00", "temperature": 31.0}]
        result = analyze(forecasts, observed)
        self.assertEqual(result["sample_count"], 2)
        self.assertEqual(result["pairs"][1]["forecast_temperature"], 31)
        self.assertEqual(result["mae"], 1.1)
        conn.close()

    def test_refresh_requires_correct_token_before_fetch(self):
        with patch.dict(os.environ, {"CRON_SECRET": "cron-test-secret", "REFRESH_TOKEN": "manual-test-secret"}):
            client = create_app().test_client()
            with patch("api.fetch_json") as fetch:
                for method, headers in ((client.get, {}), (client.get, {"Authorization": "Bearer wrong"}),
                                        (client.post, {}), (client.post, {"X-Refresh-Token": "wrong"})):
                    self.assertEqual(method("/api/refresh?dataset=O-A0001-001", headers=headers).status_code, 403)
                self.assertEqual(client.get("/api/refresh?dataset=invalid", headers={
                    "Authorization": "Bearer cron-test-secret"}).status_code, 400)
                self.assertEqual(client.get("/api/refresh/O-A0001-001", headers={
                    "Authorization": "Bearer wrong"}).status_code, 403)
                fetch.assert_not_called()

    def test_warning_scraper_distinguishes_empty_from_failure(self):
        self.assertEqual(parse_warning_index("var WarnAll = [];"), [])
        self.assertEqual(parse_warning_index("var WarnAll = ['W26'];")[0]["title"], "豪（大）雨特報")
        with self.assertRaises(ValueError):
            parse_warning_index("var WarnAllBad = [];")


if __name__ == "__main__":
    unittest.main()
