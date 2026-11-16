<div align="center">

![Mikasa UNO](https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=1,8,15&height=200&section=header&text=Mikasa%20UNO&fontSize=64&fontColor=ffffff&animation=fadeIn)

#### 𝕸𝖎𝖐𝖆𝖘𝖆 𝖀𝖓𝖔

![Typing SVG](https://readme-typing-svg.demolab.com?font=Righteous&size=26&duration=3000&pause=1000&color=FF4D4D&center=true&vCenter=true&width=640&lines=UNO+in+any+group+chat;Type+%40Ig_MikasaBot+and+pick+a+card;Classic%2C+fast+and+wild+modes)

[![Telegram](https://img.shields.io/badge/Telegram-@Ig__MikasaBot-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/Ig_MikasaBot)
[![Add to Group](https://img.shields.io/badge/🃏%20Add%20to%20Group-Start%20a%20game-FF4D4D?style=for-the-badge&logoColor=white)](https://t.me/Ig_MikasaBot?startgroup=true)
![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python&logoColor=white)

</div>

---

## 🃏 About

Mikasa UNO is a Telegram bot that lets you play UNO in group chats. Games run through inline mode, so anyone in the group can join a table and play their cards without leaving the chat.

All messages are shown in ꜱᴍᴀʟʟ ᴄᴀᴘꜱ by default (switch off with `SMALL_CAPS=false`).

## ✨ Features

- **Plays in group chats.** Add the bot to a group and start a table.
- **Inline play.** Type `@Ig_MikasaBot` to pick your cards from the chat.
- **Three game modes.** `classic`, `fast` and `wild`, set with `DEFAULT_GAMEMODE` and explained by `/modes`.
- **Stats.** `/stats` keeps your record in Postgres (Neon) when `DATABASE_URL` is set, otherwise in a local SQLite file.
- **Admin control.** Set `ADMIN_LIST` to let specific users manage every game.

## 🚀 Setup with @BotFather

1. `/newbot` and copy the **token**.
2. `/setinline` and choose a placeholder, for example `Pick a card`.
3. `/setinlinefeedback` and choose **Enabled** (100%).

Steps 2 and 3 are required because the game is played through inline mode. The command menu is set automatically by the bot.

## ☁️ Deploy on Render

UNO is deployed as part of the **Mikasa bots** Render service (one service for Chess, Ludo and UNO). See the hub's [README](../README.md) for the steps. Set `UNO_BOT_TOKEN` there.

UNO supports **Python 3.10 to 3.14**; every pinned dependency declares that range. The Docker image installs **Python 3.14.6** with `uv` (set by the `PYTHON_VERSION` build argument in the hub Dockerfile), so Render never depends on a platform default. Change that argument to test another version.

When the logs show `Command menu set`, open **[@Ig_MikasaBot](https://t.me/Ig_MikasaBot)** and send `/start`.

### Free plan notes

- Render sleeps free web services after 15 minutes without traffic. Add a free [UptimeRobot](https://uptimerobot.com) monitor for `https://YOUR-SERVICE.onrender.com/health` every 5 minutes to keep it awake.
- Without `DATABASE_URL`, `/stats` data goes to a local SQLite file on the container disk. The free filesystem resets on every redeploy, so that data is lost. Set `DATABASE_URL` to a Neon Postgres database to keep it. Games live in memory anyway.
- To refuse to start instead of silently using SQLite, set `UNO_REQUIRE_DATABASE=true`.

## ⚙️ Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `TOKEN` | required | Bot token from @BotFather |
| `ADMIN_LIST` | none | Telegram user IDs (spaces or commas) who can manage every game |
| `SMALL_CAPS` | `true` | ꜱᴍᴀʟʟ ᴄᴀᴘꜱ text on or off |
| `DEFAULT_GAMEMODE` | `fast` | `classic`, `fast` or `wild` |
| `WAITING_TIME` | `120` | Seconds a player has per turn |
| `MIN_PLAYERS` | `2` | Players needed to start |
| `OPEN_LOBBY` | `true` | Whether new players can join a running game |
| `DATABASE_URL` | none | Neon Postgres connection string (`?sslmode=require`). Without it, stats go to local SQLite. |
| `UNO_REQUIRE_DATABASE` | `false` | `true` makes the bot refuse to start if Postgres is unreachable, rather than fall back to SQLite |
| `CARD_PACK` | `classic_colorblind` | Sticker pack to use. Available packs are the keys of `CARD_PACKS` in `card.py`. Unknown names fall back to the default with a warning. |
| `STORAGE_LIMIT_MB` | `1024` | Storage limit shown on the `Storage` line of `/ping`. Set it to your Neon plan's limit. It is only a label: the database cannot report its plan limit, but the used size is measured from the database. |

`config.json` (see `config.json.example`) still works for local runs.

## 🧪 Run locally

```bash
uv venv --python 3.14 venv && source venv/bin/activate
pip install -r requirements.txt
TOKEN=123:abc python bot.py
```

---

<div align="center">

*Shuffle up and deal.*

</div>
