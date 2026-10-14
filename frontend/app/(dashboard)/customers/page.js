import PagePlaceholder from '@/components/ui/PagePlaceholder';
import { PAGE_TITLES } from '@/lib/constants';

export const metadata = { title: PAGE_TITLES.customers };

export default function CustomersPage() {
  return <PagePlaceholder title={PAGE_TITLES.customers} />;
}
