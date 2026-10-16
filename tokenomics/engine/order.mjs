// Ordering helper shared by capture and the TA extension (B2 item 14, group `capture-robustness`). STDLIB ONLY.
/** Code-unit order of directory entries by `name`: locale-independent, unlike an undocumented listing order. */
export const byName = (a, z) => (a.name < z.name ? -1 : a.name > z.name ? 1 : 0);
