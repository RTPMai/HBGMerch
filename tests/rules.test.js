import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/rules.js';

test('election Day 1 is the first Saturday of February', () => {
  assert.equal(R.toISO(R.electionDay1(2026)), '2026-02-07');
  assert.equal(R.toISO(R.electionDay1(2027)), '2027-02-06');
  assert.equal(R.toISO(R.electionDay1(2031)), '2031-02-01');
});

test('term starts on Day 17, a Monday', () => {
  const d = R.termStart(2026);
  assert.equal(R.toISO(d), '2026-02-23');
  assert.equal(d.getUTCDay(), 1);
});

test('legion year turns over at term start', () => {
  assert.equal(R.legionYearOf('2026-02-22'), 2025);
  assert.equal(R.legionYearOf('2026-02-23'), 2026);
  assert.equal(R.legionYearOf('2026-12-31'), 2026);
  assert.equal(R.legionYearOf('2027-01-15'), 2026);
  assert.equal(R.legionYearLabel(2026), '2026-27');
  assert.equal(R.legionYearOf(''), null);
});

test('freeze runs from Day 1 to the day before term start', () => {
  assert.equal(R.inFreeze('2026-02-06'), false);
  assert.equal(R.inFreeze('2026-02-07'), true);
  assert.equal(R.inFreeze('2026-02-22'), true);
  assert.equal(R.inFreeze('2026-02-23'), false);
});

test('status follows the furthest date filled in', () => {
  assert.equal(R.deriveStatus({}), 'draft');
  assert.equal(R.deriveStatus({ coApproved: '2026-03-01' }), 'co_approved');
  assert.equal(R.deriveStatus({ coApproved: '2026-03-01', submitted: '2026-03-02', approved: '2026-03-09' }), 'approved');
  assert.equal(R.deriveStatus({ produced: '2026-04-01' }), 'produced');
  assert.equal(R.deriveStatus({ produced: '2026-04-01', outcome: 'denied' }), 'denied');
});

test('slot cost: only general, sets count per item, partner slots are free', () => {
  assert.equal(R.slotCost({ type: 'general' }), 1);
  assert.equal(R.slotCost({ type: 'general', setSize: '3' }), 3);
  assert.equal(R.slotCost({ type: 'general', setSize: 3, slotOwner: 'partner' }), 0);
  for (const type of ['basic', 'event', 'memorial', 'pr']) assert.equal(R.slotCost({ type }), 0);
});

test('slot summary splits used and planned and skips denied', () => {
  const items = [
    { id: 'a', name: 'Coin set', type: 'general', setSize: 3, submitted: '2026-03-01', coApproved: '2026-02-28' },
    { id: 'b', name: 'Hat', type: 'general', created: '2026-04-01' },
    { id: 'c', name: 'Shirt', type: 'general', submitted: '2026-05-01', outcome: 'denied' },
    { id: 'd', name: 'Con coin', type: 'event', submitted: '2026-05-01' },
    { id: 'e', name: 'Old patch', type: 'general', submitted: '2025-06-01' },
  ];
  const s = R.slotSummary(items, 2026, 5);
  assert.equal(s.used, 3);
  assert.equal(s.planned, 1);
  assert.equal(s.remaining, 1);
  assert.equal(s.cells.length, 5);
  assert.equal(s.cells[0].part, '1 of 3');
  assert.equal(s.cells[3].kind, 'planned');
  assert.equal(s.cells[4].kind, 'empty');
});

test('over the limit marks cells and raises a flag', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: `Item ${i}`, type: 'general', coApproved: '2026-03-01', submitted: '2026-03-02' }));
  const s = R.slotSummary(items, 2026, 5);
  assert.equal(s.cells[5].over, true);
  const flags = R.attention(items, { slotsPerYear: 5 }, '2026-04-01');
  assert.ok(flags.some((f) => f.level === 'danger' && f.message.includes('6 slots used')));
});

test('produced without receipt is flagged', () => {
  const flags = R.attention([{ id: 'x', name: 'Patch', type: 'general', coApproved: '2026-03-01', submitted: '2026-03-02', approved: '2026-03-10', produced: '2026-04-01' }], {}, '2026-04-10');
  assert.equal(flags[0].level, 'danger');
  assert.match(flags[0].message, /receipt/);
});

