// The sky's cast for the acts (SkyActs): drawn as vector art in the scenes' own flat style, with
// each limb its own group so an act can move it (the CSS names them: .pk-arm-l, .pl-leg-a …).
// Every figure faces right; an act flips it to face left.

/** The pumpkin: an orange jack-o'-lantern with a teal stem and leaves, thin green limbs, white
 *  gloves and round black feet, glowing softly. Seen from the front, the side (facing right, the
 *  face wrapping round the edge) or the back (no face, a plush tag). */
export function Pumpkin({ className = '', mouth = 'grin', view = 'front' }: { className?: string; mouth?: 'grin' | 'open'; view?: 'front' | 'side' | 'back' }) {
  const face = (
    <>
      <path d="M44 58 C44 44 62 44 62 58 L56.5 58 C56.5 51 49.5 51 49.5 58 Z" />
      <path d="M78 58 C78 44 96 44 96 58 L90.5 58 C90.5 51 83.5 51 83.5 58 Z" />
      <path d="M63 73 L77 73 L70 63 Z" />
      {mouth === 'grin' ? <path d="M40 77 Q70 91 100 77 Q90 96 76 96 L76 90.5 L66 90.5 L66 96 Q50 96 40 77 Z" /> : <ellipse cx="70" cy="86" rx="11" ry="9" />}
    </>
  )
  return (
    <svg className={`cast pumpkin is-${view} ${className}`} viewBox="0 0 140 150" aria-hidden="true">
      <defs>
        <clipPath id="pk-round">
          <ellipse cx="70" cy="62" rx="46" ry="38" />
        </clipPath>
        <radialGradient id="pk-skin" cx="42%" cy="34%" r="70%">
          <stop offset="0" stopColor="#ffa24a" />
          <stop offset="0.6" stopColor="#f2711c" />
          <stop offset="1" stopColor="#c8500e" />
        </radialGradient>
        <linearGradient id="pk-leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2fae8a" />
          <stop offset="1" stopColor="#14735e" />
        </linearGradient>
      </defs>
      {/* Legs and feet first, so the body sits over the hips. */}
      <g className="pk-leg pk-leg-l">
        <path d="M58 94 Q56 110 54 122" />
        <ellipse className="pk-foot" cx="52" cy="127" rx="9" ry="6.5" />
      </g>
      <g className="pk-leg pk-leg-r">
        <path d="M82 94 Q84 110 86 122" />
        <ellipse className="pk-foot" cx="88" cy="127" rx="9" ry="6.5" />
      </g>
      {view === 'side' ? (
        // From the side both arms reach forward: the far one behind the body.
        <g className="pk-arm pk-arm-far">
          <path d="M96 66 Q114 72 122 62" />
          <g className="pk-glove">
            <circle cx="126" cy="58" r="7.5" />
            <path className="pk-cuff" d="M118 62 Q122 67 127 64" />
          </g>
        </g>
      ) : (
        <>
          <g className="pk-arm pk-arm-l">
            <path d="M27 64 Q16 62 11 52" />
            <g className="pk-glove">
              <circle cx="9" cy="47" r="7.5" />
              <ellipse cx="15" cy="44" rx="3" ry="2.4" />
              <path className="pk-cuff" d="M4 52 Q9 56 14 52" />
            </g>
          </g>
          <g className="pk-arm pk-arm-r">
            <path d="M113 64 Q124 62 129 52" />
            <g className="pk-glove">
              <circle cx="131" cy="47" r="7.5" />
              <ellipse cx="125" cy="44" rx="3" ry="2.4" />
              <path className="pk-cuff" d="M126 52 Q131 56 136 52" />
            </g>
          </g>
        </>
      )}
      <ellipse cx="70" cy="62" rx="46" ry="38" fill="url(#pk-skin)" />
      {view === 'side' ? (
        <>
          <path className="pk-rib" d="M62 25 Q50 62 62 99" />
          <path className="pk-rib" d="M86 26 Q96 62 86 98" />
          <path className="pk-rib" d="M104 34 Q116 62 104 90" />
          {/* The face squeezed toward the right edge and clipped to the body, so it wraps round. */}
          <g className="pk-face" clipPath="url(#pk-round)">
            <g transform="translate(110 0) scale(.55 1) translate(-70 0)">{face}</g>
          </g>
        </>
      ) : (
        <>
          <path className="pk-rib" d="M50 26 Q36 62 50 98" />
          <path className="pk-rib" d="M90 26 Q104 62 90 98" />
          <path className="pk-rib" d="M70 24 Q66 62 70 100" />
          {/* The face from the plush: arched eyes, a triangle nose, a wide grin with one square tooth;
              from behind, only the plush's tag. */}
          {view === 'front' ? <g className="pk-face">{face}</g> : <path className="pk-tag" d="M64 94 L76 94 L75 106 L65 106 Z" />}
        </>
      )}
      <g className="pk-stem">
        <path d="M64 26 Q63 14 68 9 L75 10 Q72 17 74 26 Z" fill="#1a6f5a" />
        <path d="M66 24 Q46 8 34 20 Q48 28 66 26 Z" fill="url(#pk-leaf)" />
        <path d="M74 24 Q94 6 106 20 Q90 30 74 26 Z" fill="url(#pk-leaf)" />
      </g>
      {view === 'side' && (
        <g className="pk-arm pk-arm-near">
          <path d="M70 84 Q90 104 112 98" />
          <g className="pk-glove">
            <circle cx="117" cy="96" r="7.5" />
            <path className="pk-cuff" d="M109 98 Q112 104 117 103" />
          </g>
        </g>
      )}
    </svg>
  )
}

