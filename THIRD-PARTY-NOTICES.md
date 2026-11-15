# Third-party notices

Wrkbench itself is licensed under the GNU Affero General Public License v3.0 (see `LICENSE`).
The licences below belong to its dependencies, all of which are compatible with AGPL-3.0.

Wrkbench depends on open-source packages. Licence summary from `package-lock.json`
(no GPL, AGPL or LGPL packages were found):

- MIT, ISC, BSD-3-Clause, Apache-2.0: the large majority (React, Express, Prisma, socket.io, Vite, etc.).
  Each package's licence text is included in its own folder under `node_modules` and upstream repository.
- SIL Open Font License 1.1: Archivo (`@fontsource-variable/archivo`) and IBM Plex Mono
  (`@fontsource/ibm-plex-mono`). Fonts may be bundled and used freely; the licence text must stay with them.
- ISC: Lucide icons (`lucide-react`).
- Dev-only: `caniuse-lite` (CC-BY-4.0), and some BlueOak-1.0.0 packages.

To regenerate a full list: `npx license-checker --production --summary`.

Brand and product names in the example data and the built-in catalogue (Bambu Lab, Prusa, xTool, Makera
and others) belong to their owners; Wrkbench is not affiliated with them.

# Data

Wrkbench ships data from the following projects. Their licences apply to that data.

## SpoolmanDB

`server/data/reference/filaments.json` is generated from [SpoolmanDB](https://github.com/Donkie/SpoolmanDB)
by `server/scripts/import-filaments.ts`. The import reshapes the data (one entry per product line,
materials mapped onto Wrkbench's material list) but the facts come from SpoolmanDB and its contributors.
The commit it was taken from is recorded in the file's `source.commit`.

```
MIT License

Copyright (c) 2024 Donkie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

