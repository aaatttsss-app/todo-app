// ===== データモデル =====

const STORAGE_KEY = 'todoApp';
const SETTINGS_KEY = 'todoSettings';
const WEEKDAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];

// 展開状態（メモリのみ、リロードでリセット）
var expandedIds = new Set();

// 削除Undoスタック（最大5件、削除前のtasks配列のスナップショットを保持）
var deleteHistory = [];

const CATEGORIES = {
  today:       { label: '本日' },
  tomorrow:    { label: '明日' },
  soon:        { label: '近日' },
  someday:     { label: 'そのうち' },
  unprocessed: { label: '未処理' },
  done:        { label: '処理済み' }
};

// ===== モード（仕事/プライベート/その他 の区分） =====

const SPACES = {
  work:    { label: '仕事',       icon: '💼' },
  private: { label: 'プライベート', icon: '🏠' },
  other:   { label: 'その他',     icon: '📦' }
};
const MODE_KEY = 'todoMode';

// 表示中モード。'work' | 'private' | 'other' | 'all'（初期値は全部）
var currentMode = 'all';

// タスクが現在のモードで表示対象か（モードは表示だけの概念。日付フロー等は全区分対象）
function isTaskVisibleInMode(task) {
  return currentMode === 'all' || (task.space || 'other') === currentMode;
}

// --- データ操作 ---

