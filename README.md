# soundretouch-bridge

`soundretouch-bridge` is a small local Node/TypeScript service for Bose SoundTouch speakers. It listens for preset presses and remaps them to direct internet radio streams so the speaker buttons stay useful after the SoundTouch cloud shutdown.


## What it does

- Auto-discovers SoundTouch speakers on the LAN with SSDP when possible
- Supports manual speaker IP entry when discovery is flaky
- Serves a simple web UI for preset mappings
- Connects to each speaker websocket on port `8080`
- Remaps configured presets to stream URLs via `SoundTouchDevice.playStreamUrl()`
- Stores config in `data/config.json`

## Requirements

- Node.js 20+
- npm
- A Bose SoundTouch speaker reachable on the same LAN

## Install

```bash
npm install
```

The local dependency is wired as `file:../soundretouch-api`, matching the current adjacent-folder development layout.

## Development

```bash
npm run dev
```

The service defaults to:

- Host: `0.0.0.0`
- Port: `4100`

Open the frontend from another device on the LAN at:

```text
http://<raspberry-pi-ip>:4100
```

## Build and run

```bash
npm run build
npm start
```

## Typecheck

```bash
npm run typecheck
```

## Using the frontend

1. Open `http://<bridge-ip>:4100`.
2. Add a speaker manually by IP or press `Refresh discovery`.
3. Click a preset button on a speaker card to configure it.
4. Enter a station name and stream URL.
5. Save the mapping.
6. Press physical preset buttons on the speaker and watch `Debug`.

## Config file

Mappings and speakers are stored in `data/config.json`.

Example:

```json
{
    "manualSpeakers": [],
    "discoveredSpeakers": [],
    "mappings": [
        {
            "id": "00000000-0000-0000-0000-000000000001",
            "speakerId": "0CAE7D4BAC9C",
            "presetNumber": 5,
            "stationName": "Example Radio",
            "streamUrl": "http://example.com/stream.mp3",
            "enabled": true
        }
    ]
}
```

Writes are done atomically through a temporary file plus rename.

## API

- `GET /api/status`
- `GET /api/speakers`
- `POST /api/speakers/discover`
- `POST /api/speakers/manual`
- `GET /api/mappings`
- `POST /api/mappings`
- `PUT /api/mappings/:id`
- `DELETE /api/mappings/:id`
- `POST /api/mappings/:id/play`
- `GET /api/logs`

## Known limitations

- Physical preset remapping only works while this bridge service is running
- Bose websocket event payloads may vary by model and firmware
- Some stations require plain HTTP instead of HTTPS to play correctly
- Discovery may fail on some networks; manual IP fallback is supported
