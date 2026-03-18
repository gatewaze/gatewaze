import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { NotFoundContent } from '@/components/NotFoundContent'

export default async function NotFound() {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return <NotFoundContent brandConfig={brandConfig} />
}
