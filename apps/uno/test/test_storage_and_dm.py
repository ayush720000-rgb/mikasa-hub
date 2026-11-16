import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, ROOT)
os.environ.setdefault('TOKEN', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef')
os.environ.setdefault('UNO_DB', os.path.join(tempfile.mkdtemp(), 'test.sqlite3'))
os.environ.setdefault('PORT', '')

import database  # noqa: E402
import system_info  # noqa: E402


class FormatStorageTests(unittest.TestCase):
    def test_shows_used_limit_and_percent(self):
        used = int(8.3 * 1024 * 1024)
        self.assertEqual(system_info.format_storage(used, limit_mb=512), '8.3 / 512 MB (1.6%)')

    def test_default_limit_is_1_gb(self):
        if 'STORAGE_LIMIT_MB' in os.environ:
            self.skipTest('STORAGE_LIMIT_MB is set in this environment')
        self.assertEqual(system_info.STORAGE_LIMIT_MB, 1024)
        self.assertEqual(system_info.format_storage(int(8.3 * 1024 * 1024)), '8.3 / 1024 MB (0.8%)')

    def test_unknown_size_is_na(self):
        self.assertEqual(system_info.format_storage(None), 'n/a')

    def test_render_status_has_storage_line_last(self):
        text = system_info.render_status('UnoTestBot', 3600, 10.0, 5.0, 20.0, 1.0,
                                         storage='8.3 / 512 MB (1.6%)')
        lines = text.splitlines()
        self.assertTrue(lines[-1].endswith(': 8.3 / 512 MB (1.6%)'))
        self.assertIn('𝖲𝗍𝗈𝗋𝖺𝗀𝖾', lines[-1])

    def test_render_status_without_storage_shows_na(self):
        text = system_info.render_status('UnoTestBot', 0, None, None, None, None)
        self.assertTrue(text.splitlines()[-1].endswith(': n/a'))


class DatabaseSizeTests(unittest.TestCase):
    def test_sqlite_size_counts_database_and_wal_files(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, 'x.sqlite3')
        with open(path, 'wb') as f:
            f.write(b'a' * 1000)
        with open(path + '-wal', 'wb') as f:
            f.write(b'b' * 500)
        with patch.object(database, '_postgres_in_use', None), \
             patch.object(database, '_sqlite_file', path):
            self.assertEqual(database.database_size_bytes(), 1500)

    def test_no_database_bound_is_zero(self):
        with patch.object(database, '_postgres_in_use', None), \
             patch.object(database, '_sqlite_file', None):
            self.assertEqual(database.database_size_bytes(), 0)

    def test_postgres_size_comes_from_server(self):
        cur = MagicMock()
        cur.fetchone.return_value = (9_000_000,)
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        kwargs = {'user': 'u', 'password': 'p', 'host': 'h', 'port': 5432,
                  'database': 'd', 'sslmode': 'require'}
        with patch.object(database, '_postgres_in_use', kwargs), \
             patch.object(database.psycopg2, 'connect', return_value=conn) as connect:
            self.assertEqual(database.database_size_bytes(), 9_000_000)
        cur.execute.assert_called_once_with('SELECT pg_database_size(current_database())')
        conn.close.assert_called_once()
        self.assertEqual(connect.call_args.kwargs['host'], 'h')


class StorageCacheTests(unittest.TestCase):
    def setUp(self):
        import simple_commands
        self.sc = simple_commands
        self.sc._storage_cache.update(at=None, text=None)

    def test_repeated_pings_reuse_one_database_lookup(self):
        with patch.object(self.sc, 'database_size_bytes', return_value=5 * 1024 * 1024) as size:
            first = self.sc._storage_text()
            second = self.sc._storage_text()
        self.assertEqual(first, second)
        self.assertIn('5.0 /', first)
        size.assert_called_once()

    def test_lookup_runs_again_after_the_cache_expires(self):
        with patch.object(self.sc, 'database_size_bytes', return_value=1024 * 1024) as size:
            self.sc._storage_text()
            self.sc._storage_cache['at'] -= self.sc._STORAGE_CACHE_SECONDS + 1
            self.sc._storage_text()
        self.assertEqual(size.call_count, 2)

    def test_database_failure_gives_none_and_is_also_cached(self):
        with patch.object(self.sc, 'database_size_bytes', side_effect=RuntimeError('db down')) as size:
            self.assertIsNone(self.sc._storage_text())
            self.assertIsNone(self.sc._storage_text())
        size.assert_called_once()


if __name__ == '__main__':
    unittest.main()
