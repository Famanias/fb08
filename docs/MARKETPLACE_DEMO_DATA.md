# Marketplace demo inventory

Added at the user’s explicit request on 2026-11-17. These are fictional, clearly labeled sample listings; no real item or seller is represented.

The 21 entries cover all seven categories, three per category. Every title begins with `[Demo]`, every seller name identifies a Demo Seller, and every description starts with `DEMO LISTING — NOT FOR SALE`. The private contact address uses the reserved `.invalid` domain. Inquiries to demos still follow the app’s normal private persistence flow; no notifications are sent.

Photos were downloaded from Pexels, visually checked, stripped of metadata, re-encoded as WebP and uploaded to the existing `marketplace-images` Supabase bucket. The app does not hotlink the third-party photos. Each description retains its source URL and photo credit. See the [Pexels license](https://www.pexels.com/license/).

The manifest is `scripts/marketplace-demo-listings.json`. The operator-only seeder validates all entries and downloads every photo before database writes. Stable fixture IDs prevent duplicate inventory on repeated runs; existing rows are checked and never overwritten. The application’s schema and UI were not changed.

```powershell
# Download and validate only; no database changes:
node --env-file=.env.local --import=tsx scripts/seed-marketplace-demos.ts
# Populate the configured existing Supabase project:
node --env-file=.env.local --import=tsx scripts/seed-marketplace-demos.ts --apply
```

These commands require the existing server-only environment configuration. Cached photos and the generated ID/path manifest are git-ignored under `.superpowers/marketplace-demo-photos/`. To remove samples later, use the exact IDs from that manifest and verify their demo titles before deleting the rows, associated request keys and Storage objects; leave user listings intact.

Verified on the live site: 21 unique listing rows and 21 successfully decoded Supabase WebP images; three entries in every category; pagination returns 18 items then three; demo labeling and private contact omission confirmed. A second seeding run skipped all 21 existing entries without duplicates. Board and People returned HTTP 200. Seeder ESLint and project TypeScript checks passed. This was a data-only update; no deployment or schema change was required.

| Listing | Category | PHP price | Photo source / credit |
| --- | --- | ---: | --- |
| [Demo] Vintage Film Camera | Electronics | 2500.00 | [Pexels contributor](https://www.pexels.com/photo/retro-analog-camera-on-vintage-wooden-desk-30339402/) |
| [Demo] Wooden Study Desk | Furniture | 1800.00 | [KATRIN BOLOVTSOVA](https://www.pexels.com/photo/vintage-wooden-desk-and-a-chair-5393443/) |
| [Demo] Over-Ear Headphones | Electronics | 1250.00 | [John Taran](https://www.pexels.com/photo/black-headphones-on-wooden-surface-10942520/) |
| [Demo] Red City Bicycle | Sports | 3200.00 | [Pexels contributor](https://www.pexels.com/photo/red-bicycle-parked-beside-the-concrete-wall-14860979/) |
| [Demo] Classic White T-Shirt | Clothing | 280.00 | [Pexels contributor](https://www.pexels.com/photo/minimalist-white-t-shirt-flat-lay-with-sunlight-37704841/) |
| [Demo] Paperback Book Bundle | Books | 350.00 | [George Milton](https://www.pexels.com/photo/close-up-photo-of-stack-of-books-7034089/) |
| [Demo] Warm Table Lamp | Home | 900.00 | [Özge Taşkıran](https://www.pexels.com/photo/close-up-shot-of-table-lamp-12801238/) |
| [Demo] Tablet and Keyboard | Electronics | 4900.00 | [Polina Tankilevitch](https://www.pexels.com/photo/top-view-of-wireless-electronics-4523063/) |
| [Demo] Wooden Reading Chair | Furniture | 1450.00 | [Tuğçe Açıkyürek](https://www.pexels.com/photo/bookshelf-and-a-chair-in-a-domestic-room-16751825/) |
| [Demo] Blue Denim Jacket | Clothing | 650.00 | [Muhammad Rifki Adiyanto](https://www.pexels.com/photo/man-wearing-black-bads-crew-neck-shirt-under-blue-denim-jacket-1105058/) |
| [Demo] Tennis Racket Set | Sports | 850.00 | [Jenny K.](https://www.pexels.com/photo/blue-tennis-racket-on-the-ground-14629572/) |
| [Demo] Potted Basil Plant | Home | 180.00 | [Diana](https://www.pexels.com/photo/close-up-photo-of-plant-on-pot-1437424/) |
| [Demo] Acoustic Guitar | Other | 2800.00 | [Pexels contributor](https://www.pexels.com/photo/an-acoustic-guitar-hanging-on-a-wooden-wall-12174237/) |
| [Demo] Notebook and Planner | Books | 220.00 | [Jessika Arraes](https://www.pexels.com/photo/stack-of-books-11578767/) |
| [Demo] Home Office Desk | Furniture | 2350.00 | [Leticia Curvelo](https://www.pexels.com/photo/cozy-minimalist-home-office-with-wooden-desk-28668434/) |
| [Demo] Black Everyday Sneakers | Clothing | 750.00 | [ALOK DAS](https://www.pexels.com/photo/hands-holding-a-pair-of-black-sneakers-19845610/) |
| [Demo] Outdoor Basketball | Sports | 450.00 | [Pexels contributor](https://www.pexels.com/photo/person-on-basketball-court-holding-ball-between-legs-9634895/) |
| [Demo] Ceramic Coffee Mug | Home | 160.00 | [Tuğba Dönmez](https://www.pexels.com/photo/cozy-reading-nook-with-coffee-and-books-35097354/) |
| [Demo] Study Book Stack | Books | 480.00 | [alleksana](https://www.pexels.com/photo/stack-of-books-against-white-background-4284791/) |
| [Demo] Brown Day Backpack | Other | 590.00 | [Deybson Mallony](https://www.pexels.com/photo/brown-backpack-hanging-on-a-wall-9448166/) |
| [Demo] Guitar Practice Bundle | Other | 3100.00 | [Pexels contributor](https://www.pexels.com/photo/close-up-photo-of-a-wooden-acoustic-guitar-near-a-musical-composition-9717785/) |

## Payment classification

Existing demo rows remain inquiry-only. See the [payment runbook](MARKETPLACE_PAYMENTS.md) for the dry-run exact-manifest classifier and the separately explicit `--apply`. A title beginning `[Demo]` does not establish inventory kind or authorize reclassification. Only new, explicitly opted-in fictional sandbox listings, bound to this deployment tenant and a verified seller, can become purchasable. The original image/source manifest remains unchanged.
