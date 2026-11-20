// Token Launch Radar — the dashboard. Renders window.RADAR (written by main.ts
// from the sealed snapshot) with no network: search, filters, sorting, a detail
// view per protocol, and the live-token table kept apart from the ranked board.
//
// The farm plan below derives from the same record the model scored (category,
// chains, TVL, age) with the same rules as lib/radar.ts, so the plan a row
// shows here is the plan board.json carries for it.

(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !Array.isArray(D.rows)) {
    document.getElementById('meta').textContent = 'No radar data found beside this page.';
    return;
  }
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ---------- formatting ----------
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    return '<span class="' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + s + '</span>';
  }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function chainsText(r) {
    var shown = r.chains.slice(0, 3).join(', ');
    if (r.chain_count > 3) shown += ' +' + (r.chain_count - 3);
    return shown || '—';
  }

  // ---------- farm plan (same rules as the model: category, chains, TVL, age) ----------
  function capitalFor(r) {
    if (r.tvl_usd >= 1e9) return 250;
    if (r.tvl_usd >= 1e8) return 150;
    if (r.tvl_usd >= 1e7) return 75;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function mainAction(r, capital) {
    var c = (r.category || '').toLowerCase();
    var chain = r.chains.length ? r.chains[0] : 'its main chain';
    var name = r.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0)
      return 'Lend $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the deposit earning.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('leveraged farm') >= 0)
      return 'Add $' + capital + ' of liquidity to ' + name + '\'s deepest pool on ' + chain + ' and keep the LP position open.';
    if (c.indexOf('bridge') >= 0)
      return 'Bridge $' + capital + ' of USDC into ' + chain + ' with ' + name + ', then put the bridged funds to work in its app.';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0)
      return 'Stake $' + capital + ' of the native staking asset through ' + name + ' and hold the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0)
      return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0)
      return 'Fund your account with $' + capital + ' and take one position in a ' + name + ' market.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0)
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    if (c.indexOf('stable') >= 0)
      return 'Mint or hold $' + capital + ' of the stable asset issued through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0)
      return 'Mint $' + capital + ' of ' + name + '\'s yield-bearing asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0)
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('yield') >= 0)
      return 'Deposit $' + capital + ' into ' + name + '\'s highest-yield vault on ' + chain + ' and keep it staked.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(r) {
    var capital = capitalFor(r);
    var hold = holdDaysFor(r.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      'Open a fresh wallet used only for this farm and store its seed phrase offline, never in a screenshot or a chat. (under $3 of gas for the first transaction; about 5 minutes)',
      mainAction(r, capital) + ' (about $' + gas + ' of gas; about 15 minutes to set up)',
      'Do one real action every week — a deposit, a swap, a borrow, or a vote — so the activity spans several snapshots. (about $2 of gas a week; about 10 minutes a week)',
      'Keep the position open for at least ' + hold + ' days; airdrop snapshots reward wallets that stay, not wallets that flash in and out. (the $' + capital + ' stays locked in the position; ' + hold + ' days)',
      'Check ' + r.name + '\'s own points or rewards page once a week and claim only through links that page itself publishes — never pay anyone to claim for you. (free to check; about 10 minutes)',
      'Write the wallet address, the dates, and every transaction hash in a farm log, and decide your exit price before any token is announced. (nothing but the log; about 5 minutes)'
    ];
  }
  function verdict(r) {
    var share = r.rank / D.board_size;
    if (r.rank <= 10) return '<b>Farm first.</b> One of the ten strongest implied values on the whole board — start here before the rest.';
    if (share <= 0.25) return '<b>Farm now.</b> Top quarter of the board: a real position is worth the gas and the weeks.';
    if (share <= 0.5) return '<b>Worth a position.</b> Mid-board: farm it if you already use the protocol, or if its category fits your wallet.';
    return '<b>Watch it.</b> Small implied value next to the leaders — farm only if you already use it, and keep the position small.';
  }

  // ---------- header, hero, footer ----------
  document.getElementById('meta').textContent =
    'Snapshot ' + D.as_of + ' · ' + D.board_size + ' ranked rows (' + D.watchlist_size +
    ' watchlist + ' + D.early_size + ' early finds) · ' + D.live_size + ' live tokens set aside';
  document.getElementById('src').textContent = D.source;
  document.getElementById('mver').textContent = D.model_version;
  var top = rows[0];
  document.getElementById('hero-name').textContent = '#' + top.rank + ' ' + top.name;
  document.getElementById('hero-line').textContent =
    (top.category || 'Uncategorised') + ' on ' + chainsText(top) + ' — ' + money(top.tvl_usd) +
    ' TVL, no token recorded. ' + farmSteps(top)[1];
  document.getElementById('hero-stats').innerHTML =
    '<div><b>' + money(top.implied_value_usd) + '</b><span>Implied value</span></div>' +
    '<div><b>' + money(top.tvl_usd) + '</b><span>TVL</span></div>' +
    '<div><b>' + (top.change_7d === null ? '—' : (top.change_7d > 0 ? '+' : '') + top.change_7d.toFixed(1) + '%') + '</b><span>7-day TVL</span></div>' +
    '<div><b>' + ageText(top.age_days) + '</b><span>Running</span></div>';
  document.getElementById('hero-open').addEventListener('click', function () { openDetail(top.slug); });

  // ---------- filters ----------
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  function fillSelect(id, names) {
    var sel = document.getElementById(id);
    names.sort().forEach(function (n) {
      var o = document.createElement('option');
      o.value = n; o.textContent = n; sel.appendChild(o);
    });
  }
  fillSelect('cat', Object.keys(cats));
  fillSelect('chain', Object.keys(chains));

  var params = new URLSearchParams(window.location.search);
  if (params.get('cat')) document.getElementById('cat').value = params.get('cat');
  if (params.get('scope')) document.getElementById('scope').value = params.get('scope');
  if (params.get('q')) document.getElementById('q').value = params.get('q');
  if (params.get('sort')) document.getElementById('sort').value = params.get('sort');

  function currentRows() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var cat = document.getElementById('cat').value;
    var chain = document.getElementById('chain').value;
    var scope = document.getElementById('scope').value;
    var sort = document.getElementById('sort').value;
    var list = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (scope === 'watchlist' && !r.on_watchlist) return false;
      if (scope === 'early' && r.on_watchlist) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); }
    }[sort] || function (a, b) { return a.rank - b.rank; };
    return list.sort(function (a, b) { return by(a, b) || a.rank - b.rank; });
  }

  function renderBoard() {
    var list = currentRows();
    var tb = document.getElementById('rows');
    tb.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td>' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' +
        (r.on_watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge">Early</span>') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(chainsText(r)) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td>›</td></tr>';
    }).join('');
    document.getElementById('count').textContent = list.length + ' of ' + rows.length + ' rows';
    tb.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }
  ['q', 'cat', 'chain', 'scope', 'sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderBoard);
    document.getElementById(id).addEventListener('change', renderBoard);
  });

  // ---------- detail drawer ----------
  var detail = document.getElementById('detail');
  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var steps = farmSteps(r);
    document.getElementById('detail-body').innerHTML =
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(chainsText(r)) + '</p>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + (r.on_watchlist ? 'On the $50M+ watchlist' : 'Early find, below the watchlist floor') +
      ' · running ' + ageText(r.age_days) + ' · no token recorded</p>' +
      '<h3>Implied value — ' + money(r.implied_value_usd) + '</h3>' +
      '<table><tbody>' +
      '<tr><td>TVL × category multiple</td><td class="num">' + money(r.tvl_usd) + ' × ' + r.cat_multiple + '</td></tr>' +
      '<tr><td>7-day growth (' + (r.change_7d === null ? 'not reported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + ')</td><td class="num">× ' + r.growth_mult + '</td></tr>' +
      '<tr><td>Maturity (' + ageText(r.age_days) + ' running)</td><td class="num">× ' + r.maturity_mult + '</td></tr>' +
      '<tr><td>Chain breadth (' + r.chain_count + ' chains)</td><td class="num">× ' + r.breadth_mult + '</td></tr>' +
      '</tbody></table>' +
      '<div class="verdict">' + verdict(r) + '</div>' +
      '<h3>Farm plan — six steps</h3>' +
      '<ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="sub">Implied value is this radar\'s claim from the snapshot, not a promise. The protocol may never issue a token; farm with money you can leave locked for the hold period.</p>';
    detail.hidden = false;
  }
  document.getElementById('detail-close').addEventListener('click', function () { detail.hidden = true; });

  // ---------- live table ----------
  document.getElementById('live-rows').innerHTML = D.live.map(function (r) {
    return '<tr><td><strong>' + esc(r.name) + '</strong></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + (r.mcap_usd === null ? '—' : money(r.mcap_usd)) + '</td>' +
      '<td class="num">' + pct(r.change_7d) + '</td></tr>';
  }).join('');

  renderBoard();
  if (params.get('detail') && bySlug[params.get('detail')]) openDetail(params.get('detail'));
  if (params.get('view') === 'live') document.getElementById('live-sec').scrollIntoView();
})();