function generateId() {
  return 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function createTask(text, category) {
  return {
    id: generateId(),
    text: text,
    category: category,
    order: 0,
    completed: false,
    completedDate: null,
    parentId: null,
    children: [],
    createdAt: new Date().toISOString(),
    flags: { will: false, can: false, must: false },
    space: 'other'
  };
}

// 既存タスクに space が無ければ「その他」を割り当てる（読込時の一括migration）
function migrateSpaces(data) {
  (data.tasks || []).forEach(function(t) {
    if (!t.space) t.space = 'other';
  });
}

// 既存タスクの flags が未定義でも安全にアクセスできるようにする
function getFlag(task, key) {
  return !!(task.flags && task.flags[key]);
}

function toggleFlag(data, id, key) {
  var task = findTask(data, id);
  if (!task) return;
  if (!task.flags) task.flags = { will: false, can: false, must: false };
  task.flags[key] = !task.flags[key];
  saveData(data);
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var data = JSON.parse(raw);
      migrateSpaces(data);
      return data;
    }
  } catch (e) {
    // データ破損時はリセット
  }
  return {
    lastProcessedDate: todayString(),
    tasks: []
  };
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function formatLocalDate(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function todayString() {
  return formatLocalDate(new Date());
}

// ===== 詳細設定（曜日スキップなど） =====

function loadSettings() {
  try {
    var raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      var s = JSON.parse(raw);
      if (s && Array.isArray(s.skippedDays)) {
        // 0-6 の整数のみに正規化
        s.skippedDays = s.skippedDays
          .map(function(x) { return parseInt(x, 10); })
          .filter(function(x) { return x >= 0 && x <= 6; });
        return s;
      }
    }
  } catch (e) { /* 破損時は初期値 */ }
  return { skippedDays: [] };
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// 指定日付（Date または 'YYYY-MM-DD' 文字列）がスキップ対象か
function isSkippedDay(date, skippedDays) {
  if (!skippedDays || skippedDays.length === 0) return false;
  if (skippedDays.length >= 7) return false; // 全てスキップは無効化
  var d = (typeof date === 'string') ? new Date(date + 'T00:00:00') : date;
  return skippedDays.indexOf(d.getDay()) !== -1;
}

// 「本日」として表示すべき日付（今日が非スキップなら今日、スキップなら直近過去の非スキップ日）
function getEffectiveToday(skippedDays) {
  var d = new Date();
  for (var i = 0; i < 30; i++) {
    if (!isSkippedDay(d, skippedDays)) return d;
    d.setDate(d.getDate() - 1);
  }
  return new Date();
}

// 「明日」として表示すべき日付（getEffectiveToday の次の非スキップ日）
function getNextWorkingDay(skippedDays) {
  var d = new Date(getEffectiveToday(skippedDays));
  d.setDate(d.getDate() + 1);
  for (var i = 0; i < 30; i++) {
    if (!isSkippedDay(d, skippedDays)) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function formatDayLabel(d) {
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS_JP[d.getDay()] + ')';
}

// --- クエリ ---

function getParentTasks(data, category) {
  return data.tasks
    .filter(function(t) { return t.parentId === null && t.category === category; })
    .sort(function(a, b) { return a.order - b.order; });
}

function findTask(data, id) {
  return data.tasks.find(function(t) { return t.id === id; });
}

function getNextOrder(data, category) {
  var parents = getParentTasks(data, category);
  if (parents.length === 0) return 0;
  return parents[parents.length - 1].order + 1;
}

// --- 変更操作 ---

function toggleComplete(data, id) {
  var task = findTask(data, id);
  if (!task) return;
  task.completed = !task.completed;
  task.completedDate = task.completed ? todayString() : null;
  saveData(data);
}

function renameTask(data, id, newText) {
  var task = findTask(data, id);
  if (!task || !newText.trim()) return;
  task.text = newText.trim();
  saveData(data);
}

function addTask(data, text, category) {
  var task = createTask(text, category);
  // 特定モード中はそのモードの区分で作成（全部モード中は「その他」）
  task.space = (currentMode !== 'all' && SPACES[currentMode]) ? currentMode : 'other';
  task.order = getNextOrder(data, category);
  data.tasks.push(task);
  saveData(data);
  return task;
}

function addChildTask(data, text, parentId) {
  var parent = findTask(data, parentId);
  if (!parent) return;
  var child = createTask(text, parent.category);
  child.space = parent.space || 'other';
  child.parentId = parentId;
  child.order = parent.children.length;
  data.tasks.push(child);
  parent.children.push(child.id);
  saveData(data);
  return child;
}

function deleteTask(data, id) {
  var task = findTask(data, id);
  if (!task) return;

  // 削除前のスナップショットを保存（最大5件）
  deleteHistory.push(JSON.stringify(data.tasks));
  if (deleteHistory.length > 5) deleteHistory.shift();

  // 子タスクも削除（再帰。スナップショットは最初の1回だけ取るのでここはシンプルに）
  function removeRecursive(tid) {
    var t = findTask(data, tid);
    if (!t) return;
    t.children.forEach(function(cid) { removeRecursive(cid); });
    data.tasks = data.tasks.filter(function(x) { return x.id !== tid; });
  }

  // 親から参照を除去
  if (task.parentId) {
    var parent = findTask(data, task.parentId);
    if (parent) {
      parent.children = parent.children.filter(function(cid) { return cid !== id; });
    }
  }

  removeRecursive(id);
  saveData(data);
}

function undoDelete(data) {
  if (deleteHistory.length === 0) return;
  data.tasks = JSON.parse(deleteHistory.pop());
  saveData(data);
  renderAll(data);
}

// ===== 日付変更処理 =====

function moveParentToCategory(data, task, newCategory) {
  // 移動先での order を末尾に設定
  task.order = getNextOrder(data, newCategory);
  task.category = newCategory;

  // 子タスクも同じカテゴリに同期
  task.children.forEach(function(childId) {
    var child = findTask(data, childId);
    if (child) {
      child.category = newCategory;
    }
  });
}

// ===== カテゴリ移動（ボタン操作：タッチ端末でのD&D代替） =====

// 親タスクを別カテゴリへ移動（末尾に入る）。子タスクも同期。
function moveTaskToCategory(data, taskId, newCategory) {
  var task = findTask(data, taskId);
  if (!task || task.parentId !== null) return;
  if (task.category === newCategory) return;
  moveParentToCategory(data, task, newCategory);
  saveData(data);
  renderAll(data);
}

// タスクの区分（仕事/プライベート/その他）を変更。子タスクも同期。
function setTaskSpace(data, taskId, space) {
  var task = findTask(data, taskId);
  if (!task || !SPACES[space]) return;
  task.space = space;
  (task.children || []).forEach(function(cid) {
    var child = findTask(data, cid);
    if (child) child.space = space;
  });
  saveData(data);
  renderAll(data);
}

function processOneDay(data) {
  // 親タスクのみが対象
  var parents = data.tasks.filter(function(t) { return t.parentId === null; });

  parents.forEach(function(task) {
    if (task.category === 'today') {
      if (task.completed) {
        // 本日の完了済み → 処理済み
        moveParentToCategory(data, task, 'done');
      } else {
        // 本日の未完了 → 未処理
        moveParentToCategory(data, task, 'unprocessed');
      }
    } else if (task.category === 'tomorrow') {
      // 明日 → 本日
      moveParentToCategory(data, task, 'today');
    }
    // 近日・そのうち・未処理・処理済みは移動しない
  });
}

function processDateChange(data) {
  var settings = loadSettings();
  var today = todayString();

  // 初回起動時は処理不要
  if (!data.lastProcessedDate) {
    data.lastProcessedDate = today;
    saveData(data);
    return;
  }

  // 今日がスキップ曜日なら、ロールオーバーせず lastProcessedDate も更新しない
  // （次の非スキップ日に開いたとき、まとめて処理する）
  if (isSkippedDay(today, settings.skippedDays)) return;

  // 日付差分を計算
  var lastDate = new Date(data.lastProcessedDate + 'T00:00:00');
  var todayDate = new Date(today + 'T00:00:00');
  var diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return;

  // lastProcessedDate+1 〜 today（含む）の範囲で、非スキップ日の数だけ processOneDay する
  var processCount = 0;
  var d = new Date(lastDate);
  for (var i = 0; i < diffDays; i++) {
    d.setDate(d.getDate() + 1);
    if (!isSkippedDay(d, settings.skippedDays)) processCount++;
  }

  for (var j = 0; j < processCount; j++) {
    processOneDay(data);
  }

  data.lastProcessedDate = today;
  saveData(data);
}

// ===== 描画 =====

// Will / Can / Must フラグボタン群（子タスク展開時のメタ行で使用）
var FLAG_DEFS = [
  { key: 'will', label: 'W', title: 'Will（やりたい）' },
  { key: 'can',  label: 'C', title: 'Can（できる）' },
  { key: 'must', label: 'M', title: 'Must（必須）' }
];

function buildFlagsGroup(data, task) {
  var flagsGroup = document.createElement('div');
  flagsGroup.className = 'task-flags';
  FLAG_DEFS.forEach(function(ft) {
    var fbtn = document.createElement('button');
    var on = getFlag(task, ft.key);
    fbtn.className = 'task-flag-btn task-flag-btn--' + ft.key + (on ? ' task-flag-btn--on' : '');
    fbtn.textContent = ft.label;
    fbtn.title = ft.title;
    fbtn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleFlag(data, task.id, ft.key);
      renderAll(data);
    });
    // ボタン自体はドラッグの起点にしない
    fbtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    flagsGroup.appendChild(fbtn);
  });
  return flagsGroup;
}

function buildParentTaskEl(data, task) {
  var wrapper = document.createElement('div');
  wrapper.className = 'task-wrapper';
  wrapper.setAttribute('data-id', task.id);

  // --- 横並びの行コンテナ（task-item + 展開ボタン） ---
  var taskRow = document.createElement('div');
  taskRow.className = 'task-row';

  // --- 親タスク本体（チェック・テキスト・削除） ---
  var item = document.createElement('div');
  item.className = 'task-item' + (task.completed ? ' task-item--completed' : '');
  item.dataset.taskId = task.id;

  // 左：完了チェックボックス
  var checkbox = document.createElement('button');
  checkbox.className = 'task-check-btn' + (task.completed ? ' task-check-btn--checked' : '');
  checkbox.title = task.completed ? '未完了に戻す' : '完了にする';
  checkbox.addEventListener('click', function() {
    toggleComplete(data, task.id);
    renderAll(data);
  });

  // 中央：タスク名（ダブルクリックで編集）
  var textSpan = document.createElement('span');
  textSpan.className = 'task-text';
  textSpan.textContent = task.text;
  textSpan.title = 'ダブルクリックで編集';
  textSpan.addEventListener('dblclick', function() {
    startInlineEdit(data, task, textSpan, item);
  });

  // 右：削除ボタン（task-item の右端）
  var deleteBtn = document.createElement('button');
  deleteBtn.className = 'task-delete-btn';
  deleteBtn.textContent = '×';
  deleteBtn.title = '削除';
  deleteBtn.addEventListener('click', function() {
    expandedIds.delete(task.id);
    deleteTask(data, task.id);
    renderAll(data);
  });

  item.appendChild(checkbox);

  // 全部モードでは区分（仕事/プライベート/その他）を色ドットで表示
  if (currentMode === 'all') {
    var spaceKey = SPACES[task.space] ? task.space : 'other';
    var spaceDot = document.createElement('span');
    spaceDot.className = 'task-space-dot task-space-dot--' + spaceKey;
    spaceDot.title = SPACES[spaceKey].label;
    item.appendChild(spaceDot);
  }

  item.appendChild(textSpan);

  // 日付表示（未処理・処理済みのみ）
  if (task.category === 'unprocessed' || task.category === 'done') {
    var dateSpan = document.createElement('span');
    dateSpan.className = 'task-date';
    var dateStr = '';
    if (task.category === 'done' && task.completedDate) {
      dateStr = task.completedDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3');
    } else if (task.category === 'unprocessed' && task.createdAt) {
      var d = new Date(task.createdAt);
      dateStr = ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2);
    }
    dateSpan.textContent = dateStr;
    item.appendChild(dateSpan);
  }

  // Will/Can/Must（PC版は行内に常時表示。スマホ版はCSSで隠し、展開時のメタ行にのみ表示）
  item.appendChild(buildFlagsGroup(data, task));

  item.appendChild(deleteBtn);

  // 右外：展開ボタン（task-item の外、task-row 内の右端）
  var isExpanded = expandedIds.has(task.id);
  var expandBtn = document.createElement('button');
  expandBtn.className = 'task-expand-btn' + (isExpanded ? ' task-expand-btn--open' : '');
  expandBtn.title = isExpanded ? '折りたたむ' : '子タスクを展開';
  expandBtn.addEventListener('click', function() {
    if (expandedIds.has(task.id)) {
      expandedIds.delete(task.id);
    } else {
      expandedIds.add(task.id);
    }
    renderAll(data);
  });

  // 右外：移動ボタン（タッチ端末でのD&D代替。常時表示）
  var moveBtn = document.createElement('button');
  moveBtn.className = 'task-move-btn';
  moveBtn.textContent = '⋮';
  moveBtn.title = '移動先を選ぶ';
  moveBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    openMoveMenu(data, task, moveBtn);
  });
  // ボタンからドラッグが始まらないようにする
  moveBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });

  taskRow.appendChild(item);
  taskRow.appendChild(moveBtn);
  taskRow.appendChild(expandBtn);
  wrapper.appendChild(taskRow);

  // ドラッグ設定
  setupDragOnWrapper(data, wrapper, task);

  // --- 子タスクセクション（task-row の下） ---
  if (isExpanded) {
    var childSection = buildChildSection(data, task);
    wrapper.appendChild(childSection);
  }

  return wrapper;
}

