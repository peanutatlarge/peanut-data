// ─────────────────────────────────────────────
// NIGHTLY EXPORT  Baserow → public file for the app
//
// Reads the 3 Baserow tables with a SECRET token (never inside the app),
// keeps only what the public may see:
//   · shows with Statut = « publié » (no « à valider », « refusé »…)
//   · public columns only (no internal comment, no « Soumis par », no venue e-mails)
// finds missing venue coordinates once (Swiss federal geo service),
// and writes one file: peanut-data.json (root of the public repository peanut-data)
//
// Run:  BASEROW_TOKEN=xxxx node scripts/export-baserow.mjs
// ─────────────────────────────────────────────
import { writeFile } from 'node:fs/promises';

const API = 'https://api.baserow.io';
const TABLES = { villes: 1234612, lieux: 1234639, expo: 1234653 }; // same numbers as src/constants/baserow.ts
// token: GitHub secret BASEROW_TOKEN (Settings → Secrets and variables → Actions). Never written in a file.
const TOKEN = process.env.BASEROW_TOKEN;
const OUT = new URL('../peanut-data.json', import.meta.url); // published at the root of this public repository
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

if (!TOKEN) {
  console.error('BASEROW_TOKEN manquant');
  process.exit(1);
}

// ── same conversions as src/data/remote.ts ──
function txt(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(txt).filter(Boolean).join(', ');
  if (typeof v === 'object' && 'value' in v) return txt(v.value);
  return '';
}
const bool = (v) => v === true || v === 'true' || v === 'True' || v === 1;
function num(v) {
  const n = parseFloat(txt(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function date(v) {
  const s = txt(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
const images = (v) => (Array.isArray(v) ? v.map((f) => (f && typeof f === 'object' ? txt(f.url) : '')).filter(Boolean) : []);
const firstLinkId = (v) => (Array.isArray(v) && v[0] && typeof v[0] === 'object' ? v[0].id : null);

async function getTable(id) {
  const rows = [];
  let url = `${API}/api/database/rows/table/${id}/?user_field_names=true&size=200`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Token ${TOKEN}` } });
    if (!res.ok) throw new Error(`Baserow ${res.status} (table ${id})`);
    const page = await res.json();
    rows.push(...page.results);
    url = page.next;
  }
  return rows;
}

// Swiss federal geo service (geo.admin.ch): address → coordinates, free, no key
async function geocode(address) {
  try {
    const u = `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=address&limit=1&sr=4326&searchText=${encodeURIComponent(address)}`;
    const res = await fetch(u);
    if (!res.ok) return null;
    const a = (await res.json()).results?.[0]?.attrs;
    return a && Number.isFinite(a.lat) && Number.isFinite(a.lon) ? { lat: a.lat, lng: a.lon } : null;
  } catch {
    return null;
  }
}

const [villes, lieux, expos] = await Promise.all([getTable(TABLES.villes), getTable(TABLES.lieux), getTable(TABLES.expo)]);

const venueIdByName = new Map(lieux.map((l) => [txt(l['Nom']), `v${l.id}`]));

const venues = [];
const notLocated = [];
for (const l of lieux) {
  const v = {
    id: `v${l.id}`,
    name: txt(l['Nom']),
    type: txt(l['Type']),
    city: txt(l['Ville']),
    address: txt(l['Adresse']),
    zip: txt(l['NPA']) || null,
    lat: num(l['Latitude']),
    lng: num(l['Longitude']),
    hours: DAYS.map((d) => txt(l[d])),
    website: txt(l['Site web']) || null,
    // NOT exported: Email, internal columns
  };
  if ((v.lat == null || v.lng == null) && v.address) {
    const c = await geocode(`${v.address} ${v.zip ?? ''} ${v.city}`.trim());
    if (c) Object.assign(v, c);
    else notLocated.push(v.name);
  }
  venues.push(v);
}

const shows = expos
  .filter((e) => txt(e['Statut']) === 'publié') // only what the public may see
  .map((e) => {
    const lieu = firstLinkId(e['Lieu']);
    return {
      id: `s${e.id}`,
      title: txt(e['Titre']),
      artists: txt(e['Artistes']).replace(/\.$/, ''),
      venueId: lieu != null ? `v${lieu}` : (venueIdByName.get(txt(e['Lieu']).split(',')[0].trim()) ?? null),
      start: date(e['Date début']),
      end: date(e['Date fin']),
      images: images(e['Images']),
      credits: txt(e['Crédits photo']) || null,
      text: txt(e['Texte']) || null,
      textFr: txt(e['Texte FR']) || null,
      textDe: txt(e['Texte DE']) || null,
      textIt: txt(e['Texte IT']) || null,
      vernissageDate: date(e['Vernissage date']),
      vernissageTime: txt(e['Vernissage heure']) || null,
      link: txt(e['Lien']) || null,
      ticketLink: txt(e['Lien billets']) || null,
      featured: bool(e['Featured']),
      status: 'publié',
      permanent: bool(e['Permanent']),
      note: txt(e['Note']) || null,
      // NOT exported: Commentaire interne, Soumis par, Accord images
    };
  });

const data = {
  exportedAt: new Date().toISOString(),
  cities: villes.map((v) => ({ name: txt(v['Nom']), region: txt(v['Région']) || null })),
  venues,
  shows,
};

await writeFile(OUT, JSON.stringify(data));
console.log(`OK: ${shows.length} expos publiées (sur ${expos.length}), ${venues.length} lieux, ${villes.length} villes`);
if (notLocated.length) console.log(`Sans coordonnées (adresse introuvable): ${notLocated.join(' · ')}`);
