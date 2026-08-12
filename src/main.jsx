import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LiquidGlass from 'liquid-glass-react';
import STATIC_SUBJECTS from './data/subjects.json';
import { api, getDeviceId, loadGoogleIdentity } from './api.js';
import { readImportFile } from './admin-import.js';
import './style.css';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const shuffle = (items) => [...items].sort(() => Math.random() - .5);
const normalizeAnswer = (value) => [...new Set(String(value || '').toUpperCase().replace(/[^A-D]/g, ''))].sort().join('');

function Glass({ children, className = '', strong = false }) {
  return <div className={`glass ${strong ? 'glass-strong' : ''} ${className}`}>{children}</div>;
}

function HeaderGlass() {
  return (
    <LiquidGlass
      className="header-liquid"
      displacementScale={58}
      blurAmount={0.09}
      saturation={122}
      aberrationIntensity={1.2}
      elasticity={0.11}
      cornerRadius={28}
      padding="0"
      overLight
      mode="standard"
      style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%' }}
    ><span className="header-liquid-fill" /></LiquidGlass>
  );
}

function GoogleButton({ onLogin, onError }) {
  const ref = useRef(null);
  useEffect(() => {
    let cancelled = false;
    async function setup() {
      const loaded = await loadGoogleIdentity();
      if (cancelled || !loaded || !ref.current) return;
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      if (!clientId) return onError('Thiếu VITE_GOOGLE_CLIENT_ID');
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          const result = await api('/auth/google', {
            method: 'POST',
            body: JSON.stringify({ credential, deviceId: getDeviceId(), userAgent: navigator.userAgent }),
          });
          if (!result.ok) return onError(result.data.error || 'Đăng nhập thất bại');
          onLogin(result.data.user);
        },
      });
      ref.current.replaceChildren();
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 210 });
    }
    setup();
    return () => { cancelled = true; };
  }, [onLogin, onError]);
  return <div className="google-button" ref={ref} />;
}

