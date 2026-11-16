#!/usr/bin/env python3
# -*- coding: utf-8 -*-


import logging
import os
from urllib.parse import urlparse, parse_qs, unquote

import psycopg2
from pony.orm import Database

logger = logging.getLogger(__name__)

# Database singleton
db = Database()

# Where the data lives, so /ping can report its size. Set by bind_database().
_postgres_in_use = None   # psycopg2 kwargs when bound to Postgres
_sqlite_file = None       # path of the local SQLite file otherwise


def _as_bool(value, default):
    if value is None:
        return default
    return str(value).strip().lower() in ("yes", "true", "t", "1", "on")


def _postgres_kwargs(url):
    """Turn a postgres:// URL (e.g. Neon) into keyword arguments for psycopg2."""
    parts = urlparse(url)
    query = parse_qs(parts.query)
    kwargs = {
        'user': unquote(parts.username or ''),
        'password': unquote(parts.password or ''),
        'host': parts.hostname or query.get('host', [None])[0],
        'port': parts.port or 5432,
        'database': parts.path.lstrip('/'),
        'sslmode': query.get('sslmode', ['require'])[0],
    }
    return kwargs


def bind_database():
    """Use Postgres when DATABASE_URL is set and reachable, otherwise the local SQLite file.

    The connection is tested before binding because Pony cannot be bound twice.
    """
    global _postgres_in_use, _sqlite_file
    url = os.getenv('DATABASE_URL', '').strip()
    if url:
        try:
            kwargs = _postgres_kwargs(url)
            psycopg2.connect(connect_timeout=10, **kwargs).close()
            db.bind('postgres', **kwargs)
            _postgres_in_use = kwargs
            logger.info('Using Postgres (DATABASE_URL).')
            return
        except (psycopg2.Error, OSError, ValueError) as e:
            if _as_bool(os.getenv('UNO_REQUIRE_DATABASE'), False):
                raise RuntimeError(f'Postgres unavailable and UNO_REQUIRE_DATABASE is set: {e}') from e
            logger.error('Postgres unavailable, falling back to SQLite: %s', e)

    db_file = os.getenv('UNO_DB', 'uno.sqlite3')
    db.bind('sqlite', db_file, create_db=True)
    _sqlite_file = db_file
    logger.warning(
        'Using local SQLite at %s. Stats and settings are lost on every redeploy when this '
        'filesystem is ephemeral (Render free plan). Set DATABASE_URL to keep them.', db_file)


def database_size_bytes():
    """Bytes used by the bot's data: the whole Postgres database, or the local SQLite files.

    Raises an exception if Postgres cannot be reached. The caller decides what to show.
    """
    if _postgres_in_use is not None:
        conn = psycopg2.connect(connect_timeout=5, **_postgres_in_use)
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT pg_database_size(current_database())')
                return int(cur.fetchone()[0])
        finally:
            conn.close()
    if not _sqlite_file:
        return 0
    total = 0
    for path in (_sqlite_file, _sqlite_file + '-wal', _sqlite_file + '-shm', _sqlite_file + '-journal'):
        if os.path.exists(path):
            total += os.path.getsize(path)
    return total
