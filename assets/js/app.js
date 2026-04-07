(() => {
  'use strict';

  const INTERVAL = 30000;  // ms between checks

  let TARGETS = [];

  async function loadTargets() {
    try {
      const res = await fetch('data/targets.json', { cache: 'no-cache' });
      TARGETS = await res.json();
      // Cache in localStorage for offline use
      localStorage.setItem('wancheck_targets', JSON.stringify(TARGETS));
    } catch {
      // Offline fallback: use cached targets
      const cached = localStorage.getItem('wancheck_targets');
      if (cached) TARGETS = JSON.parse(cached);
    }
  }

  const STORAGE_KEY = 'netcheck_enabled_hosts';

  // Load enabled hosts from localStorage; if never saved — use `on` flag as default
  function getEnabledHosts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch { /* fall through */ }
    // First visit: only targets with `on: true` are enabled
    return new Set(TARGETS.filter(t => t.on).map(t => t.host));
  }

  function saveEnabledHosts(set) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  }

  function getEnabledTargets() {
    const enabled = getEnabledHosts();
    return TARGETS.filter(t => enabled.has(t.host));
  }

  let pollTimer    = null;
  let progressAnim = null;
  let lastResult   = null;   // last check snapshot for sharing

  // Ping history for the chart (kept in memory, resets on reload)
  const pingHistory = [];    // { time: string, ping: number|null }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  const els = {
    ts:         $('ts'),
    dot:        $('dot'),
    label:      $('statusLabel'),
    sub:        $('statusSub'),
    metaIp:     $('metaIp'),
    metaPing:   $('metaPing'),
    metaAvail:  $('metaAvail'),
    metaCity:   $('metaCity'),
    metaIsp:    $('metaIsp'),
    metaDevice: $('metaDevice'),
    list:     $('servicesList'),
    progress: $('progressFill'),
    shareBtn:     $('shareBtn'),
    sharedBanner: $('sharedBanner'),
    pingChart:    $('pingChart'),
    settingsToggle:   $('settingsToggle'),
    settingsPanel:    $('settingsPanel'),
    settingsCheckboxes: $('settingsCheckboxes'),
    installBtn:       $('installBtn'),
  };

  // ── PWA Install prompt ─────────────────────────────────────────────────
  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    els.installBtn.hidden = false;
  });

  els.installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    els.installBtn.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    els.installBtn.hidden = true;
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function ping(ms) {
    if (ms === null || ms === undefined) return '—';
    return ms + '\u2009ms';  // thin-space before ms
  }

  function clearSkeleton(el) {
    el.classList.remove('skeleton', 'empty');
  }

  // ── Progress bar ──────────────────────────────────────────────────────────
  function startProgress(duration) {
    cancelAnimationFrame(progressAnim);
    const fill = els.progress;
    const start = performance.now();

    fill.style.transition = 'none';
    fill.style.width = '0%';

    function step(now) {
      const pct = Math.min(((now - start) / duration) * 100, 100);
      fill.style.width = pct + '%';
      if (pct < 100) {
        progressAnim = requestAnimationFrame(step);
      }
    }

    // Allow the browser to repaint at 0% before animating
    requestAnimationFrame(() => requestAnimationFrame(step));
  }

  // ── Render data ───────────────────────────────────────────────────────────
  function renderOnline(data) {
    lastResult = data;  // store for sharing
    els.ts.textContent = data.datetime || '—';

    els.dot.classList.remove('checking', 'offline', 'partial', 'whitelist');

    // Detect whitelist mode: all online targets are whitelisted, all non-whitelisted are offline
    const onlineNames  = new Set(data.targets.filter(t => t.status === 'online').map(t => t.host));
    const wlHosts      = new Set(TARGETS.filter(t => t.whitelist).map(t => t.host));
    const nonWlTargets = data.targets.filter(t => !wlHosts.has(t.host));
    const isWhitelist  = data.online_count > 0
      && nonWlTargets.length > 0
      && nonWlTargets.every(t => t.status === 'offline')
      && data.targets.some(t => wlHosts.has(t.host) && t.status === 'online');

    if (data.online_count === 0) {
      els.dot.classList.add('offline');
      els.label.textContent = 'Офлайн';
      els.sub.textContent   = 'ни один сервис не отвечает';
    } else if (isWhitelist) {
      els.dot.classList.add('whitelist');
      els.label.textContent = 'Белый список';
      els.sub.textContent   = 'доступны только сервисы из белого списка';
    } else if (data.online_count / data.total_count >= 0.5) {
      els.label.textContent = 'Онлайн';
      els.sub.textContent   = data.online_count + '\u2009/\u2009' + data.total_count + ' сервисов доступны';
    } else {
      els.dot.classList.add('partial');
      els.label.textContent = 'Частично';
      els.sub.textContent   = (data.total_count - data.online_count) + '\u2009/\u2009' + data.total_count + ' сервисов недоступны';
    }

    clearSkeleton(els.metaIp);
    els.metaIp.textContent = data.ip || '—';
    if (!data.ip) els.metaIp.classList.add('empty');

    // Meta ping
    clearSkeleton(els.metaPing);
    els.metaPing.textContent = ping(data.avg_ping);
    if (!data.avg_ping) els.metaPing.classList.add('empty');

    // Meta availability
    clearSkeleton(els.metaAvail);
    els.metaAvail.textContent = data.online_count + '\u2009/\u2009' + data.total_count;
    if (data.online_count === 0) els.metaAvail.classList.add('empty');

    // Meta city
    clearSkeleton(els.metaCity);
    els.metaCity.textContent = data.city || '—';
    if (!data.city) els.metaCity.classList.add('empty');

    // Meta ISP
    clearSkeleton(els.metaIsp);
    els.metaIsp.textContent = data.isp || '—';
    if (!data.isp) els.metaIsp.classList.add('empty');

    // Device (UA, not empty)
    els.metaDevice.textContent = data.device;

    // Services list — diff-update to avoid full re-render flicker
    const existing = Array.from(els.list.children);

    data.targets.forEach((t, i) => {
      let row = existing[i];

      if (!row) {
        row = document.createElement('div');
        row.className = 'service-row';
        els.list.appendChild(row);
      }

      const isOnline  = t.status === 'online';
      const dotClass  = isOnline ? 'svc-dot' : 'svc-dot offline';
      const pingClass = isOnline ? 'svc-ping' : 'svc-ping empty';

      row.innerHTML =
        `<span class="svc-name">${escHtml(t.name)}</span>` +
        `<span class="svc-host">${escHtml(t.host)}</span>` +
        `<span class="${pingClass}">${ping(t.ping)}</span>` +
        `<span class="${dotClass}"></span>`;
    });

    // Remove stale rows
    while (els.list.children.length > data.targets.length) {
      els.list.removeChild(els.list.lastChild);
    }
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Check single target from the client ───────────────────────────────────
  // mode: 'no-cors' — CORS-ошибки не бросаются, но сетевые ошибки — да.
  // Время замеряем на стороне браузера → это реальный RTT клиента.
  async function checkTarget(t) {
    const start = performance.now();
    try {
      await fetch(t.url, {
        method: 'HEAD',
        mode:   'no-cors',
        cache:  'no-store',
        signal: AbortSignal.timeout(6000),
      });
      const ms = Math.round(performance.now() - start);
      return { name: t.name, host: t.host, status: 'online', ping: Math.max(1, ms) };
    } catch {
      return { name: t.name, host: t.host, status: 'offline', ping: null };
    }
  }

  // ── IP-гео: IP + город + провайдер (ipinfo.io, CORS, 50k/мес бесплатно) ──
  async function getIpInfo() {
    try {
      const res  = await fetch('https://ipinfo.io/json', {
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      const ip   = typeof data.ip  === 'string' && /^[0-9a-f.:]+$/i.test(data.ip)
        ? data.ip : null;
      const city = [data.city, data.country].filter(Boolean).join(', ') || null;
      // org приходит как «AS12345 ProviderName» — обрезаем AS-номер
      const isp  = typeof data.org === 'string'
        ? data.org.replace(/^AS\d+\s*/i, '') || null
        : null;
      return { ip, city, isp };
    } catch {
      return { ip: null, city: null, isp: null };
    }
  }

  // ── Устройство и ОС из User-Agent (без внешнего запроса) ─────────────────
  function getDeviceInfo() {
    const ua = navigator.userAgent;
    let os     = 'Неизвестно';
    let device = 'ПК';

    if      (/CrOS/i.test(ua))      { os = 'Chrome OS'; device = 'Ноутбук'; }
    else if (/Windows NT/i.test(ua)) { os = 'Windows'; }
    else if (/Android/i.test(ua))    { os = 'Android'; device = /Tablet|Tab/i.test(ua) ? 'Планшет' : 'Смартфон'; }
    else if (/iPad/i.test(ua))       { os = 'iPadOS';  device = 'Планшет'; }
    else if (/iPhone/i.test(ua))     { os = 'iOS';     device = 'Смартфон'; }
    else if (/Macintosh/i.test(ua))  { os = 'macOS'; }
    else if (/Linux/i.test(ua))      { os = 'Linux'; }

    return os + ' · ' + device;
  }

  // ── Fetch cycle ──────────────────────────────────────────────────────────
  async function doCheck() {
    if (!els.list.children.length) {
      els.dot.classList.add('checking');
    }

    const enabled = getEnabledTargets();
    const [targetResults, ipInfo] = await Promise.all([
      Promise.all(enabled.map(checkTarget)),
      getIpInfo(),
    ]);

    const { ip, city, isp } = ipInfo;
    const device = getDeviceInfo();

    const online  = targetResults.filter(r => r.status === 'online');
    const pings   = online.map(r => r.ping).filter(Boolean);
    const avgPing = pings.length
      ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length)
      : null;

    renderOnline({
      ok:           online.length > 0,
      datetime:     new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
      ip,
      city,
      isp,
      device,
      avg_ping:     avgPing,
      online_count: online.length,
      total_count:  targetResults.length,
      targets:      targetResults,
    });

    // Record ping history & redraw chart
    const timeStr = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    pingHistory.push({ time: timeStr, ping: avgPing });
    drawPingChart();

    startProgress(INTERVAL);
  }

  // ── Ping chart (pure canvas) ─────────────────────────────────────────────
  function drawPingChart() {
    const canvas = els.pingChart;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const PAD_TOP = 16, PAD_BOT = 24, PAD_LEFT = 40, PAD_RIGHT = 8;
    const plotW = W - PAD_LEFT - PAD_RIGHT;
    const plotH = H - PAD_TOP - PAD_BOT;

    ctx.clearRect(0, 0, W, H);

    const pts = pingHistory;
    if (pts.length < 1) return;

    // Compute y-axis max
    const pings = pts.map(p => p.ping).filter(Boolean);
    const maxPing = pings.length ? Math.max(...pings) : 100;
    const yMax = Math.max(maxPing * 1.25, 20); // some headroom

    // Grid lines
    const gridLines = 4;
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#a0a0a0';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridLines; i++) {
      const y = PAD_TOP + (plotH / gridLines) * i;
      const val = Math.round(yMax - (yMax / gridLines) * i);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(W - PAD_RIGHT, y);
      ctx.stroke();
      ctx.fillText(val, PAD_LEFT - 6, y);
    }

    // X positions
    const maxPts = Math.max(pts.length, 2);
    function xOf(i) { return PAD_LEFT + (plotW / (maxPts - 1)) * i; }
    function yOf(p) { return PAD_TOP + plotH - (p / yMax) * plotH; }

    // Gradient fill under the line
    const grad = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + plotH);
    grad.addColorStop(0, 'rgba(0,0,0,0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    // Draw filled area (only for online segments)
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].ping === null) { continue; }
      const x = xOf(i), y = yOf(pts[i].ping);
      if (!started) {
        ctx.moveTo(x, PAD_TOP + plotH);
        ctx.lineTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (started) {
      // close to baseline
      for (let i = pts.length - 1; i >= 0; i--) {
        if (pts[i].ping !== null) { ctx.lineTo(xOf(i), PAD_TOP + plotH); break; }
      }
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Draw line segments
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let penDown = false;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].ping === null) { penDown = false; continue; }
      const x = xOf(i), y = yOf(pts[i].ping);
      if (!penDown) { ctx.moveTo(x, y); penDown = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    // Draw dots — black for normal, red for offline
    for (let i = 0; i < pts.length; i++) {
      const x = xOf(i);
      if (pts[i].ping === null) {
        // Offline — red column indicator
        ctx.fillStyle = 'rgba(224,48,48,0.12)';
        ctx.fillRect(x - 3, PAD_TOP, 6, plotH);
        // Red dot at bottom
        ctx.beginPath();
        ctx.arc(x, PAD_TOP + plotH, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#e03030';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, yOf(pts[i].ping), 3, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();
      }
    }

    // X-axis time labels (show a few)
    ctx.fillStyle = '#a0a0a0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = pts.length <= 8 ? 1 : Math.ceil(pts.length / 8);
    for (let i = 0; i < pts.length; i += step) {
      ctx.fillText(pts[i].time, xOf(i), PAD_TOP + plotH + 6);
    }
    // Always show last label
    if ((pts.length - 1) % step !== 0) {
      ctx.fillText(pts[pts.length - 1].time, xOf(pts.length - 1), PAD_TOP + plotH + 6);
    }
  }

  // Redraw on resize
  window.addEventListener('resize', drawPingChart);

  // ── Browser online / offline events ──────────────────────────────────────
  window.addEventListener('offline', () => {
    clearTimeout(pollTimer);
    els.dot.classList.remove('checking', 'partial');
    els.dot.classList.add('offline');
    els.label.textContent = 'Нет связи';
    els.sub.textContent   = 'устройство не подключено к интернету';

    // Record disconnect in ping history
    pingHistory.push({
      time: new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
      ping: null,
    });
    drawPingChart();
  });

  window.addEventListener('online', () => {
    doCheck();
    schedulePoll();
  });

  // ── Polling ───────────────────────────────────────────────────────────────
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      doCheck().then(schedulePoll);
    }, INTERVAL);
  }

  // ── Share: encode / decode snapshot in URL hash ───────────────────────────
  function encodeSnapshot(data) {
    const compact = {
      d: data.datetime,
      i: data.ip,
      c: data.city,
      s: data.isp,
      v: data.device,
      p: data.avg_ping,
      o: data.online_count,
      n: data.total_count,
      t: data.targets.map(t => [t.name, t.host, t.status === 'online' ? 1 : 0, t.ping]),
    };
    const json = JSON.stringify(compact);
    // base64url encoding
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeSnapshot(hash) {
    try {
      const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(escape(atob(b64)));
      const c = JSON.parse(json);
      return {
        ok:           c.o > 0,
        datetime:     c.d,
        ip:           c.i,
        city:         c.c,
        isp:          c.s,
        device:       c.v,
        avg_ping:     c.p,
        online_count: c.o,
        total_count:  c.n,
        targets:      c.t.map(r => ({ name: r[0], host: r[1], status: r[2] ? 'online' : 'offline', ping: r[3] })),
      };
    } catch {
      return null;
    }
  }

  function getShareUrl() {
    if (!lastResult) return null;
    const encoded = encodeSnapshot(lastResult);
    const base = location.origin + location.pathname;
    return base + '#s=' + encoded;
  }

  // Copy text to clipboard with fallback for HTTP contexts
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback: hidden textarea + execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function showCopiedFeedback() {
    els.shareBtn.classList.add('copied');
    els.shareBtn.textContent = 'Скопировано!';
    setTimeout(() => {
      els.shareBtn.classList.remove('copied');
      els.shareBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="3" r="2"/><circle cx="12" cy="13" r="2"/><circle cx="4" cy="8" r="2"/>' +
        '<line x1="5.7" y1="9.1" x2="10.3" y2="11.9"/><line x1="10.3" y1="4.1" x2="5.7" y2="6.9"/>' +
        '</svg> Поделиться';
    }, 1500);
  }

  // Share button click
  els.shareBtn.addEventListener('click', () => {
    const url = getShareUrl();
    if (!url) return;
    copyText(url).then(showCopiedFeedback);
  });

  // ── Settings panel ────────────────────────────────────────────────────────
  function renderSettings() {
    const enabled = getEnabledHosts();
    els.settingsCheckboxes.innerHTML = TARGETS.map(t => {
      const checked = enabled.has(t.host) ? 'checked' : '';
      const id = 'chk_' + t.host.replace(/\./g, '_');
      return (
        `<div class="settings-row">` +
        `<input type="checkbox" id="${id}" data-host="${escHtml(t.host)}" ${checked}>` +
        `<label for="${id}">${escHtml(t.name)} <span class="settings-host">${escHtml(t.host)}</span></label>` +
        `</div>`
      );
    }).join('');
  }

  els.settingsToggle.addEventListener('click', () => {
    const open = els.settingsPanel.hidden;
    els.settingsPanel.hidden = !open;
    els.settingsToggle.classList.toggle('active', open);
    if (open) renderSettings();
  });

  els.settingsCheckboxes.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb.dataset.host) return;
    const enabled = getEnabledHosts();
    if (cb.checked) {
      enabled.add(cb.dataset.host);
    } else {
      enabled.delete(cb.dataset.host);
    }
    saveEnabledHosts(enabled);
    // Re-run check immediately with new selection
    clearTimeout(pollTimer);
    doCheck().then(schedulePoll);
  });

  // ── Boot ──────────────────────────────────────────────────────────────────
  loadTargets().then(() => {
    const hashMatch = location.hash.match(/^#s=(.+)$/);
    if (hashMatch) {
      const snap = decodeSnapshot(hashMatch[1]);
      if (snap) {
        renderOnline(snap);
        els.sharedBanner.style.display = '';
        els.progress.style.display = 'none';
      } else {
        doCheck().then(schedulePoll);
      }
    } else {
      doCheck().then(schedulePoll);
    }
  });
})();