function SubjectPicker({ subjects, value, onChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const selected = subjects.find((subject) => subject.id === value) || subjects[0];
  useEffect(() => {
    const close = (event) => !root.current?.contains(event.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <div className={`subject-picker ${open ? 'open' : ''}`} ref={root}>
    <button className="subject-select" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="subject-select-icon">Môn</span><strong>{selected?.label}</strong><i aria-hidden="true" />
    </button>
    {open && <div className="subject-menu" role="listbox">
      <div className="subject-menu-title">Chọn môn học</div>
      {subjects.map((subject) => <button type="button" role="option" aria-selected={subject.id === value} className={subject.id === value ? 'active' : ''} key={subject.id} onClick={() => { onChange(subject.id); setOpen(false); }}>
        <span>{subject.id.slice(0, 3)}</span><div><b>{subject.label}</b><small>{subject.questionCount || 0} câu hỏi</small></div><em>✓</em>
      </button>)}
    </div>}
  </div>;
}

function Header({ view, setView, subjects, subjectId, setSubjectId, user, profile, onLogin, onLogout, toast }) {
  const stars = Number(profile?.stars?.[subjectId] || 0);
  return (
    <header className="app-header">
      <div className="header-glass"><HeaderGlass /></div>
      <button className="brand" onClick={() => setView('home')}><img className="brand-dot" src="/hachimi-brand.png" alt="" /><span>Hachimi</span></button>
      <nav className="nav-pills" aria-label="Điều hướng">
        <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>Tổng quan</button>
        <button className={view === 'study' ? 'active' : ''} onClick={() => setView('study')}>Flashcard</button>
        <button className={view === 'exam' ? 'active' : ''} onClick={() => setView('exam')}>EOS</button>
        {user?.isAdmin && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>Quản trị</button>}
      </nav>
      <div className="header-actions">
        <SubjectPicker subjects={subjects} value={subjectId} onChange={setSubjectId} />
        {user && <span className="star-chip">★ {stars}</span>}
        {user ? (
          <Glass className="user-chip"><img src={user.picture || ''} alt="" /><span>{user.name || user.email}</span><button onClick={onLogout}>Thoát</button></Glass>
        ) : <GoogleButton onLogin={onLogin} onError={toast} />}
      </div>
    </header>
  );
}

function Home({ subjects, subjectId, setSubjectId, setView, user, profile, openPurchase }) {
  const selected = subjects.find((subject) => subject.id === subjectId) || subjects[0];
  const examOwned = user?.isAdmin || profile?.entitlements?.examSubjects?.includes(subjectId);
  const trickOwned = user?.isAdmin || profile?.entitlements?.trickSubjects?.includes(subjectId);
  return (
    <main>
      <section className="hero">
        <div className="hero-copy"><span className="kicker">HỌC LỎ CÓ CHIẾN THUẬT</span><h1>Học nhẹ đầu.<br /><em>Thi có bài.</em></h1><p>Flashcard miễn phí cho mọi người. Khi cần cảm giác phòng thi thật, vào EOS 60 câu · 60 phút và tích sao để mở từng pack trick lỏ.</p><div className="hero-actions"><button className="primary" onClick={() => setView('study')}>Học flashcard miễn phí</button><button className="secondary" onClick={() => setView('exam')}>Vào phòng EOS</button></div></div>
        <Glass strong className="hero-orbit"><div className="orbit-core"><strong>{profile?.stars?.[subjectId] || 0}</strong><span>ngôi sao</span></div><div className="orbit-note">Mỗi bài ≥ 5 điểm nhận 1 sao<br />≥ 8 điểm nhận 2 sao</div></Glass>
      </section>

      <section className="section"><div className="section-head"><div><span className="kicker">CHỌN MÔN</span><h2>Hôm nay lỏ môn nào?</h2></div><p>Đang chọn <strong>{selected?.label}</strong></p></div><div className="subject-grid">{subjects.map((subject) => <button key={subject.id} className={`subject-card ${subject.id === subjectId ? 'active' : ''}`} onClick={() => setSubjectId(subject.id)}><span>{subject.id.slice(0, 3)}</span><strong>{subject.label}</strong><small>{subject.questionCount || '—'} câu hỏi</small></button>)}</div></section>

      <section className="section"><div className="section-head"><div><span className="kicker">GÓI HỌC</span><h2>Free để học, trả phí khi cần lợi thế.</h2></div></div><div className="pricing-grid">
        <Glass className="price-card"><span className="price-icon">◌</span><h3>Flashcard</h3><p>Học toàn bộ câu hỏi, lưu câu và tự highlight theo cách nhớ của bạn.</p><strong>Miễn phí</strong><button className="secondary" onClick={() => setView('study')}>Bắt đầu học</button></Glass>
        <Glass className="price-card featured"><span className="price-icon">▣</span><h3>Test mô phỏng EOS</h3><p>Kiểm tra từng câu hoặc thi thử FPT 60 câu trong 60 phút.</p><strong>{money(selected?.examPrice || 20000)} <small>/ môn</small></strong>{examOwned ? <button className="owned" onClick={() => setView('exam')}>Đã mở khóa</button> : <button className="primary" onClick={() => openPurchase('exam')}>Mở khóa EOS</button>}</Glass>
        <Glass className="price-card"><span className="price-icon">✦</span><h3>Gói trick lỏ</h3><p>Trick do Hoàng tổng hợp, hiện ngay trong flashcard và phần xem lại.</p><strong>{money(selected?.trickPrice || 20000)} <small>/ tài khoản</small></strong>{trickOwned ? <button className="owned" onClick={() => setView('study')}>Đã mở khóa</button> : <button className="secondary" onClick={() => openPurchase('trick')}>Mở khóa trick</button>}</Glass>
      </div></section>
    </main>
  );
}

function Highlighted({ text, terms = [] }) {
  if (!terms.length) return text;
  const safe = terms.filter(Boolean).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${safe.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return String(text).split(pattern).map((part, index) => safe.some((term) => term.toLowerCase() === part.toLowerCase()) ? <mark key={index}>{part}</mark> : part);
}

function Study({ questions, subject, user, profile, refreshProfile, toast, openPurchase }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tricks, setTricks] = useState({ packs: [] });
  const card = questions[index] || null;
  const terms = card ? profile?.highlights?.[card.id] || [] : [];
  useEffect(() => { setIndex(0); setFlipped(false); }, [subject?.id]);
  useEffect(() => {
    if (!user || !subject) return setTricks({ packs: [] });
    api(`/profile/tricks?subject=${encodeURIComponent(subject.id)}`).then((result) => result.ok && setTricks(result.data));
  }, [user, subject, profile?.stars]);
  const trick = useMemo(() => {
    if (!card) return null;
    return tricks.packs?.flatMap((pack) => pack.items || []).find((item) => item.questionId === card.id)?.content || null;
  }, [card, tricks]);

  async function addHighlight() {
    if (!user) return toast('Đăng nhập Google để lưu highlight');
    const selected = window.getSelection()?.toString().trim();
    if (!selected || selected.length > 180) return toast('Hãy bôi đen một đoạn ngắn trên câu hỏi hoặc đáp án');
    const next = [...new Set([...terms, selected])].slice(0, 20);
    const result = await api(`/profile/highlights/${card.id}`, { method: 'PUT', body: JSON.stringify({ terms: next }) });
    if (!result.ok) return toast(result.data.error || 'Không lưu được highlight');
    await refreshProfile(); toast('Đã lưu cách nhớ của bạn', 'success');
  }
  async function clearHighlights() {
    const result = await api(`/profile/highlights/${card.id}`, { method: 'PUT', body: JSON.stringify({ terms: [] }) });
    if (result.ok) { await refreshProfile(); toast('Đã xóa highlight', 'success'); }
  }

  if (!card) return <main className="empty-page"><h2>Chưa có câu hỏi cho môn này</h2></main>;
  return (
    <main className="study-page">
      <div className="study-top"><div><span className="kicker">FLASHCARD MIỄN PHÍ</span><h1>{subject?.label}</h1></div><div className="card-progress"><span>{index + 1} / {questions.length}</span><div><i style={{ width: `${(index + 1) / questions.length * 100}%` }} /></div></div></div>
      <div className="study-shell">
        <aside><Glass><strong>Hãy lỏ theo cách của bạn</strong><p>Bôi đen đoạn cần nhớ rồi lưu highlight. Màu đánh dấu sẽ đi cùng tài khoản.</p><button onClick={addHighlight}>Lưu đoạn đang chọn</button>{terms.length > 0 && <button className="text-action" onClick={clearHighlights}>Xóa highlight câu này</button>}</Glass><Glass><strong>Trick lỏ</strong>{trick ? <p className="trick-content">{trick}</p> : user ? <p>Chưa có trick được mở cho câu này. Tích sao hoặc mở gói trick.</p> : <p>Đăng nhập để xem tiến độ trick.</p>}{!tricks.purchased && <button onClick={() => openPurchase('trick')}>Xem gói trick</button>}</Glass></aside>
        <section className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(!flipped)}>
          <div className="flash-face front"><span>CÂU {card.numberOnPage || index + 1} · TRANG {card.page}</span><h2><Highlighted text={card.question} terms={terms} /></h2><div className="flash-options">{Object.entries(card.options || {}).map(([letter, option]) => <p key={letter}><b>{letter}</b><Highlighted text={option} terms={terms} /></p>)}</div><small>Chạm để xem đáp án</small></div>
          <div className="flash-face back"><span>ĐÁP ÁN</span><h2>{card.answer}</h2><div className="flash-options">{Object.entries(card.options || {}).map(([letter, option]) => <p className={card.answer.includes(letter) ? 'correct' : ''} key={letter}><b>{letter}</b><Highlighted text={option} terms={terms} /></p>)}</div>{trick && <div className="trick-inline"><b>✦ Trick lỏ</b>{trick}</div>}<small>Chạm để quay lại câu hỏi</small></div>
        </section>
      </div>
      <div className="study-controls"><button onClick={() => { setIndex((index - 1 + questions.length) % questions.length); setFlipped(false); }}>← Câu trước</button><button className="primary" onClick={() => { setIndex((index + 1) % questions.length); setFlipped(false); }}>Câu tiếp →</button></div>
    </main>
  );
}

function EosExam({ questions, subject, user, profile, refreshProfile, toast, openPurchase }) {
  const [session, setSession] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [tricks, setTricks] = useState({ packs: [] });
  const [showResult, setShowResult] = useState(false);
  const [finishArmed, setFinishArmed] = useState(false);
  const hasAccess = user?.isAdmin || profile?.entitlements?.examSubjects?.includes(subject?.id);
  useEffect(() => { setSession(null); setShowResult(false); setFinishArmed(false); }, [subject?.id]);
  useEffect(() => {
    if (!user || !subject) return setTricks({ packs: [] });
    api(`/profile/tricks?subject=${encodeURIComponent(subject.id)}`).then((result) => result.ok && setTricks(result.data));
  }, [user, subject, profile?.stars]);
  useEffect(() => {
    if (!session?.deadline || session.finished) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.deadline, session?.finished]);

  function start(mode) {
    const pool = mode === 'full' ? shuffle(questions).slice(0, Math.min(60, questions.length)) : shuffle(questions);
    setSession({ mode, items: pool, index: 0, answers: pool.map(() => ''), checked: pool.map(() => false), deadline: mode === 'full' ? Date.now() + 60 * 60 * 1000 : 0, finished: false, result: null });
    setFinishArmed(mode === 'practice');
    setShowResult(false);
    setNow(Date.now());
  }
  function pick(letter) {
    if (!session || session.finished || (session.mode === 'practice' && session.checked[session.index])) return;
    const item = session.items[session.index];
    const multiple = item.answer.length > 1;
    const current = session.answers[session.index];
    const next = multiple ? normalizeAnswer(current.includes(letter) ? current.replace(letter, '') : current + letter) : letter;
    const answers = [...session.answers]; answers[session.index] = next; setSession({ ...session, answers });
  }
  function check() { const checked = [...session.checked]; checked[session.index] = true; setSession({ ...session, checked }); }
  async function finish() {
    const correct = session.items.filter((item, index) => normalizeAnswer(session.answers[index]) === normalizeAnswer(item.answer)).length;
    const score = Number((correct / session.items.length * 10).toFixed(1));
    let earned = 0;
    if (session.mode === 'full' && user) {
      const result = await api('/profile/exam-complete', { method: 'POST', body: JSON.stringify({ subject: subject.id, score }) });
      if (result.ok) { earned = result.data.earned; await refreshProfile(); }
    }
    setSession({ ...session, finished: true, checked: session.items.map(() => true), result: { correct, score, earned } });
    setShowResult(true);
  }
  useEffect(() => { if (session?.deadline && !session.finished && now >= session.deadline) finish(); }, [now]);

  if (!hasAccess) return <main className="locked-page"><Glass strong><span className="lock-icon">▣</span><h1>Phòng EOS của {subject?.label}</h1><p>Test mô phỏng là gói trả phí 20.000đ cho từng môn. Flashcard vẫn luôn miễn phí.</p><button className="primary" onClick={() => openPurchase('exam')}>Mở khóa test mô phỏng</button></Glass></main>;
  if (!session) return <main className="exam-launch"><div><span className="kicker">PHÒNG THI HACHIMI</span><h1>Chọn cách luyện EOS</h1><p>Giao diện mô phỏng theo bố cục EOS: thông tin máy, đồng hồ lớn, cột Answer và vùng câu hỏi.</p></div><div className="exam-mode-grid"><Glass className="mode-card"><span>LUYỆN NHANH</span><h2>Kiểm tra từng câu</h2><p>Chọn đáp án, bấm kiểm tra và xem kết quả ngay. Next ở câu cuối sẽ quay về câu 1.</p><button className="secondary" onClick={() => start('practice')}>Bắt đầu luyện</button></Glass><Glass strong className="mode-card"><span>THI THỬ FPT</span><h2>60 câu · 60 phút</h2><p>Không hiện đáp án giữa chừng. Nộp bài để nhận điểm và sao mở trick.</p><button className="primary" onClick={() => start('full')}>Vào thi ngay</button></Glass></div></main>;

  const item = session.items[session.index];
  const selected = session.answers[session.index];
  const revealed = session.finished || (session.mode === 'practice' && session.checked[session.index]);
  const trick = tricks.packs?.flatMap((pack) => pack.items || []).find((entry) => entry.questionId === item.id)?.content;
  const terms = profile?.highlights?.[item.id] || [];
  const seconds = session.deadline ? Math.max(0, Math.ceil((session.deadline - now) / 1000)) : 0;
  const time = session.mode === 'full' ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : '--:--';
  return (
    <main className="eos-page">
      <div className="eos-window">
        <div className="eos-finish"><label><input type="checkbox" checked={finishArmed || session.finished} disabled={session.finished} onChange={(event) => setFinishArmed(event.target.checked)} /> I want to finish the exam.</label><button disabled={session.finished || !finishArmed} onClick={finish}>Finish</button></div>
        <div className="eos-meta"><div><span>Machine:</span><b>DESKTOP-HACHIMI</b><span>Student:</span><b>{user?.name || 'student'}</b></div><div><span>Server:</span><b>Hachimi_EOS</b><span>Exam Code:</span><b>{subject?.id}_TEST</b></div><div><span>Duration:</span><b>{session.mode === 'full' ? '60 minutes' : 'Practice'}</b><span>Total Marks:</span><b>{session.items.length}</b></div><div className="time-row"><span>Font:</span><i>Microsoft Sans Serif</i><span>Size:</span><i>10</i><span>Time Left:</span><strong>{time}</strong></div></div>
        <div className="eos-tabs"><button className="active">Multiple Choices</button></div>
        <div className="eos-head">Multiple choices {session.index + 1}/{session.items.length}</div>
        <div className="eos-body"><aside><b>Answer</b>{Object.keys(item.options || {}).map((letter) => <label key={letter} className={revealed ? item.answer.includes(letter) ? 'right' : selected.includes(letter) ? 'wrong' : '' : ''}><input type={item.answer.length > 1 ? 'checkbox' : 'radio'} checked={selected.includes(letter)} onChange={() => pick(letter)} /> {letter}</label>)}<div className="eos-nav"><button onClick={() => setSession({ ...session, index: (session.index - 1 + session.items.length) % session.items.length })}>Previous</button><button onClick={() => setSession({ ...session, index: (session.index + 1) % session.items.length })}>Next</button>{session.mode === 'practice' && <button onClick={check} disabled={!selected || revealed}>Check answer</button>}</div></aside><section><p>({item.answer.length > 1 ? `Choose ${item.answer.length} answers` : 'Choose 1 answer'})</p><h2><Highlighted text={item.question} terms={terms} /></h2><div className="eos-options">{Object.entries(item.options || {}).map(([letter, option]) => <button key={letter} onClick={() => pick(letter)} className={`${selected.includes(letter) ? 'picked' : ''} ${revealed ? item.answer.includes(letter) ? 'right' : selected.includes(letter) ? 'wrong' : '' : ''}`}><span>{letter}.</span><Highlighted text={option} terms={terms} /></button>)}</div>{revealed && <div className="eos-feedback">Đáp án đúng: {item.answer}</div>}{revealed && trick && <div className="eos-trick"><b>✦ Trick lỏ:</b> {trick}</div>}</section></div>
        <div className="question-strip">{session.items.map((_, index) => <button key={index} className={`${index === session.index ? 'current' : ''} ${session.answers[index] ? 'answered' : ''}`} onClick={() => setSession({ ...session, index })}>{index + 1}</button>)}</div>
      </div>
      {session.finished && showResult && <div className="result-overlay"><Glass strong><span className="kicker">KẾT QUẢ</span><h2>{session.result.score}/10</h2><p>{session.result.correct}/{session.items.length} câu đúng · nhận {session.result.earned} sao</p><div className="result-actions"><button className="secondary" onClick={() => setShowResult(false)}>Xem lại bài & trick</button><button className="primary" onClick={() => setSession(null)}>Về phòng thi</button></div></Glass></div>}
    </main>
  );
}

function PurchaseModal({ product, subject, close, toast, refreshProfile }) {
  const [voucherCode, setVoucherCode] = useState('');
  const [quote, setQuote] = useState({ originalPrice: subject?.[product === 'exam' ? 'examPrice' : 'trickPrice'] || 20000, discount: 0, finalPrice: subject?.[product === 'exam' ? 'examPrice' : 'trickPrice'] || 20000 });
  async function applyVoucher() { const result = await api('/commerce/quote', { method: 'POST', body: JSON.stringify({ subject: subject.id, product, voucherCode }) }); if (!result.ok) return toast(result.data.error); setQuote(result.data); toast('Voucher đã được áp dụng', 'success'); }
  async function order() { const result = await api('/commerce/orders', { method: 'POST', body: JSON.stringify({ subject: subject.id, product, voucherCode }) }); if (!result.ok) return toast(result.data.error); toast('Đã tạo yêu cầu mua. Admin sẽ xác nhận sau khi nhận thanh toán.', 'success'); await refreshProfile(); close(); }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}><Glass strong className="modal-card"><button className="modal-x" onClick={close}>×</button><span className="kicker">MỞ KHÓA HACHIMI</span><h2>{product === 'exam' ? 'Test mô phỏng EOS' : 'Gói trick lỏ'} · {subject.label}</h2><div className="quote"><span>Giá gốc</span><b>{money(quote.originalPrice)}</b><span>Giảm giá</span><b>-{money(quote.discount)}</b><strong>Thanh toán</strong><strong>{money(quote.finalPrice)}</strong></div><div className="voucher-row"><input value={voucherCode} onChange={(event) => setVoucherCode(event.target.value.toUpperCase())} placeholder="Nhập mã voucher" /><button onClick={applyVoucher}>Áp dụng</button></div><p className="modal-note">Hiện hệ thống tạo yêu cầu mua và chờ admin xác nhận thủ công. Chưa tích hợp cổng thanh toán tự động.</p><button className="primary full" onClick={order}>Tạo yêu cầu mua</button></Glass></div>;
}

function Admin({ toast }) {
  const [data, setData] = useState({ subjects: [], questions: [], vouchers: [], orders: [] });
  const [tab, setTab] = useState('subjects');
  const [filter, setFilter] = useState('');
  const [subjectForm, setSubjectForm] = useState({ id: '', label: '', examPrice: 20000, trickPrice: 20000 });
  const [voucher, setVoucher] = useState({ code: '', type: 'percent', value: 10, product: 'all', subject: '*', usageLimit: 100 });
  const [importFile, setImportFile] = useState(null);
  const [questionForm, setQuestionForm] = useState({ subject: '', page: 1, numberOnPage: 1, question: '', options: { A: '', B: '', C: '', D: '' }, answer: 'A' });
  async function load() { const result = await api('/admin/snapshot'); if (result.ok) setData(result.data); else toast(result.data.error); }
  useEffect(() => { load(); }, []);
  async function request(path, options, success) { const result = await api(path, options); if (!result.ok) return toast(result.data.error || 'Thao tác thất bại'); toast(success, 'success'); await load(); }
  function editSubject(subject) {
    const label = prompt('Tên môn học', subject.label);
    if (label === null) return;
    const examPrice = Number(prompt('Giá EOS', subject.examPrice ?? 20000));
    const trickPrice = Number(prompt('Giá trick', subject.trickPrice ?? 20000));
    request(`/admin/subjects/${subject.id}`, { method:'PUT', body:JSON.stringify({ label, examPrice, trickPrice, active: subject.active !== false }) }, 'Đã sửa môn học');
  }
  function editQuestion(question) {
    const content = prompt('Nội dung câu hỏi', question.question);
    if (content === null) return;
    const options = Object.fromEntries(['A','B','C','D'].map((letter) => [letter, prompt(`Đáp án ${letter}`, question.options?.[letter] || '') ?? (question.options?.[letter] || '')]));
    const answer = prompt('Đáp án đúng (A hoặc BD)', question.answer);
    if (answer === null) return;
    request(`/admin/questions/${question.id}`, { method:'PUT', body:JSON.stringify({ ...question, question:content, options, answer }) }, 'Đã sửa câu hỏi');
  }
  async function importQuestions() { try { const payload = await readImportFile(importFile); await request('/admin/questions/import', { method: 'POST', body: JSON.stringify({ ...payload, replaceExisting: true }) }, `Đã import ${payload.questions.length} câu`); } catch (error) { toast(error.message); } }
  const shownQuestions = data.questions.filter((question) => !filter || question.subject === filter);
  return <main className="admin-page"><div className="admin-head"><div><span className="kicker">HACHIMI CONTROL ROOM</span><h1>Quản trị nội dung</h1></div><a href="/question-import-template.xlsx" download className="secondary">Tải template Excel</a></div><div className="admin-tabs">{[['subjects','Môn học'],['questions','Câu hỏi'],['tricks','Trick lỏ'],['vouchers','Voucher'],['orders','Đơn mua'],['import','Import']].map(([id,label]) => <button className={tab === id ? 'active' : ''} onClick={() => setTab(id)} key={id}>{label}</button>)}</div>
    {tab === 'subjects' && <div className="admin-grid"><Glass className="admin-form"><h2>Thêm môn</h2>{['id','label','examPrice','trickPrice'].map((field) => <label key={field}>{field}<input type={field.includes('Price') ? 'number' : 'text'} value={subjectForm[field]} onChange={(event) => setSubjectForm({ ...subjectForm, [field]: event.target.value })} /></label>)}<button className="primary" onClick={() => request('/admin/subjects', { method:'POST', body: JSON.stringify(subjectForm) }, 'Đã thêm môn')}>Thêm môn</button></Glass><div className="admin-list">{data.subjects.map((subject) => <Glass key={subject.id} className="admin-row"><div><b>{subject.label}</b><small>{subject.id} · {subject.questionCount || 0} câu</small></div><div className="row-actions"><button onClick={() => editSubject(subject)}>Sửa</button><button className="danger" onClick={() => confirm(`Xóa môn ${subject.label} và toàn bộ câu hỏi?`) && request(`/admin/subjects/${subject.id}`, { method:'DELETE' }, 'Đã xóa môn')}>Xóa</button></div></Glass>)}</div></div>}
    {tab === 'questions' && <><Glass className="question-create"><h2>Thêm câu hỏi</h2><div className="form-row"><select value={questionForm.subject} onChange={(event) => setQuestionForm({...questionForm,subject:event.target.value})}><option value="">Chọn môn</option>{data.subjects.map((subject)=><option key={subject.id}>{subject.id}</option>)}</select><input type="number" value={questionForm.page} onChange={(e)=>setQuestionForm({...questionForm,page:Number(e.target.value)})} placeholder="Trang" /></div><textarea value={questionForm.question} onChange={(e)=>setQuestionForm({...questionForm,question:e.target.value})} placeholder="Nội dung câu hỏi" />{Object.keys(questionForm.options).map((letter)=><input key={letter} value={questionForm.options[letter]} onChange={(e)=>setQuestionForm({...questionForm,options:{...questionForm.options,[letter]:e.target.value}})} placeholder={`Đáp án ${letter}`} />)}<input value={questionForm.answer} onChange={(e)=>setQuestionForm({...questionForm,answer:e.target.value})} placeholder="Đáp án đúng: A hoặc BD" /><button className="primary" onClick={()=>request('/admin/questions',{method:'POST',body:JSON.stringify(questionForm)},'Đã thêm câu hỏi')}>Lưu câu hỏi</button></Glass><select className="admin-filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">Tất cả môn</option>{data.subjects.map((subject) => <option key={subject.id}>{subject.id}</option>)}</select><div className="question-admin-list">{shownQuestions.slice(0,200).map((question) => <Glass key={question.id} className="question-admin-row"><div><small>#{question.id} · {question.subject} · trang {question.page}</small><p>{question.question}</p><b>Đáp án {question.answer}</b></div><div className="row-actions"><button onClick={() => editQuestion(question)}>Sửa</button><button className="danger" onClick={() => confirm('Xóa câu hỏi này?') && request(`/admin/questions/${question.id}`, { method:'DELETE' }, 'Đã xóa câu hỏi')}>Xóa</button></div></Glass>)}</div></>}
    {tab === 'tricks' && <><select className="admin-filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">Chọn môn</option>{data.subjects.map((subject) => <option key={subject.id}>{subject.id}</option>)}</select><div className="question-admin-list">{shownQuestions.slice(0,200).map((question) => <TrickEditor key={question.id} question={question} request={request} />)}</div></>}
    {tab === 'vouchers' && <div className="admin-grid"><Glass className="admin-form"><h2>Tạo voucher</h2><input value={voucher.code} onChange={(e)=>setVoucher({...voucher,code:e.target.value.toUpperCase()})} placeholder="HACHIMI20" /><select value={voucher.type} onChange={(e)=>setVoucher({...voucher,type:e.target.value})}><option value="percent">Phần trăm</option><option value="fixed">Số tiền</option></select><input type="number" value={voucher.value} onChange={(e)=>setVoucher({...voucher,value:Number(e.target.value)})} /><select value={voucher.product} onChange={(e)=>setVoucher({...voucher,product:e.target.value})}><option value="all">Tất cả</option><option value="exam">EOS</option><option value="trick">Trick</option></select><select value={voucher.subject} onChange={(e)=>setVoucher({...voucher,subject:e.target.value})}><option value="*">Mọi môn</option>{data.subjects.map((subject)=><option key={subject.id}>{subject.id}</option>)}</select><input type="number" value={voucher.usageLimit} onChange={(e)=>setVoucher({...voucher,usageLimit:Number(e.target.value)})} placeholder="Lượt dùng" /><button className="primary" onClick={()=>request('/admin/vouchers',{method:'POST',body:JSON.stringify(voucher)},'Đã tạo voucher')}>Tạo mã</button></Glass><div className="admin-list">{data.vouchers.map((item)=><Glass className="admin-row" key={item._id}><div><b>{item.code}</b><small>{item.type === 'percent' ? `${item.value}%` : money(item.value)} · {item.usedCount}/{item.usageLimit || '∞'} · {item.active ? 'đang bật' : 'đã tắt'}</small></div><div className="row-actions"><button onClick={()=>request(`/admin/vouchers/${item._id}`,{method:'PUT',body:JSON.stringify({active:!item.active,usageLimit:item.usageLimit,expiresAt:item.expiresAt})},item.active?'Đã tắt voucher':'Đã bật voucher')}>{item.active?'Tắt':'Bật'}</button><button className="danger" onClick={()=>request(`/admin/vouchers/${item._id}`,{method:'DELETE'},'Đã xóa voucher')}>Xóa</button></div></Glass>)}</div></div>}
    {tab === 'orders' && <div className="admin-list">{data.orders.map((order)=><Glass className="admin-row" key={order._id}><div><b>{order.email}</b><small>{order.subject} · {order.product} · {money(order.finalPrice)} · {order.status}</small></div>{order.status === 'pending' && <div><button onClick={()=>request(`/admin/orders/${order._id}/activate`,{method:'POST'},'Đã kích hoạt quyền')}>Duyệt</button><button className="danger" onClick={()=>request(`/admin/orders/${order._id}/cancel`,{method:'POST'},'Đã hủy đơn')}>Hủy</button></div>}</Glass>)}</div>}
    {tab === 'import' && <Glass className="import-panel"><h2>Import câu hỏi và môn học</h2><p>Dùng đúng sheet Questions trong template. Mỗi file chứa một môn, tối đa 1.000 câu.</p><input type="file" accept=".xlsx" onChange={(event)=>setImportFile(event.target.files?.[0])} /><button className="primary" disabled={!importFile} onClick={importQuestions}>Import và thay thế dữ liệu môn</button></Glass>}
  </main>;
}

function TrickEditor({ question, request }) {
  const [pack, setPack] = useState(question.tricks?.[0]?.pack || 1);
  const [content, setContent] = useState(question.tricks?.[0]?.content || '');
  return <Glass className="trick-editor"><small>#{question.id} · {question.subject}</small><p>{question.question}</p><div><input type="number" min="1" value={pack} onChange={(e)=>setPack(Number(e.target.value))} /><textarea value={content} onChange={(e)=>setContent(e.target.value)} placeholder="Nhập trick lỏ cho câu này" /><button onClick={()=>request(`/admin/questions/${question.id}/tricks`,{method:'PUT',body:JSON.stringify({tricks:content?[{pack,content}]:[]})},'Đã lưu trick')}>Lưu</button></div></Glass>;
}

function SupportModal({ close }) { return <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&close()}><Glass strong className="modal-card support-card"><button className="modal-x" onClick={close}>×</button><span className="kicker">CẢM ƠN BẠN</span><h2>Ủng hộ Hachimi</h2><p>Nếu Hachimi giúp bạn học nhẹ đầu hơn, bạn có thể ủng hộ tụi mình tiếp tục cập nhật nội dung.</p><img src="/momo-qr.jpg" alt="QR MoMo ủng hộ" /></Glass></div>; }

function App() {
  const [view, setView] = useState('home');
  const [subjects, setSubjects] = useState(STATIC_SUBJECTS);
  const [subjectId, setSubjectId] = useState(localStorage.getItem('hachimi-subject') || STATIC_SUBJECTS[0].id);
  const [questions, setQuestions] = useState([]);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [purchase, setPurchase] = useState(null);
  const [support, setSupport] = useState(false);
  const [notice, setNotice] = useState(null);
  const subject = subjects.find((item) => item.id === subjectId) || subjects[0];
  const toast = useCallback((message, tone = 'error') => { setNotice({ message, tone }); setTimeout(() => setNotice(null), 5000); }, []);
  const refreshProfile = useCallback(async () => { if (!user) return setProfile(null); const result = await api('/profile'); if (result.ok) setProfile(result.data); }, [user]);
  const login = useCallback(async (nextUser) => { setUser(nextUser); toast(`Chào ${nextUser.name || nextUser.email}`, 'success'); }, [toast]);
  const logout = useCallback(async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); setProfile(null); setView('home'); }, []);
  useEffect(() => { api('/auth/me').then((result) => result.ok && setUser(result.data.user)); }, []);
  useEffect(() => { refreshProfile(); }, [refreshProfile]);
  useEffect(() => {
    api('/subjects').then((result) => {
      if (!result.ok) return;
      const merged = new Map(STATIC_SUBJECTS.map((item) => [item.id, item]));
      result.data.subjects.forEach((item) => merged.set(item.id, { ...merged.get(item.id), ...item }));
      setSubjects([...merged.values()]);
    });
  }, []);
  useEffect(() => {
    localStorage.setItem('hachimi-subject', subjectId);
    api(`/questions?subject=${encodeURIComponent(subjectId)}`).then((result) => setQuestions(result.ok ? result.data.questions : []));
  }, [subjectId]);
  useEffect(() => { if (view === 'admin' && !user?.isAdmin) setView('home'); }, [view, user]);
  function openPurchase(product) { if (!user) return toast('Đăng nhập Google trước khi mua gói'); setPurchase(product); }
  return <>
    <div className="background"><i /><i /><i /></div>
    <div className="app-shell">
      <Header view={view} setView={setView} subjects={subjects} subjectId={subjectId} setSubjectId={setSubjectId} user={user} profile={profile} onLogin={login} onLogout={logout} toast={toast} />
      {view === 'home' && <Home subjects={subjects} subjectId={subjectId} setSubjectId={setSubjectId} setView={setView} user={user} profile={profile} openPurchase={openPurchase} />}
      {view === 'study' && <Study questions={questions} subject={subject} user={user} profile={profile} refreshProfile={refreshProfile} toast={toast} openPurchase={openPurchase} />}
      {view === 'exam' && <EosExam questions={questions} subject={subject} user={user} profile={profile} refreshProfile={refreshProfile} toast={toast} openPurchase={openPurchase} />}
      {view === 'admin' && user?.isAdmin && <Admin toast={toast} />}
      {!user?.isAdmin && <footer>Bạn muốn ủng hộ? <button onClick={() => setSupport(true)}>Bấm tại đây</button></footer>}
    </div>
    {purchase && <PurchaseModal product={purchase} subject={subject} close={() => setPurchase(null)} toast={toast} refreshProfile={refreshProfile} />}
    {support && <SupportModal close={() => setSupport(false)} />}
    {notice && <div className={`toast ${notice.tone}`}>{notice.message}</div>}
  </>;
}

createRoot(document.getElementById('app')).render(<App />);
