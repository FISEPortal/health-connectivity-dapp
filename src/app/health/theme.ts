/**
 * Palette for the two themes Signet can hand this DApp.
 *
 * Opening this panel used to drop the user from a light product into a dark one, because the
 * theme never reached here: Signet passes it as the third argument to init and broadcasts later
 * changes on a signet:theme event, while this DApp read its config from getParameters(), which
 * carries no theme. See THEME-SPEC.md.
 *
 * The light values are Signet's own tokens, copied from the Data Vault rather than sampled by
 * eye, so the two sit side by side without a seam. Dark keeps this DApp's existing character
 * rather than becoming a flat inversion of light.
 */

export type ThemeName = 'light' | 'dark';

export interface Palette {
    /** Page ground behind everything. */
    ground: string;
    /** Card surface sitting on the ground. */
    surface: string;
    /** A surface nested inside a card, one step from the ground. */
    surfaceSunken: string;
    /** Ground for inputs and selects. */
    field: string;
    fieldBorder: string;
    /** Headings and primary content. */
    ink: string;
    /** Supporting copy. */
    inkMuted: string;
    /** Least prominent copy: hints, disabled labels. */
    inkFaint: string;
    /** Hairlines and card borders. */
    line: string;
    /** Brand accent for headings, links and active states. */
    accent: string;
    /** Text drawn on top of a filled accent. */
    onAccent: string;
    /** Translucent accent washes for banners, chips and inactive pills. */
    accentWash: string;
    accentWashStrong: string;
    accentBorder: string;
    /** Gradient pair for the page title. */
    titleFrom: string;
    titleTo: string;
    /** Filled primary button. */
    buttonFrom: string;
    buttonTo: string;
    /** Semantics. Hue is held across themes; only lightness moves for contrast. */
    warn: string;
    success: string;
    successWash: string;
    successBorder: string;
}

/*
  Signet's product tokens. --bg, --surface, --ink, --ink-2, --muted, --line and --brand in the
  Data Vault's index.css.
*/
export const LIGHT: Palette = {
    ground: '#f4fafa',
    surface: '#ffffff',
    surfaceSunken: '#f4fafa',
    field: '#ffffff',
    fieldBorder: '#d5dbe6',
    ink: '#1f2330',
    inkMuted: '#47506a',
    inkFaint: '#6b7280',
    line: '#e7e9f0',
    accent: '#0084c0',
    onAccent: '#ffffff',
    accentWash: 'rgba(0, 132, 192, 0.06)',
    accentWashStrong: 'rgba(0, 132, 192, 0.12)',
    accentBorder: 'rgba(0, 132, 192, 0.28)',
    titleFrom: '#0084c0',
    titleTo: '#075a94',
    buttonFrom: '#0084c0',
    buttonTo: '#0e80c4',
    // Amber on white needs to go darker than amber on near-black to stay readable.
    warn: '#a15c00',
    success: '#0f7a52',
    successWash: 'rgba(15, 122, 82, 0.10)',
    successBorder: 'rgba(15, 122, 82, 0.28)',
};

/** The DApp's existing dark look, unchanged, now expressed through the same names. */
export const DARK: Palette = {
    ground: '#090d16',
    surface: '#111827',
    surfaceSunken: '#0d1424',
    field: '#1f2937',
    fieldBorder: '#374151',
    ink: '#f1f5f9',
    inkMuted: '#94a3b8',
    inkFaint: '#64748b',
    line: '#1f2937',
    accent: '#38bdf8',
    onAccent: '#0b0f19',
    accentWash: 'rgba(56, 189, 248, 0.05)',
    accentWashStrong: 'rgba(56, 189, 248, 0.1)',
    accentBorder: 'rgba(56, 189, 248, 0.2)',
    titleFrom: '#38bdf8',
    titleTo: '#818cf8',
    buttonFrom: '#38bdf8',
    buttonTo: '#3b82f6',
    warn: '#fbbf24',
    success: '#34d399',
    successWash: 'rgba(16, 185, 129, 0.15)',
    successBorder: 'rgba(52, 211, 153, 0.3)',
};

/**
 * Resolve whatever the host handed us into a palette.
 *
 * Anything that is not the string 'dark' resolves to light, including undefined, so a host that
 * sends nothing gets the product's default rather than the panel this DApp happened to be built
 * in first.
 */
export function paletteFor(theme: unknown): Palette {
    return theme === 'dark' ? DARK : LIGHT;
}

/** Normalise a host value to a theme name, for state that has to hold one. */
export function themeNameFrom(theme: unknown): ThemeName {
    return theme === 'dark' ? 'dark' : 'light';
}
