
// ── Global quest timer — always runs for toast notifications ──────────────
let _globalQuestTimerStarted = false;
function startGlobalQuestTimer() {
  if (_globalQuestTimerStarted) return;
  _globalQuestTimerStarted = true;
  setInterval(async () => {
    if (!_questData || !_questData.active) return;
    const justDone = _questData.active.filter(q =>
      q.status === 'active' && new Date(q.completes_at) <= Date.now()
    );
    if (justDone.length) {
      justDone.forEach(q => {
        const def = q.quest_def || {};
        const title = def.title || q.quest_id;
        const members = (q.party_members || []).map(m => m.name).join(', ') || q.citizen_name || 'Your party';
        if (typeof showToastNotification === 'function') {
          showToastNotification(members + ' returned from "' + title + '"!', 'quest_return');
        }
      });
      // Refresh quest data
      try {
        const r = await apiFetch('/api/quests');
        const data = await r.json();
        _questData = data;
        // If noticeboard modal is open, refresh it
        const nb = document.getElementById('noticeboard-modal');
        if (nb && nb.style.display === 'flex') _renderNoticeboardModal();
        // If quests modal is open, refresh it
        if (document.getElementById('quests-modal')?.style.display === 'flex') {
          if (typeof _renderQuestsModal === 'function') _renderQuestsModal();
        }
      } catch(e) {}
    }
  }, 1000);
}


async function collectAllQuests() {
  const collectible = (_questData.active || []).filter(q => q.status === 'completed' || q.status === 'failed');
  for (const q of collectible) {
    await collectQuest(q.id);
  }
}


// ══════════════════════════════════════════════
//  SOLO QUEST CAROUSEL
// ══════════════════════════════════════════════
let _soloQuestIdx  = 0;
let _soloQuestList = [];
let _soloInProgress = [];

function renderSoloQuestCarousel(quests, inProgress) {
  _soloQuestList  = quests.filter(q => !inProgress.some(a => a.quest_id === q.id));
  _soloInProgress = inProgress;
  _soloQuestIdx   = 0;
  _renderSoloCarousel();
}

function _renderSoloCarousel() {
  const container = document.getElementById('qb-solo-carousel');
  if (!container) return;
  if (!_soloQuestList.length) {
    container.innerHTML = '<div class="qb-party-note">No solo quests available.</div>';
    return;
  }
  const total = _soloQuestList.length;
  const cardsHtml = _soloQuestList.map((q, i) => {
    const diff = q.base_success >= 0.65 ? { label: 'Easy',     color: '#8ecf7e' }
               : q.base_success >= 0.5  ? { label: 'Moderate', color: '#e8c76a' }
               : q.base_success >= 0.38 ? { label: 'Hard',     color: '#e89a4a' }
               :                          { label: 'Deadly',   color: '#e87a6a' };
    const skillLabel = QUEST_SKILL_LABELS[q.skill_key] || q.skill_key || '';
    return '<div class="qp-card" id="sqc-' + i + '">'
      + '<div class="qp-card-art">' + (q.icon || '📜') + '</div>'
      + '<div class="qp-card-body">'
      + '<div class="qp-card-diff" style="color:' + diff.color + '">' + diff.label
        + (skillLabel ? ' &nbsp;·&nbsp; <span style="color:rgba(192,221,151,.7)">' + skillLabel + '</span>' : '')
        + '</div>'
      + '<div class="qp-card-title">' + q.title + '</div>'
      + '<div class="qp-card-desc">' + q.description + '</div>'
      + '<div class="qp-card-meta">⏱ ' + formatDuration(q.duration_s) + ' &nbsp;·&nbsp; 🪙 ' + (q.reward_gold || 0) + ' gold</div>'
      + '<div class="qp-card-hint">Tap to assign</div>'
      + '</div></div>';
  }).join('');

  container.innerHTML = '<div class="qp-carousel-wrap"><div class="qp-track" id="sq-track">' + cardsHtml + '</div></div>'
    + '<div class="qp-nav-row">'
    + '<button class="qp-nav-btn" onclick="_soloCarouselGo(_soloQuestIdx - 1)">←</button>'
    + '<div class="carousel-dots" id="sq-dots"></div>'
    + '<button class="qp-nav-btn" onclick="_soloCarouselGo(_soloQuestIdx + 1)">→</button>'
    + '</div>';

  _applySoloCarouselPositions();
}

function _applySoloCarouselPositions() {
  const total = _soloQuestList.length;
  for (let i = 0; i < total; i++) {
    const card = document.getElementById('sqc-' + i);
    if (!card) continue;
    card.className = 'qp-card';
    card.onclick = null;
    let offset = i - _soloQuestIdx;
    if (offset > total / 2) offset -= total;
    if (offset < -total / 2) offset += total;
    if (offset === 0) {
      card.classList.add('qpc-active');
      card.onclick = () => openSoloQuestPanel(_soloQuestList[i]);
    } else if (offset === -1) {
      card.classList.add('qpc-l1');
      card.onclick = () => _soloCarouselGo(_soloQuestIdx - 1);
    } else if (offset === 1) {
      card.classList.add('qpc-r1');
      card.onclick = () => _soloCarouselGo(_soloQuestIdx + 1);
    } else {
      card.classList.add('qpc-hidden');
    }
  }
  const dots = document.getElementById('sq-dots');
  if (dots) {
    dots.innerHTML = _soloQuestList.map((_, i) =>
      '<div class="carousel-dot' + (i === _soloQuestIdx ? ' active' : '') + '" onclick="_soloCarouselGo(' + i + ')"></div>'
    ).join('');
  }
}

function _soloCarouselGo(idx) {
  const total = _soloQuestList.length;
  _soloQuestIdx = ((idx % total) + total) % total;
  _applySoloCarouselPositions();
}

// Opens a compact assign panel at the bottom of the carousel area

async function _collectFromModal(runId) {
  const btn = document.querySelector('[data-id="' + runId + '"]');
  if (btn) { btn.textContent = '…'; btn.disabled = true; }
  try {
    const res = await apiFetch('/api/quests/collect/' + runId, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json();
      console.error('Collect failed:', d.error);
    }
  } catch(e) { console.error(e); }
  // Refresh quest data
  try {
    const r = await apiFetch('/api/quests');
    _questData = await r.json();
  } catch(e) {}
  await _renderQuestsModal();
}

