// Quayside → Hostinger rename (approved by Hostinger, Oct 2026).
// Used once at startup on every saved version (see versions.js), so edits made in the live editor are kept.

const H_PATH = 'M2.00025 14.046V0.000497794L9.08916 3.78046V10.1086L18.4735 10.1132L25.6774 14.046H2.00025ZM20.3925 8.95058V0L27.6725 3.6859V13.1797L20.3925 8.95058ZM20.3924 26.1177V19.8441L10.9358 19.8375C10.9446 19.8793 3.6123 15.8418 3.6123 15.8418L27.6725 15.9547V30L20.3924 26.1177ZM2 26.1177L2.00025 16.9393L9.08916 21.0683V29.8033L2 26.1177Z'
// The Hostinger mark, sized to sit inside the old 28×28 purple tile.
export const H_IN_TILE = `<path transform="translate(6.58 6.5) scale(.5)" fill-rule="evenodd" clip-rule="evenodd" d="${H_PATH}" fill="#fff"/>`

const PAIRS = [
  ['<path d="M6 17c2.7-3.6 5.3-3.6 8 0s5.3 3.6 8 0" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="20" cy="9" r="2" fill="#fff"/>', H_IN_TILE],
  ['mcp.quayside.app', 'mcp.hostinger.com'],
  ['.quaysite.app', '.hostingersite.com'],
  ['"quayside":', '"hostinger":'],
  ['<span>quayside</span>', '<span>HOSTINGER</span>'],
  ['QUAYSIDE', 'HOSTINGER'],
  ['Quayside', 'Hostinger'],
]

export function rebrand(text) {
  let out = String(text)
  for (const [a, b] of PAIRS) out = out.split(a).join(b)
  return out
}
