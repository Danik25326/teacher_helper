// ── CONFIG ──────────────────────────────────────────────────────
const API_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_VISION = 'qwen/qwen3.6-27b';      // Фото — тільки Qwen підтримує масив
const MODEL_TEXT   = 'openai/gpt-oss-120b';   // Текст — строго рядок

const TOKENS_PER_PHOTO_EST = 1200;
const DAILY_LIMIT          = 200000;

// ── СТАН ────────────────────────────────────────────────────────
let state = {
  textbookPages : [],
  textbookLoaded: false,
  workType      : 'homework',
  totalTokens   : 0,
  worksChecked  : 0,
  lastTokens    : 0,
};

const $ = id => document.getElementById(id);

// ── DOM LISTENERS ────────────────────────────────────────────────
$('load-textbook-btn').addEventListener('click', loadTextbook);

$('textbook-upload').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const nameEl = $('textbook-filename');
  if (nameEl) nameEl.textContent = f.name;
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.workType = tab.dataset.type;
  });
});

[1, 2, 3].forEach(n => {
  $(`sheet-${n}`).addEventListener('change', e => handleSheet(n, e.target.files[0]));
});

$('check-btn').addEventListener('click', checkWork);
$('next-btn').addEventListener('click', resetForNext);

// ── ПІДРУЧНИК ────────────────────────────────────────────────────
async function loadTextbook() {
  const files = $('textbook-upload').files;
  if (!files.length) {
    showStatus('textbook-status', 'Спочатку виберіть файл підручника.', 'error');
    return;
  }

  const file = files[0];
  state.textbookPages = [];
  state.textbookLoaded = false;

  if (file.type === 'application/pdf') {
    await loadPDF(file);
  } else if (file.type.startsWith('image/')) {
    showStatus('textbook-status', '⏳ Завантаження зображення…', 'loading');
    const b64 = await toBase64(file);
    if (!b64) { showStatus('textbook-status', '❌ Не вдалося прочитати файл.', 'error'); return; }
    state.textbookPages.push({ b64, mime: file.type });
    state.textbookLoaded = true;
    renderTextbookPreviews();
    showStatus('textbook-status', '✅ Завантажено 1 сторінку.', 'success');
  } else {
    showStatus('textbook-status', '⚠️ Підтримуються PDF та зображення (JPG/PNG).', 'error');
  }
}

async function loadPDF(file) {
  showStatus('textbook-status', '⏳ Читаю PDF…', 'loading');

  const wrap = $('pdf-progress-wrap');
  const bar  = $('pdf-progress-bar');
  const txt  = $('pdf-progress-text');

  if (wrap) wrap.classList.remove('hidden');
  if (bar)  bar.style.width = '0%';
  if (txt)  txt.textContent = 'Відкриваю файл…';

  try {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('pdf.js не завантажився. Перевірте інтернет і оновіть сторінку.');
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdfDoc.numPages;

    if (txt) txt.textContent = `Знайдено ${totalPages} сторінок. Рендерю…`;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;

      const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      state.textbookPages.push({ b64, mime: 'image/jpeg' });

      const pct = Math.round((i / totalPages) * 100);
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.textContent = `Сторінка ${i} з ${totalPages}…`;
      await new Promise(r => setTimeout(r, 0));
    }

    state.textbookLoaded = true;
    if (wrap) wrap.classList.add('hidden');
    renderTextbookPreviews();
    showStatus('textbook-status', `✅ PDF завантажено: ${totalPages} сторінок.`, 'success');

  } catch (err) {
    if (wrap) wrap.classList.add('hidden');
    showStatus('textbook-status', `❌ Помилка: ${err.message}`, 'error');
  }
}

function renderTextbookPreviews() {
  const grid = $('textbook-preview');
  if (!grid) return;
  grid.innerHTML = '';
  state.textbookPages.slice(0, 6).forEach((pg, i) => {
    const img = document.createElement('img');
    img.src = `data:${pg.mime};base64,${pg.b64}`;
    img.title = `Сторінка ${i + 1}`;
    grid.appendChild(img);
  });
  if (state.textbookPages.length > 6) {
    const more = document.createElement('div');
    more.className = 'preview-more';
    more.textContent = `+${state.textbookPages.length - 6} стор.`;
    grid.appendChild(more);
  }
}

