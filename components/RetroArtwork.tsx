'use client';

import { useId } from 'react';

export function ProfilePortraitSvg() {
  const uid = useId().replace(/:/g, '');
  const picBgId = `picBg-${uid}`;
  const lightId = `light-${uid}`;
  const grainId = `grain-${uid}`;

  return (
    <svg
      viewBox="0 0 219 267"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={picBgId} x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#d7d7d7" />
          <stop offset=".5" stopColor="#878c94" />
          <stop offset="1" stopColor="#343a42" />
        </linearGradient>
        <radialGradient id={lightId} cx="40%" cy="35%" r="80%">
          <stop stopColor="#f7f7f7" stopOpacity=".65" />
          <stop offset="1" stopColor="#12181b" stopOpacity="0" />
        </radialGradient>
        <pattern id={grainId} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="3" r=".4" fill="#fff" opacity=".35" />
          <circle cx="6" cy="6" r=".5" fill="#000" opacity=".28" />
        </pattern>
      </defs>
      <rect width="219" height="267" fill={`url(#${picBgId})`} />
      <path d="M-10 49 70 16 95 58 14 98Z" fill="#32383c" opacity=".5" />
      <path d="M147-20 245 9 222 121 171 89Z" fill="#d4d7d8" opacity=".35" />
      <rect width="219" height="267" fill={`url(#${lightId})`} />
      <path d="M10 267Q29 185 74 178L153 182Q203 202 225 267Z" fill="#22282c" />
      <path d="M65 181 107 229 144 183 131 168 82 166Z" fill="#d3d3d3" />
      <path d="M59 181Q97 196 107 211Q131 196 152 183L165 267H42Z" fill="#40474c" />
      <path
        d="M71 82Q69 46 104 43Q143 43 147 87L145 133Q141 171 108 179Q81 173 72 138Z"
        fill="#c5c5c5"
      />
      <path
        d="M70 114Q53 88 65 63Q77 42 98 42Q126 24 151 56Q158 68 150 100Q144 87 135 85Q105 92 80 76Q82 99 70 114Z"
        fill="#33383d"
      />
      <path
        d="M78 102Q95 95 104 100M117 100Q133 95 140 100"
        stroke="#4c5153"
        strokeWidth="3"
        fill="none"
      />
      <ellipse cx="93" cy="108" rx="2.4" ry="3.1" fill="#373a3d" />
      <ellipse cx="128" cy="107" rx="2.4" ry="3.1" fill="#373a3d" />
      <path d="M109 105 105 132 114 134" fill="none" stroke="#787878" strokeWidth="2" />
      <path
        d="M96 146Q111 154 127 144"
        fill="none"
        stroke="#5d5d5d"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M64 98Q55 91 56 72Q58 49 78 42M151 94Q161 64 139 43"
        fill="none"
        stroke="#24292d"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <rect x="55" y="88" width="11" height="44" rx="5" fill="#40474c" />
      <rect x="148" y="89" width="11" height="44" rx="5" fill="#40474c" />
      <path d="M15 233Q67 222 100 247L122 267H0Z" fill="#1c2126" opacity=".9" />
      <rect width="219" height="267" fill={`url(#${grainId})`} />
    </svg>
  );
}

export function ScubaAdSvg() {
  const uid = useId().replace(/:/g, '');
  const seaId = `sea-${uid}`;

  return (
    <svg viewBox="0 0 154 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={seaId} x2="0" y2="1">
          <stop stopColor="#97d7ed" />
          <stop offset=".45" stopColor="#168cb6" />
          <stop offset="1" stopColor="#174b76" />
        </linearGradient>
      </defs>
      <rect width="154" height="100" fill={`url(#${seaId})`} />
      <path
        d="M0 17Q35 23 65 16T154 18"
        stroke="#d8faff"
        fill="none"
        opacity=".55"
      />
      <path d="M0 75Q40 60 78 85T154 75V100H0Z" fill="#126c79" />
      <path
        d="M22 88Q15 67 31 52M39 91Q46 70 39 58M114 100Q105 73 125 62"
        stroke="#80c0a8"
        strokeWidth="4"
        fill="none"
      />
      <ellipse cx="101" cy="45" rx="24" ry="12" fill="#c8e3e5" />
      <path d="m122 45 18-14v28Z" fill="#a8d7db" />
      <circle cx="92" cy="42" r="2" fill="#124660" />
      <path
        d="M55 37Q63 32 72 37L82 44 72 50Q61 53 55 46Z"
        fill="#fed79d"
      />
      <circle cx="63" cy="40" r="1.4" fill="#2a5964" />
      <circle cx="21" cy="39" r="3" stroke="#d9fbff" fill="none" />
      <circle cx="31" cy="29" r="2" stroke="#d9fbff" fill="none" />
    </svg>
  );
}

export function WallpaperAdSvg() {
  const uid = useId().replace(/:/g, '');
  const skyId = `sky-${uid}`;

  return (
    <svg viewBox="0 0 154 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={skyId} x2="0" y2="1">
          <stop stopColor="#50a3dd" />
          <stop offset="1" stopColor="#d3eafb" />
        </linearGradient>
      </defs>
      <rect width="154" height="100" fill={`url(#${skyId})`} />
      <circle cx="113" cy="28" r="15" fill="#ffeebb" />
      <path d="M0 77 39 45 65 66 98 33 154 79V100H0" fill="#7fa3bc" />
      <path d="M0 88 36 69 83 82 113 61 154 78V100H0" fill="#4f8e78" />
      <path d="M0 91Q67 70 154 95V100H0" fill="#76b28b" />
    </svg>
  );
}

export function MixtapeAdSvg() {
  return (
    <svg viewBox="0 0 154 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="154" height="100" fill="#e4d8c8" />
      <rect
        x="24"
        y="17"
        width="106"
        height="66"
        rx="5"
        fill="#333e54"
        stroke="#192437"
        strokeWidth="3"
      />
      <rect x="31" y="25" width="92" height="33" fill="#f2c898" />
      <rect x="42" y="32" width="69" height="17" fill="#e1e4e4" />
      <circle
        cx="60"
        cy="40"
        r="7"
        stroke="#495b74"
        strokeWidth="4"
        fill="#e1e4e4"
      />
      <circle
        cx="95"
        cy="40"
        r="7"
        stroke="#495b74"
        strokeWidth="4"
        fill="#e1e4e4"
      />
      <path d="m43 76 9-10h51l9 10" stroke="#9dabba" strokeWidth="3" fill="none" />
    </svg>
  );
}
