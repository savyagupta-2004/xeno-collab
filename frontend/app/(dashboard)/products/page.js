import PagePlaceholder from '@/components/ui/PagePlaceholder';
import { PAGE_TITLES } from '@/lib/constants';
import requireSession from '@/lib/requireSession';

export const metadata = { title: PAGE_TITLES.products };

export default async function ProductsPage() {
  await requireSession();

  return <PagePlaceholder title={PAGE_TITLES.products} />;
}
