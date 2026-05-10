# soundretouch-bridge

`soundretouch-bridge` is a small local Node/TypeScript service for Bose SoundTouch speakers. It is meant to bring the preset buttons back to life after the SoundTouch cloud shutdown.

A preset mapping is simple: you choose one preset button on a speaker and assign a stream URL to it. When that preset button is pressed, the bridge starts playing that stream directly on the speaker. You can create these mappings in the web UI or by editing the config file manually.

Because the SoundTouch cloud is gone, the original preset behavior no longer works for TuneIn and radio stations that depended on it. When this service runs inside your network, it discovers speakers on the LAN, listens for preset selection events over the local websocket connection, matches those events to your saved preset mappings, and tells the speaker to start playback directly with the configured stream URL over the local AVTransport interface.


## What it does

- Auto-discovers SoundTouch speakers on the LAN with SSDP
- Supports manual speaker IP entry
- Serves a simple web UI for preset mappings
- Connects to each speaker's websocket on port `8080`
- Remaps configured presets to stream URLs with `SoundTouchDevice.playStreamUrl()`
- Stores configuration in `data/config.json`

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

Open the frontend from another device on your LAN at:

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
2. Add a speaker manually by IP or click `Refresh discovery`.
3. Click a preset button on a speaker card to configure it.
4. Enter a station name and stream URL.
5. Save the mapping.
6. Press the physical preset buttons on the speaker and watch `Debug`.

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

Writes are done atomically through a temporary file and rename.

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

- Only HTTP streams are supported, not HTTPS
