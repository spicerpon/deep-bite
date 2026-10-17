// ============================================================
// Deep Bite — GF.Ads: 광고 레이어 (어댑터 교체 가능)
//
// 게임 코드는 이 파일의 API만 쓰고, 어디 광고를 쓰는지 모릅니다.
//   GF.Ads.init(cfg)                      설정에 따라 SDK 로드 (provider 'none' 이면 전부 no-op)
//   GF.Ads.banner(el, slot)               디스플레이 배너 1회 채우기 (slot 없으면 el 숨김)
//   GF.Ads.interstitialDue()              이번 사망에 전면광고를 보여줄 차례인지 (빈도/간격 규칙)
//   GF.Ads.interstitial({onPause,onResume}) → Promise<boolean>  전면광고 (없으면 즉시 false)
//   GF.Ads.offerReward({onReady,onPause,onResume,onViewed,onDismissed})  보상형 광고 준비 → 준비되면 onReady(show)
//
// 현재 어댑터: Google AdSense
//   - 배너: 표준 디스플레이 광고 단위 (<ins class="adsbygoogle">)
//   - 전면/보상형: H5 Games Ads = Ad Placement API (adBreak / adConfig)
//     https://developers.google.com/ad-placement
// 나중에 CrazyGames/Poki SDK 어댑터를 추가할 때는 _loadAdsense 와 같은 형태로 하나 더 붙이면 됩니다.
// ============================================================
window.GF = window.GF || {};
(function () {
  const Ads = {
    cfg: null,
    enabled: false,     // provider != 'none'
    sdkLoaded: false,   // adsbygoogle.js 로드 완료
    h5Ready: false,     // adConfig onReady 수신 (전면/보상형 사용 가능)
    deaths: 0,
    lastInterstitialAt: 0,
    _showing: false,
    _pendingReward: null, // { show, opts } — 준비됐지만 아직 안 본 보상형 광고

    init(cfg) {
      this.cfg = cfg || { provider: 'none' };
      this.enabled = !!(this.cfg && this.cfg.provider && this.cfg.provider !== 'none' && this.cfg.client);
      if (!this.enabled) return;
      if (this.cfg.provider === 'adsense') this._loadAdsense();
    },

    // ---------------------------------------------------------
    _loadAdsense() {
      const c = this.cfg;
      window.adsbygoogle = window.adsbygoogle || [];
      // Ad Placement API 진입점: 큐에 넣으면 SDK가 로드된 뒤 처리
      if (!window.adBreak) window.adBreak = (o) => window.adsbygoogle.push(o);
      if (!window.adConfig) window.adConfig = (o) => window.adsbygoogle.push(o);

      const s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(c.client);
      s.setAttribute('data-ad-client', c.client);
      s.setAttribute('data-ad-frequency-hint', Math.max(30, Math.round((c.interstitialMinGapMs || 120000) / 1000)) + 's');
      if (c.test) s.setAttribute('data-adbreak-test', 'on');
      s.onload = () => { this.sdkLoaded = true; };
      s.onerror = () => { this.sdkLoaded = false; };
      document.head.appendChild(s);

      window.adConfig({
        preloadAdBreaks: 'on',
        sound: 'off',                  // 게임에 소리가 없음
        onReady: () => { this.h5Ready = true; },
      });
    },

    // ---------------------------------------------------------
    // 디스플레이 배너. 같은 요소에는 한 번만 채움(화면 전환마다 새로 요청하지 않음 — 정책).
    banner(el, slot) {
      if (!el) return false;
      if (!this.enabled || !slot) { el.hidden = true; return false; }
      if (el.dataset.adFilled) { el.hidden = false; return true; }
      el.dataset.adFilled = '1';
      el.hidden = false;
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', this.cfg.client);
      ins.setAttribute('data-ad-slot', String(slot));
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      el.replaceChildren(ins);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ignore */ }
      return true;
    },

    // ---------------------------------------------------------
    // 사망 1회 기록. 반환: 이번에 전면광고 차례인지.
    recordDeath() {
      this.deaths++;
      return this.interstitialDue();
    },
    interstitialDue() {
      if (!this.enabled) return false;
      const every = Math.max(1, this.cfg.interstitialEveryDeaths | 0 || 3);
      if (this.deaths % every !== 0) return false;
      return Date.now() - this.lastInterstitialAt >= (this.cfg.interstitialMinGapMs || 0);
    },

    // 전면광고. 광고가 없거나 SDK 미준비면 즉시 false. 항상 resolve (reject 없음).
    interstitial({ onPause, onResume } = {}) {
      return new Promise((resolve) => {
        if (!this.enabled || !this.h5Ready || this._showing || !window.adBreak) return resolve(false);
        let done = false;
        const finish = (shown) => { if (done) return; done = true; this._showing = false; clearTimeout(timer); resolve(shown); };
        // 안전장치: 광고가 시작(beforeAd)되지도 않고 끝나지도 않으면 포기. 일단 시작된 광고는 SDK가 반드시 adBreakDone 을 부른다.
        const timer = setTimeout(() => finish(false), 45000);
        this._showing = true;
        try {
          window.adBreak({
            type: 'next',
            name: 'after_death',
            beforeAd: () => { clearTimeout(timer); if (onPause) try { onPause(); } catch (e) {} },
            afterAd: () => { if (onResume) try { onResume(); } catch (e) {} },
            adBreakDone: (info) => {
              const shown = !!(info && info.breakStatus === 'viewed');
              if (shown) this.lastInterstitialAt = Date.now();
              finish(shown);
            },
          });
        } catch (e) { finish(false); }
      });
    },

    // 보상형 광고 준비. 준비되면 onReady(show) — show() 를 부르면 광고 재생.
    // 이미 준비된 광고가 남아 있으면 그것을 재사용.
    offerReward({ onReady, onPause, onResume, onViewed, onDismissed } = {}) {
      if (!this.enabled || !this.h5Ready || !window.adBreak) return false;
      if (this._pendingReward) {
        const p = this._pendingReward;
        p.opts = { onReady, onPause, onResume, onViewed, onDismissed };
        if (p.show && onReady) onReady(p.show); // 아직 준비 전이면 beforeReward 에서 호출됨
        return true;
      }
      const pending = { show: null, opts: { onReady, onPause, onResume, onViewed, onDismissed }, consumed: false };
      this._pendingReward = pending;
      try {
        window.adBreak({
          type: 'reward',
          name: 'continue_run',
          beforeReward: (showAdFn) => {
            pending.show = () => {
              if (pending.consumed || this._showing) return false;
              pending.consumed = true;
              this._showing = true;
              if (this._pendingReward === pending) this._pendingReward = null;
              try { showAdFn(); } catch (e) { this._showing = false; return false; }
              return true;
            };
            const o = pending.opts;
            if (this._pendingReward === pending && o && o.onReady) o.onReady(pending.show);
          },
          beforeAd: () => { const o = pending.opts; if (o && o.onPause) try { o.onPause(); } catch (e) {} },
          afterAd: () => { const o = pending.opts; if (o && o.onResume) try { o.onResume(); } catch (e) {} },
          adViewed: () => { const o = pending.opts; if (o && o.onViewed) try { o.onViewed(); } catch (e) {} },
          adDismissed: () => { const o = pending.opts; if (o && o.onDismissed) try { o.onDismissed(); } catch (e) {} },
          adBreakDone: (info) => {
            this._showing = false;
            if (this._pendingReward === pending) this._pendingReward = null;
            // 광고가 없어서 끝난 경우(notReady/frequencyCapped/…) 버튼을 못 보여줄 뿐, 게임은 그대로
          },
        });
      } catch (e) { this._pendingReward = null; return false; }
      return true;
    },
  };
  GF.Ads = Ads;
})();
