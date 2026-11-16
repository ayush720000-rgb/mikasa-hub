import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, isValidBotToken } from '../src/server/telegramBot';

test('escapeHtml protects names that would break HTML messages', () => {
  assert.equal(escapeHtml('A<b>&"x'), 'A&lt;b&gt;&amp;"x');
  assert.equal(escapeHtml('a_b*c'), 'a_b*c'); // Markdown characters are safe in HTML mode
});

test('isValidBotToken accepts the real format and rejects placeholders', () => {
  assert.equal(isValidBotToken('123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'), true);
  assert.equal(isValidBotToken('MY_TELEGRAM_BOT_TOKEN'), false);
  assert.equal(isValidBotToken('123:short'), false);
  assert.equal(isValidBotToken(undefined), false);
});