function openSoloQuestPanel(q) {
  // Close the noticeboard modal so assembly modal is on top
  const nbModal = document.getElementById('noticeboard-modal');
  if (nbModal) nbModal.style.display = 'none';

  const modal = document.getElementById('party-assembly-modal');
  const inner = document.getElementById('party-assembly-inner');
  if (!modal || !inner) return;

  modal.dataset.soloQuestId   = q.id;
  modal.dataset.soloQuestBase = q.base_success;

  const busyIds = new Set((_soloInProgress || []).map(r => r.citizen_id).filter(Boolean));
  const pool = (citizensData || [])
    .filter(c => c.life_stage !== 'child' && !busyIds.has(c.id) && !c.expedition && !c.active_quest)
    .sort((a, b) => (b.skills?.[q.skill_key] ?? 0) - (a.skills?.[q.skill_key] ?? 0));

  const opts = pool.map(c => {
    const sk = c.skills?.[q.skill_key] ?? 0;
    return '<option value="' + c.id + '" data-skill="' + sk + '">' + c.name
      + ' (' + (QUEST_SKILL_LABELS[q.skill_key] || q.skill_key || 'General') + ' ' + sk + ')</option>';
  }).join('');

  const diff = q.base_success >= 0.65 ? { label: 'Easy',     color: '#8ecf7e' }
             : q.base_success >= 0.5  ? { label: 'Moderate', color: '#e8c76a' }
             : q.base_success >= 0.38 ? { label: 'Hard',     color: '#e89a4a' }
             :                          { label: 'Deadly',   color: '#e87a6a' };

  inner.innerHTML =
    '<div class="pa-header">'
    + '<button class="pa-back" onclick="_paBack()">← Back</button>'
    + '<div class="pa-title">' + (q.icon || '📜') + ' ' + q.title + '</div>'
    + '</div>'
    + '<div class="pa-subtitle" style="color:' + diff.color + '">' + diff.label
      + (q.skill_key ? ' · ' + (QUEST_SKILL_LABELS[q.skill_key] || q.skill_key) : '') + '</div>'
    + '<div class="pa-desc">' + (q.description || '') + '</div>'
    + '<div class="pa-slots">'
    + '<div class="pa-slot">'
    + '<div class="pa-slot-header"><span class="pa-slot-num">1</span>'
    + '<div class="pa-slot-info"><div class="pa-slot-role">Citizen</div>'
    + '<div class="pa-slot-skill">' + (QUEST_SKILL_LABELS[q.skill_key] || q.skill_key || 'Any') + ' will be used</div>'
    + '</div></div>'
    + '<select class="pa-select" id="sq-select" onchange="_updateSoloChance()">'
    + '<option value="">— Choose a citizen —</option>'
    + opts
    + '</select>'
    + '</div></div>'
    + '<div class="pa-chance-section">'
    + '<div class="pa-chance-label">Chance of success</div>'
    + '<div class="pa-chance-bar-wrap"><div class="pa-chance-bar" id="sq-chance-bar" style="width:' + Math.round(q.base_success * 100) + '%;background:#e8c76a"></div></div>'
    + '<div class="pa-chance-pct" id="sq-chance-pct">' + Math.round(q.base_success * 100) + '%</div>'
    + '<div class="pa-chance-desc" id="sq-chance-desc">Choose a citizen to see their odds</div>'
    + '</div>'
    + _renderCombatBlock(q, 'sq')
    + '<button class="pa-send-btn" onclick="_acceptSoloFromPanel()">🗡 Send</button>'
    + '<div class="qb-flash" id="sq-flash"></div>';

  modal.style.cssText = 'display:flex;position:fixed;inset:0;z-index:9000;background:rgba(8,5,2,0.92);backdrop-filter:blur(8px);overflow-y:auto;align-items:flex-start;justify-content:center;flex-direction:column;padding:20px 0 40px';
}

function _acceptSoloFromPanel() {
  const modal = document.getElementById('party-assembly-modal');
  const sel   = document.getElementById('sq-select');
  const questId   = modal?.dataset?.soloQuestId;
  const citizenId = parseInt(sel?.value || '0');
  const flashEl   = document.getElementById('sq-flash');
  const flash = msg => { if(flashEl){ flashEl.textContent=msg; setTimeout(()=>{flashEl.textContent='';},2500); } };
  if (!questId)   { flash('⚠️ No quest selected.'); return; }
  if (!citizenId) { flash('⚠️ Choose a citizen first.'); return; }
  _acceptSoloDirectly(questId, citizenId);
}

async function _acceptSoloDirectly(questId, citizenId) {
  const modal = document.getElementById('party-assembly-modal');
  const fromNpc = modal?.dataset?.source === 'npc';
  const npcId = modal?.dataset?.npcId;
  const autoResolve = _paAutoResolveValue('sq');

  try {
    const res = await apiFetch('/api/quests/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quest_id: questId, citizen_id: citizenId, auto_resolve_combat: autoResolve }),
    });
    const data = await res.json();
    if (!res.ok) { _paFlash('⚠️ ' + (data.error || 'Failed')); return; }
    closePartyAssembly();
    if (fromNpc) {
      showToastNotification((data.citizen_name || 'Citizen') + ' has set out on a quest!', 'quest_return');
      // Refresh the diplomacy panel so the quest shows as in-progress.
      if (npcId && typeof _loadAndRenderNpcQuests === 'function') {
        _loadAndRenderNpcQuests(npcId);
      }
      // Also refresh citizens so they show as busy in other UIs.
      if (typeof loadCitizens === 'function') {
        await loadCitizens();
        if (typeof renderCitizensList === 'function') renderCitizensList();
      }
      return;
    }
    _soloQuestList = _soloQuestList.filter(q => q.id !== questId);
    _soloQuestIdx = Math.min(_soloQuestIdx, Math.max(0, _soloQuestList.length - 1));
    showToastNotification((data.citizen_name || 'Citizen') + ' has set out on a quest!', 'quest_return');
    await openNoticeboardModal(_questMode);
  } catch(e) {
    _paFlash('⚠️ Something went wrong.');
  }
}