test('event rules: window, upcoming, passed', () => {
  const settings = { eventWarnDays: 21 };
  const early = R.attention([{ id: 'e1', name: 'Con', type: 'event', eventDate: '2026-12-01', coApproved: '2026-04-01', submitted: '2026-04-02' }], settings, '2026-04-10');
  assert.ok(early.some((f) => f.message.includes('6-month window')));

  const notYet = R.attention([{ id: 'e2', name: 'Con', type: 'event', eventDate: '2026-12-01' }], settings, '2026-04-10');
  assert.ok(notYet.some((f) => f.level === 'info' && f.message.includes('Jun 1, 2026')));

  const soon = R.attention([{ id: 'e3', name: 'Con', type: 'event', eventDate: '2026-12-01', coApproved: '2026-07-01', submitted: '2026-07-02', approved: '2026-07-10' }], settings, '2026-11-20');
  assert.ok(soon.some((f) => f.message.includes('in 11 days')));

  const passed = R.attention([{ id: 'e4', name: 'Con', type: 'event', eventDate: '2026-12-01', coApproved: '2026-07-01', submitted: '2026-07-02' }], settings, '2026-12-05');
  assert.ok(passed.some((f) => f.level === 'danger'));
});

test('freeze, CO approval, LFL and memorial flags', () => {
  const flags = R.attention([
    { id: 'f', name: 'Frozen', type: 'general', submitted: '2026-02-10' },
    { id: 'l', name: 'Big run', type: 'general', coApproved: '2026-03-01', quantity: 500 },
    { id: 'm', name: 'Memorial coin', type: 'memorial' },
  ], { lflThreshold: 300 }, '2026-03-05');
  assert.ok(flags.some((f) => f.itemId === 'f' && f.message.includes('freeze')));
  assert.ok(flags.some((f) => f.itemId === 'f' && f.message.includes('CO approval')));
  assert.ok(flags.some((f) => f.itemId === 'l' && f.message.includes('LFL')));
  assert.ok(flags.some((f) => f.itemId === 'm' && f.message.includes('TK ID')));
});

const SAMPLE = `Personal Information
Real Name: \tRyan Toney
501st ID Number: \t82518
Garrison or Outpost: \tHawkbat Garrison
Merchandise Details
Name of Merchandise Project: \tHawkbat Basic Coin
Type of Merchandise: \tChallenge Coin
Challenge Coin Size: \t1.75"
Merchandise Description: \t1.75" Coin produced by P&M Apparel Basic Coin Design
Merchandise Run Type: \tPreorder
Quantity: \t100
Price of Merchandise: \t6.15
Shipping: \tIncluded
Other Cost(s): \tNA
Date to Begin Sale: \t18-Sep-2026
Date to End Sale (Deadline): \t31-Dec-2026
Image #1: \t
https://www.501st.com/vault/merch/20260918043321^026-1290-05.png
"I have already received approval from my Garrison/Outpost CO or Detachment Leader for this project.": \tYes : GCO/OL has Approved
Garrison/Outpost CO or Detachment Leader Email Address: \tTrooper61472@gmail.com
This email has been scanned for spam and viruses by Proofpoint Essentials.`;

test('parses the LMBO confirmation email', () => {
  const p = R.parseApprovalEmail(SAMPLE, '2026-09-21');
  assert.equal(p.name, 'Hawkbat Basic Coin');
  assert.equal(p.type, 'basic');
  assert.equal(p.quantity, '100');
  assert.equal(p.price, '6.15');
  assert.equal(p.saleStart, '2026-09-18');
  assert.equal(p.saleEnd, '2026-12-31');
  assert.equal(p.submitted, '2026-09-18');
  assert.equal(p.coApproved, '2026-09-18');
  assert.equal(p.coEmail, 'Trooper61472@gmail.com');
  assert.equal(p.artUrl, 'https://www.501st.com/vault/merch/20260918043321^026-1290-05.png');
  assert.match(p.notes, /Coin size: 1.75"/);
  assert.doesNotMatch(p.notes, /Other costs/);
  assert.equal(R.parseApprovalEmail('hello there'), null);
});

test('import merges without overwriting', () => {
  const merged = R.mergeImport({ id: 'x', name: 'Hawkbat Basic Coin', type: 'general', vendor: 'P&M', quantity: '50' }, R.parseApprovalEmail(SAMPLE));
  assert.equal(merged.type, 'general');
  assert.equal(merged.quantity, '50');
  assert.equal(merged.vendor, 'P&M');
  assert.equal(merged.submitted, '2026-09-18');
});
