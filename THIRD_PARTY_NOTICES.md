# Third-party notices

The dark teal palette and two-column planner layout are inspired by
[ISSP-Matsuda-lab/XPS-Explorer, menu branch](https://github.com/ISSP-Matsuda-lab/XPS-Explorer/tree/menu)
(inspected commit `d70ab36bd98754eafc50b25d92b68385cc537635`).
H–U core-level energies in `assets/js/reference.js` are transcribed from its
`assets/js/binding-energies.js`. `assets/js/lattice.js` adapts the lattice basis, LLL reduction, nearest-lattice-point solver and Wigner–Seitz construction from its `assets/js/arpes.js`. ARPES electron kinematics are excluded. RIXS photon kinematics and the SVG camera/interaction implementation are independently written here.

The current-point back-pane crosshairs in `assets/js/map.js` follow the cursor projection approach in upstream `assets/js/arpes-plot.js` (menu branch, inspected 2026-10-29). They are adapted to the RIXS SVG viewer for the current measurement point and hovered scan points. The full H–U table and cursor behavior were also inspected on 2026-10-30.

## Upstream license

MIT License

Copyright (c) 2026 Masashige-Miyamoto

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
