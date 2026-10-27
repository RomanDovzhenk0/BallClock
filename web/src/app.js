// The page (KAIA-161 variant B «Сцена», v1.6 as KAIA-172 variant b): a big preview with «Сейчас» / «Черновик» /
// «Сравнить», Kaya's events beside it, the settings in tabs under it, the palette picker, Kaya's look per event with
// live thumbnails and a gallery (a sheet on the phone), the try-out on the clock and the save bar. v1.8 (KAIA-195): the
// «Стиль» picker by sight for styles 0–9, and every event's gallery lists the new styles' versions. v1.9 (KAIA-201's
// design): the picker in groups with chips (one group on the phone, the chosen style's by default) and «Сейчас выбран»
// under them; catalog A's Снежинка, Светлячки and Пламя (10–12); catalog B's Аркада, Тетрис, Механизм, Неон, Маятник and
// Гирлянда (13–18); catalog C's single animations in every event's gallery, group «Новые анимации» (looks 24–27, wakes 30–33).
import { AuthError, ClockApi, fetchSend, ID_CHECK_UPDATES, ID_OTA_UPDATE, ID_WIFI_SAVE, keyId, OfflineError, parseLeds, TRY_STATE_MS, tryOut } from "./api.js";
import { ClockSync, parseTime } from "./clock.js";
import { animOf, digitHide, duckStep, hideTrack, isPlaying, isState, kaiaDraw, renderFrame, resolvePlay } from "./frame.js";
import { A_WAKE, ANIM_NAMES, useMatrix } from "./kaia.js";
import { LOOK_COUNT, LOOK_NAMES, look_style, shotLength, style_look } from "./looks.js";
import { BallMatrix } from "./matrix.js";
import { createMock, MOCK_PASS } from "./mock.js";
import { fitCanvas, IVORY, paint, readUnlit, setUnlit, unlit } from "./paint.js";
import { PAL_GROUP, PAL_GROUPS, PAL_NAMES, PAL_ORDER, PAL_RU, PALETTES } from "./palettes.js";
import { brightNow, isNight } from "./redraw.js";
import { LOOK_KEYS, normalize, rawOf } from "./settings.js";
import { STYLE_COUNT, STYLE_NAMES } from "./styles.js";
import { style_wake, WAKE_COUNT, wake_style, wakeLength, wakeOf } from "./wakes.js";

const QS = new URLSearchParams(location.search);
const MOCK = QS.has("mock");
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mock = MOCK ? createMock() : null;
const api = new ClockApi(mock ? mock.send : fetchSend);
const PASS_KEY = "ballclock.pass";
let store = null;
try {
    store = localStorage;
} catch {
    // no storage: the password and the unlit balls live only in this tab
}

const lsGet = (k) => {
    try {
        return localStorage.getItem(k) || "";
    } catch {
        return "";
    }
};
const lsSet = (k, v) => {
    try {
        if (v) localStorage.setItem(k, v);
        else localStorage.removeItem(k);
    } catch {
        // private mode: the password lives only in this tab
    }
};
api.pass = lsGet(PASS_KEY);
if (store) setUnlit(readUnlit(store));

// ================= state =================

let SAVED = normalize(null);
const DRAFT = {};
const W = { ssid: "", pass: "" };  // the Wi-Fi fields: applied with «Подключить», not with Save
let LIVE = null, recvAt = 0, WIFI = null, FRAME = null, everOk = false, hideKnown = false;
const sync = new ClockSync();
// ev: the event in view (anim, A_WAKE … A_NOTIFY): the preview's chips and the Kaya tab's list are the same choice;
// CL: the try-out on the clock {n, label, t0, dur, done}; open: the gallery's sheet on the phone
const newHide = () => ({ h: 0, t: performance.now() | 0, end: 0, on: 0 });
// hideD, hideN: the Digit fade's level of «Черновик» and of «Сейчас» (frame.js hideTrack)
const P = { conn: "wait", src: "draft", live: "calc", forceNight: null, M: null, duck: 0, hideD: newHide(), hideN: newHide(), cmp: 0.5, tab: "kaia", saving: false, upd: "", ev: A_WAKE, CL: null, open: false, thumb: 0, grp: null };
// thumb: what the style tiles show, 0 the style's listening, 1 all 7 events in a row; grp: the style group the chips
// show (−1 all), null until a chip is pressed (styGroupShown)

const S = () => Object.assign({}, SAVED, DRAFT);
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmtS = (ms) => (ms / 1000).toFixed(1).replace(".", ",") + " с";
const hexs = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0"), unhex = (h) => parseInt(h.slice(1), 16);
const two = (n) => String(n).padStart(2, "0");
const hm = (sec) => two(Math.floor(sec / 3600) % 24) + ":" + two(Math.floor((sec % 3600) / 60));
const unhm = (s) => {
    const a = s.split(":");
    return +a[0] * 3600 + (+a[1] || 0) * 60;
};
const rgb = (c) => ((c >> 16) & 255) + "," + ((c >> 8) & 255) + "," + (c & 255);
const palCss = (p) => "linear-gradient(90deg," + PALETTES[p].map((c) => "rgb(" + rgb(c) + ")").join(",") + ")";
const STY = STYLE_NAMES;
// the «Стиль» picker (v1.8, KAIA-195; v1.9, KAIA-201, KAIA-202): a line under each style, what it is, and the versions
// of styles 4–18 by event
const STY_SUB = ["анимаций нет", "кольца из центра", "кометы по ободу", "знак в середине", "розыгрыш через сетку", "шестикратный узор", "мягкие капли", "лицо: глаза и рот", "спираль и звёзды", "бегущий луч",
    "иней на решётке", "мягкие огоньки", "холодный огонь", "игра · 8 бит", "игра · блоки", "механика · шестерни", "вывеска · две трубки",
    "физика · нить и шар", "праздник · лампочки"];
const STY_IDEA = ["", "Кольца расходятся из центра и сходятся к нему.", "Кометы бегут по ободу шестиугольника.", "Искры собираются в знак посередине.",
    "Часы сами из мячиков для пинг-понга, значит — розыгрыш: мяч, сетка в середине нижних рядов, ракетки по краям, стол — нижний ряд.",
    "Шестикратная симметрия самого шестиугольника: узор из шести зеркальных секторов.",
    "Мягкие капли, как в лава-лампе: сливаются и делятся сами.",
    "Кая — крошечное лицо: два глаза и рот, никакого текста. Лицо берёт табло целиком, время отступает.",
    "Двурукая спираль вокруг ядра, мерцающие звёзды.",
    "Свет «Рыцаря дорожного»: полоса через все ряды, ярче в среднем, со следом.",
    "Снежинка на самой решётке шаров: шесть лучей по три шара идут по линиям сетки, вокруг кончиков нарастает иней. По бокам падает редкий снег, по краю кое-где искрится иней.",
    "Мягкие огоньки: у каждого своё место, вокруг которого он плавает, и свой темп — разгорается и гаснет; где двое встречаются, свет складывается.",
    "Холодное пламя цвета Каи с белеющими кончиками: языки на нижнем ряду лижут вверх, сквозь пламя поднимается свет, над ним летят угольки.",
    "Восьмибитный едок цвета Каи, привидения и точки. Едок — круг в два шара с ртом-клином, привидение — купол из семи шаров с белыми глазами, точки — каждый второй шар среднего ряда; у левого края мигает энерджайзер.",
    "Блоки на диагональной сетке: блок — шар, фигура — четыре, стопка — три нижних ряда. Фигуры падают по шагу сетки, мягко между шарами, и поворачиваются на 60°.",
    "Это же часы — значит, шестерни. Два больших колеса сцеплены посередине и крутятся навстречу; у краёв — шестерёнки, втрое быстрее.",
    "Неоновые трубки в темноте: белое горячее ядро и едва заметное свечение вокруг. Рамка вывески — обод цвета Каи, вторая трубка внутри — розовая.",
    "Физика: маятник на нити подвешен над верхним краем, шарик висит посреди ряда 4. Быстро внизу, замирает у края — как настоящий.",
    "Шары — лампочки гирлянды: 11 лампочек на провисшем проводе, каждая своего цвета — цвет Каи, янтарь, роза, зелень; соседние цвета не смешиваются."];
const STY_EV = [
    ["Подача", "Розыгрыш", "Быстрый розыгрыш", "Подскоки", "Смэш", "В сетку", "Мячик"],
    ["Мандала", "Вращение", "Узоры", "Дыхание лепестков", "Цветок", "Осколки", "Лепестки по кругу"],
    ["Всплытие", "Дрейф", "Слияния", "Пульс", "Слияние", "Стекает", "Пузырь"],
    ["Просыпается", "Смотрит", "Задумалась", "Говорит", "Подмигивает", "Огорчение", "Удивление"],
    ["Большой взрыв", "Спираль", "Вихрь ядра", "Пульс ядра", "Сверхновая", "Чёрная дыра", "Комета"],
    ["Запуск", "Луч", "Два луча", "Ширина голосом", "Проход", "Сбой", "Три прохода"],
    ["Иней", "Блеск", "Иней на кончиках", "Рост голосом", "Идеальная снежинка", "Оттепель", "Блик по кругу"],
    ["Слетаются", "Огоньки", "Хоровод", "Хор", "Рой", "Разлетелись", "Вспышка"],
    ["Розжиг", "Тихий огонь", "Пляска", "Голос огня", "Костёр", "Угасание", "Треск"],
    ["Забег", "Патруль", "Погоня", "Ам-ам", "Энерджайзер", "Пойман", "Бонус"],
    ["Стопка", "Фигура", "Ливень", "Верхний ряд", "Линия", "Конец игры", "Новая фигура"],
    ["Завод", "Ход", "Быстрый ход", "Тик", "Щелчок", "Заклинило", "Кукушка"],
    ["Зажигание", "Гул", "Схема", "Пульс трубок", "Неоновая галочка", "Искрит", "Стрелка"],
    ["Толчок", "Качание", "Колыбель Ньютона", "Прыжки", "В такт", "Обрыв", "Тик-так"],
    ["По цепочке", "Мерцание", "Бегущие огни", "Вспышки", "Праздник", "Перегорела", "Двойной бег"],
];
// the newest styles get the «новый» mark
const STY_NEW = 10;
// the picker's groups (KAIA-201's design): name, what is in it, the style ids in their order; catalog B's styles in
// «Игры» and «Узоры и свет», as the design placed them. Every style is in exactly one group.
const STY_GROUPS = [
    ["Классика", "кольца, кометы, знак, луч, лицо", [0, 1, 2, 3, 9, 7]],
    ["Природа", "капли, снег, огоньки, огонь", [6, 10, 11, 12]],
    ["Космос", "спираль и звёзды", [8]],
    ["Игры", "мяч, едок, блоки, шестерни, маятник", [4, 13, 14, 15, 17]],
    ["Узоры и свет", "симметрия и огни", [5, 16, 18]],
];
const styGroupOf = (id) => STY_GROUPS.findIndex((g) => g[2].includes(id));
// the group the chips show: the one pressed; before that all of them, on the phone the chosen style's
const styGroupShown = (s) => (P.grp != null ? P.grp : matchMedia("(max-width:520px)").matches ? styGroupOf(s.kaia_anim) : -1);

