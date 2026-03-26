// ═══════════════════════════════════════════════════════════
//  📋  WIDGET TÂCHES — Scriptable v2
//  Lit les tâches en temps réel depuis Supabase
//  → Se rafraîchit automatiquement toutes les 15-30 min
//  → Mis à jour dès que tu modifies une tâche dans l'app
//
//  ⚙️  REMPLIS CES 2 VALEURS :
// ═══════════════════════════════════════════════════════════
const SUPABASE_URL  = "REMPLACE_PAR_TON_URL";       // ex: https://xyzxyz.supabase.co
const SUPABASE_ANON = "REMPLACE_PAR_TA_ANON_KEY";   // commence par eyJ...
const TABLE_NAME    = "tasks";
const USER_ID       = "moi";

// Délai de rafraîchissement en minutes (iOS décide, mais on peut suggérer)
const REFRESH_MINUTES = 15;

// ── COULEURS ────────────────────────────────────────────────
const C = {
  bg:        new Color("#0b0b12"),
  surface:   new Color("#16161e"),
  surface2:  new Color("#1e1e28"),
  accent:    new Color("#c8fb4c"),
  accentLow: new Color("#c8fb4c", 0.15),
  text:      new Color("#f0eff8"),
  muted:     new Color("#7c7b8a"),
  faint:     new Color("#3a3a4e"),
  high:      new Color("#ff9f43"),
  urgent:    new Color("#ff6b6b"),
  recur:     new Color("#7c6ff7"),
  done:      new Color("#3a3a50"),
  w06:       new Color("#ffffff", 0.06),
  w10:       new Color("#ffffff", 0.10),
};

