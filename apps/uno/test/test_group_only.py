"""DM replies for group-only commands.

bot.py starts the Telegram connection when it is imported, so these tests read the
functions from its source instead of importing the module.
"""
import ast
import os
import sys
import unittest
from unittest.mock import MagicMock

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, ROOT)
os.environ.setdefault('TOKEN', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef')
os.environ.setdefault('PORT', '')

from smallcaps import themed  # noqa: E402
from fmt import warn  # noqa: E402

with open(os.path.join(ROOT, 'bot.py'), encoding='utf-8') as f:
    SOURCE = f.read()
TREE = ast.parse(SOURCE)
FUNCS = {n.name: n for n in TREE.body if isinstance(n, ast.FunctionDef)}

# Group-only commands and the handler each one belongs to
GROUP_ONLY = ['new_game', 'kill_game', 'join_game', 'kick_player', 'force_start',
              'close_game', 'open_game', 'skip_player', 'leave_game']


def _load_helper():
    node = FUNCS['_group_only']
    module = ast.Module(body=[node], type_ignores=[])
    namespace = {'warn': warn, 'themed': themed, 'Update': object,
                 'CallbackContext': object, 'send_async': MagicMock()}
    exec(compile(module, 'bot.py', 'exec'), namespace)
    return namespace


class GroupOnlyReplyTests(unittest.TestCase):
    def test_reply_is_a_warning_with_title_and_body(self):
        ns = _load_helper()
        update = MagicMock()
        update.message.chat_id = 42
        update.message.message_id = 7
        context = MagicMock()
        ns['_group_only'](update, context, 'Join a game in a group', 'Send /join in the group.')
        args, kwargs = ns['send_async'].call_args
        self.assertEqual(args[0], context.bot)
        self.assertEqual(args[1], 42)
        self.assertEqual(kwargs['reply_to_message_id'], 7)
        text = kwargs['text']
        self.assertIn('⚠️', text)
        self.assertIn('<blockquote>', text)
        self.assertIn('ᴊᴏɪɴ', text)          # title is in small caps
        self.assertIn('/join', text)          # the command itself stays readable

    def test_every_group_only_handler_checks_for_private_chat_first(self):
        """Each handler has an `if chat is private:` branch that calls _group_only."""
        for name in GROUP_ONLY:
            with self.subTest(handler=name):
                found = False
                for node in ast.walk(FUNCS[name]):
                    if not isinstance(node, ast.If):
                        continue
                    test_src = ast.get_source_segment(SOURCE, node.test) or ''
                    body_src = ''.join(ast.get_source_segment(SOURCE, b) or '' for b in node.body)
                    if "chat.type == 'private'" in test_src and '_group_only(' in body_src:
                        found = True
                self.assertTrue(found, 'no private-chat check calling _group_only in ' + name)

    def test_no_handler_sends_the_guide_to_a_private_group_command(self):
        for name in GROUP_ONLY:
            with self.subTest(handler=name):
                self.assertNotIn('help_handler(', ast.get_source_segment(SOURCE, FUNCS[name]))


if __name__ == '__main__':
    unittest.main()
