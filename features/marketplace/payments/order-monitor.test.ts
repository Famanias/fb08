import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrderMonitor, type OrderMonitorState } from './order-monitor';
import type { OrderConfirmation } from './types';

const initial: OrderConfirmation = { orderId: '11111111-1111-4111-8111-111111111111', listingId: '22222222-2222-4222-8222-222222222222', title: 'Fictional item', status: 'pending', currency: 'PHP', grossMinor: 123450, applicationFeeMinor: 12345, sellerBeforeProcessingMinor: 111105, sandbox: true };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('independent deadline aborts an unresolved automatic read and ignores its late result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const response = deferred<OrderConfirmation | null>(); const signals: AbortSignal[] = []; let state!: OrderMonitorState;
  const monitor = createOrderMonitor(initial, signal => { signals.push(signal); return response.promise; }, value => { state = value; });
  t.after(() => monitor.dispose()); monitor.start(); t.mock.timers.tick(2000); assert.equal(signals.length, 1);
  t.mock.timers.tick(58000); assert.equal(state.timedOut, true); assert.equal(state.order.status, 'pending'); assert.equal(signals[0].aborted, true);
  t.mock.timers.tick(60000); assert.equal(signals.length, 1);
  response.resolve({ ...initial, status: 'paid' }); await settle(); assert.equal(state.order.status, 'pending');
});

test('delayed pending manual result cannot overwrite newer automatic paid confirmation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const manual = deferred<OrderConfirmation | null>(); const automatic = deferred<OrderConfirmation | null>(); const signals: AbortSignal[] = []; let state!: OrderMonitorState;
  const monitor = createOrderMonitor(initial, signal => { signals.push(signal); return signals.length === 1 ? manual.promise : automatic.promise; }, value => { state = value; });
  t.after(() => monitor.dispose()); monitor.start(); monitor.refresh(); assert.equal(state.pending, true);
  t.mock.timers.tick(2000); automatic.resolve({ ...initial, status: 'paid' }); await settle(); assert.equal(state.order.status, 'paid');
  manual.resolve(initial); await settle(); assert.equal(state.order.status, 'paid'); assert.equal(state.pending, false);
  t.mock.timers.tick(60000); assert.equal(signals.length, 2); assert.equal(signals[0].aborted, true); assert.equal(state.timedOut, false);
});

test('once paid, a subsequent pending refresh cannot demote it or restart automatic polling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 }); let reads = 0; let state!: OrderMonitorState;
  const monitor = createOrderMonitor({ ...initial, status: 'paid' }, async () => { reads++; return initial; }, value => { state = value; });
  t.after(() => monitor.dispose()); monitor.start(); monitor.refresh(); await settle(); assert.equal(state.order.status, 'paid');
  t.mock.timers.tick(61000); assert.equal(reads, 1);
});

test('manual refresh has an independent finite deadline and permits retry after a stalled read', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 }); const signals: AbortSignal[] = []; let state!: OrderMonitorState;
  const monitor = createOrderMonitor({ ...initial, status: 'paid' }, signal => { signals.push(signal); return new Promise(() => undefined); }, value => { state = value; });
  t.after(() => monitor.dispose()); monitor.start(); monitor.refresh(); monitor.refresh(); assert.equal(signals.length, 1);
  t.mock.timers.tick(15000); assert.equal(signals[0].aborted, true); assert.equal(state.pending, false); assert.match(state.error, /Please refresh/);
  monitor.refresh(); assert.equal(signals.length, 2); monitor.dispose(); assert.equal(signals[1].aborted, true);
});

test('a queued polling callback checks the elapsed deadline before starting another read', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 }); let reads = 0; let state!: OrderMonitorState;
  const monitor = createOrderMonitor(initial, async () => { reads++; return initial; }, value => { state = value; });
  t.after(() => monitor.dispose()); monitor.start(); t.mock.timers.setTime(61000); t.mock.timers.tick(2000);
  assert.equal(reads, 0); assert.equal(state.timedOut, true);
});

test('dispose aborts both read kinds, clears timers and prevents late response updates', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 }); const response = deferred<OrderConfirmation | null>(); const signals: AbortSignal[] = []; let updates = 0;
  const monitor = createOrderMonitor(initial, signal => { signals.push(signal); return response.promise; }, () => { updates++; });
  monitor.start(); monitor.refresh(); t.mock.timers.tick(2000); monitor.dispose(); const before = updates;
  assert.equal(signals.length, 2); assert.ok(signals.every(signal => signal.aborted)); t.mock.timers.tick(61000);
  response.resolve({ ...initial, status: 'paid' }); await settle(); assert.equal(updates, before); assert.equal(signals.length, 2);
});

test('lost proof stops both reads and rejects late successful results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 }); const older = deferred<OrderConfirmation | null>(); const signals: AbortSignal[] = []; let state!: OrderMonitorState;
  const monitor = createOrderMonitor(initial, signal => { signals.push(signal); return signals.length === 1 ? older.promise : Promise.resolve(null); }, value => { state = value; });
  t.after(() => monitor.dispose()); monitor.start(); monitor.refresh(); t.mock.timers.tick(2000); await settle();
  assert.equal(state.lost, true); assert.equal(state.pending, false); assert.ok(signals.every(signal => signal.aborted));
  older.resolve({ ...initial, status: 'paid' }); await settle(); monitor.refresh(); t.mock.timers.tick(61000);
  assert.equal(state.lost, true); assert.equal(state.order.status, 'pending'); assert.equal(signals.length, 2);
});
