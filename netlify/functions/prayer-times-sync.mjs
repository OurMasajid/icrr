import { getStore } from '@netlify/blobs';

const WIDGET_URL =
  'https://timing.athanplus.com/masjid/widgets/embed?theme=3&masjid_id=E5AvRnAX';

function trim(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function parseDay(block) {
  const dateMatch = block.match(
    /<div class="slider-content">\s*<p>([^<]+)<\/p>\s*<p>([^<]+)<\/p>/
  );
  const date = dateMatch ? trim(dateMatch[1]) : null;
  const hijri = dateMatch ? trim(dateMatch[2]) : null;

  const prayers = {};
  const rowRe =
    /<tr[^>]*class="no-border[^"]*"[^>]*>\s*<td>.*?<\/span>\s*([\w]+)\s*<\/td>\s*(?:<td[^>]*class="one-span"[^>]*>\s*<span>([^<]+)<\/span><\/td>\s*<td><b>([^<]+)<\/b><\/td>|<td[^>]*class="cnter-jummah"[^>]*>\s*<span>([^<]+)<\/span><\/td>)/gs;

  let m;
  while ((m = rowRe.exec(block)) !== null) {
    const name = trim(m[1]);
    if (m[4]) {
      prayers[name] = { starts: trim(m[4]) };
    } else {
      prayers[name] = { starts: trim(m[2]), iqamah: trim(m[3]) };
    }
  }

  const jumuah = [];
  const jumuahRe = /<li><b>([^<]+)<\/b>\s*<p>\s*(.*?)\s*<\/p>\s*<\/li>/gs;
  while ((m = jumuahRe.exec(block)) !== null) {
    jumuah.push({ time: trim(m[1]), label: trim(m[2]) });
  }

  return { date, hijri, prayers, jumuah: jumuah.length ? jumuah : undefined };
}

export default async () => {
  const store = getStore('prayer-times');

  const res = await fetch(WIDGET_URL);
  if (!res.ok) throw new Error(`Masjidal HTTP ${res.status}`);
  const html = await res.text();

  const items = html.split('carousel-item').slice(1);
  const days = items.map(parseDay).filter((d) => d.date);

  if (!days.length) throw new Error('Parsed zero days from widget');

  await store.setJSON('current', {
    days,
    fetched: new Date().toISOString(),
  });
};

export const config = {
  schedule: '*/30 5-23 * * *',
};
