"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

export interface ToastMessage {
  id: number;
  type: "success" | "error" | "warning";
  message: string;
}

const TOAST_STYLES: Record<ToastMessage["type"], string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

interface ToastStackProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          onClick={() => onDismiss(toast.id)}
          className={`flex w-full items-start gap-2 rounded-lg border px-4 py-3 text-left text-sm shadow-lg sm:w-auto sm:max-w-sm ${
            TOAST_STYLES[toast.type]
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : toast.type === "warning" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{toast.message}</span>
        </button>
      ))}
    </div>
  );
}
