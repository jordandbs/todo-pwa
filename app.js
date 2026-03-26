/* ===========================
   TODO PWA â app.js v2
   - CRUD complet
   - CochÃ© = barrÃ© (pas supprimÃ© immÃ©diatement)
   - Ã minuit : suppression auto des tÃ¢ches cochÃ©es non-rÃ©currentes
   - RÃ©currence par jours de la semaine
     â tÃ¢che rÃ©currente cochÃ©e : rÃ©apparaÃ®t le prochain jour prÃ©vu
     â suppression rÃ©currente : popup â "aujourd'hui seulement" OU "pour toujours"
=========================== */

// âââ STATE âââââââââââââââââââââââââââââââââââââââââââââââ
let tasks = [];
let currentFilter = 'all';
let editingId = null;
let selectedPrio = 'normal';
let recurrenceActive = false;
let selectedDays = []; // [0..6] dimanche=0, lundi=1, ...
let pendingDeleteId = null; // id en attente dans la popup

// âââ INIT âââââââââââââââââââââââââââââââââââââââââââââââââ
document.addEventListener('DOMContentLoaded', () => {
  loadTasks();
  checkRecurringRespawn();   // rÃ©apparition des tÃ¢ches rÃ©currentes
  checkMidnightCleanup();    // suppression des cochÃ©es de la veille
  renderAll();
  updateHeaderDate();
  scheduleAutoCleanup();
  setupInputCounters();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// âââ STORAGE ââââââââââââââââââââââââââââââââââââââââââââââ
function loadTasks() {
  try {
    const raw = localStorage.getItem('todo_tasks_v3');
    tasks = raw ? JSON.parse(raw) : [];
  } catch { tasks = []; }
}

function saveTasks() {
  localStorage.setItem('todo_tasks_v3', JSON.stringify(tasks));
}

// âââ CRUD âââââââââââââââââââââââââââââââââââââââââââââââââ
function addTask(title, desc, prio, recurDays) {
  const task = {
    id: Date.now().toString(),
    title: title.trim(),
    desc: desc.trim(),
    prio: prio || 'normal',
    done: false,
    createdAt: Date.now(),
    doneAt: null,
    // RÃ©currence
    recurDays: recurDays || [],        // ex: [1,3,5] pour lun/mer/ven
    lastRespawnDate: null,             // date ISO du dernier respawn (Ã©vite les doublons)
  };
  tasks.unshift(task);
  saveTasks();
  return task;
}

function updateTask(id, title, desc, prio, recurDays) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.title = title.trim();
  task.desc = desc.trim();
  task.prio = prio || task.prio;
  task.recurDays = recurDays || [];
  // Si on a retirÃ© tous les jours, on dÃ©sactive la rÃ©currence
  if (task.recurDays.length === 0) task.lastRespawnDate = null;
  saveTasks();
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.done = !task.done;
  task.doneAt = task.done ? Date.now() : null;
  saveTasks();
  renderAll();
  if (task.done) showToast('TÃ¢che marquÃ©e comme faite â');
}

// Demande confirmation si rÃ©currente
function requestDelete(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  if (task.recurDays && task.recurDays.length > 0) {
    // Affiche la popup
    pendingDeleteId = id;
    document.getElementById('delete-popup-overlay').classList.remove('hidden');
  } else {
    // Suppression directe
    confirmDelete(id);
  }
}

function confirmDelete(id) {
  const el = document.querySelector(`.task-item[data-id="${id}"]`);
  if (el) {
    el.classList.add('deleting');
    setTimeout(() => {
      tasks = tasks.filter(t => t.id !== id);
      saveTasks();
      renderAll();
    }, 380);
  } else {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    renderAll();
  }
  showToast('TÃ¢che supprimÃ©e');
}

// Popup : supprimer seulement aujourd'hui (la tÃ¢che reviendra)
function deleteOccurrenceOnly() {
  if (!pendingDeleteId) return;
  const task = tasks.find(t => t.id === pendingDeleteId);
  if (task) {
    // On marque comme cochÃ©e aujourd'hui â le cleanup de minuit la supprimera
    // mais le respawn la recrÃ©e au prochain jour prÃ©vu
    task.done = true;
    task.doneAt = Date.now();
    // On enregistre la date d'aujourd'hui pour Ã©viter double respawn
    task.lastRespawnDate = todayISO();
    saveTasks();
    renderAll();
    showToast('Elle reviendra le prochain jour prÃ©vu ð');
  }
  closeDeletePopup();
}

// Popup : supprimer pour toujours (rÃ©currence incluse)
function deleteForever() {
  if (!pendingDeleteId) return;
  confirmDelete(pendingDeleteId);
  closeDeletePopup();
}

function closeDeletePopup() {
  document.getElementById('delete-popup-overlay').classList.add('hidden');
  pendingDeleteId = null;
}

// âââ RÃCURRENCE : RESPAWN âââââââââââââââââââââââââââââââââ
// AppelÃ© au dÃ©marrage + Ã  chaque nouveau jour
function checkRecurringRespawn() {
  const today = new Date();
  const todayDay = today.getDay(); // 0=dim, 1=lun, ...
  const iso = todayISO();

  tasks.forEach(task => {
    if (!task.recurDays || task.recurDays.length === 0) return;
    // DÃ©jÃ  respawnÃ© aujourd'hui ?
    if (task.lastRespawnDate === iso) return;
    // Aujourd'hui est-il un jour prÃ©vu ?
    if (task.recurDays.includes(todayDay)) {
      // RÃ©initialise la tÃ¢che pour aujourd'hui
      task.done = false;
      task.doneAt = null;
      task.lastRespawnDate = iso;
    }
  });

  saveTasks();
}

// âââ AUTO CLEANUP (minuit) âââââââââââââââââââââââââââââââââ
function checkMidnightCleanup() {
  const lastClean = localStorage.getItem('todo_last_cleanup_v2');
  const today = new Date().toDateString();
  if (lastClean === today) return;

  const before = tasks.length;
  tasks = tasks.filter(t => {
    if (!t.done) return true;
    // TÃ¢che rÃ©currente cochÃ©e â on la garde (elle sera respawn au bon jour)
    if (t.recurDays && t.recurDays.length > 0) return true;
    // TÃ¢che normale cochÃ©e avant aujourd'hui â supprimÃ©e
    const doneDate = new Date(t.doneAt || 0).toDateString();
    return doneDate === today;
  });

  if (tasks.length < before) saveTasks();
  localStorage.setItem('todo_last_cleanup_v2', today);
}

function scheduleAutoCleanup() {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight - now;

  setTimeout(() => {
    doMidnightCleanup();
    setInterval(doMidnightCleanup, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

function doMidnightCleanup() {
  // 1. Supprimer les tÃ¢ches cochÃ©es non-rÃ©currentes
  const before = tasks.length;
  tasks = tasks.filter(t => {
    if (!t.done) return true;
    if (t.recurDays && t.recurDays.length > 0) return true;
    return false;
  });
  const removed = before - tasks.length;

  // 2. Respawn des tÃ¢ches rÃ©currentes pour le nouveau jour
  checkRecurringRespawn();

  saveTasks();
  renderAll();
  if (removed > 0) showToast(`${removed} tÃ¢che(s) supprimÃ©es ð`);
  localStorage.setItem('todo_last_cleanup_v2', new Date().toDateString());
}

// âââ RENDER âââââââââââââââââââââââââââââââââââââââââââââââ
function renderAll() {
  renderTasks();
  renderStats();
  renderWidget();
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
  const list = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');
  const filtered = getFilteredTasks();

  list.innerHTML = '';

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    filtered.forEach(task => list.appendChild(createTaskEl(task)));
  }
}

function createTaskEl(task) {
  const li = document.createElement('li');
  const isRecurring = task.recurDays && task.recurDays.length > 0;
  li.className = `task-item${task.done ? ' done' : ''}${isRecurring ? ' recurring' : ''}`;
  li.dataset.id = task.id;
  li.dataset.prio = task.prio;

  const time = formatTime(task.createdAt);
  const prioBadge = task.prio !== 'normal'
    ? `<span class="prio-badge ${task.prio}">${task.prio === 'high' ? 'Haute' : 'Urgente'}</span>`
    : '';

  const recurBadge = isRecurring
    ? `<span class="recur-badge">ð ${formatRecurDays(task.recurDays)}</span>`
    : '';

  li.innerHTML = `
    <div class="task-check ${task.done ? 'checked' : ''}"
         onclick="toggleTask('${task.id}'); event.stopPropagation();"></div>
    <div class="task-content">
      <div class="task-title">${escHtml(task.title)}</div>
      ${task.desc ? `<div class="task-desc">${escHtml(task.desc)}</div>` : ''}
      <div class="task-meta">
        <span class="task-time">${time}</span>
        ${prioBadge}
        ${recurBadge}
      </div>
    </div>
    <div class="task-actions">
      <button class="task-action-btn edit"
              onclick="openEditModal('${task.id}'); event.stopPropagation();" title="Modifier">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="task-action-btn delete"
              onclick="requestDelete('${task.id}'); event.stopPropagation();" title="Supprimer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
        </svg>
      </button>
    </div>
  `;
  return li;
}

function renderStats() {
  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;
  const pending = total - done;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-done').textContent = done;
  document.getElementById('stat-pending').textContent = pending;
}

// âââ WIDGET âââââââââââââââââââââââââââââââââââââââââââââââ
function renderWidget() {
  const list = document.getElementById('widget-list');
  const count = document.getElementById('widget-count');
  const pending = tasks.filter(t => !t.done);
  count.textContent = pending.length;

  list.innerHTML = '';
  tasks.slice(0, 5).forEach(task => {
    const li = document.createElement('li');
    li.className = `widget-item${task.done ? ' done' : ''}`;
    const colors = { normal: 'var(--normal)', high: 'var(--high)', urgent: 'var(--urgent)' };
    const dotColor = (task.recurDays && task.recurDays.length > 0)
      ? 'var(--recur)'
      : (colors[task.prio] || 'var(--normal)');
    li.innerHTML = `
      <span class="widget-dot" style="background:${dotColor}"></span>
      <span class="widget-item-text">${escHtml(task.title)}</span>
    `;
    list.appendChild(li);
  });
}

function switchView(view) {
  const appView = document.getElementById('app-view');
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

// âââ MODAL ââââââââââââââââââââââââââââââââââââââââââââââââ
function openModal() {
  editingId = null;
  selectedPrio = 'normal';
  recurrenceActive = false;
  selectedDays = [];
  document.getElementById('modal-title').textContent = 'Nouvelle tÃ¢che';
  document.getElementById('btn-save').textContent = 'Ajouter';
  document.getElementById('input-title').value = '';
  document.getElementById('input-desc').value = '';
  updatePrioButtons('normal');
  resetRecurrenceUI();
  updateCharCounts();
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('input-title').focus(), 300);
}

function openEditModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingId = id;
  selectedPrio = task.prio;
  selectedDays = [...(task.recurDays || [])];
  recurrenceActive = selectedDays.length > 0;

  document.getElementById('modal-title').textContent = 'Modifier la tÃ¢che';
  document.getElementById('btn-save').textContent = 'Enregistrer';
  document.getElementById('input-title').value = task.title;
  document.getElementById('input-desc').value = task.desc;
  updatePrioButtons(task.prio);
  resetRecurrenceUI();

  if (recurrenceActive) {
    const btn = document.getElementById('toggle-recurrence');
    btn.classList.add('active');
    document.getElementById('recurrence-toggle-label').textContent = 'ActivÃ©e';
    document.getElementById('recurrence-panel').classList.remove('hidden');
    // Cocher les bons jours
    document.querySelectorAll('.day-btn').forEach(b => {
      const day = parseInt(b.dataset.day);
      b.classList.toggle('active', selectedDays.includes(day));
    });
  }

  updateCharCounts();
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('input-title').focus(), 300);
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
  const desc = document.getElementById('input-desc').value.trim();

  if (!title) {
    document.getElementById('input-title').style.borderColor = 'var(--urgent)';
    document.getElementById('input-title').focus();
    setTimeout(() => document.getElementById('input-title').style.borderColor = '', 1200);
    return;
  }

  const recurDays = recurrenceActive ? [...selectedDays] : [];

  if (editingId) {
    updateTask(editingId, title, desc, selectedPrio, recurDays);
    showToast('TÃ¢che modifiÃ©e â');
  } else {
    addTask(title, desc, selectedPrio, recurDays);
    showToast(recurDays.length > 0 ? 'TÃ¢che rÃ©currente ajoutÃ©e ð' : 'TÃ¢che ajoutÃ©e â');
  }

  closeModal();
  renderAll();
}

// âââ RÃCURRENCE UI ââââââââââââââââââââââââââââââââââââââââ
function toggleRecurrence() {
  recurrenceActive = !recurrenceActive;
  const btn = document.getElementById('toggle-recurrence');
  const panel = document.getElementById('recurrence-panel');
  const label = document.getElementById('recurrence-toggle-label');

  btn.classList.toggle('active', recurrenceActive);
  label.textContent = recurrenceActive ? 'ActivÃ©e' : 'DÃ©sactivÃ©e';
  panel.classList.toggle('hidden', !recurrenceActive);

  if (!recurrenceActive) {
    selectedDays = [];
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
  }
}

function toggleDay(day, btn) {
  const idx = selectedDays.indexOf(day);
  if (idx === -1) {
    selectedDays.push(day);
    btn.classList.add('active');
  } else {
    selectedDays.splice(idx, 1);
    btn.classList.remove('active');
  }
}

function selectQuickDays(preset) {
  let days;
  if (preset === 'week')      days = [0,1,2,3,4,5,6];
  if (preset === 'workdays')  days = [1,2,3,4,5];
  if (preset === 'weekend')   days = [0,6];

  selectedDays = days;
  document.querySelectorAll('.day-btn').forEach(b => {
    const d = parseInt(b.dataset.day);
    b.classList.toggle('active', days.includes(d));
  });
}

function resetRecurrenceUI() {
  recurrenceActive = false;
  selectedDays = [];
  const btn = document.getElementById('toggle-recurrence');
  btn.classList.remove('active');
  document.getElementById('recurrence-toggle-label').textContent = 'DÃ©sactivÃ©e';
  document.getElementById('recurrence-panel').classList.add('hidden');
  document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
}

// âââ PRIORITY âââââââââââââââââââââââââââââââââââââââââââââ
function selectPrio(prio, btn) {
  selectedPrio = prio;
  updatePrioButtons(prio);
}

function updatePrioButtons(prio) {
  document.querySelectorAll('.prio-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.prio === prio);
  });
}

// âââ FILTER âââââââââââââââââââââââââââââââââââââââââââââââ
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderTasks();
}

