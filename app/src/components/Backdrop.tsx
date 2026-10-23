import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const ROWS = 14;
const ROW_LEN = 96;

// Deterministic bit strings so the watermark doesn't reshuffle between renders.
function bits(seed: number) {
  let s = seed * 9301 + 49297;
  let out = "";
  for (let i = 0; i < ROW_LEN; i++) {
    s = (s * 9301 + 49297) % 233280;
    out += s / 233280 > 0.5 ? "1" : "0";
  }
  return out;
}

const BINARY = Array.from({ length: ROWS }, (_, i) => bits(i + 1));

/**
 * App-wide banner backdrop: indigo void, diagonal blue→violet→magenta beam,
 * drifting binary watermark. `dim` softens it behind dense app screens.
 */
export function Backdrop({ dim = false }: { dim?: boolean }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".bd-beam", { opacity: 0, scale: 0.6, duration: 1.8, stagger: 0.15, ease: "power2.out" });
        gsap.from(".bd-binary", { opacity: 0, duration: 1.4 });

        gsap.to(".bd-beam-blue", { xPercent: 6, yPercent: -5, rotation: "+=4", duration: 9, yoyo: true, repeat: -1, ease: "sine.inOut" });
        gsap.to(".bd-beam-magenta", { xPercent: -5, yPercent: 6, rotation: "-=3", duration: 11, yoyo: true, repeat: -1, ease: "sine.inOut" });

        gsap.utils.toArray<HTMLElement>(".bd-binary-row").forEach((row, i) => {
          const forward = i % 2 === 0;
          gsap.fromTo(
            row,
            { xPercent: forward ? 0 : -50 },
            { xPercent: forward ? -50 : 0, duration: gsap.utils.random(60, 110), repeat: -1, ease: "none" },
          );
        });

        // The beam swings like the banner's diagonal as the page scrolls.
        gsap.to(".bd-beams", {
          rotation: -10,
          yPercent: 8,
          ease: "none",
          scrollTrigger: { start: 0, end: "max", scrub: 1 },
        });

        const layers = [
          { el: ".bd-beam-blue", depth: 26 },
          { el: ".bd-beam-magenta", depth: -18 },
        ].map(({ el, depth }) => ({
          depth,
          x: gsap.quickTo(el, "x", { duration: 1.2, ease: "power3.out" }),
          y: gsap.quickTo(el, "y", { duration: 1.2, ease: "power3.out" }),
        }));
        const onMove = (e: PointerEvent) => {
          const nx = e.clientX / window.innerWidth - 0.5;
          const ny = e.clientY / window.innerHeight - 0.5;
          layers.forEach((l) => {
            l.x(nx * l.depth);
            l.y(ny * l.depth);
          });
        };
        window.addEventListener("pointermove", onMove);
        return () => window.removeEventListener("pointermove", onMove);
      });
    },
    { scope: root },
  );

  return (
    <div className={`backdrop${dim ? " is-dim" : ""}`} ref={root} aria-hidden="true">
      <div className="bd-beams">
        <div className="bd-beam bd-beam-blue" />
        <div className="bd-beam bd-beam-magenta" />
      </div>
      <div className="bd-binary">
        {BINARY.map((row, i) => (
          <div className="bd-binary-row" key={i}>
            <span>{row}</span>
            <span>{row}</span>
          </div>
        ))}
      </div>
      <div className="bd-vignette" />
      <div className="bd-grain" />
    </div>
  );
}
