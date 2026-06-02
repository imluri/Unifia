import React from 'react';

function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// A progress bar driven by the { percent, bytesReceived, totalBytes } payload
// the main process emits during a module install.
export default function DownloadProgress({ progress }) {
  if (!progress) return null;
  const { percent = 0, bytesReceived = 0, totalBytes = 0 } = progress;
  const complete = percent >= 100;
  return (
    <div className="mt-2">
      <div className="h-2 w-full overflow-hidden rounded bg-neutral-800">
        {/* Width eases over 300ms; on completion it flashes white then settles
            to green via the dl-complete keyframe. */}
        <div
          className={`h-full transition-[width] duration-300 ease-out ${
            complete ? 'dl-complete' : 'bg-accent'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-neutral-500">
        <span>{percent}%</span>
        <span>
          {fmtBytes(bytesReceived)}
          {totalBytes ? ` / ${fmtBytes(totalBytes)}` : ''}
        </span>
      </div>
    </div>
  );
}
