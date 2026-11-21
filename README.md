# Greenhouse IoT: AWS IoT → Python backend → Supabase → Vercel dashboard

```
 ESP32 / sensors ──MQTT──►  AWS IoT Core  ◄──MQTT/TLS 8883──  Python backend (your PC)  ──►  Supabase Postgres
   sensor/co2                (a26va9cqws30jk-ats…)              FastAPI + paho-mqtt           sensor_readings
   sensor/npk                                                   │                              relay_commands
   sensor/soil-moisture      action/relay ◄── {"command":"on"}  │ REST API (:8000)
                                                                ▼
                                                    ngrok https tunnel  ◄──  Vercel dashboard (React + Vite)
```

- **Backend** (`backend/`): subscribes to `sensor/co2`, `sensor/npk` and `sensor/soil-moisture` and stores every message in Supabase. It creates its tables on startup, serves a REST API, and publishes `{"command":"on"|"off"}` to `action/relay`.
- **Frontend** (`frontend/`): live CO₂, NPK and soil-moisture cards that refresh every 5 s, with timestamps and trends, plus **ON / OFF** relay buttons with toast feedback.
- **Database schema** (`backend/schema.sql`): runs automatically. You can also paste it into the Supabase SQL editor.

```
greenhouse-iot/
├── .env                 your real settings (git-ignored)    ├── backend/
├── .env.example         template                            │   ├── app/main.py        FastAPI app + routes
├── .gitignore                                               │   ├── app/mqtt_client.py AWS IoT MQTT/TLS client
└── frontend/                                                │   ├── app/db.py          Postgres pool + queries
    ├── src/App.jsx      dashboard                           │   ├── app/parsing.py     payload → columns
    ├── src/api.js       API client (ngrok header)           │   ├── app/config.py      .env loading
    └── vercel.json                                          │   ├── schema.sql         tables (auto-created)
                                                             │   ├── certs/             AWS IoT certs (git-ignored)
                                                             │   └── run.py, requirements.txt
```

---

## 0. Before you start

- **Python 3.10+**, **Node.js 18+**, a free **ngrok** account (https://dashboard.ngrok.com), and a **Vercel** account.
- `.env` is already filled in with your Supabase and AWS IoT values. Your certificates are in `backend/certs/`: the Amazon Root CA 1, the device certificate and the private key. The private key matches the certificate (checked), and the certificate is valid until 2049.
- **The AWS IoT policy attached to the certificate must allow the backend.** If it doesn't, AWS drops the connection right after connecting, and the log shows `disconnected … reconnecting` in a loop. A minimal policy (replace `<ACCOUNT_ID>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "iot:Connect",
      "Resource": "arn:aws:iot:ap-southeast-2:<ACCOUNT_ID>:client/greenhouse-backend" },
    { "Effect": "Allow", "Action": "iot:Subscribe",
      "Resource": "arn:aws:iot:ap-southeast-2:<ACCOUNT_ID>:topicfilter/sensor/*" },
    { "Effect": "Allow", "Action": "iot:Receive",
      "Resource": "arn:aws:iot:ap-southeast-2:<ACCOUNT_ID>:topic/sensor/*" },
    { "Effect": "Allow", "Action": "iot:Publish",
      "Resource": "arn:aws:iot:ap-southeast-2:<ACCOUNT_ID>:topic/action/relay" }
  ]
}
```
`AWS_IOT_CLIENT_ID` (default `greenhouse-backend`) must match the `client/…` resource. It must also differ from your ESP32's client ID: two connections with the same ID keep disconnecting each other.

## 1. Start the Python backend

macOS / Linux:
```bash
cd greenhouse-iot/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py                      # same as: uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Windows (PowerShell):
```powershell
cd greenhouse-iot\backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python run.py
```
Expected log:
```
[db]   database pool open
[db]   tables ready (sensor_readings, relay_commands)
[mqtt] connecting to a26va9cqws30jk-ats.iot.ap-southeast-2.amazonaws.com:8883 as 'greenhouse-backend'
[mqtt] connected to AWS IoT; subscribed to sensor/co2, sensor/npk, sensor/soil-moisture
[mqtt] sensor/co2 -> row 1 {'sensor_type': 'co2', 'co2_ppm': 812.0}
```
Check it: open http://localhost:8000/api/health. It should show `"database": "ok"` and `"mqtt": "connected"`. Interactive API docs are at http://localhost:8000/docs. In Supabase → Table Editor you'll now see `sensor_readings` and `relay_commands`.

## 2. Expose it with ngrok

```bash
ngrok config add-authtoken <YOUR_NGROK_TOKEN>     # once
ngrok http 8000
```
Copy the `https://….ngrok-free.app` forwarding URL. Put it in `.env` as `NGROK_BACKEND_URL` for your own reference, then test it:
```bash
curl -H "ngrok-skip-browser-warning: true" https://YOUR-SUBDOMAIN.ngrok-free.app/api/health
```
**Tip:** a free ngrok URL changes every time ngrok restarts. Free accounts get one fixed domain (ngrok dashboard → Domains). Use it with `ngrok http --url=your-name.ngrok-free.app 8000` so you set the URL on Vercel only once.

**About the ngrok browser warning:** free ngrok tunnels return an HTML warning page instead of your API unless the request carries an `ngrok-skip-browser-warning` header. The dashboard sends it on every request (`frontend/src/api.js`), and the backend's CORS settings allow it.

## 3. Run the dashboard locally (optional)