function _updateSoloChance() {
  const modal = document.getElementById('party-assembly-modal');
  const sel   = document.getElementById('sq-select');
  if (!sel || !sel.value || !modal) return;
  const baseSuccess = parseFloat(modal.dataset.soloQuestBase || 0.5);
  const sk = parseInt(sel.selectedOptions[0]?.dataset?.skill || 0);
  const chance = Math.min(95, Math.round((baseSuccess + (sk - 1) * 0.04) * 100));
  const bar  = document.getElementById('sq-chance-bar');
  const pct  = document.getElementById('sq-chance-pct');
  const desc = document.getElementById('sq-chance-desc');
  const color = chance >= 80 ? '#2d9e4a' : chance >= 60 ? '#5ec45e' : chance >= 40 ? '#e8c76a' : '#e87a6a';
  if (bar)  { bar.style.width = chance + '%'; bar.style.background = color; }
  if (pct)  { pct.textContent = chance + '%'; }
  if (desc) {
    desc.textContent = chance >= 80 ? 'Extremely likely — a fine choice.'
      : chance >= 60 ? 'Good odds — should manage.'
      : chance >= 40 ? 'Uncertain — fortune will decide.'
      : 'Perilous — pray for luck.';
    desc.style.color = color;
  }
}

// ══════════════════════════════════════════════
//  QUEST SYSTEM — Kindlewood
// ══════════════════════════════════════════════

const QUEST_CATEGORY_ICONS = {
  gathering: '🌿',
  scouting:  '🗺',
  combat:    '⚔️',
  crafting:  '🔨',
};

const QUEST_SKILL_LABELS = {
  farming:    'Farming',
  fishing:    'Fishing',
  scouting:   'Scouting',
  combat:     'Combat',
  crafting:   'Crafting',
  woodcutting:'Woodcutting',
  mining:     'Mining',
};

let _questData = { available: [], available_party: [], active: [] };
let _questTimerInterval = null;
let _questMode = null; // null = mode picker, 'solo' = solo list, 'party' = party list

// ── Open notice board ─────────────────────────

async function openNoticeboardModal(mode) {
  _questMode = mode || null;
  const modal = document.getElementById('noticeboard-modal');
  if (modal) modal.style.display = 'flex';
  _renderNoticeboardModal('<div class="quest-loading">📜 Checking the notice board…</div>');

  try {
    // Refresh citizen data so quest status is current
    if (typeof loadCitizens === 'function') await loadCitizens();
    const res = await apiFetch('/api/quests');
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    _questData = data;
    renderQuestBoard();
    startQuestTimers();
  } catch (e) {
    renderQuestBoard('<div class="quest-loading">⚠️ Couldn\'t reach the notice board right now.</div>');
  }
}

function closeNoticeboard() { closeNoticeboardModal(); }
function closeNoticeboardModal() {
  const modal = document.getElementById('noticeboard-modal');
  if (modal) modal.style.display = 'none';
  _questMode = null;
}

// Alias so all existing onclick="openNoticeboard(...)" still works
function openNoticeboard(mode) { openNoticeboardModal(mode); }
function closeNoticeboard() { closeNoticeboardModal(); }

// ── Render ─────────────────────────────────────

function _renderNoticeboardModal(loadingHtml) { renderQuestBoard(loadingHtml); }
function renderQuestBoard(loadingHtml) {
  const board = document.getElementById('nb-modal-body');
  if (!board) return;

  if (loadingHtml) {
    board.innerHTML = '<div class="qb-header"><div class="qb-title">📜 Notice Board</div>'
      + '<button class="qb-back-btn" onclick="closeNoticeboard()">← Back</button></div>'
      + loadingHtml;
    return;
  }

  const { available, available_party, active } = _questData;
  const inProgress  = active.filter(q => q.status === 'active');
  const collectible = active.filter(q => q.status === 'completed' || q.status === 'failed');
  const history     = active.filter(q => q.status === 'collected').slice(0, 3);

  // ── Mode picker (entry screen) ─────────────
  if (!_questMode) {
    const soloBusy  = inProgress.filter(q => q.quest_type !== 'party').length;
    const partyBusy = inProgress.filter(q => q.quest_type === 'party').length;
    const soloReady  = collectible.filter(q => q.quest_type !== 'party').length;
    const partyReady = collectible.filter(q => q.quest_type === 'party').length;

    board.innerHTML = (collectible.length
        ? '<div class="qb-ready-banner">⚡ ' + collectible.length + ' quest' + (collectible.length > 1 ? 's' : '') + ' ready to collect</div>'
        : '')
      + '<div class="qb-mode-picker-row">'
      + '<button class="qb-mode-btn" data-mode="solo" onclick="openNoticeboard(this.dataset.mode)">'
      + '<div class="qb-mode-emoji">🗡️</div>'
      + '<div class="qb-mode-title">Solo Quests</div>'
      + '<div class="qb-mode-desc">Quick ventures for a single soul.</div>'
      + '<div class="qb-mode-tags"><span class="qb-mode-tag">Quick</span><span class="qb-mode-tag">1 Citizen</span>'
      + (soloBusy ? '<span class="qb-mode-tag qb-mode-tag-active">' + soloBusy + ' active</span>' : '')
      + (soloReady ? '<span class="qb-mode-tag qb-mode-tag-ready">⚡ ' + soloReady + ' ready</span>' : '')
      + '</div></button>'
      + '<button class="qb-mode-btn qb-mode-btn-party" data-mode="party" onclick="openNoticeboard(this.dataset.mode)">'
      + '<div class="qb-mode-emoji">⚔️</div>'
      + '<div class="qb-mode-title">Party Expeditions</div>'
      + '<div class="qb-mode-desc">Greater risks, richer rewards.</div>'
      + '<div class="qb-mode-tags"><span class="qb-mode-tag">Longer</span><span class="qb-mode-tag">Multiple Citizens</span><span class="qb-mode-tag qb-mode-tag-reward">Better Rewards</span>'
      + (partyBusy ? '<span class="qb-mode-tag qb-mode-tag-active">' + partyBusy + ' active</span>' : '')
      + (partyReady ? '<span class="qb-mode-tag qb-mode-tag-ready">⚡ ' + partyReady + ' ready</span>' : '')
      + '</div></button>'
      + '</div>';
    return;
  }

  // ── Solo or party quest list ───────────────
  const isParty = _questMode === 'party';
  const modeLabel = isParty ? '⚔️ Party Expeditions' : '🗡️ Solo Quests';
  const modeActive = inProgress.filter(q => isParty ? q.quest_type === 'party' : q.quest_type !== 'party');
  const modeCollect = collectible.filter(q => isParty ? q.quest_type === 'party' : q.quest_type !== 'party');
  const modeHistory = history.filter(q => isParty ? q.quest_type === 'party' : q.quest_type !== 'party');
  const modeAvail = isParty ? (available_party || []) : (available || []);

  let html = '<div class="qb-header">'
    + '<div class="qb-title">' + modeLabel + '</div>'
    + '<button class="qb-back-btn" onclick="_questMode=null;renderQuestBoard()">← Back</button>'
    + '</div>';

  if (modeCollect.length) {
    html += '<div class="qb-section-label">⚡ Ready to Collect'
      + (modeCollect.length > 1 ? '<button class="qb-collect-all-btn" onclick="collectAllQuests()">Collect All</button>' : '')
      + '</div><div class="qb-list">'
      + modeCollect.map(q => renderCollectibleQuest(q)).join('') + '</div>';
  }
  if (modeActive.length) {
    html += '<div class="qb-section-label">⏳ In Progress</div><div class="qb-list">'
      + modeActive.map(q => renderActiveQuest(q)).join('') + '</div>';
  }

  html += '<div class="qb-section-label">📋 Available</div>';
  if (isParty) {
    html += '<div id="qb-party-carousel" class="qb-party-carousel"></div>';
  } else {
    html += '<div id="qb-solo-carousel" class="qb-party-carousel"></div>';
  }

  if (modeHistory.length) {
    html += '<div class="qb-section-label">📖 Recent History</div><div class="qb-list qb-history">'
      + modeHistory.map(q => renderHistoryQuest(q)).join('') + '</div>';
  }

  html += '</div>'; // close qb-scroll-body

  board.innerHTML = html;

  // Init carousels after DOM insert
  if (isParty && modeAvail.length) {
    renderPartyQuestCarousel(modeAvail, inProgress);
  } else if (!isParty) {
    renderSoloQuestCarousel(modeAvail, inProgress);
  }
}

