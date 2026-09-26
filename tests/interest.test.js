import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../js/interest.js';

const roster = I.parseRoster('TK 5107 Jason L Schuett\nSL 82518 Ryan L Toney\nTK 18999\n');
const shirt = { id: 's', name: 'Shirt', collectInterest: true };
const coin = { id: 'c', name: 'Coin', collectInterest: true, variant: 'Glow', price: '10' };
const closed = { id: 'x', name: 'Old', collectInterest: false };
const denied = { id: 'd', name: 'Nope', collectInterest: true, outcome: 'denied' };

test('roster parses prefix, number, optional name, and dedupes', () => {
  const r = I.parseRoster('TK 5107 Jason\ntk-5107 dupe\n82518 Ryan\nTB 77364\n\njunk line');
  assert.deepEqual(r, [
    { id: '5107', prefix: 'TK', name: 'Jason' },
    { id: '82518', prefix: '', name: 'Ryan' },
    { id: '77364', prefix: 'TB', name: '' },
  ]);
  assert.equal(I.memberLabel(r[2]), 'Private member (TB 77364)');
});

test('default roster loads when none is saved', () => {
  const r = I.activeRoster({ roster: null });
  assert.equal(r.length, 51);
  assert.ok(r.some((m) => m.id === '82518' && m.prefix === 'SL'));
});

test('roster search matches number, tag, and name', () => {
  assert.equal(I.searchRoster(roster, '5107')[0].id, '5107');
  assert.equal(I.searchRoster(roster, 'tk 5107')[0].id, '5107');
  assert.equal(I.searchRoster(roster, 'toney')[0].id, '82518');
  assert.equal(I.searchRoster(roster, 'ryan ton')[0].id, '82518');
  assert.equal(I.searchRoster(roster, '18999')[0].id, '18999');
  assert.deepEqual(I.searchRoster(roster, ''), []);
});

test('one box per item, or one per variant', () => {
  assert.deepEqual(I.choices(shirt).map((c) => c.key), ['|']);
  assert.deepEqual(I.choices(coin).map((c) => c.key), ['Standard|', 'Glow|']);
  assert.equal(I.choiceLabel('Glow|'), 'Glow');
  assert.equal(I.choiceLabel('|'), 'Quantity');
});

test('only ticked, live items collect interest', () => {
  assert.equal(I.isCollecting(shirt), true);
  assert.equal(I.isCollecting(closed), false);
  assert.equal(I.isCollecting(denied), false);
});

test('interest defaults on until produced, explicit choice wins', () => {
  assert.equal(I.isCollecting({}), true);
  assert.equal(I.isCollecting({ approved: '2026-03-09' }), true);
  assert.equal(I.isCollecting({ produced: '2026-04-01' }), false);
  assert.equal(I.isCollecting({ produced: '2026-04-01', collectInterest: true }), true);
  assert.equal(I.isCollecting({ collectInterest: false }), false);
  assert.equal(I.isCollecting({ outcome: 'withdrawn', collectInterest: true }), false);
});

test('public interest item carries no officer fields', () => {
  const p = I.publicInterestItem({ ...coin, vendor: 'Secret', notes: 'n', coEmail: 'a@b.c' });
  assert.equal(p.vendor, undefined);
  assert.equal(p.coEmail, undefined);
  assert.equal(p.prices.length, 1); // same price, so one row carrying the variant name
});

test('submission stores every open item, blanks as zero, clamps big numbers', () => {
  const items = [shirt, coin, closed];
  const v = I.validateSubmission({
    roster, items, responses: {}, memberId: '5107',
    answers: { s: { '|': 999, 'Bogus|': 4 }, x: { '|': 3 } },
    now: new Date('2026-09-26T12:00:00Z'),
  });
  assert.equal(v.error, undefined);
  assert.deepEqual(Object.keys(v.entries).sort(), ['c', 's']);
  assert.deepEqual(v.entries.s.counts, { '|': I.MAX_PER_CHOICE });
  assert.deepEqual(v.entries.c.counts, {});
  assert.equal(v.any, true);
});

test('one answer per member per item', () => {
  const responses = { 5107: { s: { at: 't', counts: { '|': 1 } } } };
  const v = I.validateSubmission({ roster, items: [shirt, coin], responses, memberId: '5107', answers: { s: { '|': 5 }, c: { 'Glow|': 1 } } });
  assert.deepEqual(Object.keys(v.entries), ['c']);
  assert.deepEqual(v.skipped, ['s']);

  const all = { 5107: { s: {}, c: {} } };
  assert.match(I.validateSubmission({ roster, items: [shirt, coin], responses: all, memberId: '5107', answers: {} }).error, /already answered/);
});

test('members not on the roster are refused', () => {
  assert.match(I.validateSubmission({ roster, items: [shirt], responses: {}, memberId: '99999', answers: {} }).error, /roster/);
  assert.match(I.validateSubmission({ roster, items: [shirt], responses: {}, memberId: '', answers: {} }).error, /roster/);
  assert.match(I.validateSubmission({ roster, items: [closed], responses: {}, memberId: '5107', answers: {} }).error, /Nothing/);
});

test('tally totals pieces, respondents, and per-choice counts', () => {
  const responses = {
    5107: { s: { counts: { '|': 3 } }, c: { counts: {} } },
    82518: { s: { counts: { '|': 3 } } },
  };
  const [s, c] = I.tally([shirt, coin], responses);
  assert.deepEqual([s.answered, s.wanting, s.total], [2, 2, 6]);
  assert.deepEqual(s.byChoice, { '|': 6 });
  assert.deepEqual([c.answered, c.wanting, c.total], [1, 0, 0]);
});

test('csv has one row per choice and a zero row for a pass', () => {
  const responses = { 5107: { s: { at: 'T1', counts: { '|': 2 } }, c: { at: 'T2', counts: {} } } };
  const csv = I.toCSV([shirt, coin], responses, roster).trim().split('\n');
  assert.equal(csv[0], 'Legion ID,Prefix,Name,Item,Variant,Quantity,Answered');
  assert.equal(csv[1], '5107,TK,Jason L Schuett,Shirt,,2,T1');
  assert.equal(csv[2], '5107,TK,Jason L Schuett,Coin,,0,T2');
});
