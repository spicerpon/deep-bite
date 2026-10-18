// ============================================================
// Deep Bite — UI glue (start screen, HUD, death screen)
// ============================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const C = GF.CONFIG;

  const els = {
    canvas: $('game'), minimap: $('minimap'), boostBtn: $('boost-btn'), joy: $('joy'),
    start: $('start'), death: $('death'), hud: $('hud'), toast: $('toast'), feed: $('feed'),
    name: $('fish-nick'), skinPrev: $('skin-prev'), skinNext: $('skin-next'), skinCanvas: $('skin-preview'), skinName: $('skin-name'),
    playOnline: $('play-online'), playBots: $('play-bots'), onlineNote: $('online-note'), status: $('status'),
    hudMass: $('hud-mass'), hudRank: $('hud-rank'), board: $('board'), hudPlayers: $('hud-players'), hint: $('hint'),
    deathTitle: $('death-title'), deathSub: $('death-sub'), stPeak: $('st-peak'), stKills: $('st-kills'), stFood: $('st-food'), stTime: $('st-time'),
    again: $('again'), menu: $('menu'),
    continueAd: $('continue-ad'), continueAdSub: $('continue-ad-sub'), adStatus: $('ad-status'), adStart: $('ad-start'), adDeath: $('ad-death'),
  };

  let skin = GF.storage.get('gf.skin', 0) | 0;
  // 기본 닉네임: 저장된 이름이 없으면 더미셋에서 랜덤
  const initialName = GF.storage.get('gf.name', '') || GF.randomName();
  els.name.value = initialName;
  // 브라우저 자동완성(연락처 이름 등)이 끼어들면 되돌림 — 사용자가 직접 입력하기 전까지만
  let userTyped = false;
  els.name.addEventListener('input', () => { if (document.activeElement === els.name) userTyped = true; });
  const guardAutofill = () => { if (!userTyped && els.name.value !== initialName) els.name.value = initialName; };
  [150, 600, 1500].forEach((ms) => setTimeout(guardAutofill, ms));
  const shuffleBtn = $('name-shuffle');
  if (shuffleBtn) shuffleBtn.addEventListener('click', () => { userTyped = true; els.name.value = GF.randomName(); els.name.focus(); });
  let game = null, net = null, mode = null;
  let toastTimer = 0;
  // 광고 상태: 이번 'Swim again' 전에 전면광고를 보여줄지 / 준비된 보상형 광고 재생 함수
  let pendingInterstitial = false, continueShow = null;

  // ---------- skin preview ----------
  const pctx = els.skinCanvas.getContext('2d');
  let previewT = 0, previewRaf = 0;
  function drawPreview(ts) {
    previewT = ts / 1000;
    const w = els.skinCanvas.width, h = els.skinCanvas.height;
    pctx.clearRect(0, 0, w, h);
    const grad = pctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0b5f8e'); grad.addColorStop(1, '#063a60');
    pctx.fillStyle = grad; pctx.fillRect(0, 0, w, h);
    GF.drawFish(pctx, { x: w / 2, y: h / 2 + 4, a: 0, r: 46, skin, boost: false, phase: 0 }, previewT, { mouth: 0.3 + 0.3 * Math.sin(previewT * 2), speed: 0.8 });
    if (!els.start.hidden) previewRaf = requestAnimationFrame(drawPreview);
  }
  function setSkin(i) {
    skin = (i + GF.SKINS.length) % GF.SKINS.length;
    els.skinName.textContent = GF.SKINS[skin].name;
    GF.storage.set('gf.skin', skin);
  }
  els.skinPrev.addEventListener('click', () => setSkin(skin - 1));
  els.skinNext.addEventListener('click', () => setSkin(skin + 1));
  setSkin(skin);

  // ---------- online availability ----------
  const online = GF.hasFirebaseConfig();
  if (!online) {
    els.playOnline.disabled = true;
    els.onlineNote.hidden = false;
  }

  // ---------- ads ----------
  const ADS = window.GF_ADS_CONFIG || { provider: 'none' };
  GF.Ads.init(ADS);
  GF.Ads.banner(els.adStart, ADS.slots && ADS.slots.start);

  // ---------- UI callbacks for Game ----------
  const ui = {
    toast(msg, isErr) {
      els.toast.textContent = msg;
      els.toast.classList.toggle('err', !!isErr);
      els.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { els.toast.hidden = true; }, isErr ? 6000 : 2500);
    },
    kill(name, gain) {
      const li = document.createElement('div');
      li.className = 'feed-item';
      li.innerHTML = `You ate <b>${escapeHtml(name)}</b> <span class="gain">+${GF.fmtMass(gain)}</span>`;
      els.feed.prepend(li);
      setTimeout(() => li.classList.add('out'), 2600);
      setTimeout(() => li.remove(), 3100);
      while (els.feed.children.length > 4) els.feed.lastChild.remove();
    },
    hud(info) {
      els.hudMass.textContent = GF.fmtMass(info.mass);
      els.hudRank.textContent = info.rank;
      els.hudPlayers.textContent = `${info.players} fish · ${info.room}`;
      const frag = document.createDocumentFragment();
      info.board.forEach((b, i) => {
        const li = document.createElement('li');
        if (b.uid === info.uid) li.className = 'me';
        li.innerHTML = `<span class="pos">${i + 1}</span><span class="nm">${escapeHtml(b.n || '?')}</span><span class="ms">${GF.fmtMass(b.m)}</span>`;
        frag.appendChild(li);
      });
      els.board.replaceChildren(frag);
      els.boostBtn.classList.toggle('on', !!info.boost);
    },
    death(st) {
      els.deathTitle.textContent = 'Eaten!';
      els.deathSub.textContent = `${st.killedBy} swallowed you whole.`;
      els.stPeak.textContent = GF.fmtMass(st.peak);
      els.stKills.textContent = st.kills;
      els.stFood.textContent = st.foodEaten;
      els.stTime.textContent = GF.fmtTime(st.time);
      els.death.hidden = false;
      els.hint.hidden = true;
      els.adStatus.hidden = true;

      // --- 광고 ---
      const A = GF.Ads;
      els.continueAd.hidden = true; continueShow = null;
      pendingInterstitial = A.recordDeath();                 // N번째 사망 → 다음 'Swim again' 전에 전면광고
      A.banner(els.adDeath, ADS.slots && ADS.slots.death);
      // 보상형 '이어하기': 의미 있는 크기로 죽었고 이번 목숨에 아직 안 썼을 때만 제안
      const canContinue = A.enabled && st.mass >= (ADS.continueMinMass || 40) && (st.continued || 0) < (ADS.continueMaxPerLife || 1);
      if (canContinue) {
        const share = ADS.continueMassShare || 0.5;
        els.continueAdSub.textContent = `Come back nearby with ${GF.fmtMass(Math.round(st.mass * share))} mass`;
        A.offerReward({
          onReady: (show) => {
            // 아직 결과 화면이고 죽은 상태일 때만 버튼 노출
            if (!els.death.hidden && game && game.me && !game.me.alive) { continueShow = show; els.continueAd.hidden = false; }
          },
          onPause: () => game.pause(),
          onResume: () => game.resume(),
          onViewed: () => {
            if (game.continueRun(share)) {
              els.death.hidden = true; els.hud.hidden = false;
              ui.toast('Back in the water!');
            }
          },
          onDismissed: () => { els.adStatus.textContent = 'Ad skipped — no continue this time.'; els.adStatus.hidden = false; },
        });
      }
    },
  };

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- start / stop ----------
  async function play(useOnline) {
    const name = GF.sanitizeName(els.name.value);
    els.name.value = name;
    GF.storage.set('gf.name', name);
    mode = useOnline ? 'online' : 'bots';
    els.playOnline.disabled = true; els.playBots.disabled = true;
    els.status.textContent = useOnline ? 'Connecting to the ocean…' : 'Filling the reef with fish…';
    els.status.hidden = false;
    try {
      if (net && net.disconnect) net.disconnect();
      net = useOnline ? new GF.FirebaseNet(window.GF_FIREBASE_CONFIG) : new GF.LocalNet();
      if (!game) game = new GF.Game({ canvas: els.canvas, minimapCanvas: els.minimap, boostBtn: els.boostBtn, joyEl: els.joy, ui });
      const info = await game.start(net, { name, skin });
      els.start.hidden = true;
      els.death.hidden = true;
      els.hud.hidden = false;
      els.hint.hidden = false;
      els.status.hidden = true;
      cancelAnimationFrame(previewRaf);
      if (useOnline) ui.toast(`Joined ${info.room}`);
      setTimeout(() => { els.hint.classList.add('fade'); }, 6000);
    } catch (e) {
      console.error(e);
      els.status.textContent = '';
      els.status.hidden = true;
      ui.toast(e && e.message ? e.message : String(e), true);
    } finally {
      els.playOnline.disabled = !online; els.playBots.disabled = false;
    }
  }

  els.playOnline.addEventListener('click', () => play(true));
  els.playBots.addEventListener('click', () => play(false));
  els.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(online); });

  els.again.addEventListener('click', async () => {
    els.continueAd.hidden = true; continueShow = null;   // 준비된 보상형 광고는 다음 사망 때 재사용
    if (pendingInterstitial) {
      pendingInterstitial = false;
      els.again.disabled = true; els.menu.disabled = true;
      try { await GF.Ads.interstitial({ onPause: () => game.pause(), onResume: () => game.resume() }); } catch (e) { /* ignore */ }
      els.again.disabled = false; els.menu.disabled = false;
      game.resume();
    }
    els.death.hidden = true;
    game.respawn();
  });
  els.continueAd.addEventListener('click', () => {
    const show = continueShow; continueShow = null;
    els.continueAd.hidden = true;
    if (!show || !show()) { els.adStatus.textContent = 'Ad not available right now.'; els.adStatus.hidden = false; }
  });
  els.menu.addEventListener('click', () => {
    els.continueAd.hidden = true; continueShow = null;
    els.death.hidden = true;
    els.hud.hidden = true;
    if (game) game.stop();
    if (net && net.disconnect) net.disconnect();
    net = null;
    els.start.hidden = false;
    els.hint.classList.remove('fade');
    previewRaf = requestAnimationFrame(drawPreview);
  });

  window.addEventListener('beforeunload', () => { if (net && net.disconnect) net.disconnect(); });

  // 터치 기기면 부스트 버튼 표시
  if (window.matchMedia('(pointer: coarse)').matches) {
    els.boostBtn.classList.add('touch');
    els.joy.hidden = false;
    document.body.classList.add('touch');
    const bt = document.querySelector('.board-title'); if (bt) bt.textContent = 'Leaders';
    els.hint.textContent = 'Joystick to steer · Hold BOOST (or a 2nd finger) to dash';
    const cm = $('ctrl-move'), cb = $('ctrl-boost');
    if (cm) cm.textContent = 'Joystick';
    if (cb) cb.textContent = 'Hold BOOST';
  }

  previewRaf = requestAnimationFrame(drawPreview);

  // 디버그 콘솔용 (예: GF.debug.game.me)
  GF.debug = { get game() { return game; }, get net() { return net; } };
})();
