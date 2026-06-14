import React from 'react';
import Icon from './Icon.jsx';

// Shared 40x40 game icon (or package placeholder). Used by GameCard (library)
// and DiscoverCard (Thunderstore catalog) so both rows look identical.
export default function GameIcon({ src, onError }) {
  return src ? (
    <img
      src={src}
      alt=""
      onError={onError}
      className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-border-default"
    />
  ) : (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-700 text-neutral-500">
      <Icon name="package" size={18} />
    </div>
  );
}
