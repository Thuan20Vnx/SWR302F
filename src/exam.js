// Phòng thi thử dựng lại theo phần mềm EOS của trường: cùng khung thông tin,
// cột Answer bên trái, dải số câu ở dưới và nút Finish ở hai đầu màn hình.
const EXAM_MINUTES = 60;
const EXAM_SIZE = 60;

const $ = (selector) => document.querySelector(selector);

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

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Tên máy trong EOS thật là tên máy phòng lab; ở đây sinh một tên cố định theo
// thiết bị để mỗi lần vào thi vẫn thấy đúng một tên như khi thi thật.
function machineName() {
  const key = 'swr302-exam-machine-v1';
  let name = localStorage.getItem(key);
  if (!name) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    let tail = '';
    for (let i = 0; i < 7; i += 1) {
      tail += chars[Math.floor(Math.random() * chars.length)];
    }
    name = `DESKTOP-${tail}`;
    localStorage.setItem(key, name);
  }
  return name;
}

// Bài thi đang làm dở được ghi lại nguyên trạng: đúng thứ tự câu đã bốc, các ô
// đã chọn và mốc hết giờ tuyệt đối. Nhờ vậy đóng app, tắt máy hay đổi thiết bị
// vẫn làm tiếp được đúng chỗ cũ chứ không phải bốc lại đề mới.
const sessionKey = (subject) => `swr302-exam-session-v1:${subject}`;

function readSession(subject) {
  try {
    const raw = localStorage.getItem(sessionKey(subject));
    const session = raw ? JSON.parse(raw) : null;
    return session && Array.isArray(session.ids) && session.ids.length
      ? session
      : null;
  } catch {
    localStorage.removeItem(sessionKey(subject));
    return null;
  }
}

