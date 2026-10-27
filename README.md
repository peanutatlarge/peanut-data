# peanut-data

Public data of the **Peanut at Large** app (Swiss exhibition guide).

- `peanut-data.json` — the published shows, venues and cities. Rebuilt every night from Baserow.
- `scripts/export-baserow.mjs` — the export. It keeps only what the public may see
  (shows with status « publié », no internal comments, no « Soumis par », no venue e-mails).
- `.github/workflows/export.yml` — runs the export every night, or by hand:
  **Actions** tab → **Export Baserow** → **Run workflow**.

The Baserow token is a GitHub secret (`BASEROW_TOKEN`), never in a file.

The app reads: https://raw.githubusercontent.com/peanutatlarge/peanut-data/main/peanut-data.json