function buildChildSection(data, parentTask) {
  var section = document.createElement('div');
  section.className = 'children-section';

  // メタ行（親タスクのW/C/M・区分。子タスク展開時のみ・子タスク一覧の一つ上に表示）
  var metaRow = document.createElement('div');
  metaRow.className = 'child-meta-row';
  metaRow.appendChild(buildFlagsGroup(data, parentTask));

  var spaceKey = SPACES[parentTask.space] ? parentTask.space : 'other';
  var spaceBadge = document.createElement('button');
  spaceBadge.type = 'button';
  spaceBadge.className = 'child-meta-space child-meta-space--' + spaceKey;
  spaceBadge.textContent = SPACES[spaceKey].icon + ' ' + SPACES[spaceKey].label;
  spaceBadge.title = 'タップして区分を変更';
  spaceBadge.addEventListener('click', function(e) {
    e.stopPropagation();
    openSpaceMenu(data, parentTask, spaceBadge);
  });
  spaceBadge.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  metaRow.appendChild(spaceBadge);

  section.appendChild(metaRow);

  // 子タスク一覧
  var childList = document.createElement('div');
  childList.className = 'child-list';

  parentTask.children.forEach(function(childId) {
    var child = findTask(data, childId);
    if (!child) return;
    childList.appendChild(buildChildTaskEl(data, child, parentTask));
  });

  // 子タスクのドロップ受け取り
  childList.addEventListener('dragover', function(e) {
    if (dragState.sourceCategory !== 'child') return;
    if (dragState.parentId !== parentTask.id) return;
    e.preventDefault();
    e.stopPropagation();
    var targetItem = e.target.closest('.task-item--child');
    clearDropIndicators();
    if (targetItem) {
      var rect = targetItem.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        targetItem.classList.add('drop-above');
      } else {
        targetItem.classList.add('drop-below');
      }
    }
  });

  childList.addEventListener('drop', function(e) {
    if (dragState.sourceCategory !== 'child') return;
    if (dragState.parentId !== parentTask.id) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicators();

    var draggedId = dragState.taskId;
    if (!draggedId) return;

    var targetItem = e.target.closest('.task-item--child');
    var targetId = targetItem ? targetItem.dataset.taskId : null;

    // parentTask.children の並び順を更新
    var children = parentTask.children.filter(function(id) { return id !== draggedId; });
    if (targetId && targetId !== draggedId) {
      var idx = children.indexOf(targetId);
      if (idx >= 0) {
        var rect = targetItem.getBoundingClientRect();
        var insertAt = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
        children.splice(insertAt, 0, draggedId);
      } else {
        children.push(draggedId);
      }
    } else {
      children.push(draggedId);
    }
    parentTask.children = children;

    // order も振り直す
    children.forEach(function(id, i) {
      var t = findTask(data, id);
      if (t) t.order = i;
    });

    saveData(data);
    expandedIds.add(parentTask.id);
    renderAll(data);
  });

  // 子タスク追加UI
  var addRow = document.createElement('div');
  addRow.className = 'child-add';

  var childInput = document.createElement('input');
  childInput.type = 'text';
  childInput.className = 'task-input child-input';
  childInput.placeholder = '子タスクを追加…';

  var childAddBtn = document.createElement('button');
  childAddBtn.className = 'task-add-btn';
  childAddBtn.textContent = '追加';

  function handleChildAdd() {
    var text = childInput.value.trim();
    if (!text) return;
    addChildTask(data, text, parentTask.id);
    expandedIds.add(parentTask.id);
    renderAll(data);
    setTimeout(function() {
      var wrapper = document.querySelector('.task-wrapper[data-id="' + parentTask.id + '"]');
      if (wrapper) {
        var input = wrapper.querySelector('.child-input');
        if (input) { input.value = ''; input.focus(); }
      }
    }, 0);
  }

  childAddBtn.addEventListener('click', handleChildAdd);
  childInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.isComposing) handleChildAdd();
  });

  addRow.appendChild(childInput);
  addRow.appendChild(childAddBtn);

  section.appendChild(childList);
  section.appendChild(addRow);
  return section;
}

