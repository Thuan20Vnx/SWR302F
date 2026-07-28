import { initAuth, api } from './auth.js';
import { createExam } from './exam.js';
// Danh sách môn dùng chung với script nạp dữ liệu (server/src/scripts/seed-questions.js),
// nên thêm môn mới chỉ phải sửa một chỗ duy nhất.
import SUBJECTS from './data/subjects.json';

const THEME_KEY = 'swr302-theme-v1';
const SUBJECT_KEY = 'swr302-subject-v2';
const cacheKey = (subject) => `swr302-questions-v2:${subject}`;

// Bộ câu hỏi nằm trên MongoDB. Bản sao trong localStorage giúp app vẫn học được
// khi server ngủ hoặc mất mạng.
let cards = [];

async function loadCards(subject) {
  const { ok, data } = await api(`/questions?subject=${encodeURIComponent(subject)}`);
  if (ok && Array.isArray(data.questions) && data.questions.length) {
    localStorage.setItem(cacheKey(subject), JSON.stringify(data.questions));
    return data.questions;
  }

  const cached = localStorage.getItem(cacheKey(subject));
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      localStorage.removeItem(cacheKey(subject));
    }
  }
  return [];
}

const ALL = 'Tất cả';
const SAVED = 'Đã lưu';

const today = () => new Date().toISOString().slice(0, 10);
const storedSessionDate = localStorage.getItem('swr302-sessions-date-v1');

const state = {
  view: 'home', // 'home' | 'study' | 'exam'
  subject:
    SUBJECTS.find((item) => item.id === localStorage.getItem(SUBJECT_KEY)) ||
    SUBJECTS[0],
  topic: ALL,
  search: '',
  index: 0,
  flipped: false,
  progress: JSON.parse(localStorage.getItem('swr302-progress-v2') || '{}'),
  saved: new Set(JSON.parse(localStorage.getItem('swr302-saved-v1') || '[]')),
  // "lần ôn hôm nay" only counts today, so the tally restarts on a new date.
  sessions:
    storedSessionDate === today()
      ? Number(localStorage.getItem('swr302-sessions-v2') || 0)
      : 0,
  sessionsDate: today(),
  hideDuplicates: localStorage.getItem('swr302-hide-dupes-v1') === '1',
  signedIn: false,
};

const $ = (selector) => document.querySelector(selector);

function setTheme(theme) {
  const selectedTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.classList.toggle(
    'light-theme',
    selectedTheme === 'light',
  );
  document.body.classList.toggle('light-theme', selectedTheme === 'light');
  document.documentElement.style.colorScheme = selectedTheme;
  document
    .querySelector('meta[name="theme-color"]')
    .setAttribute('content', selectedTheme === 'light' ? '#f4f1e8' : '#111827');
  document.querySelectorAll('[data-theme]').forEach((button) => {
    const active = button.dataset.theme === selectedTheme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  localStorage.setItem(THEME_KEY, selectedTheme);
  window.dispatchEvent(new CustomEvent('swr302:theme'));
}

setTheme(localStorage.getItem(THEME_KEY) || 'light');

function matchesSearch(card) {
  const needle = state.search.trim().toLowerCase();
  if (!needle) return true;
  return (
    card.question.toLowerCase().includes(needle) ||
    Object.values(card.options).some((text) =>
      text.toLowerCase().includes(needle),
    )
  );
}

// Đề gốc lặp lại một số câu giữa các kỳ thi; bản lặp mang duplicateOf trỏ về
// câu xuất hiện đầu tiên.
const cardById = new Map();
const originalOf = (card) =>
  card.duplicateOf ? cardById.get(card.duplicateOf) : null;

// Tiến độ và danh sách đã lưu ghi theo câu gốc, nên học một bản là tính cho cả
// nhóm trùng - không bị đếm hai lần, cũng không mất khi bật "Ẩn câu trùng".
const canonicalId = (card) => card.duplicateOf || card.id;
const uniqueCount = () => cards.filter((card) => !card.duplicateOf).length;
// Tiến độ và danh sách đã lưu dùng chung cho mọi môn, nên khi đếm phải bỏ qua
// những câu không thuộc bộ đề đang mở.
const knownCount = () =>
  cards.filter((card) => !card.duplicateOf && state.progress[card.id] === 'known')
    .length;
const savedCount = () =>
  cards.filter((card) => !card.duplicateOf && state.saved.has(card.id)).length;

function normalizeIds() {
  const progress = {};
  for (const [id, value] of Object.entries(state.progress)) {
    const card = cardById.get(Number(id));
    const key = card ? canonicalId(card) : Number(id);
    if (progress[key] !== 'known') progress[key] = value;
  }
  state.progress = progress;

  state.saved = new Set(
    [...state.saved].map((id) => {
      const card = cardById.get(Number(id));
      return card ? canonicalId(card) : Number(id);
    }),
  );
}

function filtered() {
  return cards.filter((card) => {
    if (state.hideDuplicates && card.duplicateOf) return false;
    if (state.topic === SAVED) {
      if (!state.saved.has(canonicalId(card))) return false;
    } else if (state.topic !== ALL && card.topic !== state.topic) {
      return false;
    }
    return matchesSearch(card);
  });
}

function renderDuplicateToggle() {
  const total = cards.filter((card) => card.duplicateOf).length;
  $('#dupe-count').textContent = total;
  $('#dupe-toggle').classList.toggle('active', state.hideDuplicates);
  $('#dupe-toggle').setAttribute('aria-pressed', String(state.hideDuplicates));
  $('#dupe-toggle').classList.toggle('hidden', !total);
}

function duplicateNote(card) {
  const original = originalOf(card);
  return original ? `Câu này đã xuất hiện ở trang ${original.page}` : '';
}

let pushTimer = null;

function pushToServer() {
  if (!state.signedIn) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    api('/progress', {
      method: 'PUT',
      body: JSON.stringify({
        progress: state.progress,
        savedQuestions: [...state.saved],
        sessions: state.sessions,
        sessionsDate: state.sessionsDate,
        examSessions: exam.sessions(),
      }),
    });
  }, 800);
}

