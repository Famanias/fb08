import { createHash } from 'node:crypto';
import inventory from '../marketplace-demo-listings.json';
import { validateListing } from '../../features/marketplace/validation';
import type { MarketplaceCategory } from '../../features/marketplace/types';

export type DemoExpectation = { id: string; title: string; description: string; price: string; category: MarketplaceCategory; sellerDisplayName: string; imagePath: string; sellerEmail: string };
export function fixtureId(namespace: string, slug: string): string {
  const hash = createHash('sha256').update(`fb08-stock-demo-v1:${namespace}:${slug}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function expectedDemoRows(): DemoExpectation[] {
  return inventory.map(item => {
    const id = fixtureId('listing', item.slug);
    const { inventoryKind: _kind, ...input } = validateListing({ title: item.title, category: item.category, price: item.price, sellerDisplayName: item.seller, sellerEmail: 'marketplace-demo@example.invalid', description: `DEMO LISTING — NOT FOR SALE. This is fictional sample inventory with a stock photograph. No real seller or item is represented.\n\n${item.description}\n\nStock photo: ${item.photographer} / Pexels\nSource: ${item.source}\nLicense: https://www.pexels.com/license/` });
    return { id, ...input, imagePath: `listings/${id}.webp` };
  });
}
