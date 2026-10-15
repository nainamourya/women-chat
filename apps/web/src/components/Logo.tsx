import Image from "next/image";
import giigirlLogo from "../../public/giigirl-logo.png";

// Real brand artwork — the mascot's raised hand and the wordmark's lettering
// overlap in the source file, so (unlike earlier icon/wordmark asset pairs)
// this one is used as a single combined lockup rather than split in two;
// see public/giigirl-icon.png (used only for the favicon, src/app/icon.png)
// for the isolated-mascot crop. Height-constrained with width left to scale
// automatically so the image is never stretched or distorted.
//
// The wordmark's "Gii" is baked into the PNG in a dark plum ink, which reads
// fine on a light page but is nearly invisible against dark mode's dark plum
// background. Rather than needing a second dark-mode asset, the logo always
// sits on its own fixed light chip, so it stays legible in both themes.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-[#FFF5FA] py-1 pl-1.5 pr-2.5 shadow-sm ${className ?? ""}`}>
      <Image src={giigirlLogo} alt="Giigirl logo" priority className="h-7 w-auto sm:h-8" />
    </span>
  );
}
