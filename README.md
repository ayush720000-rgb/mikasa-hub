<div align="center">

![Mikasa Hub](https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,12,20,27&height=220&section=header&text=Mikasa%20Hub&fontSize=72&fontColor=ffffff&animation=fadeIn&fontAlignY=36)

<img src="apps/chess/docs/avatar.webp" width="140" alt="Mikasa" />

#### 𝓜𝓲𝓴𝓪𝓼𝓪 𝓗𝓾𝓫 · three games, one bot family

![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&size=22&duration=3000&pause=1000&color=FF6B9D&center=true&vCenter=true&width=700&lines=Chess+%E2%99%9E+Ludo+%F0%9F%8E%B2+UNO+%F0%9F%83%8F;Real-time+multiplayer+in+Telegram;One+Render+service%2C+three+bots)

<p>
  <a href="https://t.me/Ig_MikasaBot"><img src="https://img.shields.io/badge/Telegram-@Ig__MikasaBot-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram bot" /></a>
  <a href="https://t.me/Ig_MikasaBot/Chess"><img src="https://img.shields.io/badge/♞%20Play%20Chess-F7B733?style=for-the-badge&logoColor=111" alt="Play Chess" /></a>
  <a href="https://t.me/Ig_MikasaBot/ludo"><img src="https://img.shields.io/badge/🎲%20Play%20Ludo-FF6B9D?style=for-the-badge&logoColor=white" alt="Play Ludo" /></a>
  <a href="https://t.me/Ig_MikasaBot?startgroup=true"><img src="https://img.shields.io/badge/🃏%20Add%20UNO%20to%20Group-FF4D4D?style=for-the-badge&logoColor=white" alt="Add UNO to a group" /></a>
</p>

