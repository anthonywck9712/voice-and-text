import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dictationSpeech } from '../lib/spoken-punctuation.ts';

await test('dictation names common marks using British classroom terms', () => {
  assert.equal(dictationSpeech('Hello, class.'), 'Hello comma class full stop');
  assert.equal(
    dictationSpeech('Ready? Yes! Bring: pens; paper (lined) [A] {B}.'),
    'Ready question mark Yes exclamation mark Bring colon pens semicolon paper open bracket lined close bracket open square bracket A close square bracket open curly bracket B close curly bracket full stop',
  );
  assert.equal(
    dictationSpeech('Well-known — really… Wait... Yes--now?!'),
    'Well hyphen known dash really ellipsis Wait ellipsis Yes dash now question mark exclamation mark',
  );
});

await test('straight and curly quotes keep direction across phrase ranges', () => {
  for (const [open, close] of [['“', '”'], ['"', '"']]) {
    const source = `${open}Hello,\nclass.${close}`;
    const split = source.indexOf('class');
    assert.equal(dictationSpeech(source, 0, split), 'open quotation marks Hello comma');
    assert.equal(dictationSpeech(source, split), 'class full stop close quotation marks');
  }
  const source = '‘She said,\n“Go!”’';
  const split = source.indexOf('“');
  assert.equal(dictationSpeech(source, split), 'open quotation marks Go exclamation mark close quotation marks close single quotation marks');
});

await test('contractions and possessives retain their ordinary pronunciation', () => {
  assert.equal(
    dictationSpeech("Don't change James’s notes or students’ books. It’s his."),
    "Don't change James’s notes or students’ books full stop It’s his full stop",
  );
  assert.equal(
    dictationSpeech("'It's James’s book,' she said."),
    "open single quotation marks It's James’s book comma close single quotation marks she said full stop",
  );
  assert.equal(dictationSpeech("James' book from the '90s."), "James' book from the '90s full stop");
});

await test('numbers, titles, initialisms and times are not spelled as punctuation', () => {
  assert.equal(
    dictationSpeech('Dr. Wong and A. Chan arrived at 9:30 a.m. from the U.S. They paid $1,250.50, then .5 more.'),
    'Dr. Wong and A. Chan arrived at 9:30 a.m. from the U.S. They paid $1,250.50 comma then .5 more full stop',
  );
  const source = 'Use e.g. or U.S. and 3.14.';
  assert.equal(dictationSpeech(source, source.indexOf('S.')), 'S. and 3.14 full stop');
});

await test('URL and email internals are preserved but following prose marks are read', () => {
  assert.equal(
    dictationSpeech('Visit https://school.edu.hk/help?step=1, then email teacher.name@example.com.'),
    'Visit https://school.edu.hk/help?step=1 comma then email teacher.name@example.com full stop',
  );
  assert.equal(
    dictationSpeech('(https://example.com/wiki/Topic_(name)). Visit www.example.com; or school.edu.hk.'),
    'open bracket https://example.com/wiki/Topic_(name) close bracket full stop Visit www.example.com semicolon or school.edu.hk full stop',
  );
});

await test('subchunk ranges use original positions without changing source text', () => {
  const source = '  “First, second.\nThird!”  ';
  const original = source;
  const split = source.indexOf('second');
  assert.equal(
    [dictationSpeech(source, 0, split), dictationSpeech(source, split)].join(' '),
    dictationSpeech(source),
  );
  assert.equal(source, original);
  assert.equal(source.slice(split, split + 7), 'second.');
  assert.equal(dictationSpeech(source, split, split + 7), 'second full stop');
  assert.equal(dictationSpeech(source, split, split), '');
  assert.equal(dictationSpeech(''), '');
  for (const [offset, end] of [[-1, 1], [2, 1], [0, 100], [0.5, 1], [0, NaN]])
    assert.throws(() => dictationSpeech(source, offset, end), RangeError);
});

await test('ellipsis and double-hyphen subchunk continuations are not announced twice', () => {
  assert.equal(dictationSpeech('Wait... now', 0, 5), 'Wait ellipsis');
  assert.equal(dictationSpeech('Wait... now', 5), 'now');
  assert.equal(dictationSpeech('Go--now', 0, 3), 'Go dash');
  assert.equal(dictationSpeech('Go--now', 3), 'now');
});
