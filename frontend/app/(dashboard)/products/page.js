import PagePlaceholder from '@/components/ui/PagePlaceholder';
import { PAGE_TITLES } from '@/lib/constants';

export const metadata = { title: PAGE_TITLES.products };

export default function ProductsPage() {
  return <PagePlaceholder title={PAGE_TITLES.products} />;
}