```bash
cd greenhouse-iot/frontend
npm install
npm run dev                         # http://localhost:5173
```
Locally it reads `VITE_API_URL` from the project-root `.env` (default `http://localhost:8000`).

## 4. Deploy the dashboard on Vercel

1. Push the project to GitHub. `.env` and `backend/certs/` are git-ignored, so no secrets are pushed. Check with `git status` before your first commit.
2. Vercel → **Add New… → Project** → import the repo.
3. Set **Root Directory** to `frontend`. Vercel detects Vite: build `npm run build`, output `dist`.
4. **Environment Variables** → add `VITE_API_URL` = your ngrok URL, e.g. `https://your-name.ngrok-free.app` (no trailing slash).
5. **Deploy.**

**When the ngrok URL changes:** Vite bakes `VITE_API_URL` into the build, so update the variable and click **Redeploy**. A fixed ngrok domain avoids this.

With the Vercel CLI instead:
```bash
npm i -g vercel
cd greenhouse-iot/frontend
vercel                                   # first time: link the project
vercel env add VITE_API_URL production   # paste the ngrok URL
vercel --prod
```

## 5. Test end to end

1. Keep the backend and ngrok running, and open your Vercel URL. The pills at the top should read **API online · MQTT connected · DB ok**.
2. **Sensor data:** in AWS IoT console → **MQTT test client** → *Publish to a topic*:
   - `sensor/co2` → `{"co2": 812}`
   - `sensor/npk` → `{"nitrogen": 12, "phosphorus": 8, "potassium": 20}`
   - `sensor/soil-moisture` → `{"moisture": 41.5}`

   Within 5 s the cards show the values with "Xs ago". The rows are visible in Supabase → `sensor_readings`.
3. **Relay:** in the MQTT test client, *Subscribe* to `action/relay`. Click **ON** on the dashboard. A green toast appears, and the test client shows `{"command": "on"}`. Click **OFF** and it shows `{"command": "off"}`. Every command is logged in `relay_commands`.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | DB + MQTT status, message counters |
| GET | `/api/sensors/latest` | newest reading per sensor: `{co2, npk, soil_moisture}` |
| GET | `/api/sensors/history?sensor=co2&limit=100&since_hours=24` | readings, newest first; `sensor` = `co2` \| `npk` \| `soil_moisture` (or `soil-moisture`), omit for all |
| POST | `/api/relay` (alias `/api/relay/command`) | body `{"command":"on"}` or `{"command":"off"}` → publishes to `action/relay` (QoS 1, waits for AWS acknowledgement) |
| GET | `/api/relay/history?limit=20` | relay command log |

Accepted sensor payloads: JSON or plain values. Key names are not case-sensitive and may be nested one level. The full message is always stored in `payload` (jsonb).

| Topic | Examples that are parsed into columns |
|---|---|
| `sensor/co2` | `{"co2": 812}` · `{"co2_ppm": 812}` · `{"ppm": 812}` · `{"value": 812}` · `812` |
| `sensor/npk` | `{"nitrogen":12,"phosphorus":8,"potassium":20}` · `{"N":12,"P":8,"K":20}` · `{"n_mgkg":12,…}` · `12,8,20` |
| `sensor/soil-moisture` | `{"moisture": 41.5}` · `{"soil_moisture": 41.5}` · `{"moisture_pct": 41.5}` · `{"data":{"soil_moisture":"41.5"}}` · `41.5` |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `config: AWS_IOT_… file not found` | Run from `backend/` or use absolute paths; relative paths in `.env` are resolved from the project root |
| `cannot reach …:8883 over TLS` | Port 8883 blocked by your network (some campus/office Wi-Fi blocks it): try another network or a phone hotspot |
| `disconnected … reconnecting` loop right after connecting | IoT policy doesn't allow this client ID or topic, or another device uses the same client ID |
| `AWS IoT refused the connection` | Certificate not **Active** or not attached to a policy/thing in the AWS console |
| `cannot use the database (DB_URL)` | Wrong password (`@` must be `%40`), Supabase project paused (restore it in the dashboard), or a firewall blocking port 5432 |
| Dashboard: "Backend did not return JSON" | ngrok URL changed or ngrok isn't running. Update `VITE_API_URL` on Vercel and redeploy |
| Dashboard: "Failed to fetch" | Backend not running, `VITE_API_URL` uses `http://` (Vercel needs the `https://` ngrok URL), or `CORS_ORIGINS` doesn't include your Vercel domain |
| Relay: "not connected to AWS IoT" | Backend's MQTT link is down; check `/api/health` and the backend log |
| Relay: "too fast" | One command per second (`RELAY_MIN_INTERVAL_S`) |

## Security notes

- `.env` (database password) and `backend/certs/` (device private key) are git-ignored. Never commit them or paste them into the frontend.
- The database password and private key were shared in a chat while building this. Consider resetting the Supabase database password (Project Settings → Database). For a production system, create a fresh IoT certificate for the backend.
- Anyone who knows the ngrok URL can call the API, including `/api/relay`. Optionally set `RELAY_API_KEY` in `.env`, and the same value as `VITE_RELAY_API_KEY` on Vercel. Note that a key in a browser app is visible to anyone who opens the site, so this only stops casual visitors to the ngrok URL. Restrict `CORS_ORIGINS` to your Vercel domain as well.
- Both tables have Row Level Security on with no policies. That blocks Supabase's public REST API, while the backend (database owner) works normally.
