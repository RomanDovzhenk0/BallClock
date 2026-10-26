// The settings of build() in firmware/src/settings.cpp (plus kaia_wake and kaia_wake_speed of v1.5, and the looks per event of v1.6):
// their kinds, ranges and the defaults of db.init(). Text keys stay strings, every other one is a number.

export const TEXT_KEYS = ["ntp_host", "log_host", "wifi_ssid", "wifi_pass", "page_pass"];
// only ever written: the state never carries them
export const SECRET_KEYS = ["wifi_pass", "page_pass"];

export const DEFAULTS = {
    wifi_ssid: "", wifi_pass: "", show_ip: 1,
    ntp_host: "pool.ntp.org", ntp_gmt: 3,
    bright: 100, auto_bright: 0, bright_min: 10, bright_max: 255, adc_min: 0, adc_max: 1023,
    night_mode: 0, night_mode_auto: 0, night_mode_auto_since: 0, night_mode_auto_to: 0, night_color: 0xff0000, night_trsh: 50,
    clock_style: 1, clock_style_zero: 0, clock_color: 0xffffff,
    back_mode: 1, back_pal: 0, back_bright: 200, back_speed: 50, back_scale: 50, back_angle: 0,
    kaia_anim: 1, kaia_wake: 0, kaia_wake_speed: 100,
    kaia_listen: 0, kaia_think: 0, kaia_speak: 0, kaia_done: 0, kaia_error: 0, kaia_notify: 0,
    kaia_color: 0x00d1ff, kaia_bright: 255, kaia_night: 1,
    page_pass: "", log_host: "",
};

// the look of each event, by anim (A_WAKE … A_NOTIFY): 0 = as the style, 1–3 the style versions, 4 and up the new ones
export const LOOK_KEYS = ["kaia_wake", "kaia_listen", "kaia_think", "kaia_speak", "kaia_done", "kaia_error", "kaia_notify"];

// the state's settings → numbers and strings, missing keys from the defaults
export function normalize(raw) {
    const s = {};
    for (const k of Object.keys(DEFAULTS)) {
        const v = raw && raw[k];
        if (TEXT_KEYS.includes(k)) s[k] = v == null ? DEFAULTS[k] : String(v);
        else {
            const n = typeof v === "boolean" ? +v : Number(v);
            s[k] = v == null || v === "" || !Number.isFinite(n) ? DEFAULTS[k] : Math.trunc(n);
        }
    }
    return s;
}

// the raw value the Settings API takes: decimal numbers, 0/1, 24-bit colours, seconds, text as it is
export const rawOf = (k, v) => (TEXT_KEYS.includes(k) ? String(v) : String(Math.trunc(Number(v))));
