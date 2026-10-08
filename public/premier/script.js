/* ============================================================
   CTVS Standings — Google Sheets powered broadcast graphic
   ============================================================ */

const STORAGE_KEY = 'ctvs-standings-config-premier';

const DEFAULT_CONFIG = {
  sheetId: '',
  sheetName: 'LEADERBOARD - PREMIER',
  weekDay: 'Week 1 Day 1',
  division: 'Premier Division',
  refreshSeconds: 15
};

function loadConfig(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  }catch(e){
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

/* ---------------- Standings extraction ----------------
   Layout mirrors the "LEADERBOARD - PREMIER" tab of the CTVS sheet:
   ... | Rank | Team | W | - | L | GW | GL | GD | ...
   We locate the header by finding the "W - L" cell (falling back to the
   first "GW" cell), then read every column relative to it. */
function extractStandings(rows){
  let headerRowIdx = -1;
  let wlCol = -1;
  const norm = v => (v || '').trim().toLowerCase().replace(/\s+/g, ' ');

  outer:
  for(let r = 0; r < rows.length; r++){
    const row = rows[r];
    for(let c = 0; c < row.length; c++){
      if(norm(row[c]) === 'w - l'){
        headerRowIdx = r;
        wlCol = c;
        break outer;
      }
    }
  }

  if(wlCol === -1){
    outer2:
    for(let r = 0; r < rows.length; r++){
      for(let c = 0; c < rows[r].length; c++){
        if(norm(rows[r][c]) === 'gw'){
          headerRowIdx = r;
          wlCol = c - 3;
          break outer2;
        }
      }
    }
  }

  if(wlCol < 2){
    throw new Error('Could not find the "W - L" column header in the sheet.');
  }

  const rankCol   = wlCol - 2;
  const teamCol   = wlCol - 1;
  const winCol    = wlCol;
  const lossCol   = wlCol + 2;
  const gwCol     = wlCol + 3;
  const glCol     = wlCol + 4;
  const gdCol     = wlCol + 5;

  const toInt = v => {
    const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  const teams = [];
  for(let r = headerRowIdx + 1; r < rows.length; r++){
    const row = rows[r];
    const rank = toInt(row[rankCol]);
    const team = (row[teamCol] || '').trim();

    if(rank === null || !team) break; // end of the standings block

    teams.push({
      rank,
      team,
      win:    toInt(row[winCol]),
      loss:   toInt(row[lossCol]),
      gw:     toInt(row[gwCol]),
      gl:     toInt(row[glCol]),
      gd:     toInt(row[gdCol]),
    });
  }

  return teams;
}

/* ---------------- Rendering ---------------- */
function renderRows(teams){
  const container = document.getElementById('rows');
  container.innerHTML = '';

  teams.forEach(t => {
    const row = document.createElement('div');
    row.className = 'row row--data';
    row.setAttribute('role', 'row');

    const gd = t.gd;
    const gdText = gd === null ? '–' : `${gd}`;

    row.innerHTML = `
      <div class="cell cell--rank" role="cell">${t.rank ?? ''}</div>
      <div class="cell cell--team" role="cell">${escapeHTML(t.team)}</div>
      <div class="cell cell--wl" role="cell">${t.win ?? '–'} - ${t.loss ?? '–'}</div>
      <div class="cell cell--stat" role="cell">${t.gw ?? '–'}</div>
      <div class="cell cell--stat" role="cell">${t.gl ?? '–'}</div>
      <div class="cell cell--stat" role="cell">${gdText}</div>
    `;
    container.appendChild(row);
  });
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
async function fetchStandings(cfg){
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
  return extractStandings(rows);
}

let refreshTimer = null;

async function refresh(cfg){
  try{
    const teams = await fetchStandings(cfg);
    if(!teams.length){
      setStatus('No standings rows found yet.', false);
    } else {
      setStatus('');
    }
    renderRows(teams);
  }catch(err){
    console.error(err);
    setStatus(err.message || 'Could not load standings.', true);
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
  setStatus('Loading standings…', false);
  refresh(cfg);
  scheduleRefresh(cfg);
})();
