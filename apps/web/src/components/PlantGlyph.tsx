import type { SpeciesSnapshot } from '@shanhai/contracts';

export function PlantGlyph({ species, large = false }: { species: SpeciesSnapshot; large?: boolean }) {
  const blooming = species.phenology.stage.includes('bloom');
  const fallen = species.phenology.stage === 'leaf_fall';
  const color = species.phenology.dominantColor;
  const stroke = 'rgba(28, 54, 37, 0.28)';
  const leafPaths = getLeafPaths(species.phenology.leafTexture);

  return (
    <svg
      className={`plant-glyph ${large ? 'plant-glyph-large' : ''}`}
      viewBox="0 0 160 150"
      role="img"
      aria-label={`${species.name}形态示意`}
    >
      <path d="M18 130 C42 112 56 89 76 59 C96 84 112 108 142 132" fill="none" stroke="#365b42" strokeWidth="5" strokeLinecap="round" />
      {!fallen &&
        leafPaths.map((path, index) => (
          <path
            key={path}
            d={path}
            fill={color}
            stroke={stroke}
            transform={`rotate(${index % 2 === 0 ? -7 : 8} ${80 + (index % 3) * 14} ${55 + index * 12})`}
          />
        ))}
      {fallen && (
        <>
          <ellipse cx="57" cy="133" rx="30" ry="9" fill="rgba(110, 84, 54, .18)" />
          <path d={leafPaths[0]!} fill={color} stroke={stroke} transform="translate(-30 48) rotate(78 54 72)" />
          <path d={leafPaths[1]!} fill={color} stroke={stroke} transform="translate(65 51) rotate(-74 54 72)" />
        </>
      )}
      {blooming && (
        <g>
          <circle cx="74" cy="69" r="7" fill="#f8e7c8" stroke="#8a664b" strokeWidth="1.5" />
          <circle cx="91" cy="88" r="6" fill="#f8e7c8" stroke="#8a664b" strokeWidth="1.5" />
          <circle cx="109" cy="106" r="5.5" fill="#f8e7c8" stroke="#8a664b" strokeWidth="1.5" />
        </g>
      )}
    </svg>
  );
}

function getLeafPaths(texture: SpeciesSnapshot['phenology']['leafTexture']): string[] {
  if (texture === 'needle') {
    return [
      'M52 45 L68 70 L59 73 Z',
      'M70 55 L84 82 L75 84 Z',
      'M92 70 L105 100 L96 102 Z'
    ];
  }
  if (texture === 'compound') {
    return [
      'M41 50 Q52 31 65 50 Q52 67 41 50 Z',
      'M69 57 Q81 38 94 57 Q81 75 69 57 Z',
      'M97 74 Q110 54 123 74 Q110 93 97 74 Z'
    ];
  }
  return [
    'M40 48 C47 22 72 26 78 51 C66 62 49 61 40 48 Z',
    'M67 61 C75 35 99 39 104 65 C92 76 76 75 67 61 Z',
    'M94 78 C102 51 126 56 132 82 C119 94 103 92 94 78 Z'
  ];
}
