const { test } = require('node:test');
const assert = require('node:assert');
const { addToast, removeToast } = require('./toasts.js');

test('addToast appends with id/type/message', () => {
  const list = addToast([], { type: 'success', message: 'done' }, 1);
  assert.deepStrictEqual(list, [{ id: 1, type: 'success', message: 'done' }]);
});

test('addToast keeps existing toasts', () => {
  const list = addToast([{ id: 1, type: 'info', message: 'a' }], { type: 'error', message: 'b' }, 2);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[1].id, 2);
});

test('removeToast filters by id', () => {
  const list = [{ id: 1, type: 'info', message: 'a' }, { id: 2, type: 'error', message: 'b' }];
  assert.deepStrictEqual(removeToast(list, 1), [{ id: 2, type: 'error', message: 'b' }]);
});

test('addToast defaults missing type to info', () => {
  const list = addToast([], { message: 'x' }, 5);
  assert.strictEqual(list[0].type, 'info');
});
