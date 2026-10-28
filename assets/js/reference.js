/* Selected core levels from ISSP-Matsuda-lab/XPS-Explorer (menu branch).
 * Copyright (c) 2026 Masashige-Miyamoto. MIT; see THIRD_PARTY_NOTICES.md.
 * These are binding-energy references, NOT compound-specific RIXS resonances.
 */
(function (root) {
  const rows = [
    ['B',5,'K',189], ['C',6,'K',285], ['N',7,'K',398], ['O',8,'K',531],
    ['Ti',22,'L3',453.8], ['Ti',22,'L2',460.2], ['V',23,'L3',512.1], ['V',23,'L2',519.8],
    ['Cr',24,'L3',574.1], ['Cr',24,'L2',583.8], ['Mn',25,'L3',638.7], ['Mn',25,'L2',649.9],
    ['Fe',26,'L3',706.8], ['Fe',26,'L2',719.9], ['Co',27,'L3',778.1], ['Co',27,'L2',793.2],
    ['Ni',28,'L3',852.7], ['Ni',28,'L2',870], ['Cu',29,'L3',932.7], ['Cu',29,'L2',952.3],
    ['Cu',29,'K',8979], ['Zn',30,'L3',1021.8]
  ].map(([element,z,edge,energy]) => ({id: element+'-'+edge, element,z,edge,energy}));
  if (typeof module !== 'undefined') module.exports = rows;
  root.RIXSReference = rows;
})(typeof globalThis !== 'undefined' ? globalThis : this);
