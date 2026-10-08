const { test } = require('node:test');
const assert = require('node:assert');
const { parseCsv, col, parseData } = require('../src/csv');
const { emailAmmessa } = require('../src/auth');

test('parseCsv: virgolette, a capo, separatore ; e BOM', () => {
  const r = parseCsv('﻿a;b\r\n"x;1";"riga\n2"\r\n;"""q"""\r\n');
  assert.deepStrictEqual(r, [{ a: 'x;1', b: 'riga\n2' }, { a: '', b: '"q"' }]);
  assert.deepStrictEqual(parseCsv('a,b\n1,2'), [{ a: '1', b: '2' }]);
  assert.deepStrictEqual(parseCsv(''), []);
});

test('col: nomi flessibili', () => {
  assert.strictEqual(col({ 'Email Address [Required]': 'x@y' }, 'Email Address'), 'x@y');
});

test('parseData', () => {
  assert.strictEqual(parseData('2026-10-08'), '2026-10-08');
  assert.strictEqual(parseData('08/10/2026', 'dmy'), '2026-10-08');
  assert.strictEqual(parseData('10/08/2026 14:30', 'mdy'), '2026-10-08 14:30');
  assert.strictEqual(parseData('25/12/2026 09:05', 'mdy'), '2026-12-25 09:05'); // non ambigua
  assert.strictEqual(parseData('31/02/2026'), null);
  assert.strictEqual(parseData('boh'), null);
});

test('login: solo domini della stessa Workspace', () => {
  const ok = (email, hd) => emailAmmessa({ email, email_verified: true, hd });
  assert.ok(ok('a@terre.it', 'terre.it'));
  assert.ok(ok('a@leparolecheservono.it', 'leparolecheservono.it'));
  assert.ok(ok('a@falacosagiusta.org', 'terre.it'));
  assert.ok(!ok('a@gmail.com', undefined));
  assert.ok(!ok('a@terre.it', undefined));
  assert.ok(!ok('a@evil.it', 'evil.it'));
  assert.ok(!emailAmmessa({ email: 'a@terre.it', email_verified: false, hd: 'terre.it' }));
});
