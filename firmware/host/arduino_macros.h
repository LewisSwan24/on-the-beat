// The names Arduino.h and the ESP32 core's esp32-hal.h and esp32-hal-gpio.h
// make macros before any firmware file is compiled (arduino-esp32 2.x). A name
// here, used in band_logic.h, is replaced before the band's compiler sees it:
// a note table called LOW became `constexpr Note 0x0[]`. Only the names
// matter, so the values are kept plain.

#pragma once

#define ANALOG 0xC0
#define CHANGE 0x03
#define DEFAULT 1
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define DISABLED 0x00
#define DISPLAY 0x1
#define EULER 2.718281828459045235360287471352
#define EXTERNAL 0
#define FALLING 0x02
#define HALF_PI 1.5707963267948966192313216916398
#define HIGH 0x1
#define INPUT 0x01
#define INPUT_PULLDOWN 0x09
#define INPUT_PULLUP 0x05
#define LOW 0x0
#define LSBFIRST 0
#define MSBFIRST 1
#define NOT_AN_INTERRUPT -1
#define NOT_A_PIN -1
#define NOT_A_PORT -1
#define NOT_ON_TIMER 0
#define ONHIGH 0x05
#define ONHIGH_WE 0x0D
#define ONLOW 0x04
#define ONLOW_WE 0x0C
#define OPEN_DRAIN 0x10
#define OUTPUT 0x03
#define OUTPUT_OPEN_DRAIN 0x13
#define PI 3.1415926535897932384626433832795
#define PULLDOWN 0x08
#define PULLUP 0x04
#define RAD_TO_DEG 57.295779513082320876798154814105
#define RISING 0x01
#define SERIAL 0x0
#define TWO_PI 6.283185307179586476925286766559

#define _BV(b) (1UL << (b))
#define _abs(x) ((x) > 0 ? (x) : -(x))
#define _max(a, b) ((a) > (b) ? (a) : (b))
#define _min(a, b) ((a) < (b) ? (a) : (b))
#define _round(x) ((x) >= 0 ? (long)((x) + 0.5) : (long)((x) - 0.5))
#define bit(b) (1UL << (b))
#define bitClear(value, b) ((value) &= ~(1UL << (b)))
#define bitRead(value, b) (((value) >> (b)) & 0x01)
#define bitSet(value, b) ((value) |= (1UL << (b)))
#define bitToggle(value, b) ((value) ^= (1UL << (b)))
#define bitWrite(value, b, v) ((v) ? bitSet(value, b) : bitClear(value, b))
#define cli() 0
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define highByte(w) ((uint8_t)((w) >> 8))
#define interrupts() sei()
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define noInterrupts() cli()
#define radians(deg) ((deg) * DEG_TO_RAD)
#define sei() 0
#define sq(x) ((x) * (x))
#define word(w) (w)
