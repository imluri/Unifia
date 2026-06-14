import React from 'react';
import Icon from '../Icon.jsx';

const VARIANTS = {
  primary: 'bg-accent text-accent-contrast hover:opacity-90 active:scale-95',
  secondary: 'bg-neutral-700 text-neutral-100 hover:bg-surface-hover',
  danger: 'bg-neutral-800 text-red-300 hover:bg-red-900/60',
  ghost: 'bg-transparent text-neutral-300 hover:bg-surface-hover',
};

const SIZES = {
  sm: 'px-2 py-1 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
};

// Shared button. Encapsulates the repeated rounded/transition/disabled patterns
// so every call site stays consistent. Forwards onClick/title/type/etc.
export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const iconSize = size === 'sm' ? 13 : 15;
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded font-medium transition disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Icon name="refresh-cw" size={iconSize} className="animate-spin" />
      ) : (
        icon && <Icon name={icon} size={iconSize} />
      )}
      {children}
    </button>
  );
}
