# Third-party notices

Wrkbench depends on open-source packages. Licence summary from `package-lock.json`
(no GPL, AGPL or LGPL packages were found):

- MIT, ISC, BSD-3-Clause, Apache-2.0: the large majority (React, Express, Prisma, socket.io, Vite, etc.).
  Each package's licence text is included in its own folder under `node_modules` and upstream repository.
- SIL Open Font License 1.1: Archivo (`@fontsource-variable/archivo`) and IBM Plex Mono
  (`@fontsource/ibm-plex-mono`). Fonts may be bundled and used freely; the licence text must stay with them.
- ISC: Lucide icons (`lucide-react`).
- Dev-only: `caniuse-lite` (CC-BY-4.0), and some BlueOak-1.0.0 packages.

To regenerate a full list: `npx license-checker --production --summary`.

Brand names in example data (Bambu Lab, Makera, Hozo) belong to their owners; Wrkbench is not affiliated with them.
