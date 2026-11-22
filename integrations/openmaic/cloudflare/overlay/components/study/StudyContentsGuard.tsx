'use client';
import { useEffect, useRef } from 'react';
import { useStudyPhone } from '../../lib/study-classroom/phone';

const FOCUSABLE = 'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** On phones the directory covers the lesson, so its focus and background behave like a dialog. */
export function StudyContentsGuard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const phone = useStudyPhone();
  const close = useRef(onClose); close.current = onClose;
  const opener = useRef<HTMLElement | null>(null);
  const opened = useRef(false);
  if (open && !opened.current && typeof document !== 'undefined') opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  opened.current = open;
  useEffect(() => {
    if (!open || !phone) return;
    const sidebar = document.querySelector<HTMLElement>('.study-scene-sidebar');
    if (!sidebar) return;
    const background = Array.from(sidebar.parentElement?.children ?? []).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== sidebar && !element.classList.contains('study-contents-backdrop'));
    const inert = background.map(element => element.inert);
    const overflow = document.body.style.overflow;
    sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true'); sidebar.setAttribute('aria-label', '章節目錄'); sidebar.tabIndex = -1;
    background.forEach(element => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    const focusables = () => Array.from(sidebar.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => element.getClientRects().length && !element.closest('[inert], [hidden]'));
    const focus = () => (sidebar.querySelector<HTMLElement>('[aria-current="step"]') ?? focusables()[0] ?? sidebar).focus();
    const onFocus = (event: FocusEvent) => { if (!sidebar.contains(event.target as Node)) focus(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables(), first = items[0], last = items.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); sidebar.focus(); }
      else if (event.shiftKey && (active === first || active === sidebar || !sidebar.contains(active))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (active === last || active === sidebar || !sidebar.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true); document.addEventListener('focusin', onFocus); focus();
    return () => {
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('focusin', onFocus);
      background.forEach((element, index) => { element.inert = inert[index]; });
      sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal'); sidebar.removeAttribute('aria-label'); sidebar.removeAttribute('tabindex');
      document.body.style.overflow = overflow;
      const trigger = opener.current;
      queueMicrotask(() => {
        const modal = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
        if (trigger?.isConnected && !trigger.closest('[inert]') && (!modal || modal.contains(trigger))) trigger.focus();
      });
    };
  }, [open, phone]);
  return null;
}