function saveLocal() {
  localStorage.setItem('swr302-progress-v2', JSON.stringify(state.progress));
  localStorage.setItem('swr302-sessions-v2', state.sessions);
  localStorage.setItem('swr302-sessions-date-v1', state.sessionsDate);
  localStorage.setItem('swr302-saved-v1', JSON.stringify([...state.saved]));
}

const save = () => {
  saveLocal();
  pushToServer();
};

// On login the device may hold progress the server has not seen yet, so the two
// sides are merged ("known" always wins) and the result is pushed back.
async function syncWithServer() {
  const { ok, data } = await api('/progress');
  if (!ok) return;

  const merged = { ...(data.progress || {}) };
  Object.entries(state.progress).forEach(([id, value]) => {
    if (merged[id] !== 'known') merged[id] = value;
  });
  state.progress = merged;
  (data.savedQuestions || []).forEach((id) => state.saved.add(id));
  // Counts from another device only carry over when they are from today.
  if (data.sessionsDate === state.sessionsDate) {
    state.sessions = Math.max(state.sessions, Number(data.sessions) || 0);
  }

  // Máy khác có thể còn dữ liệu ghi theo id của bản lặp.
  normalizeIds();
  saveLocal();
  // Bài thi dở ở máy khác: bản nào mới hơn thì thắng.
  exam.adoptSessions(data.examSessions);
  renderFilters();
  render();
  pushToServer();
}

// Nội dung câu hỏi đến từ API nên vẫn thoát HTML trước khi ghép vào innerHTML.
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );

// markCorrect = true: giữ nguyên thứ tự A→D và chỉ tô sáng đáp án đúng, để mắt
// tìm lại đúng vị trí đã đọc ở mặt trước thay vì thấy nó nhảy lên đầu.
function optionMarkup(card, markCorrect = false) {
  return Object.entries(card.options)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([letter, text]) => {
      const correct = markCorrect && card.answer.includes(letter);
      return `<div class="card-option ${correct ? 'correct-option' : ''} ${markCorrect && !correct ? 'muted-option' : ''}">
          <b>${escapeHtml(letter)}</b><span>${escapeHtml(text)}</span>
        </div>`;
    })
    .join('');
}

function topicList() {
  return [ALL, SAVED, ...new Set(cards.map((card) => card.topic))];
}

function topicLabel(topic) {
  return topic === SAVED ? `${SAVED} (${savedCount()})` : topic;
}

