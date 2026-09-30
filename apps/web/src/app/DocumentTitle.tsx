interface DocumentTitleProps {
  title: string;
}

/** React hoists `<title>` into the head; the page name comes first so tabs stay tellable apart. */
export function DocumentTitle({ title }: DocumentTitleProps) {
  return <title>{`${title} · Trail`}</title>;
}
