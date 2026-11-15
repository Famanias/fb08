const AVATAR_PALETTE: ReadonlyArray<[string, string]> = [
  ['#dbe8f6', '#4a6996'],
  ['#ecd6ce', '#93634c'],
  ['#d8ead9', '#557e62'],
  ['#e2d9ee', '#806ba1'],
  ['#f2e8c9', '#9b7d47'],
  ['#d4e9e8', '#3e8182'],
];

export function getInitials(name: string): string {
  const cleaned = String(name || '?').trim();
  if (!cleaned) {
    return '?';
  }
  const tokens = cleaned.split(/\s+/).slice(0, 2);
  const chars = tokens.map((word) => word[0] || '').join('').toUpperCase();
  return chars || '?';
}

export function getAvatarColors(name: string): [string, string] {
  const source = String(name || '');
  let sum = 0;
  for (let i = 0; i < source.length; i += 1) {
    sum += source.charCodeAt(i);
  }
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}
