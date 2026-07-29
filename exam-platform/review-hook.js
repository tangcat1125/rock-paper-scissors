(function () {
  const SESSION_SELECTOR = '#session-data';
  const REVIEW_KEY = 'exeam:lastSession';
  const DRAFT_KEY = 'exeam:review-draft';

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getSession() {
    const node = document.querySelector(SESSION_SELECTOR);
    if (!node) return null;
    return safeParse(node.textContent || '');
  }

  const session = getSession();
  if (!session || !Array.isArray(session.questions)) return;

  const SUBJECT_LABELS = {
    'pharmaceutical-law-regulations': '法規',
    'dispensing-clinical-pharmacy': '調劑臨床',
    therapeutics: '藥治'
  };

  function subjectLabel(subjectId, fallback) {
    return SUBJECT_LABELS[subjectId] || fallback || '';
  }

  function formatUnitCitation(question) {
    if (question.unitCitation) return question.unitCitation;
    if (question.unitTitle && question.subjectTitle) return `${question.unitTitle} / ${question.subjectTitle}`;
    return question.subjectTitle || question.unitTitle || '';
  }

  const draft = {
    sourcePage: location.pathname,
    generatedAt: new Date().toISOString(),
    mode: session.mode || 'diagnostic20',
    modeText: session.modeText || '',
    timeLimitMinutes: session.timeLimitMinutes || 0,
    sections: session.sections || [],
    answers: {},
    changes: [],
    firstChoiceAt: {},
    lastChoiceAt: {},
    timeByQuestion: Array(session.questions.length).fill(0),
    currentQuestionIndex: 0,
    currentEnterAt: Date.now(),
    submittedAt: null,
    submitted: false
  };

  function fmtQuestionIndexFromDom() {
    const activeNav = document.querySelector('#nav-list .nav-btn.active');
    if (activeNav) {
      const match = String(activeNav.textContent || '').match(/Q(\d+)/i);
      if (match) return Math.max(0, Number(match[1]) - 1);
    }
    const badge = document.querySelector('#question-root .question-head .question-badge');
    if (!badge) return null;
    const match = String(badge.textContent || '').match(/(\d+)/);
    if (!match) return null;
    const index = Number(match[1]) - 1;
    if (!Number.isFinite(index) || index < 0 || index >= session.questions.length) return null;
    return index;
  }

  function syncQuestionTiming() {
    const nextIndex = fmtQuestionIndexFromDom();
    const now = Date.now();
    if (nextIndex === null) return;
    if (nextIndex !== draft.currentQuestionIndex) {
      draft.timeByQuestion[draft.currentQuestionIndex] += (now - draft.currentEnterAt) / 1000;
      draft.currentQuestionIndex = nextIndex;
      draft.currentEnterAt = now;
    }
  }

  function recordAnswer(value) {
    const index = fmtQuestionIndexFromDom();
    if (index === null) return;
    const key = String(index + 1);
    const previous = draft.answers[key] || null;
    const now = new Date().toISOString();
    draft.answers[key] = value;
    if (!draft.firstChoiceAt[key]) draft.firstChoiceAt[key] = now;
    draft.lastChoiceAt[key] = now;
    draft.changes.push({ question: key, from: previous, to: value, at: now });
    persistDraft(false);
  }

  function buildReviewSession() {
    const finishedAt = new Date().toISOString();
    const mergedTimeByQuestion = draft.timeByQuestion.slice();
    const activeIndex = draft.currentQuestionIndex;
    mergedTimeByQuestion[activeIndex] += (Date.now() - draft.currentEnterAt) / 1000;
    const questions = session.questions.map((q, idx) => {
      const key = String(idx + 1);
      const selectedAnswer = draft.answers[key] || null;
      const isCorrect = selectedAnswer === q.answer;
      return {
        questionIndex: idx + 1,
        sectionKey: q.sectionKey,
        sectionTitle: q.sectionTitle,
        subjectId: q.subjectId,
        subjectTitle: q.subjectTitle,
        unitCitation: q.unitCitation || `${q.unitTitle || ''} / ${q.subjectTitle || ''}`.replace(/^\s*\/\s*|\s*\/\s*$/g, '') || q.subjectTitle || q.unitTitle || '',
        questionNumber: q.questionNumber,
        stem: q.stem,
        options: q.options || {},
        selectedAnswer,
        correctAnswer: q.answer,
        isCorrect,
        questionPdf: q.questionPdf || null,
        answerPdfs: (q.answerPdfs || []).filter(Boolean),
        firstChoiceAt: draft.firstChoiceAt[key] || null,
        lastChoiceAt: draft.lastChoiceAt[key] || null,
        readingSeconds: Math.round(mergedTimeByQuestion[idx] || 0),
        changes: draft.changes.filter(change => change.question === key),
        reviewed: false,
        note: '',
        bookmarked: false
      };
    });
    const correctCount = questions.reduce((acc, item) => acc + (item.isCorrect ? 1 : 0), 0);
    const wrongCount = questions.length - correctCount;
    const readingSeconds = Math.round(mergedTimeByQuestion.reduce((a, b) => a + b, 0));
    return {
      generatedAt: finishedAt,
      completedAt: finishedAt,
      sourcePage: draft.sourcePage,
      mode: draft.mode,
      modeText: draft.modeText,
      timeLimitMinutes: draft.timeLimitMinutes,
      totalQuestions: questions.length,
      correctCount,
      wrongCount,
      readingSeconds,
      sections: draft.sections,
      changes: draft.changes.slice(),
      questions
    };
  }

  function persistDraft(saveResult) {
    try {
      draft.submitted = !!saveResult;
      draft.submittedAt = saveResult ? new Date().toISOString() : draft.submittedAt;
      const payload = saveResult ? buildReviewSession() : draft;
      localStorage.setItem(saveResult ? REVIEW_KEY : DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures in locked-down browsers.
    }
  }

  function injectReviewLink() {
    const actions = document.querySelector('#summary-panel .actions');
    if (!actions || actions.querySelector('[data-review-link]')) return;
    const link = document.createElement('a');
    link.className = 'btn primary';
    link.href = './review-hub.html';
    link.textContent = '進入複習區';
    link.setAttribute('data-review-link', 'true');
    actions.insertBefore(link, actions.firstChild);
  }

  function normalizeQuestionArea() {
    const question = session.questions[fmtQuestionIndexFromDom() || 0];
    if (!question) return;
    const root = document.getElementById('question-root');
    if (!root) return;

    const badges = root.querySelectorAll('.question-badge');
    if (badges[0]) badges[0].textContent = `第 ${question.questionNumber || (fmtQuestionIndexFromDom() || 0) + 1} 題 / ${session.questions.length}`;
    if (badges[1]) badges[1].textContent = `${subjectLabel(question.subjectId, question.subjectTitle)} ${question.sectionQuestionIndex}/20`;

    const citations = root.querySelectorAll('.citation');
    if (citations[0]) citations[0].textContent = `${subjectLabel(question.subjectId, question.subjectTitle)} · ${formatUnitCitation(question)}`;
    for (const node of citations) {
      if (/閱讀時間/.test(node.textContent || '')) {
        node.textContent = node.textContent.replace(/閱讀時間.?/, '閱讀時間：');
      }
    }

    const buttons = root.querySelectorAll('.actions .btn');
    if (buttons[0]) buttons[0].textContent = '上一題';
    if (buttons[1]) buttons[1].textContent = '下一題';
    if (buttons[2]) buttons[2].textContent = '提交';

    const referenceList = document.getElementById('reference-list');
    if (referenceList) {
      referenceList.querySelectorAll('a').forEach(link => {
        const href = String(link.href || '').toLowerCase();
        if (href.includes('_q') || href.includes('question')) {
          link.textContent = '題目 PDF';
        } else if (href.includes('_ans') || href.includes('_mod') || href.includes('answer')) {
          link.textContent = '答案 PDF';
        }
      });
      referenceList.querySelectorAll('div').forEach(node => {
        if (String(node.textContent || '').trim().toLowerCase() === 'null') node.remove();
      });
    }

    const eventLog = document.getElementById('event-log');
    if (eventLog && /Session initialized/i.test(eventLog.textContent || '')) {
      eventLog.textContent = 'Session 已初始化。答案會在提交後顯示。';
    }

    const mobileStatus = document.getElementById('mobile-status');
    if (mobileStatus) mobileStatus.textContent = draft.submitted ? '已提交' : '答案會在提交後顯示';
    const logState = document.getElementById('log-state');
    if (logState) logState.textContent = draft.submitted ? '已提交' : '作答中';
  }

  function onSubmitAttempt() {
    syncQuestionTiming();
    persistDraft(true);
    injectReviewLink();
    normalizeQuestionArea();
  }

  document.addEventListener('change', event => {
    const target = event.target;
    if (!target || target.tagName !== 'INPUT') return;
    if (target.name !== 'answer') return;
    if (!target.checked) return;
    recordAnswer(target.value);
    normalizeQuestionArea();
  }, true);

  document.addEventListener('click', event => {
    const target = event.target && event.target.closest ? event.target.closest('#submit-btn, #mobile-submit') : null;
    if (!target) return;
    onSubmitAttempt();
  }, true);

  const questionRoot = document.getElementById('question-root');
  if (questionRoot && 'MutationObserver' in window) {
    const observer = new MutationObserver(() => {
      syncQuestionTiming();
      normalizeQuestionArea();
    });
    observer.observe(questionRoot, { childList: true, subtree: true });
  }

  window.addEventListener('beforeunload', () => {
    syncQuestionTiming();
    persistDraft(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      syncQuestionTiming();
      persistDraft(false);
    }
  });

  persistDraft(false);
  injectReviewLink();
  normalizeQuestionArea();
})();
