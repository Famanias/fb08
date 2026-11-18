import { SellerPaymentsPanel } from '@/features/marketplace/components/SellerPaymentsPanel';
import { sellerLandingStatus } from '@/lib/server/marketplace-payments/seller-landing';
export const dynamic = 'force-dynamic';
export default async function ReturnPage() { return <SellerPaymentsPanel mode="return" initial={await sellerLandingStatus()} />; }