export function createExam({
  getCards,
  getSubject,
  subjectIds,
  onLeave,
  isSaved,
  onToggleSave,
  onSessionChange,
}) {
  const state = {
    mode: null, // 'practice' | 'full'
    list: [],
    index: 0,
    answers: [],
    checked: [],
    deadline: 0,
    timer: null,
    review: false,
    startedAt: 0,
  };

  let student = 'student';

  const pool = () => getCards().filter((card) => !card.duplicateOf);
  const current = () => state.list[state.index] || null;
  const letters = (card) =>
    Object.keys(card.options).sort((a, b) => a.localeCompare(b));
  const expected = (card) => new Set(card.answer.split(''));
  const isCorrect = (card, picked) => {
    const want = expected(card);
    return picked.size === want.size && [...picked].every((l) => want.has(l));
  };
  const revealed = () =>
    state.review || (state.mode === 'practice' && state.checked[state.index]);

  function show(screen) {
    $('#exam-launcher').classList.toggle('hidden', screen !== 'launcher');
    $('#exam-resume').classList.toggle('hidden', screen !== 'resume');
    $('#eos-window').classList.toggle('hidden', screen !== 'exam');
    $('#exam-result').classList.toggle('hidden', screen !== 'result');
  }

  function persist() {
    const subject = getSubject();
    if (!state.mode || state.review) return;
    localStorage.setItem(
      sessionKey(subject),
      JSON.stringify({
        subject,
        mode: state.mode,
        ids: state.list.map((card) => card.id),
        index: state.index,
        answers: state.answers.map((set) => [...set].sort().join('')),
        checked: state.checked,
        deadline: state.deadline,
        startedAt: state.startedAt,
        updatedAt: Date.now(),
      }),
    );
    onSessionChange?.();
  }

  function clearSession() {
    localStorage.removeItem(sessionKey(getSubject()));
    onSessionChange?.();
  }

  function stopTimer() {
    clearInterval(state.timer);
    state.timer = null;
  }

  function paintTimer() {
    const node = $('#eos-time');
    if (state.mode !== 'full' || state.review) {
      node.textContent = '--:--';
      node.classList.remove('eos-time-low');
      return;
    }
    const left = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    node.textContent = `${mm}:${ss}`;
    node.classList.toggle('eos-time-low', left <= 300);
    if (left <= 0) {
      stopTimer();
      finish(true);
    }
  }

  function setFinishEnabled(on) {
    ['#eos-finish-top', '#eos-finish-bottom'].forEach((id) => {
      $(id).disabled = !on;
    });
  }

  function resetFinishChecks() {
    ['#eos-finish-check', '#eos-finish-check-bottom'].forEach((id) => {
      $(id).checked = false;
    });
    setFinishEnabled(false);
  }

  function applyMeta() {
    const full = state.mode === 'full';
    $('#eos-machine').textContent = machineName();
    $('#eos-student').textContent = student;
    $('#eos-code').textContent = full ? 'SWR302_PE' : 'TEST_P';
    $('#eos-duration').textContent = full ? `${EXAM_MINUTES} minutes` : 'unlimited';
    $('#eos-total').textContent = state.list.length;
    $('#eos-window').classList.toggle('eos-practice', !full);
  }

  function start(mode) {
    const questions = pool();
    if (!questions.length) return;
    state.mode = mode;
    state.review = false;
    state.list =
      mode === 'full'
        ? shuffled(questions).slice(0, Math.min(EXAM_SIZE, questions.length))
        : shuffled(questions);
    state.index = 0;
    state.answers = state.list.map(() => new Set());
    state.checked = state.list.map(() => false);
    state.startedAt = Date.now();

    stopTimer();
    if (mode === 'full') {
      state.deadline = Date.now() + EXAM_MINUTES * 60 * 1000;
      state.timer = setInterval(paintTimer, 1000);
    }

    applyMeta();
    resetFinishChecks();
    setStrip(false);
    show('exam');
    paintTimer();
    render();
    persist();
  }

  // Mở lại bài đang dở: giữ nguyên thứ tự câu đã bốc và các ô đã tick.
  function resume(session) {
    const byId = new Map(getCards().map((card) => [card.id, card]));
    const list = session.ids.map((id) => byId.get(id)).filter(Boolean);
    if (list.length !== session.ids.length) {
      // Bộ đề đã đổi kể từ lúc thi, không khôi phục nửa vời được.
      clearSession();
      show('launcher');
      return;
    }

    state.mode = session.mode === 'full' ? 'full' : 'practice';
    state.review = false;
    state.list = list;
    state.answers = list.map((_, position) => new Set([...(session.answers?.[position] || '')]));
    state.checked = list.map((_, position) => Boolean(session.checked?.[position]));
    state.index = Math.min(Math.max(session.index || 0, 0), list.length - 1);
    state.deadline = session.deadline || 0;
    state.startedAt = session.startedAt || Date.now();

    applyMeta();
    resetFinishChecks();
    setStrip(false);
    show('exam');

    stopTimer();
    if (state.mode === 'full') {
      // Hết giờ trong lúc đóng app thì vào là chấm luôn, không cho làm tiếp.
      if (Date.now() >= state.deadline) {
        render();
        finish(true);
        return;
      }
      state.timer = setInterval(paintTimer, 1000);
    }
    paintTimer();
    render();
  }

  function describeSession(session) {
    const answered = (session.answers || []).filter(Boolean).length;
    const total = session.ids.length;
    if (session.mode !== 'full') {
      return `Luyện từng câu · đang ở câu ${(session.index || 0) + 1}/${total} · đã trả lời ${answered} câu.`;
    }
    const left = Math.max(0, Math.round((session.deadline - Date.now()) / 60000));
    return left
      ? `Thi thử FPT · đã làm ${answered}/${total} câu · còn khoảng ${left} phút.`
      : `Thi thử FPT · đã làm ${answered}/${total} câu · đã hết giờ, vào là nộp bài luôn.`;
  }

  function renderAnswerColumn(card) {
    const picked = state.answers[state.index];
    const want = expected(card);
    $('#eos-answers').innerHTML = letters(card)
      .map((letter) => {
        const on = picked.has(letter);
        let mark = '';
        if (revealed()) {
          if (want.has(letter)) mark = ' is-correct';
          else if (on) mark = ' is-wrong';
        }
        return `<label class="eos-answer${mark}">
            <input type="checkbox" data-option="${escapeHtml(letter)}" ${on ? 'checked' : ''} ${revealed() ? 'disabled' : ''} />
            <span>${escapeHtml(letter)}</span>
          </label>`;
      })
      .join('');
  }

  function renderOptions(card) {
    const picked = state.answers[state.index];
    const want = expected(card);
    $('#eos-options').innerHTML = letters(card)
      .map((letter) => {
        const on = picked.has(letter);
        let mark = '';
        if (revealed()) {
          if (want.has(letter)) mark = ' is-correct';
          else if (on) mark = ' is-wrong';
        }
        return `<button class="eos-option${on ? ' is-picked' : ''}${mark}" type="button" data-option="${escapeHtml(letter)}" aria-pressed="${on}" ${revealed() ? 'disabled' : ''}>
            <span class="eos-option-box" aria-hidden="true"></span>
            <span class="eos-option-text">${escapeHtml(letter)}. ${escapeHtml(card.options[letter])}</span>
          </button>`;
      })
      .join('');
  }

  function renderStrip() {
    // Bộ đề có thể vài trăm câu nên chỉ dựng lại dải số khi nó đang mở.
    if ($('#eos-strip').classList.contains('hidden')) return;
    $('#eos-strip').innerHTML = state.list
      .map((card, position) => {
        const picked = state.answers[position];
        let cls = picked.size ? 'answered' : '';
        if (state.review) {
          cls = isCorrect(card, picked) ? 'right' : 'miss';
        } else if (state.mode === 'practice' && state.checked[position]) {
          cls = isCorrect(card, picked) ? 'right' : 'miss';
        }
        if (position === state.index) cls += ' current';
        return `<button class="eos-num ${cls}" type="button" data-jump="${position}">${position + 1}</button>`;
      })
      .join('');
    const active = $('#eos-strip').querySelector('.current');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function render() {
    const card = current();
    if (!card) return;
    const many = card.answer.length > 1;

    $('#eos-head').textContent = `Multiple choices ${state.index + 1}/${state.list.length}`;
    $('#eos-hint').textContent = `(Choose ${card.answer.length} answer${many ? 's' : ''})`;
    $('#eos-question').textContent = card.question;
    renderAnswerColumn(card);
    renderOptions(card);
    renderStrip();

    const feedback = $('#eos-feedback');
    if (revealed()) {
      const ok = isCorrect(card, state.answers[state.index]);
      feedback.textContent = ok
        ? 'Chính xác - bạn nắm rất chắc!'
        : `Chưa đúng. Đáp án là ${card.answer.split('').join(', ')}.`;
      feedback.classList.remove('hidden');
      feedback.classList.toggle('is-ok', ok);
    } else {
      feedback.classList.add('hidden');
      feedback.textContent = '';
    }

    $('#eos-check').classList.toggle(
      'hidden',
      state.mode !== 'practice' || state.review || state.checked[state.index],
    );
    // Lưu câu hỏi chỉ có nghĩa khi đang luyện từng câu; lúc thi tính điểm thì
    // giao diện phải sạch đúng như phòng thi thật.
    const save = $('#eos-save');
    save.classList.toggle('hidden', state.mode !== 'practice' || state.review);
    const saved = Boolean(isSaved?.(card));
    save.classList.toggle('is-saved', saved);
    save.setAttribute('aria-pressed', String(saved));
    $('#eos-save-label').textContent = saved ? 'Đã lưu' : 'Lưu câu hỏi';

    $('#eos-prev').disabled = state.index === 0;
    $('#eos-next').disabled = state.index >= state.list.length - 1;
    $('#eos-strip-label').textContent = `Danh sách câu hỏi · ${state.index + 1}/${state.list.length}`;
  }

  function pick(letter) {
    const card = current();
    if (!card || revealed()) return;
    const picked = state.answers[state.index];
    if (card.answer.length === 1) {
      state.answers[state.index] = picked.has(letter)
        ? new Set()
        : new Set([letter]);
    } else if (picked.has(letter)) {
      picked.delete(letter);
    } else {
      picked.add(letter);
    }
    render();
    persist();
  }

  function go(position) {
    state.index = Math.min(Math.max(position, 0), state.list.length - 1);
    render();
    persist();
    $('.eos-paper').scrollIntoView({ block: 'nearest' });
  }

  function finish(auto = false) {
    if (state.mode !== 'full' || state.review) return;
    if (!auto) {
      const blank = state.answers.filter((set) => !set.size).length;
      const message = blank
        ? `Bạn còn ${blank} câu chưa trả lời. Nộp bài luôn?`
        : 'Nộp bài và xem điểm?';
      if (!confirm(message)) return;
    }
    stopTimer();
    // Bài đã nộp thì không còn là bài dở nữa.
    clearSession();

    const correct = state.list.filter((card, position) =>
      isCorrect(card, state.answers[position]),
    ).length;
    const total = state.list.length;
    const mark = total ? (correct / total) * 10 : 0;
    const minutes = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));

    $('#result-mark').textContent = mark.toFixed(1).replace(/\.0$/, '');
    $('#result-copy').textContent = `${correct}/${total} câu đúng · làm trong ${minutes} phút${auto ? ' · hết giờ nên hệ thống tự nộp bài' : ''}`;
    show('result');
  }

  function review() {
    state.review = true;
    state.index = 0;
    resetFinishChecks();
    show('exam');
    paintTimer();
    render();
  }

  function leave() {
    stopTimer();
    state.mode = null;
    state.review = false;
    show('launcher');
    onLeave?.();
  }

  // --- wiring -------------------------------------------------------------
  $('#exam-start-practice').onclick = () => start('practice');
  $('#exam-start-full').onclick = () => start('full');

  $('#resume-continue').onclick = () => {
    const session = readSession(getSubject());
    if (session) resume(session);
    else show('launcher');
  };
  $('#resume-restart').onclick = () => {
    const session = readSession(getSubject());
    clearSession();
    if (session) start(session.mode === 'full' ? 'full' : 'practice');
    else show('launcher');
  };
  $('#resume-drop').onclick = () => {
    clearSession();
    show('launcher');
  };

  // Toàn màn hình để lúc luyện không thấy phần còn lại của web, giống phòng thi.
  const fullscreenTarget = () => document.getElementById('exam');
  function paintFullscreen() {
    const on = document.fullscreenElement === fullscreenTarget();
    $('#eos-fullscreen').classList.toggle('is-on', on);
    $('#eos-fullscreen').setAttribute('aria-pressed', String(on));
    $('#eos-fullscreen-label').textContent = on ? 'Thoát toàn màn hình' : 'Toàn màn hình';
  }
  $('#eos-fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await fullscreenTarget().requestFullscreen();
    } catch {
      // Safari trên iPhone không cho phần tử vào toàn màn hình, bỏ qua.
    }
  };
  document.addEventListener('fullscreenchange', paintFullscreen);
  // Trình duyệt không hỗ trợ thì giấu nút đi cho đỡ rối.
  if (!document.documentElement.requestFullscreen) {
    $('#eos-fullscreen').classList.add('hidden');
  }

  $('#eos-answers').onclick = (event) => {
    const input = event.target.closest('input[data-option]');
    if (input) pick(input.dataset.option);
  };
  $('#eos-options').onclick = (event) => {
    const button = event.target.closest('[data-option]');
    if (button) pick(button.dataset.option);
  };
  $('#eos-strip').onclick = (event) => {
    const button = event.target.closest('[data-jump]');
    if (button) go(Number(button.dataset.jump));
  };
  // Dải số câu mặc định gập lại cho gọn, bấm mới mở ra.
  function setStrip(open) {
    $('#eos-strip').classList.toggle('hidden', !open);
    $('#eos-strip-toggle').classList.toggle('is-open', open);
    $('#eos-strip-toggle').setAttribute('aria-expanded', String(open));
    if (open) renderStrip();
  }
  $('#eos-strip-toggle').onclick = () =>
    setStrip($('#eos-strip').classList.contains('hidden'));
  $('#eos-save').onclick = () => {
    const card = current();
    if (!card) return;
    onToggleSave?.(card);
    render();
  };
  $('#eos-prev').onclick = () => go(state.index - 1);
  $('#eos-next').onclick = () => go(state.index + 1);
  $('#eos-check').onclick = () => {
    if (!state.answers[state.index].size) return;
    state.checked[state.index] = true;
    render();
    persist();
  };

  // Nút Finish chỉ bật khi đã tick ô xác nhận, đúng như EOS thật.
  const checks = ['#eos-finish-check', '#eos-finish-check-bottom'];
  checks.forEach((id) => {
    $(id).onchange = (event) => {
      checks.forEach((other) => {
        $(other).checked = event.target.checked;
      });
      setFinishEnabled(event.target.checked);
    };
  });
  $('#eos-finish-top').onclick = () => (state.mode === 'full' && !state.review ? finish() : leave());
  $('#eos-finish-bottom').onclick = () => (state.mode === 'full' && !state.review ? finish() : leave());
  $('#eos-leave').onclick = () => {
    // Bài dở được giữ lại nên rời phòng không còn là mất trắng nữa.
    if (
      state.mode === 'full' &&
      !state.review &&
      !confirm('Rời phòng thi? Bài làm được giữ lại, lần sau vào bạn chọn làm tiếp. Đồng hồ vẫn chạy.')
    ) {
      return;
    }
    leave();
  };

  $('#result-review').onclick = review;
  $('#result-again').onclick = () => start(state.mode || 'full');
  $('#result-home').onclick = () => {
    stopTimer();
    state.mode = null;
    show('launcher');
  };

  return {
    // Vào lại phòng thi: đang thi dở thì giữ nguyên màn hình, còn nếu máy (hoặc
    // thiết bị khác) có bài chưa nộp thì hỏi làm tiếp hay làm lại.
    open() {
      if (state.mode) return;
      const session = readSession(getSubject());
      if (!session || !getCards().length) {
        show('launcher');
        return;
      }
      $('#resume-summary').textContent = describeSession(session);
      show('resume');
    },
    setStudent(name) {
      student = name || 'student';
      $('#eos-student').textContent = student;
    },
    refresh() {
      const count = Math.min(EXAM_SIZE, pool().length);
      $('#exam-full-count').textContent = count || EXAM_SIZE;
    },
    // Đổi môn thì rời bài đang mở, nhưng bài dở của môn cũ vẫn được giữ.
    reset() {
      stopTimer();
      state.mode = null;
      state.review = false;
      resetFinishChecks();
      setStrip(false);
      show('launcher');
    },
    // Bài dở của mọi môn, để đẩy lên server cùng tiến độ.
    sessions() {
      return Object.fromEntries(
        subjectIds()
          .map((id) => [id, readSession(id)])
          .filter(([, session]) => session),
      );
    },
    // Bản trên server mới hơn (làm dở ở máy khác) thì lấy về.
    adoptSessions(remote) {
      let changed = false;
      for (const [subject, session] of Object.entries(remote || {})) {
        if (!session?.ids?.length) continue;
        const local = readSession(subject);
        if (local && (local.updatedAt || 0) >= (session.updatedAt || 0)) continue;
        localStorage.setItem(sessionKey(subject), JSON.stringify(session));
        changed = true;
      }
      // Đang thi dở trên máy này thì không giật màn hình của người dùng.
      if (changed && !state.mode) this.open();
    },
  };
}
