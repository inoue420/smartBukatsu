# 広告の年齢別取り扱い

対応日：2026-11-09。管理番号：`SB-20261109-001`。アプリ作業ブランチ：`codex/ad-age-treatment`。

## 合意した仕様

- オーナー確認：Google Playの対象ユーザーに13歳未満を含めない。
- オーナー確認：保護者ロールは成人にのみ付与される。この運用を前提に、現在の所属チームの保護者ロールから機械的に成人と判定する。
- 保護者以外は、既存の `legalConsent.minimumAgeConfirmed === true` と整数の `minimumAge >= 13` があれば未成年者向けの扱いとする。監督・スタッフ・OB/OGなどの役職だけで成人と判定しない。
- 年齢確認のない既存利用者には、確認を捏造・一括付与せず、子ども向け保護、G上限、非パーソナライズを維持する。
- 未成年者向けはTEEN指定、T上限（G/PG/Tを許可）、非パーソナライズ。成人もT上限で、広告SDKが同意・端末設定・地域の要件を反映する。成人判定だけで個別の広告同意を付与しない。
- 成人が保護者以外の役職のチームへ切り替えた場合は、既存の13歳以上確認に応じて未成年者向けまたは未確認へ戻す。成人判定を他チームへ引き継ぐ新しいDB項目は追加しない。

## 変更ファイルと目的

| ファイル | 変更 |
| --- | --- |
| `src/ads/adAgePolicy.js`（新規） | 既存情報からの年齢区分と、SDK/UMP/広告要求設定。グローバル設定変更の直列化 |
| `src/AuthContext.js` | 既存の利用者購読から年齢確認を渡す。追加読取・購読・書込なし |
| `App.js` | 認証Providerの内側に広告Providerを配置 |
| `src/ads/AdManager.native.js` | 認証・年齢区分・チーム・同意変更に応じた再設定。古い非同期結果を無効化。必須のプライバシー設定フォーム |
| `src/ads/AppBannerAd.native.js` | 要求オプションの適用、設定変更時の作り直し、古い広告コールバックと復帰処理の無効化 |
| `src/ads/AdManager.web.js` | プライバシー設定APIの空実装。Webの広告非表示を維持 |
| `src/ads/adSettings.js` | 全員一律の旧年齢設定を削除。インタースティシャル無効を維持 |
| `src/screens/SettingsScreen.js` | 必要時の広告プライバシー設定入口、保護者付与対象の説明、診断履歴説明 |
| `src/legal.js`、`src/services/firestoreService.js` | 利用規約の版を維持し、プライバシーポリシーの版を2026-11-09として新規登録時に記録。既存利用者の同意を書き換えない |
| `package.json`、`package-lock.json` | 広告ライブラリのみ16.3.4から16.4.0へ更新 |
| `src/ads/adAgePolicy.test.cjs`（新規） | SDKバリデータ、年齢分岐、同意、非同期競合、画面入口のテスト |
| `src/ads/AppBannerAd.test.cjs`、`src/services/emailVerification.test.cjs` | 広告再生成、古い回復要求・アカウント情報の無効化、同意版の区別 |
| `scripts/calendarWeekStartTestHarness.cjs`、`scripts/emailVerificationTestHarness.cjs` | 上記テストに必要な境界差し替え |

別リポジトリの `smartbukatsu/privacy.html` も同仕様に修正。ガイドの既存未commit変更を保護するため、`codex/ad-age-policy` ブランチの別worktreeを `dist/ad-age-treatment/website` に作成した。共通ヘッダー・フッター・CSSは変更しない。両リポジトリともcommit・push・PRは未実施。

## 実装上の保護

- 認証・利用者情報の確認待ち、メール確認待ち、チーム切り替え中、ログアウト時は広告を表示しない。
- 切り替え時は広告の表示許可を即座に無効化し、古い成人設定の要求を使い回さない。SDK設定とUMPの変更を直列化する。
- 同意更新に失敗して保存済み状態を使用する場合は、成人にも非パーソナライズを強制する。広告要求不可なら表示しない。
- 必要時に「設定」→「法務・サポート」→「広告のプライバシー設定」を表示し、変更後に広告を再生成する。
- 診断へ利用者ID・同意文字列等を追加しない。健康・コンディション、日誌、チームの内容を広告ターゲティングへ渡さない。
- SDKのTEEN APIがない場合は、制限を外す代替処理をせず初期化を停止する。

