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
- Each page fetches its Google Sheet tab as CSV (`https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&sheet=<TAB>`), parses it in the browser, and re-renders every N seconds.
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

**Fonts** (bundled in `fonts/` folder, no install needed)

- Montserrat and Source Code Pro (SIL Open Font License)
- Name Smile: licensed for **non-commercial use only**. See `public/assets/fonts/name_smile/` for the license and a link to buy a commercial one.

## Installation

```bash
# 1. Get the code (unzip the archive or clone the repo) and enter the folder
cd "CTVS Web Graphics Display"

# 2. Install dependencies
npm install
```

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

Settings are stored per page in the browser (`localStorage`). Each page, and each browser or OBS source, therefore needs to be configured once.

### 4. Use it in OBS

Add a **Browser Source** pointing at one of the URLs above, with a 1920×1080 size. Configure it through OBS's "Interact" window on the source. Settings are stored in the browser profile that OBS uses, so setting them in a regular browser will not carry over. Close the settings panel before going live.

## Project structure

```
.
├── app.js                  # Express static server (port 3000)
├── package.json
└── public/
    ├── assets/
    │   └── fonts/          # Folder containing all fonts used in the project
    ├── premier/            # Premier Division leaderboard
    ├── rising/             # Rising Division, two-group leaderboard
    └── schedule/           # Match schedule
```

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
