(function () {
  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14 });
    revealItems.forEach(function (item) { observer.observe(item); });
  } else {
    revealItems.forEach(function (item) { item.classList.add('is-visible'); });
  }

  const summary = document.querySelector('[data-download-summary]');
  const totalElement = document.querySelector('[data-download-total]');
  const statusElement = document.querySelector('[data-download-status]');
  const countElements = document.querySelectorAll('[data-download-count]');
  const skillUrlElement = document.querySelector('[data-skill-url]');
  const skillCopyButton = document.querySelector('[data-skill-copy]');
  const skillCopyStatus = document.querySelector('[data-skill-copy-status]');

  if (skillUrlElement && skillCopyButton) {
    skillCopyButton.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(skillUrlElement.textContent.trim());
        skillCopyButton.textContent = '已复制';
        if (skillCopyStatus) skillCopyStatus.textContent = '网址已复制，可以直接粘贴给 AI';
        window.setTimeout(function () {
          skillCopyButton.textContent = '复制网址';
          if (skillCopyStatus) skillCopyStatus.textContent = 'SKILL.md · CLI 优先 · MCP 兼容';
        }, 1800);
      } catch (error) {
        if (skillCopyStatus) skillCopyStatus.textContent = '浏览器未授权复制，请手动选择上方网址';
      }
    });
  }

  function isCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function formatCount(value) {
    return new Intl.NumberFormat('zh-CN').format(value);
  }

  async function loadDownloadStatistics() {
    if (!summary || !totalElement || !statusElement) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(function () { controller.abort(); }, 5000);
    try {
      const response = await fetch('/Musefold/api/download-stats', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal
      });
      if (!response.ok) throw new Error('statistics request failed');

      const payload = await response.json();
      if (!isCount(payload.total) || typeof payload.byVersion !== 'object' || payload.byVersion === null) {
        throw new Error('statistics response is invalid');
      }

      totalElement.textContent = formatCount(payload.total);
      countElements.forEach(function (element) {
        const version = element.dataset.downloadVersion;
        const platform = element.dataset.downloadCount;
        const count = payload.byVersion?.[version]?.byPlatform?.[platform];
        element.textContent = isCount(count) ? formatCount(count) + ' 次' : '-- 次';
      });
      statusElement.textContent = '按下载开始统计';
      summary.dataset.state = 'ready';
    } catch (error) {
      totalElement.textContent = '--';
      countElements.forEach(function (element) { element.textContent = '-- 次'; });
      statusElement.textContent = '统计暂不可用';
      summary.dataset.state = 'error';
    } finally {
      window.clearTimeout(timeout);
    }
  }

  loadDownloadStatistics();
})();
