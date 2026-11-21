/*
  Relay_Node_BLE.ino
  ESP32 DevKit V1
  BLE Slave for QNX Gateway Master
  First test: Built-in LED on GPIO 2
*/

#include <Arduino.h>
#include <NimBLEDevice.h>

#define NODE_NAME "Relay-Node"
#define LED_PIN 2

static const char *DATA_SERVICE_UUID =
  "a1b2c300-0000-4e0a-9f3d-5c6b7a8e0200";

static const char *DATA_CHAR_UUID =
  "a1b2c300-0000-4e0a-9f3d-5c6b7a8e0201";

static const char *CTRL_SERVICE_UUID =
  "a1b2c300-0000-4e0a-9f3d-5c6b7a8e0100";

static const char *CMD_UUID =
  "a1b2c300-0000-4e0a-9f3d-5c6b7a8e0101";

static const char *RSP_UUID =
  "a1b2c300-0000-4e0a-9f3d-5c6b7a8e0102";

NimBLEServer *server = nullptr;
NimBLECharacteristic *dataChr = nullptr;
NimBLECharacteristic *rspChr = nullptr;

bool ledState = false;

void setLED(bool state) {
  ledState = state;
  digitalWrite(LED_PIN, state ? HIGH : LOW);
}

void reply(const char *message) {
  rspChr->setValue(message);

  if (server->getConnectedCount() > 0) {
    rspChr->notify();
  }

  Serial.println(message);
}

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(
    NimBLECharacteristic *c,
    NimBLEConnInfo &
  ) override {

    std::string value = c->getValue();

    String cmd(value.c_str());
    cmd.trim();
    cmd.toLowerCase();

    Serial.print("BLE Command: ");
    Serial.println(cmd);

    if (cmd == "led on") {
      setLED(true);
      reply("ok led=on");
    }
    else if (cmd == "led off") {
      setLED(false);
      reply("ok led=off");
    }
    else if (cmd == "ping") {
      reply("pong");
    }
    else if (cmd == "info") {
      reply("Relay-Node LED test");
    }
    else {
      reply("err unknown command");
    }
  }
};

void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  setLED(false);

  NimBLEDevice::init(NODE_NAME);
  NimBLEDevice::setMTU(247);

  server = NimBLEDevice::createServer();

  // Data service required by the existing master
  NimBLEService *ds =
    server->createService(DATA_SERVICE_UUID);

  dataChr = ds->createCharacteristic(
    DATA_CHAR_UUID,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::NOTIFY
  );

  dataChr->setValue(
    "{\"node\":\"Relay-Node\",\"status\":\"ready\"}"
  );

  ds->start();

  // Control service
  NimBLEService *cs =
    server->createService(CTRL_SERVICE_UUID);

  NimBLECharacteristic *cmdChr =
    cs->createCharacteristic(
      CMD_UUID,
      NIMBLE_PROPERTY::WRITE |
      NIMBLE_PROPERTY::WRITE_NR
    );

  cmdChr->setCallbacks(new CommandCallbacks());

  rspChr = cs->createCharacteristic(
    RSP_UUID,
    NIMBLE_PROPERTY::READ |
    NIMBLE_PROPERTY::NOTIFY
  );

  rspChr->setValue("ready");

  cs->start();

  // Advertise
  NimBLEAdvertising *adv =
    NimBLEDevice::getAdvertising();

  adv->setName(NODE_NAME);
  adv->addServiceUUID(DATA_SERVICE_UUID);
  adv->start();

  Serial.println("==========================");
  Serial.println("RELAY BLE SLAVE READY");
  Serial.println("BLE Name: Relay-Node");
  Serial.println("LED Pin: GPIO 2");
  Serial.println("==========================");
}

void loop() {
  delay(10);
}