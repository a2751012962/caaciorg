import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../lib/useDialogFocus';

interface AccountModalProps {
  onClose: () => void;
  labelledBy: string;
  className: string;
  children: ReactNode;
}

// The dimmed overlay the flagged account dialogs share (lib/features.ts). It is
// portalled to <body> so the page's stacking contexts (the z-20 content
// wrapper) cannot put it under the site header. Escape closes it, focus is
// kept inside while it is open and returns to the opener afterwards.
export function AccountModal({ onClose, labelledBy, className, children }: AccountModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={className}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
