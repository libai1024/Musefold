# Musefold download statistics

Small standard-library service for the Musefold release page. It stores only
the requested platform, version, and UTC event time in SQLite. It does not
store IP addresses, user agents, cookies, or other visitor identifiers.

## Endpoints

- `GET /download?platform=macos&version=0.5.0-dev` records a download start and
  responds with a `302` redirect to the catalogued installer.
- `HEAD /download?...` validates the redirect without recording an event.
- `GET /download-stats` returns public aggregate totals.
- `GET /health` checks SQLite availability.

The download catalog is defined in `catalog.json`. Only relative paths below
`/Musefold/downloads/` are accepted.

## Test

```sh
python3 -m unittest -v test_server.py
```
