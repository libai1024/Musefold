import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844, headerMax: 76 },
  { name: "tablet", width: 768, height: 900, headerMax: 80 },
  { name: "desktop", width: 1440, height: 900, headerMax: 80 },
];

for (const viewport of viewports) {
  test(`SITE-05 ${viewport.name} geometry`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/Musefold/index.html", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    const metrics = await page.evaluate(() => {
      const header = document.querySelector(".site-header");
      const nav = document.querySelector(".site-nav");
      const cta = document.querySelector(".hero .button--ember");
      const navLinks = [...document.querySelectorAll(".site-nav a")];
      const navRect = nav.getBoundingClientRect();
      const navCenter = navRect.top + navRect.height / 2;
      const navCenters = navLinks.map((link) => {
        const rect = link.getBoundingClientRect();
        return Math.abs(rect.top + rect.height / 2 - navCenter);
      });
      const ctaRect = cta.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        headerHeight: header?.getBoundingClientRect().height ?? Infinity,
        navHeight: navRect.height,
        navWrap: getComputedStyle(nav).flexWrap,
        navCenters,
        ctaVisible: ctaRect.top < window.innerHeight && ctaRect.bottom > 0,
      };
    });

    expect(metrics.overflow, "horizontal overflow").toBeLessThanOrEqual(0);
    expect(metrics.headerHeight, "header height").toBeLessThanOrEqual(viewport.headerMax);
    expect(metrics.navHeight, "navigation height").toBeLessThanOrEqual(80);
    expect(metrics.ctaVisible, "primary CTA in first viewport").toBe(true);
    if (viewport.width >= 960) {
      expect(metrics.navWrap, "desktop nav flex wrap").toBe("nowrap");
      expect(Math.max(...metrics.navCenters), "desktop nav vertical alignment").toBeLessThan(1);
    }
  });
}