function buildChildTaskEl(data, child, parentTask) {
  var item = document.createElement('div');
  item.className = 'task-item task-item--child' + (child.completed ? ' task-item--completed' : '');
  item.dataset.taskId = child.id;
  item.draggable = true;

  // 子タスクのドラッグ
  item.addEventListener('dragstart', function(e) {
    e.stopPropagation(); // 親wrapperのdragstartを発火させない
    dragState.taskId = child.id;
    dragState.sourceCategory = 'child';
    dragState.parentId = parentTask.id;
    item.classList.add('task-wrapper--dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', child.id);
  });

  item.addEventListener('dragend', function() {
    item.classList.remove('task-wrapper--dragging');
    dragState.taskId = null;
    dragState.sourceCategory = null;
    dragState.parentId = null;
    clearDropIndicators();
  });

  var checkbox = document.createElement('button');
  checkbox.className = 'task-check-btn' + (child.completed ? ' task-check-btn--checked' : '');
  checkbox.title = child.completed ? '未完了に戻す' : '完了にする';
  checkbox.addEventListener('click', function() {
    toggleComplete(data, child.id);
    renderAll(data);
  });

  var textSpan = document.createElement('span');
  textSpan.className = 'task-text';
  textSpan.textContent = child.text;
  textSpan.title = 'ダブルクリックで編集';
  textSpan.addEventListener('dblclick', function() {
    startInlineEdit(data, child, textSpan, item);
  });

  var deleteBtn = document.createElement('button');
  deleteBtn.className = 'task-delete-btn';
  deleteBtn.textContent = '×';
  deleteBtn.title = '削除';
  deleteBtn.addEventListener('click', function() {
    deleteTask(data, child.id);
    renderAll(data);
  });

  item.appendChild(checkbox);
  item.appendChild(textSpan);
  item.appendChild(deleteBtn);
  return item;
}

function startInlineEdit(data, task, textSpan, item) {
  if (item.querySelector('.task-edit-input')) return; // 二重起動防止

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-edit-input';
  input.value = task.text;

  textSpan.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    var newText = input.value.trim();
    if (newText) {
      renameTask(data, task.id, newText);
    }
    renderAll(data);
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.isComposing) { commit(); }
    if (e.key === 'Escape') { renderAll(data); }
  });
  input.addEventListener('blur', commit);
}

function renderAll(data) {
  Object.keys(CATEGORIES).forEach(function(catKey) {
    var section = document.querySelector('[data-category="' + catKey + '"]');
    if (!section) return;
    var listEl = section.querySelector('.task-list');
    listEl.innerHTML = '';

    // 現在のモードで表示対象のタスクだけ描画（データ自体は全区分保持）
    var parents = getParentTasks(data, catKey).filter(isTaskVisibleInMode);
    parents.forEach(function(task) {
      listEl.appendChild(buildParentTaskEl(data, task));
    });
  });
}

// ===== ドラッグ&ドロップ =====

var dragState = {
  taskId: null,
  sourceCategory: null,
  parentId: null
};

function setupDragOnWrapper(data, wrapper, task) {
  wrapper.draggable = true;

  wrapper.addEventListener('dragstart', function(e) {
    dragState.taskId = task.id;
    dragState.sourceCategory = task.category;
    wrapper.classList.add('task-wrapper--dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
  });

  wrapper.addEventListener('dragend', function() {
    wrapper.classList.remove('task-wrapper--dragging');
    dragState.taskId = null;
    dragState.sourceCategory = null;
    clearDropIndicators();
  });
}

// ドロップ位置のインジケータ表示（マウスD&D・タッチドラッグ共通）
function showDropIndicator(listEl, targetWrapper, clientY) {
  clearDropIndicators();
  if (targetWrapper && listEl && targetWrapper.closest('.task-list') === listEl) {
    var rect = targetWrapper.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      targetWrapper.classList.add('drop-above');
    } else {
      targetWrapper.classList.add('drop-below');
    }
  } else if (listEl) {
    listEl.classList.add('task-list--drop-target');
  }
}

// ドロップ確定処理（マウスD&D・タッチドラッグ共通）
function performDrop(data, draggedId, listEl, targetWrapper, clientY) {
  var draggedTask = findTask(data, draggedId);
  if (!draggedTask) return;

  var categoryEl = listEl.closest('.category');
  if (!categoryEl) return;
  var targetCategory = categoryEl.dataset.category;

  // ドロップ位置の特定
  var targetTaskId = null;
  var insertBefore = true;
  if (targetWrapper && targetWrapper.closest('.task-list') === listEl) {
    targetTaskId = targetWrapper.querySelector('.task-item').dataset.taskId;
    var rect = targetWrapper.getBoundingClientRect();
    insertBefore = clientY < rect.top + rect.height / 2;
  }

  // カテゴリ変更（子タスクも同期）
  moveParentToCategory(data, draggedTask, targetCategory);

  // 並び順の再計算
  var siblings = getParentTasks(data, targetCategory).filter(function(t) {
    return t.id !== draggedId;
  });

  if (targetTaskId && targetTaskId !== draggedId) {
    var targetIndex = -1;
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i].id === targetTaskId) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex >= 0) {
      var insertAt = insertBefore ? targetIndex : targetIndex + 1;
      siblings.splice(insertAt, 0, draggedTask);
    } else {
      siblings.push(draggedTask);
    }
  } else {
    siblings.push(draggedTask);
  }

  // order を振り直す
  siblings.forEach(function(t, i) {
    t.order = i;
  });

  saveData(data);
  renderAll(data);
}

function setupDropOnTaskLists(data) {
  document.querySelectorAll('.task-list').forEach(function(listEl) {
    listEl.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      showDropIndicator(listEl, getClosestWrapper(e.target), e.clientY);
    });

    listEl.addEventListener('dragleave', function(e) {
      if (!listEl.contains(e.relatedTarget)) {
        clearDropIndicators();
      }
    });

    listEl.addEventListener('drop', function(e) {
      e.preventDefault();
      clearDropIndicators();
      var draggedId = dragState.taskId;
      if (!draggedId) return;
      performDrop(data, draggedId, listEl, getClosestWrapper(e.target), e.clientY);
    });
  });
}

function getClosestWrapper(el) {
  while (el) {
    if (el.classList && el.classList.contains('task-wrapper')) return el;
    if (el.classList && el.classList.contains('task-list')) return null;
    el = el.parentElement;
  }
  return null;
}

function clearDropIndicators() {
  document.querySelectorAll('.drop-above, .drop-below').forEach(function(el) {
    el.classList.remove('drop-above', 'drop-below');
  });
  document.querySelectorAll('.task-list--drop-target').forEach(function(el) {
    el.classList.remove('task-list--drop-target');
  });
}

// ===== 移動メニュー（⋮ボタンから開くポップオーバー） =====

// メニューに並べるカテゴリ順
var MOVE_MENU_ORDER = ['today', 'tomorrow', 'soon', 'someday', 'unprocessed', 'done'];

function closeMoveMenu() {
  var existing = document.querySelector('.move-menu');
  if (existing) existing.remove();
  document.removeEventListener('click', onMoveMenuOutside, true);
  document.removeEventListener('keydown', onMoveMenuKey, true);
  window.removeEventListener('scroll', closeMoveMenu, true);
  window.removeEventListener('resize', closeMoveMenu);
}

function onMoveMenuOutside(e) {
  if (!e.target.closest('.move-menu') &&
      !e.target.closest('.task-move-btn') &&
      !e.target.closest('.header-menu-btn') &&
      !e.target.closest('.child-meta-space')) {
    closeMoveMenu();
  }
}

