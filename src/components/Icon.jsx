import React, { useMemo } from 'react';

// Eagerly inline every downloaded Lucide SVG as a raw string at build time.
// Bundling them means the app ships its own icons and never touches a CDN at
// runtime — it works fully offline. Icons use stroke="currentColor", so color
// is inherited from the surrounding text color.
const rawIcons = import.meta.glob('../assets/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Map "house" -> raw svg string, derived from the file name.
const ICONS = Object.fromEntries(
  Object.entries(rawIcons).map(([path, raw]) => {
    const name = path.split('/').pop().replace('.svg', '');
    return [name, raw];
  })
);

// Render an inline SVG by name. We drop the file's hard-coded width/height so
// the `size` prop (via inline style) controls dimensions, and strip the license
// comment to keep the DOM tidy.
export default function Icon({ name, size = 18, className = '', title }) {
  const html = useMemo(() => {
    const raw = ICONS[name];
    if (!raw) return '';
    return raw
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\swidth="\d+"/, '')
      .replace(/\sheight="\d+"/, '');
  }, [name]);

  if (!html) return null;
  return (
    <span
      role="img"
      aria-label={title || name}
      className={`inline-flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
