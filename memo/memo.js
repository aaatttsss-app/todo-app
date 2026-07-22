// ===== メモページ ロジック（枝葉：このフォルダを削除すれば完全に消えます） =====
// 独立した localStorage キーのみを使用。メインアプリのデータには一切触れない。

(function() {
  'use strict';

  var STORAGE_KEY = 'todoMemo';
  var SAVE_DELAY_MS = 500;

  var textarea = document.getElementById('memoText');
  var statusEl = document.getElementById('memoStatus');
  var clearBtn = document.getElementById('memoClearBtn');
  var saveTimer = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, textarea.value);
    setStatus('保存済み');
  }

  function scheduleSave() {
    setStatus('保存中…');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  function init() {
    textarea.value = localStorage.getItem(STORAGE_KEY) || '';
    setStatus(textarea.value ? '保存済み' : '');

    textarea.addEventListener('input', scheduleSave);

    // ページを離れる時、保留中の保存があれば即座に反映
    window.addEventListener('beforeunload', function() {
      if (saveTimer) { clearTimeout(saveTimer); save(); }
    });

    clearBtn.addEventListener('click', function() {
      if (!textarea.value.trim()) return;
      if (!confirm('メモを全部消しますか？（元に戻せません）')) return;
      textarea.value = '';
      save();
      textarea.focus();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
