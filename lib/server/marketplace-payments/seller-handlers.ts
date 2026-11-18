import type { PaymentDeps, SellerIdentity } from './contracts';
import { MarketplaceError, validUuid } from '../../../features/marketplace/validation';
import { jsonResponse, readCookieValue } from '../route-helpers';
import { createPaymentDeps } from './dependencies';
import { refreshKnownAccount } from './connect-handlers';
import { requireSeller } from './seller-authority';
export { requireSeller } from './seller-authority';
import { capabilityCookie, capabilityCookieName, codeHash, newCapability, normalizeSellerEmail, proofHash, validCapability } from './proof';
import { assertPaymentOrigin, paymentErrorResponse, readPaymentJson } from './request';

function checkedDeps(deps?: PaymentDeps, newPayments = true): PaymentDeps {
  const resolved = deps ?? createPaymentDeps(newPayments);
  if (newPayments && !resolved.context.enabled) throw new MarketplaceError('Payments unavailable.', 503);
  return resolved;
}
function secure(deps: PaymentDeps) { return new URL(deps.context.origin).protocol === 'https:'; }
function token(req: Request, kind: 'seller' | 'verify', deps: PaymentDeps) { return readCookieValue(req, capabilityCookieName(kind, secure(deps))); }
function ipActor(req: Request, deps: PaymentDeps) {
  // Vercel overwrites this header. Outside Vercel all callers share a budget.
  const ip = process.env.VERCEL ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown' : 'local';
  return proofHash('browser', JSON.stringify(['ip', deps.context.tenant, ip]), deps.secret);
}
async function rate(req: Request, deps: PaymentDeps, action: string, limit: number, actor = ipActor(req, deps)) {
  if (!await deps.store.consumeRate(actor, action, limit)) throw new MarketplaceError('Too many attempts.', 429);
}
function newUuid(deps: PaymentDeps) { const bytes = deps.randomBytes(16); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`; }
function newCode(deps: PaymentDeps) {
  // Rejection sampling avoids modulo bias across the one million codes.
  let n: number; do { n = deps.randomBytes(4).readUInt32BE(); } while (n >= 4294000000);
  return String(n % 1000000).padStart(6, '0');
}
export async function handleSellerChallenge(req: Request, injected?: PaymentDeps): Promise<Response> {
  try {
    const deps = checkedDeps(injected); assertPaymentOrigin(req, deps.context);
    const body = await readPaymentJson(req); const email = normalizeSellerEmail(body.email);
    await rate(req, deps, 'payment-seller-send-ip', 10);
    await rate(req, deps, 'payment-seller-send-email', 3, proofHash('email', JSON.stringify([deps.context.tenant, email]), deps.secret));
    const previous = token(req, 'verify', deps); const browser = validCapability(previous) ? previous : newCapability(deps.randomBytes);
    const browserHash = proofHash('browser', browser, deps.secret); const id = newUuid(deps); const code = newCode(deps);
    await deps.store.issueChallenge({ id, emailNormalized: email, tenant: deps.context.tenant, browserHash, codeHash: codeHash(id, email, browserHash, code, deps.secret), expiresAt: new Date(+deps.now() + 600000).toISOString() });
    // Delivery failure never grants authority or discloses inbox/listing state.
    await deps.mailer.sendCode({ to: email, code, expiresMinutes: 10, challengeId: id }).catch(() => undefined);
    return jsonResponse({ challengeId: id, message: 'If delivery is available, a verification code has been sent.' }, 202, { 'Set-Cookie': capabilityCookie('verify', browser, 600, secure(deps)) });
  } catch (error) { return paymentErrorResponse(error); }
}
export async function handleSellerVerify(req: Request, injected?: PaymentDeps): Promise<Response> {
  try {
    const deps = checkedDeps(injected); assertPaymentOrigin(req, deps.context); const body = await readPaymentJson(req);
    const browser = token(req, 'verify', deps);
    if (!validUuid(body.challengeId) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code) || !validCapability(browser)) throw new MarketplaceError('Invalid verification.');
    await rate(req, deps, 'payment-seller-verify-ip', 30);
    const browserHash = proofHash('browser', browser, deps.secret); const now = deps.now();
    const challenge = await deps.store.findChallenge(body.challengeId, deps.context.tenant, browserHash, now);
    if (!challenge) throw new MarketplaceError('Invalid verification.');
    const capability = newCapability(deps.randomBytes);
    const seller = await deps.store.consumeChallenge({ id: challenge.id, tenant: deps.context.tenant, browserHash, candidateHash: codeHash(challenge.id, challenge.emailNormalized, browserHash, body.code, deps.secret), sessionHash: proofHash('seller-session', capability, deps.secret), now });
    if (!seller) throw new MarketplaceError('Invalid verification.');
    return jsonResponse({ verified: true }, 200, { 'Set-Cookie': capabilityCookie('seller', capability, 3600, secure(deps)) });
  } catch (error) { return paymentErrorResponse(error); }
}
export async function handleSellerLogout(req: Request, injected?: PaymentDeps): Promise<Response> {
  try {
    const deps = checkedDeps(injected, false); assertPaymentOrigin(req, deps.context); await readPaymentJson(req);
    // Persistent 30/hour/IP budget, separate from verification and shared even without a cookie.
    await rate(req, deps, 'payment-seller-logout-ip', 30);
    const capability = token(req, 'seller', deps);
    if (validCapability(capability)) await deps.store.revokeSellerSession(proofHash('seller-session', capability, deps.secret), deps.context.tenant);
    return jsonResponse({ verified: false }, 200, { 'Set-Cookie': capabilityCookie('seller', '', 0, secure(deps)) });
  } catch (error) { return paymentErrorResponse(error); }
}
export async function handleSellerStatus(req: Request, injected?: PaymentDeps): Promise<Response> {
  try {
    const deps = checkedDeps(injected, false);
    let seller: SellerIdentity;
    try { seller = await requireSeller(req, deps); } catch (error) { if (error instanceof MarketplaceError && error.status === 401) return jsonResponse({ verified: false, connection: 'not_connected' }); throw error; }
    const account = await deps.store.findSellerAccount(seller.id, deps.context.tenant);
    let connection = await deps.store.findSellerConnection(seller.id, deps.context.tenant);
    const age = account ? +deps.now() - Date.parse(account.checkedAt) : 0;
    if (account && (!Number.isFinite(age) || age < 0 || age > 60000)) connection = (await refreshKnownAccount(account, deps)).connection;
    return jsonResponse({ verified: true, connection: connection ?? 'not_connected' });
  } catch (error) { return paymentErrorResponse(error); }
}
