/* Copy-to-clipboard for <pre class="code"> blocks */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('pre.code').forEach((el) => {
    if (el.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      const txt = el.innerText.replace(/^Copy\n?/, '').trim();
      try {
        await navigator.clipboard.writeText(txt);
        btn.textContent = 'Copied ✓';
        btn.classList.add('ok');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('ok');
        }, 1500);
      } catch (err) {
        btn.textContent = 'Failed';
      }
    });
    el.appendChild(btn);
  });

  /* Smooth active-link highlighting in TOC */
  const tocLinks = document.querySelectorAll('.toc a[href^="#"]');
  if (tocLinks.length === 0) return;
  const byId = new Map(
    Array.from(tocLinks).map((a) => [a.getAttribute('href').slice(1), a])
  );
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          tocLinks.forEach((l) => l.classList.remove('active'));
          const a = byId.get(e.target.id);
          if (a) a.classList.add('active');
        }
      });
    },
    { rootMargin: '-40% 0px -55% 0px' }
  );
  document.querySelectorAll('section[id]').forEach((s) => io.observe(s));
});