/** The platypus on all fours, green like the rendered one in the sky: tail, body, head, a pale bill, a big white eye, four short legs. */
export function Platypus({ className = '', goggles = false }: { className?: string; goggles?: boolean }) {
  return (
    <svg className={`cast platypus ${className}`} viewBox="0 0 130 72" aria-hidden="true">
      <defs>
        <linearGradient id="pl-fur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#62d38c" />
          <stop offset="1" stopColor="#2f9a5e" />
        </linearGradient>
      </defs>
      <ellipse className="pl-tail" cx="20" cy="42" rx="19" ry="7.5" fill="#2a8050" />
      <g className="pl-leg pl-leg-a"><rect x="38" y="48" width="7" height="13" rx="3" /><path d="M34 62 L48 62 L46 58 Z" /></g>
      <g className="pl-leg pl-leg-b"><rect x="76" y="48" width="7" height="13" rx="3" /><path d="M72 62 L86 62 L84 58 Z" /></g>
      <ellipse cx="58" cy="40" rx="34" ry="17" fill="url(#pl-fur)" />
      <g className="pl-leg pl-leg-b"><rect x="46" y="49" width="7" height="13" rx="3" /><path d="M42 63 L56 63 L54 59 Z" /></g>
      <g className="pl-leg pl-leg-a"><rect x="84" y="48" width="7" height="13" rx="3" /><path d="M80 62 L94 62 L92 58 Z" /></g>
      <circle cx="91" cy="33" r="13" fill="url(#pl-fur)" />
      <rect className="pl-bill" x="98" y="30" width="28" height="11" rx="5.5" />
      <circle cx="120" cy="33" r="1" fill="#1d1b22" />
      <circle cx="92" cy="25" r="4.6" fill="#f4f6f2" />
      <circle cx="94" cy="25.4" r="2.2" fill="#16131a" />
      <circle cx="94.6" cy="24.6" r=".7" fill="#fff" />
      {goggles && (
        <g className="pl-goggles">
          <path d="M80 26 L104 26" stroke="#3a2a1c" strokeWidth="3" />
          <circle cx="94" cy="26" r="5" fill="#9fe3ff" stroke="#3a2a1c" strokeWidth="2" opacity=".9" />
        </g>
      )}
    </svg>
  )
}

/** The platypus on its hind legs, in a trench coat and a fedora: the city's version. */
export function PlatypusNoir({ className = '', band = false }: { className?: string; band?: boolean }) {
  return (
    <svg className={`cast platypus-noir ${className}`} viewBox="0 0 76 112" aria-hidden="true">
      <ellipse className="pl-tail" cx="14" cy="92" rx="13" ry="5" fill="#2a8050" transform="rotate(-18 14 92)" />
      <g className="pl-leg pl-leg-a"><rect x="27" y="90" width="7" height="14" rx="3" fill="#2f9a5e" /><path d="M24 106 L38 106 L36 101 Z" fill="#1e5e3a" /></g>
      <g className="pl-leg pl-leg-b"><rect x="40" y="90" width="7" height="14" rx="3" fill="#2f9a5e" /><path d="M37 106 L51 106 L49 101 Z" fill="#1e5e3a" /></g>
      <g className="pl-coat">
        <path d="M22 40 L50 40 L57 95 L15 95 Z" fill="#b8935a" />
        <path d="M36 40 L36 95" stroke="#8f6f40" strokeWidth="1.4" />
        <path d="M22 40 L36 56 L50 40" fill="none" stroke="#8f6f40" strokeWidth="2" />
        <rect x="18" y="68" width="37" height="5" fill="#7a5a32" />
        <rect x="33" y="67" width="6" height="7" rx="1" fill="none" stroke="#d8c08a" strokeWidth="1.2" />
        <circle cx="40" cy="58" r="1.4" fill="#5a4325" />
        <circle cx="40" cy="80" r="1.4" fill="#5a4325" />
      </g>
      <g className="pl-arm">
        <path d="M48 44 Q60 56 58 68" fill="none" stroke="#b8935a" strokeWidth="8" strokeLinecap="round" />
        <circle cx="58" cy="70" r="4" fill="#2f9a5e" />
      </g>
      <circle cx="37" cy="30" r="12.5" fill="#4cbf78" />
      <rect className="pl-bill" x="44" y="27" width="24" height="9.5" rx="4.7" />
      <circle cx="41" cy="24" r="4" fill="#f4f6f2" />
      <circle cx="42.8" cy="24.4" r="1.9" fill="#16131a" />
      <circle cx="43.4" cy="23.7" r=".6" fill="#fff" />
      {band ? (
        <rect className="pl-band" x="24" y="19" width="26" height="4" rx="2" />
      ) : (
        <g className="pl-hat">
          <ellipse cx="37" cy="20" rx="18" ry="3.6" fill="#3b2f25" />
          <path d="M27 20 Q26 6 37 6 Q48 6 47 20 Z" fill="#4a3b2e" />
          <rect x="27" y="15" width="20" height="3" fill="#8a2f2f" />
        </g>
      )}
    </svg>
  )
}

