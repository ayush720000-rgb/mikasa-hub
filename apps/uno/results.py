#!/usr/bin/env python3
# -*- coding: utf-8 -*-


"""Defines helper functions to build the inline result list"""

from datetime import datetime

from smallcaps import themed
from uuid import uuid4

from telegram import InlineQueryResultArticle, InputTextMessageContent, \
    InlineQueryResultCachedSticker as Sticker

import card as c
from utils import display_color, display_color_group
from mentions import msg


def add_choose_color(results, game):
    """Add choose color options"""
    for color in c.COLORS:
        results.append(
            InlineQueryResultArticle(
                id=color,
                title=themed("Choose Color"),
                description=display_color(color),
                input_message_content=
                InputTextMessageContent(display_color_group(color, game))
            )
        )


def add_other_cards(player, results, game):
    """Add hand cards when choosing colors"""

    results.append(
        InlineQueryResultArticle(
            "hand",
            title=themed("Card (tap for game state):" if len(player.cards) == 1 else "Cards (tap for game state):"),
            description=', '.join([repr(card) for card in player.cards]),
            input_message_content=game_info(game)
        )
    )


def player_list(game):
    """One clickable mention per player, e.g. "Name (2 cards)" """
    return [msg(themed("{name} ({number} card)" if len(player.cards) == 1 else "{name} ({number} cards)"),
                name=player.user, number=len(player.cards))
            for player in game.players]


def add_no_game(results):
    """Add text result if user is not playing"""
    results.append(
        InlineQueryResultArticle(
            "nogame",
            title=themed("You are not playing"),
            input_message_content=
            InputTextMessageContent(themed('Not playing right now. Use /new to '
                                      'start a game or /join to join the '
                                      'current game in this group'))
        )
    )


def add_not_started(results):
    """Add text result if the game has not yet started"""
    results.append(
        InlineQueryResultArticle(
            "nogame",
            title=themed("The game wasn't started yet"),
            input_message_content=
            InputTextMessageContent(themed('Start the game with /start'))
        )
    )


def add_mode_classic(results):
    """Change mode to classic"""
    results.append(
        InlineQueryResultArticle(
            "mode_classic",
            title=themed("🎻 Classic mode"),
            input_message_content=
            InputTextMessageContent(themed('Classic 🎻'))
        )
    )


def add_mode_fast(results):
    """Change mode to classic"""
    results.append(
        InlineQueryResultArticle(
            "mode_fast",
            title=themed("🚀 Sanic mode"),
            input_message_content=
            InputTextMessageContent(themed('Gotta go fast! 🚀'))
        )
    )


def add_mode_wild(results):
    """Change mode to classic"""
    results.append(
        InlineQueryResultArticle(
            "mode_wild",
            title=themed("🐉 Wild mode"),
            input_message_content=
            InputTextMessageContent(themed('Into the Wild~ 🐉'))
        )
    )


def add_mode_text(results):
    """Change mode to text"""
    results.append(
        InlineQueryResultArticle(
            "mode_text",
            title=themed("✍️ Text mode"),
            input_message_content=
            InputTextMessageContent(themed('Text ✍️'))
        )
    )
    
    
def add_draw(player, results):
    """Add option to draw"""
    n = player.game.draw_counter or 1

    results.append(
        Sticker(
            "draw", sticker_file_id=c.STICKERS['option_draw'],
            input_message_content=
            InputTextMessageContent(('Drawing {number} card' if n == 1 else 'Drawing {number} cards')
                                    .format(number=n))
        )
    )


def add_gameinfo(game, results):
    """Add option to show game info"""

    results.append(
        Sticker(
            "gameinfo",
            sticker_file_id=c.STICKERS['option_info'],
            input_message_content=game_info(game)
        )
    )


def add_pass(results, game):
    """Add option to pass"""
    results.append(
        Sticker(
            "pass", sticker_file_id=c.STICKERS['option_pass'],
            input_message_content=InputTextMessageContent(
                'Pass'
            )
        )
    )


def add_call_bluff(results, game):
    """Add option to call a bluff"""
    results.append(
        Sticker(
            "call_bluff",
            sticker_file_id=c.STICKERS['option_bluff'],
            input_message_content=
            InputTextMessageContent("I'm calling your bluff!")
        )
    )


def add_card(game, card, results, can_play):
    """Add an option that represents a card"""

    if can_play:
        if game.mode != "text":
            results.append(
                Sticker(str(card), sticker_file_id=c.STICKERS[str(card)])
        )
        if game.mode == "text":
            results.append(
                Sticker(str(card), sticker_file_id=c.STICKERS[str(card)], input_message_content=InputTextMessageContent("Card Played: {card}".format(card=repr(card).replace('Draw Four', '+4').replace('Draw', '+2').replace('Colorchooser', 'Color Chooser')))
        ))
    else:
        results.append(
            Sticker(str(uuid4()), sticker_file_id=c.STICKERS_GREY[str(card)],
                    input_message_content=game_info(game))
        )


def game_status(game):
    """Status block: whose turn it is, the last card, and each player's card count.

    Used for the inline status result. Player names are clickable mentions (text_mention entities).
    """
    message = (msg(themed("🎯 Turn: {name}"), name=game.current_player.user)
               + "\n"
               + themed("🃏 Last: {card}").format(card=repr(game.last_card))
               + "\n\n"
               + themed("👥 Players"))
    for player in game.players:
        message = message + "\n" + msg("• {name} — " + str(len(player.cards)) + " 🃏", name=player.user)
    return message


def game_info(game):
    """Inline result text for the status block."""
    message = game_status(game)
    return InputTextMessageContent(message.text, entities=message.entities or None)


def _duration(game):
    if not game.started_at:
        return "00:00"
    seconds = int((datetime.now() - game.started_at).total_seconds())
    hours, rest = divmod(seconds, 3600)
    minutes, seconds = divmod(rest, 60)
    if hours:
        return "%d:%02d:%02d" % (hours, minutes, seconds)
    return "%02d:%02d" % (minutes, seconds)


_MEDALS = ["🥇", "🥈", "🥉"]


def _ordinal(number):
    if number == 1:
        return "1st"
    if number == 2:
        return "2nd"
    if number == 3:
        return "3rd"
    return "%dth" % number


def match_summary(game, ranking, ended_by=None):
    """Message posted when a match ends.

    ``ended_by`` is None for a finished match (winner and placements). Otherwise the match
    was ended by that user, and the message says so.
    """
    stats = (themed("⏱ Duration: {time}").format(time=_duration(game)) + "\n"
             + themed("🎮 Total turns: {turns}").format(turns=game.turns) + "\n"
             + themed("👥 Players: {count}").format(count=len(ranking)))

    if ended_by is None:
        message = (msg("🏆 UNO MATCH — FINISHED") + "\n\n"
                   + msg(themed("👑 Winner: {name}"), name=ranking[0]) + "\n\n"
                   + stats + "\n\n"
                   + themed("📊 Match summary") + "\n")
        for number, user in enumerate(ranking, start=1):
            medal = _MEDALS[number - 1] if number <= len(_MEDALS) else "▫️"
            message = (message + medal + " " + msg("{name} — " + _ordinal(number), name=user) + "\n")
        message = message + "\n" + "❤️ GG! Thanks for playing."
        return message

    return (msg("❌ Match Terminated") + "\n\n"
            + msg(themed("👤 Ended by: {name}"), name=ended_by) + "\n"
            + stats + "\n\n"
            + "🎴 Thanks for playing!")
