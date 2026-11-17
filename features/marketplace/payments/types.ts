export type PaymentAvailability = 'unavailable' | 'ready' | 'reserved' | 'sold';
export type PublicPaymentState = { sandbox: boolean; availability: PaymentAvailability };
export type OrderConfirmation = {
  orderId: string; listingId: string; title: string;
  status: 'pending' | 'paid' | 'expired' | 'review';
  currency: 'PHP'; grossMinor: number; applicationFeeMinor: number;
  sellerBeforeProcessingMinor: number; sandbox: true;
};
