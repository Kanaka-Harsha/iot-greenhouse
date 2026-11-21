-- schema.sql - tables used by the greenhouse IoT backend.
-- The backend runs this automatically on startup (every statement is idempotent).
-- You can also paste it into the Supabase SQL editor to create or inspect the tables.

-- One row per MQTT message received on sensor/co2, sensor/npk or sensor/soil-moisture.
create table if not exists public.sensor_readings (
    id             bigserial primary key,
    topic          text        not null,                 -- e.g. 'sensor/npk'
    sensor_type    text        not null                  -- 'co2' | 'npk' | 'soil_moisture'
                   check (sensor_type in ('co2', 'npk', 'soil_moisture')),
    payload        jsonb       not null,                 -- full message as received (non-JSON -> {"raw": "..."})
    co2_ppm        double precision,                     -- sensor/co2
    nitrogen       double precision,                     -- sensor/npk (mg/kg)
    phosphorus     double precision,
    potassium      double precision,
    soil_moisture  double precision,                     -- sensor/soil-moisture (%)
    created_at     timestamptz not null default now()    -- time the backend received it
);

create index if not exists sensor_readings_type_time_idx
    on public.sensor_readings (sensor_type, created_at desc);

-- Audit log of every relay command sent from the dashboard.
create table if not exists public.relay_commands (
    id            bigserial primary key,
    command       text        not null check (command in ('on', 'off')),
    topic         text        not null,                  -- 'action/relay'
    payload       jsonb       not null,                  -- {"command": "on"}
    status        text        not null                   -- 'published' | 'failed'
                  check (status in ('published', 'failed')),
    error         text,
    client_ip     text,
    created_at    timestamptz not null default now()
);

create index if not exists relay_commands_time_idx
    on public.relay_commands (created_at desc);

-- Supabase exposes tables in "public" through its REST API. Row Level Security with
-- no policies blocks that public API; the backend connects as the database owner
-- (DB_URL) and is not affected.
alter table public.sensor_readings enable row level security;
alter table public.relay_commands  enable row level security;
