// ===== メモページ ロジック（枝葉：このフォルダを削除すれば完全に消えます） =====
// 独立した localStorage キーのみを使用。メインアプリのデータには一切触れない。
//
// クラウド同期：メインアプリで設定した「合言葉」をそのまま読み取り（このファイルからは
// 変更しない・読むだけ）、クラウド上は合言葉に "::memo" を付けた別の行に保存する。
// これによりTodo本体のデータとは衝突しない。合言葉が未設定/config.js未設置なら
// 従来どおり純ローカルのみで動作する。

(function() {
  'use strict';

  var STORAGE_KEY = 'todoMemo';
  var SAVE_DELAY_MS = 500;

  var SYNC_KEY_STORAGE = 'todoSyncKey';  // メインアプリ(app.js)と同じキー名。読むだけで変更しない
  var CLOUD_PUSH_DELAY_MS = 1500;
  var CLOUD_POLL_MS = 20000;

  var textarea = document.getElementById('memoText');
  var statusEl = document.getElementById('memoStatus');
  var clearBtn = document.getElementById('memoClearBtn');
  var saveTimer = null;

  var cloudPushTimer = null;
  var cloudPollTimer = null;
  var cloudLastUpdatedAt = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  // ===== ローカル保存 =====

  function save() {
    localStorage.setItem(STORAGE_KEY, textarea.value);
    setStatus('保存済み');
    cloudPushDebounced();
  }

  function scheduleSave() {
    setStatus('保存中…');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  // ===== クラウド同期（任意。合言葉未設定/config.js未設置なら完全に無効） =====

  function isCloudEnabled() {
    return !!(window.TODO_CLOUD && window.TODO_CLOUD.url && window.TODO_CLOUD.anonKey);
  }

  function getSyncKey() {
    return (localStorage.getItem(SYNC_KEY_STORAGE) || '').trim();
  }

  // メモ専用のクラウド上のキー（Todo本体の行とは別にする）
  function cloudMemoKey() {
    return getSyncKey() + '::memo';
  }

  function cloudRpc(fnName, body) {
    var cfg = window.TODO_CLOUD;
    return fetch(cfg.url + '/rest/v1/rpc/' + fnName, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey
      },
      body: JSON.stringify(body)
    }).then(function(res) {
      if (!res.ok) throw new Error('cloud http ' + res.status);
      return res.json();
    });
  }

  function cloudPushDebounced() {
    if (!isCloudEnabled()) return;
    if (!getSyncKey()) return;

    if (cloudPushTimer) clearTimeout(cloudPushTimer);
    setStatus('☁️ 同期中…');
    cloudPushTimer = setTimeout(function() {
      cloudPushTimer = null;
      cloudRpc('save_board', { p_key: cloudMemoKey(), p_payload: { text: textarea.value } }).then(function(ts) {
        cloudLastUpdatedAt = Array.isArray(ts) ? ts[0] : ts;
        setStatus('☁️ 同期済み');
      }).catch(function() {
        setStatus('☁️ 送信できませんでした（次回再試行）');
      });
    }, CLOUD_PUSH_DELAY_MS);
  }

  function cloudPull() {
    if (!isCloudEnabled()) return;
    if (!getSyncKey()) return;
    if (cloudPushTimer) return;  // アップロード待ち中は上書きしない（編集中データの保護）

    cloudRpc('get_board', { p_key: cloudMemoKey() }).then(function(rows) {
      var remote = rows && rows[0];
      if (!remote || !remote.payload) return;
      if (cloudLastUpdatedAt && remote.updated_at <= cloudLastUpdatedAt) return;

      var remoteText = remote.payload.text;
      if (typeof remoteText !== 'string') return;
      if (remoteText === textarea.value) {
        cloudLastUpdatedAt = remote.updated_at;
        return;
      }

      localStorage.setItem(STORAGE_KEY, remoteText);
      textarea.value = remoteText;
      cloudLastUpdatedAt = remote.updated_at;
      setStatus('☁️ 他の端末の更新を反映しました');
    }).catch(function() {
      setStatus('☁️ 通信できませんでした');
    });
  }

  function setupCloudSync() {
    if (!isCloudEnabled() || !getSyncKey()) return;  // 未設定なら何もしない（純ローカルのまま）

    cloudPull();

    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) cloudPull();
    });

    if (cloudPollTimer) clearInterval(cloudPollTimer);
    cloudPollTimer = setInterval(function() {
      if (!document.hidden) cloudPull();
    }, CLOUD_POLL_MS);
  }

  // ===== 初期化 =====

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

    setupCloudSync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
