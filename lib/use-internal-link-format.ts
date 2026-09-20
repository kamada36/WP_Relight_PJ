"use client";

import { useCallback, useSyncExternalStore } from "react";
import { INTERNAL_LINK_FORMATS, type InternalLinkFormat } from "@/types";

const STORAGE_KEY = "wp-relight:internal-link-format";
const CHANGE_EVENT = "wp-relight:internal-link-format-change";
const DEFAULT_FORMAT: InternalLinkFormat = "blogcard";

/** Fallback for when localStorage is unavailable (private mode etc.) so the choice still holds for the session. */
let memoryFormat: InternalLinkFormat = DEFAULT_FORMAT;

function readFormat(): InternalLinkFormat {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return INTERNAL_LINK_FORMATS.find((format) => format === saved) ?? memoryFormat;
  } catch {
    return memoryFormat;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * The user's preferred way to insert internal links (blog card / text link), remembered per browser.
 * Reads through useSyncExternalStore so the server render and first client render both use the
 * default, then the saved choice is applied without a hydration mismatch.
 */
export function useInternalLinkFormat(): [InternalLinkFormat, (format: InternalLinkFormat) => void] {
  const format = useSyncExternalStore(subscribe, readFormat, () => DEFAULT_FORMAT);

  const setFormat = useCallback((next: InternalLinkFormat) => {
    memoryFormat = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal: the choice just won't persist across visits.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [format, setFormat];
}
