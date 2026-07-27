import { initAuth, api } from './auth.js';

const QUESTIONS_CACHE = 'swr302-questions-v1';

// Bộ câu hỏi nằm trên MongoDB. Bản sao trong localStorage giúp app vẫn học được
// khi server ngủ hoặc mất mạng.
let cards = [];

async function loadCards() {
  const { ok, data } = await api('/questions');
  if (ok && Array.isArray(data.questions) && data.questions.length) {
    localStorage.setItem(QUESTIONS_CACHE, JSON.stringify(data.questions));
    return data.questions;
  }

  const cached = localStorage.getItem(QUESTIONS_CACHE);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      localStorage.removeItem(QUESTIONS_CACHE);
    }
  }
  return [];
}

const ALL = 'Tất cả';
const SAVED = 'Đã lưu';

const today = () => new Date().toISOString().slice(0, 10);
const storedSessionDate = localStorage.getItem('swr302-sessions-date-v1');

const state = {
  view: 'home', // 'home' | 'study' | 'quiz'
  topic: ALL,
  search: '',
  index: 0,
  flipped: false,
  quizIndex: 0,
  quizOrder: [],
  selected: new Set(),
  answered: false,
  progress: JSON.parse(localStorage.getItem('swr302-progress-v2') || '{}'),
  saved: new Set(JSON.parse(localStorage.getItem('swr302-saved-v1') || '[]')),
  // "lần ôn hôm nay" only counts today, so the tally restarts on a new date.
  sessions:
    storedSessionDate === today()
      ? Number(localStorage.getItem('swr302-sessions-v2') || 0)
      : 0,
  sessionsDate: today(),
  signedIn: false,
};

const $ = (selector) => document.querySelector(selector);

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

function filtered() {
  return cards.filter((card) => {
    if (state.topic === SAVED) {
      if (!state.saved.has(card.id)) return false;
    } else if (state.topic !== ALL && card.topic !== state.topic) {
      return false;
    }
    return matchesSearch(card);
  });
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

  saveLocal();
  renderFilters();
  render();
  pushToServer();
}

function optionMarkup(card, correctOnly = false) {
  return Object.entries(card.options)
    .filter(([letter]) => !correctOnly || card.answer.includes(letter))
    .map(
      ([letter, text]) =>
        `<div class="card-option ${correctOnly ? 'correct-option' : ''}">
          <b>${letter}</b><span>${text}</span>
        </div>`,
    )
    .join('');
}

function topicList() {
  return [ALL, SAVED, ...new Set(cards.map((card) => card.topic))];
}

function topicLabel(topic) {
  return topic === SAVED ? `${SAVED} (${state.saved.size})` : topic;
}

function renderFilters() {
  $('#filters').innerHTML = topicList()
    .map(
      (topic) =>
        `<button class="filter ${topic === state.topic ? 'active' : ''}" data-topic="${topic}" type="button">${topicLabel(topic)}</button>`,
    )
    .join('');

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
  resetQuizOrder();
  render();
}

function updateProgress() {
  const known = Object.values(state.progress).filter(
    (value) => value === 'known',
  ).length;
  const percent = cards.length ? (known / cards.length) * 100 : 0;
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
  $('#progress-title').textContent = !cards.length
    ? 'Đang tải bộ câu hỏi...'
    : known === cards.length
      ? `Bạn đã thuộc toàn bộ ${cards.length} câu!`
      : known
        ? 'Tiếp tục giữ nhịp nhé!'
        : `Bắt đầu bộ ${cards.length} câu`;
  $('#progress-copy').textContent = `${known} / ${cards.length} câu đã thuộc · ${state.saved.size} câu đã lưu`;
  $('#streak-value').textContent = state.sessions;
  $('#saved-count').textContent = state.saved.size;
  $('#saved-button').classList.toggle(
    'active',
    state.view === 'study' && state.topic === SAVED,
  );
}

function renderSaveButton(card, button, label) {
  const isSaved = card ? state.saved.has(card.id) : false;
  button.classList.toggle('saved', isSaved);
  button.setAttribute('aria-pressed', String(isSaved));
  label.textContent = isSaved ? 'Đã lưu' : 'Lưu câu hỏi';
}