function renderAvailableQuest(q, inProgress) {
  const busy = inProgress.some(a => a.quest_id === q.id);
  const catIcon = QUEST_CATEGORY_ICONS[q.category] || '📜';
  const skillLabel = QUEST_SKILL_LABELS[q.skill_key] || q.skill_key;

  return `
    <div class="qb-card ${busy ? 'qb-card-busy' : ''}">
      <div class="qb-card-top">
        <div class="qb-card-icon">${q.icon || catIcon}</div>
        <div class="qb-card-info">
          <div class="qb-card-title">${q.title}</div>
          <div class="qb-card-desc">${q.description}</div>
          <div class="qb-card-meta">
            <span class="qb-tag qb-tag-skill">🎯 ${skillLabel}</span>
            <span class="qb-tag qb-tag-time">⏱ ${formatDuration(q.duration_s)}</span>
            <span class="qb-tag qb-tag-gold">🪙 ${q.reward_gold} gold</span>
          </div>
        </div>
      </div>
      ${busy ? `
        <div class="qb-busy-note">Already underway</div>
      ` : `
        <div class="qb-citizen-row">
          <select class="qb-citizen-select" id="qb-select-${q.id}" onchange="updateQuestSuccessPreview('${q.id}', '${q.skill_key}', ${q.base_success})">
            <option value="">— Assign a citizen —</option>
            ${_buildCitizenOptions(q.skill_key, inProgress)}
          </select>
          <span class="qb-success-preview" id="qb-preview-${q.id}"></span>
          <button class="qb-accept-btn" onclick="acceptQuest('${q.id}')">Accept</button>
        </div>
      `}
    </div>`;
}

function renderActiveQuest(q) {
  const quest = _getQuestDef(q.quest_id);
  const remaining = Math.max(0, new Date(q.completes_at) - Date.now());
  const remainSec = Math.ceil(remaining / 1000);

  return `
    <div class="qb-card qb-card-active">
      <div class="qb-card-top">
        <div class="qb-card-icon">${quest?.icon || '📜'}</div>
        <div class="qb-card-info">
          <div class="qb-card-title">${quest?.title || q.quest_id}</div>
          <div class="qb-card-citizen">${
            q.quest_def?.quest_type === 'party' || (q.party_members && q.party_members.length > 1)
              ? '👥 ' + (q.party_members || []).map(m => m.name).join(', ')
              : '👤 ' + (q.citizen_name || 'Unknown')
          }</div>
          <div class="qb-card-meta">
            <span class="qb-tag qb-tag-time">⏱ <span class="quest-timer" data-id="${q.id}" data-eta="${q.completes_at}">${formatDuration(remainSec)}</span></span>
          </div>
        </div>
      </div>
      <div class="qb-progress-bar-wrap">
        <div class="qb-progress-bar" id="qb-progress-${q.id}" style="width:${_progressPct(q)}%"></div>
      </div>
    </div>`;
}

function renderCollectibleQuest(q) {
  const quest = _getQuestDef(q.quest_id);
  const success = q.status === 'completed';
  const flavour = success ? quest?.flavour_success : quest?.flavour_fail;
  const goldStr = success ? `<span class="qb-gold-reward">+${quest?.reward_gold ?? 0} 🪙</span>` : '';

  return `
    <div class="qb-card qb-card-collectible ${success ? 'qb-card-success' : 'qb-card-fail'}">
      <div class="qb-card-top">
        <div class="qb-card-icon">${success ? '✅' : '❌'}</div>
        <div class="qb-card-info">
          <div class="qb-card-title">${quest?.title || q.quest_id}</div>
          <div class="qb-card-citizen">${
            (q.party_members && q.party_members.length > 1)
              ? '👥 ' + q.party_members.map(m => m.name).join(', ')
              : q.citizen_name || 'Unknown'
          } ${flavour ? '<em>' + flavour + '</em>' : ''}</div>
          ${goldStr}
        </div>
      </div>
      <button class="qb-collect-btn ${success ? '' : 'qb-collect-btn-fail'}" onclick="collectQuest(${q.id})">
        ${success ? '🪙 Collect Reward' : '🤝 Dismiss'}
      </button>
    </div>`;
}

