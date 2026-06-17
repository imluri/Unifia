import React from 'react';
import Icon from '../Icon.jsx';

const SIZES = { sm: 'w-80', md: 'w-[34rem]', lg: 'w-[52rem]' };

// Shared modal: overlay + click-away + header (title/close) + scrollable body +
// optional footer. Renders nothing when closed.
export default function Modal({ open, onClose, title, size = 'md', footer, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`flex max-h-[85vh] flex-col rounded-lg bg-card ring-1 ring-white/10 ${SIZES[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-start justify-between border-b border-border-subtle px-5 py-4">
            <h3 className="text-lg font-semibold text-neutral-100">{title}</h3>
            <button
              onClick={onClose}
              className="flex items-center rounded p-1 text-neutral-400 hover:bg-surface-hover hover:text-neutral-100"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        <div className="space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
