(() => {
  'use strict';

  const WORDS_KEY = 'lexicon.words';
  const STATS_KEY = 'lexicon.stats';
  const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

  // Leitner box intervals in days. Box index = position in this array.
  const INTERVALS = [0, 1, 2, 4, 7, 14, 30];

  // ---------- storage ----------

  function loadWords() {
    try {
      return JSON.parse(localStorage.getItem(WORDS_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveWords(words) {
    localStorage.setItem(WORDS_KEY, JSON.stringify(words));
  }

  function loadStats() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY)) || { streak: 0, xp: 0, lastPracticeDate: null };
    } catch {
      return { streak: 0, xp: 0, lastPracticeDate: null };
    }
  }

  function saveStats(stats) {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  }

  let words = loadWords();
  let stats = loadStats();

  // ---------- date helpers ----------

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDaysStr(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function yesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  function isDue(word) {
    return word.dueAt <= todayStr();
  }

  function masteryInfo(box) {
    if (box <= 0) return { label: 'new', cls: 'mastery-new' };
    if (box <= 2) return { label: 'learning', cls: 'mastery-learning' };
    if (box <= 4) return { label: 'familiar', cls: 'mastery-familiar' };
    return { label: 'mastered', cls: 'mastery-mastered' };
  }

  // ---------- dom refs ----------

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const statStreakEl = $('#stat-streak');
  const statXpEl = $('#stat-xp');

  const addWordForm = $('#add-word-form');
  const wordInput = $('#word-input');
  const addWordBtn = $('#add-word-btn');
  const addWordStatus = $('#add-word-status');

  const manualForm = $('#manual-entry-form');
  const manualPos = $('#manual-pos');
  const manualDef = $('#manual-def');
  const manualExample = $('#manual-example');
  const manualCancel = $('#manual-cancel');

  const wordListEl = $('#word-list');
  const wordListEmpty = $('#word-list-empty');
  const wordCountEl = $('#word-count');

  let pendingManualTerm = null;

  // ---------- stats bar ----------

  function renderStats() {
    statStreakEl.textContent = stats.streak;
    statXpEl.textContent = stats.xp;
  }

  // ---------- word bank rendering ----------

  let selectMode = false;
  let selectedIds = new Set();
  let editingId = null;

  function renderWordList() {
    const sorted = [...words].sort((a, b) => a.term.localeCompare(b.term));
    wordCountEl.textContent = `${words.length} word${words.length === 1 ? '' : 's'}`;
    wordListEl.innerHTML = '';

    if (words.length === 0) {
      wordListEmpty.classList.remove('is-hidden');
      return;
    }
    wordListEmpty.classList.add('is-hidden');

    for (const w of sorted) {
      if (w.id === editingId) {
        wordListEl.appendChild(buildEditCard(w));
        continue;
      }

      const m = masteryInfo(w.box);
      const card = document.createElement('div');
      card.className = 'word-card';
      if (selectMode) {
        card.classList.add('is-selectable');
        if (selectedIds.has(w.id)) card.classList.add('is-selected-card');
        card.innerHTML = `
          <div class="word-card-term">${escapeHtml(w.term)}</div>
          <div class="word-card-def">${escapeHtml(w.definition)}</div>
          <div class="word-card-footer">
            <span class="mastery-badge ${m.cls}">${m.label}</span>
          </div>
        `;
        card.addEventListener('click', () => {
          if (selectedIds.has(w.id)) selectedIds.delete(w.id);
          else selectedIds.add(w.id);
          card.classList.toggle('is-selected-card');
          updateTidyRemoveBtn();
        });
      } else {
        card.innerHTML = `
          <button class="word-star-btn ${w.starred ? 'is-starred' : ''}" data-id="${w.id}" title="${w.starred ? 'unstar' : 'star for extra practice'}">${w.starred ? '★' : '☆'}</button>
          <div class="word-card-term">${escapeHtml(w.term)}</div>
          <div class="word-card-def">${escapeHtml(w.definition)}</div>
          <div class="word-card-footer">
            <span class="mastery-badge ${m.cls}">${m.label}</span>
            <span>
              <button class="word-edit" data-id="${w.id}">edit</button>
              <button class="word-delete" data-id="${w.id}">remove</button>
            </span>
          </div>
        `;
      }
      wordListEl.appendChild(card);
    }

    if (selectMode) return;

    $$('.word-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (!confirm('Remove this word from your lexicon?')) return;
        words = words.filter((w) => w.id !== id);
        saveWords(words);
        renderWordList();
        updateModeCounts();
      });
    });

    $$('.word-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingId = btn.dataset.id;
        renderWordList();
      });
    });

    $$('.word-star-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = words.find((w) => w.id === btn.dataset.id);
        if (!w) return;
        w.starred = !w.starred;
        saveWords(words);
        renderWordList();
        updateModeCounts();
      });
    });
  }

  function buildEditCard(w) {
    const card = document.createElement('div');
    card.className = 'word-card';

    const form = document.createElement('form');
    form.className = 'word-edit-form';

    const title = document.createElement('div');
    title.className = 'word-card-term';
    title.textContent = w.term;

    const posInput = document.createElement('input');
    posInput.placeholder = 'part of speech';
    posInput.value = w.pos || '';

    const defInput = document.createElement('textarea');
    defInput.placeholder = 'definition';
    defInput.rows = 3;
    defInput.required = true;
    defInput.value = w.definition || '';

    const exInput = document.createElement('textarea');
    exInput.placeholder = 'example sentence (optional)';
    exInput.rows = 2;
    exInput.value = w.example || '';

    const altBtn = document.createElement('button');
    altBtn.type = 'button';
    altBtn.className = 'word-edit';
    altBtn.textContent = '↻ try another definition';
    let altDefs = null;
    let altIndex = -1;
    altBtn.addEventListener('click', async () => {
      try {
        if (!altDefs) {
          altBtn.textContent = 'looking...';
          const res = await fetch(DICTIONARY_API + encodeURIComponent(w.term));
          if (!res.ok) throw new Error('not found');
          const data = await res.json();
          altDefs = [];
          for (const entry of data) {
            for (const meaning of entry.meanings || []) {
              for (const d of meaning.definitions || []) {
                altDefs.push({ pos: meaning.partOfSpeech || '', definition: d.definition || '', example: d.example || '' });
              }
            }
          }
        }
        if (altDefs.length === 0) throw new Error('none');
        altIndex = (altIndex + 1) % altDefs.length;
        const alt = altDefs[altIndex];
        posInput.value = alt.pos;
        defInput.value = alt.definition;
        exInput.value = alt.example;
        altBtn.textContent = `↻ try another (${altIndex + 1}/${altDefs.length})`;
      } catch {
        altBtn.textContent = 'no other definitions found';
      }
    });

    const actions = document.createElement('div');
    actions.className = 'word-edit-actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'save';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'cancel';
    actions.append(saveBtn, cancelBtn);

    form.append(title, posInput, defInput, exInput, altBtn, actions);
    card.appendChild(form);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      w.pos = posInput.value.trim();
      w.definition = defInput.value.trim();
      w.example = exInput.value.trim();
      editingId = null;
      saveWords(words);
      renderWordList();
    });
    cancelBtn.addEventListener('click', () => {
      editingId = null;
      renderWordList();
    });

    return card;
  }

  // ---------- tidy up (bulk remove) ----------

  const tidyToggle = $('#tidy-toggle');
  const tidyBar = $('#tidy-bar');
  const tidySelectFamiliar = $('#tidy-select-familiar');
  const tidySelectMastered = $('#tidy-select-mastered');
  const tidyRemove = $('#tidy-remove');
  const tidyCancel = $('#tidy-cancel');

  function updateTidyRemoveBtn() {
    tidyRemove.textContent = `remove selected (${selectedIds.size})`;
    tidyRemove.disabled = selectedIds.size === 0;
  }

  function exitSelectMode() {
    selectMode = false;
    selectedIds = new Set();
    tidyBar.classList.add('is-hidden');
    updateTidyRemoveBtn();
    renderWordList();
  }

  tidyToggle.addEventListener('click', () => {
    if (selectMode) { exitSelectMode(); return; }
    selectMode = true;
    editingId = null;
    tidyBar.classList.remove('is-hidden');
    updateTidyRemoveBtn();
    renderWordList();
  });

  tidyCancel.addEventListener('click', exitSelectMode);

  function selectByBox(minBox) {
    for (const w of words) if (w.box >= minBox) selectedIds.add(w.id);
    updateTidyRemoveBtn();
    renderWordList();
  }
  // masteryInfo: box 3-4 = familiar, box 5+ = mastered
  tidySelectFamiliar.addEventListener('click', () => selectByBox(3));
  tidySelectMastered.addEventListener('click', () => selectByBox(5));

  tidyRemove.addEventListener('click', () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Remove ${selectedIds.size} word${selectedIds.size === 1 ? '' : 's'} from your lexicon?`)) return;
    words = words.filter((w) => !selectedIds.has(w.id));
    saveWords(words);
    updateModeCounts();
    exitSelectMode();
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  // ---------- adding words ----------

  function setStatus(msg, kind) {
    addWordStatus.textContent = msg;
    addWordStatus.classList.remove('is-error', 'is-success');
    if (kind) addWordStatus.classList.add(kind === 'error' ? 'is-error' : 'is-success');
  }

  function wordExists(term) {
    return words.some((w) => w.term.toLowerCase() === term.toLowerCase());
  }

  function createWordRecord(term, pos, definition, example, phonetic) {
    return {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
      term,
      pos: pos || '',
      definition: definition || '',
      example: example || '',
      phonetic: phonetic || '',
      box: 0,
      dueAt: todayStr(),
      addedAt: todayStr(),
      timesReviewed: 0,
      correctStreak: 0,
      starred: false,
    };
  }

  addWordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const term = wordInput.value.trim().toLowerCase();
    if (!term) return;

    if (wordExists(term)) {
      setStatus(`"${term}" is already in your bank.`, 'error');
      return;
    }

    addWordBtn.disabled = true;
    setStatus('looking up definition...');

    try {
      const res = await fetch(DICTIONARY_API + encodeURIComponent(term));
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      const entry = data[0];
      const meaning = entry.meanings && entry.meanings[0];
      const def = meaning && meaning.definitions && meaning.definitions[0];

      if (!meaning || !def) throw new Error('no definition');

      const phonetic = entry.phonetic ||
        (entry.phonetics && entry.phonetics.find((p) => p.text) || {}).text || '';

      const record = createWordRecord(term, meaning.partOfSpeech, def.definition, def.example, phonetic);
      words.push(record);
      saveWords(words);
      renderWordList();
      updateModeCounts();
      setStatus(`added "${term}" ✓`, 'success');
      addWordForm.reset();
    } catch (err) {
      setStatus('');
      pendingManualTerm = term;
      manualForm.classList.remove('is-hidden');
      manualDef.focus();
    } finally {
      addWordBtn.disabled = false;
    }
  });

  manualForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pendingManualTerm) return;
    if (wordExists(pendingManualTerm)) {
      setStatus(`"${pendingManualTerm}" is already in your bank.`, 'error');
      manualForm.classList.add('is-hidden');
      resetManualForm();
      return;
    }
    const record = createWordRecord(
      pendingManualTerm,
      manualPos.value.trim(),
      manualDef.value.trim(),
      manualExample.value.trim(),
      ''
    );
    words.push(record);
    saveWords(words);
    renderWordList();
    updateModeCounts();
    setStatus(`added "${pendingManualTerm}" ✓`, 'success');
    manualForm.classList.add('is-hidden');
    resetManualForm();
    addWordForm.reset();
  });

  manualCancel.addEventListener('click', () => {
    manualForm.classList.add('is-hidden');
    resetManualForm();
    setStatus('');
  });

  function resetManualForm() {
    pendingManualTerm = null;
    manualPos.value = '';
    manualDef.value = '';
    manualExample.value = '';
  }

  // ---------- bulk add / digest notes ----------

  const bulkToggle = $('#bulk-toggle');
  const bulkPanel = $('#bulk-panel');
  const bulkInput = $('#bulk-input');
  const bulkExtract = $('#bulk-extract');
  const bulkCancel = $('#bulk-cancel');
  const bulkReview = $('#bulk-review');
  const bulkChips = $('#bulk-chips');
  const bulkAddSelected = $('#bulk-add-selected');
  const bulkProgress = $('#bulk-progress');

  // common words filtered out when digesting raw notes
  const STOPWORDS = new Set(('a an and are as at be been but by can could did do does for from had has have he her hers him his how i if in into is it its just like me my no nor not of on or our out she so than that the their them then there these they this those to too up us was we were what when where which who why will with would you your yours it\'s don\'t i\'m was were being over under again more most other some such only own same very s t don should now about after before between both during each few here all any because until while am also get got make made really want said say see one two three new time day way thing think know go going come came back much many even well still').split(/\s+/));

  function extractCandidates(text) {
    const tokens = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
    const seen = new Set();
    const out = [];
    for (const t of tokens) {
      const w = t.replace(/^['-]+|['-]+$/g, '');
      if (w.length < 3 || STOPWORDS.has(w) || seen.has(w) || wordExists(w)) continue;
      seen.add(w);
      out.push(w);
    }
    return out;
  }

  bulkToggle.addEventListener('click', () => {
    bulkPanel.classList.toggle('is-hidden');
    if (!bulkPanel.classList.contains('is-hidden')) bulkInput.focus();
  });

  bulkCancel.addEventListener('click', () => {
    bulkPanel.classList.add('is-hidden');
    bulkInput.value = '';
    bulkReview.classList.add('is-hidden');
    bulkChips.innerHTML = '';
    bulkProgress.textContent = '';
  });

  bulkExtract.addEventListener('click', () => {
    const candidates = extractCandidates(bulkInput.value);
    bulkChips.innerHTML = '';
    bulkProgress.textContent = '';
    if (candidates.length === 0) {
      bulkReview.classList.add('is-hidden');
      bulkProgress.textContent = 'no new words found — maybe they\'re all already in your bank?';
      return;
    }
    for (const w of candidates) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'bulk-chip is-selected';
      chip.textContent = w;
      chip.addEventListener('click', () => {
        chip.classList.toggle('is-selected');
        chip.classList.toggle('is-excluded');
      });
      bulkChips.appendChild(chip);
    }
    bulkReview.classList.remove('is-hidden');
  });

  bulkAddSelected.addEventListener('click', async () => {
    const terms = $$('.bulk-chip.is-selected').map((c) => c.textContent);
    if (terms.length === 0) return;
    bulkAddSelected.disabled = true;
    const failed = [];
    let added = 0;

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      bulkProgress.textContent = `looking up ${i + 1} / ${terms.length}: "${term}"...`;
      if (wordExists(term)) continue;
      try {
        const res = await fetch(DICTIONARY_API + encodeURIComponent(term));
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        const entry = data[0];
        const meaning = entry.meanings && entry.meanings[0];
        const def = meaning && meaning.definitions && meaning.definitions[0];
        if (!meaning || !def) throw new Error('no definition');
        const phonetic = entry.phonetic ||
          (entry.phonetics && entry.phonetics.find((p) => p.text) || {}).text || '';
        words.push(createWordRecord(term, meaning.partOfSpeech, def.definition, def.example, phonetic));
        added += 1;
      } catch {
        failed.push(term);
      }
    }

    saveWords(words);
    renderWordList();
    updateModeCounts();
    bulkAddSelected.disabled = false;
    bulkReview.classList.add('is-hidden');
    bulkChips.innerHTML = '';
    bulkInput.value = '';
    bulkProgress.textContent = `added ${added} word${added === 1 ? '' : 's'}` +
      (failed.length ? ` — couldn't find: ${failed.join(', ')} (add those one at a time to enter a definition yourself)` : ' ✓');
  });

  // ---------- tabs ----------

  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.remove('is-active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      $(`#tab-${btn.dataset.tab}`).classList.add('is-active');

      $('.intro').classList.toggle('is-hidden', btn.dataset.tab !== 'words');

      if (btn.dataset.tab === 'flashcards') startFlashcardSession(fcMode);
      if (btn.dataset.tab === 'useit') startUseitSession(uiMode);
    });
  });

  // ---------- practice pools ----------

  function poolFor(mode) {
    if (mode === 'starred') return words.filter((w) => w.starred);
    if (mode === 'all') return [...words];
    return words.filter(isDue);
  }

  function updateModeCounts() {
    const dueCount = words.filter(isDue).length;
    const starredCount = words.filter((w) => w.starred).length;
    const allCount = words.length;

    $('#fc-count-due').textContent = dueCount;
    $('#fc-count-starred').textContent = starredCount;
    $('#fc-count-all').textContent = allCount;
    $('#ui-count-due').textContent = dueCount;
    $('#ui-count-starred').textContent = starredCount;
    $('#ui-count-all').textContent = allCount;
  }

  // ---------- grading (shared) ----------

  function gradeWord(word, correct, xpOnCorrect) {
    word.timesReviewed += 1;
    if (correct) {
      word.box = Math.min(word.box + 1, INTERVALS.length - 1);
      word.correctStreak += 1;
      stats.xp += xpOnCorrect;
    } else {
      word.box = 0;
      word.correctStreak = 0;
    }
    word.dueAt = addDaysStr(INTERVALS[word.box]);

    const today = todayStr();
    if (stats.lastPracticeDate !== today) {
      stats.streak = stats.lastPracticeDate === yesterdayStr() ? stats.streak + 1 : 1;
      stats.lastPracticeDate = today;
    }

    saveWords(words);
    saveStats(stats);
    renderStats();
    renderWordList();
    updateModeCounts();
  }

  // ---------- flashcards ----------

  const flashcardEmpty = $('#flashcard-empty');
  const flashcardSession = $('#flashcard-session');
  const flashcardDueNote = $('#flashcard-due-note');
  const flashcardProgressText = $('#flashcard-progress-text');
  const flipCard = $('#flip-card');
  const flashcardWord = $('#flashcard-word');
  const flashcardPos = $('#flashcard-pos');
  const flashcardDef = $('#flashcard-def');
  const flashcardExample = $('#flashcard-example');
  const flashcardGradeActions = $('#flashcard-grade-actions');
  const flashcardMiss = $('#flashcard-miss');
  const flashcardHit = $('#flashcard-hit');
  const flashcardModeSelect = $('#flashcard-mode-select');

  let fcQueue = [];
  let fcIndex = 0;
  let fcMode = 'due';

  const MODE_NOTES = {
    due: (n) => `${n} word${n === 1 ? '' : 's'} due for review.`,
    starred: (n) => `${n} starred word${n === 1 ? '' : 's'} — practice anytime.`,
    all: (n) => `practicing all ${n} word${n === 1 ? '' : 's'} in your bank.`,
  };

  function startFlashcardSession(mode) {
    fcMode = mode || fcMode;
    fcQueue = poolFor(fcMode).sort(() => Math.random() - 0.5);
    fcIndex = 0;
    updateModeCounts();

    flashcardDueNote.textContent = words.length === 0
      ? 'add some words first, then come back here to practice.'
      : MODE_NOTES[fcMode](fcQueue.length);

    if (fcQueue.length === 0) {
      flashcardEmpty.classList.remove('is-hidden');
      flashcardEmpty.textContent = fcMode === 'due'
        ? 'nothing due right now — add more words, or try "starred" / "all words" above to practice anyway.'
        : 'no words in this pool yet.';
      flashcardSession.classList.add('is-hidden');
      return;
    }
    flashcardEmpty.classList.add('is-hidden');
    flashcardSession.classList.remove('is-hidden');
    renderFlashcard();
  }

  flashcardModeSelect.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    $$('#flashcard-mode-select .mode-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    startFlashcardSession(btn.dataset.mode);
  });

  function renderFlashcard() {
    if (fcIndex >= fcQueue.length) {
      flashcardSession.classList.add('is-hidden');
      flashcardEmpty.classList.remove('is-hidden');
      flashcardEmpty.textContent = 'session complete — nice work! keep going anytime with "starred" or "all words" above.';
      return;
    }
    const w = fcQueue[fcIndex];
    flipCard.classList.remove('is-flipped');
    flashcardGradeActions.classList.add('is-hidden');
    flashcardWord.textContent = w.term;
    flashcardPos.textContent = w.pos || 'definition';
    flashcardDef.textContent = w.definition;
    flashcardExample.textContent = w.example ? `"${w.example}"` : '';
    flashcardProgressText.textContent = `${fcIndex + 1} / ${fcQueue.length}`;
  }

  flipCard.addEventListener('click', () => {
    flipCard.classList.toggle('is-flipped');
    if (flipCard.classList.contains('is-flipped')) {
      flashcardGradeActions.classList.remove('is-hidden');
    }
  });

  flashcardHit.addEventListener('click', (e) => {
    e.stopPropagation();
    gradeWord(fcQueue[fcIndex], true, 10);
    fcIndex += 1;
    renderFlashcard();
  });

  flashcardMiss.addEventListener('click', (e) => {
    e.stopPropagation();
    gradeWord(fcQueue[fcIndex], false, 0);
    fcIndex += 1;
    renderFlashcard();
  });

  // ---------- use it ----------

  const useitEmpty = $('#useit-empty');
  const useitSession = $('#useit-session');
  const useitProgressText = $('#useit-progress-text');
  const useitWord = $('#useit-word');
  const useitInput = $('#useit-input');
  const useitReveal = $('#useit-reveal');
  const useitRevealPanel = $('#useit-reveal-panel');
  const useitPos = $('#useit-pos');
  const useitDef = $('#useit-def');
  const useitExample = $('#useit-example');
  const useitMiss = $('#useit-miss');
  const useitHit = $('#useit-hit');
  const useitModeSelect = $('#useit-mode-select');

  let uiQueue = [];
  let uiIndex = 0;
  let uiMode = 'due';

  function startUseitSession(mode) {
    uiMode = mode || uiMode;
    uiQueue = poolFor(uiMode).sort(() => Math.random() - 0.5);
    uiIndex = 0;
    updateModeCounts();

    if (uiQueue.length === 0) {
      useitEmpty.classList.remove('is-hidden');
      useitEmpty.textContent = words.length === 0
        ? 'add some words first, then come back here to practice.'
        : uiMode === 'due'
          ? 'nothing due right now — add more words, or try "starred" / "all words" above to practice anyway.'
          : 'no words in this pool yet.';
      useitSession.classList.add('is-hidden');
      return;
    }
    useitEmpty.classList.add('is-hidden');
    useitSession.classList.remove('is-hidden');
    renderUseit();
  }

  useitModeSelect.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    $$('#useit-mode-select .mode-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    startUseitSession(btn.dataset.mode);
  });

  function renderUseit() {
    if (uiIndex >= uiQueue.length) {
      useitSession.classList.add('is-hidden');
      useitEmpty.classList.remove('is-hidden');
      useitEmpty.textContent = 'session complete — nice work! keep going anytime with "starred" or "all words" above.';
      return;
    }
    const w = uiQueue[uiIndex];
    useitWord.textContent = w.term;
    useitInput.value = '';
    useitRevealPanel.classList.add('is-hidden');
    useitProgressText.textContent = `${uiIndex + 1} / ${uiQueue.length}`;
  }

  useitReveal.addEventListener('click', () => {
    const w = uiQueue[uiIndex];
    useitPos.textContent = w.pos || 'definition';
    useitDef.textContent = w.definition;
    useitExample.textContent = w.example ? `"${w.example}"` : '';
    useitRevealPanel.classList.remove('is-hidden');
  });

  useitHit.addEventListener('click', () => {
    gradeWord(uiQueue[uiIndex], true, 15);
    uiIndex += 1;
    renderUseit();
  });

  useitMiss.addEventListener('click', () => {
    gradeWord(uiQueue[uiIndex], false, 0);
    uiIndex += 1;
    renderUseit();
  });

  // ---------- init ----------

  renderStats();
  renderWordList();
  updateModeCounts();
})();
