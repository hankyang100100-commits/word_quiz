/* GRE 單字本：單字區 / 抽考區 / 新增單字 */
(() => {
  'use strict';

  /* ========== 設定 ========== */
  const STORAGE_KEY = 'gre-vocab-words-v1';
  const SEED_URL = 'gre_words.json';
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const COUNT_OPTIONS = [10, 20, 30, 'all'];
  // 除了 A–Z 之外的特殊篩選鍵：自己打的單字
  const MINE = 'MINE';
  const LETTER_LABEL = { ALL: '全部', MINE: '自己打的' };
  // 劍橋辭典（英漢繁體）的基底網址，後面接上英文單字即可
  const DICT_BASE = 'https://dictionary.cambridge.org/zht/%E8%A9%9E%E5%85%B8/%E8%8B%B1%E8%AA%9E-%E6%BC%A2%E8%AA%9E-%E7%B9%81%E9%AB%94/';

  const ICONS = {
    speaker: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };

  const icon = (name) =>
    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  /* ========== 狀態 ========== */
  const state = {
    words: [], // { id, word, definition, note, saved, image }
    letter: 'A', // 'ALL' 或 A-Z
    filter: 'all', // 'all' 或 'saved'
    query: '',
    editingId: null,
    pendingImageId: null,
    quizLetters: new Set([...LETTERS, MINE]),
    quizCount: 10,
    quizPanel: 'setup', // 'setup' | 'play' | 'result'
    quiz: null,
  };
  let seedError = false;
  let saveTimer = null;
  let toastTimer = null;

  /* ========== DOM ========== */
  const $ = (id) => document.getElementById(id);
  const els = {
    banner: $('banner'),
    search: $('search'),
    letters: $('letters'),
    searchHint: $('search-hint'),
    filterAll: $('filter-all'),
    filterSaved: $('filter-saved'),
    countAll: $('count-all'),
    countSaved: $('count-saved'),
    wordList: $('word-list'),

    quizLetters: $('quiz-letters'),
    quizAll: $('quiz-all'),
    quizNone: $('quiz-none'),
    quizPoolInfo: $('quiz-pool-info'),
    quizCount: $('quiz-count'),
    quizWarn: $('quiz-warn'),
    quizStart: $('quiz-start'),
    quizSetup: $('quiz-setup'),
    quizPlay: $('quiz-play'),
    quizResult: $('quiz-result'),
    qProgress: $('q-progress'),
    qScore: $('q-score'),
    qBar: $('q-bar'),
    qWord: $('q-word'),
    qSpeak: $('q-speak'),
    qOptions: $('q-options'),
    qFeedback: $('q-feedback'),
    qNext: $('q-next'),
    qQuit: $('q-quit'),
    rScore: $('r-score'),
    rWrongTitle: $('r-wrong-title'),
    rWrong: $('r-wrong'),
    rAgain: $('r-again'),
    rBack: $('r-back'),

    addForm: $('add-form'),
    addRows: $('add-rows'),
    addRowBtn: $('add-row'),
    exportBtn: $('export-btn'),
    importBtn: $('import-btn'),
    importInput: $('import-input'),
    loadSeedBtn: $('load-seed-btn'),
    clearBtn: $('clear-btn'),

    imageInput: $('image-input'),
    toast: $('toast'),

    qrMake: $('qr-make'),
    qrScan: $('qr-scan'),
    qrFile: $('qr-file'),
    qrOutput: $('qr-output'),
    qrFileInput: $('qr-file-input'),
    scanPanel: $('scan-panel'),
    scanVideo: $('scan-video'),
    scanStatus: $('scan-status'),
    scanCancel: $('scan-cancel'),
    scanCanvas: $('scan-canvas'),
  };

  /* ========== 工具函式 ========== */
  // 元素不存在時略過（避免 HTML 與 JS 版本不一致時整個網頁無法啟動）
  const on = (el, type, fn) => {
    if (el) el.addEventListener(type, fn);
  };

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const keyOf = (s) => String(s).trim().toLowerCase();

  // 例如 "look up" → .../look-up；字母統一小寫、空白換成連字號
  const dictUrl = (word) =>
    DICT_BASE + encodeURIComponent(String(word).trim().toLowerCase().replace(/\s+/g, '-'));

  const initialOf = (s) => {
    const c = String(s).trim().charAt(0).toUpperCase();
    return /^[A-Z]$/.test(c) ? c : '#';
  };

  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const findWord = (id) => state.words.find((w) => w.id === Number(id));

  // 自己打的單字：不是來自 gre_words.json 的種子單字
  const isMine = (w) => w.source !== 'seed';

  // 依加入時間排序（先加的在前）；時間相同時依 id 排
  const byAddedTime = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.id - b.id;

  /* ========== 儲存 ========== */
  function readStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.words));
      return true;
    } catch {
      showToast('儲存空間已滿（多半是圖片太多）。請先匯出備份，再刪除部分圖片。', 5000);
      return false;
    }
  }

  // 筆記打字時不要每個字都寫入，延遲 400ms 再存
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  /**
   * 把一批單字加入單字本。
   * - 單字重複（不分大小寫）就略過，並回傳略過清單
   * - id 缺少或重複時自動配新號碼
   */
  function insertWords(list) {
    const keys = new Set(state.words.map((w) => keyOf(w.word)));
    const ids = new Set(state.words.map((w) => w.id));
    let nextId = Math.max(0, ...ids) + 1;
    const result = { added: 0, skipped: [], invalid: 0 };
    const addedKeys = [];

    for (const raw of list) {
      const word = String(raw?.word ?? '').trim();
      const definition = String(raw?.definition ?? '').trim();
      if (!word || !definition) {
        result.invalid++;
        continue;
      }
      const key = keyOf(word);
      if (keys.has(key)) {
        result.skipped.push(word);
        continue;
      }
      keys.add(key);

      let id = Number(raw.id);
      if (!Number.isInteger(id) || id <= 0 || ids.has(id)) {
        while (ids.has(nextId)) nextId++;
        id = nextId++;
      }
      ids.add(id);

      state.words.push({
        id,
        word,
        definition,
        note: String(raw.note ?? ''),
        saved: Boolean(raw.saved),
        source: raw.source === 'seed' || raw.source === 'user' ? raw.source : undefined,
        image: typeof raw.image === 'string' ? raw.image : null,
        createdAt: Number(raw.createdAt) > 0 ? Number(raw.createdAt) : Date.now(),
      });
      addedKeys.push(key);
      result.added++;
    }

    if (result.added) {
      saveNow();
      writeDeleted(readDeleted().filter((k) => !addedKeys.includes(k)));
    }
    return result;
  }

  // 記錄使用者刪除過的單字，避免每次開頁時 gre_words.json 又把它們加回來
  const DELETED_KEY = 'gre-vocab-deleted-v1';

  function readDeleted() {
    try {
      return JSON.parse(localStorage.getItem(DELETED_KEY)) || [];
    } catch {
      return [];
    }
  }

  function writeDeleted(keys) {
    try {
      localStorage.setItem(DELETED_KEY, JSON.stringify([...new Set(keys)]));
    } catch {
      /* 忽略：只影響刪除記錄 */
    }
  }

  function rememberDeleted(word) {
    writeDeleted([...readDeleted(), keyOf(word)]);
  }

  async function fetchBundle() {
    const res = await fetch(SEED_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.words;
    if (!Array.isArray(list)) throw new Error('JSON 格式不符');
    return list;
  }

  async function loadBundledWords({ fromSeed = false } = {}) {
    const list = await fetchBundle();
    const skip = new Set(fromSeed ? readDeleted() : []);
    return insertWords(
      list
        .filter((w) => !skip.has(keyOf(String(w?.word ?? ''))))
        .map((w) => ({ ...w, source: 'seed' }))
    );
  }

  /* ========== 通知、朗讀、圖片 ========== */
  function showToast(msg, ms = 2600) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      showToast('這個瀏覽器不支援朗讀功能');
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  // 把圖片縮小並轉成 JPEG，避免撐爆 localStorage
  function compressImage(file, maxWidth = 720) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('圖片讀取失敗'));
      };
      img.src = url;
    });
  }

  /* ========== 視圖切換與整體渲染 ========== */
  function showView(name) {
    document.querySelectorAll('.tab').forEach((tab) => {
      const on = tab.dataset.view === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.view').forEach((sec) => {
      sec.classList.toggle('is-active', sec.id === `view-${name}`);
    });

    if (name !== 'add') stopScanner();
    if (name === 'browse') renderBrowse();
    if (name === 'quiz' && state.quizPanel === 'setup') renderQuizSetup();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAll() {
    renderBrowse();
    renderBanner();
    if (state.quizPanel === 'setup') renderQuizSetup();
  }

  function renderBanner() {
    if (state.words.length > 0) {
      els.banner.classList.add('hidden');
      return;
    }
    els.banner.innerHTML = seedError
      ? '無法自動讀取 <code>gre_words.json</code>。直接雙擊開啟網頁時，瀏覽器會擋下讀取本機檔案的請求。請到「新增單字」→「資料管理」按「匯入 JSON」選擇這個檔案；或在資料夾中執行 <code>python -m http.server</code>，再用 <code>http://localhost:8000</code> 開啟。'
      : '單字本是空的，到「新增單字」開始加入你的第一個單字。';
    els.banner.classList.remove('hidden');
  }

  /* ========== 單字區 ========== */
  function renderBrowse() {
    renderLetters();
    renderCounts();
    renderList();
  }

  function renderLetters() {
    const hasWords = new Set(state.words.map((w) => initialOf(w.word)));
    const hasMine = state.words.some(isMine);
    els.letters.innerHTML = ['ALL', ...LETTERS, MINE]
      .map((l) => {
        const active = state.letter === l;
        const empty = l === MINE ? !hasMine : l !== 'ALL' && !hasWords.has(l);
        const wide = l === 'ALL' || l === MINE;
        const classes = ['letter', wide ? 'wide' : '', active ? 'is-active' : '', empty ? 'is-empty' : '']
          .filter(Boolean)
          .join(' ');
        return `<button class="${classes}" type="button" data-letter="${l}" aria-pressed="${active}">${LETTER_LABEL[l] || l}</button>`;
      })
      .join('');
  }

  function renderCounts() {
    els.countAll.textContent = `(${state.words.length})`;
    els.countSaved.textContent = `(${state.words.filter((w) => w.saved).length})`;

    const isAll = state.filter === 'all';
    els.filterAll.classList.toggle('is-active', isAll);
    els.filterAll.setAttribute('aria-pressed', String(isAll));
    els.filterSaved.classList.toggle('is-active', !isAll);
    els.filterSaved.setAttribute('aria-pressed', String(!isAll));
  }

  function visibleWords() {
    const q = state.query.trim().toLowerCase();
    // 「自己打的」篩選時改用加入時間排序；搜尋中仍維持字母順序
    const byTime = !q && state.letter === MINE;
    return state.words
      .filter((w) => {
        if (state.filter === 'saved' && !w.saved) return false;
        if (q) return w.word.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q);
        if (state.letter === 'ALL') return true;
        if (state.letter === MINE) return isMine(w);
        return initialOf(w.word) === state.letter;
      })
      .sort(byTime ? byAddedTime : (a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase(), 'en'));
  }

  function renderList() {
    const q = state.query.trim();
    const list = visibleWords();

    els.searchHint.classList.toggle('hidden', !q);
    els.searchHint.textContent = q ? `搜尋「${q}」，範圍為全部字母，共 ${list.length} 筆` : '';

    if (!list.length) {
      els.wordList.innerHTML = `<div class="empty">${emptyMessage()}</div>`;
      return;
    }
    els.wordList.innerHTML = list.map(cardHTML).join('');
  }

  function emptyMessage() {
    if (state.query.trim()) return '找不到符合的單字';
    if (state.filter === 'saved') return '還沒有儲存的單字，點卡片上的書籤圖示即可收藏';
    if (state.letter === MINE) return '還沒有自己加入的單字，到「新增單字」加入吧';
    if (state.letter === 'ALL') return '單字本還是空的，到「新增單字」加入第一個吧';
    return `${state.letter} 開頭還沒有單字，到「新增單字」加入吧`;
  }

  function cardHTML(w) {
    const editing = state.editingId === w.id;

    const head = editing
      ? `
        <div class="edit-fields">
          <input class="input" data-field="word" value="${esc(w.word)}" aria-label="英文單字" />
          <input class="input" data-field="definition" value="${esc(w.definition)}" aria-label="中文解釋" />
          <div class="edit-actions">
            <button class="ghost small" type="button" data-action="cancel-edit">取消</button>
            <button class="primary small" type="button" data-action="save-edit">儲存</button>
          </div>
        </div>`
      : `
        <h3 class="card-word"><a href="${esc(dictUrl(w.word))}" target="_blank" rel="noopener noreferrer" title="在劍橋辭典查看">${esc(w.word)}</a></h3>
        <p class="card-def">${esc(w.definition)}</p>
        <div class="card-tools">
          <button class="icon-btn" type="button" data-action="speak" title="朗讀" aria-label="朗讀">${icon('speaker')}</button>
          <button class="icon-btn${w.saved ? ' is-on' : ''}" type="button" data-action="toggle-save"
            title="${w.saved ? '取消儲存' : '儲存單字'}" aria-label="${w.saved ? '取消儲存' : '儲存單字'}" aria-pressed="${w.saved}">${icon('bookmark')}</button>
          <button class="icon-btn" type="button" data-action="edit" title="編輯" aria-label="編輯">${icon('edit')}</button>
          <button class="icon-btn danger" type="button" data-action="delete" title="刪除" aria-label="刪除">${icon('trash')}</button>
        </div>`;

    const image = w.image
      ? `
        <div class="thumb">
          <img src="${esc(w.image)}" alt="${esc(w.word)} 的圖片" />
          <div><button class="ghost small" type="button" data-action="remove-image">移除圖片</button></div>
        </div>`
      : '';

    return `
      <article class="card${w.source === 'seed' ? '' : ' is-mine'}" data-id="${w.id}">
        <div class="card-head">${head}</div>
        <div class="card-body">
          <textarea class="note" data-action="note" placeholder="點此輸入補充句子、用法或筆記…" aria-label="筆記">${esc(w.note)}</textarea>
          ${image}
          <div class="card-foot">
            <button class="ghost small with-icon" type="button" data-action="upload">${icon('image')}上傳圖片</button>
          </div>
        </div>
      </article>`;
  }

  function saveEdit(card, w) {
    const word = card.querySelector('[data-field="word"]').value.trim();
    const definition = card.querySelector('[data-field="definition"]').value.trim();
    if (!word || !definition) {
      showToast('單字和解釋都要填寫');
      return;
    }
    const dup = state.words.find((x) => x.id !== w.id && keyOf(x.word) === keyOf(word));
    if (dup) {
      showToast(`單字本已經有「${dup.word}」了`);
      return;
    }
    w.word = word;
    w.definition = definition;
    state.editingId = null;
    saveNow();
    renderAll();
  }

  function onListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const w = findWord(card.dataset.id);
    if (!w) return;

    switch (btn.dataset.action) {
      case 'speak':
        speak(w.word);
        break;
      case 'toggle-save':
        w.saved = !w.saved;
        saveNow();
        renderBrowse();
        break;
      case 'edit':
        state.editingId = w.id;
        renderList();
        els.wordList.querySelector('[data-field="word"]')?.focus();
        break;
      case 'cancel-edit':
        state.editingId = null;
        renderList();
        break;
      case 'save-edit':
        saveEdit(card, w);
        break;
      case 'delete':
        if (!confirm(`確定要刪除「${w.word}」嗎？`)) break;
        rememberDeleted(w.word);
        state.words = state.words.filter((x) => x.id !== w.id);
        if (state.editingId === w.id) state.editingId = null;
        saveNow();
        renderAll();
        break;
      case 'upload':
        state.pendingImageId = w.id;
        els.imageInput.click();
        break;
      case 'remove-image':
        w.image = null;
        saveNow();
        renderList();
        break;
    }
  }

  function onListKeydown(e) {
    if (e.key !== 'Enter' || e.isComposing || !e.target.dataset.field) return;
    e.preventDefault();
    const card = e.target.closest('[data-id]');
    const w = findWord(card.dataset.id);
    if (w) saveEdit(card, w);
  }

  function onNoteInput(e) {
    if (e.target.dataset.action !== 'note') return;
    const w = findWord(e.target.closest('[data-id]').dataset.id);
    if (!w) return;
    w.note = e.target.value;
    saveSoon();
  }

  async function onImagePicked() {
    const file = els.imageInput.files[0];
    const w = findWord(state.pendingImageId);
    els.imageInput.value = '';
    state.pendingImageId = null;
    if (!file || !w) return;
    if (!file.type.startsWith('image/')) {
      showToast('請選擇圖片檔案');
      return;
    }
    try {
      w.image = await compressImage(file);
      saveNow();
      renderList();
      showToast('圖片已加入');
    } catch (err) {
      showToast(err.message);
    }
  }

  /* ========== 抽考區 ========== */
  function quizPool() {
    // 選了某個字母，或選了「自己打的」且該單字是自己加入的，就納入抽考
    return state.words.filter(
      (w) => state.quizLetters.has(initialOf(w.word)) || (state.quizLetters.has(MINE) && isMine(w))
    );
  }

  function renderQuizSetup() {
    els.quizLetters.innerHTML = [...LETTERS, MINE].map((l) => {
      const on = state.quizLetters.has(l);
      const mine = l === MINE ? ' mine' : '';
      return `<button class="letter${mine}${on ? ' is-active' : ''}" type="button" data-letter="${l}" aria-pressed="${on}">${LETTER_LABEL[l] || l}</button>`;
    }).join('');

    els.quizCount.innerHTML = COUNT_OPTIONS.map((c) => {
      const on = state.quizCount === c;
      const label = c === 'all' ? '全部' : `${c} 題`;
      return `<button class="chip${on ? ' is-active' : ''}" type="button" data-count="${c}" aria-pressed="${on}">${label}</button>`;
    }).join('');

    const pool = quizPool();
    const total = state.words.length;
    els.quizPoolInfo.textContent = `符合條件的單字：${pool.length} 個`;
    els.quizStart.disabled = total < 2 || pool.length === 0;

    let warn = '';
    if (total < 2) warn = '單字本至少需要 2 個單字才能抽考。';
    else if (total < 4) warn = `目前只有 ${total} 個單字，選項數量會比較少。`;
    els.quizWarn.textContent = warn;
    els.quizWarn.classList.toggle('hidden', !warn);
  }

  function showQuizPanel(name) {
    state.quizPanel = name;
    els.quizSetup.classList.toggle('hidden', name !== 'setup');
    els.quizPlay.classList.toggle('hidden', name !== 'play');
    els.quizResult.classList.toggle('hidden', name !== 'result');
  }

  /**
   * 題目結構：
   * - 目標單字的解釋 = 你自己寫的正確答案
   * - 其餘三個選項 = 單字本裡其他單字的解釋（不重複、不等於正確答案）
   */
  function buildQuestion(target) {
    const correct = target.definition;
    const used = new Set([keyOf(correct)]);
    const distractors = [];

    for (const w of shuffle(state.words)) {
      if (w.id === target.id) continue;
      const k = keyOf(w.definition);
      if (used.has(k)) continue;
      used.add(k);
      distractors.push(w.definition);
      if (distractors.length === 3) break;
    }

    return {
      word: target,
      correct,
      options: shuffle([correct, ...distractors]),
      picked: null,
    };
  }

  function startQuiz() {
    if (state.words.length < 2) {
      showToast('單字本至少需要 2 個單字才能抽考');
      return;
    }
    const pool = shuffle(quizPool());
    if (!pool.length) {
      showToast('這些字母沒有單字，請選擇其他字母');
      return;
    }
    const n = state.quizCount === 'all' ? pool.length : Math.min(state.quizCount, pool.length);

    state.quiz = {
      items: pool.slice(0, n).map(buildQuestion),
      index: 0,
      score: 0,
      wrong: [],
    };
    showQuizPanel('play');
    renderQuestion();
  }

  function renderQuestion() {
    const { items, index, score } = state.quiz;
    const q = items[index];

    els.qProgress.textContent = `第 ${index + 1} / ${items.length} 題`;
    els.qScore.textContent = `答對 ${score}`;
    els.qBar.style.width = `${(index / items.length) * 100}%`;
    els.qWord.textContent = q.word.word;
    els.qOptions.innerHTML = q.options
      .map((opt, i) => `<button class="option" type="button" data-index="${i}"><span class="key">${i + 1}</span><span>${esc(opt)}</span></button>`)
      .join('');
    els.qFeedback.classList.add('hidden');
    els.qNext.classList.add('hidden');
  }

  function answer(i) {
    const quiz = state.quiz;
    if (!quiz) return;
    const q = quiz.items[quiz.index];
    if (q.picked !== null || i < 0 || i >= q.options.length) return;

    q.picked = i;
    const ok = q.options[i] === q.correct;
    if (ok) quiz.score += 1;
    else quiz.wrong.push(q);

    els.qOptions.querySelectorAll('.option').forEach((btn, j) => {
      btn.disabled = true;
      if (q.options[j] === q.correct) btn.classList.add('is-correct');
      else if (j === i) btn.classList.add('is-wrong');
    });

    const target = q.word;
    const note = target.note.trim()
      ? `<p class="fb-note">你的筆記：${esc(target.note.trim())}</p>`
      : '';
    const img = target.image
      ? `<img class="fb-img" src="${esc(target.image)}" alt="${esc(target.word)} 的圖片" />`
      : '';

    els.qFeedback.innerHTML = `
      <p class="fb-title ${ok ? 'ok' : 'bad'}">${ok ? '答對了！' : '答錯了'}</p>
      ${ok ? '' : `<p class="fb-answer">正確答案：${esc(q.correct)}</p>`}
      ${note}${img}`;
    els.qFeedback.classList.remove('hidden');

    els.qScore.textContent = `答對 ${quiz.score}`;
    els.qNext.textContent = quiz.index === quiz.items.length - 1 ? '看結果' : '下一題';
    els.qNext.classList.remove('hidden');
  }

  function nextQuestion() {
    const quiz = state.quiz;
    if (!quiz || quiz.items[quiz.index].picked === null) return;
    quiz.index += 1;
    if (quiz.index >= quiz.items.length) {
      showResult();
      return;
    }
    renderQuestion();
  }

  function showResult() {
    const { score, items, wrong } = state.quiz;
    const pct = Math.round((score / items.length) * 100);

    els.rScore.textContent = `${score} / ${items.length}（${pct}%）`;
    els.rWrongTitle.classList.toggle('hidden', wrong.length === 0);
    els.rWrong.innerHTML = wrong.length
      ? wrong.map((q) => `<li><strong>${esc(q.word.word)}</strong><span>${esc(q.correct)}</span></li>`).join('')
      : '<li class="all-right">全部答對，太棒了！</li>';

    showQuizPanel('result');
  }

  function backToSetup() {
    state.quiz = null;
    showQuizPanel('setup');
    renderQuizSetup();
  }

  function onQuizKey(e) {
    if (state.quizPanel !== 'play' || !state.quiz) return;
    if (!els.quizPlay.closest('.view').classList.contains('is-active')) return;
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, textarea, select')) return;
    // 焦點在按鈕上時，交給瀏覽器原生的 Enter / Space 處理，避免重複觸發
    if (e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;

    const q = state.quiz.items[state.quiz.index];
    if (!q) return;

    if (q.picked === null && /^[1-9]$/.test(e.key)) {
      answer(Number(e.key) - 1);
    } else if (q.picked !== null && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      nextQuestion();
    }
  }

  /* ========== 新增單字 ========== */
  function addRow(prefill = {}) {
    const row = document.createElement('div');
    row.className = 'add-row';
    row.innerHTML = `
      <input class="input" name="word" placeholder="英文單字，例如 abate" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="英文單字" />
      <input class="input" name="definition" placeholder="你寫的中文解釋" autocomplete="off" aria-label="中文解釋" />
      <button type="button" class="icon-btn danger" data-remove title="移除這一列" aria-label="移除這一列">${icon('x')}</button>`;
    row.querySelector('[name="word"]').value = prefill.word || '';
    row.querySelector('[name="definition"]').value = prefill.definition || '';
    els.addRows.appendChild(row);
    return row;
  }

  function resetAddRows() {
    els.addRows.innerHTML = '';
    addRow();
  }

  function onAddRowsKeydown(e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    e.preventDefault();

    const row = input.closest('.add-row');
    if (input.name === 'word') {
      row.querySelector('[name="definition"]').focus();
      return;
    }
    const next = row.nextElementSibling;
    if (next) next.querySelector('[name="word"]').focus();
    else addRow().querySelector('[name="word"]').focus();
  }

  function onRemoveRow(e) {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    btn.closest('.add-row').remove();
    if (!els.addRows.children.length) addRow();
  }

  function onSubmitWords(e) {
    e.preventDefault();
    const entries = [];
    let broken = false;

    for (const row of els.addRows.querySelectorAll('.add-row')) {
      const word = row.querySelector('[name="word"]').value.trim();
      const definition = row.querySelector('[name="definition"]').value.trim();
      row.classList.remove('has-error');

      if (!word && !definition) continue;
      if (!word || !definition) {
        row.classList.add('has-error');
        broken = true;
        continue;
      }
      entries.push({ word, definition });
    }

    if (broken) {
      showToast('紅色的列還缺單字或解釋，補齊後再加入');
      return;
    }
    if (!entries.length) {
      showToast('還沒有填入任何單字');
      return;
    }

    const r = insertWords(entries.map((e) => ({ ...e, source: 'user' })));
    resetAddRows();
    renderAll();
    els.addRows.querySelector('[name="word"]').focus();

    const lines = [`已加入 ${r.added} 個單字`];
    if (r.skipped.length) lines.push(`單字本已有，略過：${r.skipped.join('、')}`);
    showToast(lines.join('\n'), r.skipped.length ? 5000 : 2600);
  }

  /* ========== 資料管理 ========== */
  function exportBackup() {
    const blob = new Blob([JSON.stringify(state.words, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gre_words_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function onImportPicked() {
    const file = els.importInput.files[0];
    els.importInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.words;
      if (!Array.isArray(list)) throw new Error('找不到單字陣列');
      const r = insertWords(list.map((w) => ({ source: 'seed', ...w })));
      renderAll();
      const lines = [`匯入完成：新增 ${r.added} 個`];
      if (r.skipped.length) lines.push(`略過重複 ${r.skipped.length} 個`);
      if (r.invalid) lines.push(`缺少單字或解釋 ${r.invalid} 筆，已忽略`);
      showToast(lines.join('\n'), 4500);
    } catch (err) {
      showToast(`匯入失敗：${err.message}`, 4000);
    }
  }

  /* ========== 掃碼同步（不需帳號，只傳單字與解釋） ========== */
  // 每張 QR 的內容格式：GRE1|掃描批次ID|第幾張|總張數|資料片段
  const QR_PREFIX = 'GRE1';
  const QR_CHUNK_CHARS = 700; // 每張約 700 字，UTF-8 下遠低於 QR 上限
  const QR_HEADER_RE = /^GRE1\|([a-z0-9]+)\|(\d+)\|(\d+)\|([\s\S]*)$/;

  function generateSyncQRs() {
    if (!state.words.length) {
      showToast('單字本是空的，沒有可以產生的內容');
      return;
    }
    if (typeof qrcode !== 'function') {
      showToast('QR 產生程式載入失敗，請確認網路連線');
      return;
    }

    const payload = JSON.stringify(state.words.map((w) => ({ word: w.word, definition: w.definition, source: w.source })));
    const chars = Array.from(payload); // 以字元切分，避免把 emoji 等字元切壞
    const parts = [];
    for (let i = 0; i < chars.length; i += QR_CHUNK_CHARS) {
      parts.push(chars.slice(i, i + QR_CHUNK_CHARS).join(''));
    }

    const sid = Math.random().toString(36).slice(2, 8);
    const total = parts.length;

    els.qrOutput.innerHTML = `
      <p class="muted">共 ${state.words.length} 個單字，分成 ${total} 張 QR code。用另一台裝置依序掃描即可（順序不限）。</p>
      <div class="qr-grid">
        ${parts
          .map((part, i) => {
            const qr = qrcode(0, 'L');
            qr.addData(`${QR_PREFIX}|${sid}|${i + 1}|${total}|${part}`);
            qr.make();
            return `<figure class="qr-item"><img src="${qr.createDataURL(4, 2)}" alt="同步 QR ${i + 1} / ${total}" /><figcaption>${i + 1} / ${total}</figcaption></figure>`;
          })
          .join('')}
      </div>`;
  }

  // 掃描進度（同一批 QR 的所有片段）
  const scan = { stream: null, timer: null, sid: null, total: 0, chunks: new Map() };

  function resetScanSession() {
    scan.sid = null;
    scan.total = 0;
    scan.chunks = new Map();
  }

  function reportScanProgress() {
    const msg = `已讀取 ${scan.chunks.size} / ${scan.total} 張，請繼續掃描其他 QR code`;
    if (!els.scanPanel.classList.contains('hidden')) els.scanStatus.textContent = msg;
    else showToast(msg);
  }

  // 回傳 true 表示這段文字是本功能的 QR code
  function handleQrText(text) {
    const m = QR_HEADER_RE.exec(text);
    if (!m) return false;
    const [, sid, idxStr, totalStr, part] = m;
    const idx = Number(idxStr);
    const total = Number(totalStr);
    if (!idx || !total || idx > total) return false;

    if (scan.sid !== sid) {
      scan.sid = sid;
      scan.total = total;
      scan.chunks = new Map();
    }
    scan.chunks.set(idx, part);

    if (scan.chunks.size === scan.total) {
      finishScan();
    } else {
      reportScanProgress();
    }
    return true;
  }

  function finishScan() {
    const payload = Array.from({ length: scan.total }, (_, i) => scan.chunks.get(i + 1) ?? '').join('');
    resetScanSession();
    stopScanner();

    try {
      const list = JSON.parse(payload);
      if (!Array.isArray(list)) throw new Error('資料格式不符');
      const r = insertWords(list);
      renderAll();
      const lines = [`掃描匯入完成：新增 ${r.added} 個`];
      if (r.skipped.length) lines.push(`已存在，略過 ${r.skipped.length} 個`);
      showToast(lines.join('\n'), 4500);
    } catch (err) {
      showToast(`匯入失敗：資料不完整或格式錯誤（${err.message}）`, 4500);
    }
  }

  async function startScanner() {
    if (typeof jsQR !== 'function') {
      showToast('QR 掃描程式載入失敗，請確認網路連線');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast('這個瀏覽器無法使用相機，請改用「從 QR 圖片匯入」');
      return;
    }
    try {
      scan.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch {
      showToast('無法開啟相機，請確認已允許相機權限（或改用「從 QR 圖片匯入」）', 4500);
      return;
    }

    els.scanVideo.srcObject = scan.stream;
    await els.scanVideo.play().catch(() => {});
    els.scanStatus.textContent = '將 QR code 對準鏡頭…';
    els.scanPanel.classList.remove('hidden');
    scanTick();
  }

  function scanTick() {
    if (!scan.stream) return;
    const v = els.scanVideo;
    if (v.readyState >= 2 && v.videoWidth) {
      const c = els.scanCanvas;
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const frame = ctx.getImageData(0, 0, c.width, c.height);
      const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
      if (code) handleQrText(code.data);
    }
    scan.timer = setTimeout(scanTick, 120);
  }

  function stopScanner() {
    clearTimeout(scan.timer);
    scan.timer = null;
    if (scan.stream) scan.stream.getTracks().forEach((t) => t.stop());
    scan.stream = null;
    if (els.scanVideo) els.scanVideo.srcObject = null;
    if (els.scanPanel) els.scanPanel.classList.add('hidden');
  }

  function readQrFromFile(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const frame = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(frame.data, frame.width, frame.height);
        URL.revokeObjectURL(url);
        resolve(code ? code.data : null);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  async function onQrFilesPicked() {
    const files = [...els.qrFileInput.files];
    els.qrFileInput.value = '';
    if (!files.length) return;
    if (typeof jsQR !== 'function') {
      showToast('QR 掃描程式載入失敗，請確認網路連線');
      return;
    }

    let found = 0;
    for (const file of files) {
      const text = await readQrFromFile(file);
      if (text && handleQrText(text)) found++;
    }
    if (!found) showToast('這些圖片中找不到 GRE 同步 QR code');
  }

  /* ========== 事件綁定與初始化 ========== */
  function bindEvents() {
    // 分頁
    document.querySelector('.tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) showView(tab.dataset.view);
    });

    // 單字區：搜尋、字母、所有/儲存
    on(els.search, 'input', () => {
      state.query = els.search.value;
      renderList();
    });
    on(els.letters, 'click', (e) => {
      const btn = e.target.closest('[data-letter]');
      if (!btn) return;
      state.letter = btn.dataset.letter;
      state.query = '';
      els.search.value = '';
      renderBrowse();
    });
    on(els.filterAll, 'click', () => {
      state.filter = 'all';
      renderBrowse();
    });
    on(els.filterSaved, 'click', () => {
      state.filter = 'saved';
      renderBrowse();
    });

    // 單字卡片
    on(els.wordList, 'click', onListClick);
    on(els.wordList, 'input', onNoteInput);
    on(els.wordList, 'keydown', onListKeydown);
    on(els.imageInput, 'change', onImagePicked);

    // 抽考區
    on(els.quizLetters, 'click', (e) => {
      const btn = e.target.closest('[data-letter]');
      if (!btn) return;
      const l = btn.dataset.letter;
      if (state.quizLetters.has(l)) state.quizLetters.delete(l);
      else state.quizLetters.add(l);
      renderQuizSetup();
    });
    on(els.quizAll, 'click', () => {
      state.quizLetters = new Set([...LETTERS, MINE]);
      renderQuizSetup();
    });
    on(els.quizNone, 'click', () => {
      state.quizLetters = new Set();
      renderQuizSetup();
    });
    on(els.quizCount, 'click', (e) => {
      const btn = e.target.closest('[data-count]');
      if (!btn) return;
      state.quizCount = btn.dataset.count === 'all' ? 'all' : Number(btn.dataset.count);
      renderQuizSetup();
    });
    on(els.quizStart, 'click', startQuiz);
    on(els.qOptions, 'click', (e) => {
      const btn = e.target.closest('.option');
      if (btn) answer(Number(btn.dataset.index));
    });
    on(els.qNext, 'click', nextQuestion);
    on(els.qSpeak, 'click', () => {
      if (state.quiz) speak(state.quiz.items[state.quiz.index].word.word);
    });
    on(els.qQuit, 'click', backToSetup);
    on(els.rAgain, 'click', startQuiz);
    on(els.rBack, 'click', backToSetup);
    document.addEventListener('keydown', onQuizKey);

    // 新增單字
    on(els.addRowBtn, 'click', () => addRow().querySelector('[name="word"]').focus());
    on(els.addRows, 'keydown', onAddRowsKeydown);
    on(els.addRows, 'click', onRemoveRow);
    on(els.addForm, 'submit', onSubmitWords);

    // 資料管理
    on(els.exportBtn, 'click', exportBackup);
    on(els.importBtn, 'click', () => els.importInput.click());
    on(els.importInput, 'change', onImportPicked);
    on(els.loadSeedBtn, 'click', async () => {
      try {
        const r = await loadBundledWords();
        renderAll();
        showToast(`載入完成：新增 ${r.added} 個，略過重複 ${r.skipped.length} 個`, 4000);
      } catch {
        showToast('無法讀取 gre_words.json，請改用「匯入 JSON」，或用本機伺服器開啟。', 5000);
      }
    });
    on(els.clearBtn, 'click', () => {
      if (!state.words.length) return;
      if (!confirm('確定要清空所有單字、筆記與圖片嗎？建議先匯出備份。')) return;
      writeDeleted(state.words.map((w) => keyOf(w.word)));
      state.words = [];
      state.editingId = null;
      saveNow();
      renderAll();
      showToast('已清空單字本');
    });

    // 掃碼同步
    on(els.qrMake, 'click', generateSyncQRs);
    on(els.qrScan, 'click', startScanner);
    on(els.qrFile, 'click', () => els.qrFileInput.click());
    on(els.qrFileInput, 'change', onQrFilesPicked);
    on(els.scanCancel, 'click', () => {
      stopScanner();
      resetScanSession();
      showToast('已取消掃描');
    });

    // 離開頁面前把還沒寫入的筆記存好
    window.addEventListener('beforeunload', () => {
      if (saveTimer) saveNow();
    });
  }

  async function init() {
    bindEvents();

    // 先取得 gre_words.json，用來判斷舊資料裡哪些是種子單字
    let bundle = null;
    try {
      bundle = await fetchBundle();
    } catch {
      seedError = true;
    }

    const stored = readStorage();
    if (Array.isArray(stored)) {
      const seedKeys = new Set((bundle || []).map((w) => keyOf(String(w?.word ?? ''))));
      insertWords(
        stored.map((w) => {
          if (!w || w.source !== undefined) return w;
          return seedKeys.has(keyOf(String(w.word ?? ''))) ? { ...w, source: 'seed' } : w;
        })
      );
    }

    if (bundle) {
      const skip = new Set(readDeleted());
      insertWords(
        bundle
          .filter((w) => !skip.has(keyOf(String(w?.word ?? ''))))
          .map((w) => ({ ...w, source: 'seed' }))
      );
    }

    resetAddRows();
    renderAll();
  }

  init();
})();
