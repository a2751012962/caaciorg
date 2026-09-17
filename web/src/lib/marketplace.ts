export type MarketplacePlacement = 'home' | 'resources' | 'navigation' | 'footer';

// Campaign values describe the link placement only; never include member data.
export function marketplaceUrl(placement: MarketplacePlacement) {
  return `https://www.illinimarket.com/?utm_source=caaci&utm_medium=website&utm_campaign=community_marketplace&utm_content=${placement}`;
}
