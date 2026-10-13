import '../styles/globals.css';

export const metadata = {
  title: 'Xeno Insights',
  description: 'Multi-tenant Shopify data ingestion & insights',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
