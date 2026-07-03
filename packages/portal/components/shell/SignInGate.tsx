'use client'

/** SignInGate — shown for `members`-only modules when the user is signed out (prototype PubGate). */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/Icon'
import { signInHref } from '@/lib/signInHref'

export function SignInGate({ label = 'This area' }: { label?: string }) {
  const pathname = usePathname()
  return (
    <div className="gw-gate">
      <div className="gw-gate-card">
        <span className="gw-gate-ico">
          <Icon name="shield" size={24} />
        </span>
        <div className="gw-gate-title">Sign in to continue</div>
        <p className="gw-gate-text">{label} is available to signed-in members and staff.</p>
        <Link href={signInHref(pathname)} className="gw-gate-btn">
          <Icon name="signin" size={15} />
          Sign in
        </Link>
      </div>
    </div>
  )
}

export default SignInGate