function onMoveMenuKey(e) {
  if (e.key === 'Escape') closeMoveMenu();
}

function makeMoveMenuItem(label, onClick) {
  var b = document.createElement('button');
  b.className = 'move-menu-item';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function openMoveMenu(data, task, anchorBtn) {
  // 既に同じボタンで開いていればトグルで閉じる
  var already = document.querySelector('.move-menu');
  if (already && already.dataset.forId === task.id) {
    closeMoveMenu();
    return;
  }
  closeMoveMenu();

  var menu = document.createElement('div');
  menu.className = 'move-menu';
  menu.dataset.forId = task.id;

  var lbl = document.createElement('div');
  lbl.className = 'move-menu-label';
  lbl.textContent = '移動先';
  menu.appendChild(lbl);

  // カテゴリ移動（現在のカテゴリは除く）
  MOVE_MENU_ORDER.forEach(function(cat) {
    if (cat === task.category) return;
    var item = makeMoveMenuItem(CATEGORIES[cat].label + ' へ', function() {
      moveTaskToCategory(data, task.id, cat); closeMoveMenu();
    });
    item.classList.add('move-menu-item--cat');
    menu.appendChild(item);
  });

  // 区分（仕事/プライベート/その他）
  var sep = document.createElement('div');
  sep.className = 'move-menu-sep';
  menu.appendChild(sep);

  var spaceLbl = document.createElement('div');
  spaceLbl.className = 'move-menu-label';
  spaceLbl.textContent = '区分';
  menu.appendChild(spaceLbl);

  Object.keys(SPACES).forEach(function(sp) {
    var isCurrent = (SPACES[task.space] ? task.space : 'other') === sp;
    var item = makeMoveMenuItem(
      SPACES[sp].icon + ' ' + SPACES[sp].label + (isCurrent ? ' ✓' : ''),
      function() { setTaskSpace(data, task.id, sp); closeMoveMenu(); }
    );
    if (isCurrent) item.classList.add('move-menu-item--current');
    menu.appendChild(item);
  });

  showMenuAt(menu, anchorBtn);
}

// メニューを body に追加して位置決め・クローズ用リスナ登録（移動メニュー/⋯メニュー共通）
function showMenuAt(menu, anchorBtn) {
  document.body.appendChild(menu);

  // 位置決め（ボタン右下基準。画面外に出る場合は反転・クランプ）
  var r  = anchorBtn.getBoundingClientRect();
  var mw = menu.offsetWidth;
  var mh = menu.offsetHeight;
  var top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) {
    top = Math.max(8, r.top - mh - 6);
  }
  var left = r.right - mw;
  if (left < 8) left = 8;
  menu.style.top  = (top + window.scrollY) + 'px';
  menu.style.left = (left + window.scrollX) + 'px';

  // 直後のこのクリック自身で閉じないよう、次のtickでリスナ登録
  setTimeout(function() {
    document.addEventListener('click', onMoveMenuOutside, true);
    document.addEventListener('keydown', onMoveMenuKey, true);
    window.addEventListener('scroll', closeMoveMenu, true);
    window.addEventListener('resize', closeMoveMenu);
  }, 0);
}

// ===== 区分メニュー（子タスク展開時のメタ行、区分バッジをタップして開く） =====

function openSpaceMenu(data, task, anchorBtn) {
  // 開いていればトグルで閉じる
  var already = document.querySelector('.move-menu');
  if (already && already.dataset.forId === 'space-' + task.id) {
    closeMoveMenu();
    return;
  }
  closeMoveMenu();

  var menu = document.createElement('div');
  menu.className = 'move-menu';
  menu.dataset.forId = 'space-' + task.id;

  Object.keys(SPACES).forEach(function(sp) {
    var isCurrent = (SPACES[task.space] ? task.space : 'other') === sp;
    var item = makeMoveMenuItem(
      SPACES[sp].icon + ' ' + SPACES[sp].label + (isCurrent ? ' ✓' : ''),
      function() { setTaskSpace(data, task.id, sp); closeMoveMenu(); }
    );
    if (isCurrent) item.classList.add('move-menu-item--current');
    menu.appendChild(item);
  });

  showMenuAt(menu, anchorBtn);
}

// ===== ⋯ メニュー（モバイルヘッダー用：共有/取込/保存を集約） =====

function openHeaderMenu(anchorBtn) {
  // 開いていればトグルで閉じる
  var already = document.querySelector('.move-menu');
  if (already && already.dataset.forId === 'headerMenu') {
    closeMoveMenu();
    return;
  }
  closeMoveMenu();

  var menu = document.createElement('div');
  menu.className = 'move-menu';
  menu.dataset.forId = 'headerMenu';

  menu.appendChild(makeMoveMenuItem('📤 共有コードを作る', function() {
    closeMoveMenu(); shareDataAsCode();
  }));
  menu.appendChild(makeMoveMenuItem('📥 データを取り込む', function() {
    closeMoveMenu(); openImportDialog();
  }));
  menu.appendChild(makeMoveMenuItem('💾 JSONファイルで保存', function() {
    closeMoveMenu(); exportData();
  }));

  showMenuAt(menu, anchorBtn);
}

// ===== コピー機能（各カテゴリ共通） =====

function copyCategoryAsText(data, category, btn) {
  var label = CATEGORIES[category] ? CATEGORIES[category].label : category;
  // 表示中モードのタスクだけコピー（見えているものをコピーする）
  var parents = getParentTasks(data, category).filter(isTaskVisibleInMode);
  if (parents.length === 0) {
    alert(label + 'のタスクがありません');
    return;
  }

  var lines = ['【' + label + '】'];
  parents.forEach(function(task) {
    var check = task.completed ? '☑' : '☐';
    lines.push(check + ' ' + task.text);
    // 子タスクを一段下げて追加
    task.children.forEach(function(childId) {
      var child = findTask(data, childId);
      if (!child) return;
      lines.push('　　' + (child.completed ? '☑' : '☐') + ' ' + child.text);
    });
  });

  var text = lines.join('\n');
  navigator.clipboard.writeText(text).then(function() {
    if (btn) {
      btn.textContent = '済み ✓';
      setTimeout(function() { btn.textContent = 'コピー'; }, 2000);
    }
  }).catch(function() {
    // clipboard API が使えない場合（file:// など）はpromptで代替
    prompt('以下をコピーしてください:', text);
  });
}

// ===== データ エクスポート / インポート / 共有コード =====

// エクスポート対象オブジェクト（JSON保存・共有コード共通）
function buildExportObject() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: loadData(),
    settings: loadSettings()
  };
}

