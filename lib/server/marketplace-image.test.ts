import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareImage } from './marketplace-image';

test('upload accepts decoded JPEG/PNG/WebP and strips metadata into WebP', async () => {
  for (const type of ['png', 'jpeg', 'webp'] as const) {
    const bytes = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#3b5998' } }).toFormat(type).toBuffer();
    const output = await prepareImage(new File([bytes], 'photo.' + type, { type: 'image/' + type }));
    assert.equal((await sharp(output).metadata()).format, 'webp');
    assert.equal((await sharp(output).metadata()).exif, undefined);
  }
});
test('upload rejects spoofed MIME, SVG, corrupt images, excessive bytes and pixels', async () => {
  await assert.rejects(prepareImage(new File(['<svg/>'], 'photo.png', { type: 'image/png' })));
  await assert.rejects(prepareImage(new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' })));
  await assert.rejects(prepareImage(new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })));
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(prepareImage(new File([png], 'fake.jpg', { type: 'image/jpeg' })));
  const huge = await sharp({ create: { width: 5001, height: 5001, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(prepareImage(new File([huge], 'pixels.png', { type: 'image/png' })));
});
