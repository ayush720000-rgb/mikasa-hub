import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// storage.ts resolves data/ from the working directory, so run each case in its own temp folder.
async function loadFreshStorage(dir: string) {
  process.chdir(dir);
  const mod = await import(`../server/storage.ts?case=${Math.random()}`);
  return mod.storage as {
    init: () => Promise<void>;
    getOrCreateUser: (p: { id: string; name: string; isTelegram: boolean }) => { gamesPlayed: number };
    getUser: (id: string) => { name: string } | null;
    saveChat: (code: string, msgs: unknown[]) => void;
    getChat: (code: string) => unknown[];
    flush: () => Promise<void>;
  };
}

test('file storage persists a user and chat across restarts', async () => {
  const original = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-storage-'));
  delete process.env.DATABASE_URL;
  try {
    const first = await loadFreshStorage(dir);
    await first.init();
    first.getOrCreateUser({ id: '11', name: 'Persisted', isTelegram: true });
    first.saveChat('ROOM', [{ id: 'm', text: 'hi' }]);
    await first.flush();

    const second = await loadFreshStorage(dir);
    await second.init();
    assert.equal(second.getUser('11')?.name, 'Persisted');
    assert.equal(second.getChat('ROOM').length, 1);
  } finally {
    process.chdir(original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable data file starts empty instead of crashing', async () => {
  const original = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-storage-bad-'));
  delete process.env.DATABASE_URL;
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'ludo-db.json'), '{not json');
  try {
    const store = await loadFreshStorage(dir);
    await store.init();
    assert.equal(store.getUser('anyone'), null);
  } finally {
    process.chdir(original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
