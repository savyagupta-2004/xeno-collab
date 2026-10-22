import PagePlaceholder from '@/components/ui/PagePlaceholder';
import { PAGE_TITLES } from '@/lib/constants';
import requireSession from '@/lib/requireSession';

export const metadata = { title: PAGE_TITLES.overview };

export default async function OverviewPage() {
  await requireSession();

  return <PagePlaceholder title={PAGE_TITLES.overview} />;
}
