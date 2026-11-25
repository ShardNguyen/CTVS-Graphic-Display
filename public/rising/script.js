/* ============================================================
   CTVS Leaderboard — Google Sheets powered broadcast graphic
   Reads ONE tab that holds every group (max 2 shown), stacked vertically:

     RISING DIVISION - GROUP A - STANDINGS      <- merged banner
     RK | PLAYER | W - L | | GW | GL | GD | H2H/TB
     1  | ...
     RISING DIVISION - GROUP B - STANDINGS      <- merged banner
     ...

   Settings "Group name" is matched against the banner text; "Group label"
   is what is displayed. One group configured = centered on the board.
   ============================================================ */

const STORAGE_KEY = 'ctvs-standings-config-rising';
const PLACEHOLDER_ROWS = 4;

const DEFAULT_CONFIG = {
  sheetId: '',
  sheetName: 'RISING - STANDINGS (6)',
  sheetGid: '',
  group1Name: 'RISING DIVISION - GROUP A - STANDINGS',
  group1Label: 'Group A',
  group2Name: 'RISING DIVISION - GROUP B - STANDINGS',
  group2Label: 'Group B',
  division: 'Rising Division',
  refreshSeconds: 15
};

function loadConfig(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return { ...DEFAULT_CONFIG };
    const saved = JSON.parse(raw);
    // migrate settings saved by the older version (groupA / groupB labels)
    if(saved.groupA && !saved.group1Label) saved.group1Label = saved.groupA;
    if(saved.groupB && !saved.group2Label) saved.group2Label = saved.groupB;
    return { ...DEFAULT_CONFIG, ...saved };
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

/** Returns the text of a banner row, or null if the row is not a banner.
    A banner is a row with exactly one non-empty cell holding text. */
function bannerText(row){
  const cells = row.map(v => String(v ?? '').trim()).filter(Boolean);
  if(cells.length !== 1) return null;           // banners are a single merged cell
  const text = cells[0];
  return isIntLike(text) ? null : text;
}

const normalizeName = v => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/** Does a banner's text match a configured "Group name"? (case/space-insensitive) */
function bannerMatches(banner, name){
  const b = normalizeName(banner), n = normalizeName(name);
  return !!n && (b === n || b.includes(n));
}

/** "RISING DIVISION - GROUP B - STANDINGS" -> "B"; no group -> null. */
function groupFromBanner(text){
  const m = String(text ?? '').match(/\bGROUP\s*([A-Z0-9]+)\b/i);
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

/** Returns an array (same order as `names`) with the players of each group.

    1) Banner mode: the rows below a banner matching a group name belong to
       that group, until the next banner.
    2) Positional fallback: Google's gviz CSV export types each column by its
       majority content, so text banners sitting in the numeric Rank column
       can come back EMPTY. When no banner matches, tables are told apart by
       position (first table = Group A, next = Group B, ...) and each group
       name is mapped through its "GROUP <letter>" text. */
function extractGroups(rows, names){
  const result = names.map(() => []);
  let found = false;
  let current = -1;

  rows.forEach(row => {
    const banner = bannerText(row);
    if(banner !== null){
      current = names.findIndex(n => bannerMatches(banner, n));
      if(current >= 0) found = true;
      return;
    }
    if(current < 0) return;
    const t = readStandingsRow(row);
    if(t) result[current].push(t);
  });

  if(found && result.some(g => g.length)) return result;

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
  return names.map(n => byPos[groupFromBanner(n)] || []);
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
<!--        <span class="dot">.</span>-->
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
async function fetchGroups(cfg, sheetId, names){
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
  return extractGroups(parseCSV(await res.text()), names);
}

let refreshTimer = null;

async function refresh(cfg){
  const id = extractSheetId(cfg.sheetId);
  if(!id){
    setStatus('No Google Sheet configured yet. Click the gear icon to add one.', true);
    return;
  }

  try {
    const slots = activeGroups(cfg);
    if(!slots.length){
      setStatus('No group configured. Open settings and fill in a Group name.', true);
      return;
    }
    const groups = await fetchGroups(cfg, id, slots.map(g => g.name));
    const missing = [];

    slots.forEach((g, i) => {
      const teams = groups[i];
      if(!teams || !teams.length) missing.push(g.label);
      renderRows(g.rows, teams && teams.length ? teams : placeholderTeams());
    });

    setStatus(missing.length
      ? `No standings found for ${missing.join(' / ')} — check the Group name matches the sheet banner, and the tab name / gid.`
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
/** The (max 2) groups that have a Group name, in order. */
function activeGroups(cfg){
  return [
    { name: (cfg.group1Name || '').trim(), label: cfg.group1Label, fallback: 'Group 1', table: 'tableA', head: 'groupALabel', rows: 'rowsA' },
    { name: (cfg.group2Name || '').trim(), label: cfg.group2Label, fallback: 'Group 2', table: 'tableB', head: 'groupBLabel', rows: 'rowsB' },
  ].filter(g => g.name).map(g => ({ ...g, label: (g.label || '').trim() || g.fallback }));
}

function applyCosmeticConfig(cfg){
  document.getElementById('division').textContent = cfg.division || DEFAULT_CONFIG.division;

  const slots = activeGroups(cfg);
  ['tableA', 'tableB'].forEach(id => { document.getElementById(id).hidden = true; });
  slots.forEach(g => {
    document.getElementById(g.table).hidden = false;
    document.getElementById(g.head).textContent = g.label;
  });
  // a single group is centered
  document.querySelector('.board').classList.toggle('board--single', slots.length === 1);
}

function initSettingsUI(cfg){
  const btn   = document.getElementById('settingsBtn');
  const panel = document.getElementById('settingsPanel');
  const idIn  = document.getElementById('cfgSheetId');
  const nameIn = document.getElementById('cfgSheetName');
  const gidIn  = document.getElementById('cfgSheetGid');
  const g1NameIn  = document.getElementById('cfgGroup1Name');
  const g1LabelIn = document.getElementById('cfgGroup1Label');
  const g2NameIn  = document.getElementById('cfgGroup2Name');
  const g2LabelIn = document.getElementById('cfgGroup2Label');
  const divisionIn = document.getElementById('cfgDivision');
  const refreshIn  = document.getElementById('cfgRefresh');

  idIn.value = cfg.sheetId;
  nameIn.value = cfg.sheetName;
  gidIn.value = cfg.sheetGid;
  g1NameIn.value  = cfg.group1Name;
  g1LabelIn.value = cfg.group1Label;
  g2NameIn.value  = cfg.group2Name;
  g2LabelIn.value = cfg.group2Label;
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
      group1Name:  g1NameIn.value.trim(),      // empty = group not shown
      group1Label: g1LabelIn.value.trim(),
      group2Name:  g2NameIn.value.trim(),
      group2Label: g2LabelIn.value.trim(),
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