function renderHistoryQuest(q) {
  const quest = _getQuestDef(q.quest_id);
  return `
    <div class="qb-history-row">
      <span class="qb-hist-icon">${q.outcome_icon || (q.status === 'collected' ? '✓' : '✗')}</span>
      <span class="qb-hist-title">${quest?.title || q.quest_id}</span>
      <span class="qb-hist-citizen">${q.citizen_name || ''}</span>
    </div>`;
}

// ── Citizen dropdown helpers ──────────────────

function _buildCitizenOptions(skillKey, inProgress) {
  const busySoloIds  = new Set(inProgress.map(q => q.citizen_id).filter(Boolean));
  const citizens = (typeof citizensData !== 'undefined' ? citizensData : []);
  if (!citizens.length) return '<option disabled>No citizens available</option>';

  // Exclude children entirely — never shown
  const adults = citizens.filter(c => c.life_stage !== 'child');
  if (!adults.length) return '<option disabled>No citizens available</option>';

  return adults
    .sort((a, b) => (b.skills?.[skillKey] ?? 0) - (a.skills?.[skillKey] ?? 0))
    .map(c => {
      const skillVal = c.skills?.[skillKey] ?? 0;
      const isBusy = busySoloIds.has(c.id) || !!c.expedition || !!c.active_quest;
      const busyLabel = c.active_quest ? ' [On Quest]' : c.expedition ? ' [Scouting]' : isBusy ? ' [Busy]' : '';
      return '<option value="' + c.id + '" data-skill="' + skillVal + '"' + (isBusy ? ' disabled' : '') + '>'
        + c.name + ' (' + (QUEST_SKILL_LABELS[skillKey] || skillKey) + ' ' + skillVal + ')' + busyLabel
        + '</option>';
    }).join('');
}

function updateQuestSuccessPreview(questId, skillKey, baseSuccess) {
  const sel = document.getElementById(`qb-select-${questId}`);
  const preview = document.getElementById(`qb-preview-${questId}`);
  if (!sel || !preview) return;

  const citizenId = parseInt(sel.value);
  if (!citizenId) { preview.textContent = ''; return; }

  const citizen = (citizensData || []).find(c => c.id === citizenId);
  if (!citizen) { preview.textContent = ''; return; }

  const skillVal = citizen.skills?.[skillKey] ?? 1;
  const chance = Math.min(95, Math.round((baseSuccess + (skillVal - 1) * 0.04) * 100));
  const color = chance >= 70 ? '#7ecf6e' : chance >= 45 ? '#e8c76a' : '#e87a6a';
  preview.innerHTML = `<span style="color:${color}">${chance}% success</span>`;
}

// ── Accept / Collect ──────────────────────────


// ── Party quest carousel — mirrors species picker style ───────────────
let _partyQuestIdx   = 0;
let _partyQuestList  = [];
let _partyInProgress = [];

function renderPartyQuestCarousel(quests, inProgress) {
  // Filter out quests that are already active/in-progress
  const activeIds = new Set(inProgress.map(q => q.quest_id));
  _partyQuestList  = (quests || []).filter(q => !activeIds.has(q.id));
  _partyInProgress = inProgress;
  _partyQuestIdx   = 0;
  _renderPartyCarousel();
}

function _renderPartyCarousel() {
  const container = document.getElementById('qb-party-carousel');
  if (!container) return;
  const total = _partyQuestList.length;
  if (!total) {
    container.innerHTML = '<div class="qb-party-note">No party expeditions available today.</div>';
    return;
  }

  // Build cards — same structure as sp-card
  const cardsHtml = _partyQuestList.map((q, i) => {
    const busy    = _partyInProgress.some(a => a.quest_id === q.id);
    const diff    = q.base_success >= 0.55 ? { label: 'Moderate', color: '#e8c76a' }
                  : q.base_success >= 0.45 ? { label: 'Hard',     color: '#e89a4a' }
                  :                          { label: 'Deadly',   color: '#e87a6a' };
    const skills  = (q.requires||[]).map(r => QUEST_SKILL_LABELS[r.skill_key]||r.skill_key).join(' · ');
    return '<div class="qp-card" id="qpc-' + i + '">'
      + '<div class="qp-card-art">' + (q.icon||'⚔️') + '</div>'
      + '<div class="qp-card-body">'
      + '<div class="qp-card-diff" style="color:' + diff.color + '">' + diff.label + ' &nbsp;·&nbsp; 👥 ' + (q.requires||[]).length + '</div>'
      + '<div class="qp-card-title">' + q.title + '</div>'
      + '<div class="qp-card-desc">' + q.description + '</div>'
      + '<div class="qp-card-skills">' + skills + '</div>'
      + '<div class="qp-card-meta">⏱ ' + formatDuration(q.duration_s) + ' &nbsp;·&nbsp; 🎁 ' + (q.reward_label||'Rewards') + '</div>'
      + (busy ? '<div class="qp-card-busy">⏳ Underway</div>' : '<div class="qp-card-hint">Tap to assemble party</div>')
      + '</div>'
      + '</div>';
  }).join('');

  container.innerHTML = '<div class="qp-carousel-wrap">'
    + '<div class="qp-track" id="qp-track">' + cardsHtml + '</div>'
    + '</div>'
    + '<div class="qp-nav-row">'
    + '<button class="qp-nav-btn" onclick="_partyCarouselGo(_partyQuestIdx - 1)">←</button>'
    + '<div class="carousel-dots" id="qp-dots"></div>'
    + '<button class="qp-nav-btn" onclick="_partyCarouselGo(_partyQuestIdx + 1)">→</button>'
    + '</div>';

  _applyPartyCarouselPositions();
}

