/** A pattern for text anywhere in an accessible name (a row's name holds its label, detail and value). */
export const containing = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
