/* ════════════════════════════════════════════════════
   TODO PWA — app.js v4  SUPABASE AUTO-SYNC EDITION
   - Toutes les modifs → sync Supabase instantanée
   - Minuit → cleanup + sync automatique
   - Widget Scriptable lit directement depuis Supabase
════════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
//  ⚙️  CONFIGURATION SUPABASE
//  Remplis ces 2 valeurs après avoir créé ton projet
// ══════════════════════════════════════════════════════
const SUPABASE_URL    = "REMPLACE_PAR_TON_URL";        // ex: https://xyzxyz.supabase.co
const SUPABASE_ANON   = "REMPLACE_PAR_TA_ANON_KEY";   // commence par eyJ...
const TABLE_NAME      = "tasks";
const USER_ID         = "moi";   // identifiant utilisateur (tu peux laisser "moi")

// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
let tasks          = [];
let currentFilter  = 'all';
let editingId      = null;
let selectedPrio   = 'normal';
let recurrenceActive = false;
let selectedDays   = [];
let pendingDeleteId = null;
let syncPending    = false;   // debounce synchro
let supabaseOK     = false;   // true une fois config validée

const motivos = [
  "C'est parti pour aujourd'hui ! 🚀",
  "Une tâche à la fois 🎯",
  "Tu gères tout ça 💪",
  "Focus mode activé ✨",
  "Chaque tâche cochée compte 🏆",
  "On avance, on progresse 📈",
  "Bonne journée productive 🌟",
];

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  supabaseOK = isSupabaseConfigured();

  if (supabaseOK) {
    setSyncStatus('loading', 'Connexion…');
    await loadFromSupabase();
  } else {
    loadFromLocal();
    setSyncStatus('offline', 'Hors ligne');
  }

  checkRecurringRespawn();
  checkMidnightCleanup();
  renderAll();
  updateHeaderDate();
  scheduleAutoCleanup();
  setupInputCounters();
  initBgCanvas();
  setMotivational();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// ══════════════════════════════════════════════════════
//  SUPABASE — HELPERS
// ══════════════════════════════════════════════════════
function isSupabaseConfigured() {
  return SUPABASE_URL !== "REMPLACE_PAR_TON_URL"
      && SUPABASE_ANON !== "REMPLACE_PAR_TA_ANON_KEY";
}

function sbHeaders() {
  return {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON,
    'Authorization': `Bearer ${SUPABASE_ANON}`,
    'Prefer':        'return=minimal',
  };
}

// Charge les tâches depuis Supabase
async function loadFromSupabase() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE_NAME}?user_id=eq.${USER_ID}&select=tasks_json`;
    const res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    if (rows.length > 0 && rows[0].tasks_json) {
      tasks = JSON.parse(rows[0].tasks_json);
      saveLocal(); // cache local
      setSyncStatus('ok', 'Synchro OK');
    } else {
      // Première utilisation : on charge le local si dispo
      loadFromLocal();
      await pushToSupabase(); // on pousse le local vers Supabase
    }
  } catch (e) {
    console.warn('Supabase load error:', e);
    loadFromLocal();
    setSyncStatus('error', 'Hors ligne — données locales');
  }
}

// Pousse toutes les tâches vers Supabase (upsert)
async function pushToSupabase() {
  if (!supabaseOK) return;
  try {
    setSyncStatus('loading', 'Synchro…');
    const body = JSON.stringify({
      user_id:    USER_ID,
      tasks_json: JSON.stringify(tasks),
      updated_at: new Date().toISOString(),
    });
    // Upsert : insert ou update si user_id existe déjà
    const url = `${SUPABASE_URL}/rest/v1/${TABLE_NAME}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body,
    });
    if (!res.ok) throw new Error(await res.text());
    setSyncStatus('ok', 'Synchro OK');
  } catch (e) {
    console.warn('Supabase push error:', e);
    setSyncStatus('error', 'Erreur sync');
  }
}

// Debounce : attend 800ms après la dernière modif avant de synchro
let syncTimer = null;
function schedulePush() {
  saveLocal(); // sauvegarde locale immédiate
  if (!supabaseOK) return;
  clearTimeout(syncTimer);
  setSyncStatus('loading', 'En cours…');
  syncTimer = setTimeout(() => pushToSupabase(), 800);
}

// ══════════════════════════════════════════════════════
//  STOCKAGE LOCAL (fallback + cache)
// ══════════════════════════════════════════════════════
function loadFromLocal() {
  try {
    const raw = localStorage.getItem('todo_tasks_v3');
    tasks = raw ? JSON.parse(raw) : [];
  } catch { tasks = []; }
}

function saveLocal() {
  localStorage.setItem('todo_tasks_v3', JSON.stringify(tasks));
}

// saveTasks = local + sync cloud + snapshot calendrier
function saveTasks() {
  schedulePush();
  // Sauvegarde le snapshot du jour pour le calendrier
  saveSnapshotForToday();
}

// saveSnapshotForToday définie plus bas (calendrier)

// ══════════════════════════════════════════════════════
//  INDICATEUR DE SYNC (dans le header)
// ══════════════════════════════════════════════════════
function setSyncStatus(state, label) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  const dot  = el.querySelector('.sync-dot');
  const text = el.querySelector('.sync-text');
  if (text) text.textContent = label;
  if (dot) {
    dot.className = 'sync-dot';
    dot.classList.add(`sync-${state}`);
  }
}

// ══════════════════════════════════════════════════════
//  CRUD
// ══════════════════════════════════════════════════════
function addTask(title, desc, prio, recurDays) {
  const task = {
    id:               Date.now().toString(),
    title:            title.trim(),
    desc:             desc.trim(),
    prio:             prio || 'normal',
    done:             false,
    createdAt:        Date.now(),
    doneAt:           null,
    recurDays:        recurDays || [],
    lastRespawnDate:  null,
  };
  tasks.unshift(task);
  saveTasks();
  return task;
}

function updateTask(id, title, desc, prio, recurDays) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.title     = title.trim();
  task.desc      = desc.trim();
  task.prio      = prio || task.prio;
  task.recurDays = recurDays || [];
  if (!task.recurDays.length) task.lastRespawnDate = null;
  saveTasks();
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.done  = !task.done;
  task.doneAt = task.done ? Date.now() : null;
  saveTasks();
  renderAll();
  if (task.done) {
    showToast('✓', 'Tâche complétée !');
    launchConfetti();
    updateProgress();
  }
}

function requestDelete(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  if (task.recurDays && task.recurDays.length > 0) {
    pendingDeleteId = id;
    document.getElementById('delete-popup-overlay').classList.remove('hidden');
  } else {
    confirmDelete(id);
  }
}

function confirmDelete(id) {
  const el = document.querySelector(`.task-item[data-id="${id}"]`);
  if (el) {
    el.classList.add('deleting');
    setTimeout(() => {
      tasks = tasks.filter(t => t.id !== id);
      saveTasks(); renderAll();
    }, 360);
  } else {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks(); renderAll();
  }
  showToast('🗑', 'Tâche supprimée');
}

function deleteOccurrenceOnly() {
  if (!pendingDeleteId) return;
  const task = tasks.find(t => t.id === pendingDeleteId);
  if (task) {
    task.done           = true;
    task.doneAt         = Date.now();
    task.lastRespawnDate = todayISO();
    saveTasks(); renderAll();
    showToast('🔁', 'Elle reviendra au prochain jour prévu');
  }
  closeDeletePopup();
}

function deleteForever() {
  if (!pendingDeleteId) return;
  confirmDelete(pendingDeleteId);
  closeDeletePopup();
}

function closeDeletePopup() {
  document.getElementById('delete-popup-overlay').classList.add('hidden');
  pendingDeleteId = null;
}

// ══════════════════════════════════════════════════════
//  RÉCURRENCE
// ══════════════════════════════════════════════════════
function checkRecurringRespawn() {
  const iso      = todayISO();
  const todayDay = new Date().getDay();
  tasks.forEach(task => {
    if (!task.recurDays || !task.recurDays.length) return;
    if (task.lastRespawnDate === iso) return;
    if (task.recurDays.includes(todayDay)) {
      task.done           = false;
      task.doneAt         = null;
      task.lastRespawnDate = iso;
    }
  });
  saveTasks();
}

function checkMidnightCleanup() {
  const lastClean = localStorage.getItem('todo_last_cleanup_v2');
  const today     = new Date().toDateString();
  if (lastClean === today) return;
  tasks = tasks.filter(t => {
    if (!t.done) return true;
    if (t.recurDays && t.recurDays.length > 0) return true;
    return new Date(t.doneAt || 0).toDateString() === today;
  });
  saveTasks();
  localStorage.setItem('todo_last_cleanup_v2', today);
}

function scheduleAutoCleanup() {
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  setTimeout(() => {
    doMidnightCleanup();
    setInterval(doMidnightCleanup, 86400000);
  }, midnight - Date.now());
}

async function doMidnightCleanup() {
  const before = tasks.length;
  tasks = tasks.filter(t => !t.done || (t.recurDays && t.recurDays.length > 0));
  checkRecurringRespawn();

  // Sync immédiate à minuit (pas de debounce)
  saveLocal();
  if (supabaseOK) await pushToSupabase();

  renderAll();
  const removed = before - tasks.length;
  if (removed > 0) showToast('🌙', `${removed} tâche(s) supprimées`);
  localStorage.setItem('todo_last_cleanup_v2', new Date().toDateString());
}

// ══════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════
function renderAll() {
  renderTasks();
  renderStats();
  renderWidget();
  updateProgress();
}

function getFilteredTasks() {
  switch (currentFilter) {
    case 'pending':   return tasks.filter(t => !t.done);
    case 'done':      return tasks.filter(t => t.done);
    case 'recurring': return tasks.filter(t => t.recurDays && t.recurDays.length > 0);
    default:          return tasks;
  }
}

function renderTasks() {
  const list  = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');
  const filtered = getFilteredTasks();
  list.innerHTML = '';
  if (!filtered.length) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    filtered.forEach((task, i) => {
      const li = createTaskEl(task);
      li.style.animationDelay = `${i * 0.04}s`;
      list.appendChild(li);
    });
  }
}

function createTaskEl(task) {
  const li      = document.createElement('li');
  const isRecur = task.recurDays && task.recurDays.length > 0;
  li.className  = `task-item${task.done ? ' done' : ''}${isRecur ? ' recurring' : ''}`;
  li.dataset.id   = task.id;
  li.dataset.prio = task.prio;

  const prioIcons = {
    normal: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    high:   `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>`,
    urgent: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  };

  const prioBadge = task.prio !== 'normal'
    ? `<span class="badge badge-${task.prio}">${prioIcons[task.prio]} ${task.prio === 'high' ? 'Haute' : 'Urgente'}</span>`
    : '';

  const recurBadge = isRecur
    ? `<span class="badge badge-recur"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>${formatRecurDays(task.recurDays)}</span>`
    : '';

  li.innerHTML = `
    <div class="task-check ${task.done ? 'checked' : ''}"
         onclick="toggleTask('${task.id}'); event.stopPropagation();"></div>
    <div class="task-content">
      <div class="task-title">${escHtml(task.title)}</div>
      ${task.desc ? `<div class="task-desc">${escHtml(task.desc)}</div>` : ''}
      <div class="task-meta">
        <span class="task-time">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${formatTime(task.createdAt)}
        </span>
        ${prioBadge}${recurBadge}
      </div>
    </div>
    <div class="task-actions">
      <button class="task-action-btn edit"
              onclick="openEditModal('${task.id}'); event.stopPropagation();" title="Modifier">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
      </button>
      <button class="task-action-btn delete"
              onclick="requestDelete('${task.id}'); event.stopPropagation();" title="Supprimer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </div>`;
  return li;
}

function renderStats() {
  const total   = tasks.length;
  const done    = tasks.filter(t => t.done).length;
  const pending = total - done;
  const recur   = tasks.filter(t => t.recurDays && t.recurDays.length > 0).length;
  animateCount('stat-total',   total);
  animateCount('stat-done',    done);
  animateCount('stat-pending', pending);
  animateCount('stat-recur',   recur);
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const diff = target - current;
  const steps = Math.min(Math.abs(diff), 8);
  let step = 0;
  const iv = setInterval(() => {
    step++;
    el.textContent = Math.round(current + (diff * step / steps));
    if (step >= steps) { el.textContent = target; clearInterval(iv); }
  }, 30);
}

function updateProgress() {
  const total = tasks.length;
  const done  = tasks.filter(t => t.done).length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  const fill  = document.getElementById('progress-fill');
  const glow  = document.getElementById('progress-glow');
  const label = document.getElementById('progress-label');
  if (fill)  fill.style.width = pct + '%';
  if (glow)  glow.style.left  = pct + '%';
  if (label) label.textContent = pct + '%';
}

// ══════════════════════════════════════════════════════
//  WIDGET VIEW
// ══════════════════════════════════════════════════════
function renderWidget() {
  const list  = document.getElementById('widget-list');
  const count = document.getElementById('widget-count');
  const pending = tasks.filter(t => !t.done).length;
  count.textContent = pending;
  list.innerHTML = '';
  tasks.slice(0, 6).forEach(task => {
    const li = document.createElement('li');
    li.className = `widget-item${task.done ? ' done' : ''}`;
    const isRecur  = task.recurDays && task.recurDays.length > 0;
    const dotColor = isRecur ? 'var(--recur)'
      : task.prio === 'urgent' ? 'var(--urgent)'
      : task.prio === 'high'   ? 'var(--high)'
      : 'var(--accent)';
    li.innerHTML = `
      <span class="widget-dot" style="background:${dotColor}"></span>
      <span class="widget-item-text">${escHtml(task.title)}</span>
      ${isRecur ? '<span class="widget-recur-tag">🔁</span>' : ''}`;
    list.appendChild(li);
  });
}

function switchView(view) {
  const appView    = document.getElementById('app-view');
  const widgetView = document.getElementById('widget-view');
  if (view === 'widget') {
    appView.classList.add('hidden');
    widgetView.classList.remove('hidden');
    renderWidget();
  } else {
    widgetView.classList.add('hidden');
    appView.classList.remove('hidden');
    renderAll();
  }
}

// ══════════════════════════════════════════════════════
//  MODAL
// ══════════════════════════════════════════════════════
function openModal() {
  editingId = null; selectedPrio = 'normal'; recurrenceActive = false; selectedDays = [];
  document.getElementById('modal-title').textContent     = 'Nouvelle tâche';
  document.getElementById('btn-save-label').textContent  = 'Ajouter';
  document.getElementById('input-title').value = '';
  document.getElementById('input-desc').value  = '';
  updatePrioButtons('normal'); resetRecurrenceUI(); updateCharCounts();
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('input-title').focus(), 320);
}

function openEditModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingId = id; selectedPrio = task.prio;
  selectedDays = [...(task.recurDays || [])];
  recurrenceActive = selectedDays.length > 0;
  document.getElementById('modal-title').textContent     = 'Modifier la tâche';
  document.getElementById('btn-save-label').textContent  = 'Enregistrer';
  document.getElementById('input-title').value = task.title;
  document.getElementById('input-desc').value  = task.desc;
  updatePrioButtons(task.prio); resetRecurrenceUI();
  if (recurrenceActive) {
    document.getElementById('toggle-recurrence').classList.add('active');
    document.getElementById('recurrence-toggle-label').textContent = 'Activée';
    document.getElementById('recurrence-panel').classList.remove('hidden');
    document.querySelectorAll('.day-btn').forEach(b =>
      b.classList.toggle('active', selectedDays.includes(parseInt(b.dataset.day)))
    );
  }
  updateCharCounts();
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('input-title').focus(), 320);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

function saveTask() {
  const title = document.getElementById('input-title').value.trim();
  const desc  = document.getElementById('input-desc').value.trim();
  if (!title) {
    const inp = document.getElementById('input-title');
    inp.style.borderColor = 'var(--urgent)';
    inp.style.boxShadow   = '0 0 0 3px var(--urgent-dim)';
    inp.focus();
    inp.animate([{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}],{duration:250,iterations:2});
    setTimeout(() => { inp.style.borderColor = ''; inp.style.boxShadow = ''; }, 1400);
    return;
  }
  const recurDays = recurrenceActive ? [...selectedDays] : [];
  if (editingId) {
    updateTask(editingId, title, desc, selectedPrio, recurDays);
    showToast('✏️', 'Tâche modifiée');
  } else {
    addTask(title, desc, selectedPrio, recurDays);
    showToast(recurDays.length > 0 ? '🔁' : '✅', recurDays.length > 0 ? 'Tâche récurrente ajoutée !' : 'Tâche ajoutée !');
  }
  closeModal(); renderAll();
}

// ══════════════════════════════════════════════════════
//  PRIORITÉ
// ══════════════════════════════════════════════════════
function selectPrio(prio) {
  selectedPrio = prio; updatePrioButtons(prio);
}
function updatePrioButtons(prio) {
  document.querySelectorAll('.prio-btn').forEach(b => b.classList.toggle('active', b.dataset.prio === prio));
}

// ══════════════════════════════════════════════════════
//  RÉCURRENCE UI
// ══════════════════════════════════════════════════════
function toggleRecurrence() {
  recurrenceActive = !recurrenceActive;
  const btn   = document.getElementById('toggle-recurrence');
  const panel = document.getElementById('recurrence-panel');
  const label = document.getElementById('recurrence-toggle-label');
  btn.classList.toggle('active', recurrenceActive);
  label.textContent = recurrenceActive ? 'Activée' : 'Désactivée';
  panel.classList.toggle('hidden', !recurrenceActive);
  if (!recurrenceActive) { selectedDays = []; document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active')); }
}

function toggleDay(day, btn) {
  const idx = selectedDays.indexOf(day);
  if (idx === -1) { selectedDays.push(day); btn.classList.add('active'); }
  else            { selectedDays.splice(idx, 1); btn.classList.remove('active'); }
}

function selectQuickDays(preset) {
  const presets = { week:[0,1,2,3,4,5,6], workdays:[1,2,3,4,5], weekend:[0,6] };
  selectedDays = presets[preset] || [];
  document.querySelectorAll('.day-btn').forEach(b =>
    b.classList.toggle('active', selectedDays.includes(parseInt(b.dataset.day)))
  );
}

function resetRecurrenceUI() {
  recurrenceActive = false; selectedDays = [];
  document.getElementById('toggle-recurrence').classList.remove('active');
  document.getElementById('recurrence-toggle-label').textContent = 'Désactivée';
  document.getElementById('recurrence-panel').classList.add('hidden');
  document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
}

// ══════════════════════════════════════════════════════
//  FILTRE + SWITCH CALENDRIER
// ══════════════════════════════════════════════════════
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const taskContainer = document.getElementById('task-container');
  const calendarView  = document.getElementById('calendar-view');

  if (filter === 'calendar') {
    taskContainer.classList.add('hidden');
    calendarView.classList.remove('hidden');
    renderCalendar();
  } else {
    calendarView.classList.add('hidden');
    taskContainer.classList.remove('hidden');
    renderTasks();
  }
}

// ══════════════════════════════════════════════════════
//  CALENDRIER — STATE
// ══════════════════════════════════════════════════════
let calYear        = new Date().getFullYear();
let calMonth       = new Date().getMonth();   // 0-based
let calSelectedISO = null;  // "YYYY-MM-DD" de la date sélectionnée

// dailySnapshots : { "YYYY-MM-DD": { [taskId]: true/false } }
// Stocke l'état coché/décoché de chaque tâche pour chaque jour passé
function loadSnapshots() {
  try {
    return JSON.parse(localStorage.getItem('todo_snapshots_v1') || '{}');
  } catch { return {}; }
}
function saveSnapshots(snap) {
  localStorage.setItem('todo_snapshots_v1', JSON.stringify(snap));
}

// Enregistre l'état actuel de toutes les tâches pour aujourd'hui
function saveSnapshotForToday() {
  const iso  = todayISO();
  const snap = loadSnapshots();
  snap[iso]  = {};
  tasks.forEach(t => { snap[iso][t.id] = t.done; });
  saveSnapshots(snap);
}

// Naviguer dans les mois
function calPrevMonth() {
  if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--;
  renderCalendar();
}
function calNextMonth() {
  if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++;
  renderCalendar();
}

// ══════════════════════════════════════════════════════
//  CALENDRIER — RENDU GRILLE
// ══════════════════════════════════════════════════════
function renderCalendar() {
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin',
                  'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  document.getElementById('cal-month-label').textContent = `${months[calMonth]} ${calYear}`;

  const grid   = document.getElementById('cal-grid');
  const today  = new Date();
  const todISO = todayISO();
  const snap   = loadSnapshots();

  // 1er jour du mois → quel jour de semaine ? (lundi=0 pour notre affichage L M M J V S D)
  const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=dim
  const startOffset = (firstDay + 6) % 7; // décalage lundi-premier
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  grid.innerHTML = '';

  // Cellules vides avant le 1er
  for (let i = 0; i < startOffset; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day empty';
    grid.appendChild(cell);
  }

  // Cellules des jours
  for (let d = 1; d <= daysInMonth; d++) {
    const iso  = isoFromYMD(calYear, calMonth, d);
    const date = new Date(calYear, calMonth, d);
    const dow  = date.getDay(); // 0=dim

    const cell = document.createElement('div');
    cell.className = 'cal-day';

    // Passé / aujourd'hui
    const isPast  = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isToday = iso === todISO;
    const isSel   = iso === calSelectedISO;

    if (isPast)  cell.classList.add('past');
    if (isToday) cell.classList.add('today');
    if (isSel)   cell.classList.add('selected');

    // Numéro du jour
    const numEl = document.createElement('div');
    numEl.className = 'cal-day-num';
    numEl.textContent = d;
    cell.appendChild(numEl);

    // Dots : tâches de ce jour
    const dayTasks = getTasksForDate(iso, dow, snap);
    if (dayTasks.length > 0) {
      const dotRow = document.createElement('div');
      dotRow.className = 'cal-dot-row';
      const shown = dayTasks.slice(0, 3);
      shown.forEach(t => {
        const dot = document.createElement('div');
        dot.className = 'cal-dot';
        const isDone = iso === todISO ? t.done
          : (snap[iso] ? !!snap[iso][t.id] : false);
        const prioColors = { normal:'#c8fb4c', high:'#ff9f43', urgent:'#ff6b6b' };
        dot.style.background = isDone ? 'var(--done-col)' : (prioColors[t.prio] || '#c8fb4c');
        dotRow.appendChild(dot);
      });
      cell.appendChild(dotRow);
    }

    cell.addEventListener('click', () => selectCalDay(iso, dow));
    grid.appendChild(cell);
  }

  // Si une date est déjà sélectionnée, affiche ses tâches
  if (calSelectedISO) renderCalDayPanel(calSelectedISO);
  else renderCalDayPanel(null);
}

// ══════════════════════════════════════════════════════
//  CALENDRIER — SÉLECTION D'UN JOUR
// ══════════════════════════════════════════════════════
function selectCalDay(iso, dow) {
  calSelectedISO = iso;
  // Mettre à jour la grille (sélection visuelle)
  document.querySelectorAll('.cal-day').forEach(c => c.classList.remove('selected'));
  // Retrouver la cellule via sa position
  renderCalendar();
}

// ══════════════════════════════════════════════════════
//  CALENDRIER — PANEL DU JOUR
// ══════════════════════════════════════════════════════
function renderCalDayPanel(iso) {
  const panel    = document.getElementById('cal-day-panel');
  const dateEl   = document.getElementById('cal-day-panel-date');
  const subEl    = document.getElementById('cal-day-panel-sub');
  const listEl   = document.getElementById('cal-task-list');
  const emptyEl  = document.getElementById('cal-empty');

  if (!iso) {
    dateEl.textContent = 'Sélectionne une date';
    subEl.textContent  = '';
    listEl.innerHTML   = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  const todISO  = todayISO();
  const isToday = iso === todISO;
  const snap    = loadSnapshots();
  const date    = new Date(iso + 'T12:00:00');
  const days    = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const months  = ['jan','fév','mar','avr','mai','juin','juil','août','sep','oct','nov','déc'];
  const dow     = date.getDay();

  dateEl.textContent = `${days[dow]} ${date.getDate()} ${months[date.getMonth()]}`;
  subEl.textContent  = isToday ? '✨ Aujourd\'hui' : '';

  const dayTasks = getTasksForDate(iso, dow, snap);
  listEl.innerHTML = '';

  if (dayTasks.length === 0) {
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
    dayTasks.forEach((task, i) => {
      // État coché : si c'est aujourd'hui → état réel, sinon → snapshot
      const isDone = isToday
        ? task.done
        : (snap[iso] ? !!snap[iso][task.id] : false);

      const li = document.createElement('li');
      li.className = `cal-task-item${isDone ? ' cal-done' : ''}`;
      li.dataset.prio = task.prio;
      li.style.animationDelay = `${i * 0.04}s`;

      li.innerHTML = `
        <div class="cal-task-check${isDone ? ' checked' : ''}"
             onclick="calToggleTask('${task.id}', '${iso}', ${isToday}, this)"></div>
        <div class="cal-task-content">
          <div class="cal-task-title">${escHtml(task.title)}</div>
          ${task.desc ? `<div class="cal-task-desc">${escHtml(task.desc)}</div>` : ''}
        </div>
        <div class="cal-task-actions">
          <button class="task-action-btn edit"
                  onclick="openEditModal('${task.id}')" title="Modifier">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="task-action-btn delete"
                  onclick="requestDelete('${task.id}')" title="Supprimer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>`;
      listEl.appendChild(li);
    });
  }
}

// ══════════════════════════════════════════════════════
//  CALENDRIER — COCHER UNE TÂCHE (dans le panel)
// ══════════════════════════════════════════════════════
function calToggleTask(taskId, iso, isToday, checkEl) {
  if (isToday) {
    // Aujourd'hui → on toggle l'état réel
    toggleTask(taskId);
    // Sauvegarde le snapshot du jour
    setTimeout(() => {
      saveSnapshotForToday();
      renderCalDayPanel(iso);
      renderCalendar();
    }, 50);
  } else {
    // Jour passé → on toggle uniquement dans le snapshot
    const snap = loadSnapshots();
    if (!snap[iso]) snap[iso] = {};
    snap[iso][taskId] = !snap[iso][taskId];
    saveSnapshots(snap);

    // Animation visuelle immédiate
    const li = checkEl.closest('.cal-task-item');
    if (snap[iso][taskId]) {
      checkEl.classList.add('checked');
      li.classList.add('cal-done');
      launchConfetti();
    } else {
      checkEl.classList.remove('checked');
      li.classList.remove('cal-done');
    }
    // Refresh grille dots
    renderCalendar();
  }
}

// ══════════════════════════════════════════════════════
//  CALENDRIER — TÂCHES D'UN JOUR DONNÉ
// ══════════════════════════════════════════════════════
function getTasksForDate(iso, dow, snap) {
  const date   = new Date(iso + 'T12:00:00');
  const todISO = todayISO();

  return tasks.filter(task => {
    // Tâche récurrente → visible si ce jour est dans recurDays
    if (task.recurDays && task.recurDays.length > 0) {
      return task.recurDays.includes(dow);
    }
    // Tâche normale → visible si créée ce jour-là OU si on a un snapshot de ce jour
    const createdISO = isoFromTs(task.createdAt);
    if (createdISO === iso) return true;
    // Si snapshot existe pour ce jour et contient cette tâche
    if (snap[iso] && task.id in snap[iso]) return true;
    return false;
  });
}

// ══════════════════════════════════════════════════════
//  UTILS CALENDRIER
// ══════════════════════════════════════════════════════
function isoFromYMD(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function isoFromTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ══════════════════════════════════════════════════════
//  BACKGROUND CANVAS
// ══════════════════════════════════════════════════════
function initBgCanvas() {
  const canvas = document.getElementById('bg-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H;
  const orbs = Array.from({length:6}, (_,i) => ({
    x:     Math.random(), y:     Math.random(),
    r:     80 + Math.random() * 120,
    vx:    (Math.random()-.5)*.0003,
    vy:    (Math.random()-.5)*.0003,
    color: ['rgba(200,251,76,0.045)','rgba(124,111,247,0.04)','rgba(255,107,107,0.03)',
            'rgba(200,251,76,0.03)','rgba(124,111,247,0.05)','rgba(255,159,67,0.03)'][i],
    phase: Math.random()*Math.PI*2,
  }));
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  resize(); window.addEventListener('resize', resize);
  function draw(ts) {
    ctx.clearRect(0,0,W,H);
    orbs.forEach(o => {
      o.x += o.vx; o.y += o.vy;
      if (o.x<0||o.x>1) o.vx*=-1; if (o.y<0||o.y>1) o.vy*=-1;
      const p   = 1 + .08*Math.sin(ts*.001+o.phase);
      const grd = ctx.createRadialGradient(o.x*W,o.y*H,0,o.x*W,o.y*H,o.r*p);
      grd.addColorStop(0, o.color); grd.addColorStop(1, 'transparent');
      ctx.beginPath(); ctx.arc(o.x*W,o.y*H,o.r*p,0,Math.PI*2);
      ctx.fillStyle = grd; ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

// ══════════════════════════════════════════════════════
//  CONFETTI
// ══════════════════════════════════════════════════════
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const colors = ['#c8fb4c','#7c6ff7','#ff9f43','#ff6b6b','#fff','#4cd9fb'];
  const particles = Array.from({length:55}, () => ({
    x: canvas.width/2+(Math.random()-.5)*200, y: canvas.height*.6,
    vx:(Math.random()-.5)*8, vy:-(4+Math.random()*8),
    size:4+Math.random()*6, color:colors[Math.floor(Math.random()*colors.length)],
    rot:Math.random()*Math.PI*2, rv:(Math.random()-.5)*.3,
    shape:Math.random()>.5?'rect':'circle', life:1, decay:.013+Math.random()*.012,
  }));
  let frame;
  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let alive=false;
    particles.forEach(p => {
      if (p.life<=0) return; alive=true;
      p.x+=p.vx; p.y+=p.vy; p.vy+=.25; p.vx*=.98; p.rot+=p.rv; p.life-=p.decay;
      ctx.save(); ctx.globalAlpha=Math.max(0,p.life); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.fillStyle=p.color;
      if (p.shape==='rect') ctx.fillRect(-p.size/2,-p.size/4,p.size,p.size/2);
      else { ctx.beginPath(); ctx.arc(0,0,p.size/2,0,Math.PI*2); ctx.fill(); }
      ctx.restore();
    });
    if (alive) frame=requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  cancelAnimationFrame(frame); requestAnimationFrame(draw);
}

// ══════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('fr-FR', {day:'numeric', month:'short'});
}
function formatRecurDays(days) {
  if (!days||!days.length) return '';
  if (days.length===7) return 'Tous les jours';
  const n=['D','L','M','M','J','V','S'], s=[...days].sort((a,b)=>a-b);
  if (s.join(',') === '1,2,3,4,5') return 'Lun–Ven';
  if (s.join(',') === '0,6')       return 'Week-end';
  return s.map(d=>n[d]).join('·');
}
function setMotivational() {
  const el = document.getElementById('header-motivational');
  if (el) el.textContent = motivos[Math.floor(Math.random()*motivos.length)];
}
function updateHeaderDate() {
  const d=new Date(), days=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'],
        months=['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  const el = document.getElementById('header-date');
  if (el) el.textContent = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}
function escHtml(str) {
  const d=document.createElement('div'); d.appendChild(document.createTextNode(str)); return d.innerHTML;
}
function showToast(icon, msg) {
  const t=document.getElementById('toast'), ti=document.getElementById('toast-icon'), tm=document.getElementById('toast-msg');
  ti.textContent=icon; tm.textContent=msg;
  t.classList.remove('hidden'); t.classList.add('show');
  clearTimeout(t._t);
  t._t=setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.classList.add('hidden'),350); },2400);
}
function setupInputCounters() {
  const ti=document.getElementById('input-title'), di=document.getElementById('input-desc');
  ti.addEventListener('input', updateCharCounts); di.addEventListener('input', updateCharCounts);
  ti.addEventListener('keydown', e=>{ if(e.key==='Enter') saveTask(); if(e.key==='Escape') closeModal(); });
}
function updateCharCounts() {
  document.getElementById('title-count').textContent = `${document.getElementById('input-title').value.length}/60`;
  document.getElementById('desc-count').textContent  = `${document.getElementById('input-desc').value.length}/200`;
}
