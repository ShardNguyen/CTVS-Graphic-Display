/* ============================================================
   CTVS Leaderboard — Google Sheets powered broadcast graphic
   Reads TWO tabs (Group A / Group B) from one Google Sheet.
   Each tab uses the same layout as "LEADERBOARD - PREMIER":

        Rank | Team | W | – | L | GW | GL | GD
   ============================================================ */

const STORAGE_KEY = 'ctvs-standings-config-rising';
const PLACEHOLDER_ROWS = 4;

const DEFAULT_CONFIG = {
  sheetId: '',
  sheetNameA: 'LEADERBOARD - GROUP A',
  sheetNameB: 'LEADERBOARD - GROUP B',
  groupA: 'Group A',
  groupB: 'Group B',
  division: 'Rising Division',
  refreshSeconds: 15
};

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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch(e){}
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
   Layout of every leaderboard tab (same as LEADERBOARD - PREMIER):

     col:  c     c+1   c+2  c+3  c+4  c+5  c+6  c+7
           Rank  Team  W    –    L    GW   GL   GD

   Header text is NOT relied on (Google's CSV export can swallow header
   cells that sit in numeric columns). Instead we look for the first row
   that "looks like" a standings row — numeric rank, a team name, then
   numeric W / L / GW / GL / GD — and read downward from there until the
   block ends. Extra columns to the left, or the helper table to the
   right (Buchholz etc.), are ignored. */