function _applyPartyCarouselPositions() {
  const total = _partyQuestList.length;
  for (let i = 0; i < total; i++) {
    const card = document.getElementById('qpc-' + i);
    if (!card) continue;
    card.className = 'qp-card';
    card.onclick = null;

    let offset = i - _partyQuestIdx;
    if (offset > total / 2) offset -= total;
    if (offset < -total / 2) offset += total;

    if (offset === 0) {
      card.classList.add('qpc-active');
      card.onclick = () => {
        const q = _partyQuestList[i];
        if (q && !_partyInProgress.some(a => a.quest_id === q.id)) openPartyAssembly(q.id);
      };
    } else if (offset === -1) {
      card.classList.add('qpc-l1');
      card.onclick = () => _partyCarouselGo(_partyQuestIdx - 1);
    } else if (offset === 1) {
      card.classList.add('qpc-r1');
      card.onclick = () => _partyCarouselGo(_partyQuestIdx + 1);
    } else {
      card.classList.add('qpc-hidden');
    }
  }
  // Dots
  const dots = document.getElementById('qp-dots');
  if (dots) {
    dots.innerHTML = _partyQuestList.map((_, i) =>
      '<div class="carousel-dot' + (i === _partyQuestIdx ? ' active' : '') + '" onclick="_partyCarouselGo(' + i + ')"></div>'
    ).join('');
  }
}

function _partyCarouselGo(idx) {
  const total = _partyQuestList.length;
  _partyQuestIdx = ((idx % total) + total) % total;
  _applyPartyCarouselPositions();
}

// kept for compat
function _partyCarouselCardHtml(q) { return ''; }

// ── Party assembly modal ───────────────────────
function openPartyAssembly(questId) {
  // Check the active list first (noticeboard), then fall back to NPC store.
  let q = _partyQuestList.find(x => x.id === questId);
  if (!q && window._npcQuestForAssembly && window._npcQuestForAssembly.id === questId) {
    q = window._npcQuestForAssembly;
  }
  if (!q) return;
  _paCurrentQuest = q;
  const modal = document.getElementById('party-assembly-modal');
  const inner = document.getElementById('party-assembly-inner');
  if (!modal || !inner) return;
  // Hide noticeboard so assembly is unobstructed
  const nb = document.getElementById('noticeboard-modal');
  if (nb) nb.style.display = 'none';
  modal.style.cssText = 'display:flex;position:fixed;inset:0;z-index:9000;background:rgba(8,5,2,0.92);backdrop-filter:blur(8px);overflow-y:auto;align-items:flex-start;justify-content:center;flex-direction:column;padding:20px 0 40px';
  _renderPartyAssembly(q);
}

function closePartyAssembly() {
  const modal = document.getElementById('party-assembly-modal');
  if (modal) modal.style.cssText = 'display:none';
  // If we came from the diplomacy panel, don't reopen the noticeboard.
  const fromNpc = modal?.dataset?.source === 'npc';
  if (fromNpc) {
    if (modal) {
      delete modal.dataset.source;
      delete modal.dataset.npcId;
    }
    window._npcQuestForAssembly = null;
    return;
  }
  // Reopen noticeboard behind the assembly
  const nb = document.getElementById('noticeboard-modal');
  if (nb && _questMode !== null) nb.style.display = 'flex';
}

function _renderPartyAssembly(q) {
  const inner    = document.getElementById('party-assembly-inner');
  const requires = q.requires || [];
  const busyIds  = new Set(_partyInProgress.map(r => r.citizen_id));

  const selects = requires.map((req, i) => {
    // All citizens — busy/expedition ones shown greyed out with reason
    const pool = (citizensData||[])
      .filter(c => c.life_stage !== 'child')
      .sort((a, b) => (b.skills?.[req.skill_key]??0) - (a.skills?.[req.skill_key]??0));

    const opts = pool.map(c => {
      const sk = c.skills?.[req.skill_key] ?? 0;
      const isBusy = busyIds.has(c.id) || !!c.expedition || !!c.active_quest;
      const busyLabel = c.active_quest ? ' [On quest]' : c.expedition ? ' [Scouting]' : busyIds.has(c.id) ? ' [Busy]' : '';
      return '<option value="' + c.id + '" data-skill="' + (isBusy ? 0 : sk) + '" data-busy="' + (isBusy ? '1' : '0') + '"' + (isBusy ? ' disabled' : '') + '>'
        + c.name + ' (' + (QUEST_SKILL_LABELS[req.skill_key]||req.skill_key) + ' ' + sk + ')' + busyLabel
        + '</option>';
    }).join('');

    return '<div class="pa-slot">'
      + '<div class="pa-slot-header">'
      + '<span class="pa-slot-num">' + (i+1) + '</span>'
      + '<div class="pa-slot-info"><div class="pa-slot-role">' + req.role_label + '</div>'
      + '<div class="pa-slot-skill">' + (QUEST_SKILL_LABELS[req.skill_key]||req.skill_key) + ' · ' + req.desc + '</div></div>'
      + '</div>'
      + '<select class="pa-select" id="pa-sel-' + i + '" onchange="_updatePartyChance();_lockDuplicateSlots(' + requires.length + ')">'
      + '<option value="">— Choose ' + req.role_label + ' —</option>'
      + opts
      + '</select>'
      + '</div>';
  }).join('');

  inner.innerHTML = '<div class="pa-header">'
    + '<button class="pa-back" onclick="_paBack()">← Back</button>'
    + '<div class="pa-title">' + (q.icon||'⚔️') + ' ' + q.title + '</div>'
    + '</div>'
    + '<div class="pa-subtitle">Assemble your party</div>'
    + '<div class="pa-slots">' + selects + '</div>'
    + '<div class="pa-chance-section">'
    + '<div class="pa-chance-label">Chance of success</div>'
    + '<div class="pa-chance-bar-wrap"><div class="pa-chance-bar" id="pa-chance-bar" style="width:' + Math.round(q.base_success*100) + '%"></div></div>'
    + '<div class="pa-chance-pct" id="pa-chance-pct">' + Math.round(q.base_success*100) + '%</div>'
    + '<div class="pa-chance-desc" id="pa-chance-desc">Assign your party to see their chances</div>'
    + '</div>'
    + _renderCombatBlock(q, 'pa')
    + '<button class="pa-send-btn" data-questid="' + q.id + '" data-partysize="' + requires.length + '" onclick="acceptPartyQuest(this.dataset.questid, +this.dataset.partysize)">⚔️ Send Party</button>'
    + '<div class="qb-flash" id="pa-flash"></div>';
}

