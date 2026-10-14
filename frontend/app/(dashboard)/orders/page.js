import PagePlaceholder from '@/components/ui/PagePlaceholder';
import { PAGE_TITLES } from '@/lib/constants';

export const metadata = { title: PAGE_TITLES.orders };

export default function OrdersPage() {
  return <PagePlaceholder title={PAGE_TITLES.orders} />;
}
