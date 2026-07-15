// ===== アーカイヴ ページ用サンプルデータ =====
// 実データ（localStorage の処理済みタスク）が無いときに表示する。
// 後で削除しやすいよう独立ファイルにしている。
// 削除する場合: このファイルと archive.html の参照1行を消すだけ。

(function() {
  'use strict';

  var SAMPLE_TEXTS = [
    "週次計画を立てる", "メール整理", "資料レビュー", "顧客との打ち合わせ",
    "請求書発行", "経費精算", "ブログ記事執筆", "ジムでトレーニング",
    "読書: 経営の本", "デザイン案の作成", "プレゼン資料修正", "確定申告書類整理",
    "歯医者の予約", "美容院", "両親に電話", "家計簿入力",
    "プログラミング学習", "英会話レッスン", "資格試験の勉強", "オンラインセミナー受講",
    "新規顧客へメール", "見積書送付", "契約書確認", "請求書送付",
    "ホームページ更新", "SNS投稿", "在庫確認", "発注作業",
    "週末の予定確認", "旅行の計画を立てる", "本を読む", "映画を見る",
    "料理: 新しいレシピ", "掃除: リビング", "洗濯", "ゴミ出し",
    "銀行で振込", "コンビニで支払い", "ヨガクラス", "ランニング 5km",
    "家族と食事", "友人とランチ", "親戚への手紙", "誕生日プレゼント選び",
    "プロジェクト企画書", "週報を書く", "月次レポート提出", "1on1ミーティング",
    "コードレビュー", "バグ修正", "新機能の実装", "テスト実行",
    "メンタル休息日", "瞑想 10分", "日記を書く", "アイデアメモ整理",
    "本を返却", "図書館で借りる", "車の点検", "保険更新",
    "プレゼン本番", "提案書納品", "クライアント訪問", "デモ準備"
  ];

  // 再現性のある疑似乱数（seed ベース）
  function seededRandom(seed) {
    var x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function generateSampleTasks() {
    var tasks = [];
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var idCounter = 0;

    for (var daysAgo = 0; daysAgo < 365; daysAgo++) {
      var date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      var dateStr = formatDate(date);
      var dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
      var isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      // その日のタスク数を決定
      var rand = seededRandom(daysAgo * 7 + 1);
      var numTasks;
      if (rand < 0.12) numTasks = 0;
      else if (rand < 0.45) numTasks = 1 + Math.floor(seededRandom(daysAgo + 11) * 3);
      else if (rand < 0.85) numTasks = 3 + Math.floor(seededRandom(daysAgo + 23) * 3);
      else numTasks = 6 + Math.floor(seededRandom(daysAgo + 37) * 3);

      if (isWeekend) numTasks = Math.floor(numTasks * 0.5);

      for (var i = 0; i < numTasks; i++) {
        var textIdx = Math.floor(seededRandom(daysAgo * 100 + i * 13) * SAMPLE_TEXTS.length);
        var willR = seededRandom(daysAgo * 1000 + i * 31);
        var canR = seededRandom(daysAgo * 1000 + i * 31 + 1);
        var mustR = seededRandom(daysAgo * 1000 + i * 31 + 2);

        tasks.push({
          id: 'sample_' + (idCounter++),
          text: SAMPLE_TEXTS[textIdx],
          category: 'done',
          order: i,
          completed: true,
          completedDate: dateStr,
          parentId: null,
          children: [],
          createdAt: dateStr + 'T09:00:00.000Z',
          flags: {
            will: willR > 0.55,
            can: canR > 0.30,
            must: mustR > 0.45
          }
        });
      }
    }

    return tasks;
  }

  window.SAMPLE_ARCHIVE_TASKS = generateSampleTasks();
})();