let _paCurrentQuest = null; // set when assembly modal opens

// Disable already-chosen citizens in other dropdowns to prevent duplicates
function _lockDuplicateSlots(partySize) {
  const chosen = new Set();
  for (let i = 0; i < partySize; i++) {
    const sel = document.getElementById('pa-sel-' + i);
    if (sel && sel.value) chosen.add(parseInt(sel.value));
  }
  for (let i = 0; i < partySize; i++) {
    const sel = document.getElementById('pa-sel-' + i);
    if (!sel) continue;
    const myVal = parseInt(sel.value);
    Array.from(sel.options).forEach(opt => {
      if (!opt.value) return;
      const v = parseInt(opt.value);
      // Disable if chosen by another slot (not this one)
      opt.disabled = (chosen.has(v) && v !== myVal) || opt.dataset.busy === '1';
    });
  }
}

function _updatePartyChance() {
  if (!_paCurrentQuest) return;
  const { base_success: baseSuccess, requires } = _paCurrentQuest;
  const partySize = requires.length;
  let totalSkill = 0, assigned = 0;
  for (let i = 0; i < partySize; i++) {
    const sel = document.getElementById('pa-sel-' + i);
    if (!sel || !sel.value) continue;
    const opt = sel.selectedOptions[0];
    totalSkill += parseInt(opt?.dataset?.skill || 0);
    assigned++;
  }
  if (assigned === 0) return;
  const avgSkill = totalSkill / partySize;
  const chance   = Math.min(95, Math.round((baseSuccess + (avgSkill - 1) * 0.04) * 100));

  const bar  = document.getElementById('pa-chance-bar');
  const pct  = document.getElementById('pa-chance-pct');
  const desc = document.getElementById('pa-chance-desc');
  if (!bar) return;

  bar.style.width = chance + '%';
  // Colour gradient: red → yellow → green → dark green
  const color = chance >= 80 ? '#2d9e4a'
              : chance >= 60 ? '#5ec45e'
              : chance >= 40 ? '#e8c76a'
              : '#e87a6a';
  bar.style.background = color;
  if (pct) pct.textContent = chance + '%';
  if (desc) {
    const label = chance >= 80 ? 'Extremely likely — a fine party indeed.'
                : chance >= 60 ? 'Good odds — they should manage.'
                : chance >= 40 ? 'Uncertain — fortune will decide.'
                :                'Perilous — many may not return.';
    desc.textContent = (assigned < partySize ? '(' + (partySize-assigned) + ' slot(s) unfilled) ' : '') + label;
    desc.style.color  = color;
  }
}

// Override acceptPartyQuest to read from assembly modal selects
async function acceptPartyQuest(questId, partySize) {
  const modal = document.getElementById('party-assembly-modal');
  const fromNpc = modal?.dataset?.source === 'npc';
  const npcId = modal?.dataset?.npcId;
  const autoResolve = _paAutoResolveValue('pa');

  const citizenIds = [];
  // Try assembly modal first, fall back to carousel selects
  for (let i = 0; i < partySize; i++) {
    const sel = document.getElementById('pa-sel-' + i) || document.getElementById('pq-select-' + questId + '-' + i);
    const val = parseInt(sel?.value);
    if (!val) { _paFlash('Assign all ' + partySize + ' party members before sending.'); return; }
    if (citizenIds.includes(val)) { _paFlash('Each party member must be a different citizen.'); return; }
    citizenIds.push(val);
  }
  try {
    const res = await apiFetch('/api/quests/accept-party', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quest_id: questId, citizen_ids: citizenIds, auto_resolve_combat: autoResolve }),
    });
    const data = await res.json();
    if (!res.ok) { _paFlash('⚠️ ' + (data.error || 'Failed.')); return; }
    closePartyAssembly();
    showToastNotification('⚔️ Party sent! Returns in ' + formatDuration(Math.ceil((new Date(data.completes_at) - Date.now()) / 1000)) + '.', 'quest_return');

    if (fromNpc) {
      if (npcId && typeof _loadAndRenderNpcQuests === 'function') {
        _loadAndRenderNpcQuests(npcId);
      }
      if (typeof loadCitizens === 'function') {
        await loadCitizens();
        if (typeof renderCitizensList === 'function') renderCitizensList();
      }
      return;
    }

    // Remove accepted quest from carousel list
    _partyQuestList = _partyQuestList.filter(q => q.id !== questId);
    _partyQuestIdx = Math.min(_partyQuestIdx, Math.max(0, _partyQuestList.length - 1));
    // Reload quest data to show in-progress
    await openNoticeboard(_questMode);
  } catch(e) {
    _paFlash('⚠️ Error sending party.');
  }
}

function _paFlash(msg) {
  const el = document.getElementById('pa-flash');
  if (el) { el.textContent = msg; setTimeout(() => { if(el) el.textContent=''; }, 3000); }
}

// Renders the "this quest may involve combat" block for the accept panel.
// Returns empty string when combat_chance is 0, so peaceful quests aren't
// cluttered with irrelevant UI. The checkbox id is namespaced (sq vs pa)
// because solo and party panels can both render in the same modal slot.
function _renderCombatBlock(quest, ns) {
  const chance = parseInt(quest && quest.combat_chance) || 0;
  if (chance <= 0) return '';
  const guaranteed = chance >= 100;
  const label = guaranteed
    ? '⚔ Combat is guaranteed on this quest.'
    : '⚔ <b>' + chance + '%</b> chance of combat during the quest.';
  return '<div class="pa-combat-block">'
    + '<div class="pa-combat-label">' + label + '</div>'
    + '<label class="pa-combat-toggle">'
    +   '<input type="checkbox" id="' + ns + '-auto-resolve">'
    +   '<span>Auto-resolve combat</span>'
    +   '<span class="pa-combat-hint">When triggered, the battle plays out without your input.</span>'
    + '</label>'
    + '</div>';
}

// Read the auto-resolve checkbox value, defaulting to false. Used by both
// solo and party accept paths.
function _paAutoResolveValue(ns) {
  const el = document.getElementById(ns + '-auto-resolve');
  return !!(el && el.checked);
}

