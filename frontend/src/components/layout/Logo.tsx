// ONB pixel wordmark: the traced public/logo.svg when it exists, otherwise the Silkscreen font.
export function Logo() {
  if (__HAS_LOGO__) return <img src="/logo.svg" alt="ONB" width={82} height={32} className="block" />;
  return <span className="font-pixel text-[40px] font-bold leading-none text-black">ONB</span>;
}
