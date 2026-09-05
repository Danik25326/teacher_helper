// ── CONFIG ──────────────────────────────────────────────────────
// Ключ зберігається у config.js (НЕ в git)
const API_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'openai/gpt-oss-120b';

// Середня кількість токенів на фото (приблизно)
const TOKENS_PER_PHOTO_EST = 1200;
const DAILY_LIMIT          = 200000;

// ── СТАН ────────────────────────────────────────────────────────
let state = {
  textbookPages : [],   // base64 рядки сторінок підручника
  textbookLoaded: false,
  workType      : 'homework', // homework | classwork | test
  totalTokens   : 0,
  worksChecked  : 0,
  lastTokens    : 0,
};

// ── DOM ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Підручник
$('load-textbook-btn').addEventListener('click', loadTextbook);

// Вкладки
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.workType = tab.dataset.type;
  });
});

// Аркуші
[1,2,3].forEach(n => {
  $(`sheet-${n}`).addEventListener('change', e => handleSheet(n, e.target.files[0]));
});

// Перевірка
$('check-btn').addEventListener('click', checkWork);
$('next-btn').addEventListener('click', resetForNext);

// ── ПІДРУЧНИК ────────────────────────────────────────────────────
$('textbook-upload').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const label = document.querySelector('label[for="textbook-upload"]');
  if (label) label.querySelector('span') && (label.querySelector('span').textContent = f.name);
  // Показуємо назву файлу поруч
  const nameEl = $('textbook-filename');
  if (nameEl) nameEl.textContent = f.name;
});

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
    showStatus('textbook-status', `✅ Завантажено 1 сторінку.`, 'success');
  } else {
    showStatus('textbook-status', '⚠️ Підтримуються PDF та зображення (JPG/PNG).', 'error');
  }
}

async function loadPDF(file) {
  showStatus('textbook-status', '⏳ Читаю PDF…', 'loading');
  $('pdf-progress-wrap').classList.remove('hidden');
  $('pdf-progress-bar').style.width = '0%';
  $('pdf-progress-text').textContent = 'Відкриваю файл…';

  try {
    // Налаштовуємо pdf.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdfDoc.numPages;

    $('pdf-progress-text').textContent = `Знайдено ${totalPages} сторінок. Рендерю…`;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 }); // 1.5x — баланс між якістю і розміром

      canvas.width  = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      state.textbookPages.push({ b64, mime: 'image/jpeg' });

      // Оновлюємо прогрес
      const pct = Math.round((i / totalPages) * 100);
      $('pdf-progress-bar').style.width = pct + '%';
      $('pdf-progress-text').textContent = `Сторінка ${i} з ${totalPages}…`;

      // Даємо браузеру "подихати"
      await new Promise(r => setTimeout(r, 0));
    }

    state.textbookLoaded = true;
    $('pdf-progress-wrap').classList.add('hidden');
    renderTextbookPreviews();
    showStatus('textbook-status',
      `✅ PDF завантажено: ${totalPages} сторінок конвертовано. ШІ буде бачити весь підручник.`,
      'success'
    );

  } catch (err) {
    $('pdf-progress-wrap').classList.add('hidden');
    showStatus('textbook-status', `❌ Помилка читання PDF: ${err.message}`, 'error');
  }
}