function renderFilters() {
  // 20 chip "Trang 1..20" xuống 3 hàng nhìn rất rối, nên tách thành hai cụm:
  // lối tắt (Tất cả / Đã lưu) và dải số trang cuộn ngang trên một hàng.
  const pages = topicList().filter((topic) => topic !== ALL && topic !== SAVED);
  const chip = (topic, label, extraClass = '') =>
    `<button class="filter ${extraClass} ${topic === state.topic ? 'active' : ''}" data-topic="${topic}" type="button">${label}</button>`;

  $('#filters').innerHTML = `
    <div class="filter-shortcuts">
      ${chip(ALL, `Tất cả <span class="filter-count">${cards.length}</span>`)}
      ${chip(SAVED, `Đã lưu <span class="filter-count">${savedCount()}</span>`)}
    </div>
    <div class="filter-pages">
      <span class="filter-legend">Trang</span>
      ${pages
        .map((topic) =>
          chip(topic, topic.replace('Trang ', ''), 'filter-page'),
        )
        .join('')}
    </div>`;

  $('#filters')
    .querySelectorAll('button')
    .forEach((button) => {
      button.onclick = () => selectTopic(button.dataset.topic);
    });

  const select = $('#page-select');
  select.innerHTML = topicList()
    .map(
      (topic) =>
        `<option value="${topic}" ${topic === state.topic ? 'selected' : ''}>${topicLabel(topic)}</option>`,
    )
    .join('');
}

function selectTopic(topic) {
  state.topic = topic;
  state.index = 0;
  state.flipped = false;
  renderFilters();
  render();
}

function updateProgress() {
  // Mẫu số là số câu hỏi khác nhau (câu lặp không tính lại), nếu không thì học
  // hết bộ vẫn không bao giờ chạm 100%.
  const total = uniqueCount();
  const known = knownCount();
  const percent = total ? (known / total) * 100 : 0;
  // One card is only 0.25%, so small values keep a decimal instead of rounding
  // down to a flat "0%", and the ring keeps a visible sliver once anything is known.
  $('#progress-value').textContent =
    percent > 0 && percent < 10
      ? `${percent.toFixed(1)}%`
      : `${Math.round(percent)}%`;
  $('#progress-ring').style.setProperty(
    '--progress',
    `${(known ? Math.max(percent, 1.5) : 0) * 3.6}deg`,
  );
  $('#progress-title').textContent = !total
    ? 'Đang tải bộ câu hỏi...'
    : known >= total
      ? `Bạn đã thuộc toàn bộ ${total} câu!`
      : known
        ? 'Tiếp tục giữ nhịp nhé!'
        : `Bắt đầu bộ ${total} câu`;
  $('#progress-copy').textContent = `${known} / ${total} câu đã thuộc · ${savedCount()} câu đã lưu`;
  $('#streak-value').textContent = state.sessions;
  $('#saved-count').textContent = savedCount();
  $('#saved-button').classList.toggle(
    'active',
    state.view === 'study' && state.topic === SAVED,
  );
}

function renderSaveButton(card, button, label) {
  const isSaved = card ? state.saved.has(canonicalId(card)) : false;
  button.classList.toggle('saved', isSaved);
  button.setAttribute('aria-pressed', String(isSaved));
  label.textContent = isSaved ? 'Đã lưu' : 'Lưu câu hỏi';
}

function toggleSaved(card) {
  if (!card) return;
  const key = canonicalId(card);
  if (state.saved.has(key)) state.saved.delete(key);
  else state.saved.add(key);
  save();
  updateProgress();
  renderFilters();
  render();
}

function currentStudyCard() {
  const list = filtered();
  if (!list.length) return null;
  state.index = ((state.index % list.length) + list.length) % list.length;
  return list[state.index];
}

function renderCard() {
  const list = filtered();
  const card = currentStudyCard();

  $('#study-empty').textContent =
    state.topic === SAVED && !state.search.trim()
      ? 'Bạn chưa lưu câu hỏi nào. Bấm "Lưu câu hỏi" ở thẻ nào chưa thuộc để xem lại tại đây.'
      : 'Không có câu hỏi nào khớp với bộ lọc. Thử đổi trang hoặc xoá từ khoá tìm kiếm.';
  $('#study-empty').classList.toggle('hidden', Boolean(card));
  $('#flashcard').classList.toggle('hidden', !card);
  $('.controls').classList.toggle('hidden', !card);
  $('.card-tools').classList.toggle('hidden', !card);
  if (!card) {
    $('#rating').classList.remove('visible');
    return;
  }

  const note = duplicateNote(card);
  const heading = `${card.topic.toUpperCase()} · CÂU ${card.numberOnPage}`;
  const badge = note
    ? `<span class="dupe-badge">${note.toUpperCase()}</span>`
    : '';
  $('#card-topic').innerHTML = heading + badge;
  $('#answer-topic').innerHTML = heading + badge;
  $('#card-question').textContent = card.question;
  $('#card-options').innerHTML = optionMarkup(card);
  $('#card-answer').innerHTML = `
    <strong class="answer-key">Đáp án: ${card.answer.split('').join(', ')}</strong>
    <div class="answer-options">${optionMarkup(card, true)}</div>
  `;
  $('#card-position').textContent = `${state.index + 1} / ${list.length}`;
  $('#deck-count').innerHTML =
    `<strong>${list.length}</strong><span>câu trong bộ đang chọn</span>`;
  $('.card-front').classList.toggle('is-visible', !state.flipped);
  $('.card-back').classList.toggle('is-visible', state.flipped);
  $('#rating').classList.toggle('visible', state.flipped);
  renderSaveButton(card, $('#save-button'), $('#save-label'));
}

