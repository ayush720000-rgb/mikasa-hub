#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Startup sequence. Besides polling for updates this also makes the bot happy on
# hosts like Render:
#   * a tiny HTTP server on $PORT (web services must listen on a port)
#   * the command menu is set automatically from commandlist.txt

import logging
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import asyncio

from telegram import BotCommand
from telegram.error import TelegramError

import bridge

# Commands whose replies are ephemeral in groups (only the sender sees them).
EPHEMERAL_COMMANDS = {"help", "guide"}

from config import PORT, SMALL_CAPS
from smallcaps import small_caps

logger = logging.getLogger(__name__)


class _HealthHandler(BaseHTTPRequestHandler):
    def _respond(self, body=True):
        payload = b"UNO bot is running"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if body:
            self.wfile.write(payload)

    def do_GET(self):
        self._respond()

    def do_HEAD(self):
        self._respond(body=False)

    def log_message(self, *args):  # keep the logs clean
        pass


def _serve_health(port):
    try:
        server = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
        logger.info("Health server listening on 0.0.0.0:%s", port)
        server.serve_forever()
    except OSError:  # port already in use or not bindable
        logger.exception("Health server crashed")


def _set_command_menu(bot):
    """Fill the Telegram command menu from commandlist.txt (no BotFather needed)"""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "commandlist.txt")
    try:
        commands = []
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                if " - " not in line:
                    continue
                name, description = line.split(" - ", 1)
                description = description.strip()
                if SMALL_CAPS:
                    description = small_caps(description)
                commands.append(BotCommand(name.strip(), description[:256]))
        # Bot API 10.3: ephemeral commands are seen only by the sender and the bot in groups.
        # PTB has no is_ephemeral field yet, so it is passed through api_kwargs.
        commands = [BotCommand(c.command, c.description,
                               api_kwargs={"is_ephemeral": c.command in EPHEMERAL_COMMANDS})
                    for c in commands]
        bot.setMyCommands(commands)
        logger.info("Command menu set (%d commands)", len(commands))
    except (OSError, TelegramError):
        logger.exception("Could not set the command menu")


async def post_init(application):
    """Runs on the event loop before polling starts (see shared_vars)."""
    bridge.set_loop(asyncio.get_running_loop())
    await asyncio.to_thread(_set_command_menu, bridge.sync_bot_for(application.bot))

    if PORT:
        threading.Thread(target=_serve_health, args=(int(PORT),),
                         daemon=True).start()



def start_bot(application):
    # Updates that piled up while the bot was offline are dropped, so players
    # don't get a flood of old commands after a restart.
    application.run_polling(drop_pending_updates=True)
