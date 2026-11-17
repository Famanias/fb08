/** Two-connection regression on the named owned disposable stack only. No provider access. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

class LocalSqlSession {
  private child = spawn('docker', ['exec', '-i', process.env.MARKETPLACE_TEST_DB_CONTAINER ?? 'fb08-payments-task1-db', 'psql', '-U', 'postgres', '-d', process.env.MARKETPLACE_TEST_DB_NAME ?? 'payments_red', '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: 'pipe' });
  private buffer = ''; private stderr = '';
  private pending: { marker: string; lines: string[]; resolve: (lines: string[]) => void; reject: (error: Error) => void } | null = null;
  constructor() {
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', value => { this.stderr += value; });
    this.child.stdout.on('data', value => {
      this.buffer += value;
      while (this.buffer.includes('\n')) {
        const end = this.buffer.indexOf('\n'); const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
        if (this.pending && line === this.pending.marker) { const done = this.pending; this.pending = null; done.resolve(done.lines); }
        else if (this.pending && line) this.pending.lines.push(line);
      }
    });
    this.child.on('error', error => { this.pending?.reject(error); this.pending = null; });
    this.child.on('exit', code => { this.pending?.reject(new Error(`Owned local SQL session exited ${code}: ${this.stderr}`)); this.pending = null; });
  }
  query(sql: string): Promise<string[]> {
    if (this.pending) throw new Error('Overlapping command on one SQL connection.');
    const marker = `done-${randomUUID()}`;
    return new Promise((resolve, reject) => { this.pending = { marker, lines: [], resolve, reject }; this.child.stdin.write(`${sql}\nselect '${marker}';\n`); });
  }
  close() { this.child.stdin.end('\\q\n'); }
}

async function scenario(kind: 'save' | 'acquire') {
  const holder = new LocalSqlSession(); const worker = new LocalSqlSession();
  const id = randomUUID(); const tenant = `locks-${id}`; const account = `acct_${id.replaceAll('-', '')}`; const app = `worker-${id}`;
  // Values interpolated below are generated UUIDs or fixed literals, never caller input.
  const row = `tenant='${tenant}' and seller_id='${id}'`;
  let pending: Promise<string[]> | undefined;
  try {
    await holder.query("set statement_timeout='8s'; set lock_timeout='7s';");
    await worker.query(`set statement_timeout='8s'; set lock_timeout='7s'; set application_name='${app}';
      insert into public.marketplace_payment_sellers(id,tenant,email_normalized,verified_at) values('${id}','${tenant}','${id}@example.invalid',clock_timestamp());
      select public.marketplace_ensure_account_slot('${tenant}','${id}');
      select public.marketplace_save_account('${tenant}','${id}','${account}',(select account_create_key from public.marketplace_connected_accounts where ${row}));`);
    if (kind === 'save') {
      await worker.query(`select public.marketplace_acquire_account_refresh('${tenant}','${account}',repeat('a',64));
        update public.marketplace_connected_accounts set refresh_expires_at=clock_timestamp()+interval '3 seconds' where ${row};`);
    }
    await holder.query(`begin; select account_id from public.marketplace_connected_accounts where ${row} for share;`);
    await worker.query('set role service_role;');
    pending = worker.query(kind === 'save'
      ? `select refresh_expires_at>clock_timestamp() from public.marketplace_connected_accounts where ${row};
         select public.marketplace_save_account_readiness('${tenant}','${account}',repeat('a',64),true,'ready',clock_timestamp());
         select ready from public.marketplace_connected_accounts where ${row};`
      : `select public.marketplace_acquire_account_refresh('${tenant}','${account}',repeat('b',64));
         select extract(epoch from refresh_expires_at-clock_timestamp()) from public.marketplace_connected_accounts where ${row};`);
    // Observe the real lock wait rather than guessing when the worker has started.
    let blocked = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await holder.query(`select exists(select 1 from pg_stat_activity where application_name='${app}' and wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(pid)));`);
      if (state[0] === 't') { blocked = true; break; }
      await delay(25);
    }
    assert.equal(blocked, true, 'worker must actually block behind the unchanged FOR SHARE tuple');
    if (kind === 'save') await holder.query(`select pg_sleep(greatest(0,extract(epoch from refresh_expires_at-clock_timestamp()))+0.15) from public.marketplace_connected_accounts where ${row};`);
    else await holder.query('select pg_sleep(3);');
    await holder.query('commit;');
    const result = await pending; pending = undefined;
    if (kind === 'save') {
      assert.equal(result[0], 't', 'save must start while fixture lease is still valid');
      assert.equal(result[1], 'f', 'save waiting across lease expiry must reject the stale fence');
      assert.equal(result[2], 'f', 'expired worker cannot restore readiness');
      console.log('PASS: save started before expiry, blocked across expiry, returned false and left ready=false.');
    } else {
      assert.equal(result[0], 't'); const remaining = Number(result[1]);
      assert.ok(remaining > 19.5 && remaining <= 20, `acquisition must receive a full 20 seconds after lock wait, got ${remaining}`);
      console.log(`PASS: acquisition blocked 3 seconds, then received ${remaining.toFixed(3)} seconds of its 20-second lease.`);
    }
  } finally {
    // Release first so an in-flight worker can finish before deleting exact fixtures.
    await holder.query('rollback;'); await pending?.catch(() => undefined);
    await worker.query(`reset role; delete from public.marketplace_connected_accounts where ${row}; delete from public.marketplace_payment_sellers where tenant='${tenant}' and id='${id}';`);
    const left = await worker.query(`select count(*) from public.marketplace_payment_sellers where tenant='${tenant}' or id='${id}';`);
    assert.equal(left[0], '0'); console.log(`PASS: ${kind} exact fixtures removed.`);
    holder.close(); worker.close();
  }
}
async function main() {
  const container = process.env.MARKETPLACE_TEST_DB_CONTAINER ?? 'fb08-payments-task1-db';
  const database = process.env.MARKETPLACE_TEST_DB_NAME ?? 'payments_red';
  if (!((container === 'fb08-payments-task1-db' && database === 'payments_red') || (container === 'fb08-marketplace-payments-local-db' && database === 'marketplace_payments_local'))) throw new Error('Refusing unowned SQL target.');
  let failed = false;
  for (const kind of ['save', 'acquire'] as const) {
    try { await scenario(kind); }
    catch (error) { failed = true; console.error(`FAIL ${kind}: ${error instanceof Error ? error.message : 'local regression failed'}`); }
  }
  if (failed) process.exitCode = 1;
}
void main();
