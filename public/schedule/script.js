/* ============================================================
   CTVS Schedule — Google Sheets powered broadcast graphic
   ============================================================ */

const STORAGE_KEY = 'ctvs-standings-config-schedule';

const DEFAULT_CONFIG = {
  sheetId: '',
  sheetName: 'Sheet1',
  weekDay: 'Week 1 Day 1',
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
   Layout of the sheet (columns A-F):
     No. | ID | DIVISION | PLAYER 1 | TIME/SC | PLAYER 2
   preceded by a title row ("MATCHES TO SHOW ON GRAPHICS SCREEN").
   We find the header row by its column names (so extra columns / rows
   above or to the left don't matter), then read each match row relative to
   those columns. "ID" is the match ID, "TIME/SC" is the kick-off time (or
   "TBA") shown in the middle pill. Rows missing a field are skipped; a fully
   blank row after the data ends the list. Only the first four valid rows
   are used, since only four boxes are drawn.
   The older layout (a "SCHEDULE" label cell followed by
   Match ID | Division | Player 1 | Time | Player 2) is still supported. */
function normHeader(v){
  return (v || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumns(rows){
  for(let r = 0; r < rows.length; r++){
    const cells = rows[r].map(normHeader);
    const idCol = cells.indexOf('id');
    if(idCol === -1) continue;

    const find = (names, from) => {
      for(let c = from; c < cells.length; c++){
        if(names.includes(cells[c])) return c;
      }
      return -1;
    };
    const divisionCol = find(['division', 'division / group', 'group'], 0);
    const player1Col  = find(['player 1', 'player1'], 0);
    const timeCol     = find(['time/sc', 'time / sc', 'time', 'time/score'], 0);
    const player2Col  = find(['player 2', 'player2'], 0);

    if(divisionCol !== -1 && player1Col !== -1 && timeCol !== -1 && player2Col !== -1){
      return { headerRowIdx: r, matchCol: idCol, divisionCol, player1Col, formatCol: timeCol, player2Col };
    }
  }

  // Legacy layout: a "SCHEDULE" label cell, columns follow it.
  for(let r = 0; r < rows.length; r++){
    for(let c = 0; c < rows[r].length; c++){
      if(normHeader(rows[r][c]) === 'schedule'){
        return { headerRowIdx: r, matchCol: c, divisionCol: c + 1, player1Col: c + 2, formatCol: c + 3, player2Col: c + 4 };
      }
    }
  }
  return null;
}

function extractSchedule(rows){
  const cols = findColumns(rows);
  if(!cols){
    throw new Error('Could not find the header row (ID / DIVISION / PLAYER 1 / TIME/SC / PLAYER 2) in the sheet.');
  }
  const { headerRowIdx, matchCol, divisionCol, player1Col, formatCol, player2Col } = cols;

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
    // otherwise: not a match row — skip and keep scanning
  }

  return matches;
}

/* ---------------- Match-type rules ----------------
   The division text (center of the header) decides the theme and the
   "Best-of" text on the right:
     contains "Premier" -> Best-of-5
     contains "Rising"  -> Best-of-3                                  */
function getMatchType(division){
  const d = (division || '').toLowerCase();
  if(d.includes('premier')) return { key: 'premier', bestOf: 'Best-of-5' };
  if(d.includes('rising'))  return { key: 'rising',  bestOf: 'Best-of-3' };
  return { key: 'premier', bestOf: '' };   // unknown division: default look, no format text
}

/* Time cell -> "HH:MM". Handles "20:00", "20:00:00" and "8:00 PM"; anything else
   (e.g. "TBA") is shown as typed. */
function formatTime(value){
  const v = (value || '').trim();
  const m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/i);
  if(!m) return v;
  let h = parseInt(m[1], 10);
  if(m[3]){
    const pm = m[3].toLowerCase() === 'pm';
    if(pm && h < 12) h += 12;
    if(!pm && h === 12) h = 0;
  }
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/* Player names like "2nd Seed" -> 2<sup>nd</sup> Seed (as in the design). */
function formatPlayer(name){
  const html = escapeHTML(name).replace(/(\d+)(st|nd|rd|th)\b/gi, '$1<sup class="ordinal">$2</sup>');
  return `<span class="player-name">${html}</span>`;   // wrapper keeps the space intact inside the flex .player
}

/* ---------------- Rendering ---------------- */
function renderMatches(matches){
  const container = document.getElementById('schedule');
  container.innerHTML = '';

  for(let i = 0; i < MAX_BOXES; i++){
    const m = matches[i];
    const box = document.createElement('div');
    const type = m ? getMatchType(m.division) : null;
    box.className = 'match-box' +
      (m ? ` match-box--${type.key}` : ' match-box--empty');
    box.setAttribute('role', 'listitem');

    if(m){
      box.innerHTML = `
        <div class="match-header">
          <span class="match-id">MATCH ${escapeHTML(m.matchId)}</span>
          <span class="match-division">${escapeHTML(m.division)}</span>
          <span class="match-bestof">${escapeHTML(type.bestOf)}</span>
        </div>
        <div class="match-body">
          <span class="player player--left">${formatPlayer(m.player1)}</span>
          <span class="format-pill">${escapeHTML(formatTime(m.format))}</span>
          <span class="player player--right">${formatPlayer(m.player2)}</span>
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
}

function initSettingsUI(cfg){
  const btn   = document.getElementById('settingsBtn');
  const panel = document.getElementById('settingsPanel');
  const idIn  = document.getElementById('cfgSheetId');
  const nameIn= document.getElementById('cfgSheetName');
  const weekDayIn  = document.getElementById('cfgWeekDay');
  const refreshIn = document.getElementById('cfgRefresh');

  idIn.value = cfg.sheetId;
  nameIn.value = cfg.sheetName;
  weekDayIn.value = cfg.weekDay;
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
