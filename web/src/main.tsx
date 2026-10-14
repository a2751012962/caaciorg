import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { loadSiteContent, useSiteContentVersion } from './lib/siteContent';
import './index.css';

// Saved page copy (the admin's Page content tab) is written into the data
// objects in place, which React cannot see. This wrapper re-renders the whole
// tree when that happens: a fresh <App /> element makes every component below
// render again with the same state (nothing is remounted, so a page keeps its
// scroll position and form input). No component above the pages is memoised.
function SiteContentRoot() {
  useSiteContentVersion();
  return <App />;
}

// Waits for the saved copy (≤ 800 ms) so the first paint already shows it.
void loadSiteContent().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SiteContentRoot />
    </StrictMode>,
  );
});
