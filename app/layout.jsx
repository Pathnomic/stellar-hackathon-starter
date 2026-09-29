import { getLocale, t } from '../lib/i18n/index.js';

import './globals.css';

export function generateMetadata() {
  const locale = getLocale();
  return { title: t('app.title', locale) };
}

export default function RootLayout({ children }) {
  const locale = getLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
