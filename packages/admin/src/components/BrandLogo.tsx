/**
 * Brand logo component — uses the default Gatewaze logo from the theme folder.
 * Deployments customise branding via the admin Settings → Branding page,
 * which stores logos in Supabase storage and overrides these defaults.
 */

interface BrandLogoProps {
  type?: 'logo' | 'logotype';
  className?: string;
}

export function BrandLogo({ type = 'logo', className = '' }: BrandLogoProps) {
  const logoVariant = className.includes('text-black') ? 'black' : 'white';

  if (type === 'logotype') {
    return (
      <img
        src={`/theme/gatewaze/logo_${logoVariant}.svg`}
        alt="Gatewaze"
        className={className}
        style={{ objectFit: 'contain' }}
      />
    );
  }

  return (
    <img
      src="/theme/gatewaze/logo_black.svg"
      alt="Gatewaze"
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}
