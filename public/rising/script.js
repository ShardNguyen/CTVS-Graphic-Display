/* ============================================================
   CTVS Leaderboard — Google Sheets powered broadcast graphic
   Reads ONE tab that holds every group, stacked vertically:

     RISING DIVISION - GROUP A - STANDINGS      <- merged banner
     RK | PLAYER | W - L | | GW | GL | GD | H2H/TB
     1  | ...
     RISING DIVISION - GROUP B - STANDINGS      <- merged banner
     ...

   The banner decides which group the table underneath belongs to.
   ============================================================ */

const STORAGE_KEY = 'ctvs-standings-config-rising';
const PLACEHOLDER_ROWS = 4;

const DEFAULT_CONFIG = {
  sheetId: '',
  sheetName: 'RISING - STANDINGS (6)',
  sheetGid: '',
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
   The tab is scanned top to bottom. A "banner" row (a merged cell whose
   text contains STANDINGS, e.g. "RISING DIVISION - GROUP A - STANDINGS")
   selects the group that the rows below it belong to, until the next
   banner. Banners without a group letter (WILDCARD, TIEBREAKING
   CRITERIA...) switch collection off, so those tables are ignored.

   Standings rows are recognised by their shape (header text is not relied
   on, since Google's CSV export can swallow header cells):

     col:  c     c+1     c+2  c+3  c+4  c+5  c+6  c+7
           Rank  Player  W    -    L    GW   GL   GD

   Extra columns to the left or right (H2H/TB notes etc.) are ignored. */
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

/** Returns the text of a banner row, or null if the row is not a banner. */
function bannerText(row){
  const cells = row.map(v => String(v ?? '').trim()).filter(Boolean);
  if(cells.length !== 1) return null;           // banners are a single merged cell
  const text = cells[0];
  if(isIntLike(text)) return null;
  return /STANDINGS|TIEBREAK/i.test(text) ? text : null;
}

/** "RISING DIVISION - GROUP B - STANDINGS" -> "B"; no group -> null. */
function groupFromBanner(text){
  const m = text.match(/\bGROUP\s*([A-Z0-9]+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Pulls one standings row out of a CSV row, or null if it isn't one. */
function readStandingsRow(row){
  for(let c = 0; c < row.length; c++){
    if(looksLikeStandingsRow(row, c)){
      return {
        rank: toInt(row[c]),
        team: String(row[c + 1] ?? '').trim(),
        win:  toInt(row[c + 2]),
        loss: toInt(row[c + 4]),
        gw:   toInt(row[c + 5]),
        gl:   toInt(row[c + 6]),
        gd:   toInt(row[c + 7]),
      };
    }
  }
  return null;
}

/** Returns { A: [teams], B: [teams], ... } keyed by group letter.

    1) Banner mode: a banner row selects the group for the rows below it.
    2) Positional fallback: Google's gviz CSV export types each column by its
       majority content, so text banners sitting in the numeric Rank column
       can come back EMPTY. When no banner is readable, tables are told apart
       by position instead: the first table is Group A, the next one Group B,
       and so on (a new table starts whenever the rank resets or a non-data
       row such as a banner/header interrupts the rows). */
function extractGroups(rows){
  const groups = {};
  let sawBanner = false;
  let current = null;

  rows.forEach(row => {
    const banner = bannerText(row);
    if(banner !== null){
      sawBanner = true;
      current = groupFromBanner(banner);
      if(current && !groups[current]) groups[current] = [];
      return;
    }
    if(!current) return;
    const t = readStandingsRow(row);
    if(t) groups[current].push(t);
  });

  if(sawBanner && Object.values(groups).some(g => g.length)) return groups;

  // ---- positional fallback ----
  const byPos = {};
  let idx = -1, inTable = false, lastRank = Infinity;
  rows.forEach(row => {
    const t = readStandingsRow(row);
    if(!t){ inTable = false; return; }
    if(!inTable || t.rank <= lastRank){
      idx++;
      byPos[String.fromCharCode(65 + idx)] = [];
    }
    inTable = true;
    lastRank = t.rank;
    byPos[String.fromCharCode(65 + idx)].push(t);
  });
  return byPos;
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
async function fetchGroups(cfg, sheetId){
  // With a tab gid, use the plain CSV export: it returns every cell as-is
  // (banners included). Otherwise use gviz, which looks the tab up by name.
  const gid = String(cfg.sheetGid ?? '').trim();
  const url = gid
    ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`
    : `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv` +
      (cfg.sheetName ? `&sheet=${encodeURIComponent(cfg.sheetName)}` : '');

  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok){
    throw new Error(`Tab "${cfg.sheetName}" request failed (${res.status}). Check sharing settings & tab name.`);
  }
  return extractGroups(parseCSV(await res.text()));
}

let refreshTimer = null;

async function refresh(cfg){
  const id = extractSheetId(cfg.sheetId);
  if(!id){
    setStatus('No Google Sheet configured yet. Click the gear icon to add one.', true);
    return;
  }

  try {
    const groups = await fetchGroups(cfg, id);
    const targets = { A: 'rowsA', B: 'rowsB' };
    const missing = [];

    Object.entries(targets).forEach(([letter, target]) => {
      const teams = groups[letter];
      if(!teams || !teams.length) missing.push(`Group ${letter}`);
      renderRows(target, teams && teams.length ? teams : placeholderTeams());
    });

    setStatus(missing.length
      ? `No standings found for ${missing.join(' / ')} — check the tab name / gid and that the tables list players.`
      : '', missing.length > 0);
  } catch(err){
    console.error(err);
    setStatus(err.message || 'Could not load standings.', true);
  }
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
  const nameIn = document.getElementById('cfgSheetName');
  const gidIn  = document.getElementById('cfgSheetGid');
  const groupAIn = document.getElementById('cfgGroupA');
  const groupBIn = document.getElementById('cfgGroupB');
  const divisionIn = document.getElementById('cfgDivision');
  const refreshIn  = document.getElementById('cfgRefresh');

  idIn.value = cfg.sheetId;
  nameIn.value = cfg.sheetName;
  gidIn.value = cfg.sheetGid;
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
      sheetName: nameIn.value.trim() || DEFAULT_CONFIG.sheetName,
      sheetGid: gidIn.value.trim(),
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
