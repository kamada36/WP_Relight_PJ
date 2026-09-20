"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyButtonProps {
  /** Text placed on the clipboard. */
  text: string;
  /** Tooltip describing what gets copied. */
  title: string;
  label?: string;
}

export function CopyButton({ text, title, label = "コピー" }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Clipboard access needs a secure context (https / localhost) and user permission.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      className="flex shrink-0 items-center gap-1 rounded-md border border-sky-200 bg-white px-1.5 py-0.5 text-[11px] text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-900 dark:bg-transparent dark:text-sky-200 dark:hover:bg-sky-900"
    >
      {state === "copied" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {state === "copied" ? "コピー済" : state === "failed" ? "失敗" : label}
    </button>
  );
}