function toggleSaved(card) {
  if (!card) return;
  if (state.saved.has(card.id)) state.saved.delete(card.id);
  else state.saved.add(card.id);
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

  const heading = `${card.topic.toUpperCase()} · CÂU ${card.numberOnPage}`;
  $('#card-topic').textContent = heading;
  $('#answer-topic').textContent = heading;
  $('#card-question').textContent = card.question;
  $('#card-options').innerHTML = optionMarkup(card);
  $('#card-answer').innerHTML = `
    <strong class="answer-key">Đáp án: ${card.answer.split('').join(', ')}</strong>
    <div class="correct-options">${optionMarkup(card, true)}</div>
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
  state.progress[card.id] = value;
  save();
  updateProgress();
  state.flipped = false;
  state.index += 1;
  renderCard();
}

function resetQuizOrder() {
  const list = filtered();
  const order = list.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  state.quizOrder = order;
  state.quizIndex = 0;
}

function currentQuizCard() {
  const list = filtered();
  if (!list.length) return null;
  if (state.quizOrder.length !== list.length) resetQuizOrder();
  const position = state.quizIndex % state.quizOrder.length;
  return list[state.quizOrder[position]];
}

function renderQuiz() {
  const list = filtered();
  const card = currentQuizCard();
  $('#quiz-empty').classList.toggle('hidden', Boolean(card));
  $('#quiz-body').classList.toggle('hidden', !card);
  if (!card) return;

  state.selected = new Set();
  state.answered = false;
  $('#quiz-question').textContent =
    `Câu ${(state.quizIndex % list.length) + 1}/${list.length} · ${card.topic} · ${card.question}`;
  $('#quiz-options').innerHTML = Object.entries(card.options)
    .map(
      ([letter, text]) =>
        `<button data-option="${letter}" type="button"><b>${letter}</b><span>${text}</span></button>`,
    )
    .join('');
  $('#quiz-feedback').textContent =
    card.answer.length > 1
      ? `Chọn ${card.answer.length} đáp án rồi kiểm tra.`
      : 'Chọn một đáp án rồi kiểm tra.';
  $('#check-answer').classList.remove('hidden');
  $('#next-quiz').classList.add('hidden');
  renderSaveButton(card, $('#quiz-save-button'), $('#quiz-save-label'));

  $('#quiz-options')
    .querySelectorAll('button')
    .forEach((button) => {
      button.onclick = () => {
        if (state.answered) return;
        const letter = button.dataset.option;
        if (state.selected.has(letter)) {
          state.selected.delete(letter);
          button.classList.remove('selected');
        } else {
          state.selected.add(letter);
          button.classList.add('selected');
        }
      };
    });
}

function checkQuizAnswer() {
  if (state.answered || !state.selected.size) return;
  const card = currentQuizCard();
  if (!card) return;
  state.answered = true;
  const expected = new Set(card.answer.split(''));
  const correct =
    state.selected.size === expected.size &&
    [...state.selected].every((letter) => expected.has(letter));

  $('#quiz-options')
    .querySelectorAll('button')
    .forEach((button) => {
      const letter = button.dataset.option;
      if (expected.has(letter)) button.classList.add('correct');
      else if (state.selected.has(letter)) button.classList.add('wrong');
    });

  $('#quiz-feedback').textContent = correct
    ? 'Chính xác - bạn nắm rất chắc!'
    : `Chưa đúng. Đáp án là ${card.answer.split('').join(', ')}.`;
  $('#check-answer').classList.add('hidden');
  $('#next-quiz').classList.remove('hidden');
}

function render() {
  const { view } = state;
  $('#hero').classList.toggle('hidden', view !== 'home');
  $('#toolbar').classList.toggle('hidden', view === 'home');
  $('#study-layout').classList.toggle('hidden', view !== 'study');
  $('#quiz').classList.toggle('hidden', view !== 'quiz');
  $('#study-button').classList.toggle('active', view === 'study');
  $('#quiz-button').classList.toggle('active', view === 'quiz');
  updateProgress();
  if (view === 'study') renderCard();
  if (view === 'quiz') renderQuiz();
}

function setView(view) {
  state.view = view;
  if (view === 'quiz') resetQuizOrder();
  render();
  if (view !== 'home') {
    $('#toolbar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
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
$('#quiz-save-button').onclick = () => toggleSaved(currentQuizCard());
$('#study-button').onclick = () => setView('study');
$('#saved-button').onclick = () => {
  state.view = 'study';
  selectTopic(SAVED);
  $('#toolbar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
$('#quiz-button').onclick = () => setView('quiz');
$('#hero-study').onclick = () => setView('study');
$('#hero-quiz').onclick = () => setView('quiz');
$('#brand').onclick = (event) => {
  event.preventDefault();
  setView('home');
};
$('#check-answer').onclick = checkQuizAnswer;
$('#next-quiz').onclick = () => {
  state.quizIndex += 1;
  renderQuiz();
};
$('#page-select').onchange = (event) => selectTopic(event.target.value);
$('#search-input').oninput = (event) => {
  state.search = event.target.value;
  state.index = 0;
  state.flipped = false;
  resetQuizOrder();
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
  $('#support-modal').classList.remove('hidden');
}

function hideSupportModal() {
  $('#support-modal').classList.add('hidden');
}

function showUser(user) {
  $('#google-signin-button').classList.add('hidden');
  $('#user-chip').classList.remove('hidden');
  $('#user-avatar').src = user.picture || '';
  $('#user-name').textContent = user.name || user.email;
  state.signedIn = true;
  syncWithServer();
}

function showLoggedOut() {
  $('#google-signin-button').classList.remove('hidden');
  $('#user-chip').classList.add('hidden');
  state.signedIn = false;
}

$('#support-button').onclick = showSupportModal;
$('#support-close').onclick = hideSupportModal;
$('#support-done').onclick = hideSupportModal;
$('#support-modal').onclick = (event) => {
  if (event.target === $('#support-modal')) hideSupportModal();
};

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
  const raw = await loadCards();
  cards = raw.map((question) => ({
    ...question,
    topic: `Trang ${question.page}`,
  }));

  if (!cards.length) {
    showToast(
      'Không tải được bộ câu hỏi. Máy chủ có thể đang khởi động lại, thử tải lại trang sau ít phút nhé.',
    );
  }

  renderFilters();
  render();
}

renderFilters();
render();
boot();
