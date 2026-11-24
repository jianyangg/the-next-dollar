/**
 * Self-hosted fonts (SIL Open Font Licence), bundled by Vite from @fontsource packages.
 *
 * Why self-host instead of a Google Fonts <link>: no third-party request (privacy, and
 * it works offline), and the font files are cached with the game's own assets.
 * Each import is one weight; the browser only downloads the character subsets a page
 * actually uses (the CSS declares `unicode-range` per subset).
 *
 * Only the weights the kit uses are imported; adding a weight elsewhere would silently
 * fall back to a synthesised bold, so add it here first.
 */
import '@fontsource/jersey-20/400.css';
import '@fontsource/overpass/600.css';
import '@fontsource/overpass/800.css';
import '@fontsource/overpass-mono/700.css';