![Node](https://img.shields.io/badge/Node-22-339933?style=flat-square&logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-Vite-61DAFB?style=flat-square&logo=react&logoColor=black)
![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=flat-square&logo=python&logoColor=white)
![Postgres](https://img.shields.io/badge/Neon-Postgres-00E599?style=flat-square&logo=postgresql&logoColor=black)
![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?style=flat-square&logo=render&logoColor=black)

</div>

---

## 🎮 The games

<table align="center">
  <tr>
    <td align="center" width="33%">
      <a href="apps/chess"><img src="assets/readme/chess-banner.jpg" width="260" alt="Mikasa Chess" /></a>
      <h3>♞ Chess</h3>
      Real-time multiplayer chess<br/>with lobbies, spectators and chat.<br/><br/>
      <a href="https://t.me/Ig_MikasaBot/Chess"><img src="https://img.shields.io/badge/Open-Chess-F7B733?style=flat-square&logoColor=111" alt="Open Chess" /></a>
    </td>
    <td align="center" width="33%">
      <a href="apps/ludo"><img src="apps/ludo/public/assets/mikasa-mascot.jpg" width="260" alt="Mikasa Ludo" /></a>
      <h3>🎲 Ludo</h3>
      Live Ludo rooms with fair<br/>server-side dice and victory images.<br/><br/>
      <a href="https://t.me/Ig_MikasaBot/ludo"><img src="https://img.shields.io/badge/Open-Ludo-FF6B9D?style=flat-square&logoColor=white" alt="Open Ludo" /></a>
    </td>
    <td align="center" width="33%">
      <a href="apps/uno"><img src="assets/readme/uno-banner.svg" width="260" alt="Mikasa UNO" /></a>
      <h3>🃏 UNO</h3>
      Play UNO in any group chat<br/>with classic, fast and wild modes.<br/><br/>
      <a href="https://t.me/Ig_MikasaBot?startgroup=true"><img src="https://img.shields.io/badge/Add-to%20Group-FF4D4D?style=flat-square&logoColor=white" alt="Add UNO to a group" /></a>
    </td>
  </tr>
</table>

---

## 🧩 Projects

| | App | What it is | Stack | Path |
|:-:|---|---|---|---|
| ♞ | **[Chess](apps/chess)** | Multiplayer Mini App with lobbies, spectators, draw offers and a built-in bot | React · Socket.IO · Express | `/chess/` |
| 🎲 | **[Ludo](apps/ludo)** | Multiplayer Mini App with fair dice, turn timer, chat and match history | React · WebSocket · Express | `/ludo/` |
| 🃏 | **[UNO](apps/uno)** | Group-chat card game played through inline mode | Python 3.14 · python-telegram-bot 22 | `/uno/` |

A small **gateway** (`gateway/gateway.mjs`) runs all three on one Render port. It strips the path prefix, forwards HTTP and WebSocket traffic, and restarts any app that crashes. **A crashed bot never takes the others down.**

---

## 🚀 Deploy

<details>
<summary><b>Step-by-step deploy on Render (click to expand)</b></summary>

<br/>

1. **Create three bots** with [@BotFather](https://t.me/BotFather), one per app. Each needs its own token.
2. **Set the Mini App URLs** in BotFather:
   - Chess bot: `https://<your-service>.onrender.com/chess`
   - Ludo bot: `https://<your-service>.onrender.com/ludo`
3. **Create the service:** Render → **New → Blueprint** → pick this repo.
4. **Fill in the variables:**

| Variable | Value |
|---|---|
| `CHESS_BOT_TOKEN` | Chess bot token |
| `CHESS_BOT_USERNAME` | Chess bot handle, without `@` |
| `LUDO_BOT_TOKEN` | Ludo bot token |
| `LUDO_BOT_USERNAME` | Ludo bot handle, without `@` |
| `UNO_BOT_TOKEN` | UNO bot token |
| `MAIN_BOT_USERNAME` | Handle the "Main Bot" button opens (default `Ig_MikasaBot`) |
| `DATABASE_URL` | Neon Postgres connection string (`?sslmode=require`) |
| `CHESS_MINIAPP_SHORT_NAME` | Optional, default `Chess` |
| `LUDO_MINIAPP_SHORT_NAME` | Optional, default `ludo` |
| `IDENTITY_SECRET` | Optional. Signs player identity tokens for Chess and Ludo. Defaults to each app's bot token. Set it to rotate every player token at once. |

5. **Deploy** with **Manual Deploy → Clear build cache & deploy**. Clear the cache on the first deploy and after any dependency change.

If a token is missing, only that bot is disabled. The others keep running.

</details>

<details>
<summary><b>Database, endpoints and stability rules</b></summary>

<br/>

**Database (Neon Postgres).** Ludo stores profiles, match history and chat in `app_state`. UNO stores stats and settings in tables that Pony ORM creates on first start. Chess keeps its match history in the `chess_match_records` table, written by the server when a game ends, so players cannot edit their own results. Live Chess rooms stay in memory. If `DATABASE_URL` is empty or unreachable at start-up, Ludo and UNO fall back to local files and log a warning, and Chess history is kept in memory only. Those files and that memory are lost on redeploy, so check the logs after each deploy.

**Memory limits.** The free instance has 512 MB for all four processes, so each game server cleans up after itself. Chess and Ludo remove finished games after 2 hours, games with nobody connected after 1 hour, and any game after 12 to 24 hours. Each server holds at most 1000 games at once and refuses new ones beyond that with a "server is full" message. Names, chat text, avatars and game settings from players are length-checked before they are stored, WebSocket messages over 1 MB are rejected, and a malformed message is logged and ignored instead of crashing the server. Saved match history in Postgres is not affected by any of this. Errors are logged with bot tokens and secrets removed.

**Endpoints.**

| Route | Returns |
|---|---|
| `GET /` | Status page |
| `GET /health` | JSON with each app's state and restart count (Render health check) |
| `/chess/*`, `/ludo/*`, `/uno/health` | The apps |

**Rules that keep it stable.**
- Each bot needs its own token. Two services polling one token cause Telegram error **409**.
- Keep the free tier awake with an UptimeRobot monitor on `/health`.
- Python 3.14 is the tested version (the Dockerfile's `PYTHON_VERSION` build argument). UNO supports 3.10 to 3.14, so a change of version is a build argument, not a code change.

</details>

<details>
<summary><b>Local run</b></summary>

<br/>

```bash
cd apps/chess && npm ci && APP_BASE=/chess npm run build && cd ../..
cd apps/ludo  && npm ci && APP_BASE=/ludo  npm run build && cd ../..
uv venv --python 3.14 /opt/venv && uv pip install --python /opt/venv/bin/python -r apps/uno/requirements.txt

PYTHON=/opt/venv/bin/python PORT=10000 \
  CHESS_BOT_TOKEN=... LUDO_BOT_TOKEN=... UNO_BOT_TOKEN=... \
  node gateway/gateway.mjs
```

</details>

---

## 💾 Persistence on the free plan

Render's free filesystem resets on every deploy and restart. Without a database, this affects Ludo profiles and match history, UNO stats, and live Chess rooms (held in memory). With `DATABASE_URL` set to Neon, Ludo, UNO and Chess match history survive redeploys. Live Chess rooms are always in memory.

---

## 🔧 Changes made to the original apps

- **Client (Chess, Ludo):** every root-absolute URL goes through `appPath()` in `src/utils/basePath.ts`, and Vite `base` is set from `APP_BASE`.
- **Server (Chess, Ludo):** server-generated paths carry `APP_BASE`.
- **UNO:** `/help` is an ephemeral command in groups (Bot API 10.3: only the sender and the bot see the guide), the guide image is removed, and `/start help` deep links work.
- **Ludo:** new Telegram bot (`server/telegramBot.ts`) and the `telegraf` dependency.
- **Housekeeping:** removed stale per-app deploy guides, an unused AI Studio manifest and committed runtime data. Added a root `.gitignore`.

---

## 📁 Repository layout

```text
MikasaHub/
├── gateway/gateway.mjs      # one port, three apps, auto-restart
├── apps/
│   ├── chess/               # React + Socket.IO Mini App and bot
│   ├── ludo/                # React + WebSocket Mini App and bot
│   └── uno/                 # Python group-chat bot
├── assets/readme/           # images used by this README
├── Dockerfile · render.yaml # one-click Render Blueprint
└── README.md
```

---

<div align="center">

**Good moves · Fair dice · Dealt with care**

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,12,20,27&height=120&section=footer" width="100%" alt="footer" />

*Made with 🖤 for Mikasa's friends*

</div>
