/**
 * The height every option menu in the form renderer stops growing at. Without
 * a cap Mezzanine's dropdown list grows with its options and never scrolls, so
 * a long page overflows the layout and `onReachBottom` — the only way to load
 * the next page — can never fire. Matches the admin pickers' menus.
 */
export const FORM_CONTROL_MENU_MAX_HEIGHT = 320;