// the 7 events by anim: name, when it plays, its theme
const EV = [
    ["Пробуждение", "когда Кая услышала своё имя", "пробуждение"],
    ["Слушает", "пока Кая ждёт вашу команду", "внимание, слух"],
    ["Думает", "пока Кая готовит ответ", "размышление, работа"],
    ["Говорит", "пока Кая отвечает голосом", "звук, голос"],
    ["Готово", "задача выполнена", "готовность, успех"],
    ["Ошибка", "что-то пошло не так", "тревога, сбой"],
    ["Уведомление", "сообщение, на которое не нужно отвечать", "сигнал, внимание"],
];
const looksOf = (n) => (n === A_WAKE ? WAKE_COUNT : LOOK_COUNT);
const lookName = (n, c) => LOOK_NAMES[n][c] || LOOK_NAMES[n][0];
// the event's look that is style st's version (1–3 theirs; 4–18: looks 9–23, wakes 15–29, by the id tables); the wake's id
const verOf = (n, st) => (n === A_WAKE ? style_wake[st] : st <= 3 ? st : style_look[st]);
const wakeIdOf = (s, c) => wakeOf(s.kaia_anim || 1, c);
// a one-shot's or the wake's length with the draft (0 for a state)
const lenOf = (n, c, s) => (n === A_WAKE ? wakeLength(wakeIdOf(s, c), s.kaia_wake_speed) : isState(n) ? 0 : shotLength(n, c, s.kaia_anim || 1));

// ================= the settings groups =================

const GROUPS = [
    { id: "clock", tab: "look", wide: 1, cls: "three", title: "Часы", f: [
        { k: "clock_style", t: "sel", l: "Шрифт", o: ["Нет", "Тип 1", "Тип 2", "Тип 3"] },
        { k: "clock_style_zero", t: "sw", l: "Ведущий ноль", h: "09:05 вместо 9:05" },
        { k: "clock_color", t: "col", l: "Цвет" }] },
    { id: "back", tab: "look", wide: 1, cls: "two", title: "Фон", f: [
        { k: "back_mode", t: "sel", l: "Режим", o: ["Нет", "Градиент", "Перлин"] },
        { k: "back_pal", t: "pal", l: "Палитра", if: (s) => s.back_mode > 0 },
        { k: "back_bright", t: "rng", l: "Яркость", min: 0, max: 255, w: 1, if: (s) => s.back_mode > 0 },
        { k: "back_speed", t: "rng", l: "Скорость", min: 0, max: 100, w: 1, if: (s) => s.back_mode > 0 },
        { k: "back_scale", t: "rng", l: "Масштаб", min: 0, max: 100, w: 1, if: (s) => s.back_mode > 0 },
        { k: "back_angle", t: "rng", l: "Угол", min: -180, max: 180, w: 1, u: "°", if: (s) => s.back_mode === 1 }] },
    { id: "bright", tab: "light", title: "Яркость", f: [
        { k: "auto_bright", t: "sw", l: "Автояркость", h: "по датчику света" },
        { k: "_br", t: "live", l: "Сейчас на часах", live: "brnow" },
        { k: "_adc", t: "live", l: "Сигнал с датчика", live: "adc", if: (s) => s.auto_bright },
        { k: "bright_min", t: "rng", l: "Мин.", min: 0, max: 255, w: 1, if: (s) => s.auto_bright },
        { k: "bright_max", t: "rng", l: "Макс.", min: 0, max: 255, w: 1, if: (s) => s.auto_bright },
        { k: "_adcb", t: "btns", l: "Калибровка датчика", w: 1, h: "Закройте датчик и нажмите «мин.», посветите и нажмите «макс.».", if: (s) => s.auto_bright },
        { k: "bright", t: "rng", l: "Яркость", min: 0, max: 255, w: 1, if: (s) => !s.auto_bright }] },
    { id: "night", tab: "light", title: "Ночной режим", f: [
        { k: "night_mode", t: "sw", l: "Включен", h: "тёмная комната и красные цифры" },
        { k: "night_color", t: "col", l: "Цвет", if: (s) => s.night_mode },
        { k: "night_mode_auto", t: "sw", l: "По расписанию", if: (s) => s.night_mode },
        { k: "night_mode_auto_since", t: "time", l: "С", if: (s) => s.night_mode && s.night_mode_auto },
        { k: "night_mode_auto_to", t: "time", l: "До", if: (s) => s.night_mode && s.night_mode_auto },
        { k: "_thr", t: "live", l: "Порог датчика", live: "thr", h: "Ночью, пока сигнал ниже порога. На странице порог не меняется.", if: (s) => s.night_mode }] },
    // the Kaya tab is drawn by kayaHTML; its keys are here for the save bar and the list of changes
    { id: "kaia", tab: "kaia", wide: 1, title: "Кая", custom: (s) => kayaHTML(s), f: [
        { k: "kaia_anim", t: "sel", l: "Стиль", o: STY },
        ...LOOK_KEYS.map((k, n) => ({ k, t: "look", l: EV[n][0], n })),
        { k: "kaia_wake_speed", t: "spd", l: "Скорость пробуждения" },
        { k: "kaia_color", t: "col", l: "Цвет Каи" },
        { k: "kaia_bright", t: "rng", l: "Яркость Каи", min: 0, max: 255 },
        { k: "kaia_night", t: "sel", l: "Ночью", o: ["Как обычно", "Тусклее", "Не показывать"] },
        { k: "kaia_hide", t: "sw", l: "Прятать цифры" },
        { k: "kaia_hide_out", t: "rng", l: "Исчезают за", min: 100, max: 3000 },
        { k: "kaia_hide_in", t: "rng", l: "Появляются за", min: 100, max: 5000 },
        { k: "kaia_hide_hold", t: "rng", l: "Пауза перед появлением", min: 0, max: 5000 },
        { k: "kaia_hide_keep", t: "rng", l: "Остаётся от цифр", min: 0, max: 100, u: " %" }] },
    { id: "time", tab: "net", title: "Время", f: [
        { k: "ntp_gmt", t: "num", l: "Часовой пояс", min: -12, max: 14 },
        { k: "ntp_host", t: "txt", l: "NTP-сервер", w: 1 },
        { k: "_sync", t: "led", l: "Синхронизировано" },
        { k: "_loc", t: "live", l: "Локальное время", live: "time" }] },
    { id: "wifi", tab: "net", title: "Wi-Fi", f: [
        { k: "_wst", t: "live", l: "Подключено", live: "wifi" },
        { k: "wifi_ssid", t: "wtxt", l: "Сеть (SSID)", w: 1 },
        { k: "wifi_pass", t: "wpwd", l: "Пароль сети", w: 1 },
        { k: "_wgo", t: "btnw", l: "", h: "Применяется сразу, без «Сохранить»: часы переподключатся." },
        { k: "show_ip", t: "sw", l: "Показывать IP", h: "на часах при старте" }] },
    { id: "sys", tab: "sys", title: "Система", f: [
        { k: "page_pass", t: "pwd", l: "Пароль страницы", w: 1, h: "Пустой — без пароля. После сохранения страница спросит его." },
        { k: "log_host", t: "txt", l: "Сервер логов", w: 1, h: "IP:порт" },
        { k: "_ver", t: "live", l: "Версия прошивки", live: "ver" },
        { k: "_chk", t: "btnc", l: "" }] }];