function flip() {
  if (state.view !== 'study' || !currentStudyCard()) return;
  state.flipped = !state.flipped;
  if (state.flipped) {
    state.sessions += 1;
    save();
    updateProgress();
  }
  renderCard();
}

function rate(value) {
  const card = currentStudyCard();
  if (!card) return;
  state.progress[canonicalId(card)] = value;
  save();
  updateProgress();
  state.flipped = false;
  state.index += 1;
  renderCard();
}

const exam = createExam({
  getCards: () => cards,
  getSubject: () => state.subject.id,
  subjectIds: () => SUBJECTS.map((item) => item.id),
  onLeave: () => setView('home'),
  isSaved: (card) => state.saved.has(canonicalId(card)),
  onToggleSave: (card) => toggleSaved(card),
  // Bài thi dở đi cùng tiến độ lên server để đổi thiết bị vẫn làm tiếp được.
  onSessionChange: () => pushToServer(),
});

function render() {
  const { view } = state;
  $('#hero').classList.toggle('hidden', view !== 'home');
  // Phòng thi có bộ đề riêng nên không dùng thanh lọc trang / tìm kiếm.
  $('#toolbar').classList.toggle('hidden', view === 'home' || view === 'exam');
  $('#dashboard').classList.toggle('hidden', view === 'exam');
  $('#study-layout').classList.toggle('hidden', view !== 'study');
  $('#exam').classList.toggle('hidden', view !== 'exam');
  $('#study-button').classList.toggle('active', view === 'study');
  $('#exam-button').classList.toggle('active', view === 'exam');
  renderDuplicateToggle();
  updateProgress();
  if (view === 'study') renderCard();
  if (view === 'exam') exam.open();
}

