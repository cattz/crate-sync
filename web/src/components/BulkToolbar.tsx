import type { ReactNode } from "react";

interface BulkToolbarProps {
  count: number;
  onClear: () => void;
  children?: ReactNode;
}

export function BulkToolbar({ count, onClear, children }: BulkToolbarProps) {
  if (count === 0) return null;

  return (
    <div className="bulk-toolbar">
      <span className="text-sm">
        <strong>{count}</strong> selected
      </span>
      <button onClick={onClear}>Clear</button>
      {children}
    </div>
  );
}