function renderTextbookPreviews() {
  const grid = $('textbook-preview');
  grid.innerHTML = '';
  // Показуємо перші 6 сторінок як превʼю
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

// ── АРКУШІ ───────────────────────────────────────────────────────
function handleSheet(n, file) {
  if (!file) return;
  const preview = $(`preview-${n}`);
  const zone    = document.querySelector(`#sheet-${n}`).closest('.upload-zone') ||
                  document.querySelector(`label[for="sheet-${n}"]`);
  preview.src   = URL.createObjectURL(file);
  preview.classList.remove('hidden');
  if (zone) zone.classList.add('has-file');
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

    // Конвертуємо всі аркуші в base64
    const sheetImages = [];
    for (const f of sheets) {
      const b64 = await toBase64(f);
      if (!b64 || b64 === 'undefined') throw new Error(`Не вдалося прочитати файл: ${f.name}`);
      sheetImages.push({ b64, mime: f.type || 'image/jpeg' });
    }

    const workLabel = { homework: 'Домашнє завдання', classwork: 'Самостійна робота', test: 'Контрольна робота' }[state.workType];
    const studentName = $('student-name').value.trim() || 'Учень';

    // Будуємо повідомлення
    const contentBlocks = [];

    // Додаємо сторінки підручника якщо є (max 8 стор щоб не перевищити ліміт)
    if (state.textbookPages.length > 0) {
      const maxPages = Math.min(state.textbookPages.length, 8);
      contentBlocks.push({ type: 'text', text: `Ось сторінки підручника для контексту (показано ${maxPages} з ${state.textbookPages.length} стор.):` });
      state.textbookPages.slice(0, maxPages).forEach(pg => {
        contentBlocks.push({ type: 'image_url', image_url: { url: `data:${pg.mime};base64,${pg.b64}` } });
      });
    }

    contentBlocks.push({
      type: 'text',
      text: `Ти — шкільний вчитель математики (алгебра та геометрія, НУШ).
Тип роботи: ${workLabel}.
Учень: ${studentName}.

Перевір роботу учня (${sheetImages.length} аркуш${sheetImages.length > 1 ? 'і' : ''}).
Оціни за 10-бальною системою НУШ.

Відповідь дай ТІЛЬКИ у форматі JSON (без будь-якого тексту поза JSON):
{
  "grade": <число від 1 до 10>,
  "errors": "<опис помилок або 'Помилок не знайдено'>",
  "advice": "<конкретні поради учню>",
  "summary": "<загальний коментар до роботи>"
}

Критерії оцінювання НУШ:
- 10: відмінна робота, всі завдання виконані вірно, охайно, з поясненнями
- 7-9: є незначні помилки, загалом матеріал засвоєно
- 4-6: є суттєві помилки, частковий показ матеріалу  
- 1-3: більшість завдань невірні або не виконані
Для ${workLabel === 'Контрольна робота' ? 'контрольної роботи' : workLabel === 'Самостійна робота' ? 'самостійної роботи' : 'домашнього завдання'} ${workLabel !== 'Домашнє завдання' ? 'вимоги до точності підвищені.' : 'враховуй що учень міг виконувати без допомоги.'}`
    });

    sheetImages.forEach((img, i) => {
      contentBlocks.push({ type: 'text', text: `Аркуш ${i + 1}:` });
      contentBlocks.push({
        type: 'image_url',
        image_url: { url: `data:${img.mime};base64,${img.b64}` }
      });
    });

    // Перевірка що contentBlocks не порожній (Groq відхиляє порожній масив)
    if (!contentBlocks.length) throw new Error('Не вдалося підготувати вміст для перевірки');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        messages: [{ role: 'user', content: contentBlocks }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';
    const usage   = data.usage || {};

    // Токени
    const tokensUsed = usage.total_tokens || 0;
    state.lastTokens   = tokensUsed;
    state.totalTokens += tokensUsed;
    state.worksChecked++;

    // Парсимо JSON відповідь
    let result;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      result = { grade: '?', errors: rawText, advice: '', summary: '' };
    }

    showResult(result, studentName, sheetImages.length);
    updateStats(sheetImages.length, studentName, result.grade);

  } catch (err) {
    $('loading-spinner').classList.add('hidden');
    $('result-body').classList.remove('hidden');
    $('errors-text').textContent = `Помилка: ${err.message}`;
    $('grade-badge').textContent = '!';
    $('grade-badge').style.background = '#dc2626';
  }
}

function showResult(result, name, photoCount) {
  $('loading-spinner').classList.add('hidden');
  $('result-body').classList.remove('hidden');
  $('next-btn').classList.remove('hidden');

  const grade = parseInt(result.grade) || 0;
  const badge = $('grade-badge');
  badge.textContent = grade;
  badge.style.background = grade >= 8 ? '#16a34a' : grade >= 5 ? '#d97706' : '#dc2626';

  $('errors-text').textContent  = result.errors  || 'Не визначено';
  $('advice-text').textContent  = result.advice  || 'Немає порад';
  $('summary-text').textContent = result.summary || '';
}

function updateStats(photoCount, studentName, grade) {
  const tokensLeft   = DAILY_LIMIT - state.totalTokens;
  const photosLeft   = Math.max(0, Math.floor(tokensLeft / TOKENS_PER_PHOTO_EST));

  $('tokens-used').textContent  = state.lastTokens.toLocaleString();
  $('tokens-total').textContent = state.totalTokens.toLocaleString();
  $('photos-left').textContent  = `~${photosLeft} фото`;
  $('works-checked').textContent = state.worksChecked;

  // Додаємо до журналу
  const log   = $('grades-log');
  const entry = document.createElement('div');
  entry.className = 'grade-entry';
  entry.innerHTML = `<span class="g-name">${studentName || 'Учень ' + state.worksChecked}</span><span class="g-score">${grade}/10</span>`;
  log.prepend(entry);
}

// ── СКИДАННЯ ─────────────────────────────────────────────────────
function resetForNext() {
  [1,2,3].forEach(n => {
    const input   = $(`sheet-${n}`);
    const preview = $(`preview-${n}`);
    if (input)   input.value = '';
    if (preview) { preview.src = ''; preview.classList.add('hidden'); }
    const zone = document.querySelector(`label[for="sheet-${n}"]`);
    if (zone) zone.classList.remove('has-file');
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
  [1,2,3].forEach(n => {
    const input = $(`sheet-${n}`);
    if (input.files && input.files[0]) files.push(input.files[0]);
  });
  return files;
}

function toBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const result = reader.result;
      const comma  = result.indexOf(',');
      if (comma === -1) { rej(new Error('Не вдалося прочитати файл')); return; }
      res(result.slice(comma + 1)); // все після коми — чистий base64
    };
    reader.onerror = () => rej(new Error('Помилка читання файлу'));
    reader.readAsDataURL(file);
  });
}

function showStatus(id, msg, type) {
  const el = $(id);
  el.textContent = msg;
  el.className   = `status-bar ${type}`;
  el.classList.remove('hidden');
}

function getApiKey() {
  return (typeof API_KEY !== 'undefined') ? API_KEY : '';
}
