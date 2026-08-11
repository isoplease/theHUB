# Third-Party Software Notices

theHUB includes or is built with third-party software and fonts. Those
components remain the property of their respective copyright holders and are
provided under their own license terms. theHUB's original source code is
licensed separately under the MIT License in `LICENSE`.

The exact dependency versions used for a release are recorded in
`package-lock.json` and `src-tauri/Cargo.lock`.

## Runtime libraries

| Component | Version | License | Project |
| --- | ---: | --- | --- |
| React and React DOM | 19.2.8 | MIT | <https://github.com/facebook/react> |
| dnd-kit core, sortable and utilities | 6.3.1 / 10.0.0 / 3.2.2 | MIT | <https://github.com/clauderic/dnd-kit> |
| Tauri | 2.11.5 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/tauri> |
| Tauri JavaScript API | 2.11.1 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/tauri> |
| Tauri dialog plug-in | 2.7.2 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| Tauri notification plug-in | 2.3.3 | MIT OR Apache-2.0 | <https://github.com/tauri-apps/plugins-workspace> |
| serde | 1.0.229 | MIT OR Apache-2.0 | <https://github.com/serde-rs/serde> |
| serde_json | 1.0.151 | MIT OR Apache-2.0 | <https://github.com/serde-rs/json> |
| mathjs | 15.2.0 | Apache-2.0 | <https://github.com/josdejong/mathjs> |
| pdfmake | 0.2.20 | MIT | <https://github.com/bpampuch/pdfmake> |
| react-qr-code | 2.2.0 | MIT | <https://github.com/rosskhanas/react-qr-code> |

pdfmake includes and uses the Roboto typeface for PDF output. The included
Roboto font files are licensed under Apache License 2.0.

## Fonts

### DS-Digital

Copyright: Dusit Supasawat

The calculator and time displays use the DS-Digital typeface. It is distributed
as shareware rather than under an open-source license. Redistribution is allowed
only while the original font files remain unmodified, the author's copyright is
preserved, and the original `DIGITAL.TXT` notice accompanies the font archive.

The original and controlling notice is included at `fonts/DIGITAL.TXT` and is
also bundled with release builds. Consult that file for the author's personal
and commercial-use terms.

### Roboto

Copyright 2011 The Roboto Project Authors

License: Apache License 2.0

Source and license: <https://github.com/googlefonts/roboto-2>

## MPL-2.0 components

The dependency graph contains the following Mozilla Public License 2.0
components. These components have not been relicensed by theHUB. Their source
code and license terms are available from the listed upstream projects.

| Component | Version(s) | Project |
| --- | ---: | --- |
| cssparser | 0.36.0 | <https://github.com/servo/rust-cssparser> |
| cssparser-macros | 0.6.1 | <https://github.com/servo/rust-cssparser> |
| dtoa-short | 0.3.5 | <https://github.com/upsuper/dtoa-short> |
| option-ext | 0.2.0 | <https://github.com/soc/option-ext> |
| selectors | 0.36.1 | <https://github.com/servo/stylo> |
| lightningcss | 1.32.0 and 1.33.0 | <https://github.com/parcel-bundler/lightningcss> |

MPL-2.0 license text: <https://www.mozilla.org/MPL/2.0/>

## Build and development tools

The following principal tools are used to produce the application but are not
presented as original theHUB code:

| Component | Version | License |
| --- | ---: | --- |
| Tailwind CSS and `@tailwindcss/vite` | 4.3.3 | MIT |
| Vite | 8.1.5 | MIT |
| `@vitejs/plugin-react` | 6.0.4 | MIT |
| TypeScript | 6.0.3 | Apache-2.0 |
| Tauri CLI | 2.11.4 | MIT OR Apache-2.0 |
| tauri-build | 2.6.3 | MIT OR Apache-2.0 |
| oxlint | 1.76.0 | MIT |
| nanoid | 3.3.17 | MIT |

## License references and acknowledgements

- MIT License: <https://opensource.org/license/mit>
- Apache License 2.0: <https://www.apache.org/licenses/LICENSE-2.0>
- Mozilla Public License 2.0: <https://www.mozilla.org/MPL/2.0/>

Copyright notices supplied by each dependency are retained in its source
distribution. Notable principal-component notices include:

- React: Copyright Meta Platforms, Inc. and affiliates.
- dnd-kit: Copyright Clauderic Demers.
- Tailwind CSS: Copyright Tailwind Labs, Inc.
- Vite: Copyright Yuxi (Evan) You and Vite contributors.
- nanoid: Copyright Andrey Sitnik.
- pdfmake: Copyright bpampuch and liborm85.
- react-qr-code: Copyright Ross Khanas.
- TypeScript and DefinitelyTyped type definitions: Copyright Microsoft
  Corporation and their respective contributors.

For complete component-level copyright statements, consult the corresponding
upstream source package at the version recorded in the lock files.
