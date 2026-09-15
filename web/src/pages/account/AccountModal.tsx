import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface AccountModalProps {
  onClose: () => void;
  labelledBy: string;
  className: string;
  children: ReactNode;
}

// The dimmed overlay the flagged account dialogs share (lib/features.ts). It is
// portalled to <body> so the page's stacking contexts (the z-20 content
// wrapper) cannot put it under the site header. Escape closes it.
export function AccountModal({ onClose, labelledBy, className, children }: AccountModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={className}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
