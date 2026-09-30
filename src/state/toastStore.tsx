import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'good' | 'bad';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });

let nextToastId = 1;

/**
 * Toast system — port of the legacy toast(): role=alert for bad, status
 * otherwise; 6s lifetime for bad, 3.6s for others. Rendered top-right per
 * Studio convention.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextToastId++;
      setItems((current) => [...current, { id, message, kind }]);
      setTimeout(() => remove(id), kind === 'bad' ? 6000 : 3600);
    },
    [remove],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" data-testid="toasts">
        {items.map((item) => (
          <div
            key={item.id}
            className={`toast toast--${item.kind}`}
            role={item.kind === 'bad' ? 'alert' : 'status'}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