// ── CHARGEMENT DEPUIS SUPABASE ────────────────────────────────
async function fetchTasks() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE_NAME}?user_id=eq.${USER_ID}&select=tasks_json,updated_at`;
    const req = new Request(url);
    req.headers = {
      "apikey":        SUPABASE_ANON,
      "Authorization": `Bearer ${SUPABASE_ANON}`,
    };
    const rows = await req.loadJSON();
    if (rows && rows.length > 0 && rows[0].tasks_json) {
      return { tasks: JSON.parse(rows[0].tasks_json), updatedAt: rows[0].updated_at, error: null };
    }
    return { tasks: [], updatedAt: null, error: null };
  } catch(e) {
    return { tasks: [], updatedAt: null, error: e.message };
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function isVisibleToday(task) {
  if (!task.done) return true;
  if (task.recurDays && task.recurDays.length > 0) return true;
  if (task.doneAt) return new Date(task.doneAt).toDateString() === new Date().toDateString();
  return false;
}

function prioColor(prio) {
  return prio === 'urgent' ? C.urgent : prio === 'high' ? C.high : C.accent;
}

function formatDate() {
  const d = new Date();
  const days   = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
  const months = ["jan","fév","mar","avr","mai","juin","juil","août","sep","oct","nov","déc"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function formatUpdatedAt(iso) {
  if (!iso) return "jamais";
  const d   = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((now - d) / 60000);
  if (diffMin < 1)  return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `il y a ${diffH}h`;
  return d.toLocaleDateString('fr-FR', {day:'numeric', month:'short'});
}

function recurLabel(days) {
  if (!days || !days.length) return "";
  if (days.length === 7) return "quotidien";
  const n = ["D","L","M","M","J","V","S"];
  const s = [...days].sort((a,b)=>a-b);
  if (s.join(",") === "1,2,3,4,5") return "Lun–Ven";
  if (s.join(",") === "0,6") return "W-E";
  return s.map(d=>n[d]).join("·");
}

function drawProgressBar(pct, width, height) {
  const ctx  = new DrawContext();
  ctx.size   = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  // Fond
  const bgPath = new Path();
  bgPath.addRoundedRect(new Rect(0,0,width,height), height/2, height/2);
  ctx.addPath(bgPath);
  ctx.setFillColor(new Color("#2a2a36"));
  ctx.fillPath();

  // Fill
  if (pct > 0) {
    const fw = Math.max(height, (pct/100)*width);
    const fillPath = new Path();
    fillPath.addRoundedRect(new Rect(0,0,fw,height), height/2, height/2);
    ctx.addPath(fillPath);
    ctx.setFillColor(C.accent);
    ctx.fillPath();
  }
  return ctx.getImage();
}

// ══════════════════════════════════════════════════════════════
//  CONSTRUCTION DU WIDGET
// ══════════════════════════════════════════════════════════════
const { tasks: allTasks, updatedAt, error } = await fetchTasks();
const todayTasks = allTasks.filter(isVisibleToday);
const pending    = todayTasks.filter(t => !t.done);
const done       = todayTasks.filter(t => t.done);
const total      = todayTasks.length;
const pct        = total ? Math.round((done.length / total) * 100) : 0;

const family = config.widgetFamily || "medium";
const widget = new ListWidget();

// Fond
const grad = new LinearGradient();
grad.locations   = [0, 1];
grad.colors      = [new Color("#111119"), new Color("#09090f")];
grad.startPoint  = new Point(0, 0);
grad.endPoint    = new Point(1, 1);
widget.backgroundGradient = grad;
widget.setPadding(14, 14, 12, 14);
widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

// ── PETIT ──────────────────────────────────────────────────
if (family === "small") {
  buildSmall(widget);
}
// ── MOYEN ──────────────────────────────────────────────────
else if (family === "medium") {
  buildMedium(widget);
}
// ── GRAND ──────────────────────────────────────────────────
else {
  buildLarge(widget);
}

Script.setWidget(widget);
Script.complete();
if (!config.runsInWidget) await widget.presentMedium();

// ══════════════════════════════════════════════════════════════
//  PETIT WIDGET
// ══════════════════════════════════════════════════════════════
function buildSmall(w) {
  // Point de couleur + titre
  const row1 = w.addStack();
  row1.layoutHorizontally(); row1.centerAlignContent();
  const dot = row1.addStack();
  dot.size = new Size(7,7);
  dot.backgroundColor = C.accent;
  dot.cornerRadius = 3.5;
  row1.addSpacer(5);
  const t1 = row1.addText("Tâches");
  t1.font = Font.boldSystemFont(11);
  t1.textColor = C.muted;

  w.addSpacer(6);

  // Gros chiffre
  const bigNum = w.addText(pending.length.toString());
  bigNum.font = Font.boldSystemFont(52);
  bigNum.textColor = C.accent;
  bigNum.minimumScaleFactor = 0.4;

  const subLbl = w.addText("à faire");
  subLbl.font = Font.systemFont(11);
  subLbl.textColor = C.muted;

  w.addSpacer();

  // Date
  const dateTxt = w.addText(formatDate());
  dateTxt.font = Font.systemFont(10);
  dateTxt.textColor = C.faint;

  // Barre progress
  w.addSpacer(5);
  const barImg = drawProgressBar(pct, 110, 4);
  const barEl  = w.addImage(barImg);
  barEl.imageSize = new Size(110, 4);

  w.addSpacer(3);
  const pctTxt = w.addText(`${pct}% fait`);
  pctTxt.font = Font.systemFont(9);
  pctTxt.textColor = C.faint;

  // Sync
  if (error) {
    w.addSpacer(4);
    const errTxt = w.addText("⚠️ Hors ligne");
    errTxt.font = Font.systemFont(8);
    errTxt.textColor = C.urgent;
  }
}

// ══════════════════════════════════════════════════════════════
//  MOYEN WIDGET
// ══════════════════════════════════════════════════════════════
function buildMedium(w) {
  // ── Header ──
  const hRow = w.addStack();
  hRow.layoutHorizontally(); hRow.centerAlignContent();

  const titleStack = hRow.addStack();
  titleStack.layoutVertically();
  const titleTxt = titleStack.addText("Mes tâches");
  titleTxt.font = Font.boldSystemFont(14);
  titleTxt.textColor = C.text;
  const dateTxt = titleStack.addText(formatDate());
  dateTxt.font = Font.systemFont(10);
  dateTxt.textColor = C.muted;

  hRow.addSpacer();

  // Badge + sync
  const rightStack = hRow.addStack();
  rightStack.layoutVertically();
  rightStack.centerAlignContent();

  const badge = rightStack.addStack();
  badge.backgroundColor = C.accentLow;
  badge.cornerRadius = 10;
  badge.setPadding(3,9,3,9);
  badge.layoutHorizontally(); badge.centerAlignContent();
  const badgeTxt = badge.addText(`${pending.length}`);
  badgeTxt.font = Font.boldSystemFont(13);
  badgeTxt.textColor = C.accent;
  const badgeSub = badge.addText(" à faire");
  badgeSub.font = Font.systemFont(11);
  badgeSub.textColor = C.accent;

  rightStack.addSpacer(3);
  const syncTxt = rightStack.addText(error ? "⚠️ hors ligne" : `sync ${formatUpdatedAt(updatedAt)}`);
  syncTxt.font = Font.systemFont(8);
  syncTxt.textColor = error ? C.urgent : C.faint;
  syncTxt.rightAlignText();

  w.addSpacer(8);

  // Barre progression
  const barImg = drawProgressBar(pct, 330, 4);
  const barEl  = w.addImage(barImg);
  barEl.imageSize = new Size(330, 4);
  barEl.resizable = false;
  w.addSpacer(2);
  const pctTxt = w.addText(`${pct}% · ${done.length}/${total} complétées`);
  pctTxt.font = Font.systemFont(9);
  pctTxt.textColor = C.faint;

  w.addSpacer(8);

  // ── Liste tâches ──
  if (pending.length === 0 && done.length === 0) {
    const emptyTxt = w.addText("✨ Tout est libre aujourd'hui !");
    emptyTxt.font = Font.italicSystemFont(12);
    emptyTxt.textColor = C.muted;
  } else {
    const shown = [...pending.slice(0,3), ...(pending.length < 3 ? done.slice(0, 3-pending.length) : [])];
    for (const task of shown) {
      addTaskRow(w, task);
      w.addSpacer(5);
    }
    if (pending.length > 3) {
      const moreTxt = w.addText(`  + ${pending.length - 3} autre(s)…`);
      moreTxt.font = Font.italicSystemFont(10);
      moreTxt.textColor = C.faint;
    }
  }
  w.addSpacer();
}

// ══════════════════════════════════════════════════════════════
//  GRAND WIDGET
// ══════════════════════════════════════════════════════════════
function buildLarge(w) {
  // Header
  const hRow = w.addStack();
  hRow.layoutHorizontally(); hRow.centerAlignContent();
  const titleTxt = hRow.addText("Mes tâches");
  titleTxt.font = Font.boldSystemFont(18);
  titleTxt.textColor = C.text;
  hRow.addSpacer();
  const rightInfo = hRow.addStack();
  rightInfo.layoutVertically();
  const dateTxt = rightInfo.addText(formatDate());
  dateTxt.font = Font.systemFont(11);
  dateTxt.textColor = C.muted;
  dateTxt.rightAlignText();
  const syncTxt = rightInfo.addText(error ? "⚠️ hors ligne" : `sync ${formatUpdatedAt(updatedAt)}`);
  syncTxt.font = Font.systemFont(9);
  syncTxt.textColor = error ? C.urgent : C.faint;
  syncTxt.rightAlignText();

  w.addSpacer(8);

  // Stats
  const statsRow = w.addStack();
  statsRow.layoutHorizontally(); statsRow.spacing = 8;
  addStatBadge(statsRow, pending.length.toString(), "À faire", C.high);
  addStatBadge(statsRow, done.length.toString(), "Faites", C.accent);
  const recurCount = allTasks.filter(t=>t.recurDays&&t.recurDays.length).length;
  addStatBadge(statsRow, recurCount.toString(), "Récur.", C.recur);
  statsRow.addSpacer();

  w.addSpacer(10);

  // Barre
  const barImg = drawProgressBar(pct, 330, 5);
  const barEl  = w.addImage(barImg);
  barEl.imageSize = new Size(330, 5);
  w.addSpacer(3);
  const pctTxt = w.addText(`${pct}% complété`);
  pctTxt.font = Font.boldSystemFont(10);
  pctTxt.textColor = C.accent;

  w.addSpacer(10);

  // Section à faire
  if (pending.length > 0) {
    const sLbl = w.addText("▸ À FAIRE");
    sLbl.font = Font.boldSystemFont(9); sLbl.textColor = C.faint;
    w.addSpacer(5);
    for (const task of pending.slice(0, 5)) {
      addTaskRow(w, task); w.addSpacer(4);
    }
    if (pending.length > 5) {
      const m = w.addText(`  + ${pending.length-5} de plus…`);
      m.font = Font.italicSystemFont(10); m.textColor = C.faint;
      w.addSpacer(4);
    }
  }

  // Section faites
  if (done.length > 0) {
    w.addSpacer(6);
    const dLbl = w.addText("▸ COMPLÉTÉES");
    dLbl.font = Font.boldSystemFont(9); dLbl.textColor = C.faint;
    w.addSpacer(5);
    for (const task of done.slice(0,2)) {
      addTaskRowDone(w, task); w.addSpacer(4);
    }
  }

  if (!pending.length && !done.length) {
    w.addSpacer();
    const e = w.addText("✨ Aucune tâche aujourd'hui !");
    e.font = Font.italicSystemFont(13); e.textColor = C.muted; e.centerAlignText();
  }
  w.addSpacer();
}

// ══════════════════════════════════════════════════════════════
//  COMPOSANTS
// ══════════════════════════════════════════════════════════════
function addTaskRow(parent, task) {
  const row = parent.addStack();
  row.layoutHorizontally(); row.centerAlignContent();
  row.backgroundColor = C.w06;
  row.cornerRadius = 8;
  row.setPadding(6, 8, 6, 8);

  // Barre prio
  const bar = row.addStack();
  bar.size = new Size(3, 20);
  bar.backgroundColor = task.done ? C.done : prioColor(task.prio);
  bar.cornerRadius = 1.5;
  row.addSpacer(7);

  // Texte
  const ts = row.addStack(); ts.layoutVertically();
  const tt = ts.addText(task.title);
  tt.font = Font.semiboldSystemFont(12);
  tt.textColor = task.done ? C.done : C.text;
  tt.lineLimit = 1;
  if (task.desc) {
    const dt = ts.addText(task.desc);
    dt.font = Font.systemFont(10); dt.textColor = C.muted; dt.lineLimit = 1;
  }
  row.addSpacer();

  // Badge récurrence
  if (task.recurDays && task.recurDays.length > 0) {
    const rb = row.addStack();
    rb.backgroundColor = new Color("#7c6ff7", 0.15);
    rb.cornerRadius = 5; rb.setPadding(2,5,2,5);
    const rt = rb.addText("↻ " + recurLabel(task.recurDays));
    rt.font = Font.boldSystemFont(8); rt.textColor = C.recur;
    row.addSpacer(4);
  }

  // Checkbox
  const cb = row.addStack();
  cb.size = new Size(16,16);
  if (task.done) {
    cb.backgroundColor = C.accent; cb.cornerRadius = 8;
    const ct = cb.addText("✓");
    ct.font = Font.boldSystemFont(9); ct.textColor = new Color("#080810");
    cb.centerAlignContent();
  } else {
    cb.backgroundColor = new Color("#2a2a36"); cb.cornerRadius = 8;
  }
}

function addTaskRowDone(parent, task) {
  const row = parent.addStack();
  row.layoutHorizontally(); row.centerAlignContent();
  row.backgroundColor = C.w06; row.cornerRadius = 8;
  row.setPadding(6,8,6,8); row.opacity = 0.5;
  const cb = row.addStack();
  cb.size = new Size(16,16); cb.backgroundColor = C.accent; cb.cornerRadius = 8;
  const ct = cb.addText("✓");
  ct.font = Font.boldSystemFont(9); ct.textColor = new Color("#080810");
  cb.centerAlignContent();
  row.addSpacer(8);
  const tt = row.addText(task.title);
  tt.font = Font.systemFont(12); tt.textColor = C.done; tt.lineLimit = 1;
}

function addStatBadge(parent, value, label, color) {
  const stack = parent.addStack();
  stack.layoutVertically(); stack.cornerRadius = 8;
  stack.backgroundColor = new Color(color.hex, 0.1);
  stack.setPadding(5,10,5,10);
  const vt = stack.addText(value);
  vt.font = Font.boldSystemFont(16); vt.textColor = color; vt.centerAlignText();
  const lt = stack.addText(label);
  lt.font = Font.systemFont(9); lt.textColor = new Color(color.hex, 0.7); lt.centerAlignText();
}