## 依存更新とOSへの影響

`react-native-google-mobile-ads@16.4.0` はTEENを指定する `ageRestrictedTreatment` を公開する。ライセンスはApache-2.0。Expoのpeer条件は47以上であり、Expo 54を更新せず使用する。Expo Goではこのネイティブ広告機能を使えないため、更新SDKを含むdev-clientまたはEASビルドが必要。

- Androidの広告SDK：25.0.0 → 25.4.0。
- iOSの広告SDK：13.1.0 → 13.5.0。
- UMP、Expo SDK、React Nativeは変更なし。旧広告ライブラリの公開APIではTEENを指定できないため、このライブラリだけを更新した。
- `app.json`、`eas.json`、アプリのバージョン、Android package、iOS bundle identifierは変更なし。`app.config.js`には後述のAndroidネイティブ修正の適用検査を追加。
- Firestore Rules・インデックス・Functions・認証権限・データ構造・本番データに変更なし。新規登録時の既存 `privacyPolicyVersion` の値のみ新版へ変わる。

## 実行コマンドと検証

読み取り：Git状態・履歴・差分、関連ソース、SDKソース、公式資料。

変更・検証の主なコマンド：

```text
git switch -c codex/ad-age-treatment
npm install --save-exact react-native-google-mobile-ads@16.4.0 --ignore-scripts --no-audit --no-fund
git worktree add -b codex/ad-age-policy <アプリ>/dist/ad-age-treatment/website HEAD
node --test src/ads/adAgePolicy.test.cjs src/ads/AppBannerAd.test.cjs src/services/emailVerification.test.cjs src/services/teamSwitching.test.cjs src/services/loadingOptimization.test.cjs src/services/workspaceStartup.test.cjs src/services/appReview.test.cjs src/services/calendarWeekStart.test.cjs
node --require ./dist/ad-age-treatment/baseline-loader.cjs --test --test-name-pattern "startup waits for the gate" src/services/loadingOptimization.test.cjs
node --test --test-skip-pattern "startup waits for the gate" src/services/loadingOptimization.test.cjs
node node_modules/expo/bin/cli export --platform android --platform ios --max-workers 2 --output-dir dist/ad-age-treatment/export
git diff --check
```

exportは `EXPO_NO_DOTENV=1`、`EXPO_OFFLINE=1`、`CI=1` で実行し、秘密情報の読込・本番広告通信を行わない。検証生成物は既存ignore対象のdist配下。

初回のnpm取得は制限環境のDNSエラーで失敗し、承認後の再実行で取得成功。Firebase Authの既存AsyncStorage peer警告が出たが、他の依存バージョンは更新していない。

周辺回帰テストの `loadingOptimization.test.cjs` の「startup waits for the gate」は `mergeMemberIdentity is not a function` で失敗。HEADのApp.jsを読み込ませた比較でも同一箇所で再現したため、今回の広告変更前からのテストモック不足と判定し、対象外の修正は行わない。

検証結果：

- 関連7ファイルのテスト150件成功。Provider順序の追加確認後、新規年齢ポリシーテスト16件も成功（このうち15件は先の150件と重複）。
- 読み込み最適化は既存失敗1件を明示的に除いた38件すべて成功。除外した1件は、今回変更前のHEADでも同じTypeErrorが再現。
- 最終ソースでAndroid/iOSのHermesバンドル生成成功。通常の並列数では再確認時にMetroワーカーのメモリ不足が発生したため中断し、`--max-workers 2` で成功。ネイティブコンパイル・実機・実AdMob配信は未確認。
- 両リポジトリの `git diff --check` は成功。プライバシーポリシーは日付と広告説明文だけの変更を確認し、ブラウザでの見た目の確認は未実施。
- プロジェクトにはnpm test/lintのスクリプトがないため、既存のnode:testを直接実行し、検証専用スクリプトの追加はしていない。
- 初回実装のアプリ側差分は、既存15ファイル変更、新規の年齢ポリシー・テスト・本書の計3ファイル。別worktreeはプライバシーポリシー1ファイルだけの変更。元のWebリポジトリにあるガイドの未commit変更は保持。

