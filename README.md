# CTVS Web Graphics Display

Live broadcast graphics for the **Classic Tetris Vietnam Series (CTVS)**. A small Node.js/Express server hosts three browser pages that read their data straight from a Google Sheet and redraw automatically. Each page is designed to be captured as a browser source in OBS (or similar broadcast software).

## What it does

| Page | URL | Shows |
|------|-----|-------|
| **Premier leaderboard** | `/premier/` | Standings table for the Premier Division: rank, team/player, W - L, GW (games won), GL (games lost), GD (game difference). |
| **Rising leaderboard** | `/rising/` | Two side-by-side group tables (Group A and Group B) for the Rising Division, on a fixed 1920×1080 canvas that scales to fit the window. Long names shrink to fit their cell. |
| **Schedule** | `/schedule/` | Up to four upcoming match boxes: match ID, division, Player 1, kick-off time, Player 2. Premier matches are labelled Best-of-5 and Rising matches Best-of-3. |

How it works:

- `app.js` is a minimal Express server that serves the `public/` folder as static files. There is no database and no server-side API.
- Each page fetches its Google Sheet tab as CSV (`https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&sheet=<TAB>`), parses it in the browser, and re-renders every N seconds (default 15).
- Settings (sheet ID, tab names, labels, refresh interval) are entered in an on-page settings panel and saved in the browser's `localStorage`, separately for each page.

## Dependencies

**Runtime / tooling**

- [Node.js](https://nodejs.org/) 18 or newer (developed on Node 22) and npm
- [Express](https://expressjs.com/) `^5.2.1` (the only npm dependency)

**Browser**

- A modern browser (Chrome/Chromium, Edge, Firefox, or the OBS Browser Source)
- Internet access to `docs.google.com` for sheet data

**Data source**

- A Google Sheet shared as **"Anyone with the link: Viewer"**

**Fonts** (bundled in each page's `fonts/` folder, no install needed)

- Montserrat and Source Code Pro (SIL Open Font License)
- Name Smile: licensed for **non-commercial use only**. See `public/*/fonts/name_smile/` for the license and a link to buy a commercial one.

## Installation

```bash
# 1. Get the code (unzip the archive or clone the repo) and enter the folder
cd "CTVS Web Graphics Display"

# 2. Install dependencies
npm install
```

> **Note:** the `package.json` in this archive has a trailing comma after the `"test"` script (`"test": "...",` followed by `}`), which is invalid JSON and makes `npm install` fail with an `EJSONPARSE` error. Delete that comma before installing.

## Usage

### 1. Start the server

```bash
node app.js
```

The server listens on **port 3000**. The port is hard-coded in `app.js`; edit `app.listen(3000, ...)` to change it.

### 2. Open a page

- http://localhost:3000/premier/
- http://localhost:3000/rising/
- http://localhost:3000/schedule/

### 3. Connect a Google Sheet

1. In Google Sheets, click **Share** and set general access to **Anyone with the link: Viewer**.
2. Open a page. On first run the settings panel opens automatically. Later, click the **⚙** button or press **S** to open it (**Esc** closes it).
3. Paste the full sheet URL (or just the sheet ID), set the tab name(s) and labels, and click **Save & reload**.

| Setting | Premier | Rising | Schedule |
|---------|---------|--------|----------|
| Google Sheet URL or ID | ✓ | ✓ | ✓ |
| Tab name | `LEADERBOARD - PREMIER` | `LEADERBOARD - GROUP A` and `LEADERBOARD - GROUP B` | `SCHEDULE - PREMIER` |
| Week / day label | ✓ (`Week 1 Day 1`) | – | ✓ |
| Division label | ✓ | ✓ | sub-title label |
| Group labels | – | ✓ | – |
| Refresh interval (min. 3 s) | ✓ (15 s) | ✓ (15 s) | ✓ (15 s) |

Settings are stored per page in the browser (`localStorage`). Each page, and each browser or OBS source, therefore needs to be configured once.

### 4. Use it in OBS

Add a **Browser Source** pointing at one of the URLs above, with a 1920×1080 size. Configure it through OBS's "Interact" window on the source. Settings are stored in the browser profile that OBS uses, so setting them in a regular browser will not carry over. Close the settings panel before going live.

## Spreadsheet layout

**Leaderboard tabs** (Premier, Rising Group A/B). Standings are read from a block with these columns, in this order:

```
Rank | Team | W | - | L | GW | GL | GD
```

- Premier finds the header by locating the `W - L` cell (or `GW` as a fallback) and reads the columns around it.
- Rising ignores header text and starts at the first row with a numeric rank, a name and numeric W, L, GW, GL and GD.
- Reading stops at the first row with no rank or no team name. Extra columns to the left or right (for example tiebreak helper tables) are ignored.

**Schedule tab.** Data is read starting from a cell containing the word `SCHEDULE`. Each match row below it uses five consecutive columns starting at that cell's column:

```
Match ID | Division / Group | Player 1 | Time | Player 2
```

- Rows missing any of the five fields (such as a "Week 1 Day 1" label row) are skipped.
- Only the first **four** valid rows are displayed, one per box. A blank row after the data ends the list.
- A division containing "Premier" shows Best-of-5 and one containing "Rising" shows Best-of-3.
- Times like `20:00:00` are shown as `20:00`. Names like `2nd Seed` render with a superscript ordinal.

A sample workbook with these layouts is in `sac/CTVS.xlsx`.

## Project structure

```
.
├── app.js                  # Express static server (port 3000)
├── package.json
├── public/
│   ├── premier/            # Premier Division leaderboard (index.html, style.css, script.js, fonts/)
│   ├── rising/             # Rising Division, two-group leaderboard
│   └── schedule/           # Match schedule
└── sac/                    # Working files, not served: sample workbook (CTVS.xlsx),
                            # design mock-ups, and an older copy of the schedule page
```

`sac/` is listed in `.gitignore`.

## Troubleshooting

| Message / symptom | Likely cause |
|-------------------|--------------|
| `Sheet request failed (4xx). Check sharing settings & tab name.` | The sheet is not shared as "Anyone with the link", or the tab name does not exactly match. |
| `Could not find the "W - L" column header` / `Could not find standings rows` | The tab does not follow the leaderboard layout above. |
| `Could not find a "SCHEDULE" label in the sheet.` | No cell on the schedule tab contains `SCHEDULE`. |
| Page is blank and the settings panel is open | No sheet configured yet. Enter the URL and save. |
| Changes in the sheet appear late | Google caches exports briefly; lower the refresh interval (minimum 3 s). |

## License

No license is specified for the code. The bundled Montserrat and Source Code Pro fonts are under the SIL OFL 1.1. Name Smile is non-commercial only (see above).
