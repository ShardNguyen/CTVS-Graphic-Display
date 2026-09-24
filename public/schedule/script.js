/* ============================================================
   CTVS Schedule — Google Sheets powered broadcast graphic
   ============================================================ */

const STORAGE_KEY = 'ctvs-standings-config-schedule';

const DEFAULT_CONFIG = {
  sheetId: '',
  sheetName: 'SCHEDULE - PREMIER',
  weekDay: 'Week 1 Day 1',
  division: 'Match Day',
  refreshSeconds: 15
};

const MAX_BOXES = 4;

function loadConfig(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch(e){
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

/** Accepts either a raw Sheet ID or a full Google Sheets URL and returns the ID. */
function extractSheetId(input){
  if(!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if(match) return match[1];
  return trimmed;
}

/* ---------------- CSV parsing (handles quoted fields) ---------------- */
function parseCSV(text){
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for(let i = 0; i < text.length; i++){
    const c = text[i];

    if(inQuotes){
      if(c === '"'){
        if(text[i + 1] === '"'){ field += '"'; i++; }
        else{ inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }

    if(c === '"'){ inQuotes = true; continue; }
    if(c === ','){ row.push(field); field = ''; continue; }
    if(c === '\r'){ continue; }
    if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}

/* ---------------- Schedule extraction ----------------
   Layout mirrors the CTVS schedule sheet:
   ... | Match ID | Division / Group | Player 1 | Format | Player 2 | ...
   We locate the "SCHEDULE" label cell and then read every match row
   relative to its column, which keeps this working even if extra
   columns exist to the left/right (as in the source file). Rows that
   don't have all five fields (e.g. a "Week 1 Day 1" label row) are
   skipped rather than treated as the end of the list. Only the first
   four valid match rows found are used, since only four boxes are drawn. */
function extractSchedule(rows){
  let headerRowIdx = -1;
  let matchCol = -1;

  outer:
  for(let r = 0; r < rows.length; r++){
    const row = rows[r];
    for(let c = 0; c < row.length; c++){
      if((row[c] || '').trim().toLowerCase() === 'schedule'){
        headerRowIdx = r;
        matchCol = c;
        break outer;
      }
    }
  }

  if(matchCol === -1){
    throw new Error('Could not find a "SCHEDULE" label in the sheet.');
  }

  const divisionCol = matchCol + 1;
  const player1Col  = matchCol + 2;
  const formatCol    = matchCol + 3;
  const player2Col  = matchCol + 4;

  const matches = [];
  for(let r = headerRowIdx + 1; r < rows.length; r++){
    const row = rows[r];

    const matchId   = (row[matchCol]    || '').trim();
    const division  = (row[divisionCol] || '').trim();
    const player1   = (row[player1Col]  || '').trim();
    const format    = (row[formatCol]   || '').trim();
    const player2   = (row[player2Col]  || '').trim();

    if(matchId && division && player1 && format && player2){
      matches.push({ matchId, division, player1, format, player2 });
      if(matches.length >= MAX_BOXES) break;
    } else if(matches.length > 0 && !matchId && !division && !player1 && !format && !player2){
      break; // blank row after the data block
    }
    // otherwise: not a match row (e.g. the "Week 1 Day 1" label) — skip and keep scanning
  }

  return matches;
}

/* ---------------- Rendering ---------------- */
function renderMatches(matches){
  const container = document.getElementById('schedule');
  container.innerHTML = '';

  for(let i = 0; i < MAX_BOXES; i++){
    const m = matches[i];
    const box = document.createElement('div');
    box.className = 'match-box' + (m ? '' : ' match-box--empty');
    box.setAttribute('role', 'listitem');

    if(m){
      box.innerHTML = `
        <div class="match-header">
          <span class="match-id">MATCH ${escapeHTML(m.matchId)}</span>
          <span class="match-division">${escapeHTML(m.division)}</span>
        </div>
        <div class="match-body">
          <span class="player player--left">${escapeHTML(m.player1)}</span>
          <span class="format-pill">${escapeHTML(m.format)}</span>
          <span class="player player--right">${escapeHTML(m.player2)}</span>
        </div>
      `;
    } else {
      box.innerHTML = `
        <div class="match-header"></div>
        <div class="match-body"></div>
      `;
    }

    container.appendChild(box);
  }
}

function escapeHTML(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setStatus(msg, isError){
  const el = document.getElementById('status');
  if(!msg){ el.hidden = true; return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

/* ---------------- Data fetch ---------------- */
async function fetchSchedule(cfg){
  const id = extractSheetId(cfg.sheetId);
  if(!id){
    throw new Error('No Google Sheet configured yet. Click the gear icon to add one.');
  }
  const url =
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv` +
    (cfg.sheetName ? `&sheet=${encodeURIComponent(cfg.sheetName)}` : '');

  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok){
    throw new Error(`Sheet request failed (${res.status}). Check sharing settings & tab name.`);
  }
  const text = await res.text();
  const rows = parseCSV(text);
  return extractSchedule(rows);
}

let refreshTimer = null;

async function refresh(cfg){
  try{
    const matches = await fetchSchedule(cfg);
    if(!matches.length){
      setStatus('No schedule rows found yet.', false);
    } else {
      setStatus('');
    }
    renderMatches(matches);
  }catch(err){
    console.error(err);
    setStatus(err.message || 'Could not load schedule.', true);
    renderMatches([]);
  }
}

function scheduleRefresh(cfg){
  if(refreshTimer) clearInterval(refreshTimer);
  const seconds = Math.max(3, Number(cfg.refreshSeconds) || DEFAULT_CONFIG.refreshSeconds);
  refreshTimer = setInterval(() => refresh(cfg), seconds * 1000);
}

/* ---------------- Settings UI ---------------- */
function applyCosmeticConfig(cfg){
  document.getElementById('weekDay').textContent   = cfg.weekDay   || DEFAULT_CONFIG.weekDay;
  document.getElementById('division').textContent  = cfg.division || DEFAULT_CONFIG.division;
}

function initSettingsUI(cfg){
  const btn   = document.getElementById('settingsBtn');
  const panel = document.getElementById('settingsPanel');
  const idIn  = document.getElementById('cfgSheetId');
  const nameIn= document.getElementById('cfgSheetName');
  const weekDayIn  = document.getElementById('cfgWeekDay');
  const divisionIn = document.getElementById('cfgDivision');
  const refreshIn = document.getElementById('cfgRefresh');

  idIn.value = cfg.sheetId;
  nameIn.value = cfg.sheetName;
  weekDayIn.value = cfg.weekDay;
  divisionIn.value = cfg.division;
  refreshIn.value = cfg.refreshSeconds;

  const open = () => { panel.hidden = false; idIn.focus(); };
  const close = () => { panel.hidden = true; };

  btn.addEventListener('click', () => panel.hidden ? open() : close());
  document.getElementById('cfgClose').addEventListener('click', close);

  document.addEventListener('keydown', (e) => {
    if(e.key.toLowerCase() === 's' && document.activeElement.tagName !== 'INPUT'){
      panel.hidden ? open() : close();
    }
    if(e.key === 'Escape') close();
  });

  document.getElementById('cfgSave').addEventListener('click', () => {
    const newCfg = {
      sheetId: idIn.value.trim(),
      sheetName: nameIn.value.trim() || DEFAULT_CONFIG.sheetName,
      weekDay: weekDayIn.value.trim() || DEFAULT_CONFIG.weekDay,
      division: divisionIn.value.trim() || DEFAULT_CONFIG.division,
      refreshSeconds: Number(refreshIn.value) || DEFAULT_CONFIG.refreshSeconds
    };
    saveConfig(newCfg);
    applyCosmeticConfig(newCfg);
    close();
    refresh(newCfg);
    scheduleRefresh(newCfg);
  });

  // Auto-open on first run if nothing configured yet.
  if(!cfg.sheetId) open();
}

/* ---------------- Boot ---------------- */
(function init(){
  const cfg = loadConfig();
  applyCosmeticConfig(cfg);
  initSettingsUI(cfg);
  renderMatches([]); // draw the four empty boxes immediately
  setStatus('Loading schedule…', false);
  refresh(cfg);
  scheduleRefresh(cfg);
})();
