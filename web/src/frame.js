// One 50 ms frame of the clock, as redraw.cpp's timer draws it: the background (or black at night), the time
// with the digit balls marked, then Kaya's overlay (kaiaDraw). Pure: the same inputs give the same 128 colours.
import {
    A_DONE, A_ERROR, A_LISTENING, A_NOTIFY, A_OFF, A_SPEAKING, A_THINKING, A_WAKE, ANIM_NAMES, C_AMBER, C_GREEN, C_RED, fr, imin, smooth, useMatrix,
} from "./kaia.js";
import { LOOK_COUNT, shotLength, shotLook, stateLook, wakeDraw } from "./looks.js";
import { BallMatrix } from "./matrix.js";
import { drawBack, drawClock } from "./redraw.js";
import { WAKE_COUNT, wakeLength } from "./wakes.js";

export const KAIA_STATE_MS = 30000;

// kaiaBackScale: 255 = the background as set, less while the overlay plays
export const backScale = (duck) => 255 - (140 * duck / 255 | 0);

// kaiaDraw's duck: one step a frame towards 255 while the overlay plays, 0 when it does not
export function duckStep(duck, playing) {
    const target = playing ? 255 : 0;
    let step = (target - duck) * 72 / 256 | 0;
    if (!step && target !== duck) step = target > duck ? 1 : -1;
    return duck + step;
}

// the duck after n frames from d
export function duckAfter(d, playing, n) {
    for (let k = 0; k < n && k < 64; k++) d = duckStep(d, playing);
    return d;
}

// the Digit fade (v1.7): the time's level h, 16 bits (0 = shown, 65535 = gone). Stepped by the real ms between two frames
// (dt, capped so the uint32 product cannot overflow): up while an animation is drawn, down once kaia_hide_hold ms
// have passed since the last one (sinceEnd); a new animation turns it round where it stands. kaia_hide 0 → 0 at once.
// S: kaia_hide, kaia_hide_out, kaia_hide_in, kaia_hide_hold (read as their defaults when out of range)
export function hideStep(h, dt, playing, sinceEnd, S) {
    if (!S.kaia_hide) return 0;
    if (dt > 60000) dt = 60000;
    if (playing) {
        h += 65535 * dt / S.kaia_hide_out | 0;
        return h > 65535 ? 65535 : h;
    }
    if (sinceEnd >= S.kaia_hide_hold) {
        h -= 65535 * dt / S.kaia_hide_in | 0;
        return h < 0 ? 0 : h;
    }
    return h;
}

// kaiaDigitScale(): how much of the time the level h takes away, 0–255 (smoothstep of h, less by kaia_hide_keep %)
export function digitHide(S, h) {
    if (!S.kaia_hide) return 0;
    return smooth(0, 65535, h) * (100 - S.kaia_hide_keep) / 100 | 0;
}

// the level's own state, as kaiaDraw keeps it in ov: {h (level), t (millis of the last frame), end (millis the last
// animation stopped), on (1 while one drew)}; one call a frame with whether an animation is drawn now
export function hideTrack(L, S, playing, now) {
    const dt = now - L.t;
    L.t = now;
    if (playing) L.on = 1;
    else if (L.on) {
        L.on = 0;
        L.end = now;
    }
    L.h = hideStep(L.h, dt, playing, now - L.end, S);
    return L.h;
}

// an animation is drawn this frame: resolvePlay gives a play and neither the night rule 2 nor the style «Выкл» hides it
// (the running text never counts: it is not a play)
export function isPlaying(S, night, play) {
    return !!(S.kaia_anim && resolvePlay(play) && !(night && S.kaia_night === 2));
}

export const isState = (anim) => anim === A_LISTENING || anim === A_THINKING || anim === A_SPEAKING;
export const animOf = (name) => ANIM_NAMES.indexOf(name);

// what plays at its t: a wake past its length is the listening after it (t from its end, in the listening's look lk),
// a one-shot past its length or a state past its ms is nothing.
// play: {anim, style 1–3, look (the event's; v1.5's wake for a wake), lk (the listening's look after a wake), speed, t,
// color (null = the default), ms}
export function resolvePlay(play) {
    if (!play || play.anim < 0 || play.anim === A_OFF || !(play.style >= 1 && play.style <= 3)) return null;
    const look = play.look != null ? play.look : play.anim === A_WAKE ? play.wake || 0 : 0;
    // a look past the last is the last (the clock answers 400 to one)
    let p = { ...play, look: imin(look, play.anim === A_WAKE ? WAKE_COUNT - 1 : LOOK_COUNT - 1), lk: imin(play.lk || 0, LOOK_COUNT - 1) };
    if (p.anim === A_WAKE) {
        const len = wakeLength(p.look || p.style, p.speed || 100);
        if (p.t >= len) p = { ...p, anim: A_LISTENING, look: p.lk || 0, t: p.t - len };
    } else if (!isState(p.anim)) {
        if (p.t >= shotLength(p.anim, p.look, p.style)) return null;
    }
    if (isState(p.anim) && p.t >= (p.ms || KAIA_STATE_MS)) return null;
    return p.t < 0 ? null : p;
}

// the colour it draws with: the call's, or Kaya's (done green, error red, notify amber)
export function playColor(S, p) {
    if (p.color != null) return p.color;
    if (p.anim === A_DONE) return C_GREEN;
    if (p.anim === A_ERROR) return C_RED;
    if (p.anim === A_NOTIFY) return C_AMBER;
    return S.kaia_color;
}

// kaiaDraw over the clock; night = night mode is on; hide = digitHide(): the digit balls take the overlay that much more
export function kaiaDraw(S, night, play, hide) {
    const rule = S.kaia_night;
    const p = resolvePlay(play);
    if (!p || (night && rule === 2)) return false;
    fr.sc = S.kaia_bright * (night && rule === 1 ? 77 : 255) / 255 | 0;
    fr.dg = 89;
    fr.hd = hide || 0;
    const col = playColor(S, p);

    if (isState(p.anim)) stateLook(p.style, p.look, p.anim, p.t, col, 255);
    else if (p.anim === A_WAKE) wakeDraw(p.style, p.look, p.lk || 0, p.speed || 100, p.t, col);
    else shotLook(p.style, p.look, p.anim, p.t, col);
    fr.hd = 0;
    return true;
}

// S: the settings (numbers); c: {millis, synced, hour, minute, ms (within the second), night, play, duck, hide (the
// Digit fade's level, 0–65535; absent = 0)}
export function renderFrame(m, S, c) {
    const hd = digitHide(S, c.hide || 0);
    useMatrix(m);
    if (c.night) {
        m.clear();
        m.setColor24(S.night_color);
    } else {
        drawBack(m, S, c.millis, backScale(c.duck || 0));
        m.setColor24(S.clock_color);
    }
    // the overlay keeps the time readable on the balls the clock marks; the Digit fade melts the time into what is under it
    m.alpha = 255 - hd;
    m.beginMarks();
    drawClock(m, S, c);
    m.endMarks();
    m.alpha = 255;
    kaiaDraw(S, c.night, c.play, hd);
    return m.leds;
}

// a frame into a new strip, for the tests and one-off renders
export function frameOf(S, c) {
    return Uint32Array.from(renderFrame(new BallMatrix(), S, c));
}