// ── АРКУШІ УЧНЯ ──────────────────────────────────────────────────
function handleSheet(n, file) {
  if (!file) return;
  const preview = $(`preview-${n}`);
  if (preview) {
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
  }
  // Підсвічуємо кнопку цього слота
  const btns = document.querySelectorAll('.sheet-btn');
  if (btns[n - 1]) {
    btns[n - 1].classList.add('has-file');
    btns[n - 1].textContent = `✅ ${file.name.slice(0, 20)}`;
  }
}

// ── ПЕРЕВІРКА ────────────────────────────────────────────────────
async function checkWork() {
  const sheets = getSheetFiles();
  if (!sheets.length) {
    alert('Додайте хоча б одне фото роботи учня.');
    return;
  }

  $('results-area').classList.remove('hidden');
  $('loading-spinner').classList.remove('hidden');
  $('result-body').classList.add('hidden');
  $('next-btn').classList.add('hidden');

  try {
    const apiKey = getApiKey();
    if (!apiKey) { alert('Додайте API ключ у файл config.js'); return; }

    const sheetImages = [];
    for (const f of sheets) {
      const b64 = await toBase64(f);
      if (!b64) throw new Error(`Не вдалося прочитати: ${f.name}`);
      sheetImages.push({ b64, mime: f.type || 'image/jpeg' });
    }

    const workLabel = {
      homework : 'Домашнє завдання',
      classwork: 'Самостійна робота',
      test     : 'Контрольна робота',
    }[state.workType];

    const studentName = $('student-name').value.trim() || 'Учень';

    // ── Будуємо content як ОДИН масив (без system role — модель не підтримує) ──
    const userBlocks = [];

    // Інструкція першим текстовим блоком
    userBlocks.push({
      type: 'text',
      text:
`Ти — шкільний вчитель математики (алгебра і геометрія, НУШ).
Тип роботи: ${workLabel}. Учень: ${studentName}.
Оціни роботу за 10-бальною системою НУШ:
10 — бездоганно; 7-9 — незначні помилки; 4-6 — суттєві помилки; 1-3 — більшість завдань невірні.
${workLabel !== 'Домашнє завдання' ? 'Контрольна/самостійна — вимоги підвищені.' : ''}

Поверни ТІЛЬКИ JSON без будь-якого тексту поза ним:
{"grade":<число 1-10>,"errors":"<помилки або Помилок не знайдено>","advice":"<поради учню>","summary":"<загальний коментар>"}`
    });

    // Сторінки підручника якщо є
    if (state.textbookPages.length > 0) {
      const maxPages = Math.min(state.textbookPages.length, 5);
      userBlocks.push({ type: 'text', text: `Контекст — підручник (${maxPages} стор.):` });
      state.textbookPages.slice(0, maxPages).forEach(pg => {
        userBlocks.push({ type: 'image_url', image_url: { url: `data:${pg.mime};base64,${pg.b64}` } });
      });
    }

    // Аркуші роботи учня
    userBlocks.push({ type: 'text', text: `Робота учня (${sheetImages.length} аркуш${sheetImages.length > 1 ? 'і' : ''}):` });
    sheetImages.forEach((img, i) => {
      userBlocks.push({ type: 'text', text: `Аркуш ${i + 1}:` });
      userBlocks.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } });
    });

    const body = {
      model     : MODEL_VISION,   // Qwen — єдина модель що приймає масив з картинками
      max_tokens: 1024,
      temperature: 0.2,
      messages  : [
        { role: 'system', content: systemPrompt },  // рядок
        { role: 'user',   content: userBlocks },     // масив з текстом + image_url
      ],
    };

    // Логуємо для дебагу
    console.log('[teacher] sending', sheetImages.length, 'sheet(s),', state.textbookPages.length, 'textbook pages');

    const response = await fetch(API_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body   : JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[teacher] API error:', errData);
      throw new Error(errData?.error?.message || `HTTP ${response.status}`);
    }

    const data       = await response.json();
    const rawText    = data.choices?.[0]?.message?.content || '';
    const tokensUsed = data.usage?.total_tokens || 0;

    state.lastTokens   = tokensUsed;
    state.totalTokens += tokensUsed;
    state.worksChecked++;

    let result;
    try {
      const m = rawText.match(/\{[\s\S]*\}/);
      result = JSON.parse(m ? m[0] : rawText);
    } catch {
      result = { grade: '?', errors: rawText, advice: '', summary: '' };
    }

    showResult(result);
    updateStats(studentName, result.grade);

  } catch (err) {
    $('loading-spinner').classList.add('hidden');
    $('result-body').classList.remove('hidden');
    $('errors-text').textContent = `Помилка: ${err.message}`;
    $('grade-badge').textContent = '!';
    $('grade-badge').style.background = '#dc2626';
  }
}

