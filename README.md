# Zinzo admin panel

Static single-page admin for Zinzo Wallet (plain HTML + JS, supabase-js from CDN). Hosted on GitHub Pages.

- Sign in with an email listed in `public.admins` (Supabase Auth, email + password). First time: "Email me a sign-in link", then set a password.
- Every read/write goes through Supabase Row Level Security (`public.is_admin()`); this page holds only the public anon key.
- `shared.js` is the app's own validation code (banner / dApp / token / version rules), bundled from the app repo
  (`admin/shared-entry.ts`), so what you preview here is what phones accept.
- Push + "you're in" notifications go through the `zinzo-admin` edge function.

Source of truth lives in the Zinzo Wallet app repo under `admin/`; this repo is the published copy.
