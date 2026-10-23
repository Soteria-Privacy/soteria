import type { RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, ScrambleTextPlugin);

const MOTION_OK = "(prefers-reduced-motion: no-preference)";

/**
 * All landing choreography. Every tween is a `from`/scrubbed `to`, so with
 * reduced motion (matchMedia branch skipped) the page renders fully static.
 */
export function useLandingMotion(scope: RefObject<HTMLElement>) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        intro();
        gsap.to(".lp-scroll-dot", { y: 10, opacity: 0, duration: 1.4, repeat: -1, ease: "power2.in" });
        const unbindPointer = wordmarkParallax(scope.current!);
        scrollScenes();
        return unbindPointer;
      });
    },
    { scope },
  );
}

function intro() {
  SplitText.create(".lp-title", {
    type: "lines",
    mask: "lines",
    autoSplit: true,
    onSplit: (self) =>
      gsap.from(self.lines, { yPercent: 110, duration: 1, stagger: 0.12, ease: "expo.out", delay: 1.1 }),
  });

  const dots = gsap.utils.toArray<SVGCircleElement>(".lp-wordmark .dm-dot");
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

  tl.from(
      dots,
      {
        opacity: 0,
        scale: 0,
        x: () => gsap.utils.random(-90, 90),
        y: () => gsap.utils.random(-60, 60),
        transformOrigin: "50% 50%",
        duration: 1.1,
        ease: "back.out(1.8)",
        stagger: { each: 0.0045, from: "random" },
      },
      0.25,
    )
    .from(".lp-pill", { y: -14, opacity: 0, duration: 0.7 }, 0.4)
    .to(
      ".lp-kicker-text",
      { duration: 1.2, scrambleText: { text: "{original}", chars: "01", speed: 0.6, revealDelay: 0.3 } },
      1.0,
    )
    .from([".lp-lede", ".lp-cta > *"], { y: 22, opacity: 0, duration: 0.8, stagger: 0.1 }, 1.35)
    .from(".lp-scroll", { opacity: 0, y: -8, duration: 0.6 }, 1.9)
    .add(twinkle, 1.6);
}

/** Random LED dots dim and recover, like the banner's lit matrix. */
function twinkle() {
  const dots = gsap.utils.toArray<SVGCircleElement>(".lp-wordmark .dm-dot");
  const pick = gsap.utils.random(dots, true);
  const flicker = () => {
    for (let i = 0; i < 6; i++) {
      gsap.to(pick(), { opacity: 0.25, duration: 0.18, yoyo: true, repeat: 1, ease: "power1.inOut" });
    }
    gsap.delayedCall(gsap.utils.random(0.35, 0.9), flicker);
  };
  flicker();
}

function wordmarkParallax(root: HTMLElement) {
  const x = gsap.quickTo(".lp-wordmark", "x", { duration: 1.2, ease: "power3.out" });
  const y = gsap.quickTo(".lp-wordmark", "y", { duration: 1.2, ease: "power3.out" });
  const onMove = (e: PointerEvent) => {
    x((e.clientX / window.innerWidth - 0.5) * 8);
    y((e.clientY / window.innerHeight - 0.5) * 8);
  };
  root.addEventListener("pointermove", onMove);
  return () => root.removeEventListener("pointermove", onMove);
}

function scrollScenes() {
  // Hero recedes as you leave it.
  gsap.to(".lp-hero-inner", {
    yPercent: -18,
    opacity: 0.15,
    ease: "none",
    scrollTrigger: { trigger: ".lp-hero", start: "top top", end: "bottom top", scrub: true },
  });
  gsap.utils.toArray<HTMLElement>(".lp-h2").forEach((h) => {
    SplitText.create(h, {
      type: "words",
      mask: "words",
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.words, {
          yPercent: 100,
          duration: 0.9,
          stagger: 0.05,
          ease: "expo.out",
          scrollTrigger: { trigger: h, start: "top 85%" },
        }),
    });
  });

  gsap.from(".lp-step", {
    y: 48,
    opacity: 0,
    duration: 0.9,
    stagger: 0.14,
    ease: "power3.out",
    scrollTrigger: { trigger: ".lp-steps", start: "top 78%" },
  });
  gsap.from(".lp-rail-fill", {
    scaleX: 0,
    ease: "none",
    scrollTrigger: { trigger: ".lp-steps", start: "top 80%", end: "bottom 55%", scrub: 0.6 },
  });

  gsap.from(".lp-ledger-panel", {
    clipPath: "inset(12% 12% 12% 12% round 24px)",
    opacity: 0,
    duration: 1.3,
    ease: "expo.out",
    scrollTrigger: { trigger: ".lp-ledger", start: "top 75%" },
  });
  gsap.from(".lp-ledger-copy > *", {
    x: -28,
    opacity: 0,
    duration: 0.8,
    stagger: 0.1,
    ease: "power3.out",
    scrollTrigger: { trigger: ".lp-ledger", start: "top 72%" },
  });

  gsap.set(".lp-prim", { y: 40, opacity: 0 });
  ScrollTrigger.batch(".lp-prim", {
    start: "top 88%",
    once: true,
    onEnter: (els) => gsap.to(els, { y: 0, opacity: 1, duration: 0.9, stagger: 0.1, ease: "power3.out" }),
  });

  gsap.from(".lp-final-inner > *", {
    y: 30,
    opacity: 0,
    duration: 0.9,
    stagger: 0.12,
    ease: "power3.out",
    scrollTrigger: { trigger: ".lp-final", start: "top 80%" },
  });
}
