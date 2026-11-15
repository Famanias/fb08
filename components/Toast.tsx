'use client';

interface ToastProps {
  message: string | null;
  visible: boolean;
}

export function Toast({ message, visible }: ToastProps) {
  return (
    <div
      className={`toast${visible && message ? ' show' : ''}`}
      id="toast"
      role="status"
      aria-live="polite"
    >
      {message ?? ''}
    </div>
  );
}
