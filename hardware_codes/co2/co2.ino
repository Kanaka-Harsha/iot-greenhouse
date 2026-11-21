
/*
  MH-Z19C CO2 Sensor + ESP32 DevKit V4

  ESP32 GPIO 16 (RX2) <- Sensor TX
  ESP32 GPIO 17 (TX2) -> Sensor RX

  Sensor supply: 5V
  UART: 9600 baud
*/

#include <Arduino.h>

#define MHZ19_RX 16
#define MHZ19_TX 17

HardwareSerial MHZ19(2);

uint8_t command[9] = {
  0xFF, 0x01, 0x86,
  0x00, 0x00, 0x00,
  0x00, 0x00, 0x79
};

void setup() {
  Serial.begin(115200);

  MHZ19.begin(
    9600,
    SERIAL_8N1,
    MHZ19_RX,
    MHZ19_TX
  );

  Serial.println("MH-Z19C CO2 Sensor");
  Serial.println("Warming up sensor...");

  delay(60000);  // 1 minute preheating

  Serial.println("Sensor ready!");
}

void loop() {

  // Clear previous UART data
  while (MHZ19.available()) {
    MHZ19.read();
  }

  // Request CO2 measurement
  MHZ19.write(command, 9);
  MHZ19.flush();

  // Wait for sensor response
  uint8_t response[9];
  uint8_t index = 0;

  unsigned long startTime = millis();

  while (index < 9 && millis() - startTime < 1000) {
    if (MHZ19.available()) {
      response[index++] = MHZ19.read();
    }
  }

  if (index == 9) {

    // Validate response header and command
    if (response[0] == 0xFF &&
        response[1] == 0x86) {

      // Validate checksum
      uint8_t checksum = 0;

      for (int i = 1; i < 8; i++) {
        checksum += response[i];
      }

      checksum = 0xFF - checksum + 1;

      if (checksum == response[8]) {

        // Calculate CO2 concentration
        int co2 = response[2] * 256 + response[3];

        Serial.print("CO2 Concentration: ");
        Serial.print(co2);
        Serial.println(" ppm");

      } else {
        Serial.println("Checksum error!");
      }

    } else {
      Serial.println("Invalid sensor response!");
    }

  } else {
    Serial.println("Sensor timeout!");
  }

  delay(2000);
}