function setView(view) {
  state.view = view;
  render();
  if (view === 'exam') {
    $('#exam').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (view !== 'home') {
    $('#toolbar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function renderSubjects() {
  $('#subject-label').textContent = state.subject.label;
  document.title = `SLearning · ${state.subject.label}`;
  $('#subject-menu').innerHTML =
    SUBJECTS.map(
      (item) =>
        `<button class="subject-option ${item.id === state.subject.id ? 'active' : ''}" type="button" role="option" aria-selected="${item.id === state.subject.id}" data-subject="${item.id}">
          <strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.note)}</span>
        </button>`,
    ).join('') +
    '<p class="subject-soon">Các môn khác đang được cập nhật.</p>';
  $('#subject-menu')
    .querySelectorAll('[data-subject]')
    .forEach((button) => {
      button.onclick = () => selectSubject(button.dataset.subject);
    });
}

function toggleSubjectMenu(open) {
  const next =
    open ?? $('#subject-menu').classList.contains('hidden');
  $('#subject-menu').classList.toggle('hidden', !next);
  $('#subject-button').setAttribute('aria-expanded', String(next));
}

function selectSubject(id) {
  const subject = SUBJECTS.find((item) => item.id === id);
  toggleSubjectMenu(false);
  if (!subject || subject.id === state.subject.id) return;
  state.subject = subject;
  localStorage.setItem(SUBJECT_KEY, subject.id);
  // Đổi môn là đổi hẳn bộ đề: bỏ bài thi đang dở và về đầu bộ thẻ.
  exam.reset();
  state.topic = ALL;
  state.index = 0;
  state.flipped = false;
  renderSubjects();
  boot();
}

$('#flashcard').onclick = flip;
$('#previous').onclick = () => {
  state.index -= 1;
  state.flipped = false;
  renderCard();
};
$('#next').onclick = () => {
  state.index += 1;
  state.flipped = false;
  renderCard();
};
$('#rating').onclick = (event) => {
  const button = event.target.closest('[data-rating]');
  if (button) rate(button.dataset.rating);
};
$('#save-button').onclick = () => toggleSaved(currentStudyCard());
$('#study-button').onclick = () => setView('study');
$('#saved-button').onclick = () => {
  state.view = 'study';
  selectTopic(SAVED);
  $('#toolbar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
$('#exam-button').onclick = () => setView('exam');
$('#subject-button').onclick = (event) => {
  event.stopPropagation();
  toggleSubjectMenu();
};
document.addEventListener('click', (event) => {
  if (!event.target.closest('#subject-picker')) toggleSubjectMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') toggleSubjectMenu(false);
});
document.querySelectorAll('[data-theme]').forEach((button) => {
  button.onclick = () => setTheme(button.dataset.theme);
});
$('#hero-study').onclick = () => setView('study');
$('#hero-exam').onclick = () => setView('exam');
$('#brand').onclick = (event) => {
  event.preventDefault();
  setView('home');
};
$('#page-select').onchange = (event) => selectTopic(event.target.value);
$('#dupe-toggle').onclick = () => {
  state.hideDuplicates = !state.hideDuplicates;
  localStorage.setItem('swr302-hide-dupes-v1', state.hideDuplicates ? '1' : '0');
  state.index = 0;
  state.flipped = false;
  render();
};
$('#search-input').oninput = (event) => {
  state.search = event.target.value;
  state.index = 0;
  state.flipped = false;
  render();
};
$('#reset-button').onclick = () => {
  if (confirm('Xóa toàn bộ tiến độ đã lưu?')) {
    state.progress = {};
    state.sessions = 0;
    save();
    updateProgress();
  }
};

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, select, textarea')) return;
  if (state.view !== 'study') return;
  if (event.code === 'Space') {
    event.preventDefault();
    flip();
  }
  if (event.key === 'ArrowRight') $('#next').click();
  if (event.key === 'ArrowLeft') $('#previous').click();
  if (event.key === 's' || event.key === 'S') $('#save-button').click();
});

function showSupportModal() {
  document.body.classList.add('modal-open');
  $('#support-modal').classList.remove('hidden');
  $('#support-close').focus();
}

function hideSupportModal() {
  document.body.classList.remove('modal-open');
  $('#support-modal').classList.add('hidden');
}

function showUser(user) {
  $('.google-auth-control').classList.add('hidden');
  $('#user-chip').classList.remove('hidden');
  $('#user-avatar').src = user.picture || '';
  $('#user-name').textContent = user.name || user.email;
  exam.setStudent(user.name || user.email);
  state.signedIn = true;
  syncWithServer();
}

function showLoggedOut() {
  $('.google-auth-control').classList.remove('hidden');
  $('#user-chip').classList.add('hidden');
  exam.setStudent('student');
  state.signedIn = false;
}

$('#support-button').onclick = showSupportModal;
$('#support-close').onclick = hideSupportModal;
$('#support-done').onclick = hideSupportModal;
$('#support-modal').onclick = (event) => {
  if (event.target === $('#support-modal')) hideSupportModal();
};
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#support-modal').classList.contains('hidden')) {
    hideSupportModal();
    $('#support-button').focus();
  }
});

let toastTimer = null;

function showToast(message, tone = 'error') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('toast-error', tone === 'error');
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 6000);
}

initAuth({
  onLogin: showUser,
  onLogout: showLoggedOut,
  onSupportPrompt: showSupportModal,
  onError: showToast,
});

async function boot() {
  const subject = state.subject.id;
  const raw = await loadCards(subject);
  // Người dùng có thể đã bấm đổi môn khác trong lúc chờ mạng.
  if (state.subject.id !== subject) return;
  cards = raw.map((question) => ({
    ...question,
    topic: `Trang ${question.page}`,
  }));
  cardById.clear();
  cards.forEach((card) => cardById.set(card.id, card));
  // Dữ liệu cũ ghi theo id của từng bản lặp, gộp lại theo câu gốc.
  normalizeIds();
  saveLocal();

  if (!cards.length) {
    showToast(
      'Không tải được bộ câu hỏi. Máy chủ có thể đang khởi động lại, thử tải lại trang sau ít phút nhé.',
    );
  }

  renderFilters();
  exam.refresh();
  render();
}

renderSubjects();
renderFilters();
exam.refresh();
render();
boot();
