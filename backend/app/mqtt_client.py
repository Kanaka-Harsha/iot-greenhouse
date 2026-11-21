"""AWS IoT Core connection: MQTT over TLS (port 8883) with the device certificate.

Subscribes to the sensor topics and stores every message; publishes relay commands.
paho runs its network loop in a background thread and reconnects by itself.
"""
from __future__ import annotations

import json
import logging
import ssl
import threading
import time

import paho.mqtt.client as mqtt

from . import db
from .config import Settings
from .parsing import parse_reading

log = logging.getLogger("mqtt")


class IoTClient:
    def __init__(self, s: Settings):
        self.s = s
        self.connected = threading.Event()
        self.stats = {"received": 0, "stored": 0, "store_errors": 0, "published": 0,
                      "last_message_at": None, "last_error": None}
        self.client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=s.aws_iot_client_id, protocol=mqtt.MQTTv311,
                                  clean_session=True)
        ctx = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=s.aws_iot_ca_path)
        ctx.load_cert_chain(certfile=s.aws_iot_cert_path, keyfile=s.aws_iot_key_path)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        self.client.tls_set_context(ctx)
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        self.client.on_connect_fail = self._on_connect_fail
        self._last_fail_log = 0.0

    # ---------------------------------------------------------------- lifecycle
    def start(self) -> None:
        log.info("connecting to %s:%s as '%s'", self.s.aws_iot_endpoint, self.s.aws_iot_port,
                 self.s.aws_iot_client_id)
        # connect_async + loop_start: startup is not blocked if AWS is unreachable;
        # paho keeps retrying in the background.
        self.client.connect_async(self.s.aws_iot_endpoint, self.s.aws_iot_port, keepalive=60)
        self.client.loop_start()

    def stop(self) -> None:
        self.client.disconnect()
        self.client.loop_stop()

    # ---------------------------------------------------------------- callbacks
    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            self.stats["last_error"] = f"connect refused: {reason_code}"
            log.error("AWS IoT refused the connection: %s (check certificate, policy and client id)",
                      reason_code)
            return
        self.connected.set()
        for t in self.s.sensor_topics:
            client.subscribe(t, qos=1)
        log.info("connected to AWS IoT; subscribed to %s", ", ".join(self.s.sensor_topics))

    def _on_connect_fail(self, client, userdata):
        # TCP/TLS failed before MQTT started (DNS, firewall, bad CA/cert/key). paho retries.
        self.stats["last_error"] = "connect failed (network or TLS)"
        if time.time() - self._last_fail_log > 30:       # don't flood the log
            self._last_fail_log = time.time()
            log.error("cannot reach %s:%s over TLS (network, DNS or certificate problem); retrying",
                      self.s.aws_iot_endpoint, self.s.aws_iot_port)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        self.connected.clear()
        if reason_code != 0:
            self.stats["last_error"] = f"disconnected: {reason_code}"
            log.warning("disconnected from AWS IoT (%s); reconnecting", reason_code)

    def _on_message(self, client, userdata, msg: mqtt.MQTTMessage):
        self.stats["received"] += 1
        self.stats["last_message_at"] = time.time()
        try:
            row = parse_reading(msg.topic, msg.payload)
            if row is None:
                log.debug("ignored message on %s", msg.topic)
                return
            rid = db.insert_reading(row)
            self.stats["stored"] += 1
            log.info("%s -> row %s %s", msg.topic, rid,
                     {k: v for k, v in row.items() if k not in ("payload", "topic") and v is not None})
        except Exception as e:  # noqa: BLE001  (never let the network thread die)
            self.stats["store_errors"] += 1
            self.stats["last_error"] = f"store failed: {e}"
            log.exception("could not store message from %s", msg.topic)

    # ---------------------------------------------------------------- publish
    def publish_relay(self, command: str, timeout: float = 5.0) -> dict:
        """Publishes {"command": "on"|"off"} to the relay topic and waits for the PUBACK."""
        if not self.connected.is_set():
            raise RuntimeError("not connected to AWS IoT")
        payload = {"command": command}
        info = self.client.publish(self.s.relay_topic, json.dumps(payload), qos=1)
        info.wait_for_publish(timeout=timeout)
        if not info.is_published():
            raise RuntimeError("AWS IoT did not acknowledge the publish within %.0f s" % timeout)
        self.stats["published"] += 1
        log.info("published %s to %s", payload, self.s.relay_topic)
        return payload
