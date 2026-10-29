// GENERATED from td/remembered/control_schema.py (python td/remembered/control_schema.py): do not edit by hand.
// River\remembered\control.json's fields, defaults and ranges (docs/remembered-river.md section 5), shared by
// lib/mission.mjs, remembered-words.js and remembered.js. tools/tests/test_control_schema.py checks it is current.
export default {
  "fields": {
    "pool_height_m": {
      "type": "number",
      "min": 0.0,
      "max": 1.5,
      "default": null,
      "doc": "the pool line, metres above the floor; null: the zones file's own"
    },
    "light": {
      "type": "enum",
      "choices": [
        "off",
        "pool",
        "eddies",
        "leds"
      ],
      "default": "off",
      "doc": "off: the show; pool / eddies / leds: light those LEDs to check them. Never survives a restart of the show, and goes back to off by itself after light_max_s"
    },
    "light_at": {
      "type": "time",
      "default": null,
      "doc": "when light was last set (UTC, ISO 8601); a light set before the show started, or over light_max_s ago, is ignored. Absent: the file's at, else its write time"
    },
    "leds": {
      "type": "list",
      "default": [],
      "doc": "light: leds only: [{rope, from, to}] (zones.py light leds --write)"
    },
    "opening_night": {
      "type": "bool",
      "default": true,
      "doc": "the opening-night switch: on unless the file says false"
    },
    "screens.intensity": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.82,
      "doc": "how bright the four screens are, ribbons and video alike"
    },
    "screens.threshold": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.35,
      "doc": "how much the river has to move to show in its video"
    },
    "screens.video": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.7,
      "doc": "how strongly the river video shows under the particle windows (0: the particles alone)"
    },
    "screens.mode": {
      "type": "enum",
      "choices": [
        "particles",
        "water"
      ],
      "default": "particles",
      "doc": "particles: one field seen through the screens as windows; water: the river video"
    },
    "screens.field": {
      "type": "enum",
      "choices": [
        "ribbons",
        "fine",
        "streaks"
      ],
      "default": "ribbons",
      "doc": "what the particle windows look onto"
    },
    "screens.gpu": {
      "type": "bool",
      "default": true,
      "doc": "the ribbons drawn on the GPU while its shaders are healthy"
    },
    "screens.motion_mask": {
      "type": "bool",
      "default": true,
      "doc": "all-looks only: false lets recorded video bypass the motion mask"
    },
    "at": {
      "type": "time",
      "default": null,
      "doc": "when the file was last written (UTC, ISO 8601)"
    }
  },
  "light_max_s": 600.0,
  "ui": {
    "lights": [
      "off",
      "pool",
      "eddies"
    ],
    "pool_height_m": 0.6
  }
};
