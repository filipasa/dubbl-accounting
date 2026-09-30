import { useEffect } from "react";

/**
 * Sets the browser tab title for client-component dashboard pages.
 * Format: "Section · Page · fixbooks"
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · fixbooks`;
  }, [title]);
}