const TABS = [
    { id: "look", t: "Вид", i: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
    { id: "light", t: "Свет", i: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>' },
    { id: "kaia", t: "Кая", i: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>' },
    { id: "net", t: "Сеть", i: '<path d="M5 12a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0"/><circle cx="12" cy="18.5" r="1"/>' },
    { id: "sys", t: "Система", i: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>' }];

const FLD = {};
GROUPS.forEach((g) => g.f.forEach((f) => (FLD[f.k] = Object.assign({ g: g.title }, f))));

function fmtVal(k, v) {
    if (k === "kaia_wake_speed") return v + " % · " + String(v / 100).replace(".", ",") + "×";
    if (k === "kaia_hide_out" || k === "kaia_hide_in" || k === "kaia_hide_hold") return fmtS(v);
    return v + ((FLD[k] && FLD[k].u) || "");
}

function fmtAny(k, v) {
    const f = FLD[k];
    if (!f) return String(v);
    switch (f.t) {
        case "sel": return f.o[v];
        case "sw": return v ? "вкл" : "выкл";
        case "col": return hexs(v);
        case "time": return hm(v);
        case "pal": return PAL_RU[v];
        case "look": return v + " · " + lookName(f.n, v);
        case "pwd": return v ? "••••" : "пусто";
        case "num": return (v > 0 ? "+" : "") + v;
        case "spd": case "rng": return fmtVal(k, v);
    }
    return String(v) || "пусто";
}

const RVB = (k) => '<button class="rv" data-rv="' + k + '" title="Вернуть сохранённое" aria-label="Вернуть сохранённое">↺</button>';
const opts = (list, v) => list.map((o, i) => '<option value="' + i + '"' + (i === v ? " selected" : "") + ">" + esc(o) + "</option>").join("");
const fld = (k, lab, hint, ctl, stack) => '<div class="fld' + (stack ? " stack" : "") + '" data-f="' + k + '"><div class="fl"><span>' + lab + (hint ? "<small>" + hint + "</small>" : "") + "</span>" + RVB(k) + "</div>" + ctl + "</div>";
const rngCtl = (k, v, min, max, step, lab) => '<div class="rng"><input type="range" data-k="' + k + '" min="' + min + '" max="' + max + '"' + (step ? ' step="' + step + '"' : "") + ' value="' + v + '" aria-label="' + lab + '"><output>' + fmtVal(k, v) + "</output></div>";

function fieldHTML(f, s) {
    const v = s[f.k], lab = esc(f.l);
    const wrap = (c, rv = true) => '<div class="fld' + (f.w ? " stack" : "") + '" data-f="' + f.k + '"><div class="fl"><span>' + lab + (f.h ? "<small>" + esc(f.h) + "</small>" : "") + "</span>" + (rv ? RVB(f.k) : "") + "</div>" + c + "</div>";
    switch (f.t) {
        case "sw": return wrap('<label class="sw"><input type="checkbox" data-k="' + f.k + '"' + (v ? " checked" : "") + ' aria-label="' + lab + '"><i></i></label>');
        case "sel": return wrap('<select data-k="' + f.k + '" aria-label="' + lab + '">' + opts(f.o, v) + "</select>");
        case "pal": return pickerHTML(f);
        case "col": return wrap('<input type="color" data-k="' + f.k + '" value="' + hexs(v) + '" aria-label="' + lab + '">');
        case "rng": return wrap(rngCtl(f.k, v, f.min, f.max, 0, lab));
        case "txt": return wrap('<input type="text" data-k="' + f.k + '" value="' + esc(v) + '" autocomplete="off" aria-label="' + lab + '">');
        case "pwd": return wrap('<input type="password" data-k="' + f.k + '" value="' + esc(DRAFT.page_pass || "") + '" autocomplete="new-password" placeholder="' + (api.pass ? "задан; новый — сюда" : "без пароля") + '" aria-label="' + lab + '">');
        case "wtxt": return wrap('<input type="text" data-w="ssid" value="' + esc(W.ssid) + '" autocomplete="off" aria-label="' + lab + '">', false);
        case "wpwd": return wrap('<input type="password" data-w="pass" value="' + esc(W.pass) + '" autocomplete="new-password" placeholder="только запись" aria-label="' + lab + '">', false);
        case "time": return wrap('<input type="time" data-k="' + f.k + '" value="' + hm(v) + '" aria-label="' + lab + '">');
        case "num": return wrap('<div class="step"><button data-step="-1" data-k2="' + f.k + '" aria-label="меньше">−</button><output>' + (v > 0 ? "+" : "") + v + '</output><button data-step="1" data-k2="' + f.k + '" aria-label="больше">+</button></div>');
        case "live": return wrap('<span class="val" data-live="' + f.live + '"></span>', false);
        case "led": return wrap('<span class="led" data-live="led"><i></i><span></span></span>', false);
        case "btns": return wrap('<div class="btns"><button class="btn sm" data-act="admin">Запомнить мин.</button><button class="btn sm" data-act="admax">Запомнить макс.</button></div>', false);
        case "btnw": return '<div class="fld stack"><div class="btns"><button class="btn pri" data-act="wifi">Подключить</button></div><div class="fl"><span><small>' + esc(f.h) + "</small></span></div></div>";
        case "btnc": return '<div class="fld stack"><div class="btns"><button class="btn" data-act="check">Проверить обновления</button>' + (LIVE && LIVE.update ? '<button class="btn pri" data-act="upd">Доступно обновление → Обновить</button>' : "") + '</div><div class="fl"><span><small id="chkst">' + esc(P.upd || (LIVE && LIVE.update ? "Доступна новая прошивка (сейчас " + LIVE.version + ")" : "Новых версий не видно")) + "</small></span></div></div>";
    }
    return "";
}

// ================= the palette picker (KAIA-172 b): the current one big with ‹ ›, then one strip per group =================

function pickerHTML(f) {
    const strips = PAL_GROUPS.map((g, k) => {
        const items = PAL_ORDER.filter((i) => PAL_GROUP[i] === k);
        return '<div class="brow"><h4>' + g + "<small>" + items.length + '</small></h4><div class="bscr">' +
            items.map((i) => '<button class="pc" data-pick="' + i + '" title="' + PAL_NAMES[i] + '"><i class="pb" style="background:' + palCss(i) + '"></i><span>' + esc(PAL_RU[i]) + "</span></button>").join("") + "</div></div>";
    });
    return '<div class="fld stack" data-f="' + f.k + '"><div class="fl"><span>' + esc(f.l) + "<small>Нажмите образец или листайте ‹ ›: превью меняется сразу. Кружок ● — палитра, которая сейчас на часах.</small></span>" + RVB(f.k) + "</div>" +
        '<div class="bk"><button class="ico" data-pstep="-1" aria-label="Предыдущая палитра">‹</button><div class="bkc"><div class="bkt"><b id="pcn"></b><small id="pcm"></small></div><i class="pb" id="pcb"></i><div class="pcs" id="pcs"></div></div><button class="ico" data-pstep="1" aria-label="Следующая палитра">›</button></div>' +
        '<div class="brows">' + strips.join("") + "</div></div>";
}

function updPal() {
    const cur = S().back_pal, sav = SAVED.back_pal;
    if (!$("#pcn")) return;
    $("#pcn").textContent = PAL_RU[cur];
    $("#pcm").textContent = PAL_GROUPS[PAL_GROUP[cur]] + " · №" + cur;
    $("#pcb").style.background = palCss(cur);
    $("#pcs").innerHTML = cur === sav ? "<span>Эта палитра сейчас на часах</span>" : "<span>На часах: " + esc(PAL_RU[sav]) + '</span><i class="pb" style="background:' + palCss(sav) + '"></i>';
    $$(".pc").forEach((b) => {
        const i = +b.dataset.pick;
        b.classList.toggle("sel", i === cur);
        b.classList.toggle("sv", i === sav);
    });
}

// ‹ ›: the next palette in the picker's order, and its swatch scrolled into its strip
function stepPal(d) {
    const j = PAL_ORDER.indexOf(S().back_pal);
    setVal("back_pal", PAL_ORDER[(j + d + PAL_ORDER.length) % PAL_ORDER.length]);
    const b = $(".pc.sel");
    if (b) {
        const sc = b.parentNode;
        if (sc.scrollWidth > sc.clientWidth + 2) sc.scrollLeft = b.offsetLeft - sc.offsetLeft - sc.clientWidth / 2 + b.offsetWidth / 2;
    }
}

// ================= the Kaya tab (KAIA-172 b): the style, the 7 events with live thumbnails, the event's gallery =================

const TRY = '<span class="long">▶ Показать на часах</span><span class="short">▶ На часах</span>';
const shortOf = (n, c) => (c ? lookName(n, c) : "Как у стиля");

function rowText(n, s) {
    const c = s[LOOK_KEYS[n]], sv = SAVED[LOOK_KEYS[n]];
    if (!s.kaia_anim) return "выкл";
    return (c ? c + " · " : "") + shortOf(n, c) + (c !== sv ? " · было: " + shortOf(n, sv) : "");
}

// «0 → Рябь» or «13 · Зайчик»
function choiceLabel(n, s) {
    const c = s[LOOK_KEYS[n]];
    return c ? c + " · " + lookName(n, c) : "0 → " + LOOK_NAMES[n][verOf(n, s.kaia_anim || 1)];
}

function tileSub(n, id, s) {
    const st = s.kaia_anim || 1, now = id ? "" : "сейчас: " + LOOK_NAMES[n][verOf(n, st)] + " · ";
    // a new style's version: its name for this event
    const sv = (n === A_WAKE ? wake_style : look_style)[id], fam = sv ? STY_EV[sv - 4][n] + " · " : "";
    if (isState(n)) return id ? fam + "непрерывно" : "сейчас: " + STY[st];
    return now + fam + fmtS(lenOf(n, id, s));
}

function tileHTML(n, id, s) {
    const k = LOOK_KEYS[n], cur = s[k], sav = SAVED[k];
    return '<button class="tile' + (cur === id ? " sel" : "") + '" data-tc="' + n + ":" + id + '"><canvas></canvas><span class="tn"><b>' + id + " · " + esc(lookName(n, id)) + "</b><i>" + tileSub(n, id, s) + "</i></span>" + (sav === id && cur !== id ? '<em class="pl">на часах</em>' : "") + "</button>";
}

const gh = (t, sub) => '<div class="gh"><h4>' + t + "</h4>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>";
const tilesFor = (n, a, b, s) => {
    let h = "";
    for (let id = a; id <= b; id++) h += tileHTML(n, id, s);
    return '<div class="wg">' + h + "</div>";
};

function galleryHTML(n, s) {
    let h = '<div class="gal' + (s.kaia_anim ? "" : " dis") + '">';
    if (!s.kaia_anim) h += '<p class="note">Анимации Каи выключены в стиле. Выберите стиль, и здесь можно выбирать анимацию для события.</p>';
    h += gh("Как у стиля и версии стиля", "0 — следует за стилем · 1 Рябь · 2 Орбита · 3 Искры") + tilesFor(n, 0, 3, s);
    if (n === A_WAKE) h += gh("Тематические пробуждения", "4–11") + tilesFor(n, 4, 11, s) + gh("Новые пробуждения", "12–14") + tilesFor(n, 12, 14, s);
    else h += gh("Новые по теме", "4–8 · " + EV[n][2]) + tilesFor(n, 4, 8, s);
    // v1.8, v1.9: the versions of styles 4–18, appended (the ids the tables give a style)
    const vs = n === A_WAKE ? wake_style : look_style, b = vs.findIndex((x) => x);
    let e = vs.length - 1;
    while (!vs[e]) e--;
    h += gh("Версии новых стилей", b + "–" + e + " · любое событие может взять их при любом стиле, как 1–3") + tilesFor(n, b, e, s);
    // v1.9 part 3: catalog C's singles, after the styles' versions to the last id
    h += '<div id="gnew">' + gh("Новые анимации", e + 1 + "–" + (looksOf(n) - 1) + " · отдельные, не из стиля: с любым стилем") + tilesFor(n, e + 1, looksOf(n) - 1, s) + "</div>";
    return h + "</div>";
}

function speedHTML(s) {
    const sp = s.kaia_wake_speed;
    return fld("kaia_wake_speed", "Скорость пробуждения", "Только пробуждение; слушание после него идёт в своём темпе.", rngCtl("kaia_wake_speed", sp, 50, 200, 5, "Скорость пробуждения") +
        '<div class="row">' + [[50, "½×"], [100, "1×"], [150, "1,5×"], [200, "2×"]].map((a) => '<button class="chip' + (sp === a[0] ? " on" : "") + '" data-sp="' + a[0] + '">' + a[1] + "</button>").join("") + "</div>", 1).replace('class="fld stack"', 'class="fld stack spd"');
}

// the «Стиль» picker (KAIA-195): a tile per style with a live thumbnail (its listening, or all 7 events in a row), the
// draft's style selected, «на часах» on the saved one, and what the selected style plays for each event under them
function styleTile(id, s) {
    return '<button class="tile st' + (s.kaia_anim === id ? " sel" : "") + '" data-sty="' + id + '"><canvas></canvas><span class="tn"><b>' + id + " · " + STY[id] + "</b><i>" + STY_SUB[id] + "</i></span>" +
        (id >= STY_NEW ? '<em class="nw">новый</em>' : "") + (SAVED.kaia_anim === id && s.kaia_anim !== id ? '<em class="pl">на часах</em>' : "") + "</button>";
}

// «Сейчас выбран» under the chips: the draft's style and its group, also while another group is shown
function styCurHTML(s) {
    const st = s.kaia_anim;
    return "Сейчас выбран: <b>" + (st ? st + " · " + STY[st] : "Выкл") + "</b>" + (st ? " · группа «" + STY_GROUPS[styGroupOf(st)][0] + "»" : "");
}

// the chips and the groups as styGroupShown says; the thumbnails of a group just shown get their size
function showStyGroup() {
    const g = styGroupShown(S());
    $$("[data-sgr]").forEach((b) => {
        b.classList.toggle("on", +b.dataset.sgr === g);
        b.setAttribute("aria-pressed", String(+b.dataset.sgr === g));
    });
    $$(".sgr").forEach((el) => (el.hidden = g >= 0 && +el.dataset.sg !== g));
    requestAnimationFrame(sizeTiles);
}

function stsHTML(s) {
    const st = s.kaia_anim;
    if (!st) return "<p><b>Выкл</b> — анимаций Каи нет; бегущий текст системы остаётся.</p>";
    return "<p><b>" + st + " · " + STY[st] + "</b> — " + STY_IDEA[st] + "</p><div class=\"evm\">" + EV.map((e, n) => "<span>" + e[0] + ": <b>" + (st >= 4 ? STY_EV[st - 4][n] : STY[st]) + "</b>" +
        (isState(n) ? "" : " · " + fmtS(lenOf(n, verOf(n, st), s))) + "</span>").join("") + "</div>";
}

function kayaHTML(s) {
    const on = s.kaia_anim;
    const g = styGroupShown(s), chip = (i, t, k) => '<button class="chip' + (g === i ? " on" : "") + '" data-sgr="' + i + '" aria-pressed="' + (g === i) + '">' + t + "<small>" + k + "</small></button>";
    const pick = '<div class="sth"><div class="gch" role="group" aria-label="Группы стилей">' + chip(-1, "Все", STY.length) + STY_GROUPS.map((x, i) => chip(i, x[0], x[2].length)).join("") + "</div>" +
        '<span class="thm"><span class="sub">Миниатюры</span><span class="seg">' + ["Слушает", "Все 7 событий"].map((t, i) => '<button data-thumb="' + i + '"' + (P.thumb === i ? ' class="on"' : "") + ">" + t + "</button>").join("") + "</span></span></div>" +
        '<div class="cur" id="scur">' + styCurHTML(s) + "</div>" +
        STY_GROUPS.map((x, i) => '<div class="sgr" data-sg="' + i + '"' + (g >= 0 && g !== i ? " hidden" : "") + ">" + gh(x[0], x[1]) + '<div class="stg">' + x[2].map((id) => styleTile(id, s)).join("") + "</div></div>").join("") +
        '<div class="sts" id="sts">' + stsHTML(s) + "</div>";
    let h = '<div class="kopts one">' + fld("kaia_anim", "Стиль", "«Выкл» отключает все анимации Каи; события с «Как у стиля» играют версию выбранного стиля.", pick, 1) + "</div>";
    h += '<div class="evh"><h3 class="sub">Анимация для каждого события</h3><small>В списке виден выбор для всех семи событий; нажмите событие, чтобы выбрать другую анимацию.</small></div>';
    h += '<div class="kb' + (P.open ? " open" : "") + '" id="kb"><div class="evl">' + EV.map((e, n) => '<button class="er" data-ev="' + n + '"><canvas data-th="' + n + '"></canvas><span class="et"><b>' + e[0] + "</b><small></small></span><span class=\"chev\">›</span></button>").join("") + "</div>" +
        '<div class="evd" id="evd"><div class="evdh"><button class="chip back" data-close aria-label="К списку событий">‹ События</button><div class="evt"><h3 id="evt"></h3><small id="evs"></small></div></div><div id="evg"></div>' +
        '<div class="gfoot"><button class="btn pri" data-act="onclock">' + TRY + '</button><small class="cl-st"></small></div></div></div>';
    if (on) {
        h += '<div class="evh"><h3 class="sub">Цвет и яркость Каи</h3></div><div class="kopts">' + fld("kaia_color", "Цвет Каи", "", '<input type="color" data-k="kaia_color" value="' + hexs(s.kaia_color) + '" aria-label="Цвет Каи">') +
            fld("kaia_bright", "Яркость", "", rngCtl("kaia_bright", s.kaia_bright, 0, 255, 0, "Яркость Каи"), 1) +
            fld("kaia_night", "Ночью", "", '<select data-k="kaia_night" aria-label="Ночью">' + opts(FLD.kaia_night.o, s.kaia_night) + "</select>") + "</div>";
        // the clocks of v1.7 and later carry kaia_hide
        if (hideKnown) h += '<div class="evh"><h3 class="sub">Цифры во время анимации</h3></div><div class="kopts" id="hidebox">' + hideHTML(s) + "</div>";
    }
    return h;
}

// the Digit fade: the switch, and while it is on the four sliders
function hideHTML(s) {
    const sec = (k, lab) => fld(k, lab, "", rngCtl(k, s[k], FLD[k].min, FLD[k].max, k === "kaia_hide_keep" ? 5 : 100, lab), 1);
    return fld("kaia_hide", "Прятать цифры", "Пока играет анимация Каи, время плавно гаснет, после — плавно возвращается",
        '<label class="sw"><input type="checkbox" data-k="kaia_hide"' + (s.kaia_hide ? " checked" : "") + ' aria-label="Прятать цифры"><i></i></label>') +
        (s.kaia_hide ? sec("kaia_hide_out", "Исчезают за") + sec("kaia_hide_in", "Появляются за") + sec("kaia_hide_hold", "Пауза перед появлением") + sec("kaia_hide_keep", "Остаётся от цифр") : "") +
        '<small class="hnote">«Показать на часах» играет с настройками цифр, сохранёнными на часах.</small>';
}

function fillHide() {
    const b = $("#hidebox");
    if (b) b.innerHTML = hideHTML(S());
    markDirty();
}

// the event's gallery (and the wake's speed under it)
function fillEv() {
    const s = S(), n = P.ev;
    if (!$("#evg")) return;
    $("#evt").textContent = EV[n][0];
    $("#evs").textContent = EV[n][1];
    $("#evg").innerHTML = galleryHTML(n, s) + (n === A_WAKE && s.kaia_anim ? speedHTML(s) : "");
}

// the list, the tiles' marks and lengths, after a change of the draft
function updKaya() {
    const s = S();
    $$(".er").forEach((b) => {
        const n = +b.dataset.ev;
        b.classList.toggle("on", n === P.ev);
        b.classList.toggle("chg", LOOK_KEYS[n] in DRAFT);
        b.querySelector("small").textContent = rowText(n, s);
    });
    $$(".tile[data-tc]").forEach((t) => {
        const [n, id] = t.dataset.tc.split(":").map(Number), k = LOOK_KEYS[n], cur = s[k], sav = SAVED[k];
        t.classList.toggle("sel", cur === id);
        t.querySelector("i").textContent = tileSub(n, id, s);
        const pl = t.querySelector(".pl"), want = sav === id && cur !== id;
        if (want && !pl) t.insertAdjacentHTML("beforeend", '<em class="pl">на часах</em>');
        else if (!want && pl) pl.remove();
    });
    $$(".st").forEach((t) => {
        const id = +t.dataset.sty, pl = t.querySelector(".pl"), want = SAVED.kaia_anim === id && s.kaia_anim !== id;
        t.classList.toggle("sel", s.kaia_anim === id);
        if (want && !pl) t.insertAdjacentHTML("beforeend", '<em class="pl">на часах</em>');
        else if (!want && pl) pl.remove();
    });
    const sts = $("#sts"), cur = $("#scur");
    if (sts) sts.innerHTML = stsHTML(s);
    if (cur) cur.innerHTML = styCurHTML(s);
    $$("[data-thumb]").forEach((b) => b.classList.toggle("on", +b.dataset.thumb === P.thumb));
    $$("[data-sp]").forEach((b) => b.classList.toggle("on", +b.dataset.sp === s.kaia_wake_speed));
    $$('[data-f="kaia_wake_speed"] output').forEach((o) => (o.textContent = fmtVal("kaia_wake_speed", s.kaia_wake_speed)));
}

// the gallery as a sheet under the sticky preview (the phone)
function setSheet(o) {
    P.open = o;
    const kb = $("#kb");
    if (kb) kb.classList.toggle("open", o);
    document.body.classList.toggle("sheet", o);
    if (o) document.documentElement.style.setProperty("--hh", Math.round($("#hero").getBoundingClientRect().bottom) + "px");
}

// the event in view: the preview's chips and the Kaya tab follow it, and the preview plays it
function setEvent(n, open) {
    P.ev = n;
    if (open) setSheet(true);
    fillEv();
    bindTiles();
    updKaya();
    markKs();
    hsum();
    clUI();
    play(ANIM_NAMES[n]);
}

// ================= rendering the groups =================

let tiles = [];

function renderGroup(g) {
    const el = document.getElementById("g-" + g.id), s = S();
    if (!el) return;
    el.querySelector(".gbody").innerHTML = g.custom ? g.custom(s) : g.f.filter((f) => !f.if || f.if(s)).map((f) => fieldHTML(f, s)).join("");
    if (g.id === "kaia") {
        fillEv();
        bindTiles();
        updKaya();
        clUI();
    }
    if (g.id === "back") updPal();
    markDirty();
    refreshLive();
}

function renderAll() {
    GROUPS.forEach(renderGroup);
}

function buildGroups() {
    $("#groups").innerHTML = GROUPS.map((g) => '<section class="card grp' + (g.wide ? " wide" : "") + '" id="g-' + g.id + '" data-tab="' + g.tab + '"><h2>' + g.title + '</h2><div class="gbody' + (g.cls ? " " + g.cls : "") + '"></div></section>').join("");
    $("#tabs").innerHTML = TABS.map((t) => '<button class="tab" data-tab="' + t.id + '"><svg viewBox="0 0 24 24">' + t.i + "</svg><span>" + t.t + "</span></button>").join("");
}

function showTab(id) {
    P.tab = id;
    if (id !== "kaia") setSheet(false);
    $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
    $$("#groups>.grp").forEach((g) => (g.hidden = g.dataset.tab !== id));
    requestAnimationFrame(sizeTiles);
}

const groupOf = (k) => GROUPS.find((g) => g.f.some((f) => f.k === k));

function markDirty() {
    $$(".fld[data-f]").forEach((e) => e.classList.toggle("is-chg", e.dataset.f in DRAFT));
    $$(".tab").forEach((a) => a.classList.toggle("dirty", GROUPS.some((g) => g.tab === a.dataset.tab && g.f.some((f) => f.k in DRAFT))));
    const ks = Object.keys(DRAFT), bar = $("#sbar");
    bar.hidden = !ks.length || P.conn === "auth";
    if (!P.saving) $("#sbn").textContent = "Не сохранено: " + ks.length;
    $("#sbl").textContent = ks.map((k) => (FLD[k] ? FLD[k].l : k)).join(", ") + (P.conn === "offline" ? " · нет связи, сохранить нельзя" : "");
    $("#sbsave").disabled = P.conn !== "ok" || P.saving;
    hsum();
}

function hsum() {
    const s = S(), n = P.ev;
    let d = "Анимации Каи выключены.";
    if (s.kaia_anim) {
        d = "Событие: <b>" + EV[n][0] + "</b><br>Анимация: <b>" + esc(choiceLabel(n, s)) + "</b><br>";
        if (n === A_WAKE) d += fmtS(lenOf(n, s.kaia_wake, s)) + " при " + s.kaia_wake_speed + " % · затем слушание «" + esc(shortOf(1, s.kaia_listen)) + "»";
        else d += isState(n) ? "идёт, пока Кая в этом состоянии" : "один раз · " + fmtS(lenOf(n, s[LOOK_KEYS[n]], s));
    }
    $("#hsum").innerHTML = d;
}

function setVal(k, v) {
    if (v === SAVED[k] && k !== "page_pass") delete DRAFT[k];
    else DRAFT[k] = v;
    if (k === "page_pass" && v === "") delete DRAFT[k];
    if (P.src === "now") setSrc("draft");
    markDirty();
    if (k.startsWith("kaia_")) {
        updKaya();
        clUI();
    }
    if (k === "back_pal") updPal();
}

// ================= the live values =================

function refreshLive() {
    const s = S(), L = LIVE, light = L ? L.light : 0;
    const t = L ? sync.at(clockMillis()) : null;
    const map = {
        brnow: L ? L.bright + " из 255" : "—",
        adc: L ? light + "  [" + s.adc_min + " … " + s.adc_max + "]" : "—",
        thr: L ? "датчик " + light + " · ночь ниже " + s.night_trsh : "—",
        time: !L ? "—" : !L.synced ? "нет (на часах «-- --»)" : two(t.hour) + ":" + two(t.minute) + ":" + two(t.second),
        wifi: !WIFI ? "—" : WIFI.ap ? "своя точка доступа · " + WIFI.ip : (WIFI.ssid || "—") + " · " + WIFI.ip + " · " + WIFI.rssi + " дБм",
        ver: L ? L.version + (L.update ? " → есть новее" : "") : "—",
    };
    $$("[data-live]").forEach((e) => {
        if (e.dataset.live === "led") {
            const on = !!(L && L.synced);
            e.classList.toggle("on", on);
            e.lastChild.textContent = on ? "да" : "нет";
            return;
        }
        const v = map[e.dataset.live];
        if (v != null && e.textContent !== v) e.textContent = v;
    });
    const st = P.conn === "offline" ? ["err", "нет связи"] : P.conn === "auth" ? ["warn", "нужен пароль"] : P.conn === "wait" ? ["warn", "подключаюсь…"] : WIFI && WIFI.ap ? ["warn", "точка доступа"] : ["", "на связи"];
    $("#sdot").className = "dot " + st[0];
    $("#stxt").textContent = st[1];
    $("#ver").textContent = L ? "v" + L.version : "…";
    $("#logout").hidden = !api.pass;
    // День / Ночь: the one the draft shows (on the phone only that one, a tap switches it)
    $$("#day button").forEach((b) => b.classList.toggle("on", +b.dataset.d === (P.forceNight != null ? P.forceNight : +!!P.night)));
}

function banners() {
    let h = "";
    if (P.conn === "offline") h += '<div class="ban err"><b>Часы не отвечают</b><span>' + (everOk ? "Показан последний кадр; изменения останутся в черновике." : "Страница не получила ответа от часов.") + '</span><button class="btn sm" data-act="retry">Повторить</button></div>';
    if (WIFI && WIFI.ap && P.conn === "ok") h += '<div class="ban warn"><b>Часы раздают свою сеть</b><span>Времени пока нет — на часах «-- --». Укажите домашнюю Wi-Fi сеть и нажмите «Подключить».</span><button class="btn sm" data-tab="net">К настройкам Wi-Fi</button></div>';
    if (LIVE && LIVE.update && P.conn === "ok") h += '<div class="ban acc"><b>Доступна новая прошивка</b><span>Сейчас ' + esc(LIVE.version) + '. Обновление займёт около минуты, часы перезагрузятся.</span><button class="btn sm pri" data-act="upd">Обновить</button></div>';
    if ($("#ban").innerHTML !== h) $("#ban").innerHTML = h;
    document.body.classList.toggle("off", P.conn === "offline");
    document.body.classList.toggle("auth", P.conn === "auth");
    const g = $("#g-wifi");
    if (g) g.classList.toggle("hl", !!(WIFI && WIFI.ap));
}

// ================= the clock: state every 5 s while the tab is visible =================

let pollT = 0, polling = false;
const clockMillis = () => (LIVE ? LIVE.ms + (performance.now() - recvAt) : performance.now());

function takeState(st) {
    const before = SAVED, had = hideKnown;
    LIVE = st;
    hideKnown = !!(st.settings && "kaia_hide" in st.settings);
    recvAt = performance.now();
    if (st.synced) sync.add(parseTime(st.time), st.ms);
    SAVED = normalize(Object.assign({}, st.settings, { page_pass: "", wifi_pass: "", wifi_ssid: WIFI ? WIFI.ssid : "" }));
    for (const k of Object.keys(DRAFT)) if (k !== "page_pass" && DRAFT[k] === SAVED[k]) delete DRAFT[k];
    const changed = Object.keys(SAVED).filter((k) => SAVED[k] !== before[k]);
    const act = document.activeElement;
    const groups = new Set(changed.map(groupOf).filter(Boolean));
    if (hideKnown !== had) groups.add(groupOf("kaia_anim"));
    groups.forEach((g) => {
        const el = document.getElementById("g-" + g.id);
        if (!el || !el.contains(act) || act === document.body) renderGroup(g);
    });
}

async function poll(wifiToo) {
    if (polling) return;
    clearTimeout(pollT);
    polling = true;
    try {
        if (wifiToo || !WIFI) {
            WIFI = await api.wifi();
            if (!W.ssid && WIFI && WIFI.ssid) {
                W.ssid = WIFI.ssid;
                renderGroup(groupOf("wifi_ssid"));
            }
        }
        takeState(await api.state());
        P.conn = "ok";
        everOk = true;
        if ($("#modal").dataset.k === "login") closeModal();
    } catch (e) {
        if (e instanceof AuthError) {
            P.conn = "auth";
            loginModal();
        } else if (e instanceof OfflineError) {
            P.conn = "offline";
        } else {
            P.conn = "offline";
        }
    }
    polling = false;
    banners();
    markDirty();
    refreshLive();
    // every 5 s while the tab is visible; visibilitychange reads it again when it comes back
    if (P.conn !== "auth") pollT = setTimeout(() => !document.hidden && poll(false), 5000);
    if (mirrorWanted()) mirrorLoop();
}

// /kaia/frame: at most 4 a second, one at a time, only while the mirror is shown and the tab is visible
let mirrorOn = false;
const textNow = () => !!(LIVE && LIVE.overlay === "text");
const mirrorWanted = () => !document.hidden && P.conn === "ok" && (P.src === "now" || P.src === "cmp") && (P.live === "mirror" || textNow());

async function mirrorLoop() {
    if (mirrorOn) return;
    mirrorOn = true;
    while (mirrorWanted()) {
        const t = performance.now();
        try {
            const f = await api.frame();
            FRAME = { leds: parseLeds(f.leds), bright: f.bright, night: f.night, at: performance.now() };
        } catch (e) {
            if (e instanceof AuthError) {
                P.conn = "auth";
                loginModal();
            }
            break;
        }
        await new Promise((r) => setTimeout(r, Math.max(0, 250 - (performance.now() - t))));
    }
    mirrorOn = false;
}

// ================= the preview =================

const gainOf = (b) => 0.3 + (0.7 * b) / 255;
let view = null, view2 = null;

// the clock's time now (from the state), or the browser's before the first answer
function timeNow() {
    if (LIVE) {
        const t = sync.at(clockMillis());
        return { millis: clockMillis(), synced: !!LIVE.synced, hour: t.hour, minute: t.minute, ms: t.ms };
    }
    const d = new Date(), ms = performance.now();
    return { millis: ms, synced: true, hour: d.getHours(), minute: d.getMinutes(), ms: d.getMilliseconds() };
}

// what the clock plays now, from the state, at this moment (v1.5's state has wake, not look)
function playNow() {
    const p = LIVE && LIVE.play;
    if (!p) return null;
    const el = performance.now() - recvAt, anim = animOf(p.name);
    return { anim, style: p.style, look: p.look != null ? p.look : anim === A_WAKE ? p.wake || 0 : 0, lk: SAVED.kaia_listen, speed: p.speed || 100, t: p.t + el, color: p.color ? parseInt(p.color, 16) : null };
}

// the draft's play: the event pressed, in the draft's look of it
function playDraft(s) {
    const M = P.M;
    if (!M) return null;
    const t = RM && M.still != null ? M.still : performance.now() - M.t0;
    return { anim: M.anim, style: s.kaia_anim || 1, look: s[LOOK_KEYS[M.anim]], lk: s.kaia_listen, speed: s.kaia_wake_speed, t, color: null, ms: 7000 };
}

const lightNow = () => (LIVE ? LIVE.light : 500);
const nightFor = (s, tm) => (P.forceNight != null ? !!P.forceNight : isNight(s, lightNow(), tm.hour, tm.minute));
const work = new BallMatrix();

// «Сейчас»: the clock's own frame (mirror) or the renderer on the saved settings in step with the clock
function frameNow() {
    if (P.conn === "offline" && FRAME) return { leds: FRAME.leds, gain: gainOf(FRAME.bright) * 0.4, mirror: true };
    if ((P.live === "mirror" || textNow()) && FRAME && P.conn === "ok") return { leds: FRAME.leds, gain: gainOf(FRAME.bright), mirror: true, night: FRAME.night };
    const tm = timeNow(), play = playNow(), on = !!resolvePlay(play);
    const leds = renderFrame(work, hideSet(SAVED), { ...tm, night: LIVE ? !!LIVE.night : false, play, duck: on ? duckSince(play) : 0, hide: P.hideN.h });
    return { leds: Uint32Array.from(leds), gain: gainOf(LIVE ? LIVE.bright : 128) * (P.conn === "offline" ? 0.4 : 1), night: LIVE && LIVE.night };
}

// the settings the Digit fade reads: a clock before v1.7 has none, so its time never fades
const hideSet = (s) => (hideKnown || !s.kaia_hide ? s : { ...s, kaia_hide: 0 });

// the duck as it stands t ms into a play (it eases in over about 0.25 s)
function duckSince(play) {
    let d = 0;
    for (let n = Math.min(40, (play.t / 50) | 0); n > 0; n--) d = duckStep(d, true);
    return d;
}

function frameDraft() {
    const s = S(), tm = timeNow(), night = nightFor(s, tm);
    let play = playDraft(s);
    if (play && !resolvePlay(play)) {
        P.M = null;
        play = null;
        markKs();
    }
    const leds = renderFrame(work, hideSet(s), { ...tm, night, play, duck: P.duck, hide: P.hideD.h });
    return { leds: Uint32Array.from(leds), gain: gainOf(brightNow(s, lightNow())) * (P.conn === "offline" ? 0.4 : 1), night, play };
}

// «Готово · 6 · Конфетти» for what plays
function playLabel(p) {
    let t = EV[p.anim][0] + " · " + (p.look ? p.look + " · " + lookName(p.anim, p.look) : "0 → " + lookName(p.anim, verOf(p.anim, p.style)));
    if (p.anim === A_WAKE) t += " · " + p.speed + " % · " + fmtS(wakeLength(wakeOf(p.style, p.look), p.speed));
    return t;
}

function status(fr, src) {
    const pre = src === "now" ? "Сейчас · " : "Черновик · ";
    if (src === "now") {
        if (P.conn === "offline") return "нет связи · последний кадр";
        if (fr.mirror) return pre + (textNow() ? "бегущая строка · кадры с часов" : "зеркало · кадры с часов");
        const r = resolvePlay(playNow());
        return pre + (r ? playLabel(r) : (fr.night ? "ночь" : "день") + ", без анимации");
    }
    if (P.CL) return clText(P.CL);
    const p = fr.play && resolvePlay(fr.play);
    if (!p) return pre + (fr.night ? "ночь" : "день") + ", без анимации";
    return pre + playLabel(p) + (isState(p.anim) ? " · пока не нажмёте «Стоп»" : "");
}

function wipe(c, L) {
    const x = Math.round(L.W * P.cmp), y = L.H / 2;
    c.save();
    c.fillStyle = "#00d1ff";
    c.fillRect(x - 1, 0, 2, L.H);
    c.beginPath();
    c.arc(x, y, 14, 0, 6.2832);
    c.fill();
    c.fillStyle = "#031a22";
    c.beginPath();
    c.moveTo(x - 8, y);
    c.lineTo(x - 3, y - 5);
    c.lineTo(x - 3, y + 5);
    c.fill();
    c.beginPath();
    c.moveTo(x + 8, y);
    c.lineTo(x + 3, y - 5);
    c.lineTo(x + 3, y + 5);
    c.fill();
    c.restore();
}

function draw() {
    if (!view) return;
    P.frames = (P.frames || 0) + 1;
    const wall = $("#wall");
    wall.classList.toggle("cmp", P.src === "cmp");
    const d = frameDraft(), mini = document.body.classList.contains("minion");
    let shown = d;
    if (mini) {
        // the big preview is out of view: only the mini bar shows the frame
        if (P.src === "now") shown = frameNow();
    } else if (P.src === "cmp") {
        const n = frameNow(), x = Math.round(view.L.W * P.cmp);
        paint(view, n.leds, n.gain, [0, x]);
        paint(view, d.leds, d.gain, [x, view.L.W]);
        wipe(view.ctx, view.L);
        $("#badge").textContent = "";
    } else {
        shown = P.src === "now" ? frameNow() : d;
        paint(view, shown.leds, shown.gain);
        $("#badge").textContent = status(shown, P.src);
    }
    $("#pst").textContent = P.src === "cmp" ? "Слева «Сейчас», справа «Черновик»: тяните границу." : P.src === "now" ? (shown.mirror ? "«Сейчас»: кадры часов, 4 раза в секунду." : "«Сейчас»: расчёт на странице по состоянию часов.") : "«Черновик»: расчёт на странице по тем же данным.";
    if (view2 && mini) paint(view2, shown.leds, shown.gain);
    P.night = !!d.night;
    // the duck of the draft: one step a frame
    const s = S();
    P.duck = duckStep(P.duck, isPlaying(s, d.night, d.play));
    // the Digit fade's levels, by the real ms: «Черновик» from the event pressed, «Сейчас» from what the clock plays
    const now = performance.now() | 0;
    hideTrack(P.hideD, hideSet(s), isPlaying(s, d.night, d.play), now);
    hideTrack(P.hideN, hideSet(SAVED), isPlaying(SAVED, LIVE ? !!LIVE.night : false, playNow()), now);
}

function fit() {
    const wall = $("#wall"), cs = getComputedStyle(wall);
    const w = Math.floor(wall.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    if (w > 0 && (!view || view.L.W !== w)) view = fitCanvas($("#cv"), w);
    if (!view2) view2 = fitCanvas($("#cv2"), 240);
    sizeTiles();
    if (P.open) setSheet(true);
}

function setSrc(v) {
    P.src = v;
    $$("[data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === v));
    $("#day").hidden = v === "now";
    $("#live").hidden = v === "draft";
    if (mirrorWanted()) mirrorLoop();
}

function setLive(v) {
    P.live = v;
    $$("[data-l]").forEach((b) => b.classList.toggle("on", b.dataset.l === v));
    if (mirrorWanted()) mirrorLoop();
}

function play(name) {
    if (name === "off") {
        P.M = null;
        markKs();
        return;
    }
    const s = S();
    if (!s.kaia_anim) {
        toast("Анимации выключены: выберите стиль во вкладке «Кая»");
        return;
    }
    if (P.src === "now") setSrc("draft");
    const anim = ANIM_NAMES.indexOf(name), len = lenOf(anim, s[LOOK_KEYS[anim]], s);
    P.M = { anim, t0: performance.now() };
    if (RM) P.M.still = isState(anim) ? 1200 : (len / 2) | 0;
    markKs();
}

function markKs() {
    $$("[data-ks]").forEach((c) => {
        const k = c.dataset.ks;
        c.classList.toggle("on", k === "off" ? !P.M : k !== "cur" && +k === P.ev);
    });
    // the phone's chips scroll sideways: the event's one in view
    const c = $('#ks [data-ks="' + P.ev + '"]'), sc = c.parentNode;
    if (sc.scrollWidth > sc.clientWidth + 2 && (c.offsetLeft < sc.scrollLeft || c.offsetLeft + c.offsetWidth > sc.scrollLeft + sc.clientWidth)) sc.scrollLeft = c.offsetLeft - sc.offsetLeft - 8;
}

// ================= the tiles and the thumbnails: they animate only while visible =================

let tileIO = null;
const seen = new Set();

function bindTiles() {
    const now = performance.now();
    tiles = $$(".tile canvas,.er canvas").map((c) => {
        if (c.dataset.th != null) return { c, n: +c.dataset.th, id: -1, t0: now - +c.dataset.th * 230, v: null, w: 0, play: false };
        const st = c.closest(".tile").dataset.sty;
        if (st != null) return { c, sty: +st, n: -1, id: -1, t0: now - st * 370, v: null, w: 0, play: false };
        const [n, id] = c.closest(".tile").dataset.tc.split(":").map(Number);
        return { c, n, id, t0: now - id * 370, v: null, w: 0, play: false };  // spread over the cycle: some play while others pause
    });
    if ("IntersectionObserver" in window) {
        if (tileIO) tileIO.disconnect();
        seen.clear();
        tileIO = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target))));
        tiles.forEach((t) => tileIO.observe(t.c));
    }
    requestAnimationFrame(sizeTiles);
}

function sizeTiles() {
    tiles.forEach((t) => {
        const w = t.c.clientWidth;
        if (!w || w === t.w) return;
        t.w = w;
        t.v = fitCanvas(t.c, w);
        t.v.simple = true;
    });
    tilesTick(true);
}

// the clock under the tiles: the draft's background and time, with a style the looks can play over
function tileBase() {
    const s0 = S(), s = Object.assign({}, s0, { kaia_anim: s0.kaia_anim || 1, kaia_night: s0.kaia_night === 2 ? 1 : s0.kaia_night });
    const tm = timeNow(), night = nightFor(s, tm);
    const base = new BallMatrix(), sh = hideSet(s);
    renderFrame(base, sh, { ...tm, night, play: null, duck: 255, hide: 65535 });  // the time as it looks mid-animation
    return { s: sh, tm, night, base, hd: digitHide(sh, 65535), gain: gainOf(brightNow(s, lightNow())) * (P.conn === "offline" ? 0.4 : 1) };
}

// a style tile at el ms: the style's listening, or (P.thumb 1) its 7 events in a row as «Как у стиля» plays them: the
// wake with 1.6 s of listening after it, thinking and speaking 2.6 s each, then done, error and notify 0.45 s apart
function styPlay(st, el) {
    if (!P.thumb) return { anim: A_LISTENING, style: st, look: 0, t: el, ms: 1e9 };
    const seq = [[A_WAKE, wakeLength(verOf(A_WAKE, st), 100) + 1600], [A_THINKING, 2600], [A_SPEAKING, 2600], ...[A_DONE, A_ERROR, A_NOTIFY].map((n) => [n, shotLength(n, 0, st) + 450])];
    el %= seq.reduce((a, q) => a + q[1], 0) + 600;
    for (const [n, len] of seq) {
        if (el < len) return { anim: n, style: st, look: 0, lk: 0, speed: 100, t: el, ms: 1e9 };
        el -= len;
    }
    return null;
}

function overlayOn(b, play) {
    work.leds.set(b.base.leds);
    work.marks.set(b.base.marks);
    useMatrix(work);
    kaiaDraw(b.s, b.night, play, b.hd);
    return work.leds;
}

// a tile plays its look, a thumbnail its event's choice: a wake with 1.5 s of listening after it, a one-shot and a
// pause, a state on and on
// half: 0 or 1 paints every other tile (the loop alternates, so each tile still moves 10 times a second)
function tilesTick(force, half) {
    const live = tiles.filter((t, k) => t.v && t.c.isConnected && t.c.offsetParent && (!tileIO || seen.has(t.c) || force) && (half == null || (k & 1) === half));
    if (!live.length) return;
    const b = tileBase(), s = b.s, now = performance.now();
    for (const tl of live) {
        if (RM && !tl.play && !force) continue;
        if (tl.sty != null) {  // «Выкл» shows the clock as it is
            paint(tl.v, tl.sty ? overlayOn(b, styPlay(tl.sty, RM ? 1200 : now - tl.t0)) : renderFrame(work, s, { ...b.tm, night: b.night, play: null, duck: 0 }), b.gain);
            continue;
        }
        const n = tl.n, look = tl.id < 0 ? s[LOOK_KEYS[n]] : tl.id, len = lenOf(n, look, s), cyc = isState(n) ? 0 : len + (n === A_WAKE ? 1500 : 1100);
        let el = RM && !tl.play ? (isState(n) ? 1200 : (len / 2) | 0) : now - tl.t0;
        if (cyc) el %= cyc;
        if (RM && tl.play && now - tl.t0 > (cyc || 3000)) tl.play = false;
        paint(tl.v, overlayOn(b, { anim: n, style: s.kaia_anim, look, lk: s.kaia_listen, speed: s.kaia_wake_speed, t: el, color: null, ms: 1e9 }), b.gain);
    }
}

// ================= the loop: 20 frames a second, nothing in a hidden tab =================

let lastT = 0, lastTiles = 0, lastLive = 0;

function loop(now) {
    if (document.hidden) return;
    requestAnimationFrame(loop);
    if (now - lastT < 48) return;
    lastT = now;
    draw();
    if (now - lastTiles >= 48) {
        lastTiles = now;
        tilesTick(false, (P.frames || 0) & 1);
        if (P.CL) clUI();
    }
    if (now - lastLive >= 500) {
        lastLive = now;
        refreshLive();
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    requestAnimationFrame(loop);
    poll(false);
    if (mirrorWanted()) mirrorLoop();
});

// ================= dialogs =================

let toastT = 0;
function toast(h) {
    const t = $("#toast");
    t.innerHTML = h;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 3800);
}

function modal(h, on) {
    const m = $("#modal");
    m.innerHTML = '<div class="mb" role="dialog" aria-modal="true">' + h + "</div>";
    m.hidden = false;
    m.dataset.k = "";
    if (on) on(m);
}

function closeModal() {
    $("#modal").hidden = true;
    $("#modal").dataset.k = "";
}

function loginModal() {
    if ($("#modal").dataset.k === "login") return;
    modal('<h3>Страница защищена паролем</h3><p>Часы ответили 401. Введите пароль страницы.</p><input type="password" id="lp" placeholder="Пароль" autocomplete="current-password" aria-label="Пароль"><div class="err" id="le"></div><div class="acts"><button class="btn pri" id="lg">Войти</button></div>' + (MOCK ? '<p style="font-size:12px">Пароль макета: ' + MOCK_PASS + "</p>" : ""), (m) => {
        m.dataset.k = "login";
        const go = async () => {
            const v = $("#lp").value;
            if (!v) {
                $("#le").textContent = "Введите пароль";
                return;
            }
            const old = api.pass;
            api.pass = v;
            $("#lg").disabled = true;
            try {
                takeState(await api.state());
                lsSet(PASS_KEY, v);
                P.conn = "ok";
                closeModal();
                poll(true);
            } catch (e) {
                api.pass = old;
                $("#le").textContent = e instanceof AuthError ? "Неверный пароль" : "Часы не ответили";
                $("#lp").select();
            }
            const b = $("#lg");
            if (b) b.disabled = false;
        };
        $("#lg").onclick = go;
        $("#lp").onkeydown = (e) => {
            if (e.key === "Enter") go();
        };
        setTimeout(() => $("#lp") && $("#lp").focus(), 50);
    });
}

function updateModal() {
    modal("<h3>Обновить прошивку?</h3><p>Часы скачают новую прошивку и перезагрузятся, около минуты. Не выключайте их. Настройки сохранятся.</p><div class=\"acts\"><button class=\"btn\" id=\"un\">Отмена</button><button class=\"btn pri\" id=\"uy\">Обновить</button></div>", () => {
        $("#un").onclick = closeModal;
        $("#uy").onclick = async () => {
            $("#uy").disabled = true;
            try {
                await api.set(ID_OTA_UPDATE, 1);
                closeModal();
                toast("Часы обновляются и перезагрузятся. Страница подождёт их.");
            } catch (e) {
                closeModal();
                failed(e);
            }
        };
    });
}

function failed(e) {
    if (e instanceof AuthError) {
        P.conn = "auth";
        loginModal();
    } else {
        toast("Часы не ответили. Попробуйте ещё раз.");
    }
}

// ================= saving =================

async function save() {
    const ks = Object.keys(DRAFT).sort((a, b) => (a === "page_pass") - (b === "page_pass"));  // the password last
    if (!ks.length || P.saving || P.conn !== "ok") return;
    P.saving = true;
    markDirty();
    let done = 0;
    try {
        for (const k of ks) {
            $("#sbn").textContent = "Сохраняю " + (done + 1) + " из " + ks.length + "…";
            await api.set(keyId(k), rawOf(k, DRAFT[k]));
            if (k === "page_pass") {
                api.pass = DRAFT[k];
                lsSet(PASS_KEY, api.pass);
            } else {
                SAVED[k] = DRAFT[k];
            }
            delete DRAFT[k];
            done++;
        }
        toast("Сохранено: " + done + ". Часы обновились.");
    } catch (e) {
        failed(e);
    }
    P.saving = false;
    renderAll();
    await poll(false);
}

function reset() {
    const copy = Object.assign({}, DRAFT);
    Object.keys(DRAFT).forEach((k) => delete DRAFT[k]);
    renderAll();
    toast('Изменения сброшены <button class="btn sm" id="undo" style="margin-left:8px">Вернуть</button>');
    $("#undo").onclick = () => {
        Object.assign(DRAFT, copy);
        renderAll();
        $("#toast").hidden = true;
    };
}

function showChanges() {
    modal('<h3>Не сохранено</h3><ul class="chl">' + Object.keys(DRAFT).map((k) => "<li><b>" + esc(FLD[k].g + " · " + FLD[k].l) + "</b><span>" + esc(fmtAny(k, SAVED[k])) + " → " + esc(fmtAny(k, DRAFT[k])) + "</span></li>").join("") + '</ul><div class="acts"><button class="btn" id="mc">Закрыть</button></div>', () => ($("#mc").onclick = closeModal));
}

// ================= «Показать на часах»: the event in view with the draft's choice, nothing saved =================

const clText = (cl) => (cl.done ? "Сыграно на часах: " + cl.label + ". Ничего не сохранено." : "Идёт на часах: " + cl.label + " · ещё " + fmtS(Math.max(0, cl.t0 + cl.dur - performance.now())));

async function onclock() {
    const s = S(), n = P.ev, name = ANIM_NAMES[n];
    if (!s.kaia_anim) {
        toast("Анимации выключены: выберите стиль во вкладке «Кая»");
        return;
    }
    if (P.conn !== "ok") {
        toast("Нет связи с часами");
        return;
    }
    const q = tryOut(name, s), c = q.look;
    const dur = isState(n) ? TRY_STATE_MS : lenOf(n, c, s);
    P.CL = { n, label: EV[n][0] + " · " + (c ? c + " " + lookName(n, c) : "Как у стиля"), t0: performance.now(), dur, done: false };
    play(name);
    clUI();
    try {
        await api.anim(name, q);
        toast("Играет на часах" + (isState(n) ? " " + TRY_STATE_MS / 1000 + " с" : "") + ", ничего не сохраняется<br><code>GET kaia/anim?" + esc(new URLSearchParams({ name, ...q }).toString()) + "</code>");
        setTimeout(() => poll(false), 400);
    } catch (e) {
        P.CL = null;
        clUI();
        failed(e);
    }
}

// what the try-out says, under both buttons, and the buttons while it plays
function clUI() {
    const cl = P.CL, now = performance.now();
    if (cl && !cl.done && now >= cl.t0 + cl.dur) {
        cl.done = true;
        cl.te = now;
    } else if (cl && cl.done && now - cl.te > 6000) P.CL = null;
    const run = !!P.CL && !P.CL.done, txt = P.CL ? clText(P.CL) : "Играет на часах без сохранения.";
    $$(".cl-st").forEach((e) => {
        if (e.textContent !== txt) e.textContent = txt;
    });
    const h = run ? '<span class="long">Играет на часах…</span><span class="short">Играет…</span>' : TRY;
    $$("[data-act=onclock]").forEach((b) => {
        b.disabled = run;
        if (b.dataset.h !== h) {
            b.dataset.h = h;
            b.innerHTML = h;
        }
    });
}

async function clickBtn(id, msg) {
    try {
        await api.click(id);
        if (msg) toast(msg);
        setTimeout(() => poll(false), 300);
    } catch (e) {
        failed(e);
    }
}

// ================= the unlit balls (⚙ on the preview): this page's look only =================

const UP = { ivory: { c: IVORY, tr: 0 }, white: { c: 0xf2f2f2, tr: 0 }, graphite: { c: 0x4a4d55, tr: 0 }, glass: { c: 0xdfe6ee, tr: 70 } };

function syncU() {
    $("#ucol").value = hexs(unlit.c);
    $("#utr").value = unlit.tr;
    $("#utro").textContent = unlit.tr + " %";
    $("#gear").classList.toggle("chg", unlit.c !== IVORY || unlit.tr !== 0);
    $$("#upre [data-up]").forEach((b) => {
        const p = UP[b.dataset.up];
        b.classList.toggle("on", p.c === unlit.c && p.tr === unlit.tr);
    });
}

function setU(c, tr) {
    setUnlit({ c, tr }, store);
    syncU();
    tilesTick(true);
}

function popOpen(o) {
    $("#pop").hidden = !o;
    $("#gear").setAttribute("aria-expanded", String(o));
    $("#gear").classList.toggle("on", o);
    if (o) syncU();
}

// ================= events =================

document.addEventListener("input", (e) => {
    const t = e.target, k = t.dataset && t.dataset.k;
    if (t.id === "ucol") return setU(unhex(t.value), unlit.tr);
    if (t.id === "utr") return setU(unlit.c, +t.value);
    if (t.dataset && t.dataset.w) {
        W[t.dataset.w] = t.value;
        return;
    }
    if (!k) return;
    let v;
    if (t.type === "checkbox") v = t.checked ? 1 : 0;
    else if (t.type === "color") v = unhex(t.value);
    else if (t.type === "time") v = unhm(t.value);
    else if (t.type === "range" || t.tagName === "SELECT") v = +t.value;
    else v = t.value;
    setVal(k, v);
    if (t.type === "range") {
        const o = t.closest(".fld").querySelector("output");
        if (o) o.textContent = fmtVal(k, v);
    }
    if (k === "kaia_hide") fillHide();
    else if (t.type === "checkbox" || (t.tagName === "SELECT" && !k.startsWith("kaia_"))) renderGroup(groupOf(k));
    // a colour or a fade time changed: play the event so the change is seen at once
    if ((k === "kaia_color" || k.startsWith("kaia_hide")) && !P.M && S().kaia_anim) play(ANIM_NAMES[P.ev]);
});

document.addEventListener("click", (e) => {
    if (!$("#pop").hidden && !e.target.closest("#pop,#gear")) popOpen(false);
    const t = e.target.closest("button,a,.sb-t");
    if (!t) return;
    const d = t.dataset;
    if (t.id === "gear") return popOpen($("#pop").hidden);
    if (t.id === "ubreset") return setU(IVORY, 0);
    if (d.up) return setU(UP[d.up].c, UP[d.up].tr);
    if (d.rv) {
        delete DRAFT[d.rv];
        renderGroup(groupOf(d.rv));
        return;
    }
    if (d.pick != null) return setVal("back_pal", +d.pick);
    if (d.pstep) return stepPal(+d.pstep);
    if (d.step) {
        const k = d.k2, f = FLD[k], v = Math.max(f.min, Math.min(f.max, S()[k] + +d.step));
        setVal(k, v);
        renderGroup(groupOf(k));
        return;
    }
    if (d.tab) {
        showTab(d.tab);
        if (d.tab === "kaia" && !P.M && P.conn !== "offline" && S().kaia_anim) setTimeout(() => play(ANIM_NAMES[P.ev]), 250);
        return;
    }
    if (d.sty != null) {
        setVal("kaia_anim", +d.sty);
        renderGroup(groupOf("kaia_anim"));
        if (+d.sty) play(ANIM_NAMES[P.ev]);
        else play("off");
        return;
    }
    if (d.sgr != null) {
        P.grp = +d.sgr;
        showStyGroup();
        return;
    }
    if (d.thumb != null) {
        P.thumb = +d.thumb;
        const now = performance.now();
        tiles.forEach((x) => x.sty != null && (x.t0 = now - x.sty * 370));
        updKaya();
        return;
    }
    if (d.tc) {
        const [n, id] = d.tc.split(":").map(Number);
        P.ev = n;
        setVal(LOOK_KEYS[n], id);
        const tl = tiles.find((x) => x.n === n && x.id === id);
        if (tl && RM) {
            tl.play = true;
            tl.t0 = performance.now();
        }
        markKs();
        hsum();
        play(ANIM_NAMES[n]);
        return;
    }
    if (d.ev != null) return setEvent(+d.ev, true);
    if (d.close != null) return setSheet(false);
    if (d.sp) {
        setVal("kaia_wake_speed", +d.sp);
        $$('[data-k="kaia_wake_speed"]').forEach((r) => (r.value = +d.sp));
        play("wake");
        return;
    }
    if (d.ks) {
        if (d.ks === "off") play("off");
        else if (d.ks === "cur") play(ANIM_NAMES[P.ev]);
        else setEvent(+d.ks, false);
        return;
    }
    if (d.s) return setSrc(d.s);
    if (d.l) return setLive(d.l);
    if (d.d != null) {
        // on the phone one button shows the state and switches it
        const narrow = matchMedia("(max-width:900px)").matches;
        P.forceNight = narrow && t.classList.contains("on") ? 1 - +d.d : +d.d;
        refreshLive();
        tilesTick(true);
        return;
    }
    if (d.m) return mockMode(d.m);
    const a = d.act;
    if (a === "onclock") onclock();
    else if (a === "upd") updateModal();
    else if (a === "retry") poll(true);
    else if (a === "admin") clickBtn(keyId("adc_min"), "Минимум сигнала запомнен: " + lightNow());
    else if (a === "admax") clickBtn(keyId("adc_max"), "Максимум сигнала запомнен: " + lightNow());
    else if (a === "wifi") connectWifi();
    else if (a === "check") checkUpdates();
    else if (t.id === "sbsave") save();
    else if (t.id === "sbreset") reset();
    else if (t.id === "logout") logout();
    else if (t.classList.contains("sb-t")) showChanges();
});

async function connectWifi() {
    if (!W.ssid) {
        toast("Укажите сеть (SSID)");
        return;
    }
    try {
        await api.set(keyId("wifi_ssid"), W.ssid);
        await api.set(keyId("wifi_pass"), W.pass);
        await api.click(ID_WIFI_SAVE);
        W.pass = "";
        renderGroup(groupOf("wifi_ssid"));
        toast("Часы подключаются к «" + esc(W.ssid) + "». Страница может на минуту потерять связь.");
        setTimeout(() => poll(true), 1500);
    } catch (e) {
        failed(e);
    }
}

async function checkUpdates() {
    P.upd = "Проверяю…";
    renderGroup(groupOf("_chk"));
    try {
        await api.click(ID_CHECK_UPDATES);
        await new Promise((r) => setTimeout(r, MOCK ? 700 : 4000));
        await poll(false);
        P.upd = LIVE && LIVE.update ? "" : "Обновлений нет: у вас последняя версия";
    } catch (e) {
        P.upd = "";
        failed(e);
    }
    renderGroup(groupOf("_chk"));
}

function logout() {
    api.pass = "";
    lsSet(PASS_KEY, "");
    toast("Пароль забыт в этом браузере");
    poll(false);
}

// ?mock: the bar switches what the clock inside the page does
function mockMode(m) {
    const M = mock.M;
    if (m === "upd") M.update = !M.update;
    else if (m === "text") M.text = !M.text;
    else {
        M.mode = m;
        if (m === "auth") {
            api.pass = "";
            lsSet(PASS_KEY, "");
        }
    }
    $$("#mk [data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === "upd" ? M.update : b.dataset.m === "text" ? M.text : b.dataset.m === M.mode));
    if (m !== "auth" && $("#modal").dataset.k === "login") closeModal();
    if (m === "ap") showTab("net");
    WIFI = null;
    poll(true);
}

// the wipe of «Сравнить»
let drag = false;
const moveCmp = (e) => {
    const r = $("#cv").getBoundingClientRect();
    P.cmp = Math.max(0.04, Math.min(0.96, (e.clientX - r.left) / r.width));
};
$("#cv").addEventListener("pointerdown", (e) => {
    if (P.src !== "cmp") return;
    drag = true;
    e.target.setPointerCapture(e.pointerId);
    moveCmp(e);
});
$("#cv").addEventListener("pointermove", (e) => drag && moveCmp(e));
$("#cv").addEventListener("pointerup", () => (drag = false));

// ================= start =================

if (MOCK) $("#mockbar").hidden = false;
buildGroups();
$("#ks").innerHTML = EV.map((e, n) => '<button class="chip" data-ks="' + n + '">' + e[0] + "</button>").join("") + '<button class="chip" data-ks="off">Стоп</button>';
renderAll();
showTab("kaia");
setSrc("draft");
syncU();
clUI();
new ResizeObserver(() => requestAnimationFrame(fit)).observe($("#wall"));
window.addEventListener("resize", () => requestAnimationFrame(sizeTiles));
if ("IntersectionObserver" in window) new IntersectionObserver((es) => document.body.classList.toggle("minion", !es[0].isIntersecting && innerWidth > 900)).observe($("#hero"));
fit();
banners();
poll(true);
requestAnimationFrame(loop);
setTimeout(() => S().kaia_anim && !P.M && play(ANIM_NAMES[P.ev]), 600);
window.ballclock = {
    P, api, S, play, poll, setSrc, setLive, showTab, setEvent, setSheet, mock, sync, unlit, setU,
    tilesAt: (ms) => tiles.forEach((t) => (t.t0 = performance.now() - ms)), get LIVE() { return LIVE; }, get tiles() { return tiles; },
};
