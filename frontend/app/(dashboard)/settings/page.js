import StoreSettings from '@/components/settings/StoreSettings';
import { PAGE_TITLES } from '@/lib/constants';
import requireSession from '@/lib/requireSession';

export const metadata = { title: PAGE_TITLES.settings };

export default async function SettingsPage() {
  await requireSession();

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold">{PAGE_TITLES.settings}</h1>
      <StoreSettings />
    </section>
  );
}
