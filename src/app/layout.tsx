import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Smart Email Priority & Notification System',
  description: 'Intelligent email classification, behavioral learning, and adaptive notification dispatching powered by AI and Supabase.',
  keywords: ['AI email classification', 'email priority optimizer', 'supabase', 'notification dispatcher', 'smart inbox'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>{children}</body>
    </html>
  );
}