// âââ UTILS ââââââââââââââââââââââââââââââââââââââââââââââââ
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatRecurDays(days) {
  if (!days || days.length === 0) return '';
  if (days.length === 7) return 'tous les jours';
  const names = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  // Trier par jour de semaine
  const sorted = [...days].sort((a,b) => a-b);
  if (sorted.join(',') === '1,2,3,4,5') return 'LunâVen';
  if (sorted.join(',') === '0,6') return 'Week-end';
  return sorted.map(d => names[d]).join(', ');
}

function updateHeaderDate() {
  const d = new Date();
  const days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const months = ['Jan','FÃ©v','Mar','Avr','Mai','Juin','Juil','AoÃ»t','Sep','Oct','Nov','DÃ©c'];
  document.getElementById('header-date').textContent =
    `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.classList.add('hidden'), 350);
  }, 2400);
}

function setupInputCounters() {
  const titleInput = document.getElementById('input-title');
  const descInput = document.getElementById('input-desc');
  titleInput.addEventListener('input', updateCharCounts);
  descInput.addEventListener('input', updateCharCounts);
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveTask();
    if (e.key === 'Escape') closeModal();
  });
}

function updateCharCounts() {
  const t = document.getElementById('input-title').value.length;
  const d = document.getElementById('input-desc').value.length;
  document.getElementById('title-count').textContent = `${t}/60`;
  document.getElementById('desc-count').textContent = `${d}/200`;
}
