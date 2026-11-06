import type { MouseEvent } from 'react';

// A menu entry that goes to a page is a real link: a screen reader announces it
// as one, and it can be opened in a new tab or copied. A plain click still
// navigates in place through the app, without a page load.
export function pageHref(page: string): string {
  const prefix = /^\/zh(?=\/|$)/.test(window.location.pathname) ? '/zh' : '';
  if (page === 'home') return `${prefix}/`;
  if (page === 'columns') return `${prefix}/about/columns/`;
  return `${prefix}/${page}/`;
}

export function navLinkProps(page: string, go: (page: string) => void, currentPage?: string) {
  return {
    href: pageHref(page),
    'aria-current': currentPage === page ? ('page' as const) : undefined,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      // Ctrl/Cmd/Shift/middle click keep the browser's own behaviour.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(page);
    },
  };
}
