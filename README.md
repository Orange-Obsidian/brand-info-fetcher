# Brand Info Fetcher

매장명을 입력하면 Google Places API로 영업시간, 휴무일, 위치를 찾아 노트 프론트매터에 자동으로 넣는 옵시디언 플러그인입니다.

## 사용 전 준비

Google Cloud Console에서 Places API 키를 발급받아 플러그인 설정에 입력합니다. 키는 볼트의 `data.json`에만 저장되며 이 저장소에는 올라가지 않습니다.

## 설치

`main.js`, `manifest.json`을 볼트의 `.obsidian/plugins/brand-info-fetcher/`에 넣고 커뮤니티 플러그인에서 켭니다.
