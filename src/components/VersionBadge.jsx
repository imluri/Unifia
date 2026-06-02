import React from 'react';

// Shows a game/version string, colored green when it matches a reference
// version (e.g. host's) and red on mismatch. With no `match` prop it renders
// neutral, just displaying the version.
export default function VersionBadge({ version, match }) {
  let cls = 'bg-neutral-700 text-neutral-200';
  if (match === true) cls = 'bg-green-900/60 text-green-300 border border-green-700';
  else if (match === false) cls = 'bg-red-900/60 text-red-300 border border-red-700';

  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      v{String(version).replace(/^v/, '')}
    </span>
  );
}
