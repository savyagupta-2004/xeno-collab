import PagePlaceholder from '@/components/ui/PagePlaceholder';
import { PAGE_TITLES } from '@/lib/constants';

export const metadata = { title: PAGE_TITLES.settings };

export default function SettingsPage() {
  return <PagePlaceholder title={PAGE_TITLES.settings} />;
}
