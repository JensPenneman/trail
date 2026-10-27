/** "bike ride" → "Bike ride": a phrase that starts a line or a value. */
export const capitalise = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
