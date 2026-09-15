import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { EVENT_COLUMNS, isUpcoming, type EventRow } from './events';

export type EventsStatus = 'loading' | 'ready' | 'error';

// Published events that are still on — ends_at in the future, or no end and
// starts_at in the future — soonest first, read straight from public.events
// (RLS lets anyone read published rows; the explicit filter keeps an admin's
// drafts off the public pages). Two plain filters instead of one or() keep the
// timestamp out of PostgREST's logic-tree syntax.
export function useUpcomingEvents() {
  const [status, setStatus] = useState<EventsStatus>('loading');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    const now = Date.now();
    const iso = new Date(now).toISOString();
    const published = () => supabase.from('events').select(EVENT_COLUMNS).eq('published', true);
    Promise.all([
      published().gte('ends_at', iso),
      published().is('ends_at', null).gte('starts_at', iso),
    ])
      .then((results) => {
        if (!alive) return;
        if (results.some((r) => r.error)) {
          setStatus('error');
          return;
        }
        const byId = new Map<string, EventRow>();
        for (const r of results)
          for (const row of (r.data ?? []) as unknown as EventRow[]) byId.set(row.id, row);
        const rows = [...byId.values()]
          .filter((ev) => isUpcoming(ev, now))
          .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
        setEvents(rows);
        setStatus('ready');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, events, reload };
}