## 追加修正：Androidネイティブの年齢指定不整合

ユーザーのレビュー指摘を実ソースで確認した。16.4.0のJSバリデータとブリッジは `child` / `teen` / `unspecified` をそのまま渡すが、Androidの `buildRequestConfiguration` は大文字の値を比較していた。iOSは小文字比較で整合している。JSの値を大文字にする方法は入力検証で拒否される。UMPへの年齢指定は広告SDKへ自動転送されないため、UMP設定や非パーソナライズ指定だけではこの不整合を補えない。

前回のSDKバリデータ検証とHermes書き出しでは、Androidの実際の年齢別処理が適用されることまで保証できていなかった。

修正内容：

| ファイル | 今回追加した変更 |
| --- | --- |
| `scripts/patchAdMobAgeTreatment.cjs`（新規） | 16.4.0に限定し、Androidの比較文字列3か所だけを小文字へ補正。再実行可能。版・ソース構造が想定外なら書き換えずエラー |
| `package.json`、`package-lock.json` | postinstallに補正処理を登録し、npm install / npm ci後にも再適用。依存ライブラリの版は追加変更なし |
| `app.config.js` | 補正が未適用ならExpo設定の解決を停止。インストールスクリプトを省略しても未適用のままビルドしない |
| `scripts/adMobAgeTestHarness.cjs`（新規） | 導入済みSDKの実バリデータとMobileAdsブリッジを実行し、ネイティブへ渡る値を取得 |
| `scripts/runAdMobAndroidAgeTests.cjs`（新規） | 導入済みAndroidソースのbuildRequestConfigurationメソッドを切り出し、実ブリッジの値でKotlin/JVM実行 |
| `scripts/patchAdMobAgeTreatment.test.cjs`（新規） | 再適用、未適用の検出、未知の版・ソースの拒否、改行維持、大小文字、両OSの対応、Expoの停止を検証 |
| `src/ads/adAgePolicy.test.cjs` | 実SDKの検証を共通ハーネスへ移し、JavaScriptからネイティブへ渡る値も確認できるようにした |
| `scripts/androidCapture/captureEnvironment.test.cjs` | 新しいビルド検査と認証依存を境界へ反映。撮影モードで広告SDKへ通信しないことを維持 |

`src/ads/adAgePolicy.js` の小文字の値は正しいため変更していない。iOSのネイティブ実装、広告のT/G上限、成人判定、Firestoreや認証権限、サイトの説明は今回の追加修正では変更しない。

確認結果：

- 修正前の実Kotlin処理では `unknown: age-treatment was ignored: null` で失敗することを再現。
- 修正後、unknown→CHILD、teen→TEEN、adult→UNSPECIFIED、および成人→未成年、未成年→未確認、未確認→成人の計6ケースが成功。
- 上記は実バリデータ・実MobileAdsブリッジ・実Kotlinメソッドを実行する。ReactのReadableMapとGoogleのRequestConfiguration.Builderはテスト用の実装であり、Android実機上のGoogle広告SDKそのものを実行した検証ではない。
- Nodeの関連テスト65件すべて成功。再インストールに相当するソース差し替え後の再適用と、未適用時にExpo設定が停止することも検証。
- 修正後のExpo設定でAndroid/iOS両方のHermesバンドル生成に成功。完全なAndroidアプリのネイティブコンパイル、端末上のGoogle広告SDK、実広告配信は未検証。
- `npm run postinstall` と `node scripts/patchAdMobAgeTreatment.cjs --check` を実際に実行し、導入済みnode_modulesへ適用済みと確認。
- Kotlinコンパイラ2.1.20と依存jarは公式Mavenから検証用dist配下へ取得し、配布元のSHA1と照合。アプリの依存には追加しない。
- lockfile更新の初回オフライン実行はキャッシュ不足で失敗し、承認後の再実行で成功。既存Firebase AuthのAsyncStorage peer警告のみで、他の依存の版は変更しない。

