import type { MetadataRoute } from 'next';
import { productionUrl } from '@/lib/config';

// Static export emits this as /robots.txt at build time.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${productionUrl}/sitemap.xml`,
  };
}
