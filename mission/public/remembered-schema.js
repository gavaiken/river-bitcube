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
    },
    "overrides": {
      "type": "overrides",
      "default": {},
      "doc": "manual overrides of the parameters the show drives: {param: {mode: fix|adjust, value, offset, gain, at, expires_at}}; see params"
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
  },
  "params": {
    "day": {
      "type": "date",
      "default": null,
      "unit": "",
      "group": "day",
      "modes": [
        "auto",
        "fix"
      ],
      "doc": "the remembered day playing (YYYY-MM-DD, a day in data/remembered/days.csv); auto: Dave's pick, else a notable day, else the preset"
    },
    "surge_hour": {
      "type": "number",
      "min": 0.0,
      "max": 24.0,
      "default": null,
      "unit": "h",
      "group": "day",
      "modes": [
        "auto",
        "fix",
        "adjust"
      ],
      "doc": "the remembered hour the main surge lands on (the loop plays 24 h in 5 min); auto: Dave's surge_at, else the day's heaviest hour"
    },
    "knob.speed": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.5,
      "unit": "",
      "group": "knobs",
      "modes": [
        "auto",
        "fix",
        "adjust"
      ],
      "doc": "how fast the water runs down the ropes"
    },
    "knob.density": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.5,
      "unit": "",
      "group": "knobs",
      "modes": [
        "auto",
        "fix",
        "adjust"
      ],
      "doc": "how many ropes carry drips and streams"
    },
    "knob.brightness": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.5,
      "unit": "",
      "group": "knobs",
      "modes": [
        "auto",
        "fix",
        "adjust"
      ],
      "doc": "how bright the water is"
    },
    "knob.turbulence": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.5,
      "unit": "",
      "group": "knobs",
      "modes": [
        "auto",
        "fix",
        "adjust"
      ],
      "doc": "how rough: splashes, sloshing, the ribbons swirling"
    },
    "palette": {
      "type": "palette",
      "default": null,
      "unit": "",
      "group": "look",
      "modes": [
        "auto",
        "fix"
      ],
      "doc": "the three colours, deep / mid / light ('#rrggbb'); auto: the day's season and Dave's colours"
    },
    "flow_level": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.5,
      "unit": "",
      "group": "ropes",
      "modes": [
        "auto",
        "fix",
        "adjust"
      ],
      "doc": "how hard the ropes flow: what the gallery hears, else how much the river camera moves"
    },
    "headcount": {
      "type": "number",
      "min": 0.0,
      "max": 20.0,
      "default": null,
      "unit": "people",
      "group": "room",
      "modes": [
        "auto",
        "fix"
      ],
      "simulated": true,
      "doc": "people in the room (the counter); fix: SIMULATE that many, for 2 minutes at most"
    },
    "lingerer_rope": {
      "type": "int",
      "min": 0,
      "max": 19,
      "default": null,
      "unit": "rope",
      "group": "room",
      "modes": [
        "auto",
        "fix"
      ],
      "simulated": true,
      "doc": "someone standing still by this rope (the counter); fix: SIMULATE a lingerer there, for 2 minutes at most"
    },
    "calm_min": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.18,
      "unit": "",
      "group": "ropes",
      "modes": [
        "auto",
        "fix",
        "adjust"
      ],
      "doc": "the floor of the calm brightness curve (the day's hours, the room, a slow drift)"
    },
    "calm_max": {
      "type": "number",
      "min": 0.0,
      "max": 1.0,
      "default": 0.6,
      "unit": "",
      "group": "ropes",
      "modes": [
        "auto",
        "fix",
        "adjust"
      ],
      "doc": "the ceiling of the calm brightness curve"
    },
    "master_brightness": {
      "type": "number",
      "min": 0.0,
      "max": 1.5,
      "default": 1.0,
      "unit": "x",
      "group": "ropes",
      "modes": [
        "auto",
        "fix",
        "adjust"
      ],
      "doc": "every rope's brightness times this (the power limit still applies)"
    }
  },
  "overrides": {
    "modes": [
      "auto",
      "fix",
      "adjust"
    ],
    "simulated": [
      "headcount",
      "lingerer_rope"
    ],
    "simulated_max_s": 120.0,
    "gain": [
      0.0,
      4.0
    ],
    "days": {
      "first": "2002-10-01",
      "last": "2023-01-30",
      "count": 7427
    }
  }
};
