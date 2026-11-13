# kuititon app

Static web app (single `index.html` + `supabase-shim.js`) served by GitHub Pages at https://app.kuititon.com.

- `supabase-shim.js` – sign-in screens and the connection to Supabase (data, file storage, receipt reading, downloads).
- `supabase/schema.sql` – database, security rules, account limits and storage; run once in the Supabase SQL Editor.
- `supabase/functions/read-receipt/` – Edge Function that reads receipts with Claude Haiku (needs the `ANTHROPIC_API_KEY` secret).
