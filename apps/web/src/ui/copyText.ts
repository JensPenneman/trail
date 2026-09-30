/**
 * Copies text to the clipboard. The async Clipboard API needs a secure context
 * and a user gesture; when it is unavailable or refused, the caller is told so
 * it can ask the person to copy by hand (the value stays selectable).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
