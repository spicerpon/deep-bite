// ============================================================
// 광고 설정 — Google AdSense (디스플레이 배너) + H5 Games Ads (전면/보상형, Ad Placement API)
//
// 게시자 ID(ca-pub-…)는 AdMob/AdSense 공통입니다.
// provider 를 'none' 으로 두면 광고 코드가 전혀 로드되지 않습니다 (미리보기 빌드 등).
//
// 켜는 순서
//  1) AdSense 콘솔에서 사이트(kogames.dev) 추가 → 검토 승인 (index.html 의 google-adsense-account 메타로 소유 확인)
//  2) 승인 후 '광고 > 광고 단위' 에서 디스플레이 광고 2개 만들고 slot 번호를 아래 slots 에 입력
//  3) H5 Games Ads(전면/보상형)는 별도 신청(https://developers.google.com/ad-placement/docs/signup) → 승인되면 test 를 false 로
//     test: true 인 동안은 구글이 주는 '테스트 광고'만 나오고 수익은 없습니다.
// ============================================================
window.GF_ADS_CONFIG = {
  provider: 'adsense',                // 'none' | 'adsense'
  client: 'ca-pub-1318477289708440',  // AdSense/AdMob 게시자 ID
  test: true,                         // H5 Games Ads 테스트 모드 (승인 후 false)
  slots: {
    start: '',                        // 시작 화면 하단 디스플레이 광고 단위 ID (예: '1234567890') — 비우면 자리 숨김
    death: '',                        // 결과 화면 하단 디스플레이 광고 단위 ID
  },
  // 전면광고: N번째 사망 후 'Swim again' 을 누를 때, 마지막 전면광고로부터 최소 간격이 지났을 때만
  interstitialEveryDeaths: 3,
  interstitialMinGapMs: 120000,
  // 보상형: 결과 화면 '광고 보고 이어하기' — 죽기 직전 질량의 일정 비율로 근처에서 다시 시작
  continueMassShare: 0.5,
  continueMinMass: 40,                // 이보다 작게 죽었으면 이어하기 버튼을 보여주지 않음 (의미가 없음)
  continueMaxPerLife: 1,              // 한 목숨당 이어하기 횟수
};
