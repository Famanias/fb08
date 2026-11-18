import type { OrderConfirmation } from './types';

export type OrderMonitorState = { order: OrderConfirmation; error: string; lost: boolean; timedOut: boolean; pending: boolean };
export function createOrderMonitor(initial: OrderConfirmation, read: (signal: AbortSignal) => Promise<OrderConfirmation | null>, onChange: (state: OrderMonitorState) => void) {
  const state: OrderMonitorState = { order: initial, error: '', lost: false, timedOut: false, pending: false };
  let disposed = false; let started = false; let automatic = false; let deadline = 0;
  let sequence = 0; let appliedSequence = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let automaticController: AbortController | null = null;
  let manual: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | null = null;
  const publish = () => { if (!disposed) onChange({ ...state }); };
  function stopAutomatic() {
    automatic = false; clearTimeout(pollTimer); clearTimeout(deadlineTimer);
    automaticController?.abort(); automaticController = null;
  }
  function stopManual() {
    if (manual) { clearTimeout(manual.timer); manual.controller.abort(); manual = null; }
    state.pending = false;
  }
  function expireAutomatic() {
    if (!automatic) return;
    stopAutomatic(); state.timedOut = true; publish();
  }
  function accept(next: OrderConfirmation | null, ticket: number) {
    if (disposed || state.lost || (ticket < appliedSequence && next?.status !== 'paid')) return;
    // Paid is terminal in storage. A stale read can never demote an observed confirmation.
    if (state.order.status === 'paid' && next && next.status !== 'paid') return;
    appliedSequence = Math.max(appliedSequence, ticket);
    if (!next) { state.lost = true; stopAutomatic(); stopManual(); }
    else {
      state.order = next;
      if (next.status !== 'pending') { stopAutomatic(); stopManual(); }
    }
    state.error = ''; publish();
  }
  async function perform(controller: AbortController, ticket: number) {
    try {
      const next = await read(controller.signal);
      if (!controller.signal.aborted) accept(next, ticket);
    } catch {
      if (!disposed && !controller.signal.aborted && ticket >= appliedSequence) {
        appliedSequence = ticket; state.error = 'Could not read payment status. Please refresh.'; publish();
      }
    }
  }
  function poll() {
    if (!automatic || disposed || state.lost || state.order.status !== 'pending') return;
    // Timers may run late after a suspended/background page. Check before starting any read.
    if (Date.now() >= deadline) { expireAutomatic(); return; }
    const controller = new AbortController(); automaticController = controller;
    void perform(controller, ++sequence).finally(() => {
      if (automaticController === controller) automaticController = null;
      if (!automatic || disposed || state.lost || state.order.status !== 'pending') return;
      if (Date.now() >= deadline) expireAutomatic(); else pollTimer = setTimeout(poll, 2000);
    });
  }
  return {
    start() {
      if (started || disposed) return; started = true; publish();
      if (state.order.status !== 'pending') return;
      automatic = true; deadline = Date.now() + 60000;
      // This timer does not await fetch or response.json; it also aborts a stalled body read.
      deadlineTimer = setTimeout(expireAutomatic, 60000); pollTimer = setTimeout(poll, 2000);
    },
    refresh() {
      if (disposed || state.lost || manual) return;
      const controller = new AbortController(); const ticket = ++sequence;
      const timer = setTimeout(() => {
        if (manual?.controller !== controller) return;
        stopManual(); appliedSequence = Math.max(appliedSequence, ticket);
        state.error = 'Could not read payment status. Please refresh.'; publish();
      }, 15000);
      manual = { controller, timer }; state.pending = true; publish();
      void perform(controller, ticket).finally(() => {
        if (manual?.controller !== controller) return;
        clearTimeout(timer); manual = null; state.pending = false; publish();
      });
    },
    dispose() { disposed = true; stopAutomatic(); stopManual(); },
  };
}