追加検証コマンド：

```text
npm run postinstall
node scripts/patchAdMobAgeTreatment.cjs --check
node --test scripts/patchAdMobAgeTreatment.test.cjs src/ads/adAgePolicy.test.cjs src/ads/AppBannerAd.test.cjs scripts/androidCapture/captureEnvironment.test.cjs
node scripts/runAdMobAndroidAgeTests.cjs <Javaの絶対パス> dist/ad-age-treatment/native-age/compiler
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
node node_modules/expo/bin/cli export --platform android --platform ios --max-workers 2 --output-dir dist/ad-age-treatment/native-age/export
```

今回のexportは `SMARTBUKATSU_CAPTURE=1`、`APP_VARIANT=development`、`EXPO_NO_DOTENV=1`、`EXPO_OFFLINE=1`、`CI=1` で実行する。秘密情報を読み込まない。ネイティブ修正はJavaScriptだけのOTAでは反映できず、新しいAndroidネイティブビルドと実機確認が必要。iOSの実装は今回補正していない。

根拠：[16.4.0のAndroidソース](https://github.com/invertase/react-native-google-mobile-ads/blob/v16.4.0/android/src/main/java/io/invertase/googlemobileads/ReactNativeGoogleMobileAdsModule.kt)、[UMPと広告SDKへの年齢指定](https://developers.google.com/admob/android/privacy/gdpr)。

## 追加改善：P2 初期化の再開とキーボード表示中のバナー保持

ユーザーが提示したP2案を承認範囲として実装。年齢区分・パーソナライズの判定と、Androidの年齢指定補正はそのまま維持する。

初期化：

- 通信などの一時的な失敗は、初回、失敗から30秒後、次の失敗から60秒後の最大3回。その後はタイマーを止め、通信復帰または前面復帰を待つ。オフライン中・バックグラウンド中の実行は保留する。
- 初期3回を使い切った後は、オフライン→オンラインまたは前面復帰で1回だけ再開。前回の処理完了から最低60秒空け、重複イベントは1つの予約にまとめる。復帰後も失敗した場合、次の外部イベントまで待ち、初期3回のループへ戻さない。
- 初期化成功後は復帰イベントで再初期化しない。ログアウト、チーム切替、年齢区分・同意の変更では予約・古い非同期結果を無効化する。グローバルSDK/UMP処理の直列化も維持。
- 広告ID不足、設定検証エラー、OS/SDK非対応など既知の恒久エラーは自動再試行対象外。
- 同意情報を正常に取得できて広告要求不可の場合は、初期の自動再試行・通信復帰による再試行をしない。前面復帰で保存済み同意状態だけ確認し、要求可能になった場合に通常の同意更新・SDK初期化へ進む。この確認にも60秒制限を適用する。確認自体の失敗は引き続き同意確認待ち。
- 同意の取得が通信などで失敗し、保存済み状態も広告要求を許可できない場合は、一時的失敗として復帰可能にする。同意確認を通過した後のSDK通信エラーも、通信復帰で再試行できる。

バナー：

- 通常のキーボード開閉ではBannerAdを保持し、外側を高さ0・クリップ・透明度0にして表示領域から外す（当初のdisplay:noneは、下記のFabric指摘を受けて修正）。非表示中はpointerEvents、iOS/Androidのアクセシビリティ属性も無効化する。閉じるだけでは再生成・loadしない。
- 初期表示時からキーボードが開いている場合や、非表示中に利用者・チーム・年齢区分・同意条件が変わった場合は、新条件のバナーの初回生成を閉じるまで保留する。旧条件の広告は破棄する。広告要求不可・ログアウトでは直ちに破棄する。
- キーボード表示前／表示中の失敗と復帰待ちを保持し、閉じた後に必要な復旧だけ再開。既存の30秒間隔制限・同意再確認・読み込みの重複防止を維持する。キーボードのWillHide～DidHideの途中では復旧しない。
- iOSのバックグラウンド復帰時の既存ビュー復旧は維持。Androidでは失敗・復帰待ちの広告だけを通信／前面復帰で復旧し、正常な広告は手動loadしない。復旧失敗後の周期的な再要求は行わない。
- 復旧時に広告要求不可を検出したらProviderへ通知し、表示済み広告も破棄して新しい同意セッションへ移る。古いセッションの通知は無視する。

変更ファイル：

| ファイル | P2の変更 |
| --- | --- |
| `src/ads/adInitializationRecovery.js`（新規） | 初期3回、復帰待ち、60秒制限、恒久エラー／同意待ちの制御 |
| `src/ads/AdManager.native.js` | 初期化結果の分類、両OSのAppState/NetInfo監視、旧セッション無効化、要求不可の通知処理 |
| `src/ads/AdManager.web.js` | 新しい通知APIの無処理実装。Webの広告非表示は維持 |
| `src/ads/AppBannerAd.native.js` | 保持して非表示、タッチ・読み上げ除外、失敗／復帰待ちの再開 |
| `src/ads/adDiagnostics.js` | 初期試行と復帰試行の回数・待機理由を区別。非表示中でも読み込み状態を保持 |
| `src/ads/adInitializationRecovery.test.cjs`（新規） | 時刻・イベント重複・恒久エラー・同意・停止と非同期結果を検証 |
| `src/ads/adAgePolicy.test.cjs` | 両OSのProvider統合、同意／通信失敗、ログアウト・切替を検証 |
| `src/ads/AppBannerAd.test.cjs` | 両OSで10回連続開閉の保持、復旧待ち、条件変更中の破棄を検証 |
| `scripts/androidCapture/captureEnvironment.test.cjs` | 撮影モードで復帰用APIも動かないことを確認 |
| `docs/AD_AGE_TREATMENT.md` | 本記録 |

検証：

- 関連回帰テスト180件成功。広告、Android年齢補正、撮影モード、認証、チーム切替、起動、レビューを含む。実装本体を読み込み、React/native/SDK境界をテスト用に置き換えて検証した。
- Android/iOS両方のHermesバンドル生成に成功。最終の診断表示の修正も両バンドルへ含まれることを確認した。既存のAndroid年齢補正チェックと`git diff --check`も成功。ネイティブコンパイルと実機確認は未実施。
- パッケージ・lockfile・Expo/EAS設定・Firebaseデータ／ルール・認証処理・年齢ポリシー・Web公開文面は、このP2では追加変更していない。既存NetInfoを使用し依存追加なし。
- 実機では、テスト広告で通信復帰、長時間バックグラウンドからの復帰、キーボード開閉時のネイティブビュー保持・タッチ／VoiceOver／TalkBack除外、同意変更・ログアウト・チーム切替による破棄を確認する必要がある。自動テストは実際のAdMob要求数・実配信・収益や、OSによるネイティブ広告ビューの状態まで保証しない。
- 初期化は60秒、表示済みバナーの復旧は既存の30秒と、別々の制限。SDK側の通常の自動更新設定は変更していない。

実行コマンド（ログ・生成物は既存ignore対象のdist内）：

```text
node --test scripts/patchAdMobAgeTreatment.test.cjs src/ads/adInitializationRecovery.test.cjs src/ads/adAgePolicy.test.cjs src/ads/AppBannerAd.test.cjs scripts/androidCapture/captureEnvironment.test.cjs src/services/emailVerification.test.cjs src/services/teamSwitching.test.cjs src/services/workspaceStartup.test.cjs src/services/appReview.test.cjs
node node_modules/expo/bin/cli export --platform android --platform ios --max-workers 2 --output-dir dist/ad-age-treatment/p2-export
node scripts/patchAdMobAgeTreatment.cjs --check
git diff --check
```

exportは先の検証同様、撮影用development設定・dotenv読込なし・オフラインで実行。EASビルド／提出／OTA、commit／push／PR、管理シートへの追加書き込みは行わない。

P2だけを戻す場合は、`dist/ad-age-treatment/p2-before` の作業前控えと比較して今回の差分のみ戻し、新規の復帰制御・テストを取り除く。Webの通知API追加と撮影テストもP2部分だけ戻す。前回の年齢ポリシー・Android補正や他の未commit変更は一括破棄しない。データ変更はないためFirebaseの復元は不要。

## P2の追加修正：iOS Fabricによる広告本体の破棄を回避

レビュー指摘を導入済みソースで確認し、修正した。`app.json`の新アーキテクチャ設定はtrue、React Nativeは0.81.5、広告ライブラリは16.4.0。

- React Nativeの`ConcreteViewShadowNode.h`はdisplay:noneをHidden traitへ変換する。`sliceChildShadowNodeViewPairs.cpp`はiOSでHiddenなノードの配下をマウント対象から除外する。
- 削除されたビューは`RCTComponentViewRegistry.mm`でprepareForRecycleへ進む。広告ライブラリの`RNGoogleMobileAdsBannerView.mm`はそこで`_banner`を親から外してnilにする。
- したがって、前回のJSコンポーネント保持だけでは広告本体の保持を保証できなかった。前回の自動テストとバンドル生成ではこのネイティブ削除経路を検証できていなかった。

今回の変更は次の3ファイルだけ。他の未commit変更・年齢ポリシー・SDK補正を維持する。

| ファイル | 変更内容 |
| --- | --- |
| `src/ads/AppBannerAd.native.js` | display:noneを撤去。外側の高さ0・opacity:0と常時overflow:hiddenで非表示にする。collapsable:falseで常に実体を持つ親を維持し、removeClippedSubviews:falseでクリップに伴う子ビューの取り外しを無効化。内側はflexShrink:0で広告の寸法を保つ。BannerAdのID・サイズ指定・要求オプション・keyは通常の開閉で変更しない |
| `src/ads/AppBannerAd.test.cjs` | 表示状態のスタイル、タッチ・読み上げ除外、10回連続開閉の保持を確認。JSとは別にiOSのdisplay:none削除を表すネイティブ寿命モデルを追加し、旧方式へ差し替えた場合はJS保持・手動loadなしでも広告本体の生成が2回になることを検出。モデルが前提にする導入済みFabric・広告SDKのソース構造も検査 |
| `docs/AD_AGE_TREATMENT.md` | 原因・修正・検証の限界・実機確認手順を記録 |

クリップは描画の遮断として使用し、子ビューを削除する設定は使用しない。iOSのKeyboardAvoidingView内側と両OSのSafeAreaViewの縮小を防ぎ、広告のサイズ変更による別要求を避ける。現在の配置は画面ScrollView内ではなく、SafeAreaProvider直下の広告領域。SDKネイティブコードやFirebase、依存パッケージ、app.json、Expo/EAS設定、Webは変更しない。

Googleの[バナー公式説明](https://developers.google.com/admob/ios/banner#refresh_an_ad)では自動更新は画面に表示されている場合だけ行われる。ただし今回の高さ0・クリップ・透明度を導入済みSDKがどう判定するかはソースだけでは証明できない。アプリからの復旧loadは非表示中に抑止するが、SDK内部の自動更新停止を実機確認済みとはしない。すでに開始済みの要求・完了コールバックは非表示への切替後にも到着しうる。SDKの通常の自動更新を閉じた際の不要な再生成と混同しない。

検証コマンド：

```text
node --test src/ads/AppBannerAd.test.cjs src/ads/adInitializationRecovery.test.cjs src/ads/adAgePolicy.test.cjs scripts/androidCapture/captureEnvironment.test.cjs scripts/patchAdMobAgeTreatment.test.cjs
node scripts/patchAdMobAgeTreatment.cjs --check
node node_modules/expo/bin/cli export --platform android --platform ios --max-workers 2 --output-dir dist/ad-age-treatment/fabric-export
git diff --check
```

関連テスト95件すべて成功。旧display:noneの問題を検出するモデルのテストも成功し、導入済みAndroid年齢補正も適用済み。Android/iOS両方のHermesバンドル生成とgit diff --checkも成功。モデルはUIKit・Fabric・広告SDKの実行ではなく、実際の要求数やビュー寿命の証明にはならない。Windows上ではiOSのネイティブコンパイル・実機検証を行っていない。

リリース前の実機確認（新アーキテクチャ、テスト広告を使用）：

1. iOSで広告の読み込み完了後、Xcodeのビュー階層・デバッガで広告本体を特定する。`prepareForRecycle`・`initBanner:`・`requestAd`にブレークポイントまたは一時ログを設け、通常のキーボード開閉で広告本体が同一か、追加の生成・要求がないかを確認する。ログにユーザー情報・広告IDを残さない。
2. キーボード表示中、広告と下端の余白が見えず、タップできず、VoiceOverのスワイプ／タッチ探索にも出ないことを確認する。広告本体の寸法は保たれ、外側の表示領域だけ高さ0になっているか確認する。
3. 自動更新設定のあるテスト環境で、更新間隔を複数回超える時間キーボードを表示し続ける。SDKログや通信記録等で、表示前に開始した要求と非表示中に開始した新規要求を分けて、非表示中の自動更新が止まることを確認する。閉じた後の通常のSDK更新は許容するが、閉じる操作自体による再生成は認めない。
4. 失敗した広告の復旧待ち中に開閉し、既存30秒制限に従って必要な復旧が1回だけ行われることを確認する。非表示中のログアウト・チーム／年齢／同意条件変更では旧広告が破棄されることも確認する。
5. Androidでも表示・余白・タップ・TalkBackと広告本体の保持を確認する。非表示中の自動更新が続く場合は公開前にネイティブ側の可視性制御を再検討する。未確認の状態で更新停止を保証しない。

今回だけを戻す際は`dist/ad-age-treatment/fabric-before`の控えと比較してこの3ファイルの差分だけ戻す。ただしdisplay:noneを復活させると元の問題も戻る。データ変更はなくFirebase復元は不要。commit・push・PR・配布・管理シートへの追記は行っていない。

## リリース前に必要な作業

1. 修正したプライバシーポリシーを新版アプリより先に、または同時に公開する。公開日が変わる場合はポリシー版・HTMLの日付を揃える。既存利用者の同意記録を新しい日付で上書きしない。
2. Play Consoleの13歳未満を含めない設定、AdMobのFamilies/コンテンツ設定、App Storeの対象者・広告関連申告を照合する。ストアの対象ユーザー設定とコンテンツレーティングは別物。
3. AdMobの「プライバシーとメッセージ」で対象地域のメッセージ設定を確認する。iOSのATT/データ使用申告、Google Playのデータセーフティ申告を新しい広告動作に合わせて確認する。
4. 新SDKを含むAndroid/iOSのネイティブ再ビルドと実機確認。既存ビルドへJavaScriptだけのOTA配信をしない。
5. 保護者→部員、チーム切り替え、成人→未成年別アカウントへのログイン、ログアウト、同意不可・通信失敗、iOSの復帰、設定からの同意変更を確認する。開発時はテスト広告を使用する。
6. 公開後はOS・アプリ版・広告要求数・マッチ率・収益を比較する。今回のローカル検証は、実配信や収益改善を確認したものではない。

外部設定変更・公開・EAS本番ビルド・ストア提出・OTA・Firebase deployは実行していない。管理シートには採番と変更内容の要約を記録済み。今回のネイティブ追加修正について、管理シートへの追加書き込みは行っていない。

## 元に戻す方法

未commitの間は、今回の差分だけを個別に戻し、新規の年齢ポリシー・テスト・本書を取り除く。依存を16.3.4へ戻す場合は対応するlockfileも揃える。別の作業変更を含めて一括破棄しない。

公開後は直前のネイティブビルドへの切り戻しを基本とする。既存利用者の同意データや保護者ロールは書き換えていないため、データの復元処理は不要。ポリシーの公開文面は実際の提供版と整合させる。

Android補正だけを外して16.4.0を使い続けると元の不整合が復活するため、補正を取り消す場合は年齢別配信も無効化するか、互換性を確認した修正版SDKへ揃える。postinstallとExpo検査だけを外して未修正のまま公開しない。
