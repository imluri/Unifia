import React from 'react';

// Shows a game/version string, colored green when it matches a reference
// version (e.g. host's) and red on mismatch. With no `match` prop it renders
// neutral, just displaying the version.
//
// Steam games have no human-readable version, only a Steam `buildId`, so we
// fall back to "build <id>". When there's neither a version nor a build id and
// we're not in a comparison context (no `match`), the badge hides entirely
// rather than showing a meaningless "unknown".
export default function VersionBadge({ version, buildId, match }) {
  let cls = 'bg-neutral-700 text-neutral-200';
  if (match === true) cls = 'bg-green-900/60 text-green-300 border border-green-700';
  else if (match === false) cls = 'bg-red-900/60 text-red-300 border border-red-700';

  const hasVersion = version != null && version !== '' && version !== 'unknown';

  let label;
  if (hasVersion) label = `v${String(version).replace(/^v/, '')}`;
  else if (buildId) label = `build ${buildId}`;
  else label = match === undefined ? null : 'unknown';

  if (label === null) return null;

  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
