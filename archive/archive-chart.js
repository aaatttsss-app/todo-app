// ===== 折れ線グラフ（枝葉コンポーネント） =====
// 削除方法: このファイルを削除 + archive.html から以下を削除するだけで完全に消えます。
//   - <div class="chart-toggle-row"> ... </div>
//   - <section id="archChart" ...> ... </section>
//   - <script src="archive-chart.js?v=1"></script>
// archive.js / archive.css など他ファイルへの依存なし。

(function() {
  'use strict';

  var STORAGE_KEY = 'todoApp';
  var chartDays = 30;
  var allTasks  = [];

  // ===== データ（archive.js とは独立して読み込む） =====

  function loadTasks() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        var done = (data.tasks || []).filter(function(t) {
          return t.parentId === null && t.category === 'done' && t.completedDate;
        });
        if (done.length > 0) return done;
      }
    } catch (e) {}
    return window.SAMPLE_ARCHIVE_TASKS || [];
  }

  // ===== データ集計 =====

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function buildSeries(days) {
    var now    = new Date();
    var labels = [];
    var counts = {};
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      var s = fmtDate(d);
      labels.push(s);
      counts[s] = 0;
    }
    allTasks.forEach(function(t) {
      if (counts[t.completedDate] !== undefined) {
        counts[t.completedDate]++;
      }
    });
    return labels.map(function(l) { return { date: l, count: counts[l] }; });
  }

  // ===== SVG 描画 =====

  function renderChart() {
    var body = document.getElementById('chartBody');
    if (!body) return;

    var data   = buildSeries(chartDays);
    var values = data.map(function(d) { return d.count; });
    var maxVal = Math.max.apply(null, values) || 1;
    var n      = data.length;

    var W    = body.offsetWidth || 680;
    var H    = 180;
    var padL = 36, padR = 12, padT = 20, padB = 36;
    var cW   = W - padL - padR;
    var cH   = H - padT - padB;

    // 各データ点の座標
    var pts = values.map(function(v, i) {
      return {
        x: padL + (n > 1 ? (i / (n - 1)) : 0.5) * cW,
        y: padT + (1 - v / maxVal) * cH,
        v: v
      };
    });

    // ライン & エリアパス
    var pathD = pts.map(function(p, i) {
      return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');

    var base  = padT + cH;
    var areaD = pathD +
      ' L' + pts[n - 1].x.toFixed(1) + ',' + base +
      ' L' + pts[0].x.toFixed(1)     + ',' + base + ' Z';

    // X 軸ラベル
    var xStep   = chartDays <= 30 ? 7 : 14;
    var xLabels = [];
    data.forEach(function(d, i) {
      if (i === 0 || i === n - 1 || i % xStep === 0) {
        var dt = new Date(d.date + 'T00:00:00');
        xLabels.push({ x: pts[i].x, text: (dt.getMonth() + 1) + '/' + dt.getDate() });
      }
    });

    // Y 軸ラベル（0 / 中間 / 最大）
    var midVal  = Math.round(maxVal / 2);
    var yLabels = [
      { y: base,          text: '0' },
      { y: padT + cH / 2, text: midVal.toString() },
      { y: padT,          text: maxVal.toString() }
    ];

    // グリッド水平線
    var gridLines = [padT, padT + cH / 2, padT + cH].map(function(y) {
      var dash = (y === padT + cH) ? '0' : '4,4';
      return '<line x1="' + padL + '" y1="' + y.toFixed(1) +
             '" x2="' + (padL + cW) + '" y2="' + y.toFixed(1) +
             '" stroke="#f0e8d0" stroke-width="1" stroke-dasharray="' + dash + '"/>';
    }).join('');

    // データ点（30日以内のみ表示）
    var dots = '';
    if (n <= 31) {
      dots = pts.map(function(p) {
        var r    = p.v > 0 ? 3.5 : 2;
        var fill = p.v > 0 ? '#6366f1' : '#d0c8b0';
        return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) +
               '" r="' + r + '" fill="' + fill + '" stroke="#fff" stroke-width="1.5"/>';
      }).join('');
    }

    body.innerHTML =
      '<svg width="100%" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
      '" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">' +
      '<defs>' +
        '<linearGradient id="archChartGrad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#6366f1" stop-opacity="0.22"/>' +
          '<stop offset="100%" stop-color="#6366f1" stop-opacity="0.02"/>' +
        '</linearGradient>' +
      '</defs>' +
      gridLines +
      '<path d="' + areaD + '" fill="url(#archChartGrad)"/>' +
      '<path d="' + pathD + '" fill="none" stroke="#6366f1" stroke-width="2.5"' +
        ' stroke-linejoin="round" stroke-linecap="round"/>' +
      dots +
      yLabels.map(function(l) {
        return '<text x="' + (padL - 5) + '" y="' + l.y.toFixed(1) +
               '" text-anchor="end" dominant-baseline="middle"' +
               ' font-size="10" fill="#a89a78">' + l.text + '</text>';
      }).join('') +
      xLabels.map(function(l) {
        return '<text x="' + l.x.toFixed(1) + '" y="' + (base + 14) +
               '" text-anchor="middle" font-size="10" fill="#a89a78">' + l.text + '</text>';
      }).join('') +
      '</svg>';
  }

  // ===== イベント & 起動 =====

  function init() {
    allTasks = loadTasks();

    var toggleBtn    = document.getElementById('chartToggleBtn');
    var chartSection = document.getElementById('archChart');
    var closeBtn     = document.getElementById('chartClose');

    if (!toggleBtn || !chartSection) return; // HTML 側が存在しない場合は何もしない

    toggleBtn.addEventListener('click', function() {
      if (!chartSection.hidden) {
        chartSection.hidden = true;
        toggleBtn.classList.remove('active');
        return;
      }
      chartSection.hidden = false;
      toggleBtn.classList.add('active');
      // レイアウト確定後に SVG を描画
      requestAnimationFrame(function() {
        requestAnimationFrame(renderChart);
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        chartSection.hidden = true;
        toggleBtn.classList.remove('active');
      });
    }

    document.querySelectorAll('.chart-period-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.chart-period-btn').forEach(function(b) {
          b.classList.remove('active');
        });
        this.classList.add('active');
        chartDays = parseInt(this.dataset.days, 10);
        renderChart();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