// 取り込みオブジェクトを検証して保存（JSON取込・共有コード共通）。成功時 true
function applyImportedObject(obj) {
  // version:1 形式 または 直接 todoApp データどちらも受け付ける
  var importedData = (obj && obj.version && obj.data) ? obj.data : obj;
  var importedSettings = (obj && obj.settings) || null;
  if (!importedData || !importedData.tasks || !Array.isArray(importedData.tasks)) {
    return false;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(importedData));
  if (importedSettings && Array.isArray(importedSettings.skippedDays)) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(importedSettings));
  }
  return true;
}

function exportData() {
  var json = JSON.stringify(buildExportObject(), null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'todoapp_' + todayString() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- 共有コード（スマホ⇄PCのデータ受け渡し。上書き方式・マージなし） ---

var SHARE_CODE_PREFIX = 'TODO1:';

function buildShareCode() {
  var json = JSON.stringify(buildExportObject());
  // UTF-8 → base64
  return SHARE_CODE_PREFIX + btoa(unescape(encodeURIComponent(json)));
}

function parseShareCode(str) {
  if (!str) return null;
  str = str.trim();
  if (str.indexOf(SHARE_CODE_PREFIX) !== 0) return null;
  try {
    var json = decodeURIComponent(escape(atob(str.slice(SHARE_CODE_PREFIX.length))));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// 共有コードを作って渡す（タッチ端末は共有シート、PCはクリップボード）
function shareDataAsCode() {
  var code = buildShareCode();
  var isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (isCoarse && navigator.share) {
    navigator.share({ text: code }).catch(function(err) {
      if (err && err.name !== 'AbortError') copyShareCode(code);
    });
    return;
  }
  copyShareCode(code);
}

function copyShareCode(code) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(function() {
      alert('共有コードをコピーしました。\nLINEやメールに貼り付けて、もう一方の端末に送ってください。\n受け取った側は「取込」でコードを貼り付けます。');
    }).catch(function() {
      prompt('この共有コードをコピーして、もう一方の端末に送ってください:', code);
    });
  } else {
    // clipboard API が使えない場合（file:// など）はpromptで代替
    prompt('この共有コードをコピーして、もう一方の端末に送ってください:', code);
  }
}

// --- 取込ダイアログ（共有コード貼り付け＋JSONファイルの両対応） ---

function closeImportDialog() {
  var el = document.getElementById('importDialogOverlay');
  if (el) el.remove();
}

function openImportDialog() {
  closeImportDialog();

  var overlay = document.createElement('div');
  overlay.className = 'import-dialog-overlay';
  overlay.id = 'importDialogOverlay';

  var box = document.createElement('div');
  box.className = 'import-dialog';
  box.innerHTML =
    '<h3 class="import-dialog-title">📥 データを取り込む</h3>' +
    '<p class="import-dialog-desc">もう一方の端末で作った共有コード（<strong>TODO1:</strong> で始まる文字列）を貼り付けてください。<br>今このアプリにあるデータは<strong>上書き</strong>されます。</p>' +
    '<textarea class="import-dialog-input" id="importDialogInput" placeholder="TODO1:…" rows="4"></textarea>' +
    '<div class="import-dialog-error" id="importDialogError" hidden>コードの形式が正しくありません。コピー漏れがないか確認してください。</div>' +
    '<div class="import-dialog-btns">' +
      '<button class="import-dialog-file" id="importDialogFile">JSONファイルから…</button>' +
      '<span class="import-dialog-btns-spacer"></span>' +
      '<button class="import-dialog-cancel" id="importDialogCancel">キャンセル</button>' +
      '<button class="import-dialog-ok" id="importDialogOk">取り込む</button>' +
    '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeImportDialog();
  });
  document.getElementById('importDialogCancel').addEventListener('click', closeImportDialog);

  document.getElementById('importDialogOk').addEventListener('click', function() {
    var obj = parseShareCode(document.getElementById('importDialogInput').value);
    if (obj && applyImportedObject(obj)) {
      location.reload();
    } else {
      document.getElementById('importDialogError').hidden = false;
    }
  });

  // JSONファイル経由（従来のインポート）
  document.getElementById('importDialogFile').addEventListener('click', function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', function() {
      var file = input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var obj = JSON.parse(e.target.result);
          if (!applyImportedObject(obj)) throw new Error('invalid format');
          location.reload();
        } catch (err) {
          alert('ファイルの形式が正しくありません。\n「保存」で作成した JSON ファイルを選択してください。');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  });

  setTimeout(function() {
    var inputEl = document.getElementById('importDialogInput');
    if (inputEl) inputEl.focus();
  }, 50);
}

// ===== イベント設定 =====

function setupEvents(data) {
  document.querySelectorAll('.category').forEach(function(section) {
    var category = section.dataset.category;
    // .task-add は renderAll で再構築されないので参照を保持してよい
    var taskAddEl = section.querySelector('.task-add');
    if (!taskAddEl) return;

    var taskInput = taskAddEl.querySelector('.task-input');
    var taskAddBtn = taskAddEl.querySelector('.task-add-btn');

    function handleAdd() {
      var text = taskInput.value.trim();
      if (!text) return;
      addTask(data, text, category);
      renderAll(data);
      // renderAll の innerHTML 書き換えでブラウザが値を復元するため
      // setTimeout(0) でブラウザの復元処理が終わった後にクリアする
      setTimeout(function() {
        taskInput.value = '';
        taskInput.focus();
      }, 0);
    }

    taskAddBtn.addEventListener('click', handleAdd);
    taskInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        handleAdd();
      }
    });
  });

  setupDropOnTaskLists(data);

  // コピーボタン（本日・明日・近日・そのうち）
  document.querySelectorAll('.copy-cat-btn').forEach(function(btn) {
    var section = btn.closest('.category');
    if (!section) return;
    var category = section.dataset.category;
    btn.addEventListener('click', function() {
      copyCategoryAsText(data, category, btn);
    });
  });

  // 共有 / 取込 / 保存
  var shareBtn = document.getElementById('shareBtn');
  if (shareBtn) shareBtn.addEventListener('click', shareDataAsCode);
  var importBtn = document.getElementById('importBtn');
  if (importBtn) importBtn.addEventListener('click', openImportDialog);
  var exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportData);

  // モバイル用 ⋯ メニュー（共有/取込/保存を集約）
  var headerMenuBtn = document.getElementById('headerMenuBtn');
  if (headerMenuBtn) {
    headerMenuBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      openHeaderMenu(headerMenuBtn);
    });
  }

  // 全消去ボタン（未処理・処理済み）
  document.querySelectorAll('.clear-all-btn').forEach(function(btn) {
    var section = btn.closest('.category');
    var category = section.dataset.category;
    btn.addEventListener('click', function() {
      var targets = data.tasks.filter(function(t) { return t.category === category && t.parentId === null; });
      if (targets.length === 0) return;
      if (!confirm((category === 'done' ? '処理済み' : '未処理') + 'のタスクをすべて削除しますか？')) return;
      // スナップショットを1回保存
      deleteHistory.push(JSON.stringify(data.tasks));
      if (deleteHistory.length > 5) deleteHistory.shift();
      // 対象カテゴリのタスク（親＋子）をすべて除去
      var removeIds = new Set();
      targets.forEach(function(t) {
        removeIds.add(t.id);
        t.children.forEach(function(cid) { removeIds.add(cid); });
      });
      data.tasks = data.tasks.filter(function(t) { return !removeIds.has(t.id); });
      saveData(data);
      renderAll(data);
    });
  });

  // Cmd+Z / Ctrl+Z で削除を元に戻す
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      // インライン編集中は干渉しない
      if (document.activeElement && document.activeElement.classList.contains('task-edit-input')) return;
      e.preventDefault();
      undoDelete(data);
    }
  });
}

