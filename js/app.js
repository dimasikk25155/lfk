/* Травка — приложение дашборда здоровья и ЛФК.
   Ванильный JS без модулей: файл открывается и с file://, и с хостинга.
   Прогресс живёт только в localStorage этого браузера, наружу ничего не уходит. */

(function () {
  'use strict';

  /* ══════════════════════ данные и константы ══════════════════════ */

  var EX = window.LFK_EXERCISES || [];
  var ZONES = window.LFK_ZONES || [];
  var FACTS = window.LFK_FACTS || {};
  var PROGRAM = window.LFK_PROGRAM || { routines: [], rotation: [] };

  // Зоны упражнений. Цвет — из валидированной палитры, но рядом ВСЕГДА подпись:
  // цвет здесь не единственный носитель смысла.
  var EX_ZONES = {
    neck:     { title: 'Шея',       icon: '🦴', v: '--s1' },
    thoracic: { title: 'Грудной',   icon: '🫁', v: '--s3' },
    lumbar:   { title: 'Поясница',  icon: '🦴', v: '--s2' },
    knee:     { title: 'Колени',    icon: '🦵', v: '--s8' },
    hip:      { title: 'Пах',       icon: '🫃', v: '--s5' },
    foot:     { title: 'Стопы',     icon: '🦶', v: '--s4' },
    pool:     { title: 'Бассейн',   icon: '🏊', v: '--s6' },
    strength: { title: 'Сила',      icon: '🏋️', v: '--s7' },
    test:     { title: 'Тесты',     icon: '📏', v: '--ink-2' }
  };
  var ZONE_ORDER = ['neck', 'thoracic', 'lumbar', 'knee', 'hip', 'foot', 'strength', 'pool', 'test'];

  var STATUS = {
    red:   { label: 'красная зона', badge: 'red',   mark: '🔴' },
    amber: { label: 'под наблюдением', badge: 'amber', mark: '🟡' },
    green: { label: 'спокойно',     badge: 'green', mark: '🟢' }
  };

  var DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  function zoneOf(id) { return EX_ZONES[id] || { title: id || '—', icon: '•', v: '--ink-3' }; }
  function zoneColor(id) { return 'var(' + zoneOf(id).v + ')'; }
  function byId(id) { for (var i = 0; i < EX.length; i++) if (EX[i].id === id) return EX[i]; return null; }

  /* ══════════════════════ хранилище ══════════════════════ */

  var KEY = 'travka.lfk.v1';
  var S;

  function freshStore() {
    return { v: 3, startedAt: ymd(new Date()), sessions: [], ex: {}, tests: {}, lib: {}, settings: { theme: 'dark' } };
  }
  // Схема v1 знала про 6 недель программы (weekOverride) — ротация её отменила.
  // v3 добавила lib — отметки «зашло / не зашло» по библиотеке Епифанова.
  // Журнал, счётчики и замеры при этом переезжают как есть: терять историю нельзя.
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return freshStore();
      var o = JSON.parse(raw);
      var d = freshStore();
      for (var k in d) if (!(k in o)) o[k] = d[k];
      if (!o.settings) o.settings = d.settings;
      if (o.v !== 3) { delete o.weekOverride; o.v = 3; }
      if (!o.lib) o.lib = {};
      return o;
    } catch (e) { return freshStore(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  /* ══════════════════════ даты ══════════════════════ */

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
  function todayIdx() { return (new Date().getDay() + 6) % 7; }  // 0 = понедельник
  function humanDate(s) {
    var m = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    var d = parseYmd(s);
    return d.getDate() + ' ' + m[d.getMonth()];
  }

  /* ══════════════════════ расчёты прогресса ══════════════════════ */

  function minutesOn(day) {
    var t = 0;
    for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].date === day) t += S.sessions[i].minutes || 0;
    return t;
  }
  function activeDays() {
    var set = {};
    for (var i = 0; i < S.sessions.length; i++) set[S.sessions[i].date] = 1;
    return set;
  }
  function streak() {
    var set = activeDays(), n = 0, d = new Date();
    if (!set[ymd(d)]) { d = addDays(d, -1); if (!set[ymd(d)]) return 0; }
    while (set[ymd(d)]) { n++; d = addDays(d, -1); }
    return n;
  }
  function last7() {
    var out = [], d;
    for (var i = 6; i >= 0; i--) { d = addDays(new Date(), -i); out.push({ day: ymd(d), label: DAYS[(d.getDay() + 6) % 7], min: minutesOn(ymd(d)) }); }
    return out;
  }
  function heatLevel(min) { return min === 0 ? 0 : min < 10 ? 1 : min < 20 ? 2 : min < 35 ? 3 : 4; }

  // Неделя одна и та же и повторяется бесконечно — «неделя программы» больше не считается.
  function rotationDay(idx) {
    var r = PROGRAM.rotation || [];
    return r[idx] || null;
  }
  function weeksDone() {
    if (!S.startedAt) return 0;
    return Math.max(0, Math.floor(daysBetween(S.startedAt, ymd(new Date())) / 7));
  }
  function routineObj(id) {
    var r = PROGRAM.routines || [];
    for (var i = 0; i < r.length; i++) if (r[i].id === id) return r[i];
    return null;
  }
  /* ─────── ротация слотами ───────
     Элемент items рутины — либо id (жёсткий якорь), либо слот {slot, pool, pick}.
     Слот выбирает pick упражнений из пула циклическим окном: каждую неделю окно
     сдвигается на pick, поэтому за ceil(pool/pick) недель проходит весь пул.
     Номер недели считается от фиксированного понедельника — состав дня
     детерминирован: перезагрузка страницы ничего не перетасует. */

  var WEEK0 = new Date(2026, 0, 5);   // понедельник — точка отсчёта недель ротации
  function weekKey(d) {
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor(Math.round((t - WEEK0) / 86400000) / 7);
  }
  function slotPick(slot, wk) {
    var pool = slot.pool || [], pick = Math.min(slot.pick || pool.length, pool.length);
    if (!pool.length) return [];
    var off = ((wk * pick) % pool.length + pool.length) % pool.length;
    var out = [];
    for (var i = 0; i < pick; i++) out.push(pool[(off + i) % pool.length]);
    return out;
  }
  // Разворачивает рутину в конкретный состав на дату: упражнения по порядку
  // плюс описание слотов («что выбрано сейчас, что будет в следующий раз»).
  function resolveRoutine(r, date) {
    var wk = weekKey(date || new Date());
    var out = { exercises: [], slots: [] };
    if (!r || !r.items) return out;
    for (var i = 0; i < r.items.length; i++) {
      var it = r.items[i];
      if (typeof it === 'string') { var e = byId(it); if (e) out.exercises.push(e); continue; }
      var now = slotPick(it, wk), nxt = slotPick(it, wk + 1);
      for (var j = 0; j < now.length; j++) { var ee = byId(now[j]); if (ee) out.exercises.push(ee); }
      out.slots.push({
        label: it.slot || 'ротация', pool: it.pool || [], pick: it.pick || 0,
        now: now, next: nxt,
        cycle: Math.ceil((it.pool || []).length / Math.max(1, it.pick || 1))
      });
    }
    return out;
  }
  function routineExercises(r, date) { return resolveRoutine(r, date).exercises; }
  function routineMinutes(r, date) {
    var ex = routineExercises(r, date), t = 0;
    for (var i = 0; i < ex.length; i++) t += ex[i].minutes || 2;
    return t;
  }
  function dayRoutines(idx) {
    var d = rotationDay(idx);
    if (!d || !d.routines) return [];
    var out = [];
    for (var i = 0; i < d.routines.length; i++) { var r = routineObj(d.routines[i]); if (r) out.push(r); }
    return out;
  }
  // дата этого дня недели на текущей неделе — чтобы План показывал состав именно этой недели
  function dateOfWeekday(idx) { return addDays(new Date(), idx - todayIdx()); }
  function dayMinutes(idx) {
    var dt = dateOfWeekday(idx);
    return dayRoutines(idx).reduce(function (a, r) { return a + routineMinutes(r, dt); }, 0);
  }
  function todayRoutines() { return dayRoutines(todayIdx()); }
  function doneToday(routineId) {
    var t = ymd(new Date());
    for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].date === t && S.sessions[i].routine === routineId) return true;
    return false;
  }

  /* ══════════════════════ дозы и прогрессия ══════════════════════

     Растёт не расписание, а цифры. Правило одно на все упражнения и считается
     из стартовой дозы, а не из отдельной лестницы на каждое: ступень — 10 % от
     старта (но не меньше 2), потолок — двойная стартовая доза. Дошли до потолка —
     предлагается лишний подход, после него прогрессия уходит в ручной режим и
     показывает то, что написано в поле progression самого упражнения.
     Тесты (timerMode 'none') не прогрессируют: там меряют, а не тренируют. */

  var PROG_STEP_MIN = 2;      // минимальная ступень: +2 секунды или +2 повтора
  var PROG_CLEAN_RUNS = 3;    // сколько занятий подряд без боли до предложения
  var PROG_CLEAN_PAIN = 3;    // «без боли» — это оценка не выше 3
  var PROG_DROP_PAIN = 6;     // с этой боли доза откатывается сама
  var PROG_COOLDOWN = 5;      // дней между повышениями одного упражнения
  var PROG_SNOOZE = 7;        // на столько дней прячется отклонённое предложение

  function progKey(e) {
    if (!e || e.timerMode === 'none') return null;
    if (e.timerMode === 'reps') return (e.dose && e.dose.reps) ? 'reps' : null;
    return (e.dose && e.dose.hold) ? 'hold' : null;   // hold и duration
  }
  function progStep(base) { return Math.max(PROG_STEP_MIN, Math.round(base * 0.1)); }
  function baseDose(e) { return e.dose || {}; }
  function doseOf(e) {
    var st = e && S.ex[e.id];
    return (st && st.dose) || baseDose(e);
  }
  function doseChanged(e) {
    var st = e && S.ex[e.id];
    return !!(st && st.dose);
  }
  function shortDose(d, e) {
    var k = progKey(e), parts = [];
    if (d.sets) parts.push(d.sets);
    if (k === 'reps' && d.reps) parts.push(d.reps + ' повт');
    else if (d.hold) parts.push(d.hold + ' сек');
    return parts.join(' × ');
  }
  // Текст дозы: у нетронутых — авторский (в нём есть «на каждую сторону» и прочие
  // оговорки, которые цифрами не передать), у поднятых — короткая честная строка.
  function doseTextOf(e) {
    return doseChanged(e) ? shortDose(doseOf(e), e) : (e.doseText || '');
  }

  // Шаг лестницы из произвольной дозы. Один и тот же код кормит и движок
  // (nextDose от текущей дозы), и видимую лестницу (перебор от стартовой) —
  // им нельзя разъехаться.
  function nextDoseFrom(e, c) {
    var k = progKey(e);
    if (!k) return null;
    var b = baseDose(e);
    var out = { sets: c.sets, reps: c.reps, hold: c.hold, rest: c.rest };
    if (c[k] + progStep(b[k]) <= b[k] * 2) { out[k] = c[k] + progStep(b[k]); return out; }
    // потолок по времени/повторам взят: даём лишний подход и возвращаемся к стартовой цифре.
    // Упражнениям, где подходов и так много (изометрия по 10 удержаний), подходы не добавляем.
    if ((b.sets || 1) <= 5 && (c.sets || 1) < (b.sets || 1) + 2) {
      out.sets = (c.sets || 1) + 1; out[k] = b[k]; return out;
    }
    return null;
  }
  function nextDose(e) { return nextDoseFrom(e, doseOf(e)); }
  // Вся лестница от старта до потолка + позиция текущей дозы на ней.
  function doseLadder(e) {
    var k = progKey(e);
    if (!k) return null;
    var steps = [baseDose(e)], cur = baseDose(e), guard = 0;
    while (guard++ < 40) { var n = nextDoseFrom(e, cur); if (!n) break; steps.push(n); cur = n; }
    var d = doseOf(e), at = 0;
    for (var i = 0; i < steps.length; i++) {
      if ((steps[i].sets || 1) === (d.sets || 1) && steps[i][k] === d[k]) { at = i; break; }
    }
    return { steps: steps, at: at };
  }
  // Почему доза ещё не выросла — та же логика, что readyToBump, но словами.
  function bumpStatus(e) {
    if (!progKey(e)) return null;
    var st = S.ex[e.id] || {};
    if (!nextDose(e)) return 'Потолок автопрогрессии взят. Дальше — ручной режим: см. «Усложнить» ниже.';
    var today = ymd(new Date());
    if (st.snooze && daysBetween(st.snooze, today) < PROG_SNOOZE)
      return 'Предложение отложено — вернётся через ' + (PROG_SNOOZE - daysBetween(st.snooze, today)) + ' дн.';
    if (st.bumpedAt && daysBetween(st.bumpedAt, today) < PROG_COOLDOWN)
      return 'Дозу недавно подняли — кулдаун ещё ' + (PROG_COOLDOWN - daysBetween(st.bumpedAt, today)) + ' дн.';
    var runs = lastRuns(e.id, PROG_CLEAN_RUNS), clean = 0;
    for (var i = 0; i < runs.length; i++) {
      if (runs[i].status === 'done' && runs[i].pain != null && runs[i].pain <= PROG_CLEAN_PAIN) clean++;
      else break;
    }
    if (clean >= PROG_CLEAN_RUNS) return 'Готово к подъёму — приложение предложит после следующей тренировки.';
    return 'До следующей ступени: ' + clean + ' из ' + PROG_CLEAN_RUNS + ' занятий подряд с болью не выше ' + PROG_CLEAN_PAIN + '.';
  }
  function prevDose(e) {
    var k = progKey(e);
    if (!k) return null;
    var b = baseDose(e), c = doseOf(e);
    var out = { sets: c.sets, reps: c.reps, hold: c.hold, rest: c.rest };
    if ((c.sets || 1) > (b.sets || 1)) { out.sets = c.sets - 1; return out; }
    var floor = Math.ceil(b[k] / 2);
    if (c[k] - progStep(b[k]) >= floor) { out[k] = c[k] - progStep(b[k]); return out; }
    if (c[k] > floor) { out[k] = floor; return out; }
    return null;
  }
  function applyDose(id, d, why) {
    if (!S.ex[id]) S.ex[id] = { count: 0 };
    S.ex[id].dose = d;
    S.ex[id].bumpedAt = ymd(new Date());
    S.ex[id].snooze = null;
    (S.ex[id].history = S.ex[id].history || []).push({ date: ymd(new Date()), dose: d, why: why });
    save();
  }

  // Три последних занятия, где это упражнение реально делалось.
  function lastRuns(id, n) {
    var out = [];
    for (var i = S.sessions.length - 1; i >= 0 && out.length < n; i--) {
      var s = S.sessions[i], items = s.items || [];
      for (var j = 0; j < items.length; j++) {
        if (items[j].id === id) { out.push({ status: items[j].status, pain: s.pain, date: s.date }); break; }
      }
    }
    return out;
  }
  function readyToBump(e) {
    var st = S.ex[e.id] || {};
    if (!progKey(e) || !nextDose(e)) return false;
    var today = ymd(new Date());
    if (st.snooze && daysBetween(st.snooze, today) < PROG_SNOOZE) return false;
    if (st.bumpedAt && daysBetween(st.bumpedAt, today) < PROG_COOLDOWN) return false;
    var runs = lastRuns(e.id, PROG_CLEAN_RUNS);
    if (runs.length < PROG_CLEAN_RUNS) return false;
    for (var i = 0; i < runs.length; i++) {
      if (runs[i].status !== 'done') return false;
      if (runs[i].pain == null || runs[i].pain > PROG_CLEAN_PAIN) return false;
    }
    return true;
  }
  function bumpCandidates(ids) {
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var e = byId(ids[i]);
      if (e && readyToBump(e)) out.push(e);
    }
    return out;
  }
  // Откат — без вопросов: это то же правило боли, что и «убрать упражнение».
  function dropDoses(ids) {
    var n = 0;
    for (var i = 0; i < ids.length; i++) {
      var e = byId(ids[i]);
      if (!e) continue;
      var d = prevDose(e);
      if (d) { applyDose(e.id, d, 'откат по боли'); n++; }
    }
    return n;
  }
  function bumpedList() {
    var out = [];
    for (var id in S.ex) {
      var e = byId(id);
      if (e && S.ex[id].dose) out.push(e);
    }
    return out;
  }

  // Сколько раз в неделю упражнение реально стоит в плане (среднее по 4 неделям
  // ротации) — нужно для честного прогноза «когда потолок».
  var occCache = null;
  function occPerWeek(id) {
    if (!occCache) {
      occCache = {};
      for (var wk = 0; wk < 4; wk++) {
        for (var di = 0; di < 7; di++) {
          var rs = dayRoutines(di), dt = addDays(WEEK0, wk * 7 + di);
          for (var i = 0; i < rs.length; i++) {
            var ex = resolveRoutine(rs[i], dt).exercises;
            for (var j = 0; j < ex.length; j++) occCache[ex[j].id] = (occCache[ex[j].id] || 0) + 1;
          }
        }
      }
    }
    return (occCache[id] || 0) / 4;
  }

  // Сводка зоны по лестницам: средний прогресс, кто на потолке, прогноз недель
  // до потолка при чистых занятиях (ограничен кулдауном и частотой в плане).
  function zoneLadderStats(zk) {
    var exs = EX.filter(function (e) { return e.zone === zk && progKey(e); });
    if (!exs.length) return null;
    var pos = 0, tot = 0, atCeil = 0, remWeeks = 0;
    exs.forEach(function (e) {
      var L = doseLadder(e);
      pos += L.at; tot += L.steps.length - 1;
      var rem = (L.steps.length - 1) - L.at;
      if (rem <= 0) { atCeil++; return; }
      var f = occPerWeek(e.id) || 0.5;
      remWeeks = Math.max(remWeeks, rem * Math.max(PROG_COOLDOWN / 7, PROG_CLEAN_RUNS / f));
    });
    return { pct: tot ? Math.round(pos / tot * 100) : 0, n: exs.length, atCeil: atCeil, remWeeks: Math.ceil(remWeeks) };
  }

  /* ══════════════════════ хелперы разметки ══════════════════════ */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function list(arr, fn) { return (arr || []).map(fn).join(''); }
  function plural(n, a, b, c) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b;
    return c;
  }
  // Растровые (WebP, SDXL/ControlNet по карте позы из того же SVG-скелета)
  // есть только для этих id. Остальные 9 — ракурс не читается моделью или
  // сливаются две фигуры в кадре — остаются схематичным SVG, см. вольт
  // wiki/concepts/pose-maps-from-own-svg-to-sdxl-controlnet.md.
  var WEBP_IDS = {
    'ankle-arch-roll': 1, 'ankle-calf-bent': 1, 'ankle-calf-straight': 1, 'ankle-heel-raise': 1,
    'ankle-selfresist-4way': 1, 'ankle-short-foot': 1, 'ankle-toe-raise': 1, 'hip-lunge-stretch': 1,
    'hip-supine-thomas': 1, 'knee-bike': 1, 'knee-clamshell': 1, 'knee-glute-ball': 1,
    'knee-quad-set': 1, 'knee-side-abduction': 1, 'knee-single-leg-bridge': 1, 'knee-slr': 1,
    'knee-wall-sit': 1, 'lum-bird-dog': 1, 'lum-bracing': 1, 'lum-dead-bug': 1,
    'lum-glute-bridge': 1, 'lum-press-up': 1, 'lum-prone-elbows': 1, 'lum-side-plank-knee': 1,
    'neck-chin-tuck': 1, 'neck-iso-back': 1, 'neck-iso-front': 1, 'neck-iso-rotate': 1,
    'neck-iso-side': 1, 'pool-aquajog': 1, 'pool-backstroke': 1, 'pool-kick-board': 1,
    'pool-walk': 1, 'si-glute-iso-prone': 1, 'si-supine-march': 1, 'str-biceps-seated': 1,
    'str-calf-seated-load': 1, 'str-floor-press': 1, 'str-glute-bridge-load': 1, 'str-prone-row': 1,
    'str-prone-y': 1, 'str-pullover': 1, 'str-side-abduction-load': 1, 'str-triceps-floor': 1,
    'test-knee-to-wall': 1, 'test-mckenzie': 1, 'test-morning-stiffness': 1, 'test-toe-strength': 1,
    'thor-ball-trigger': 1, 'thor-open-book': 1, 'thor-peanut': 1, 'thor-rib-breath': 1,
    'thor-roller-ext': 1
  };

  // В сетке карточек картинок десятки: если задвигаются все разом, экран
  // читается как каша. Поэтому в списках стоп-кадр из still/, а движется
  // только то, на что смотришь — открытое упражнение и плеер тренировки.
  function picHtml(id, cls, moving) {
    var raster = WEBP_IDS[id];
    var src = raster
      ? 'img/' + (moving ? '' : 'still/') + esc(id) + '.webp'
      : 'svg/' + (moving ? '' : 'still/') + esc(id) + '.svg';
    var overlay = raster
      ? '<img class="ov" src="img/overlay/' + esc(id) + '.svg" alt="" loading="lazy">'
      : '';
    return '<img class="' + (cls || '') + '" src="' + src + '" alt="" loading="lazy" ' +
      'onerror="this.style.display=\'none\';this.parentNode.insertAdjacentHTML(\'beforeend\',\'<span class=&quot;ph&quot;>🖼</span>\')">' + overlay;
  }

  /* ══════════════════════ подсказки ══════════════════════ */

  var tipEl = document.getElementById('tip');
  function bindTip(node, text) {
    node.addEventListener('mouseenter', function () {
      tipEl.textContent = text; tipEl.hidden = false;
      var r = node.getBoundingClientRect();
      tipEl.style.left = Math.max(8, Math.min(window.innerWidth - 250, r.left + r.width / 2 - 60)) + 'px';
      tipEl.style.top = (r.top - 38) + 'px';
    });
    node.addEventListener('mouseleave', function () { tipEl.hidden = true; });
  }

  /* ══════════════════════ графики ══════════════════════ */

  function ringHtml(pct, size) {
    size = size || 92;
    var r = (size - 10) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct / 100)));
    return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle class="bg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="8"/>' +
      '<circle class="fg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="8" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" ' +
      'transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }

  function barsNode() {
    var data = last7(), max = Math.max(20, Math.max.apply(null, data.map(function (d) { return d.min; })));
    var wrap = el('<div></div>');
    var bars = el('<div class="bars"></div>');
    data.forEach(function (d) {
      var h = Math.round((d.min / max) * 100);
      var b = el('<div class="b"><span class="n">' + (d.min || '') + '</span>' +
        '<span class="fill' + (d.min ? '' : ' z') + '" style="height:' + (d.min ? Math.max(4, h) : 3) + '%"></span></div>');
      bindTip(b, humanDate(d.day) + ' — ' + d.min + ' ' + plural(d.min, 'минута', 'минуты', 'минут'));
      bars.appendChild(b);
    });
    wrap.appendChild(bars);
    wrap.appendChild(el('<div class="bars-x">' + list(data, function (d) { return '<span>' + d.label + '</span>'; }) + '</div>'));
    return wrap;
  }

  function heatNode(weeks) {
    weeks = weeks || 12;
    var end = new Date(), shift = (end.getDay() + 6) % 7;
    var start = addDays(end, -(weeks * 7 - 1 + (6 - shift)));
    var grid = el('<div class="heat"></div>');
    for (var i = 0; i < weeks * 7; i++) {
      var d = addDays(start, i), key = ymd(d), min = minutesOn(key);
      var future = d > end;
      var cell = el('<i data-l="' + (future ? 0 : heatLevel(min)) + '"></i>');
      if (!future) bindTip(cell, humanDate(key) + ' — ' + (min ? min + ' мин' : 'пропуск'));
      grid.appendChild(cell);
    }
    var wrap = el('<div></div>');
    wrap.appendChild(grid);
    wrap.appendChild(el('<div class="heat-legend"><span>меньше</span>' +
      '<i style="background:var(--h0)"></i><i style="background:var(--h1)"></i><i style="background:var(--h2)"></i>' +
      '<i style="background:var(--h3)"></i><i style="background:var(--h4)"></i><span>больше</span></div>'));
    return wrap;
  }

  /* ══════════════════════ вкладка: дашборд ══════════════════════ */

  function viewDash() {
    var v = document.getElementById('view');
    var st = streak(), rd = rotationDay(todayIdx());
    var todayMin = minutesOn(ymd(new Date()));
    var planMin = dayMinutes(todayIdx());
    var pct = planMin ? Math.round(Math.min(100, todayMin / planMin * 100)) : (todayMin ? 100 : 0);
    var weekMin = last7().reduce(function (a, d) { return a + d.min; }, 0);
    var total = S.sessions.length;
    var grown = bumpedList().length;

    v.innerHTML = '';

    // герой
    var hero = el('<section class="card hero"><div class="row row-hero-r">' +
      '<div>' +
      '<span class="eyebrow">Сегодня · ' + DAYS[todayIdx()] + '</span>' +
      '<h1>' + (planMin ? 'План на день: ' + planMin + ' мин' : 'Свободный день') + '</h1>' +
      '<p class="sec small">' + esc(rd ? rd.title : 'День отдыха') + '. ' +
      (todayMin ? 'Сделано ' + todayMin + ' мин.' : 'Пока ничего не сделано.') + '</p>' +
      '<div class="btn-row"><button class="btn" id="goToday">Открыть тренировку</button>' +
      '<button class="btn ghost" id="goPlan">Весь план</button></div></div>' +
      '<div class="ring-wrap" style="justify-content:flex-end">' + ringHtml(pct, 124) +
      '<div><div class="ring-txt">' + pct + '%</div><div class="tiny muted">дневная норма</div></div></div>' +
      '</div></section>');
    v.appendChild(hero);
    hero.querySelector('#goToday').onclick = function () { go('today'); };
    hero.querySelector('#goPlan').onclick = function () { go('plan'); };

    // статы
    v.appendChild(el('<section class="row row-4">' +
      statCard('🔥', 'Серия', st, plural(st, 'день подряд', 'дня подряд', 'дней подряд'), st >= 3 ? 'Держится' : '') +
      statCard('🏁', 'Занятий всего', total, plural(total, 'сессия', 'сессии', 'сессий'), '') +
      statCard('⏱', 'За 7 дней', weekMin, 'минут', '') +
      statCard('📈', 'Доза выросла', grown, plural(grown, 'упражнение', 'упражнения', 'упражнений'), grown ? 'Прогрессия идёт' : '') +
      '</section>'));

    // компактный прогресс лестниц по зонам; полный роадмап — во вкладке «План»
    var zmZones = ['neck', 'thoracic', 'lumbar', 'knee', 'foot', 'strength'];
    var zmHtml = '';
    zmZones.forEach(function (zk) {
      var zs = zoneLadderStats(zk);
      if (!zs) return;
      zmHtml += '<button class="zmini" type="button" title="' + esc(zoneOf(zk).title + ': ' + zs.pct + '% лестницы доз') + '">' +
        '<span class="zt"><span class="dot" style="background:' + zoneColor(zk) + '"></span>' + esc(zoneOf(zk).title) + '</span>' +
        '<span class="zbar"><i style="width:' + Math.max(2, zs.pct) + '%"></i></span>' +
        '<span class="zp">' + zs.pct + '%</span></button>';
    });
    var zmCard = el('<section class="card tight"><div class="card-h" style="margin-bottom:8px"><h2>Лестницы доз по зонам</h2>' +
      '<span class="hint">жми — роадмап во вкладке «План»</span></div><div class="zmini-row">' + zmHtml + '</div></section>');
    zmCard.querySelector('.zmini-row').onclick = function () { go('plan'); };
    v.appendChild(zmCard);

    v.appendChild(el('<div class="sec-head"><h2>Тело</h2><span>что где болит и почему</span></div>'));

    // карта тела + список зон
    var mapCard = el('<section class="card bodymap-card"><div class="card-h" style="width:100%"><h2>Карта тела</h2>' +
      '<span class="hint">нажми на точку</span></div><div class="bodymap-stage" id="bmHolder"></div>' +
      '<div class="bodymap-legend">11 зон. Цвет дублируется подписью в списке справа.</div></section>');
    var zoneCard = el('<section class="card"><div class="card-h"><h2>Что где болит</h2>' +
      '<span class="hint">' + ZONES.length + ' зон</span></div><div class="zone-list" id="zoneList"></div></section>');
    var pair = el('<div class="row row-hero"></div>');
    pair.appendChild(mapCard); pair.appendChild(zoneCard);
    v.appendChild(pair);
    mountBodymap(mapCard.querySelector('#bmHolder'));
    mountZoneList(zoneCard.querySelector('#zoneList'));

    // графики
    v.appendChild(el('<div class="sec-head"><h2>Как идёт</h2><span>минуты и регулярность</span></div>'));
    var charts = el('<div class="row row-2"></div>');
    var c1 = el('<section class="card"><div class="card-h"><h2>Минуты за неделю</h2><span class="hint">по дням</span></div></section>');
    c1.appendChild(barsNode()); charts.appendChild(c1);
    var c2 = el('<section class="card"><div class="card-h"><h2>Регулярность</h2><span class="hint">12 недель</span></div></section>');
    c2.appendChild(heatNode(12)); charts.appendChild(c2);
    v.appendChild(charts);

    // правила
    v.appendChild(el('<div class="sec-head"><h2>Правила тела</h2><span>читать до, а не после</span></div>'));
    var rules = el('<div class="row row-2"></div>');
    rules.appendChild(factCard('⛔ Красные линии', 'Нельзя никогда — проверено его же телом', FACTS.redLines, '⛔', 'red'));
    rules.appendChild(factCard('✅ Зелёная зона', 'Можно и нужно', FACTS.greenZone, '✓', 'green'));
    v.appendChild(rules);

    if (FACTS.painNature && FACTS.painNature.length) {
      v.appendChild(factCard('🩸 Как устроена его боль', 'Читать до того, как оценивать любой симптом', FACTS.painNature, '·', 'blue'));
    }
    if (FACTS.redFlags && FACTS.redFlags.length) {
      v.appendChild(factCard('🚨 Красные флаги', 'Здесь не ЛФК, а врач — сразу', FACTS.redFlags, '🚨', 'red'));
    }

    // инвентарь — отдельной карточкой, а не в аккордеоне: программа теперь построена вокруг него
    if (FACTS.gear && FACTS.gear.length) {
      v.appendChild(el('<div class="sec-head"><h2>Снаряжение</h2><span>программа собрана под то, что есть</span></div>'));
      v.appendChild(gearCard(FACTS.gear));
    }

    // лечение — препараты и травы
    if (FACTS.meds || FACTS.herbs) {
      v.appendChild(el('<div class="sec-head"><h2>Лечение</h2><span>препараты и травы под профиль</span></div>'));
      var meds = FACTS.meds || {}, herbs = FACTS.herbs || {};
      if (meds.base && meds.base.length) v.appendChild(medsCard('💊 Постоянная база', 'принимается без перерыва', meds.base));
      if (meds.course && meds.course.length) v.appendChild(medsCard('💉 Курсовые сейчас', 'по текущему состоянию', meds.course));
      if (meds.nsaid && meds.nsaid.length) v.appendChild(factCard('🚩 НПВС и обезболивание', '9 лет личного опыта — что реально работает', meds.nsaid, '·', 'blue'));
      if (meds.interactions && meds.interactions.length) v.appendChild(factCard('⚠️ Сочетаемость', 'проверять перед новым препаратом', meds.interactions, '⚠', 'red'));
      if (herbs.bought && herbs.bought.length) v.appendChild(medsCard('🌿 Травы — куплено', 'лечаттравы.рф, 2026-07-30', herbs.bought));
      if (herbs.plan && herbs.plan.length) v.appendChild(factCard('Травы — план приёма', 'под профиль здоровья', herbs.plan, '·', 'green'));
      if (herbs.redFlags && herbs.redFlags.length) v.appendChild(factCard('🚩 Травы — красные флаги', 'читать перед приёмом', herbs.redFlags, '⛔', 'red'));
    }

    // источники — какие ролики стоят за упражнениями
    if (FACTS.sources && FACTS.sources.length) {
      v.appendChild(el('<div class="sec-head"><h2>Источники</h2><span>из каких роликов собраны упражнения</span></div>'));
      v.appendChild(sourcesCard(FACTS.sources));
    }

    // справочники в аккордеонах
    var more = el('<section class="card"></section>');
    if (FACTS.sides && FACTS.sides.length) {
      more.appendChild(el('<details class="acc"><summary>↔️ Какая сторона — шпаргалка</summary><div class="acc-body">' +
        '<dl class="kv">' + list(FACTS.sides, function (s) {
          return '<dt>' + esc(s.zone) + '</dt><dd><b>' + esc(s.side) + '</b>' + (s.quote ? '<br><span class="tiny muted">' + esc(s.quote) + '</span>' : '') + '</dd>';
        }) + '</dl></div></details>'));
    }
    if (FACTS.workplace && FACTS.workplace.length) {
      more.appendChild(el('<details class="acc"><summary>🪑 Рабочее место</summary><div class="acc-body"><div class="rules">' +
        list(FACTS.workplace, function (p) {
          return '<div class="rule"><span class="m">' + esc(p.n) + '</span><div><b>' + esc(p.title) + '</b><p>' + esc(p.text) + '</p></div></div>';
        }) + '</div></div></details>'));
    }
    if (FACTS.todo && FACTS.todo.length) {
      more.appendChild(el('<details class="acc"><summary>📋 Хвосты — дозаполнить и решить</summary><div class="acc-body">' +
        '<ul class="checklist">' + list(FACTS.todo, function (t) {
          return '<li><span class="m">☐</span><div><b>' + esc(t.text) + '</b>' + (t.why ? '<br><span class="tiny muted">' + esc(t.why) + '</span>' : '') + '</div></li>';
        }) + '</ul></div></details>'));
    }
    if (more.children.length) {
      v.appendChild(el('<div class="sec-head"><h2>Справочники</h2><span>шпаргалки и хвосты</span></div>'));
      v.appendChild(more);
    }
  }

  function statCard(icon, k, val, unit, delta) {
    return '<div class="card tight stat"><span class="k"><span class="e">' + esc(icon) + '</span>' + esc(k) + '</span>' +
      '<span class="v">' + esc(val) + ' <small>' + esc(unit) + '</small></span>' +
      (delta ? '<span class="d up">' + esc(delta) + '</span>' : '') + '</div>';
  }

  // «Есть / надо купить» определяем по вердикту: у купленного он начинается с «есть».
  function gearHave(v) { return /^\s*есть/i.test(String(v || '')); }

  function gearCard(items) {
    var have = items.filter(function (g) { return gearHave(g.verdict); });
    var want = items.filter(function (g) { return !gearHave(g.verdict); });
    function row(g, on) {
      return '<div class="gear' + (on ? ' has' : '') + '">' +
        '<span class="gear-m">' + (on ? '✓' : '○') + '</span>' +
        '<div><b>' + esc(g.item) + '</b>' +
        '<span class="gear-v">' + esc(g.verdict) + '</span>' +
        '<p>' + esc(g.detail) + '</p></div></div>';
    }
    return el('<section class="card"><div class="card-h"><h2>🎽 Инвентарь</h2>' +
      '<span class="hint">' + have.length + ' есть · ' + want.length + ' докупить</span></div>' +
      '<div class="gear-grid">' + list(have, function (g) { return row(g, true); }) + '</div>' +
      (want.length ? '<div class="sec-t">Ещё нет — по порядку полезности</div>' +
        '<div class="gear-grid">' + list(want, function (g) { return row(g, false); }) + '</div>' : '') +
      '</section>');
  }

  // препараты/травы: та же карточка-сетка, что у инвентаря, но без деления «есть / докупить» —
  // тут всё уже в деле, поэтому каждая строка помечена как «has» (зелёная кромка).
  function medsCard(title, hint, items) {
    function row(g) {
      return '<div class="gear has"><span class="gear-m">✓</span>' +
        '<div><b>' + esc(g.item) + '</b>' +
        '<span class="gear-v">' + esc(g.verdict) + '</span>' +
        '<p>' + esc(g.detail) + '</p></div></div>';
    }
    return el('<section class="card"><div class="card-h"><h2>' + esc(title) + '</h2>' +
      '<span class="hint">' + esc(hint) + '</span></div>' +
      '<div class="gear-grid">' + list(items, row) + '</div></section>');
  }

  // Ролик → упражнения, которые из него взяты. Связь считается по e.video.url,
  // отдельного списка «что из чего» нет: он бы разъезжался при первой же правке.
  function videoId(u) {
    var m = String(u || '').match(/(?:youtu\.be\/|[?&]v=)([\w-]{6,})/);
    return m ? m[1] : String(u || '');
  }
  function exOfSource(url) {
    var k = videoId(url);
    return EX.filter(function (e) { return e.video && videoId(e.video.url) === k; });
  }

  /* Видео открывается на YouTube, а не встраивается. Эмбед тут стоял до 2026-08-03
     и на проде не играл: ролики встраивать разрешают, CSP нет, но сам поток режется
     у провайдера — починить на своей стороне нечем. Поэтому техника расписана шагами
     в карточке, а ссылка ведёт на нужную секунду ролика.
     start — секунда начала: у автора один ролик на десяток упражнений, и без таймкода
     его пришлось бы отматывать вручную каждый раз. */
  function videoHref(video) {
    var u = String(video.url || ''), st = video.start | 0;
    if (!st) return u;
    return u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + st;
  }
  function videoLinkHtml(video) {
    if (!video || !video.url) return '';
    var st = video.start | 0;
    return '<a class="yt-link" href="' + esc(videoHref(video)) + '" target="_blank" rel="noopener">' +
      '<span class="yt-play" aria-hidden="true">▶</span>' +
      '<span class="yt-txt"><b>Смотреть у автора</b>' +
      (video.label ? '<span class="yt-label">' + esc(video.label) + '</span>' : '') + '</span>' +
      (st ? '<span class="yt-at">с ' + fmt(st) + '</span>' : '') +
      '</a>';
  }
  function sourcesCard(items) {
    var main = items.filter(function (s) { return s.playlist; });
    var extra = items.filter(function (s) { return !s.playlist; });
    var noVideo = EX.filter(function (e) { return !e.video || !e.video.url; });

    function row(s) {
      var rel = exOfSource(s.url);
      return '<div class="gear' + (rel.length ? ' has' : '') + '">' +
        '<span class="gear-m">' + (rel.length ? '▶' : '○') + '</span>' +
        '<div><b><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></b>' +
        '<span class="gear-v">' + esc(s.author) + (s.len ? ' · ' + esc(s.len) : '') + '</span>' +
        '<p>' + (rel.length
          ? esc(rel.length + ' ' + plural(rel.length, 'упражнение', 'упражнения', 'упражнений') + ': ' + rel.map(function (e) { return e.title; }).join(', '))
          : esc(s.note || 'Ликбез, а не комплекс — упражнений отсюда не взято.')) + '</p></div></div>';
    }

    var card = el('<section class="card"><div class="card-h"><h2>📺 Плейлист «ЛФК»</h2>' +
      '<span class="hint">' + main.length + ' ' + plural(main.length, 'ролик', 'ролика', 'роликов') + '</span></div>' +
      '<p class="sec small">Каждое упражнение показывает свой ролик прямо в карточке и в плеере — смотреть можно не уходя со страницы. ' +
      'Каждый раз пересматривать не надо: техника расписана шагами.</p>' +
      '<div class="gear-grid">' + list(main, row) + '</div>' +
      (extra.length ? '<details class="acc"><summary>Ещё ' + extra.length + ' ' + plural(extra.length, 'ролик', 'ролика', 'роликов') +
        ' — ликбез и запасные комплексы</summary><div class="acc-body"><div class="gear-grid">' + list(extra, row) + '</div></div></details>' : '') +
      (noVideo.length ? '<details class="acc"><summary>' + noVideo.length + ' ' + plural(noVideo.length, 'упражнение', 'упражнения', 'упражнений') +
        ' без ролика — почему</summary><div class="acc-body"><p class="sec small">Это замеры секундомером или сборки строго под его инвентарь и МРТ — ' +
        'готового ролика-первоисточника у них нет, и видео там нечего показывать. Техника расписана шагами подробнее любого видео.</p>' +
        '<p class="tiny muted">' + esc(noVideo.map(function (e) { return e.title; }).join(' · ')) + '</p></div></details>' : '') +
      '</section>');
    return card;
  }

  function factCard(title, hint, items, mark, tone) {
    return el('<section class="card' + (tone ? ' tone tone-' + tone : '') + '"><div class="card-h"><h2>' + esc(title) + '</h2><span class="hint">' + esc(hint) + '</span></div>' +
      '<div class="rules">' + list(items, function (r) {
        return '<div class="rule"><span class="m">' + esc(mark) + '</span><div><b>' + esc(r.title) + '</b><p>' + esc(r.text) + '</p></div></div>';
      }) + '</div></section>');
  }

  function mountBodymap(holder) {
    if (window.LFK_BODYMAP) {
      holder.innerHTML = window.LFK_BODYMAP;
      var svg = holder.querySelector('svg');
      if (svg) { svg.classList.add('bodymap'); svg.removeAttribute('width'); svg.removeAttribute('height'); }
      var zs = holder.querySelectorAll('.zone');
      for (var i = 0; i < zs.length; i++) {
        (function (g) {
          var key = g.getAttribute('data-zone');
          var z = zoneByKey(key);
          if (z) { bindTip(g, z.title + ' — ' + (z.short || '')); g.style.cursor = 'pointer'; g.addEventListener('click', function () { openZone(key); }); }
        })(zs[i]);
      }
    } else {
      holder.innerHTML = '<img class="bodymap" src="svg/bodymap.svg" alt="Карта проблемных зон" ' +
        'onerror="this.replaceWith(document.createTextNode(\'\'))">';
    }
  }

  function zoneByKey(k) {
    for (var i = 0; i < ZONES.length; i++) {
      if (ZONES[i].key === k) return ZONES[i];
      if (k && ZONES[i].key && k.indexOf(ZONES[i].key) === 0) return ZONES[i];
    }
    return null;
  }

  function mountZoneList(holder) {
    if (!ZONES.length) { holder.innerHTML = '<div class="empty small">Данные зон не загружены</div>'; return; }
    ZONES.forEach(function (z) {
      var s = STATUS[z.status] || STATUS.green;
      var row = el('<button class="zone-row" type="button">' +
        '<span class="ico">' + esc(z.icon || '•') + '</span>' +
        '<span class="t"><b>' + esc(z.title) + '</b><span>' + esc(z.short || '') + '</span></span>' +
        '<span class="badge ' + s.badge + '"><span class="dot" style="background:' + esc(z.color || 'currentColor') + '"></span>' + s.label + '</span>' +
        '</button>');
      row.onclick = function () { openZone(z.key); };
      holder.appendChild(row);
    });
  }

  function openZone(key) {
    var z = zoneByKey(key);
    if (!z) return;
    var s = STATUS[z.status] || STATUS.green;
    var rel = EX.filter(function (e) { return e.zone === z.key || (z.key === 'knee' && e.zone === 'knee'); });
    openSheet(
      '<span class="eyebrow">' + s.mark + ' ' + s.label + (z.side && z.side !== '—' ? ' · ' + esc(z.side) : '') + '</span>' +
      '<h2 id="sheetTitle" style="font-size:24px;margin:6px 0 10px">' + esc(z.icon || '') + ' ' + esc(z.title) + '</h2>' +
      '<p class="sec">' + esc(z.human || z.short || '') + '</p>' +
      (z.mri ? '<div class="sec-t">Что на снимке</div><div class="callout">' + esc(z.mri) + '</div>' : '') +
      (z.doing && z.doing.length ? '<div class="sec-t">Что делаем</div><ul class="bul">' +
        list(z.doing, function (t) { return '<li><span class="m">✓</span><span>' + esc(t) + '</span></li>'; }) + '</ul>' : '') +
      (z.never && z.never.length ? '<div class="sec-t">Чего нельзя</div><ul class="bul">' +
        list(z.never, function (t) { return '<li><span class="m">⛔</span><span>' + esc(t) + '</span></li>'; }) + '</ul>' : '') +
      (rel.length ? '<div class="sec-t">Упражнения на эту зону</div><div class="ex-grid">' +
        list(rel, function (e) { return exCardHtml(e); }) + '</div>' : '') +
      (z.file ? '<p class="tiny muted" style="margin-top:18px">Источник: <code>' + esc(z.file) + '</code></p>' : ''),
      function (root) { wireExCards(root); },
      function () { openZone(key); }
    );
  }

  /* ══════════════════════ вкладка: сегодня ══════════════════════ */

  function viewToday() {
    var v = document.getElementById('view');
    var rd = rotationDay(todayIdx()), rs = todayRoutines();
    var planMin = dayMinutes(todayIdx());
    v.innerHTML = '';

    var allEx = [];
    rs.forEach(function (r) {
      resolveRoutine(r).exercises.forEach(function (e) { if (allEx.indexOf(e) < 0) allEx.push(e); });
    });
    v.appendChild(el('<section class="card hero"><span class="eyebrow">' + DAYS[todayIdx()] +
      (planMin ? ' · ' + planMin + ' мин по плану' : '') + '</span>' +
      '<h1 style="font-size:26px;margin:6px 0 6px">' + esc(rd ? rd.title : 'Свободный день') + '</h1>' +
      '<p class="sec small">Сначала блок в кровати — до первого шага по полу. Утро за чаем — сидя, с кружкой. Основной блок — после чая. ' +
      'Микропаузы за компом в этот час не входят: они фон рабочего дня, а не тренировка.</p>' +
      (allEx.length ? '<div class="ex-strip">' + list(allEx.slice(0, 14), function (e) {
        return '<span class="th" title="' + esc(e.title) + '">' + picHtml(e.id) + '</span>';
      }) + (allEx.length > 14 ? '<span class="th more">+' + (allEx.length - 14) + '</span>' : '') + '</div>' : '') +
      '</section>'));

    // полоска недели
    var strip = el('<section class="card tight"><div class="week-strip"></div></section>');
    var holder = strip.querySelector('.week-strip');
    (PROGRAM.rotation || []).forEach(function (d, i) {
      var day = addDays(new Date(), i - todayIdx());
      var min = minutesOn(ymd(day));
      holder.appendChild(el('<div class="week-day' + (i === todayIdx() ? ' is-today' : '') + '">' +
        '<div class="d">' + DAYS[i] + '</div><div class="n">' + day.getDate() + '</div>' +
        '<div class="m">' + (min ? '<span style="color:var(--good-text)">●</span>' : (d.routines && d.routines.length ? '<span class="muted">○</span>' : '<span class="muted">—</span>')) + '</div>' +
        '</div>'));
    });
    v.appendChild(strip);

    // «в кровати» стоит выше плана дня и вне его часа: это расхаживание сустава до первого шага
    // по полу, а не тренировка. Показывается каждый день, включая дни отдыха и обострения.
    var bed = routineObj('bed');
    if (bed) {
      var bdone = doneToday(bed.id);
      var bnode = el('<div class="routine' + (bdone ? ' is-done' : '') + '">' +
        '<div class="t"><b>' + (bdone ? '✅ ' : '🛏 ') + esc(bed.title) + '</b>' +
        '<span>' + esc(bed.when || '') + ' · ' + routineMinutes(bed) + ' мин · в дневной час не входит</span>' +
        '<span class="prev">' + esc(bed.why || '') + '</span></div>' +
        '<button class="btn' + (bdone ? ' ghost' : '') + '">' + (bdone ? 'Ещё раз' : 'Начать') + '</button></div>');
      bnode.querySelector('button').onclick = function () { startPlayer(bed); };
      v.appendChild(bnode);
    }

    if (!rs.length) {
      v.appendChild(el('<section class="card"><div class="empty"><span class="e">🌿</span>' +
        'На сегодня по плану ничего нет. День отдыха — это тоже часть программы.<br>' +
        '<span class="tiny">Можно всё равно открыть любой блок из вкладки «Упражнения».</span></div></section>'));
    } else {
      rs.forEach(function (r) {
        var res = resolveRoutine(r), ex = res.exercises, done = doneToday(r.id);
        var rotHtml = list(res.slots, function (s) {
          function names(ids) { return ids.map(function (id) { var e = byId(id); return e ? e.title : id; }).join(', '); }
          return '<span class="rot-line">🔁 ' + esc(s.label) + ': <b>' + esc(names(s.now)) + '</b>' +
            ' <span class="muted">· в следующий раз: ' + esc(names(s.next)) + ' · весь пул за ' + s.cycle + ' нед</span></span>';
        });
        var node = el('<div class="routine' + (done ? ' is-done' : '') + '">' +
          '<div class="t"><b>' + (done ? '✅ ' : '') + esc(r.title) + '</b>' +
          '<span>' + esc(r.when || '') + ' · ' + routineMinutes(r) + ' мин · ' + ex.length + ' ' + plural(ex.length, 'упражнение', 'упражнения', 'упражнений') + '</span>' +
          '<span class="r-thumbs">' + list(ex.slice(0, 6), function (x) {
            return '<span class="th">' + picHtml(x.id) + '</span>';
          }) + (ex.length > 6 ? '<span class="th more">+' + (ex.length - 6) + '</span>' : '') + '</span>' +
          (r.why ? '<span class="prev">' + esc(r.why) + '</span>' : '') + rotHtml + '</div>' +
          '<button class="btn' + (done ? ' ghost' : '') + '">' + (done ? 'Ещё раз' : 'Начать') + '</button></div>');
        node.querySelector('button').onclick = function () { startPlayer(r); };
        v.appendChild(node);
      });
    }

    // микропаузы висят отдельно и в дневной час не считаются: они привязаны к работе за компом,
    // а не к тренировке, и «начать» их можно по десять раз за день.
    var micro = routineObj('day');
    if (micro) {
      var mnode = el('<div class="routine">' +
        '<div class="t"><b>⏱ ' + esc(micro.title) + '</b>' +
        '<span>' + esc(micro.when || '') + ' · ' + routineMinutes(micro) + ' мин · в дневной час не входит</span>' +
        '<span class="prev">' + esc(micro.why || '') + '</span></div>' +
        '<button class="btn ghost">Начать</button></div>');
      mnode.querySelector('button').onclick = function () { startPlayer(micro); };
      v.appendChild(mnode);
    }

    if (PROGRAM.painRule) {
      v.appendChild(el('<section class="callout why"><b>Правило боли</b>' + esc(PROGRAM.painRule) + '</section>'));
    }
    if (PROGRAM.flareRule) {
      v.appendChild(el('<section class="callout stop"><b>Если крутит — день обострения</b>' + esc(PROGRAM.flareRule) + '</section>'));
    }

    var other = (PROGRAM.routines || []).filter(function (r) {
      if (r.id === 'day' || r.id === 'bed') return false;
      for (var i = 0; i < rs.length; i++) if (rs[i].id === r.id) return false;
      return true;
    });
    if (other.length) {
      var oc = el('<section class="card"><div class="card-h"><h2>Не по плану, но под рукой</h2></div></section>');
      other.forEach(function (r) {
        var b = el('<details class="acc"><summary>' + esc(r.title) + ' <span class="tiny muted">' + routineMinutes(r) + ' мин</span></summary>' +
          '<div class="acc-body"><p class="sec small">' + esc(r.why || '') + '</p>' +
          '<div class="btn-row"><button class="btn ghost">Запустить</button></div></div></details>');
        b.querySelector('button').onclick = function () { startPlayer(r); };
        oc.appendChild(b);
      });
      v.appendChild(oc);
    }
  }

  /* ══════════════════════ вкладка: каталог ══════════════════════ */

  var catFilter = 'all', catQuery = '';

  function viewCat() {
    var v = document.getElementById('view');
    v.innerHTML = '';

    var bar = el('<section class="card tight"><div class="filters"></div></section>');
    var f = bar.querySelector('.filters');
    var zones = ['all'].concat(ZONE_ORDER.filter(function (z) { return EX.some(function (e) { return e.zone === z; }); }));
    zones.forEach(function (z) {
      var lbl = z === 'all' ? 'Все' : zoneOf(z).title;
      var cnt = z === 'all' ? EX.length : EX.filter(function (e) { return e.zone === z; }).length;
      var c = el('<button class="chip' + (catFilter === z ? ' is-on' : '') + '" type="button">' +
        (z === 'all' ? '' : '<span class="dot" style="background:' + zoneColor(z) + '"></span>') +
        esc(lbl) + ' <span class="tiny muted">' + cnt + '</span></button>');
      c.onclick = function () { catFilter = z; viewCat(); };
      f.appendChild(c);
    });
    var input = el('<input class="search" type="search" placeholder="Поиск по названию" value="' + esc(catQuery) + '">');
    input.oninput = function () { catQuery = input.value; renderGrid(); };
    f.appendChild(input);
    v.appendChild(bar);

    var slot = el('<div id="exSlot"></div>');
    v.appendChild(slot);
    renderGrid();

    function renderGrid() {
      var q = catQuery.trim().toLowerCase();
      var items = EX.filter(function (e) {
        if (catFilter !== 'all' && e.zone !== catFilter) return false;
        if (!q) return true;
        return (e.title + ' ' + (e.subtitle || '') + ' ' + (e.goal || '')).toLowerCase().indexOf(q) >= 0;
      });
      if (!items.length) {
        slot.innerHTML = '<div class="card"><div class="empty"><span class="e">🔍</span>Ничего не нашлось</div></div>';
        return;
      }
      slot.innerHTML = '<div class="ex-grid">' + list(items, exCardHtml) + '</div>';
      wireExCards(slot);
    }
  }

  function exCardHtml(e) {
    var st = S.ex[e.id] || {};
    var z = zoneOf(e.zone);
    return '<button class="ex-card" type="button" data-ex="' + esc(e.id) + '">' +
      '<span class="pic">' + picHtml(e.id) +
      (st.count ? '<span class="cnt">' + st.count + '×</span>' : '') +
      (st.last === ymd(new Date()) ? '<span class="done">✓</span>' : '') + '</span>' +
      '<span class="meta">' +
      '<span class="zn"><span class="dot" style="background:' + zoneColor(e.zone) + '"></span>' + esc(z.title) + '</span>' +
      '<b>' + esc(e.title) + '</b>' +
      '<span class="ds">' + (doseChanged(e) ? '↑ ' : '') + esc(doseTextOf(e)) + '</span>' +
      '</span></button>';
  }

  function wireExCards(root) {
    var cards = root.querySelectorAll('[data-ex]');
    for (var i = 0; i < cards.length; i++) {
      (function (c) { c.onclick = function () { openEx(c.getAttribute('data-ex')); }; })(cards[i]);
    }
  }

  function openEx(id) {
    var e = byId(id);
    if (!e) return;
    var st = S.ex[id] || { count: 0 };
    var z = zoneOf(e.zone);
    var d = doseOf(e), b = baseDose(e), up = doseChanged(e);
    var doseItems = '';
    if (d.sets) doseItems += doseItem('Подходов', d.sets);
    if (d.reps) doseItems += doseItem('Повторов', d.reps);
    if (d.hold) doseItems += doseItem('Держать', d.hold + ' сек');
    if (d.rest) doseItems += doseItem('Отдых', d.rest + ' сек');
    if (!doseItems) doseItems = doseItem('Дозировка', e.doseText || '—');

    var html =
      '<div class="ex-hero">' + picHtml(id, '', true) + '</div>' +
      '<span class="eyebrow"><span class="dot" style="background:' + zoneColor(e.zone) + ';margin-right:5px"></span>' + esc(z.title) +
      ' · ' + esc(e.level === 'base' ? 'база' : e.level === 'progress' ? 'прогрессия' : e.level || '') +
      (e.place ? ' · ' + esc(e.place) : '') + '</span>' +
      '<h2 id="sheetTitle" style="font-size:24px;margin:6px 0 4px">' + esc(e.title) + '</h2>' +
      '<p class="sec small">' + esc(e.subtitle || '') + '</p>' +
      '<div class="callout why" style="margin-top:14px"><b>Зачем</b>' + esc(e.goal || '') + '</div>' +
      '<div class="dose-row">' + doseItems + '</div>' +
      '<p class="tiny muted">' + esc(e.doseText || '') + (up ? ' · старт был ' + esc(shortDose(b, e)) : '') + '</p>' +
      (up ? '<div class="callout why"><b>Доза поднята</b>Сейчас ' + esc(shortDose(d, e)) +
        '. Подняли ' + esc(humanDate(st.bumpedAt || ymd(new Date()))) + ', потому что три занятия подряд прошли с болью не выше 3. ' +
        'Если стало тяжело — верни на ступень вниз, это не откат программы.</div>' : '') +
      ladderHtml(e) +
      (e.steps && e.steps.length ? '<div class="sec-t">Как делать</div><ol class="steps">' +
        list(e.steps, function (s) { return '<li><span>' + esc(s) + '</span></li>'; }) + '</ol>' : '') +
      (e.video && e.video.url ? '<div class="sec-t">Видео — как это объясняют в оригинале</div>' + videoLinkHtml(e.video) : '') +
      (e.cues && e.cues.length ? '<div class="sec-t">На что смотреть</div><ul class="bul">' +
        list(e.cues, function (s) { return '<li><span class="m">→</span><span>' + esc(s) + '</span></li>'; }) + '</ul>' : '') +
      (e.mistakes && e.mistakes.length ? '<div class="sec-t">Частые ошибки</div><ul class="bul">' +
        list(e.mistakes, function (s) { return '<li><span class="m">✗</span><span>' + esc(s) + '</span></li>'; }) + '</ul>' : '') +
      (e.stop && e.stop.length ? '<div class="sec-t">Стоп-сигналы</div><div class="callout stop"><ul class="bul">' +
        list(e.stop, function (s) { return '<li><span class="m">⚠</span><span>' + esc(s) + '</span></li>'; }) + '</ul></div>' : '') +
      (e.why ? '<div class="sec-t">Почему именно так — под его МРТ</div><p class="sec small">' + esc(e.why) + '</p>' : '') +
      ((e.progression || e.regression) ? '<div class="sec-t">Прогрессия</div><dl class="kv">' +
        (e.progression ? '<dt>Усложнить</dt><dd>' + esc(e.progression) + '</dd>' : '') +
        (e.regression ? '<dt>Упростить</dt><dd>' + esc(e.regression) + '</dd>' : '') + '</dl>' : '') +
      (e.measure ? measureBlock(e) : '') +
      '<div class="btn-row"><button class="btn" id="exDone">Отметить выполнено</button>' +
      (prevDose(e) ? '<button class="btn ghost" id="exDown">Понизить дозу</button>' : '') +
      (up ? '<button class="btn ghost" id="exReset">Вернуть стартовую</button>' : '') +
      '<span class="tiny muted" style="align-self:center">' + (st.count ? 'сделано ' + st.count + ' ' + plural(st.count, 'раз', 'раза', 'раз') +
        (st.last ? ', последний ' + humanDate(st.last) : '') : 'ещё ни разу') + '</span></div>';

    openSheet(html, function (root) {
      var down = root.querySelector('#exDown');
      if (down) down.onclick = function () {
        var p = prevDose(e);
        if (p) { applyDose(id, p, 'понижено вручную'); closeSheet(); rerender(); toast('Доза снижена до ' + shortDose(p, e)); }
      };
      var rst = root.querySelector('#exReset');
      if (rst) rst.onclick = function () {
        S.ex[id].dose = null; S.ex[id].bumpedAt = null; save();
        closeSheet(); rerender(); toast('Вернули стартовую дозу');
      };
      root.querySelector('#exDone').onclick = function () {
        markDone(id);
        logSession({ routine: 'single', title: e.title, items: [{ id: id, status: 'done' }], minutes: e.minutes || 2, pain: null, note: '' });
        closeSheet(); rerender(); toast('Записано: ' + e.title);
      };
      var mf = root.querySelector('#measureForm');
      if (mf) mf.onsubmit = function (ev) {
        ev.preventDefault();
        var rec = { date: ymd(new Date()) };
        var l = root.querySelector('#mL'), r = root.querySelector('#mR'), n = root.querySelector('#mN');
        if (l) rec.left = l.value; if (r) rec.right = r.value; if (n) rec.note = n.value;
        if (!S.tests[id]) S.tests[id] = [];
        S.tests[id].push(rec); save(); closeSheet(true); rerender();
        toast('Замер записан — история во вкладке «Журнал»');
      };
    }, function () { openEx(id); });
  }

  function doseItem(k, v) { return '<div class="dose-item"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }

  // Лестница доз: пройденные ступени, текущая, будущие и ручной режим в конце.
  function ladderHtml(e) {
    var L = doseLadder(e);
    if (!L) return '';
    var stx = bumpStatus(e);
    return '<div class="sec-t">Лестница прогрессии — куда это растёт</div>' +
      '<div class="ladder">' + list(L.steps, function (d, i) {
        return '<span class="lstep' + (i < L.at ? ' done' : i === L.at ? ' cur' : '') + '">' +
          (i < L.at ? '✓ ' : '') + esc(shortDose(d, e)) + '</span>';
      }) + '<span class="lstep manual">ручной режим</span></div>' +
      (stx ? '<p class="tiny muted" style="margin-top:6px">' + esc(stx) + '</p>' : '');
  }

  function measureBlock(e) {
    var m = e.measure;
    return '<div class="sec-t">Записать замер</div><form id="measureForm">' +
      '<div class="dose-row">' +
      (m.sides
        ? '<div class="dose-item"><div class="k">Слева, ' + esc(m.unit) + '</div><input id="mL" class="search" style="width:100%;margin-top:4px" inputmode="decimal"></div>' +
          '<div class="dose-item"><div class="k">Справа, ' + esc(m.unit) + '</div><input id="mR" class="search" style="width:100%;margin-top:4px" inputmode="decimal"></div>'
        : '<div class="dose-item"><div class="k">' + esc(m.label || 'Значение') + ', ' + esc(m.unit) + '</div><input id="mL" class="search" style="width:100%;margin-top:4px" inputmode="decimal"></div>') +
      '</div><input id="mN" class="search" style="width:100%;margin-top:8px" placeholder="Заметка (необязательно)">' +
      '<div class="btn-row"><button class="btn ghost" type="submit">Сохранить замер</button></div></form>';
  }

  /* ══════════════════════ вкладка: план ══════════════════════ */

  function viewPlan() {
    var v = document.getElementById('view');
    var rot = PROGRAM.rotation || [];
    var avg = rot.length ? Math.round(rot.reduce(function (a, d, i) { return a + dayMinutes(i); }, 0) / rot.length) : 0;
    var wk = weeksDone();
    v.innerHTML = '';

    v.appendChild(el('<section class="card"><div class="card-h"><h2>Неделя</h2>' +
      '<span class="hint">' + (S.startedAt ? 'старт ' + esc(humanDate(S.startedAt)) + ' · ' + wk + ' ' + plural(wk, 'неделя', 'недели', 'недель') + ' позади' : 'ещё не начато') + '</span></div>' +
      '<p class="sec small">В среднем ' + avg + ' минут в день: утро за чаем плюс блок после. ' +
      'Темы дней не меняются, а состав внутри дня чередуется по неделям (🔁), и дозы растут по мере чистых занятий.</p>' +
      (PROGRAM.rotationWhy ? '<p class="sec small">' + esc(PROGRAM.rotationWhy) + '</p>' : '') + '</section>'));

    var days = el('<section class="card"></section>');
    rot.forEach(function (day, i) {
      var isNow = i === todayIdx();
      var d = el('<details class="plan-week' + (isNow ? ' is-now' : '') + '"' + (isNow ? ' open' : '') + '>' +
        '<summary><span class="wn">' + esc(DAYS[i]) + '</span><span class="wt"><b>' + esc(day.title || DAYS[i]) + '</b>' +
        '<span>' + dayMinutes(i) + ' мин · ' + list(day.routines || [], function (rid) {
          var r = routineObj(rid);
          return '<span class="badge">' + esc(r ? r.title : rid) + '</span>';
        }) + '</span></span></summary>' +
        '<div class="wb">' + list(day.routines || [], function (rid) {
          var r = routineObj(rid);
          if (!r) return '';
          var dt = dateOfWeekday(i), res = resolveRoutine(r, dt);
          var picked = {};
          res.slots.forEach(function (s) { s.now.forEach(function (id) { picked[id] = 1; }); });
          return '<div class="plan-day"><span class="dn">' + routineMinutes(r, dt) + 'м</span><span class="dr">' +
            '<b>' + esc(r.title) + '</b> — ' + list(res.exercises, function (e) {
              return '<span class="badge' + (picked[e.id] ? ' rot' : '') + '">' + (picked[e.id] ? '🔁 ' : '') + esc(e.title) + '</span>';
            }) +
            list(res.slots, function (s) {
              var rest = s.pool.filter(function (id) { return s.now.indexOf(id) < 0; });
              if (!rest.length) return '';
              return '<span class="tiny muted rot-pool">' + esc(s.label) + ' — на этой неделе ' + s.now.length + ' из ' + s.pool.length +
                ', остальные ждут очереди: ' + esc(rest.map(function (id) { var e = byId(id); return e ? e.title : id; }).join(', ')) +
                ' · весь пул за ' + s.cycle + ' ' + plural(s.cycle, 'неделю', 'недели', 'недель') + '</span>';
            }) + '</span></div>';
        }) + '</div></details>');
      days.appendChild(d);
    });
    v.appendChild(days);

    v.appendChild(zoneProgressCard());
    v.appendChild(weeklyCard());

    // что уже выросло — единственное честное доказательство, что программа работает
    var grown = bumpedList();
    v.appendChild(el('<section class="card"><div class="card-h"><h2>📈 Прогрессия</h2>' +
      '<span class="hint">' + (grown.length ? grown.length + ' ' + plural(grown.length, 'упражнение', 'упражнения', 'упражнений') + ' выросло' : 'пока по стартовым дозам') + '</span></div>' +
      (PROGRAM.progressionRule ? '<p class="sec small">' + esc(PROGRAM.progressionRule) + '</p>' : '') +
      (grown.length ? '<dl class="kv">' + list(grown, function (e) {
        return '<dt>' + esc(e.title) + '</dt><dd>' + esc(shortDose(baseDose(e), e)) + ' → <b>' + esc(shortDose(doseOf(e), e)) + '</b>' +
          (S.ex[e.id].bumpedAt ? ' <span class="tiny muted">' + esc(humanDate(S.ex[e.id].bumpedAt)) + '</span>' : '') + '</dd>';
      }) + '</dl>' : '') + '</section>'));

    if (PROGRAM.after) {
      v.appendChild(el('<section class="card"><div class="card-h"><h2>Куда это ведёт</h2></div>' +
        '<p class="sec small">' + esc(PROGRAM.after) + '</p></section>'));
    }
  }

  // Роадмап зон: докуда дошла лестница доз и когда потолок при чистых занятиях.
  // Это и есть «заранее прописанная» прогрессия — движок под ней остаётся
  // реактивным: тело имеет право замедлить план болью.
  function zoneProgressCard() {
    var zones = ['neck', 'thoracic', 'lumbar', 'knee', 'hip', 'foot', 'strength'];
    var rows = '';
    zones.forEach(function (zk) {
      var s = zoneLadderStats(zk);
      if (!s) return;
      rows += '<div class="zprog">' +
        '<span class="zn"><span class="dot" style="background:' + zoneColor(zk) + '"></span>' + esc(zoneOf(zk).title) +
        ' <span class="tiny muted">' + s.n + ' упр</span></span>' +
        '<span class="zbar"><i style="width:' + Math.max(2, s.pct) + '%"></i></span>' +
        '<span class="pv">' + s.pct + '%' +
        (s.atCeil ? ' · ' + s.atCeil + ' на потолке' : '') +
        (s.remWeeks ? ' · потолок ~' + s.remWeeks + ' ' + plural(s.remWeeks, 'неделя', 'недели', 'недель') : '') +
        '</span></div>';
    });
    return el('<section class="card"><div class="card-h"><h2>🗺 Роадмап по зонам</h2>' +
      '<span class="hint">прогноз при боли ≤ 3</span></div>' +
      '<p class="sec small">Столбик — сколько зона уже прошла от стартовых доз до потолка (вдвое от старта плюс подход). ' +
      'Прогноз считается из твоего расписания: сколько раз упражнение стоит в неделе и по три чистых занятия на ступень.</p>' +
      '<div class="zprog-list">' + rows + '</div></section>');
  }

  // Динамика по неделям: минуты занятий + сколько ступеней взято.
  function weeklyCard() {
    var card = el('<section class="card"><div class="card-h"><h2>📊 Дистанция недель</h2>' +
      '<span class="hint">12 недель: минуты и взятые ступени</span></div></section>');
    var monday = addDays(new Date(), -todayIdx());
    var data = [];
    for (var i = 11; i >= 0; i--) {
      var st = addDays(monday, -7 * i), en = addDays(st, 6);
      var a = ymd(st), b = ymd(en), min = 0, bumps = 0;
      for (var s = 0; s < S.sessions.length; s++) {
        var d = S.sessions[s].date;
        if (d >= a && d <= b) min += S.sessions[s].minutes || 0;
      }
      for (var id in S.ex) (S.ex[id].history || []).forEach(function (h) {
        if (h.date >= a && h.date <= b && h.why !== 'откат по боли' && h.why !== 'понижено вручную') bumps++;
      });
      data.push({ label: humanDate(a), min: min, bumps: bumps });
    }
    var max = Math.max(120, Math.max.apply(null, data.map(function (d) { return d.min; })));
    var bars = el('<div class="bars" style="height:88px"></div>');
    data.forEach(function (d) {
      var h = Math.round(d.min / max * 100);
      var bnode = el('<div class="b">' +
        '<span class="n">' + (d.bumps ? '<span class="bump-n">↑' + d.bumps + '</span>' : (d.min || '')) + '</span>' +
        '<span class="fill' + (d.min ? '' : ' z') + '" style="height:' + (d.min ? Math.max(4, h) : 3) + '%"></span></div>');
      bindTip(bnode, 'неделя с ' + d.label + ' — ' + d.min + ' мин' + (d.bumps ? ', ступеней взято: ' + d.bumps : ''));
      bars.appendChild(bnode);
    });
    card.appendChild(bars);
    card.appendChild(el('<div class="bars-x">' + list(data, function (d, i) {
      return '<span>' + (i % 2 ? '' : d.label.split(' ')[0]) + '</span>';
    }) + '</div>'));
    card.appendChild(el('<p class="tiny muted" style="margin-top:8px">↑ — на этой неделе движок поднял дозу. Ровные столбики важнее высоких: регулярность лечит, объём только помогает.</p>'));
    return card;
  }

  /* ══════════════════════ вкладка: журнал ══════════════════════ */

  function viewLog() {
    var v = document.getElementById('view');
    v.innerHTML = '';

    var sess = S.sessions.slice().sort(function (a, b) { return b.ts - a.ts; });

    var head = el('<section class="card"><div class="card-h"><h2>Журнал занятий</h2>' +
      '<span class="hint">' + sess.length + ' ' + plural(sess.length, 'запись', 'записи', 'записей') + '</span></div>' +
      '<div class="btn-row"><button class="btn ghost" id="mdBtn">Скопировать для лфк.md</button></div></section>');
    v.appendChild(head);
    head.querySelector('#mdBtn').onclick = copyMarkdown;

    if (!sess.length) {
      v.appendChild(el('<section class="card"><div class="empty"><span class="e">📓</span>' +
        'Пока пусто. Первая тренировка — и здесь появится история.</div></section>'));
    } else {
      var lc = el('<section class="card"></section>');
      sess.forEach(function (s) {
        lc.appendChild(el('<div class="log-row">' +
          '<span class="dt">' + humanDate(s.date) + '</span>' +
          '<span class="wh"><b>' + esc(s.title) + '</b>' +
          '<span>' + (s.minutes || 0) + ' мин · ' + (s.items || []).filter(function (i) { return i.status === 'done'; }).length + ' из ' + (s.items || []).length + '</span>' +
          (s.note ? '<span class="note">«' + esc(s.note) + '»</span>' : '') + '</span>' +
          '<span class="pn">' + (s.pain != null ? 'боль ' + s.pain + '/10' : '') + '</span></div>'));
      });
      v.appendChild(lc);
    }

    // замеры по тестам
    var testIds = Object.keys(S.tests || {});
    if (testIds.length) {
      var tc = el('<section class="card"><div class="card-h"><h2>Замеры</h2><span class="hint">контрольные тесты</span></div></section>');
      testIds.forEach(function (tid) {
        var e = byId(tid), recs = S.tests[tid] || [];
        var m = (e && e.measure) || { unit: '', sides: false };
        tc.appendChild(el('<div class="sec-t">' + esc(e ? e.title : tid) + '</div>' ));
        tc.appendChild(el('<table class="tbl"><thead><tr><th>Дата</th>' +
          (m.sides ? '<th>Слева</th><th>Справа</th>' : '<th>' + esc(m.label || 'Значение') + '</th>') +
          '<th>Заметка</th></tr></thead><tbody>' +
          list(recs.slice().reverse(), function (r) {
            return '<tr><td>' + humanDate(r.date) + '</td>' +
              (m.sides ? '<td>' + esc(r.left || '—') + '</td><td>' + esc(r.right || '—') + '</td>' : '<td>' + esc(r.left || '—') + '</td>') +
              '<td>' + esc(r.note || '') + '</td></tr>';
          }) + '</tbody></table>'));
      });
      v.appendChild(tc);
    }

    // топ упражнений
    var ids = Object.keys(S.ex || {});
    if (ids.length) {
      ids.sort(function (a, b) { return (S.ex[b].count || 0) - (S.ex[a].count || 0); });
      var top = el('<section class="card"><div class="card-h"><h2>Что делается чаще всего</h2></div>' +
        '<table class="tbl"><thead><tr><th>Упражнение</th><th>Раз</th><th>Последний</th></tr></thead><tbody>' +
        list(ids.slice(0, 12), function (id) {
          var e = byId(id), st = S.ex[id];
          return '<tr><td>' + esc(e ? e.title : id) + '</td><td>' + (st.count || 0) + '</td><td>' + (st.last ? humanDate(st.last) : '—') + '</td></tr>';
        }) + '</tbody></table></section>');
      v.appendChild(top);
    }
  }

  function copyMarkdown() {
    var rows = S.sessions.slice().sort(function (a, b) { return a.ts - b.ts; }).map(function (s) {
      var did = s.title + ' (' + (s.minutes || 0) + ' мин)';
      var felt = (s.pain != null ? 'боль ' + s.pain + '/10' : '') + (s.note ? (s.pain != null ? '; ' : '') + s.note : '');
      return '| ' + s.date + ' | ' + did + ' | ' + (felt || '—') + ' |';
    });
    var md = '| Дата | Что делал | Как отозвалось |\n|---|---|---|\n' + rows.join('\n');
    navigator.clipboard.writeText(md).then(function () { toast('Таблица скопирована — вставляй в лфк.md'); },
      function () { window.prompt('Скопируй вручную:', md); });
  }

  /* ══════════════════════ плеер тренировки ══════════════════════ */

  var pl = null, tickHandle = null;

  function startPlayer(r) {
    var ex = routineExercises(r);
    if (!ex.length) { toast('В этом блоке нет упражнений'); return; }
    pl = { routine: r, ex: ex, i: 0, set: 0, left: 0, running: false, results: [], pain: null, note: '' };
    document.getElementById('playerWrap').hidden = false;
    document.body.style.overflow = 'hidden';
    drawPlayer();
  }
  function closePlayer() {
    stopTick();
    pl = null;
    document.getElementById('playerWrap').hidden = true;
    document.body.style.overflow = '';
    rerender();
  }
  function stopTick() { if (tickHandle) { clearInterval(tickHandle); tickHandle = null; } }

  function drawPlayer() {
    var wrap = document.getElementById('playerWrap');
    var box = wrap.querySelector('.player');
    if (pl.i >= pl.ex.length) return drawFinish(box);

    var e = pl.ex[pl.i], d = doseOf(e), sets = d.sets || 1;
    var isHold = e.timerMode === 'hold' || e.timerMode === 'duration';

    box.innerHTML =
      '<div class="pl-top"><button class="btn ghost" id="plX">✕ Выйти</button>' +
      '<span class="tiny muted">' + esc(pl.routine.title) + ' · ' + (pl.i + 1) + ' из ' + pl.ex.length + '</span></div>' +
      '<div class="pl-seg">' + pl.ex.map(function (x, idx) {
        return '<i class="' + (idx < pl.i ? 'done' : idx === pl.i ? 'cur' : '') + '" title="' + esc(x.title) + '"></i>';
      }).join('') + '</div>' +
      '<div class="pl-pic">' + picHtml(e.id, '', true) + '</div>' +
      '<h1 class="pl-title">' + esc(e.title) + '</h1>' +
      '<div class="pl-sub">' + esc(doseTextOf(e)) + (doseChanged(e) ? ' <span class="tiny">↑ поднято</span>' : '') + '</div>' +
      '<div class="timer" id="plTm"' + (isHold ? '' : ' hidden') + '>' +
        '<div class="tring-wrap">' + timerRingHtml(150) + '<div class="t" id="plT"></div></div>' +
        '<div class="lbl"></div></div>' +
      (sets > 1 ? '<div class="set-dots">' + Array.apply(null, Array(sets)).map(function () { return '<i></i>'; }).join('') + '</div>' : '') +
      (e.steps && e.steps.length ? '<div class="sec-t">Шаги</div><ol class="steps">' +
        list(e.steps, function (s) { return '<li><span>' + esc(s) + '</span></li>'; }) + '</ol>' : '') +
      (e.cues && e.cues.length ? '<div class="sec-t">Контроль</div><ul class="bul">' +
        list(e.cues, function (s) { return '<li><span class="m">→</span><span>' + esc(s) + '</span></li>'; }) + '</ul>' : '') +
      (e.video && e.video.url ? '<div class="pl-video">' + videoLinkHtml(e.video) + '</div>' : '') +
      (e.stop && e.stop.length ? '<div class="callout stop" style="margin-top:14px"><b>Стоп, если</b>' +
        esc(e.stop.join(' · ')) + '</div>' : '') +
      (pl.i + 1 < pl.ex.length
        ? '<div class="pl-next"><span class="th">' + picHtml(pl.ex[pl.i + 1].id) + '</span>' +
          '<span>далее: <b>' + esc(pl.ex[pl.i + 1].title) + '</b><br><span class="tiny muted">' + esc(doseTextOf(pl.ex[pl.i + 1])) + '</span></span></div>'
        : '<div class="pl-next"><span>🌿 последнее упражнение блока</span></div>') +
      '<div class="pl-actions" id="plActs"></div>';

    box.querySelector('#plX').onclick = function () { if (confirm('Выйти из тренировки? Прогресс этой сессии не сохранится.')) closePlayer(); };
    updateTimerUI();
    box.scrollTop = 0;
    wrap.scrollTop = 0;
  }

  // Кольцо вокруг цифры таймера: пустеет по мере отсчёта, как в фитнес-плеерах.
  function timerRingHtml(size) {
    var r = (size - 12) / 2, c = 2 * Math.PI * r;
    return '<svg class="ring tring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle class="bg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="9"/>' +
      '<circle class="fg" id="plRing" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="9" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="0" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }
  function setTimerRing(frac) {   // frac — доля оставшегося времени, 0..1
    var ring = document.getElementById('plRing');
    if (!ring) return;
    var c = parseFloat(ring.getAttribute('stroke-dasharray'));
    ring.setAttribute('stroke-dashoffset', (c * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1));
  }

  // Таймер, точки подходов и кнопки живут отдельно от остального экрана и
  // обновляются точечно: полная перерисовка убивала бы играющий видео-iframe
  // на каждом подходе и отдыхе. Полный drawPlayer — только при смене упражнения.
  function updateTimerUI() {
    var box = document.querySelector('#playerWrap .player');
    if (!pl || pl.i >= pl.ex.length || !box) return;
    var e = pl.ex[pl.i], d = doseOf(e), sets = d.sets || 1;
    var isHold = e.timerMode === 'hold' || e.timerMode === 'duration';

    var tm = box.querySelector('#plTm');
    if (tm) {
      tm.hidden = !isHold && !pl.inRest;
      tm.classList.toggle('is-run', !!(pl.running || pl.inRest));
      tm.classList.toggle('is-rest', !!pl.inRest);
      tm.querySelector('#plT').textContent = fmt(pl.inRest ? pl.restLeft : (pl.left || d.hold || 30));
      tm.querySelector('.lbl').textContent = pl.inRest
        ? 'отдых · дальше подход ' + (pl.set + 2) + ' из ' + sets
        : (pl.running ? 'идёт удержание' : 'нажми ▶, чтобы запустить');
      setTimerRing(pl.inRest ? pl.restLeft / (d.rest || 1) : (pl.left || d.hold || 30) / (d.hold || 30));
    }
    var dots = box.querySelectorAll('.set-dots i');
    for (var i = 0; i < dots.length; i++) dots[i].className = i < pl.set ? 'on' : '';

    var acts = box.querySelector('#plActs');
    if (!acts) return;
    acts.innerHTML = pl.inRest
      ? '<button class="btn ok" id="plSkipRest">Пропустить отдых</button>'
      : (isHold
          ? (pl.running ? '<button class="btn ghost" id="plPause">⏸ Пауза</button>' : '<button class="btn ok" id="plTimer">▶ Таймер</button>')
          : '<button class="btn ok" id="plDone">' + (pl.set + 1 < sets ? 'Подход готов' : 'Готово') + '</button>') +
        '<button class="btn ghost" id="plSkip">Пропустить</button>';
    var sr = acts.querySelector('#plSkipRest');
    if (sr) sr.onclick = skipRest;
    acts.querySelector('#plSkip').onclick = function () { record(e.id, 'skip'); next(); };
    var db = acts.querySelector('#plDone');
    if (db) db.onclick = function () {
      if (pl.set + 1 < sets) advanceSet(e, d);
      else { record(e.id, 'done'); next(); }
    };
    var tb = acts.querySelector('#plTimer');
    if (tb) tb.onclick = function () { startHoldTimer(e, d); };
    var pb = acts.querySelector('#plPause');
    if (pb) pb.onclick = function () { stopTick(); pl.running = false; updateTimerUI(); };
  }

  // между подходами: если в дозе задан отдых — досчитываем его со звуком,
  // затем сами переходим к следующему подходу (для удержаний — сразу стартуем таймер)
  function advanceSet(e, d) {
    stopTick();
    var isHold = e.timerMode === 'hold' || e.timerMode === 'duration';
    var goNext = function () {
      pl.set++; pl.left = 0; pl.running = false; pl.inRest = false;
      if (isHold) startHoldTimer(e, d); else updateTimerUI();
    };
    if (d.rest > 0) {
      pl.restLeft = d.rest; pl.inRest = true; pl.onRestDone = goNext;
      updateTimerUI();
      tickHandle = setInterval(function () {
        pl.restLeft--;
        var t = document.getElementById('plT');
        if (t) t.textContent = fmt(pl.restLeft);
        setTimerRing(pl.restLeft / (d.rest || 1));
        if (pl.restLeft <= 0) skipRest();
      }, 1000);
    } else goNext();
  }
  function skipRest() {
    stopTick();
    var cb = pl.onRestDone; pl.onRestDone = null; pl.inRest = false;
    beep();
    if (cb) cb();
  }

  function startHoldTimer(e, d) {
    if (!pl.left) pl.left = d.hold || 30;
    pl.running = true;
    updateTimerUI();
    tickHandle = setInterval(function () {
      pl.left--;
      var t = document.getElementById('plT');
      if (t) t.textContent = fmt(pl.left);
      setTimerRing(pl.left / (d.hold || 30));
      if (pl.left <= 0) {
        stopTick(); pl.running = false; pl.left = 0;
        beep();
        var sets = d.sets || 1;
        if (pl.set + 1 < sets) advanceSet(e, d);
        else { record(e.id, 'done'); next(); }
      }
    }, 1000);
  }
  function fmt(s) { s = Math.max(0, s | 0); return (s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : String(s)); }
  function beep() {
    try {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      var a = new C(), o = a.createOscillator(), g = a.createGain();
      o.frequency.value = 660; o.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(0.16, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.45);
      o.start(); o.stop(a.currentTime + 0.46);
    } catch (e) {}
  }

  function record(id, status) { pl.results.push({ id: id, status: status }); if (status === 'done') markDone(id); }
  function next() { pl.i++; pl.set = 0; pl.left = 0; pl.running = false; pl.inRest = false; stopTick(); drawPlayer(); }

  function drawFinish(box) {
    var done = pl.results.filter(function (r) { return r.status === 'done'; }).length;
    var mins = pl.ex.reduce(function (a, e, i) { return a + (pl.results[i] && pl.results[i].status === 'done' ? (e.minutes || 2) : 0); }, 0);
    box.innerHTML =
      '<div class="pl-top"><span></span><span class="tiny muted">' + esc(pl.routine.title) + '</span></div>' +
      '<div style="text-align:center;padding:26px 0 8px"><div style="font-size:52px">🌿</div>' +
      '<h1 style="font-size:26px;margin:10px 0 4px">Готово</h1>' +
      '<p class="sec">' + done + ' из ' + pl.ex.length + ' · ' + mins + ' мин</p></div>' +
      '<div class="sec-t">Как отозвалось — боль сейчас</div>' +
      '<div class="pain-scale" id="painScale">' +
      Array.apply(null, Array(11)).map(function (_, i) { return '<button type="button" data-p="' + i + '">' + i + '</button>'; }).join('') +
      '</div><p class="tiny muted">0 — ничего не беспокоит, 10 — не могу терпеть. Ноющая боль это его норма, острая — красный флаг.</p>' +
      '<div class="sec-t">Заметка</div><textarea class="ta" id="plNote" placeholder="Что пошло не так, что было легко, куда отдавало…"></textarea>' +
      '<div class="pl-actions"><button class="btn" id="plSave">Записать в журнал</button>' +
      '<button class="btn ghost" id="plDrop">Не записывать</button></div>';

    var scale = box.querySelector('#painScale');
    scale.onclick = function (ev) {
      var b = ev.target.closest('button[data-p]'); if (!b) return;
      var all = scale.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('is-on');
      b.classList.add('is-on'); pl.pain = +b.getAttribute('data-p');
    };
    box.querySelector('#plSave').onclick = function () {
      logSession({
        routine: pl.routine.id, title: pl.routine.title, items: pl.results,
        minutes: mins, pain: pl.pain, note: box.querySelector('#plNote').value.trim()
      });
      var ids = pl.results.filter(function (r) { return r.status === 'done'; }).map(function (r) { return r.id; });

      // боль выше терпимой — откатываем сами и не спрашиваем: это правило боли, а не выбор
      if (pl.pain != null && pl.pain >= PROG_DROP_PAIN) {
        var n = dropDoses(ids);
        closePlayer();
        toast(n ? 'Боль ' + pl.pain + ' — снизил дозы: ' + n + ' ' + plural(n, 'упражнение', 'упражнения', 'упражнений') : 'Записано. Отдохни день.');
        return;
      }
      var cand = bumpCandidates(ids);
      if (cand.length) { drawBumps(box, cand); return; }
      closePlayer();
      toast('Записано. Серия: ' + streak() + ' ' + plural(streak(), 'день', 'дня', 'дней'));
    };
    box.querySelector('#plDrop').onclick = closePlayer;
  }

  // Предложение поднять дозу. Появляется только здесь и только после оценки боли:
  // раньше о боли ничего не известно, а без неё повышать нельзя.
  function drawBumps(box, cand) {
    box.innerHTML =
      '<div class="pl-top"><span></span><span class="tiny muted">' + esc(pl.routine.title) + '</span></div>' +
      '<div style="text-align:center;padding:22px 0 4px"><div style="font-size:46px">📈</div>' +
      '<h1 style="font-size:24px;margin:10px 0 4px">Пора прибавить</h1>' +
      '<p class="sec small">' + cand.length + ' ' + plural(cand.length, 'упражнение прошло', 'упражнения прошли', 'упражнений прошли') +
      ' три занятия подряд с болью не выше ' + PROG_CLEAN_PAIN + '. Это и есть сигнал прибавить — не календарь.</p></div>' +
      list(cand, function (e, i) {
        var n = nextDose(e);
        return '<div class="routine"><div class="t"><b>' + esc(e.title) + '</b>' +
          '<span>' + esc(shortDose(doseOf(e), e)) + ' → <b>' + esc(shortDose(n, e)) + '</b></span>' +
          '<span class="prev">' + esc(e.progression || '') + '</span></div>' +
          '<button class="btn" data-bump="' + i + '">Поднять</button></div>';
      }) +
      '<div class="pl-actions"><button class="btn ok" id="bmAll">Поднять всё</button>' +
      '<button class="btn ghost" id="bmLater">Ещё рано</button></div>' +
      '<p class="tiny muted">«Ещё рано» — не насовсем: предложение вернётся через ' + PROG_SNOOZE + ' дней.</p>';

    function bump(e) {
      var n = nextDose(e);
      if (n) applyDose(e.id, n, 'три чистых занятия подряд');
    }
    var btns = box.querySelectorAll('[data-bump]');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.onclick = function () {
          var e = cand[+b.getAttribute('data-bump')];
          bump(e); b.disabled = true; b.textContent = '✓ Поднято';
        };
      })(btns[i]);
    }
    box.querySelector('#bmAll').onclick = function () {
      cand.forEach(bump);
      closePlayer();
      toast('Поднял ' + cand.length + ' ' + plural(cand.length, 'упражнение', 'упражнения', 'упражнений'));
    };
    box.querySelector('#bmLater').onclick = function () {
      cand.forEach(function (e) {
        if (!S.ex[e.id]) S.ex[e.id] = { count: 0 };
        S.ex[e.id].snooze = ymd(new Date());
      });
      save(); closePlayer();
      toast('Ок, оставил как есть');
    };
    box.scrollTop = 0;
  }

  function markDone(id) {
    if (!S.ex[id]) S.ex[id] = { count: 0 };
    S.ex[id].count = (S.ex[id].count || 0) + 1;
    S.ex[id].last = ymd(new Date());
    save();
  }
  function logSession(o) {
    o.id = 's' + S.sessions.length + '_' + new Date().getTime();
    o.date = ymd(new Date());
    o.ts = new Date().getTime();
    S.sessions.push(o);
    if (!S.startedAt) S.startedAt = o.date;
    save();
  }

  /* ══════════════════════ шторка и тосты ══════════════════════ */

  // Шторки складываются в стек: упражнение, открытое из зоны, закрывается
  // обратно в зону, а не выбрасывает на страницу. self — функция «покажи меня
  // заново»: по ней же перерисовывается предыдущая шторка со свежими данными.
  var sheetStack = [];
  var sheetSelf = null;
  function openSheet(html, cb, self) {
    var wrap = document.getElementById('sheetWrap');
    var body = document.getElementById('sheetBody');
    if (!wrap.hidden && sheetSelf) sheetStack.push(sheetSelf);
    sheetSelf = self || null;
    body.innerHTML = html;
    wrap.hidden = false;
    document.body.style.overflow = 'hidden';
    if (cb) cb(body);
    document.querySelector('.sheet').scrollTop = 0;
  }
  function closeSheet(all) {
    if (!all && sheetStack.length) {
      sheetSelf = null;           // не даём текущей шторке снова лечь в стек
      var back = sheetStack.pop();
      back();
      return;
    }
    sheetStack = []; sheetSelf = null;
    document.getElementById('sheetWrap').hidden = true;
    document.body.style.overflow = '';
  }
  function toast(msg) {
    var t = el('<div class="tip" style="left:50%;transform:translateX(-50%);bottom:26px;top:auto;max-width:none">' + esc(msg) + '</div>');
    t.hidden = false; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  /* ══════════════════════ библиотека Епифанова ══════════════════════ */

  /* Реестр всего, что автор показывает на канале: без картинок, дозировок под Диму и ротации.
     Смысл вкладки — отметить «зашло / не зашло» по факту занятий, а из «зашло» потом
     писать полноценные карточки. Секунда в ссылке взята из транскрипта ролика, не на глаз. */
  var LIB = (window.LFK_LIBRARY && window.LFK_LIBRARY.items) || [];
  var LIB_ZONES = (window.LFK_LIBRARY && window.LFK_LIBRARY.zones) || {};
  var libZone = 'all', libVerdict = 'all', libQuery = '', libShow = 'all';
  // Раньше тут было три отдельных фильтра — категория, частота и вердикт, двадцать с лишним
  // кнопок. При отборе нужен один вопрос: «что показать». Всё остальное схлопнуто сюда.
  // Умолчание — ВСЁ своё, а не только частое: два реза подряд (сначала мусор, потом частота)
  // оставляли от зоны огрызок в 14 строк и создавали ощущение, что половину потеряли.
  // Внутри группы список и так идёт от самого повторяемого к разовому — режь глазами, где надоест.
  var SHOW = [
    { k: 'all', label: 'Всё своё', hint: 'всё, что делаешь сам: сверху частое, снизу разовое' },
    { k: 'main', label: 'Только частое', hint: 'что автор повторяет минимум в двух роликах' },
    { k: 'rest', label: 'Массаж и врачебное', hint: 'приёмы массажиста, техники врача, не-упражнения' }
  ];
  var VERDICTS = [
    { k: 'all', label: 'все' },
    { k: 'yes', label: '👍' },
    { k: 'maybe', label: '🤔' },
    { k: 'no', label: '👎' },
    { k: 'none', label: 'не тронуто' }
  ];
  // Неразмеченное прячем не в «мусор», а к своим: лучше лишняя строка перед глазами,
  // чем движение, молча выпавшее из реестра.
  function libCatOf(i) { return i.cat && i.cat !== '?' ? i.cat : 'self'; }

  /* Разовый перенос отметок. Ключ движения раньше считался от его названия, а названия
     поехали, когда чинили рассинхрон подписи с роликом. Карта старый→новый лежит в реестре;
     после переезда ключ считается от списка роликов и переименования его больше не рушат. */
  function libMigrateKeys() {
    var mig = window.LFK_LIBRARY && window.LFK_LIBRARY.mig;
    if (!mig || S.libMig || !S.lib) return;
    for (var старый in mig) {
      var новый = mig[старый];
      if (S.lib[старый] && !S.lib[новый]) { S.lib[новый] = S.lib[старый]; delete S.lib[старый]; }
    }
    S.libMig = 1;
    save();
  }

  function libZoneTitle(z) { return LIB_ZONES[z] || zoneOf(z).title; }
  function libVerdictOf(k) { return (S.lib[k] || {}).v || ''; }
  function libSetVerdict(k, v) {
    if (libVerdictOf(k) === v) delete S.lib[k];              // повторный тап снимает отметку
    else S.lib[k] = { v: v, at: ymd(new Date()) };
    save();
  }
  function libMatch(i) {
    var свой = libCatOf(i) === 'self';
    if (libShow === 'rest') {
      if (свой) return false;
    } else {
      if (!свой) return false;
      // уже размеченное не прячем, иначе отметка на редком движении заставляет его исчезнуть
      if (libShow === 'main' && (i.n || 1) < 2 && !libVerdictOf(i.k)) return false;
    }
    if (libZone !== 'all' && i.z !== libZone) return false;
    var got = libVerdictOf(i.k);
    if (libVerdict === 'none' && got) return false;
    if (libVerdict !== 'all' && libVerdict !== 'none' && got !== libVerdict) return false;
    var q = libQuery.trim().toLowerCase();
    if (!q) return true;
    return (i.t + ' ' + (i.dose || '') + ' ' + libZoneTitle(i.z)).toLowerCase().indexOf(q) >= 0;
  }
  function libMSS(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function libRowHtml(i) {
    var v = i.v && i.v[0], got = libVerdictOf(i.k);
    var badge = i.red ? '<span class="lib-badge red">🔴 красная зона</span>'
      : i.have ? '<span class="lib-badge have">в плане</span>'
        : '<span class="lib-badge new">новое</span>';
    return '<div class="lib-row' + (got ? ' v-' + got : '') + '" data-k="' + esc(i.k) + '">' +
      '<div class="lib-main">' +
      '<b' + (i.have ? ' class="tap" data-ex="' + esc(i.have) + '"' : '') + '>' + esc(i.t) + '</b>' +
      '<div class="lib-meta">' +
      '<span class="dot" style="background:' + zoneColor(i.z) + '"></span>' +
      esc(i.mus || libZoneTitle(i.z)) +
      (i.dose ? ' · ' + esc(i.dose) : '') +
      (i.n > 1 ? ' · в ' + i.n + ' роликах' : '') + '</div>' +
      (i.q ? '<div class="lib-quote">«' + esc(i.q) + '»</div>' : '') +
      (i.red ? '<div class="lib-warn">' + esc(i.red) + '</div>' : '') +
      (i.against ? '<div class="lib-warn">Автор сам не советует это делать</div>' : '') +
      '</div>' +
      '<div class="lib-side">' + badge +
      (v ? '<a class="lib-yt" href="https://youtu.be/' + esc(v.id) + '?t=' + (v.s | 0) + '" target="_blank" rel="noopener">▶ ' + libMSS(v.s | 0) + '</a>' : '') +
      '<div class="lib-vote">' +
      '<button type="button" class="lib-btn' + (got === 'yes' ? ' is-on' : '') + '" data-v="yes" title="зашло">👍</button>' +
      '<button type="button" class="lib-btn' + (got === 'maybe' ? ' is-on' : '') + '" data-v="maybe" title="под вопросом — вернуться позже">🤔</button>' +
      '<button type="button" class="lib-btn' + (got === 'no' ? ' is-on' : '') + '" data-v="no" title="не зашло">👎</button>' +
      '</div></div></div>';
  }

  function viewLib() {
    var v = document.getElementById('view');
    v.innerHTML = '';
    if (!LIB.length) {
      v.innerHTML = '<section class="card"><div class="empty"><span class="e">📚</span>Библиотека ещё не собрана</div></section>';
      return;
    }

    var своих = LIB.filter(function (i) { return libCatOf(i) === 'self'; }).length;
    v.appendChild(el('<section class="card"><div class="sec-head"><h2>Библиотека Епифанова</h2></div>' +
      '<p class="small sec">Из ' + LIB.length + ' движений канала <b>' + своих + '</b> можно делать самому дома — они и открыты. ' +
      'Приёмы массажиста и техники врача на пациенте никуда не делись, но убраны под кнопку «Массаж и врачебное».</p>' +
      '<p class="small sec">Ссылка ведёт на нужную секунду ролика. Посмотрел — жми <b>👍</b> если берём, <b>👎</b> если мимо, ' +
      '<b>🤔</b> если непонятно и надо вернуться. Из «зашло» соберём полноценные карточки с картинками и прогрессией.</p>' +
      '<p class="small sec">Бери <b>по одной зоне за раз</b> — чипом сверху. Внутри зоны движения разбиты по группам мышц ' +
      'и идут от самого повторяемого автором к разовому: дошёл до одиночных — самое ценное уже позади. ' +
      'Помеченное <b>«в плане»</b> уже стоит карточкой в разделе «Упражнения», его отбирать не надо.</p></section>'));

    var bar = el('<section class="card tight"><div class="filters"></div>' +
      '<div class="filters" style="margin-top:8px"></div>' +
      '<div class="lib-stats"></div></section>');
    var fz = bar.querySelectorAll('.filters')[0], fs = bar.querySelectorAll('.filters')[1],
        st = bar.querySelector('.lib-stats');
    var zones = ['all'].concat(Object.keys(LIB_ZONES).filter(function (z) {
      return LIB.some(function (i) { return i.z === z; });
    }));
    // один набор на все счётчики: и чипы зон, и строка отметок должны показывать
    // ровно то, что попадёт в список при текущей кнопке «что показать»
    var видимые = LIB.filter(function (i) {
      var свой = libCatOf(i) === 'self';
      if (libShow === 'rest') return !свой;
      if (!свой) return false;
      return !(libShow === 'main' && (i.n || 1) < 2 && !libVerdictOf(i.k));
    });
    zones.forEach(function (z) {
      var cnt = видимые.filter(function (i) { return z === 'all' || i.z === z; }).length;
      var c = el('<button class="chip' + (libZone === z ? ' is-on' : '') + '" type="button">' +
        (z === 'all' ? '' : '<span class="dot" style="background:' + zoneColor(z) + '"></span>') +
        esc(z === 'all' ? 'Все' : libZoneTitle(z)) + ' <span class="tiny muted">' + cnt + '</span></button>');
      c.onclick = function () { libZone = z; viewLib(); };
      fz.appendChild(c);
    });
    SHOW.forEach(function (d) {
      var c = el('<button class="chip' + (libShow === d.k ? ' is-on' : '') + '" type="button" title="' + esc(d.hint) + '">' +
        esc(d.label) + '</button>');
      c.onclick = function () { libShow = d.k; viewLib(); };
      fs.appendChild(c);
    });
    var input = el('<input class="search" type="search" placeholder="Поиск по названию" value="' + esc(libQuery) + '">');
    input.oninput = function () { libQuery = input.value; renderRows(); };
    fs.appendChild(input);

    // счётчики отметок — они же фильтр: кликнул по «🤔 5» и видишь только отложенное.
    // Считаем ровно по тому набору, что показан в списке, иначе «не тронуто 447» под
    // сотней видимых строк — вранье.
    var зона = видимые.filter(function (i) { return libZone === 'all' || i.z === libZone; });
    VERDICTS.forEach(function (d) {
      var cnt = d.k === 'all' ? зона.length : зона.filter(function (i) {
        var got = libVerdictOf(i.k);
        return d.k === 'none' ? !got : got === d.k;
      }).length;
      var c = el('<button class="lib-stat' + (libVerdict === d.k ? ' is-on' : '') + '" type="button">' +
        esc(d.label) + ' <b>' + cnt + '</b></button>');
      c.onclick = function () { libVerdict = d.k; viewLib(); };
      st.appendChild(c);
    });
    v.appendChild(bar);

    var slot = el('<div id="libSlot"></div>');
    v.appendChild(slot);
    renderRows();

    function renderRows() {
      var items = LIB.filter(libMatch);
      if (!items.length) {
        slot.innerHTML = '<div class="card"><div class="empty"><span class="e">🔍</span>Ничего не нашлось</div></div>';
        return;
      }
      slot.innerHTML = '<section class="card tight"><div class="lib-list">' +
        list(libGroups(items), function (g) {
          return '<div class="lib-group">' + esc(g.title) +
            '<span class="n">' + g.items.length + '</span></div>' + list(g.items, libRowHtml);
        }) + '</div></section>';
      wireRows(slot);
    }

    /* Плоская простыня на сотню строк не читается. Смотрим все зоны — заголовки по зонам,
       выбрана одна — по группам мышц внутри неё: «что качаем» и «чем именно». */
    function libGroups(items) {
      var поЗонам = libZone === 'all', порядок = [], куча = {};
      items.forEach(function (i) {
        var g = поЗонам ? libZoneTitle(i.z) : (i.mus || 'без группы');
        if (!куча[g]) { куча[g] = []; порядок.push(g); }
        куча[g].push(i);
      });
      // зоны уже идут в нужном порядке из реестра, группы мышц — самая крупная сверху
      if (!поЗонам) порядок.sort(function (a, b) { return куча[b].length - куча[a].length; });
      return порядок.map(function (g) { return { title: g, items: куча[g] }; });
    }

    function wireRows(root) {
      var rows = root.querySelectorAll('.lib-row');
      for (var i = 0; i < rows.length; i++) {
        (function (row) {
          var k = row.getAttribute('data-k');
          var btns = row.querySelectorAll('.lib-btn');
          for (var j = 0; j < btns.length; j++) {
            (function (b) {
              b.onclick = function () { libSetVerdict(k, b.getAttribute('data-v')); viewLib(); };
            })(btns[j]);
          }
          var tap = row.querySelector('.tap[data-ex]');
          if (tap) tap.onclick = function () { openEx(tap.getAttribute('data-ex')); };
        })(rows[i]);
      }
    }
  }

  /* ══════════════════════ навигация ══════════════════════ */

  var VIEWS = { dash: viewDash, today: viewToday, cat: viewCat, plan: viewPlan, lib: viewLib, log: viewLog };
  var current = 'dash';
  var scrollPos = {};   // где стоял скролл каждой вкладки — возврат не сбрасывает место

  function go(name) {
    scrollPos[current] = window.scrollY;
    current = VIEWS[name] ? name : 'dash';
    var tabs = document.querySelectorAll('#tabs .tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('is-on', tabs[i].dataset.view === current);
    render();
    window.scrollTo(0, scrollPos[current] || 0);
    try { location.hash = current; } catch (e) {}
  }
  function render() { VIEWS[current](); }
  // Перерисовка вкладки после действия (выполнено, доза) без прыжка наверх.
  function rerender() {
    var y = window.scrollY;
    render();
    requestAnimationFrame(function () { window.scrollTo(0, y); });
  }

  /* ══════════════════════ запуск ══════════════════════ */

  function boot() {
    S = load();
    libMigrateKeys();
    document.documentElement.setAttribute('data-theme', (S.settings && S.settings.theme) || 'dark');

    document.getElementById('tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.tab'); if (t) go(t.dataset.view);
    });
    document.getElementById('themeBtn').onclick = function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      S.settings.theme = next; save();
    };
    document.getElementById('sheetX').onclick = closeSheet;
    document.getElementById('sheetWrap').addEventListener('click', function (e) {
      if (e.target.dataset.close) closeSheet();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSheet(); }
    });

    document.getElementById('exportBtn').onclick = function () {
      var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'travka-progress-' + ymd(new Date()) + '.json';
      a.click();
    };
    document.getElementById('importBtn').onclick = function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = function () {
        var f = inp.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try { S = JSON.parse(rd.result); save(); render(); toast('Прогресс загружен'); }
          catch (err) { toast('Файл не читается'); }
        };
        rd.readAsText(f);
      };
      inp.click();
    };
    document.getElementById('resetBtn').onclick = function () {
      if (confirm('Стереть весь прогресс? Отменить будет нельзя.')) { S = freshStore(); save(); render(); }
    };

    var st = streak();
    document.getElementById('streakN').textContent = st;

    // #play:<id> открывает тренировку сразу — такую ссылку можно вынести
    // на домашний экран телефона и запускать утренний ритуал одним тапом.
    var hash = (location.hash || '').replace('#', '');
    if (hash.indexOf('play:') === 0) {
      var r = routineObj(hash.slice(5));
      go('today');
      if (r) startPlayer(r);
    } else {
      go(VIEWS[hash] ? hash : 'dash');
    }

    if (!EX.length) {
      document.getElementById('view').insertAdjacentHTML('afterbegin',
        '<section class="card"><div class="empty"><span class="e">⚠️</span>' +
        'Файлы упражнений не загрузились. Проверь, что рядом с index.html лежит папка <code>js/</code>.</div></section>');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
