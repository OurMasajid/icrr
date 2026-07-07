import { getStore } from '@netlify/blobs';

export default async () => {
  const store = getStore('prayer-times');
  const data = await store.get('current', { type: 'json' });

  if (!data) {
    return new Response(JSON.stringify({ error: 'no cached data yet' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
    },
  });
};
