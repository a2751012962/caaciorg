// Copy that carries a value ("{count} events") lives in the page data files
// as a template, so the admin Page content tab can reword it without code.
// fill('{count} events', { count: 3 }) → '3 events'. An unknown {name} stays
// as typed, so a typo shows on the page instead of vanishing.
export const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