// ===== タッチドラッグ（スマホでの指ドラッグ・枝葉モジュール） =====
// ブラウザ任せの長押しドラッグ（タスクが真っ黒に見える）をタッチでは抑止し、
// 「長押し → 半透明カードが指に追従」の自前ドラッグに置き換える。
// このセクションと style.css の .touch-drag-* / .task-wrapper--touch-source を
// 削除すればタッチドラッグだけ消える（マウスD&Dや⋮メニューには影響なし）。

function setupTouchDrag(data) {
  var LONG_PRESS_MS  = 350;  // 長押し判定時間
  var MOVE_CANCEL_PX = 10;   // 判定前にこれ以上動いたらスクロールとみなす
  var EDGE_SIZE = 80;        // 画面端の自動スクロール反応ゾーン(px)
  var MAX_SPEED = 15;        // 自動スクロール最大速度(px/frame)

  var touch = {
    pointerId: null,
    wrapper: null,      // 掴んだ .task-wrapper
    taskId: null,
    ghost: null,        // 指に追従する半透明カード
    active: false,      // 長押し成立してドラッグ中
    timer: null,
    startX: 0, startY: 0,
    lastX: 0, lastY: 0,
    offsetX: 0, offsetY: 0,
    scrollRaf: null,
    scrollSpeed: 0
  };

  function blockScroll(e) {
    if (touch.active) e.preventDefault();
  }

  function stopAutoScroll() {
    touch.scrollSpeed = 0;
    if (touch.scrollRaf !== null) {
      cancelAnimationFrame(touch.scrollRaf);
      touch.scrollRaf = null;
    }
  }

  function reset() {
    if (touch.timer) { clearTimeout(touch.timer); touch.timer = null; }
    if (touch.ghost) { touch.ghost.remove(); touch.ghost = null; }
    if (touch.wrapper) {
      touch.wrapper.classList.remove('task-wrapper--touch-source');
      touch.wrapper.draggable = true; // マウスD&D用に戻す
    }
    stopAutoScroll();
    clearDropIndicators();
    document.removeEventListener('touchmove', blockScroll);
    touch.pointerId = null;
    touch.wrapper = null;
    touch.taskId = null;
    touch.active = false;
  }

  function startDrag() {
    touch.timer = null;
    touch.active = true;

    var wrapper = touch.wrapper;
    var rect = wrapper.getBoundingClientRect();
    touch.offsetX = touch.startX - rect.left;
    touch.offsetY = touch.startY - rect.top;

    // 指に追従する半透明カード（pointer-events:none なので下の要素の判定を邪魔しない）
    var ghost = wrapper.cloneNode(true);
    ghost.className = 'task-wrapper touch-drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.left  = (touch.lastX - touch.offsetX) + 'px';
    ghost.style.top   = (touch.lastY - touch.offsetY) + 'px';
    document.body.appendChild(ghost);
    touch.ghost = ghost;

    wrapper.classList.add('task-wrapper--touch-source');

    // ドラッグ中は画面スクロールを止める
    document.addEventListener('touchmove', blockScroll, { passive: false });
  }

  // 指の位置の下にあるリスト/タスクを調べてインジケータを更新
  function hitTest(x, y) {
    var el = document.elementFromPoint(x, y);
    var listEl = el ? el.closest('.task-list') : null;
    var targetWrapper = el ? el.closest('.task-wrapper') : null;
    if (targetWrapper && touch.ghost && touch.ghost.contains(targetWrapper)) {
      targetWrapper = null;
    }
    return { listEl: listEl, targetWrapper: targetWrapper };
  }

  function refreshIndicator() {
    var hit = hitTest(touch.lastX, touch.lastY);
    if (hit.listEl) {
      showDropIndicator(hit.listEl, hit.targetWrapper, touch.lastY);
    } else {
      clearDropIndicators();
    }
  }

  function scrollStep() {
    touch.scrollRaf = null;
    if (!touch.active || touch.scrollSpeed === 0) return;
    window.scrollBy(0, touch.scrollSpeed);
    refreshIndicator(); // スクロールで下の要素が変わるので更新
    touch.scrollRaf = requestAnimationFrame(scrollStep);
  }

  function updateAutoScroll() {
    var y = touch.lastY;
    var h = window.innerHeight;
    if (y < EDGE_SIZE) {
      touch.scrollSpeed = -Math.ceil(((EDGE_SIZE - y) / EDGE_SIZE) * MAX_SPEED);
    } else if (y > h - EDGE_SIZE) {
      touch.scrollSpeed = Math.ceil(((y - (h - EDGE_SIZE)) / EDGE_SIZE) * MAX_SPEED);
    } else {
      touch.scrollSpeed = 0;
    }
    if (touch.scrollSpeed !== 0 && touch.scrollRaf === null) {
      touch.scrollRaf = requestAnimationFrame(scrollStep);
    }
  }

  document.addEventListener('pointerdown', function(e) {
    if (e.pointerType !== 'touch') return;
    var wrapper = e.target.closest('.task-wrapper');
    if (!wrapper || !wrapper.closest('.task-list')) return;
    // ボタン・入力から始まったタッチはドラッグにしない
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea')) return;

    var item = wrapper.querySelector('.task-item');
    if (!item) return;

    touch.pointerId = e.pointerId;
    touch.wrapper = wrapper;
    touch.taskId = item.dataset.taskId;
    touch.startX = touch.lastX = e.clientX;
    touch.startY = touch.lastY = e.clientY;

    // タッチ中はネイティブHTML5ドラッグを無効化（真っ黒ゴースト対策）
    wrapper.draggable = false;

    touch.timer = setTimeout(startDrag, LONG_PRESS_MS);
  });

  document.addEventListener('pointermove', function(e) {
    if (e.pointerId !== touch.pointerId) return;
    touch.lastX = e.clientX;
    touch.lastY = e.clientY;

    if (!touch.active) {
      // 長押し成立前に大きく動いた＝スクロール操作なので中止
      var dx = e.clientX - touch.startX;
      var dy = e.clientY - touch.startY;
      if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) reset();
      return;
    }

    touch.ghost.style.left = (touch.lastX - touch.offsetX) + 'px';
    touch.ghost.style.top  = (touch.lastY - touch.offsetY) + 'px';
    refreshIndicator();
    updateAutoScroll();
  });

  document.addEventListener('pointerup', function(e) {
    if (e.pointerId !== touch.pointerId) return;
    if (touch.active) {
      var hit = hitTest(e.clientX, e.clientY);
      var draggedId = touch.taskId;
      reset();
      if (hit.listEl && draggedId) {
        performDrop(data, draggedId, hit.listEl, hit.targetWrapper, e.clientY);
      }
    } else {
      reset();
    }
  });

  document.addEventListener('pointercancel', function(e) {
    if (e.pointerId !== touch.pointerId) return;
    reset();
  });

  // Android の長押しコンテキストメニューを抑止（ドラッグ中のみ）
  document.addEventListener('contextmenu', function(e) {
    if (touch.active) e.preventDefault();
  });
}