const isIntLike = v => /^-?\d+(\.0+)?$/.test(String(v ?? '').trim());
const toInt = v => {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

function looksLikeStandingsRow(row, c){
  const team = String(row[c + 1] ?? '').trim();
  return isIntLike(row[c]) &&
         team !== '' && !isIntLike(team) && team !== '-' &&
         isIntLike(row[c + 2]) &&            // W
         isIntLike(row[c + 4]) &&            // L
         isIntLike(row[c + 5]) &&            // GW
         isIntLike(row[c + 6]) &&            // GL
         isIntLike(row[c + 7]);              // GD
}

function extractStandings(rows){
  let startRow = -1;
  let rankCol = -1;

  outer:
  for(let r = 0; r < rows.length; r++){
    const row = rows[r];
    for(let c = 0; c < row.length; c++){
      if(looksLikeStandingsRow(row, c)){ startRow = r; rankCol = c; break outer; }
    }
  }

  if(startRow === -1){
    throw new Error('Could not find standings rows (Rank, Team, W, –, L, GW, GL, GD).');
  }

  const teams = [];
  for(let r = startRow; r < rows.length; r++){
    const row = rows[r];
    const rank = toInt(row[rankCol]);
    const team = String(row[rankCol + 1] ?? '').trim();
    if(rank === null || !team) break; // end of the standings block

    teams.push({
      rank,
      team,
      win:  toInt(row[rankCol + 2]),
      loss: toInt(row[rankCol + 4]),
      gw:   toInt(row[rankCol + 5]),
      gl:   toInt(row[rankCol + 6]),
      gd:   toInt(row[rankCol + 7]),
    });
  }
  return teams;
}

/* ---------------- Rendering ---------------- */
function escapeHTML(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const show = v => (v === null || v === undefined ? '–' : v);

/** Shrink a team name's font until it fits its cell. */
function fitTeamNames(container){
  container.querySelectorAll('.cell--team').forEach(cell => {
    const name = cell.querySelector('.team-name');
    if(!name) return;
    name.style.fontSize = '';
    let size = parseFloat(getComputedStyle(name).fontSize);
    let guard = 40;
    while(cell.scrollWidth > cell.clientWidth && size > 16 && guard--){
      size -= 2;
      name.style.fontSize = size + 'px';
    }
  });
}

function renderRows(containerId, teams){
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  teams.forEach(t => {
    const row = document.createElement('div');
    row.className = 'row row--data';
    row.setAttribute('role', 'row');
    row.innerHTML = `
      <div class="cell cell--team" role="cell">
        <span class="rk">${t.rank ?? ''}</span>
        <span class="dot">.</span>
        <span class="team-name">${escapeHTML(t.team || '')}</span>
      </div>
      <div class="cell cell--wl" role="cell">${show(t.win)} - ${show(t.loss)}</div>
      <div class="cell cell--stat" role="cell">${show(t.gw)}</div>
      <div class="cell cell--stat" role="cell">${show(t.gl)}</div>
      <div class="cell cell--stat" role="cell">${show(t.gd)}</div>
    `;
    container.appendChild(row);
  });
  fitTeamNames(container);
}

function placeholderTeams(){
  return Array.from({ length: PLACEHOLDER_ROWS }, (_, i) =>
    ({ rank: i + 1, team: '', win: 0, loss: 0, gw: 0, gl: 0, gd: 0 }));
}

function setStatus(msg, isError){
  const el = document.getElementById('status');
  if(!msg){ el.hidden = true; return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

/* ---------------- Data fetch ---------------- */
async function fetchTab(sheetId, sheetName){
  const url =
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv` +
    (sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : '');

  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok){
    throw new Error(`Tab "${sheetName}" request failed (${res.status}). Check sharing settings & tab name.`);
  }
  const text = await res.text();
  try {
    return extractStandings(parseCSV(text));
  } catch(err){
    throw new Error(`Tab "${sheetName}": ${err.message}`);
  }
}

let refreshTimer = null;

async function refresh(cfg){
  const id = extractSheetId(cfg.sheetId);
  if(!id){
    setStatus('No Google Sheet configured yet. Click the gear icon to add one.', true);
    return;
  }

  const jobs = [
    { name: cfg.sheetNameA, target: 'rowsA' },
    { name: cfg.sheetNameB, target: 'rowsB' }
  ];

  // Fetch both tabs in parallel; one failing must not blank the other.
  const results = await Promise.allSettled(jobs.map(j => fetchTab(id, j.name)));

  const errors = [];
  results.forEach((res, i) => {
    if(res.status === 'fulfilled'){
      renderRows(jobs[i].target, res.value.length ? res.value : placeholderTeams());
    } else {
      console.error(res.reason);
      errors.push(res.reason.message || 'Could not load standings.');
    }
  });

  setStatus(errors.join('  |  '), errors.length > 0);
}

function scheduleRefresh(cfg){
  if(refreshTimer) clearInterval(refreshTimer);
  const seconds = Math.max(3, Number(cfg.refreshSeconds) || DEFAULT_CONFIG.refreshSeconds);
  refreshTimer = setInterval(() => refresh(cfg), seconds * 1000);
}

/* ---------------- Fit 1920x1080 stage to the window ---------------- */
function fitStage(){
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.getElementById('stage').style.setProperty('--scale', scale);
}

/* ---------------- Settings UI ---------------- */
function applyCosmeticConfig(cfg){
  document.getElementById('division').textContent    = cfg.division || DEFAULT_CONFIG.division;
  document.getElementById('groupALabel').textContent = cfg.groupA   || DEFAULT_CONFIG.groupA;
  document.getElementById('groupBLabel').textContent = cfg.groupB   || DEFAULT_CONFIG.groupB;
}

function initSettingsUI(cfg){
  const btn   = document.getElementById('settingsBtn');
  const panel = document.getElementById('settingsPanel');
  const idIn  = document.getElementById('cfgSheetId');
  const nameAIn = document.getElementById('cfgSheetNameA');
  const nameBIn = document.getElementById('cfgSheetNameB');
  const groupAIn = document.getElementById('cfgGroupA');
  const groupBIn = document.getElementById('cfgGroupB');
  const divisionIn = document.getElementById('cfgDivision');
  const refreshIn  = document.getElementById('cfgRefresh');

  idIn.value = cfg.sheetId;
  nameAIn.value = cfg.sheetNameA;
  nameBIn.value = cfg.sheetNameB;
  groupAIn.value = cfg.groupA;
  groupBIn.value = cfg.groupB;
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
      sheetNameA: nameAIn.value.trim() || DEFAULT_CONFIG.sheetNameA,
      sheetNameB: nameBIn.value.trim() || DEFAULT_CONFIG.sheetNameB,
      groupA: groupAIn.value.trim() || DEFAULT_CONFIG.groupA,
      groupB: groupBIn.value.trim() || DEFAULT_CONFIG.groupB,
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
  fitStage();
  window.addEventListener('resize', fitStage);

  applyCosmeticConfig(cfg);
  renderRows('rowsA', placeholderTeams());   // empty board shown until data arrives
  renderRows('rowsB', placeholderTeams());
  initSettingsUI(cfg);

  if(extractSheetId(cfg.sheetId)){
    setStatus('Loading standings…', false);
    refresh(cfg);
    scheduleRefresh(cfg);
  }

  // Re-fit names once web fonts finish loading (widths change).
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(() => {
      fitTeamNames(document.getElementById('rowsA'));
      fitTeamNames(document.getElementById('rowsB'));
    });
  }
})();