/** The flying saucer: a glass dome, a lavender disc, lights that chase round its rim. */
export function Saucer({ className = '' }: { className?: string }) {
  return (
    <svg className={`cast saucer ${className}`} viewBox="0 0 120 60" aria-hidden="true">
      <defs>
        <linearGradient id="uf-disc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d8d4ff" />
          <stop offset="0.55" stopColor="#8f8ad0" />
          <stop offset="1" stopColor="#4e4a86" />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="25" rx="21" ry="17" fill="#e9e6ff" opacity=".88" />
      <ellipse cx="53" cy="18" rx="7" ry="4" fill="#fff" opacity=".7" />
      <ellipse cx="60" cy="35" rx="57" ry="12.5" fill="url(#uf-disc)" />
      <ellipse cx="60" cy="38" rx="50" ry="5" fill="#3d3a6e" />
      {[16, 36, 60, 84, 104].map((x, i) => (
        <circle key={x} className={`uf-light uf-light-${i % 3}`} cx={x} cy={i === 2 ? 39 : 38} r="3.2" />
      ))}
      <ellipse cx="60" cy="46" rx="18" ry="3.5" className="uf-glow" />
    </svg>
  )
}

/** The whale: slate-blue back, pale grooved belly, a fluke, a fin and a small eye. */
export function Whale({ className = '', holo = false }: { className?: string; holo?: boolean }) {
  return (
    <svg className={`cast whale ${holo ? 'is-holo' : ''} ${className}`} viewBox="0 0 210 96" aria-hidden="true">
      <defs>
        <linearGradient id="wh-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5d72bf" />
          <stop offset="1" stopColor="#38467f" />
        </linearGradient>
        <pattern id="wh-scan" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1.4" fill="currentColor" opacity=".55" />
        </pattern>
      </defs>
      <g className="wh-fluke">
        <path d="M34 52 L8 30 Q18 50 4 70 Z" />
      </g>
      <path className="wh-body" d="M30 52 C40 24 128 12 180 32 C198 39 204 54 190 63 C160 82 74 84 44 66 Z" />
      <path className="wh-belly" d="M60 66 C92 80 160 78 190 63 C176 70 132 78 92 74 C78 72 68 70 60 66 Z" />
      <g className="wh-grooves">
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M${100 + i * 18} ${70 + i * 0.6} Q${110 + i * 18} ${73} ${120 + i * 18} ${71 - i}`} />
        ))}
      </g>
      <path className="wh-fin" d="M120 62 Q112 82 96 86 Q110 74 108 62 Z" />
      <circle cx="170" cy="48" r="2.6" className="wh-eye" />
    </svg>
  )
}

/** A patrol robot: a boxy head with a red visor, an aerial, a chest light, stubby legs. */
export function Robot({ className = '' }: { className?: string }) {
  return (
    <svg className={`cast robot ${className}`} viewBox="0 0 54 86" aria-hidden="true">
      <path d="M27 4 L27 12" stroke="#9aa0b8" strokeWidth="2" />
      <circle cx="27" cy="3.5" r="2.6" className="rb-tip" />
      <rect x="12" y="12" width="30" height="20" rx="4" fill="#8d93ad" />
      <rect x="15" y="18" width="24" height="7" rx="3.5" className="rb-visor" />
      <rect x="10" y="34" width="34" height="30" rx="5" fill="#6f7591" />
      <circle cx="27" cy="46" r="4" className="rb-core" />
      <g className="rb-arm rb-arm-l"><rect x="3" y="36" width="7" height="22" rx="3.5" fill="#8d93ad" /></g>
      <g className="rb-arm rb-arm-r"><rect x="44" y="36" width="7" height="22" rx="3.5" fill="#8d93ad" /></g>
      <g className="rb-leg rb-leg-a"><rect x="15" y="64" width="8" height="16" rx="3" fill="#5a6078" /><rect x="12" y="78" width="13" height="5" rx="2" fill="#40455c" /></g>
      <g className="rb-leg rb-leg-b"><rect x="31" y="64" width="8" height="16" rx="3" fill="#5a6078" /><rect x="29" y="78" width="13" height="5" rx="2" fill="#40455c" /></g>
    </svg>
  )
}
