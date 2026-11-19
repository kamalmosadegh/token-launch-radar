// Token Launch Radar — the page. Reads window.RADAR (written beside dashboard/ by
// main.ts from the same board board.json carries) and renders three views from the
// URL hash: the ranked board (#/), a filtered board (#/?cat=..&chain=..&q=..) and a
// per-protocol detail view (#/p/<slug>) with the model's arithmetic and farm plan.
// No network: every byte it shows arrived in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  var stats = document.getElementById('stats');
  if (!DATA || !app) return;

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (!days) return 'new';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return days + ' days';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // The model, recomputed on the page from the row's own factors, so a reader can
  // check the board's headline number against the arithmetic that produced it.
  function modelValue(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * row.growth_factor * row.age_factor * row.reach_factor));
  }

  stats.innerHTML =
    '<div class="stat"><b>' + DATA.scanned + '</b><span>protocols scanned</span></div>' +
    '<div class="stat"><b>' + DATA.rows.length + '</b><span>ranked pre-token</span></div>' +
    '<div class="stat"><b>' + DATA.watchlist_size + '/' + DATA.watchlist_size + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + DATA.live_size + '</b><span>already tokenised, set aside</span></div>' +
    '<div class="stat"><b>' + esc(DATA.as_of) + '</b><span>snapshot date</span></div>';

  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();

  function parseHash() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('?');
    var params = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (kv) {
        var pair = kv.split('=');
        params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
      });
    }
    return { path: parts[0] || '', params: params };
  }

  function boardUrl(params) {
    var qs = Object.keys(params).filter(function (k) { return params[k]; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return '#/' + (qs ? '?' + qs : '');
  }

  var sortKey = 'rank';
  var sortDir = 1;

  function renderBoard(params) {
    var q = (params.q || '').toLowerCase();
    var cat = params.cat || '';
    var chain = params.chain || '';
    var tier = params.tier || '';
    var rows = DATA.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && (r.chains || []).indexOf(chain) < 0) return false;
      if (tier === 'watch' && !r.watchlist) return false;
      if (tier === 'early' && r.watchlist) return false;
      return true;
    });
    var key = sortKey;
    rows.sort(function (a, b) {
      var va = key === 'name' ? a.name.toLowerCase() : a[key];
      var vb = key === 'name' ? b.name.toLowerCase() : b[key];
      if (va === null || va === undefined) va = -Infinity;
      if (vb === null || vb === undefined) vb = -Infinity;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
    });
    var maxImplied = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;

    var html = '';
    html += '<section class="method"><b>How a launch is priced.</b> Each category of tokenised protocol reveals what the market pays per TVL dollar (market cap / TVL, median, shrunk to the global median of <code>' +
      DATA.global_multiple.toFixed(3) + 'x</code> when peers are few). A pre-token protocol is priced as <code>TVL x category multiple x growth x age x reach</code> — growth from its 7-day TVL change, age from how long it has run with no token, reach from its chain count. No name is priced by hand.</section>';

    html += '<section class="controls">' +
      '<input type="search" id="f-q" placeholder="Search protocol or slug" value="' + esc(params.q || '') + '">' +
      '<select id="f-cat"><option value="">All categories</option>' + categories.map(function (c) { return '<option' + (c === cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="f-chain"><option value="">All chains</option>' + chains.map(function (c) { return '<option' + (c === chain ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="f-tier"><option value="">Watchlist + early finds</option><option value="watch"' + (tier === 'watch' ? ' selected' : '') + '>Watchlist ($50M+ TVL)</option><option value="early"' + (tier === 'early' ? ' selected' : '') + '>Early finds below the floor</option></select>' +
      '<span class="count">' + rows.length + ' of ' + DATA.rows.length + ' protocols</span></section>';

    if (!rows.length) {
      html += '<div class="empty">No protocol matches this filter. Clear the search or pick another category or chain.</div>';
    } else {
      var heads = [
        ['rank', '#', ''], ['name', 'Protocol', ''], ['chains', 'Chains', 'chains'],
        ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d', 'num'], ['multiple', 'Multiple', 'num'],
        ['implied_value_usd', 'Implied value', 'num'], ['tier', 'Tier', '']
      ];
      html += '<table><thead><tr>' + heads.map(function (h) {
        var arrow = sortKey === h[0] ? (sortDir === 1 ? ' ↑' : ' ↓') : '';
        return '<th class="' + h[2] + ' sortable" data-sort="' + h[0] + '">' + h[1] + arrow + '</th>';
      }).join('') + '</tr></thead><tbody>';
      rows.forEach(function (r) {
        var pct = r.change_7d === null ? '' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span>';
        html += '<tr data-slug="' + esc(r.slug) + '" class="' + (r.rank === 1 ? 'top1' : r.rank === 2 ? 'top2' : r.rank === 3 ? 'top3' : '') + '">' +
          '<td class="rank">' + r.rank + '</td>' +
          '<td><div class="pname">' + esc(r.name) + '</div><div class="pcat">' + esc(r.category || 'Uncategorised') + ' · tracked ' + fmtAge(r.age_days) + '</div></td>' +
          '<td class="chains">' + esc((r.chains || []).slice(0, 3).join(', ')) + ((r.chains || []).length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
          '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
          '<td class="num">' + (pct || 'n/a') + '</td>' +
          '<td class="num">' + r.multiple.toFixed(2) + 'x</td>' +
          '<td class="num"><span class="bar"><i style="width:' + Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%"></i><b class="implied">' + fmtUsd(r.implied_value_usd) + '</b></span></td>' +
          '<td>' + (r.watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge early">Early find</span>') + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');

    function apply() {
      var next = {
        q: document.getElementById('f-q').value.trim(),
        cat: document.getElementById('f-cat').value,
        chain: document.getElementById('f-chain').value,
        tier: document.getElementById('f-tier').value
      };
      location.hash = boardUrl(next);
    }
    ['f-cat', 'f-chain', 'f-tier'].forEach(function (id) { document.getElementById(id).addEventListener('change', apply); });
    var search = document.getElementById('f-q');
    var timer = null;
    search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(apply, 250); });
    search.addEventListener('keydown', function (e) { if (e.key === 'Enter') apply(); });
    app.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (k === 'chains' || k === 'tier') return;
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = (k === 'name' || k === 'rank') ? 1 : -1; }
        renderBoard(params);
      });
    });
    app.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/p/' + tr.getAttribute('data-slug'); });
    });
    if (params.q) { var s = document.getElementById('f-q'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  function renderDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { location.hash = '#/'; return; }
    var html = '<button class="back" id="back">← Back to the board</button>';
    html += '<section class="detail-head"><div><h2>' + esc(row.name) + '</h2><div class="pcat">' + esc(row.category || 'Uncategorised') + ' · ' + esc((row.chains || []).join(', ') || 'chain not recorded') + '</div></div>' +
      '<div class="big"><b>' + fmtUsd(row.implied_value_usd) + '</b><span>implied launch value · rank #' + row.rank + ' of ' + DATA.rows.length + '</span></div></section>';
    html += '<div class="grid">';
    html += '<section class="card"><h3>The protocol, from the snapshot</h3>' +
      kv('TVL', fmtUsd(row.tvl_usd)) + kv('TVL change, 7 days', fmtPct(row.change_7d)) +
      kv('Tracked by DefiLlama since', row.listed_at || 'not recorded') + kv('Running with no token for', fmtAge(row.age_days)) +
      kv('Chains', String((row.chains || []).length) + ((row.chains || []).length ? ' — ' + esc((row.chains || []).join(', ')) : '')) +
      kv('Tier', row.watchlist ? 'Watchlist (TVL at or above the $50M floor)' : 'Early find below the $50M floor') +
      kv('Token today', 'none recorded — no symbol, no CoinGecko id') + '</section>';
    html += '<section class="card"><h3>How the model prices this launch</h3>' +
      kv('Category multiple (mcap / TVL)', row.multiple.toFixed(3) + 'x from ' + row.peers + (row.peers === 1 ? ' tokenised peer' : ' tokenised peers')) +
      kv('Growth factor (7d change)', 'x' + row.growth_factor.toFixed(3)) +
      kv('Age factor (tokenless track record)', 'x' + row.age_factor.toFixed(3)) +
      kv('Reach factor (chains)', 'x' + row.reach_factor.toFixed(3)) +
      kv('TVL x multiple x growth x age x reach', fmtUsd(modelValue(row))) +
      kv('Board value (rank #' + row.rank + ')', fmtUsd(row.implied_value_usd)) +
      '<p class="note">The board value is the model value, with ties nudged a dollar apart so ranks never share a number. Protocols whose token already trades are set aside, never ranked: a launch price only means something before the launch.</p></section>';
    html += '<section class="card"><h3>Farm plan — what to do, what it costs</h3><ol class="farm">' +
      row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="note">Costs are estimates from the plan itself: the position sizes named in the steps, plus gas on ' + esc((row.chains || [])[0] || 'the main chain') + '. Nothing here is a promise of an airdrop; it is a season of real use, which is what launches have historically rewarded.</p></section>';
    html += '</div>';
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
    document.getElementById('back').addEventListener('click', function () { location.hash = '#/'; });
    window.scrollTo(0, 0);
  }

  function kv(k, v) { return '<div class="kv"><span>' + esc(k) + '</span><b>' + v + '</b></div>'; }

  function route() {
    var parsed = parseHash();
    if (parsed.path.indexOf('p/') === 0) renderDetail(decodeURIComponent(parsed.path.slice(2)));
    else renderBoard(parsed.params);
  }
  window.addEventListener('hashchange', route);
  route();
})();
