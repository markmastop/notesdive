import { invoke } from "@tauri-apps/api/core";
import type { MouseEvent } from "react";

export function webUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname && !/[\u0000-\u001f\u007f]/.test(value) ? url.href : null;
  } catch {
    return null;
  }
}

export function openWebLink(event: MouseEvent<HTMLElement>, onError: (message: string) => void) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>("a[data-web-link]");
  if (!link || !event.currentTarget.contains(link)) return;
  event.preventDefault();
  event.stopPropagation();
  const url = webUrl(link.href);
  if (!url) return;
  void invoke("open_web_link", { url }).catch(() => onError("Could not open this link in your browser."));
}
