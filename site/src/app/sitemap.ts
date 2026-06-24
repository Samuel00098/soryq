import type { MetadataRoute } from 'next';
import { productionUrl } from '@/lib/config';

// Static export emits this as /sitemap.xml at build time.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = ['', '/changelog', '/privacy', '/terms'];
  return routes.map((path) => ({
    url: `${productionUrl}${path}`,
    lastModified: now,
    changeFrequency: path === '' || path === '/changelog' ? 'weekly' : 'monthly',
    priority: path === '' ? 1 : 0.7,
  }));
}
