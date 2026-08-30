// ===== 振り返りページ ロジック =====
// 重要: localStorage は読むだけ。setItem は一切呼ばない。
// これによりメインアプリのデータに一切影響を与えない。

(function() {
  'use strict';

  var STORAGE_KEY = 'todoApp';
  var ARCHIVE_KEY = 'todoArchive';

  var WEEKDAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];

  var state = {
    selectedDate: null,
    currentView: 'day',    // 'day' | 'week' | 'month' | 'year'
    calendarMonth: null,   // 表示中のカレンダー月（その月の1日 Date）
    tasks: [],
    isSample: false,
    statFilter: 'all',     // 'all' | 'day' | 'week' | 'month' | 'year'  ← WCM 期間絞り込み
    spaceFilter: 'all',    // 'all' | 'work' | 'private' | 'other'      ← 区分絞り込み（期間フィルタと併用可）
    searchQuery: ''        // 検索クエリ（空文字 = 検索モードOFF）
  };

  // ===== 日付ユーティリティ =====

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayString() { return formatDate(new Date()); }

  function parseDate(s) { return new Date(s + 'T00:00:00'); }

  function formatDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function startOfDay(d) {
    var x = new Date(d); x.setHours(0, 0, 0, 0); return x;
  }

  function endOfDay(d) {
    var x = new Date(d); x.setHours(23, 59, 59, 999); return x;
  }

  function startOfWeek(d) {
    var x = startOfDay(d);
    var day = x.getDay();
    x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
    return x;
  }

  function endOfWeek(d) {
    var e = new Date(startOfWeek(d));
    e.setDate(e.getDate() + 6);
    return endOfDay(e);
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  }

  function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  function startOfYear(d) {
    return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
  }

  function endOfYear(d) {
    return new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
  }

  // statFilter に対応する日付範囲とラベルを返す
  function getRangeForStatFilter(filter) {
    var t = startOfDay(new Date());
    switch (filter) {
      case 'day':   var yest = new Date(t); yest.setDate(yest.getDate() - 1);
                    return { start: yest, end: endOfDay(yest), label: '昨日' };
      case 'week':  return { start: startOfWeek(t),  end: endOfWeek(t),   label: '今週' };
      case 'month': return { start: startOfMonth(t), end: endOfMonth(t),  label: '今月' };
      case 'year':  return { start: startOfYear(t),  end: endOfYear(t),   label: '今年' };
      default:      return { start: null,             end: null,           label: '全期間' };
    }
  }

  // ===== データ読み込み（READ ONLY） =====

  function isDoneParent(t) {
    return t && t.parentId === null && t.category === 'done' && t.completedDate;
  }

  // ライブ盤の直近完了（todoApp）＋ 保管庫の全履歴（todoArchive）の和集合を読む（READ ONLY）
  function loadTasks() {
    try {
      var byId = {};

      var rawLive = localStorage.getItem(STORAGE_KEY);
      if (rawLive) {
        var data = JSON.parse(rawLive);
        (data.tasks || []).forEach(function(t) {
          if (isDoneParent(t)) byId[t.id] = t;
        });
      }

      var rawArch = localStorage.getItem(ARCHIVE_KEY);
      if (rawArch) {
        var archive = JSON.parse(rawArch);
        if (Array.isArray(archive)) {
          archive.forEach(function(t) {
            if (isDoneParent(t) && !byId[t.id]) byId[t.id] = t;
          });
        }
      }

      var doneTasks = Object.keys(byId).map(function(id) { return byId[id]; });
      if (doneTasks.length > 0) {
        return { tasks: doneTasks, isSample: false };
      }
    } catch (e) { /* 破損データは無視 */ }
    return { tasks: window.SAMPLE_ARCHIVE_TASKS || [], isSample: true };
  }

  function getFlag(task, key) {
    return !!(task.flags && task.flags[key]);
  }

  // state.spaceFilter に基づく絞り込み（'all'なら素通し）。
  // space未設定のタスクは本体アプリと同じ扱いで「その他」とみなす。
  function filterBySpace(tasks) {
    if (state.spaceFilter === 'all') return tasks;
    return tasks.filter(function(t) { return (t.space || 'other') === state.spaceFilter; });
  }

  // ===== 集計 =====

  function countInRange(start, end) {
    return state.tasks.filter(function(t) {
      var d = parseDate(t.completedDate);
      return d >= start && d <= end;
    }).length;
  }

  function tasksInRange(start, end) {
    return state.tasks.filter(function(t) {
      var d = parseDate(t.completedDate);
      return d >= start && d <= end;
    });
  }

  function countByDate() {
    var counts = {};
    state.tasks.forEach(function(t) {
      counts[t.completedDate] = (counts[t.completedDate] || 0) + 1;
    });
    return counts;
  }

  // ===== WCM 集計（期間指定可能） =====

  function renderWcm(tasks, label) {
    var w = 0, c = 0, m = 0;
    tasks.forEach(function(t) {
      if (getFlag(t, 'will')) w++;
      if (getFlag(t, 'can'))  c++;
      if (getFlag(t, 'must')) m++;
    });
    var total = tasks.length;
    var denom = total || 1;

    setText('wcmTotal', '合計 ' + total + ' 件');
    var lbl = document.getElementById('wcmPeriodLabel');
    if (lbl) lbl.textContent = '（' + (label || '全期間') + '）';

    setText('wcmWillCount', w + '件');
    setText('wcmCanCount',  c + '件');
    setText('wcmMustCount', m + '件');

    setTimeout(function() {
      document.getElementById('wcmWillBar').style.width = (w / denom * 100) + '%';
      document.getElementById('wcmCanBar').style.width  = (c / denom * 100) + '%';
      document.getElementById('wcmMustBar').style.width = (m / denom * 100) + '%';
    }, 50);
  }

  // ===== ダッシュボード描画 =====

  function renderDashboard() {
    var today = startOfDay(new Date());
    var endToday = endOfDay(today);

    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    setText('statDay',   countInRange(yesterday, endOfDay(yesterday)));
    setText('statWeek',  countInRange(startOfWeek(today),  endOfWeek(today)));
    setText('statMonth', countInRange(startOfMonth(today), endOfMonth(today)));
    setText('statYear',  countInRange(startOfYear(today),  endOfYear(today)));

    // WCM: statFilter(期間) と spaceFilter(区分) の両方で絞り込んで集計
    var r = getRangeForStatFilter(state.statFilter);
    var wcmTasks = r.start ? tasksInRange(r.start, r.end) : state.tasks;
    wcmTasks = filterBySpace(wcmTasks);
    renderWcm(wcmTasks, r.label);

    // アクティブカードの見た目を更新
    ['day', 'week', 'month', 'year'].forEach(function(p) {
      var id = 'statCard' + p.charAt(0).toUpperCase() + p.slice(1);
      var card = document.getElementById(id);
      if (card) card.classList.toggle('active', state.statFilter === p);
    });
  }

  // ===== カレンダー描画 =====

  function renderCalendar() {
    var month = state.calendarMonth;
    setText('calTitle', month.getFullYear() + '年 ' + (month.getMonth() + 1) + '月');

    var counts = countByDate();
    var maxInMonth = 0;
    var monthStart = startOfMonth(month);
    var monthEnd   = endOfMonth(month);
    Object.keys(counts).forEach(function(k) {
      var d = parseDate(k);
      if (d >= monthStart && d <= monthEnd && counts[k] > maxInMonth) {
        maxInMonth = counts[k];
      }
    });

    var firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
    var dow = firstDay.getDay();
    var leadingBlanks = dow === 0 ? 6 : dow - 1;
    var lastDate = endOfMonth(month).getDate();

    var grid = document.getElementById('calGrid');
    grid.innerHTML = '';

    for (var i = 0; i < leadingBlanks; i++) {
      var blank = document.createElement('div');
      blank.className = 'cal-cell cal-blank';
      grid.appendChild(blank);
    }

    for (var d = 1; d <= lastDate; d++) {
      var cellDate = new Date(month.getFullYear(), month.getMonth(), d);
      var dateStr  = formatDate(cellDate);
      var count    = counts[dateStr] || 0;

      var cell = document.createElement('button');
      cell.className = 'cal-cell';
      cell.dataset.date = dateStr;

      var level = 0;
      if (count > 0 && maxInMonth > 0) {
        level = Math.min(4, Math.max(1, Math.ceil((count / maxInMonth) * 4)));
      }
      cell.classList.add('heat-' + level);

      if (dateStr === state.selectedDate) cell.classList.add('selected');
      if (dateStr === todayString())       cell.classList.add('today');

      var inner = '<span class="cal-num">' + d + '</span>';
      if (count > 0) inner += '<span class="cal-dot">' + count + '</span>';
      cell.innerHTML = inner;

      cell.addEventListener('click', onCellClick);
      grid.appendChild(cell);
    }
  }

  function onCellClick() {
    var ds = this.dataset.date;
    state.selectedDate = ds;
    state.currentView = 'day';
    clearSearch();
    document.querySelectorAll('.view-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.view === 'day');
    });
    renderCalendar();
    renderView();
    document.querySelector('.arch-view').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ===== 検索 =====

  // 助詞・助動詞・句読点で分割して頻出語を抽出（日本語対応の簡易版）
  var WORD_SPLIT_RE = /[\s　、。・「」『』【】（）()！!？?,.，．\-―]|より|から|まで|など|する|した|して|いる|ある|なる|は|の|を|に|で|が|と|も|か|へ|て|た|し|や|だ/;

  function extractTopWords(limit) {
    var freq = {};
    state.tasks.forEach(function(t) {
      var tokens = t.text.split(WORD_SPLIT_RE);
      tokens.forEach(function(token) {
        token = token.trim();
        if (token.length >= 2) {
          freq[token] = (freq[token] || 0) + 1;
        }
      });
    });

    var words = Object.keys(freq).filter(function(w) { return freq[w] >= 2; });
    words.sort(function(a, b) { return freq[b] - freq[a]; });
    return words.slice(0, limit || 8);
  }

  function renderSuggestions() {
    var container = document.getElementById('searchSuggestions');
    if (!container) return;
    var words = extractTopWords(8);
    if (words.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = words.map(function(w) {
      return '<button class="search-chip" data-word="' + escapeAttr(w) + '">' + escapeHtml(w) + '</button>';
    }).join('');
  }

  function clearSearch() {
    state.searchQuery = '';
    var si = document.getElementById('searchInput');
    var sc = document.getElementById('searchClear');
    if (si) si.value = '';
    if (sc) sc.hidden = true;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return s.replace(/"/g, '&quot;');
  }

  // ===== タスク一覧 描画 =====

  function renderView() {
    // 検索クエリがある場合は検索モード
    if (state.searchQuery.trim()) {
      renderSearchResults(state.searchQuery.trim());
      return;
    }

    var sel = startOfDay(state.selectedDate ? parseDate(state.selectedDate) : new Date());
    var range, title;

    switch (state.currentView) {
      case 'day':
        range = { start: sel, end: endOfDay(sel) };
        title = formatJpDate(sel, true);
        break;
      case 'week':
        var ws = startOfWeek(sel), we = endOfWeek(sel);
        range = { start: ws, end: we };
        title = formatJpDate(ws, false) + ' 〜 ' + formatJpDate(we, false) + ' の週';
        break;
      case 'month':
        range = { start: startOfMonth(sel), end: endOfMonth(sel) };
        title = sel.getFullYear() + '年 ' + (sel.getMonth() + 1) + '月';
        break;
      case 'year':
        range = { start: startOfYear(sel), end: endOfYear(sel) };
        title = sel.getFullYear() + '年';
        break;
    }

    renderTaskList(filterBySpace(tasksInRange(range.start, range.end)), title);
  }

  function renderSearchResults(query) {
    var lq = query.toLowerCase();
    var tasks = state.tasks.filter(function(t) {
      return t.text.toLowerCase().indexOf(lq) !== -1;
    });
    renderTaskList(filterBySpace(tasks), '「' + query + '」の検索結果');
  }

  function renderTaskList(tasks, title) {
    // 日付降順ソート
    tasks = tasks.slice().sort(function(a, b) {
      return b.completedDate.localeCompare(a.completedDate);
    });

    setText('viewTitle', title);
    setText('viewCount', tasks.length + '件');

    var listEl = document.getElementById('taskList');
    listEl.innerHTML = '';

    if (tasks.length === 0) {
      var msg = state.searchQuery.trim()
        ? '「' + escapeHtml(state.searchQuery) + '」に一致するタスクはありません'
        : 'この期間に完了したタスクはありません';
      listEl.innerHTML = '<div class="empty">' + msg + '</div>';
      return;
    }

    // 日付ごとにグループ化
    var groups = {};
    tasks.forEach(function(t) {
      if (!groups[t.completedDate]) groups[t.completedDate] = [];
      groups[t.completedDate].push(t);
    });

    Object.keys(groups).sort().reverse().forEach(function(date) {
      var d = parseDate(date);
      var group = document.createElement('div');
      group.className = 'day-group';

      var header = document.createElement('div');
      header.className = 'day-header';
      header.innerHTML =
        '<span class="day-date">'    + formatJpDate(d, true)         + '</span>' +
        '<span class="day-weekday">(' + WEEKDAYS_JP[d.getDay()]      + ')</span>' +
        '<span class="day-count">'   + groups[date].length + '件'   + '</span>';
      group.appendChild(header);

      var ul = document.createElement('ul');
      ul.className = 'day-tasks';

      groups[date].forEach(function(t) {
        var li = document.createElement('li');
        li.className = 'task-item';

        var textSpan = document.createElement('span');
        textSpan.className = 'task-text';
        if (state.searchQuery.trim()) {
          textSpan.innerHTML = highlightText(t.text, state.searchQuery.trim());
        } else {
          textSpan.textContent = t.text;
        }
        li.appendChild(textSpan);

        var flagsSpan = document.createElement('span');
        flagsSpan.className = 'task-flags';
        if (getFlag(t, 'will')) flagsSpan.innerHTML += '<span class="task-flag flag-will">W</span>';
        if (getFlag(t, 'can'))  flagsSpan.innerHTML += '<span class="task-flag flag-can">C</span>';
        if (getFlag(t, 'must')) flagsSpan.innerHTML += '<span class="task-flag flag-must">M</span>';
        li.appendChild(flagsSpan);

        ul.appendChild(li);
      });

      group.appendChild(ul);
      listEl.appendChild(group);
    });
  }

  function highlightText(text, query) {
    var escaped = escapeHtml(text);
    var escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return escaped.replace(new RegExp('(' + escapedQuery + ')', 'gi'),
        '<mark class="search-hl">$1</mark>');
    } catch (e) {
      return escaped;
    }
  }

  function formatJpDate(d, withYear) {
    if (withYear) {
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // ===== ヘルパー =====

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ===== イベント設定 =====

  function setupEvents() {
    // カレンダーナビ
    document.getElementById('calPrev').addEventListener('click', function() {
      state.calendarMonth = new Date(
        state.calendarMonth.getFullYear(),
        state.calendarMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById('calNext').addEventListener('click', function() {
      state.calendarMonth = new Date(
        state.calendarMonth.getFullYear(),
        state.calendarMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    document.getElementById('calToday').addEventListener('click', function() {
      state.calendarMonth = startOfMonth(new Date());
      state.selectedDate  = todayString();
      renderCalendar();
      renderView();
    });

    // ビュータブ（クリック時に検索をリセット）
    document.querySelectorAll('.view-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        clearSearch();
        document.querySelectorAll('.view-tab').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
        state.currentView = this.dataset.view;
        renderView();
      });
    });

    // 統計カード → WCM 期間フィルタ（同じカードを再クリックで 全期間 に戻す）
    document.querySelectorAll('.stat-card[data-period]').forEach(function(card) {
      card.addEventListener('click', function() {
        var period = this.dataset.period;
        state.statFilter = (state.statFilter === period) ? 'all' : period;
        renderDashboard();
      });
      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); }
      });
    });

    // 区分チップ → 仕事/プライベート/その他で絞り込み（同じチップを再クリックで解除）
    // 期間フィルタ(statFilter)とは独立しているので併用できる
    document.querySelectorAll('.space-chip[data-space]').forEach(function(chip) {
      chip.addEventListener('click', function() {
        var sp = this.dataset.space;
        state.spaceFilter = (state.spaceFilter === sp) ? 'all' : sp;
        document.querySelectorAll('.space-chip[data-space]').forEach(function(c) {
          c.classList.toggle('active', c.dataset.space === state.spaceFilter);
        });
        renderDashboard();
        renderView();
      });
    });

    // 検索入力
    var searchInput = document.getElementById('searchInput');
    var searchClear = document.getElementById('searchClear');
    var suggestEl   = document.getElementById('searchSuggestions');

    if (searchInput) {
      searchInput.addEventListener('input', function() {
        state.searchQuery = this.value;
        if (searchClear) searchClear.hidden = !this.value;
        renderView();
      });
    }

    if (searchClear) {
      searchClear.addEventListener('click', function() {
        clearSearch();
        renderView();
      });
    }

    // サジェストチップ（イベント委譲）
    if (suggestEl) {
      suggestEl.addEventListener('click', function(e) {
        var chip = e.target.closest('.search-chip');
        if (!chip) return;
        if (searchInput) {
          searchInput.value = chip.dataset.word;
          searchInput.dispatchEvent(new Event('input'));
        }
      });
    }
  }

  // ===== 起動 =====

  function init() {
    var loaded = loadTasks();
    state.tasks          = loaded.tasks;
    state.isSample       = loaded.isSample;
    state.selectedDate   = todayString();
    state.calendarMonth  = startOfMonth(new Date());

    if (state.isSample) {
      var banner = document.getElementById('sampleBanner');
      if (banner) banner.hidden = false;
    }

    renderDashboard();
    renderCalendar();
    renderView();
    renderSuggestions();
    setupEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
