(() => {
  'use strict';

  const D = window.ORD_DATA;
  const MISSIONS = window.SUK_MISSIONS;
  const VIDEOS = window.SUK_VIDEOS || {};
  const GANGWON = window.GANGWON_LIST;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const COLORS = [
    { key: 'red', label: '빨강', c: '#ff4d4f' },
    { key: 'blue', label: '파랑', c: '#4096ff' },
    { key: 'purple', label: '보라', c: '#9254de' },
    { key: 'yellow', label: '노랑', c: '#fadb14' }
  ];
  const TEAMS = [{ name: '빨파팀', idx: [0, 1] }, { name: '보노팀', idx: [2, 3] }];

  /* ---------- 저장 ---------- */
  const KEY = 'dukon-roulette.v1';
  const defaults = () => ({
    players: COLORS.map((c) => c.label),
    tokenCfg: { reroll: 2, veto: 2 },
    tokens: { reroll: [2, 2, 2, 2], veto: [2, 2, 2, 2] },
    penalty: 10,
    missionsOn: Object.fromEntries(MISSIONS.map((m) => [m.id, m.active])),
    sound: true,
    fast: false,
    lastDraw: null,
    history: [],
    jail: [],
    season: 1
  });
  let S;
  try {
    S = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch (e) {
    S = defaults();
  }
  MISSIONS.forEach((m) => { if (!(m.id in S.missionsOn)) S.missionsOn[m.id] = m.active; });
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 저장 불가 환경 */ } };

  /* ---------- 랜덤 ---------- */
  const rnd = Math.random;
  const randint = (a, b, r = rnd) => a + Math.floor(r() * (b - a + 1));
  const pick = (arr, r = rnd) => arr[Math.floor(r() * arr.length)];
  const sample = (arr, n, r = rnd) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
  };
  const unitsOf = (grade) => D.units[grade].map((name) => ({ name, grade }));
  const upperPool = () => D.upperGrades.flatMap(unitsOf);

  /* ---------- 효과음 (WebAudio, 파일 없음) ---------- */
  let ac;
  const audio = () => (ac = ac || new (window.AudioContext || window.webkitAudioContext)());
  function tone(freq, dur = 0.06, type = 'square', vol = 0.05, when = 0) {
    if (!S.sound) return;
    try {
      const a = audio(); const t = a.currentTime + when;
      const o = a.createOscillator(); const g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* 오디오 불가 */ }
  }
  const sfx = {
    tick: () => tone(880 + rnd() * 200, 0.03, 'square', 0.025),
    shoot: () => { tone(160, 0.25, 'sawtooth', 0.09); tone(90, 0.35, 'triangle', 0.12, 0.03); },
    pop: () => tone(520 + rnd() * 300, 0.07, 'triangle', 0.06),
    ding: () => { tone(988, 0.25, 'sine', 0.08); tone(1318, 0.35, 'sine', 0.07, 0.1); },
    bad: () => { tone(220, 0.2, 'sawtooth', 0.07); tone(150, 0.3, 'sawtooth', 0.07, 0.15); }
  };

  /* ---------- UI 헬퍼 ---------- */
  const unitHTML = (u, extra = '') => {
    const g = D.grades[u.grade];
    return `<span class="unit ${extra}" style="--g:${g.color}"><small>${g.short}</small>${esc(u.name)}</span>`;
  };
  const pColor = (i) => COLORS[i].c;
  const pName = (i) => S.players[i] || COLORS[i].label;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1800);
  }
  function modal(title, bodyHTML, actions) {
    const m = $('#modal');
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    const box = $('#modalActions'); box.innerHTML = '';
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
      b.onclick = () => { if (a.onClick && a.onClick() === false) return; m.hidden = true; };
      box.appendChild(b);
    });
    m.hidden = false;
    return m;
  }
  function choosePlayer(title, filter, cb) {
    const list = [0, 1, 2, 3].map((i) => {
      const ok = filter(i);
      return `<button class="btn" data-p="${i}" ${ok ? '' : 'disabled'} style="border-left:5px solid ${pColor(i)}">${esc(pName(i))}</button>`;
    }).join('');
    const m = modal(title, `<div class="pick-list">${list}</div>`, [{ label: '취소', cls: 'btn-ghost' }]);
    $$('[data-p]', m).forEach((b) => b.onclick = () => { m.hidden = true; cb(+b.dataset.p); });
  }

  /* ---------- 세부 추첨 ---------- */
  // 개인/팀 단위 값 생성기: 거부권으로 다시 뽑을 때도 사용
  const GEN = {
    top04: () => { const n = randint(0, 4); return { text: n + '상위', desc: n === 0 ? '노블로! 상위 없이 진행' : `정확히 ${n}개만 올리기` }; },
    godo1020: () => { const n = randint(10, 20); return { text: n + '고도', desc: '딱 그만큼만 고도' }; },
    godo720: () => { const n = randint(7, 20); return { text: n + '고도', desc: '딱 그만큼만 고도' }; },
    legend1: () => ({ units: sample(unitsOf('legend'), 1) }),
    hidden1: () => ({ units: sample(unitsOf('hidden'), 1) }),
    mystic1: () => ({ units: sample(unitsOf('mystic'), 1) }),
    upper1: () => ({ units: sample(upperPool(), 1) }),
    gangwon: () => {
      const g = pick(GANGWON);
      const v = g.draw ? GEN[g.draw]() : {};
      return { text: g.name, desc: v.text ? v.text : (g.desc || ''), units: v.units };
    },
    guess: () => { const n = randint(0, 100); return { text: '' + n, desc: '팀 유카 합을 이 숫자에 맞추기' }; },
    namegen: () => {
      const pool = upperPool();
      const chars = [...new Set(pool.flatMap((u) => [...u.name.replace(/\s/g, '')]))];
      for (let tries = 0; tries < 200; tries++) {
        const cs = sample(chars, 2);
        const hit = pool.filter((u) => cs.some((c) => u.name.includes(c)));
        if (hit.length >= 3 && hit.length <= 14) return { text: cs.join(' · '), units: hit };
      }
      return { text: '?', units: [] };
    }
  };

  const perPlayer = (title, gen) => ({ type: 'players', title, gen, values: [0, 1, 2, 3].map(() => GEN[gen]()) });
  const perTeam = (title, gen) => ({ type: 'teams', title, gen, values: [0, 1].map(() => GEN[gen]()) });

  const DRAWERS = {
    none: () => [],
    force4: () => [{ type: 'units', title: '4명 전원 강제', units: sample(upperPool(), 1), big: true }],
    mustgo: () => [{ type: 'units', title: '팀마다 하나씩 나눠서 꼭 가기', units: sample(upperPool(), 2), big: true }],
    need44: () => [
      { type: 'units', title: '필수 전설 4', units: sample(unitsOf('legend'), 4) },
      { type: 'units', title: '필수 히든 4', units: sample(unitsOf('hidden'), 4) }
    ],
    ban77: () => [
      { type: 'units', title: '금지 전설 7', units: sample(unitsOf('legend'), 7), ban: true },
      { type: 'units', title: '금지 히든 7', units: sample(unitsOf('hidden'), 7), ban: true }
    ],
    yourtop: () => [perPlayer('너의 상위는', 'top04')],
    godo: () => [perPlayer('인생의 고도', 'godo1020'), { type: 'action', id: 'godoExtra', label: '졸업보상 꼴찌 추가 뽑기 (1~10)' }],
    dice: () => {
      const rolls = [];
      while (rolls.length < 4) { const n = randint(1, 100); if (!rolls.includes(n)) rolls.push(n); }
      return [
        { type: 'units', title: '이번 판 상위 4', units: sample(upperPool(), 4), big: true },
        { type: 'dice', title: '주사위 (높은 사람부터 골라가기)', rolls }
      ];
    },
    namegen: () => [perTeam('팀별 글자', 'namegen')],
    mystic: () => [{ type: 'units', title: '신비함 목록 (이 중 아무거나 1개)', units: unitsOf('mystic') }, { type: 'note', text: '이세계 도박 최대 8회. 8번 안에 안 나오면 벌칙 없음.' }],
    gangwon: () => [perPlayer('강원랜디 개인 미션', 'gangwon')],
    numguess: () => [perTeam('팀 목표 숫자', 'guess'), { type: 'note', text: '3인 이상 클리어 필수. 팀 유카 합이 목표에 더 가까운 팀 승리!' }],
    randunit: () => [{ type: 'units', title: '강제 랜유', units: sample(unitsOf('mystic'), 1), big: true }]
  };

  /* ---------- 룰렛 ---------- */
  const activeMissions = () => MISSIONS.filter((m) => S.missionsOn[m.id]);
  let spinning = false;

  function spin(forcedId) {
    if (spinning) return;
    const pool = activeMissions();
    if (!pool.length) { toast('설정에서 미션을 하나 이상 켜주세요'); return; }
    const target = forcedId ? MISSIONS.find((m) => m.id === forcedId) : pick(pool);
    spinning = true;
    $('#shootBtn').disabled = true; $('#rerollBtn').disabled = true;
    $('#result').innerHTML = '';
    const stamp = $('#stamp'); stamp.classList.remove('hit');
    const reel = $('#reel'); const txt = $('#reelText');
    reel.classList.add('spinning');
    const names = (pool.length > 1 ? pool : MISSIONS).map((m) => m.name);
    const total = S.fast ? 700 : 2600;
    const start = performance.now();
    let last = 0; let i = Math.floor(rnd() * names.length);
    function frame(now) {
      const p = Math.min(1, (now - start) / total);
      const interval = 40 + 360 * p * p * p; // 점점 느려짐
      if (now - last >= interval) {
        last = now; i = (i + 1) % names.length; txt.textContent = names[i]; sfx.tick();
      }
      if (p < 1) return requestAnimationFrame(frame);
      txt.textContent = target.name; reel.classList.remove('spinning');
      sfx.shoot(); stamp.classList.add('hit');
      const blocks = (DRAWERS[target.draw] || DRAWERS.none)();
      S.lastDraw = { id: target.id, blocks, at: Date.now() };
      save();
      renderResult(true).then(() => {
        spinning = false; $('#shootBtn').disabled = false; updateRerollBtn();
      });
    }
    requestAnimationFrame(frame);
  }

  function updateRerollBtn() {
    const has = S.tokens.reroll.some((n) => n > 0);
    $('#rerollBtn').disabled = !S.lastDraw || !has || spinning;
  }

  function renderResult(animate) {
    const box = $('#result');
    const d = S.lastDraw;
    if (!d) { box.innerHTML = '<p class="muted" style="text-align:center">슛! 버튼을 눌러 이번 판 미션을 뽑으세요.</p>'; return Promise.resolve(); }
    const m = MISSIONS.find((x) => x.id === d.id);
    if (!animate) { $('#reelText').textContent = m.name; $('#stamp').classList.add('hit'); }
    const vids = VIDEOS[m.id];
    let html = `<div class="mission-head"><div style="flex:1;min-width:240px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h3>${esc(m.name)}</h3><span class="badge">${esc(m.cat)}</span>
      ${vids ? `<span class="badge">슥균맨 영상 ${vids.count}개</span>` : ''}</div>
      <ul class="rules">${m.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <div class="pen">벌칙: ${esc(m.penalty)}</div></div></div>`;
    d.blocks.forEach((b, bi) => { html += blockHTML(b, bi); });
    html += `<div class="result-actions">
      <a class="btn btn-ghost" href="#record">결과 입력하러 가기 →</a>
      ${vids && vids.top[0] ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="https://youtu.be/${vids.top[0].id}">슥균맨은 어떻게 했나 보기 ↗</a>` : ''}
    </div>`;
    box.innerHTML = html;
    bindResult();
    const items = $$('.reveal', box);
    if (!animate) { items.forEach((el) => el.classList.add('in')); return Promise.resolve(); }
    const gap = S.fast ? 50 : 140;
    return new Promise((res) => {
      items.forEach((el, k) => setTimeout(() => { el.classList.add('in'); sfx.pop(); if (k === items.length - 1) { sfx.ding(); res(); } }, 250 + k * gap));
      if (!items.length) { sfx.ding(); res(); }
    });
  }

  function blockHTML(b, bi) {
    const head = (t, extra = '') => `<div class="block-title">${esc(t)} ${extra}</div>`;
    if (b.type === 'units') {
      return `<div class="block">${head(b.title)}<div class="unit-grid">${b.units.map((u) => `<span class="reveal">${unitHTML(u, (b.big ? 'big ' : '') + (b.ban ? 'ban' : ''))}</span>`).join('')}</div></div>`;
    }
    if (b.type === 'players') {
      return `<div class="block">${head(b.title)}<div class="player-grid">${b.values.map((v, i) => pcardHTML(v, i, bi, 'p')).join('')}</div></div>`;
    }
    if (b.type === 'teams') {
      return `<div class="block">${head(b.title)}<div class="team-grid">${b.values.map((v, t) => {
        const tm = TEAMS[t];
        return `<div class="pcard reveal" style="--c:linear-gradient(90deg,${pColor(tm.idx[0])},${pColor(tm.idx[1])});border-top-color:${pColor(tm.idx[0])}">
          <div class="who">${esc(tm.name)} (${esc(pName(tm.idx[0]))} · ${esc(pName(tm.idx[1]))})</div>
          ${v.text ? `<div class="val">${esc(v.text)}</div>` : ''}${v.desc ? `<div class="desc">${esc(v.desc)}</div>` : ''}
          ${v.units ? `<div class="unit-grid">${v.units.map((u) => unitHTML(u)).join('')}</div>` : ''}</div>`;
      }).join('')}</div></div>`;
    }
    if (b.type === 'dice') {
      const order = [0, 1, 2, 3].sort((a, c) => b.rolls[c] - b.rolls[a]);
      return `<div class="block">${head(b.title)}<div class="player-grid">${order.map((i, rank) => `
        <div class="pcard reveal ${rank === 0 ? 'rank1' : ''}" style="--c:${pColor(i)}">
          <div class="who">${rank + 1}순위 · ${esc(pName(i))}</div><div class="val">${b.rolls[i]}</div>
          ${vetoBtn(i, bi, 'd')}</div>`).join('')}</div></div>`;
    }
    if (b.type === 'note') return `<div class="block note reveal">${esc(b.text)}</div>`;
    if (b.type === 'action') {
      return `<div class="block"><button class="btn btn-gold" data-action="${b.id}" data-b="${bi}">${esc(b.label)}</button>
        ${b.result ? `<span style="margin-left:10px;font-weight:800">${esc(b.result)}</span>` : ''}</div>`;
    }
    return '';
  }

  function pcardHTML(v, i, bi, kind) {
    return `<div class="pcard reveal" style="--c:${pColor(i)}">
      <div class="who">${esc(pName(i))}${isJailed(i) ? ' ⛓' : ''}</div>
      ${v.text ? `<div class="val">${esc(v.text)}</div>` : ''}
      ${v.desc ? `<div class="desc">${esc(v.desc)}</div>` : ''}
      ${v.units ? `<div class="unit-grid">${v.units.map((u) => unitHTML(u)).join('')}</div>` : ''}
      ${vetoBtn(i, bi, kind)}</div>`;
  }
  const vetoBtn = (i, bi, kind) => S.tokens.veto[i] > 0
    ? `<div class="veto"><button class="btn btn-sm btn-ghost" data-veto="${i}" data-b="${bi}" data-k="${kind}">거부권 (${S.tokens.veto[i]})</button></div>` : '';

  function bindResult() {
    $$('[data-veto]').forEach((btn) => btn.onclick = () => {
      const i = +btn.dataset.veto; const b = S.lastDraw.blocks[+btn.dataset.b];
      if (S.tokens.veto[i] <= 0) return;
      modal('거부권 사용', `<b style="color:${pColor(i)}">${esc(pName(i))}</b>님이 거부권을 써서 자기 결과만 다시 뽑습니다. (남은 거부권 ${S.tokens.veto[i]} → ${S.tokens.veto[i] - 1})`, [
        { label: '취소', cls: 'btn-ghost' },
        { label: '거부권 쓰기', cls: 'btn-gold', onClick: () => {
          S.tokens.veto[i]--;
          if (btn.dataset.k === 'd') {
            let n; do { n = randint(1, 100); } while (b.rolls.includes(n));
            b.rolls[i] = n;
          } else {
            b.values[i] = GEN[b.gen]();
          }
          save(); renderTokens(); renderResult(false); sfx.shoot(); toast(`${pName(i)} 거부권 사용!`);
        } }
      ]);
    });
    $$('[data-action="godoExtra"]').forEach((btn) => btn.onclick = () => {
      const b = S.lastDraw.blocks[+btn.dataset.b];
      choosePlayer('졸업보상이 가장 늦은 사람은?', () => true, (i) => {
        const n = randint(1, 10);
        b.result = `${pName(i)} +${n}고도 추가!`;
        save(); renderResult(false); sfx.ding();
      });
    });
  }

  /* ---------- 토큰 바 ---------- */
  function renderTokens() {
    $('#tokenBar').innerHTML = [0, 1, 2, 3].map((i) => `
      <div class="token-chip ${isJailed(i) ? 'jailed' : ''}" style="--c:${pColor(i)}">
        <div class="nm">${esc(pName(i))}</div>
        <div class="tk">리롤권 <b>${S.tokens.reroll[i]}</b> · 거부권 <b>${S.tokens.veto[i]}</b></div>
      </div>`).join('');
    updateRerollBtn();
  }

  /* ---------- 도감 ---------- */
  let catFilter = '전체';
  function renderCatalog() {
    const cats = ['전체', ...new Set(MISSIONS.map((m) => m.cat))];
    $('#catFilter').innerHTML = cats.map((c) => `<button class="chip ${c === catFilter ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    $$('#catFilter .chip').forEach((b) => b.onclick = () => { catFilter = b.dataset.cat; renderCatalog(); });
    const list = MISSIONS.filter((m) => catFilter === '전체' || m.cat === catFilter);
    $('#catalogList').innerHTML = list.map((m) => {
      const v = VIDEOS[m.id];
      return `<div class="card">
        <h4>${esc(m.name)} <span class="badge">${esc(m.cat)}</span>${S.missionsOn[m.id] ? '' : '<span class="badge">룰렛 제외</span>'}</h4>
        <div>${esc(m.summary)}</div>
        <ul>${m.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="meta">벌칙: ${esc(m.penalty)}${v ? ` · 슥균맨 영상 약 ${v.count}개` : ''}</div>
        ${v ? `<div class="vids">${v.top.slice(0, 2).map((x) => `<a class="vid" target="_blank" rel="noopener" href="https://youtu.be/${x.id}">
          <img loading="lazy" src="https://i.ytimg.com/vi/${x.id}/mqdefault.jpg" alt=""><span>${esc(x.t)}</span><em>조회수 ${esc(x.v)} · ${esc(x.d)}</em></a>`).join('')}</div>` : ''}
        <div><button class="btn btn-sm" data-try="${m.id}">이 미션으로 돌리기</button></div>
      </div>`;
    }).join('');
    $$('[data-try]').forEach((b) => b.onclick = () => { location.hash = '#roulette'; setTimeout(() => spin(b.dataset.try), 200); });

    $('#unitMeta').textContent = `${D.version} 기준 · ${D.source}에서 ${D.checked} 확인 · 패치가 나오면 js/data-units.js만 고치면 됩니다.`;
    $('#unitList').innerHTML = Object.entries(D.units).map(([g, arr]) => `
      <div class="grp" style="--g:${D.grades[g].color}"><b>${D.grades[g].name}</b> <span class="muted small">${arr.length}개</span>
      <div class="names">${arr.map(esc).join(', ')}</div></div>`).join('');
  }

  /* ---------- 임펠다운 ---------- */
  const isJailed = (i) => S.jail.some((j) => j.player === i && !j.freed);
  function escapeMission() {
    const deal = pick(['물딜', '마딜']);
    const banCnt = randint(1, 2);
    return {
      deal,
      lines: [
        '난이도: 솔로 악몽 (혼자서 클리어)',
        `딜 타입: ${deal}`,
        `강제 상위: ${pick(upperPool()).name}`,
        `금지 전설: ${sample(unitsOf('legend'), banCnt).map((u) => u.name).join(', ')}`,
        `랜유: ${rnd() < 0.7 ? '금지' : '허용'}`,
        `캐변: ${randint(0, 2)}개까지 사용 가능`,
        '항법: 자유',
        '증거: 클리어 스샷에 죄수번호를 함께 남기기'
      ]
    };
  }
  function jailPlayer(i, reason) {
    const no = 'No.' + String(randint(1000, 9999));
    S.jail.unshift({ id: Date.now() + '-' + i, player: i, name: pName(i), reason: reason || '미션 실패', no, at: Date.now(), escape: escapeMission(), tries: 1, freed: false });
    save(); sfx.bad();
  }
  function renderJail() {
    $('#jailPlayer').innerHTML = [0, 1, 2, 3].map((i) => `<option value="${i}">${esc(pName(i))}</option>`).join('');
    const active = S.jail.filter((j) => !j.freed);
    $('#jailList').innerHTML = active.length ? active.map((j) => `
      <div class="card jail-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div><span class="dot" style="--c:${pColor(j.player)}"></span><b>${esc(pName(j.player))}</b></div>
          <div class="prisoner">${esc(j.no)}</div>
        </div>
        <div class="meta">사유: ${esc(j.reason)} · ${new Date(j.at).toLocaleString('ko-KR')} · 탈출 시도 ${j.tries}회째</div>
        <div class="escape"><b>탈출 미션</b><ul>${j.escape.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-gold btn-sm" data-free="${j.id}">탈옥 성공</button>
          <button class="btn btn-sm" data-retry="${j.id}">실패 · 새 탈출 미션</button>
          <button class="btn btn-ghost btn-sm" data-pardon="${j.id}">사면 (기록 삭제)</button>
        </div>
      </div>`).join('') : '<p class="muted">현재 수감자가 없습니다. 평화로운 바다…</p>';
    $$('[data-free]').forEach((b) => b.onclick = () => { const j = S.jail.find((x) => x.id === b.dataset.free); j.freed = Date.now(); save(); sfx.ding(); toast(`${pName(j.player)} 탈옥 성공!`); refreshAll(); });
    $$('[data-retry]').forEach((b) => b.onclick = () => { const j = S.jail.find((x) => x.id === b.dataset.retry); j.escape = escapeMission(); j.tries++; save(); sfx.bad(); renderJail(); });
    $$('[data-pardon]').forEach((b) => b.onclick = () => { S.jail = S.jail.filter((x) => x.id !== b.dataset.pardon); save(); refreshAll(); });

    const done = S.jail.filter((j) => j.freed);
    const cnt = [0, 1, 2, 3].map((i) => S.jail.filter((j) => j.player === i).length);
    const king = Math.max(...cnt) > 0 ? cnt.indexOf(Math.max(...cnt)) : -1;
    $('#jailDone').innerHTML = (king >= 0 ? `<p class="muted">최다 수감자: <b style="color:${pColor(king)}">${esc(pName(king))}</b> (${cnt[king]}회)</p>` : '') +
      (done.length ? `<table><tr><th>죄수번호</th><th>이름</th><th>사유</th><th>시도</th><th>출소</th></tr>${done.map((j) => `
        <tr><td>${esc(j.no)}</td><td><span class="dot" style="--c:${pColor(j.player)}"></span>${esc(pName(j.player))}</td><td>${esc(j.reason)}</td><td>${j.tries}회</td><td>${new Date(j.freed).toLocaleDateString('ko-KR')}</td></tr>`).join('')}</table>`
        : '<p class="muted">아직 출소 기록이 없습니다.</p>');
  }

  /* ---------- 전적 ---------- */
  const rec = { yuka: ['', ''], fails: [0, 0, 0, 0], dead: [false, false, false, false], mission: '' };
  function renderRecordForm() {
    if (!rec.mission && S.lastDraw) rec.mission = S.lastDraw.id;
    const opts = MISSIONS.map((m) => `<option value="${m.id}" ${m.id === rec.mission ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    $('#recordForm').innerHTML = `
      <div class="form-row" style="margin-bottom:12px">
        <label class="grow">이번 판 미션 <select id="recMission" class="select"><option value="">(미션 없음)</option>${opts}</select></label>
        <label>실패 1개당 <input class="input num" value="+${S.penalty}" disabled></label>
      </div>
      <div class="rec-teams">${TEAMS.map((t, ti) => `
        <div class="rec-team"><h4>${esc(t.name)}</h4>
          <label class="form-row"><span class="muted small">팀 유카 합</span>
            <input type="number" min="0" class="input" data-yuka="${ti}" value="${rec.yuka[ti]}" placeholder="0"></label>
          ${t.idx.map((i) => `<div class="rec-player"><span><span class="dot" style="--c:${pColor(i)}"></span>${esc(pName(i))}</span>
            <label class="muted small">실패 <input type="number" min="0" max="9" class="input num" data-fail="${i}" value="${rec.fails[i]}"></label>
            <label class="check small"><input type="checkbox" data-dead="${i}" ${rec.dead[i] ? 'checked' : ''}> 사망</label></div>`).join('')}
        </div>`).join('')}</div>
      <div class="form-row" style="margin-top:12px">
        <button class="btn btn-gold" id="saveRecBtn">결과 저장</button>
        <span class="muted small">사망 체크한 사람은 저장할 때 임펠다운으로 갈지 물어봅니다.</span>
      </div>`;
    $('#recMission').onchange = (e) => { rec.mission = e.target.value; previewRecord(); };
    $$('[data-yuka]').forEach((el) => el.oninput = () => { rec.yuka[+el.dataset.yuka] = el.value; previewRecord(); });
    $$('[data-fail]').forEach((el) => el.oninput = () => { rec.fails[+el.dataset.fail] = Math.max(0, +el.value || 0); previewRecord(); });
    $$('[data-dead]').forEach((el) => el.onchange = () => { rec.dead[+el.dataset.dead] = el.checked; previewRecord(); });
    $('#saveRecBtn').onclick = saveRecord;
    previewRecord();
  }
  function computeRecord() {
    const raw = rec.yuka.map((v) => (v === '' ? null : Math.max(0, +v || 0)));
    if (raw[0] === null || raw[1] === null) return null;
    const pen = TEAMS.map((t) => t.idx.reduce((s, i) => s + rec.fails[i] * S.penalty, 0));
    const final = raw.map((v, t) => v + pen[t]);
    let winner; let why = '';
    const guess = rec.mission === 'numguess' && S.lastDraw && S.lastDraw.id === 'numguess'
      ? S.lastDraw.blocks[0].values.map((v) => +v.text) : null;
    if (guess) {
      const diff = final.map((v, t) => Math.abs(v - guess[t]));
      winner = diff[0] === diff[1] ? -1 : (diff[0] < diff[1] ? 0 : 1);
      why = `목표 ${guess[0]} / ${guess[1]}, 차이 ${diff[0]} / ${diff[1]}`;
    } else {
      winner = final[0] === final[1] ? -1 : (final[0] < final[1] ? 0 : 1);
    }
    return { raw, pen, final, winner, why };
  }
  function previewRecord() {
    const r = computeRecord();
    if (!r) { $('#recordPreview').innerHTML = ''; return; }
    $('#recordPreview').innerHTML = `<div class="verdict">
      <div class="big">${r.winner < 0 ? '무승부!' : `${esc(TEAMS[r.winner].name)} 승리!`}</div>
      <div>${TEAMS.map((t, ti) => `${esc(t.name)}: 유카 ${r.raw[ti]} + 벌칙 ${r.pen[ti]} = <b>${r.final[ti]}</b>`).join(' &nbsp;|&nbsp; ')}</div>
      ${r.why ? `<div class="muted small">${esc(r.why)}</div>` : ''}</div>`;
  }
  function saveRecord() {
    const r = computeRecord();
    if (!r) { toast('양 팀 유카를 입력해주세요'); return; }
    const m = MISSIONS.find((x) => x.id === rec.mission);
    S.history.unshift({ at: Date.now(), mission: m ? m.name : '(없음)', missionId: rec.mission, players: S.players.slice(), raw: r.raw, pen: r.pen, final: r.final, winner: r.winner, fails: rec.fails.slice(), dead: rec.dead.slice() });
    S.history = S.history.slice(0, 300);
    save(); sfx.ding(); toast('결과 저장!');
    const dead = rec.dead.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
    rec.yuka = ['', '']; rec.fails = [0, 0, 0, 0]; rec.dead = [false, false, false, false];
    if (dead.length) {
      modal('임펠다운 수감', `사망: ${dead.map((i) => `<b style="color:${pColor(i)}">${esc(pName(i))}</b>`).join(', ')}<br>임펠다운으로 보낼까요?`, [
        { label: '봐주기', cls: 'btn-ghost', onClick: () => refreshAll() },
        { label: '수감!', cls: 'btn-danger', onClick: () => { dead.forEach((i) => jailPlayer(i, `사망 (${m ? m.name : '듀컨'})`)); refreshAll(); toast('임펠다운 수감 완료'); } }
      ]);
    }
    refreshAll();
  }
  function renderStats() {
    const st = [0, 1, 2, 3].map(() => ({ g: 0, w: 0, l: 0, d: 0, zero: 0, fail: 0, dead: 0 }));
    S.history.forEach((h) => TEAMS.forEach((t, ti) => t.idx.forEach((i) => {
      const s = st[i]; s.g++;
      if (h.winner < 0) s.d++; else if (h.winner === ti) s.w++; else s.l++;
      if (h.raw[ti] === 0) s.zero++;
      s.fail += h.fails[i] || 0; if (h.dead[i]) s.dead++;
    })));
    const jailCnt = (i) => S.jail.filter((j) => j.player === i).length;
    $('#statTable').innerHTML = `<table><tr><th>플레이어</th><th>판</th><th>승</th><th>패</th><th>무</th><th>승률</th><th>팀 유카 0</th><th>미션 실패</th><th>사망</th><th>수감</th></tr>
      ${st.map((s, i) => `<tr><td><span class="dot" style="--c:${pColor(i)}"></span>${esc(pName(i))}</td><td>${s.g}</td><td class="win">${s.w}</td><td class="lose">${s.l}</td><td>${s.d}</td>
      <td>${s.g ? Math.round((s.w / s.g) * 100) + '%' : '-'}</td><td>${s.zero}</td><td>${s.fail}</td><td>${s.dead}</td><td>${jailCnt(i)}</td></tr>`).join('')}</table>`;
    $('#historyList').innerHTML = S.history.length ? `<table><tr><th>시간</th><th>미션</th><th>빨파팀</th><th>보노팀</th><th>결과</th><th></th></tr>
      ${S.history.slice(0, 50).map((h, k) => `<tr><td>${new Date(h.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(h.mission)}</td>
      <td>${h.final[0]}${h.pen[0] ? ` <span class="muted small">(+${h.pen[0]})</span>` : ''}</td><td>${h.final[1]}${h.pen[1] ? ` <span class="muted small">(+${h.pen[1]})</span>` : ''}</td>
      <td>${h.winner < 0 ? '무' : `<span class="win">${esc(TEAMS[h.winner].name)}</span>`}</td><td><button class="btn btn-sm btn-ghost" data-del="${k}">삭제</button></td></tr>`).join('')}</table>`
      : '<p class="muted">아직 기록이 없습니다.</p>';
    $$('[data-del]').forEach((b) => b.onclick = () => { S.history.splice(+b.dataset.del, 1); save(); refreshAll(); });
  }

  /* ---------- 운세 ---------- */
  function seeded(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const LUCK = [
    { g: '대길', w: 1, lines: ['오늘은 말하는 대로 패가 붙는 날. 노리던 그 상위, 오늘 갑니다.', '유카 0이 눈앞에 보인다. 겁먹지 말고 다상위 가세요.', '랜유 버튼을 누르면 신비가 웃으며 다가온다.'] },
    { g: '길', w: 3, lines: ['첫 전설 방향만 잘 잡으면 술술 풀립니다.', '보상치기가 떠도 걱정 마세요. 보상이 알아서 맞춰 나옵니다.', '고도를 하면 원하는 게 뜬다. 딱 한 번만 더.'] },
    { g: '중길', w: 4, lines: ['무난한 하루. 무리한 도박만 피하면 클리어는 합니다.', '스토리는 잘 밀리는데 보스가 살짝 버팁니다. 보잡 하나 챙기세요.', '팀원 말을 들으면 이깁니다. 오늘은 내 고집을 내려놓으세요.'] },
    { g: '소길', w: 3, lines: ['패가 조금 꼬여도 끝까지 가면 풀립니다.', '리롤권은 아껴두세요. 오늘은 꼭 쓸 일이 생깁니다.', '오늘의 키워드는 "이감". 이감 하나가 판을 살립니다.'] },
    { g: '흉', w: 2, lines: ['랜유를 누를수록 멀어지는 하루. 지갑(목재)을 닫으세요.', '오늘 고도는 배신합니다. 정해진 횟수만 하세요.', '임펠다운 문이 살짝 열려 있습니다. 신세계 전 라인 관리 주의!'] },
    { g: '대흉', w: 1, lines: ['오늘만 산다는 마음으로… 진짜 오늘만 삽니다. 죽지만 마세요.', '강제 미션이 나를 노리고 있다. 거부권을 손에 쥐고 시작하세요.'] }
  ];
  function fortuneFor(name, dateStr) {
    const r = seeded(dateStr + '|' + name);
    const total = LUCK.reduce((s, l) => s + l.w, 0);
    let x = r() * total; let L = LUCK[0];
    for (const l of LUCK) { if ((x -= l.w) < 0) { L = l; break; } }
    const pool = upperPool();
    const lucky = pick(pool, r); let bad = pick(pool, r);
    while (bad.name === lucky.name) bad = pick(pool, r);
    return { grade: L.g, line: pick(L.lines, r), lucky, bad, godo: randint(10, 20, r), legend: pick(unitsOf('legend'), r) };
  }
  function renderFortune(extraName) {
    const d = new Date();
    const ds = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    $('#fortuneDate').textContent = `${d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} · 하루 동안 같은 결과가 나옵니다`;
    const people = [0, 1, 2, 3].map((i) => ({ name: pName(i), c: pColor(i) }));
    if (extraName) people.unshift({ name: extraName, c: 'var(--gold)' });
    $('#fortuneList').innerHTML = people.map((p) => {
      const f = fortuneFor(p.name, ds);
      return `<div class="card fortune-card" style="--c:${p.c}">
        <div class="muted small">${esc(p.name)}님의 오늘</div>
        <div class="luck">${f.grade}</div>
        <div class="fortune-line">${esc(f.line)}</div>
        <div class="fortune-row"><span>행운의 상위 ${unitHTML(f.lucky)}</span></div>
        <div class="fortune-row"><span>조심할 상위 ${unitHTML(f.bad, 'ban')}</span></div>
        <div class="fortune-row"><span>첫 전설 추천 ${unitHTML(f.legend)}</span><span class="badge">행운의 고도 ${f.godo}</span></div>
      </div>`;
    }).join('');
  }

  /* ---------- 설정 ---------- */
  function renderSettings() {
    $('#playerInputs').innerHTML = [0, 1, 2, 3].map((i) => `<label style="--c:${pColor(i)}">${COLORS[i].label}
      <input class="input" data-pname="${i}" value="${esc(pName(i))}" maxlength="12"></label>`).join('');
    $$('[data-pname]').forEach((el) => el.onchange = () => { S.players[+el.dataset.pname] = el.value.trim() || COLORS[+el.dataset.pname].label; save(); refreshAll(); });
    $('#cfgReroll').value = S.tokenCfg.reroll;
    $('#cfgVeto').value = S.tokenCfg.veto;
    $('#cfgPenalty').value = S.penalty;
    $('#cfgFast').checked = S.fast;
    $('#cfgSound').checked = S.sound;
    $('#missionToggles').innerHTML = MISSIONS.map((m) => `<label class="check"><input type="checkbox" data-mt="${m.id}" ${S.missionsOn[m.id] ? 'checked' : ''}> ${esc(m.name)}</label>`).join('');
    $$('[data-mt]').forEach((el) => el.onchange = () => { S.missionsOn[el.dataset.mt] = el.checked; save(); fillPicker(); });
  }
  function bindSettings() {
    $('#cfgReroll').onchange = (e) => { S.tokenCfg.reroll = Math.max(0, +e.target.value || 0); save(); };
    $('#cfgVeto').onchange = (e) => { S.tokenCfg.veto = Math.max(0, +e.target.value || 0); save(); };
    $('#cfgPenalty').onchange = (e) => { S.penalty = Math.max(0, +e.target.value || 0); save(); };
    $('#cfgFast').onchange = (e) => { S.fast = e.target.checked; save(); };
    $('#cfgSound').onchange = (e) => { S.sound = e.target.checked; save(); syncSoundBtn(); };
    $('#newSeasonBtn').onclick = () => modal('새 시즌', `모든 플레이어의 리롤권을 ${S.tokenCfg.reroll}개, 거부권을 ${S.tokenCfg.veto}개로 채웁니다. 전적은 그대로 남아요.`, [
      { label: '취소', cls: 'btn-ghost' },
      { label: '충전!', cls: 'btn-gold', onClick: () => {
        S.tokens.reroll = [0, 1, 2, 3].map(() => S.tokenCfg.reroll);
        S.tokens.veto = [0, 1, 2, 3].map(() => S.tokenCfg.veto);
        S.season++; save(); refreshAll(); toast(`시즌 ${S.season} 시작!`);
      } }
    ]);
    $('#exportBtn').onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `dukon-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#importFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then((t) => { S = Object.assign(defaults(), JSON.parse(t)); save(); refreshAll(); renderSettings(); toast('백업을 불러왔습니다'); })
        .catch(() => toast('파일을 읽지 못했어요'));
      e.target.value = '';
    };
    $('#resetBtn').onclick = () => modal('전체 초기화', '전적, 임펠다운, 토큰, 설정이 모두 지워집니다. 되돌릴 수 없어요.', [
      { label: '취소', cls: 'btn-ghost' },
      { label: '초기화', cls: 'btn-danger', onClick: () => { S = defaults(); save(); refreshAll(); renderSettings(); toast('초기화했습니다'); } }
    ]);
  }
  const syncSoundBtn = () => { $('#soundBtn').textContent = S.sound ? '🔊' : '🔇'; };

  /* ---------- 라우팅 ---------- */
  function route() {
    const tab = (location.hash || '#roulette').slice(1);
    const page = $('#page-' + tab) ? tab : 'roulette';
    $$('.page').forEach((p) => p.classList.toggle('on', p.id === 'page-' + page));
    $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === page));
    if (page === 'record') renderRecordForm();
    if (page === 'fortune') renderFortune($('#fortuneName').value.trim());
    if (page === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  function fillPicker() {
    $('#pickMission').innerHTML = '<option value="">직접 고르기…</option>' + MISSIONS.map((m) => `<option value="${m.id}">${esc(m.name)}${S.missionsOn[m.id] ? '' : ' (꺼짐)'}</option>`).join('');
  }

  function refreshAll() {
    renderTokens(); renderCatalog(); renderJail(); renderStats();
    if ($('#page-record').classList.contains('on')) renderRecordForm();
    if ($('#page-fortune').classList.contains('on')) renderFortune($('#fortuneName').value.trim());
  }

  /* ---------- 시작 ---------- */
  $('#shootBtn').onclick = () => spin();
  $('#pickMission').onchange = (e) => { if (e.target.value) { spin(e.target.value); e.target.value = ''; } };
  $('#rerollBtn').onclick = () => choosePlayer('누가 리롤권을 쓰나요?', (i) => S.tokens.reroll[i] > 0, (i) => {
    S.tokens.reroll[i]--; save(); renderTokens(); toast(`${pName(i)} 리롤권 사용!`);
    spin();
  });
  $('#jailBtn').onclick = () => { const i = +$('#jailPlayer').value; jailPlayer(i, $('#jailReason').value.trim()); $('#jailReason').value = ''; refreshAll(); toast(`${pName(i)} 임펠다운 수감!`); };
  $('#fortuneBtn').onclick = () => renderFortune($('#fortuneName').value.trim());
  $('#fortuneName').onkeydown = (e) => { if (e.key === 'Enter') renderFortune(e.target.value.trim()); };
  $('#soundBtn').onclick = () => { S.sound = !S.sound; save(); syncSoundBtn(); if (S.sound) sfx.ding(); };
  $('#footMeta').textContent = `유닛 데이터 ${D.version} (${D.checked})`;
  bindSettings();
  syncSoundBtn();
  fillPicker();
  refreshAll();
  renderResult(false);
  window.addEventListener('hashchange', route);
  route();
})();
