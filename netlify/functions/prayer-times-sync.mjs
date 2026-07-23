import { getStore } from '@netlify/blobs';

const MASJID_ID = 'E5AvRnAX';
const TIMEZONE = 'America/Chicago';
const RANGE_DAYS = 7;

function trim(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function formatTime(t) {
  return trim(t).replace(/(\d)(AM|PM)/i, '$1 $2');
}

function localDateStr(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(date);
}

function buildHijri(hijriDate, hijriMonth) {
  if (!hijriDate || !hijriMonth) return null;
  const [day, year] = hijriDate.split(',').map((s) => s.trim());
  if (!day || !year) return null;
  return `${day} ${hijriMonth}, ${year}`;
}

function prayer(starts, iqamah) {
  const result = { starts: formatTime(starts) };
  if (iqamah) result.iqamah = formatTime(iqamah);
  return result;
}

function buildDay(salah, iqamah) {
  const prayers = {
    Fajr: prayer(salah.fajr, iqamah && iqamah.fajr),
    Sunrise: prayer(salah.sunrise, null),
    Zuhr: prayer(salah.zuhr, iqamah && iqamah.zuhr),
    Asr: prayer(salah.asr, iqamah && iqamah.asr),
    Maghrib: prayer(salah.maghrib, iqamah && iqamah.maghrib),
    Isha: prayer(salah.isha, iqamah && iqamah.isha),
  };

  const jumuah = [];
  if (iqamah && iqamah.jummah1) jumuah.push({ time: formatTime(iqamah.jummah1) });
  if (iqamah && iqamah.jummah2) jumuah.push({ time: formatTime(iqamah.jummah2) });

  return {
    date: salah.date,
    hijri: buildHijri(salah.hijri_date, salah.hijri_month),
    prayers,
    jumuah: jumuah.length ? jumuah : undefined,
  };
}

export default async () => {
  const store = getStore('prayer-times');

  const today = new Date();
  const from = localDateStr(today);
  const to = localDateStr(new Date(today.getTime() + (RANGE_DAYS - 1) * 86400000));

  const url = `https://masjidal.com/api/v1/time/range?masjid_id=${MASJID_ID}&from_date=${from}&to_date=${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Masjidal HTTP ${res.status}`);

  const json = await res.json();
  if (json.status !== 'success' || !json.data?.salah?.length) {
    throw new Error('Masjidal API returned no data');
  }

  const iqamahByDate = new Map((json.data.iqamah || []).map((i) => [i.date, i]));
  const days = json.data.salah.map((s) => buildDay(s, iqamahByDate.get(s.date)));

  await store.setJSON('current', {
    days,
    fetched: new Date().toISOString(),
  });
};

export const config = {
  schedule: '*/30 5-23 * * *',
};