function showResult(result) {
  $('loading-spinner').classList.add('hidden');
  $('result-body').classList.remove('hidden');
  $('next-btn').classList.remove('hidden');

  const grade = parseInt(result.grade) || 0;
  const badge = $('grade-badge');
  badge.textContent = grade || '?';
  badge.style.background = grade >= 8 ? '#16a34a' : grade >= 5 ? '#d97706' : '#dc2626';

  $('errors-text').textContent  = result.errors  || 'Не визначено';
  $('advice-text').textContent  = result.advice  || 'Немає порад';
  $('summary-text').textContent = result.summary || '';
}

function updateStats(studentName, grade) {
  const photosLeft = Math.max(0, Math.floor((DAILY_LIMIT - state.totalTokens) / TOKENS_PER_PHOTO_EST));
  $('tokens-used').textContent   = state.lastTokens.toLocaleString();
  $('tokens-total').textContent  = state.totalTokens.toLocaleString();
  $('photos-left').textContent   = `~${photosLeft} фото`;
  $('works-checked').textContent = state.worksChecked;

  const entry = document.createElement('div');
  entry.className = 'grade-entry';
  entry.innerHTML = `<span class="g-name">${studentName || 'Учень ' + state.worksChecked}</span><span class="g-score">${grade}/10</span>`;
  $('grades-log').prepend(entry);
}

// ── СКИДАННЯ ─────────────────────────────────────────────────────
function resetForNext() {
  [1, 2, 3].forEach(n => {
    const input   = $(`sheet-${n}`);
    const preview = $(`preview-${n}`);
    if (input)   input.value = '';
    if (preview) { preview.src = ''; preview.classList.add('hidden'); }
  });
  // Скидаємо кнопки
  document.querySelectorAll('.sheet-btn').forEach(btn => {
    btn.classList.remove('has-file');
    btn.textContent = '📷 Додати фото';
  });
  $('student-name').value = '';
  $('result-body').classList.add('hidden');
  $('next-btn').classList.add('hidden');
  $('loading-spinner').classList.add('hidden');
  window.scrollTo({ top: $('work-section').offsetTop - 20, behavior: 'smooth' });
}

// ── УТИЛІТИ ──────────────────────────────────────────────────────
function getSheetFiles() {
  const files = [];
  [1, 2, 3].forEach(n => {
    const input = $(`sheet-${n}`);
    if (input?.files?.[0]) files.push(input.files[0]);
  });
  return files;
}

function toBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const comma = reader.result.indexOf(',');
      if (comma === -1) { rej(new Error('Не вдалося прочитати файл')); return; }
      res(reader.result.slice(comma + 1));
    };
    reader.onerror = () => rej(new Error('Помилка читання файлу'));
    reader.readAsDataURL(file);
  });
}

function showStatus(id, msg, type) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = `status-bar ${type}`;
  el.classList.remove('hidden');
}

function getApiKey() {
  return (typeof API_KEY !== 'undefined') ? API_KEY : '';
}