// Back-button dispatcher for the assembly modal. Honours the data-source flag
// so an NPC-quest assembly closes cleanly without reopening the noticeboard.
function _paBack() {
  const modal = document.getElementById('party-assembly-modal');
  const fromNpc = modal?.dataset?.source === 'npc';
  closePartyAssembly();
  if (!fromNpc) openNoticeboardModal(_questMode);
}

// Entry point used by diplomacy.js to launch a citizen-assignment flow for an
// NPC-village quest. Solo and party flows reuse the existing assembly modal,
// just tagged with a source flag so back/accept don't bounce to the noticeboard.
function openNpcQuestAssignment(questDef, npcId) {
  if (!questDef) return;
  const modal = document.getElementById('party-assembly-modal');
  if (!modal) return;
  modal.dataset.source = 'npc';
  modal.dataset.npcId  = String(npcId);

  if (questDef.quest_type === 'party') {
    // openPartyAssembly looks up the quest from _partyQuestList; stash it where
    // it can find it via the npc fallback path.
    window._npcQuestForAssembly = questDef;
    // Pre-populate _partyInProgress so the busy-citizen blur picks up active runs.
    // Using the live citizensData is enough for this purpose since
    // c.active_quest is already set per citizen.
    if (typeof _partyInProgress === 'undefined') window._partyInProgress = [];
    openPartyAssembly(questDef.id);
  } else {
    // Solo flow uses the same modal but takes the quest object directly.
    openSoloQuestPanel(questDef);
  }
}

// renderPartyQuest kept as wrapper for the list view
function renderPartyQuest(q, inProgress) {
  return _partyCarouselCardHtml(q, inProgress);
}

async function acceptQuest(questId, selectId) {
  const selEl = document.getElementById(selectId || ('qb-select-' + questId));
  const citizenId = selEl ? parseInt(selEl.value) : null;
  if (!citizenId) {
    const flashEl = document.getElementById('sq-flash');
    if (flashEl) { flashEl.textContent = '⚠️ Pick a citizen first.'; setTimeout(()=>{ flashEl.textContent=''; },2500); }
    else _questFlash('⚠️ Pick a citizen first.');
    return;
  }

  const btn = document.querySelector(`#qb-available .qb-card .qb-accept-btn`);

  try {
    const res = await apiFetch('/api/quests/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quest_id: questId, citizen_id: citizenId }),
    });
    const data = await res.json();
    if (!res.ok) { _questFlash(`⚠️ ${data.error}`); return; }

    _questFlash(`🗡 ${data.citizen_name} has set out!`);
    // Reload board
    const res2 = await apiFetch('/api/quests');
    _questData = await res2.json();
    renderQuestBoard();
    startQuestTimers();
  } catch (e) {
    _questFlash('⚠️ Something went wrong.');
  }
}

async function collectQuest(runId) {
  try {
    const res = await apiFetch(`/api/quests/collect/${runId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { _questFlash(`⚠️ ${data.error}`); return; }

    if (data.gold_awarded > 0) {
      _questFlash(`🪙 Collected ${data.gold_awarded} gold!`);
      if (gameData?.settlement?.resources) {
        gameData.settlement.resources.wealth += data.gold_awarded;
        updateTopbarDisplay?.();
      }
    } else {
      _questFlash('Quest dismissed.');
    }

    const res2 = await apiFetch('/api/quests');
    _questData = await res2.json();
    renderQuestBoard();
    startQuestTimers();
  } catch (e) {
    _questFlash('⚠️ Failed to collect.');
  }
}

// ── Timers ────────────────────────────────────

function startQuestTimers() {
  stopQuestTimers();
  _questTimerInterval = setInterval(_tickQuestTimers, 1000);
}

function stopQuestTimers() {
  if (_questTimerInterval) { clearInterval(_questTimerInterval); _questTimerInterval = null; }
}

function _tickQuestTimers() {
  document.querySelectorAll('.quest-timer').forEach(el => {
    const eta = new Date(el.dataset.eta);
    const remaining = Math.max(0, Math.ceil((eta - Date.now()) / 1000));
    el.textContent = remaining > 0 ? formatDuration(remaining) : 'Returning…';

    // Update progress bar
    const runId = el.dataset.id;
    const bar = document.getElementById(`qb-progress-${runId}`);
    if (bar) {
      const run = _questData.active.find(q => String(q.id) === String(runId));
      if (run) bar.style.width = `${_progressPct(run)}%`;
    }
  });

  // Fire toast the moment a quest timer hits zero, then refresh
  const justDone = _questData.active.filter(q =>
    q.status === 'active' && new Date(q.completes_at) <= Date.now()
  );
  if (justDone.length) {
    // Toast immediately before server refresh
    justDone.forEach(q => {
      const def = q.quest_def || {};
      const title = def.title || q.quest_id;
      const members = (q.party_members || []).map(m => m.name).join(', ') || q.citizen_name || 'Your party';
      showToastNotification(members + ' has returned from "' + title + '"!', 'quest_return');
    });
    apiFetch('/api/quests').then(r => r.json()).then(data => {
      _questData = data;
      renderQuestBoard();
      startQuestTimers();
      // If quests modal is open, refresh it too
      if (document.getElementById('quests-modal')?.style.display === 'flex') {
        _renderQuestsModal();
      }
    });
  }
}

function _progressPct(run) {
  const start = new Date(run.started_at).getTime();
  const end = new Date(run.completes_at).getTime();
  const now = Date.now();
  const total = end - start;
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round(((now - start) / total) * 100)));
}

// ── Helpers ───────────────────────────────────

function _getQuestDef(questId) {
  // First check active quests for an embedded definition (server-provided)
  const fromActive = _questData.active?.find(q => q.quest_id === questId);
  if (fromActive?.quest_def) return fromActive.quest_def;
  // Fall back to available list
  return _questData.available?.find(q => q.id === questId) || null;
}

function _questFlash(msg) {
  let flash = document.getElementById('qb-flash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'qb-flash';
    flash.className = 'qb-flash';
    document.getElementById('tavern-quest-board')?.prepend(flash);
  }
  flash.textContent = msg;
  flash.classList.add('visible');
  setTimeout(() => flash.classList.remove('visible'), 3000);
}
