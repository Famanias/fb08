import sharp from 'sharp';
import { MAX_PHOTO_BYTES } from '@/features/marketplace/types';
import { MarketplaceError } from '@/features/marketplace/validation';

/** Decode trusted formats, enforce pixel limits and strip metadata before publication. */
export async function prepareImage(file: File): Promise<Buffer> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > MAX_PHOTO_BYTES) throw new MarketplaceError('Choose a JPG, PNG or WebP photo up to 3 MiB.', 400, 'photo');
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 25_000_000, failOn: 'warning', animated: false });
    const meta = await image.metadata();
    if (`image/${meta.format}` !== file.type || !meta.width || !meta.height || (meta.pages ?? 1) !== 1) throw new Error('Invalid image');
    return await image.rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch { throw new MarketplaceError('This photo could not be decoded. Choose a valid, non-animated JPG, PNG or WebP under 25 megapixels.', 400, 'photo'); }
}
