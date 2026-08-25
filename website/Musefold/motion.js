// SITE-02: the single Theater scroll island. The static composition remains
// complete when this island is unavailable or reduced motion is requested.
(function () {
  const story = document.querySelector("[data-fold-story]");
  const paper = story?.querySelector("[data-fold-paper]");
  const capture = story?.querySelector(".app-frame--hero");
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;

  if (!story || !paper || !capture || !gsap || !ScrollTrigger) return;

  gsap.registerPlugin(ScrollTrigger);

  const context = gsap.context(function () {
    const media = gsap.matchMedia();

    media.add(
      {
        motion: "(prefers-reduced-motion: no-preference)",
        pin: "(min-width: 681px)",
      },
      function (context) {
        const conditions = context.conditions;
        if (!conditions.motion) return undefined;

        story.dataset.motion = "active";
        const timeline = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: story,
            start: "top top",
            end: conditions.pin ? "+=920" : "+=620",
            pin: conditions.pin ? story : false,
            scrub: 0.75,
            anticipatePin: conditions.pin ? 1 : 0,
            invalidateOnRefresh: true,
          },
        });
        const pinSpacer = timeline.scrollTrigger?.pin?.parentElement;
        pinSpacer?.classList.add("fold-story-pin-spacer");

        timeline
          .to(
            paper,
            {
              rotate: 0,
              rotateY: -10,
              xPercent: -8,
              yPercent: -8,
              scale: 1.08,
              transformPerspective: 900,
              transformOrigin: "16% 18%",
              duration: 0.58,
            },
          )
          .to(
            capture,
            {
              rotate: -1,
              scale: 0.95,
              opacity: 0.72,
              duration: 0.42,
              transformOrigin: "70% 65%",
            },
            0.12,
          )
          .to(
            paper,
            {
              rotateY: 0,
              xPercent: -12,
              yPercent: -12,
              scale: 1.12,
              duration: 0.42,
            },
          );

        return function () {
          pinSpacer?.classList.remove("fold-story-pin-spacer");
          timeline.scrollTrigger?.kill();
          timeline.kill();
          delete story.dataset.motion;
        };
      },
    );
  }, story);

  window.addEventListener("pagehide", function cleanup() {
    context.revert();
  }, { once: true });
})();