// ===== カテゴリ見出しの日付ラベル更新 =====

function updateCategoryDateLabels() {
  var settings = loadSettings();
  var displayedToday = getEffectiveToday(settings.skippedDays);
  var nextDay = getNextWorkingDay(settings.skippedDays);

  var todayEl    = document.getElementById('todayDateLabel');
  var tomorrowEl = document.getElementById('tomorrowDateLabel');
  var tomorrowTitle = document.getElementById('tomorrowTitle');

  if (todayEl)    todayEl.textContent    = formatDayLabel(displayedToday);
  if (tomorrowEl) tomorrowEl.textContent = formatDayLabel(nextDay);

  if (tomorrowTitle) {
    // 表示中の本日の翌カレンダー日と、表示中の明日が一致しなければ「明日（次の日）」
    var oneDayAfter = new Date(displayedToday);
    oneDayAfter.setDate(oneDayAfter.getDate() + 1);
    var consecutive = formatLocalDate(oneDayAfter) === formatLocalDate(nextDay);
    tomorrowTitle.textContent = consecutive ? '明日' : '明日（次の日）';
  }
}

// ===== モード切替タブのセットアップ =====

function setupModeTabs(data) {
  // 保存されたモードを復元（不正値は「全部」のまま）
  var saved = localStorage.getItem(MODE_KEY);
  if (saved && (saved === 'all' || SPACES[saved])) currentMode = saved;

  function updateActiveTab() {
    document.querySelectorAll('.mode-tab').forEach(function(tab) {
      tab.classList.toggle('active', tab.dataset.mode === currentMode);
    });
  }

  document.querySelectorAll('.mode-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      currentMode = this.dataset.mode;
      localStorage.setItem(MODE_KEY, currentMode);
      updateActiveTab();
      renderAll(data);
    });
  });

  updateActiveTab();
}

// ===== 詳細設定パネルのセットアップ =====

function setupSettingsPanel() {
  var panel = document.getElementById('settingsPanel');
  if (!panel) return;

  // 開閉状態を保存（デフォルトは閉じている）
  var saved = localStorage.getItem('settingsCollapsed');
  panel.open = (saved === '0');
  panel.addEventListener('toggle', function() {
    localStorage.setItem('settingsCollapsed', panel.open ? '0' : '1');
  });

  // 曜日チェックボックスの初期値・イベント
  var settings = loadSettings();
  document.querySelectorAll('.settings-skip-checkbox').forEach(function(cb) {
    var day = parseInt(cb.dataset.day, 10);
    cb.checked = settings.skippedDays.indexOf(day) !== -1;
    var label = cb.closest('.settings-weekday');
    if (label) label.classList.toggle('settings-weekday--on', cb.checked);

    cb.addEventListener('change', function() {
      var s = loadSettings();
      var d = parseInt(this.dataset.day, 10);
      if (this.checked) {
        if (s.skippedDays.indexOf(d) === -1) s.skippedDays.push(d);
      } else {
        s.skippedDays = s.skippedDays.filter(function(x) { return x !== d; });
      }
      saveSettings(s);

      var lbl = this.closest('.settings-weekday');
      if (lbl) lbl.classList.toggle('settings-weekday--on', this.checked);

      // 設定変更で本日/明日の表示も即時更新
      updateCategoryDateLabels();
    });
  });
}

// ===== 初期化 =====

(function init() {
  var data = loadData();
  processDateChange(data);
  setupModeTabs(data);  // renderAll より先（保存済みモードを復元してから描画）
  renderAll(data);
  setupEvents(data);
  setupTouchDrag(data);
  setupSettingsPanel();
  updateCategoryDateLabels();
})();

// ===== ドラッグ中のエッジ自動スクロール（枝葉） =====
(function setupEdgeAutoScroll() {
  var EDGE_SIZE = 80;      // 反応ゾーン(px)
  var MAX_SPEED = 15;      // 最大スクロール速度(px/frame)
  var rafId = null;
  var currentSpeed = 0;

  function step() {
    if (currentSpeed !== 0) {
      window.scrollBy(0, currentSpeed);
      rafId = requestAnimationFrame(step);
    } else {
      rafId = null;
    }
  }

  document.addEventListener('dragover', function(e) {
    // ドラッグ中のみ反応（dragStateのtaskIdで判定）
    if (!dragState.taskId) return;

    var y = e.clientY;
    var h = window.innerHeight;

    if (y < EDGE_SIZE) {
      currentSpeed = -Math.ceil(((EDGE_SIZE - y) / EDGE_SIZE) * MAX_SPEED);
    } else if (y > h - EDGE_SIZE) {
      currentSpeed = Math.ceil(((y - (h - EDGE_SIZE)) / EDGE_SIZE) * MAX_SPEED);
    } else {
      currentSpeed = 0;
    }

    if (currentSpeed !== 0 && rafId === null) {
      rafId = requestAnimationFrame(step);
    }
  });

  function stop() {
    currentSpeed = 0;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  document.addEventListener('dragend', stop);
  document.addEventListener('drop', stop);
})();

// ===== 説明パネルの開閉状態を保存（枝葉） =====
(function setupIntroToggle() {
  var panel = document.getElementById('introPanel');
  if (!panel) return;
  // 初期値：保存値があればそれに従う、無ければ開いた状態（初訪問者向け）
  var saved = localStorage.getItem('introCollapsed');
  panel.open = (saved !== '1');
  panel.addEventListener('toggle', function() {
    localStorage.setItem('introCollapsed', panel.open ? '0' : '1');
  });
})();
