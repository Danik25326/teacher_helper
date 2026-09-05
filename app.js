// ── CONFIG ──────────────────────────────────────────────────────
const API_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_VISION = 'qwen/qwen3.6-27b';      // Єдина модель на Groq що підтримує image_url
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
  const files = e.target.files;
  if (!files.length) return;
  const nameEl = $('textbook-filename');
  if (!nameEl) return;
  if (files.length === 1) {
    nameEl.textContent = files[0].name;
  } else {
    nameEl.textContent = `${files.length} фото вибрано`;
  }
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
    showStatus('textbook-status', 'Спочатку виберіть файл(и) підручника.', 'error');
    return;
  }

  state.textbookPages = [];
  state.textbookLoaded = false;

  const firstFile = files[0];

  // PDF — тільки один файл, конвертуємо сторінки
  if (firstFile.type === 'application/pdf') {
    if (files.length > 1) {
      showStatus('textbook-status', '⚠️ Для PDF оберіть лише один файл.', 'error');
      return;
    }
    await loadPDF(firstFile);
    return;
  }

  // Фото — можна декілька
  showStatus('textbook-status', `⏳ Завантаження ${files.length} фото…`, 'loading');
  let loaded = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const b64 = await toBase64(file);
    if (!b64) continue;
    state.textbookPages.push({ b64, mime: file.type });
    loaded++;
  }

  if (!loaded) {
    showStatus('textbook-status', '⚠️ Не вдалося прочитати жодного файлу.', 'error');
    return;
  }

  state.textbookLoaded = true;
  renderTextbookPreviews();
  showStatus('textbook-status', `✅ Завантажено ${loaded} стор. підручника.`, 'success');
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
  const btns = document.querySelectorAll('.sheet-btn');
  if (btns[n - 1]) {
    btns[n - 1].classList.add('has-file');
    btns[n - 1].textContent = `✅ ${file.name.slice(0, 18)}`;
  }
  updateSheetsSummary();
}

function updateSheetsSummary() {
  const sheets  = getSheetFiles();
  const summary = $('sheets-summary');
  const row     = $('sheets-preview-row');
  const count   = $('sheets-count');

  if (!sheets.length) {
    if (summary) summary.classList.add('hidden');
    return;
  }

  if (summary) summary.classList.remove('hidden');
  if (count)   count.textContent = sheets.length;
  if (!row)    return;

  row.innerHTML = '';
  sheets.forEach((f, i) => {
    const wrap  = document.createElement('div');
    wrap.className = 'summary-thumb';
    const img   = document.createElement('img');
    img.src     = URL.createObjectURL(f);
    const label = document.createElement('span');
    label.textContent = `Аркуш ${i + 1}`;
    wrap.appendChild(img);
    wrap.appendChild(label);
    row.appendChild(wrap);
  });
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

    userBlocks.push({
      type: 'text',
      text: `/no_think
Вчитель НУШ. Українська. ${workLabel}. Учень: ${studentName}.
Шкала: 10=відмінно,7-9=добре,4-6=задовільно,1-3=незадовільно.
Відповідь — ТІЛЬКИ JSON:
{"grade":<1-10>,"errors":"...","advice":"...","summary":"..."}`
    });

    // ── Ліміт: qwen3.6-27b підтримує max 3 зображення на запит ──
    const MAX_IMAGES    = 3;
    const sheetsCount   = sheetImages.length;
    // Скільки можна виділити під підручник
    const textbookSlots = Math.max(0, MAX_IMAGES - sheetsCount);

    // Сторінки підручника якщо є
    if (state.textbookPages.length > 0 && textbookSlots > 0) {
      const maxPages = Math.min(state.textbookPages.length, textbookSlots);
      userBlocks.push({ type: 'text', text: `Контекст — підручник (${maxPages} стор.):` });
      state.textbookPages.slice(0, maxPages).forEach(pg => {
        userBlocks.push({ type: 'image_url', image_url: { url: `data:${pg.mime};base64,${pg.b64}` } });
      });
    }

    // Аркуші роботи учня (беремо не більше MAX_IMAGES)
    const sheetsToSend = sheetImages.slice(0, MAX_IMAGES);
    userBlocks.push({ type: 'text', text: `Робота учня (${sheetsToSend.length} аркуш${sheetsToSend.length > 1 ? 'і' : ''}):` });
    sheetsToSend.forEach((img, i) => {
      userBlocks.push({ type: 'text', text: `Аркуш ${i + 1}:` });
      userBlocks.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } });
    });

    const body = {
      model      : MODEL_VISION,
      max_tokens : 999,
      temperature: 0,
      messages   : [
        { role: 'user', content: userBlocks },
      ],
    };

    // Детальний лог що відправляємо
    console.log('[teacher] model:', MODEL_VISION);
    console.log('[teacher] blocks:', userBlocks.map(b => b.type));
    console.log('[teacher] body size:', JSON.stringify(body).length, 'bytes');

    const response = await fetch(API_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body   : JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[teacher] API error full:', JSON.stringify(errData));
      throw new Error(errData?.error?.message || errData?.error?.type || `HTTP ${response.status}`);
    }

    const data       = await response.json();
    const rawText    = data.choices?.[0]?.message?.content || '';
    const tokensUsed = data.usage?.total_tokens || 0;

    state.lastTokens   = tokensUsed;
    state.totalTokens += tokensUsed;
    state.worksChecked++;

    // Вирізаємо <think>...</think> блок (qwen думає вголос)
    // Також обробляємо випадок коли <think> не закрився (токени скінчились посередині)
    let cleanText = rawText
      .replace(/<think>[\s\S]*?<\/think>\n*/gi, '')  // закритий think
      .replace(/<think>[\s\S]*/gi, '')                // незакритий think
      .trim();

    let result;
    try {
      const m = cleanText.match(/\{[\s\S]*\}/);
      result = JSON.parse(m ? m[0] : cleanText);
    } catch {
      result = { grade: '?', errors: cleanText || rawText, advice: '', summary: '' };
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
  // Скидаємо загальне превʼю
  const summary = $('sheets-summary');
  const row     = $('sheets-preview-row');
  if (summary) summary.classList.add('hidden');
  if (row)     row.innerHTML = '';
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
