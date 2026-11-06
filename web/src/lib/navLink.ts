import type { MouseEvent } from 'react';
import { isPlainClick } from './articleRoutes';

// A control that goes to a page is a real link: a screen reader announces it
// as one, and it can be opened in a new tab or copied. A plain click still
// navigates in place through the app, without a page load.
//
// `page` is a page id, optionally with a #section ("events#past"), as the
// app's navigateTo takes it.
export function pageHref(page: string): string {
  const prefix = /^\/zh(?=\/|$)/.test(window.location.pathname) ? '/zh' : '';
  const [id, hash] = page.split('#');
  const path =
    id === 'home'
      ? `${prefix}/`
      : id === 'columns'
        ? `${prefix}/about/columns/`
        : `${prefix}/${id}/`;
  return hash ? `${path}#${hash}` : path;
}

export function navLinkProps(page: string, go: (page: string) => void, currentPage?: string) {
  return {
    href: pageHref(page),
    'aria-current': currentPage === page ? ('page' as const) : undefined,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      // Ctrl/Cmd/Shift/middle click keep the browser's own behaviour.
      if (!isPlainClick(e)) return;
      e.preventDefault();
      go(page);
    },
  };
}
