# 広告の年齢別取り扱い

最新の変更は末尾の「SB-20261111-002：ユーザー単位の年齢確認」を参照。以下のSB-20261109-001の記述は当時の仕様・検証記録であり、現在のチームによる成人判定と切替時の広告破棄は今回置き換える。2026/11/11に本件のFunctions 3件と、公開Rulesへの本人の年齢判定取得許可を反映済み。アプリ配布・サイト編集と公開・実機確認は未実施。

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

## 2026-11-09：AndroidビルドのKotlin互換性修正

ユーザーが提示した[EASビルド](https://expo.dev/accounts/inoue420/projects/SMARTBUKATSU/builds/d59c23f8-df44-45e9-b1fc-37a88ba05e30#run-gradlew)を読み取りで確認した。対象はcommit `d037ccda`、productionプロファイル、Android 1.1.11 / versionCode 28。JavaScriptバンドル生成後、`:react-native-google-mobile-ads:compileReleaseKotlin`で停止していた。

広告SDK 25.4.0のKotlinメタデータは2.3.0だが、Expo SDK 54 / React Native 0.81.5の既定コンパイラは2.1.20であり、ログに `binary version of its metadata is 2.3.0, expected version is 2.1.0` が出ていた。Google公式配布物を保存せずメモリ上で確認したところ、25.3.0のplay-services-adsにも2.3.0メタデータが含まれるため、広告SDKを一つ前へ戻すだけでは解消しない。

ユーザー承認後、`codex/fix-android-admob-kotlin`ブランチで次の変更を実施した。

| ファイル | 変更内容 |
| --- | --- |
| `app.config.js` | 既存expo-build-propertiesのAndroid設定へkotlinVersion 2.2.20を追加。導入済みExpoのKSP対応表にある2.2.20-2.0.3との組み合わせを使用 |
| `plugins/withAndroidR8Optimization.js` | settings.gradleのpluginManagement内、React Nativeのプラグイン解決前へR8 8.13.19のbuildscript依存を生成。再生成時に重複させず、CRLFを維持。Groovy以外・想定外のテンプレートはエラーで停止。既存のProGuard最適化指定は維持 |
| `scripts/androidBuildCompatibility.test.cjs` | R8依存の配置、再適用・古い生成ブロックの更新、CRLF、未知のテンプレート拒否、既存ProGuard設定の保持、AndroidだけのKotlin指定とKSP対応表、iOS設定を変更しないことを検証 |
| `docs/AD_AGE_TREATMENT.md` | 原因、変更範囲、検証結果、iOSへの影響、切り戻し方法を記録 |

Kotlin 2.3.0を直接指定すると導入済みExpoのKSP対応表に存在しないため、2.2.20を選択した。[Kotlinのバイナリ互換性方針](https://kotlinlang.org/docs/kotlin-evolution-principles.html#evolving-the-binary-format)では次の言語リリースとの前方互換性を目指すが、保証はされていない。このプロジェクトと広告SDKの最終的な互換性は、実際のネイティブビルドで確認する必要がある。Kotlin 2.3形式に必要なR8の版は[Googleの対応表](https://developer.android.com/build/kotlin-support)、settings.gradleでの上書き方法は[R8公式手順](https://r8.googlesource.com/r8/+/refs/heads/main/README.md#Replacing-R8-in-Android-Gradle-plugin)に従った。メタデータ検査を無効にするオプションは追加していない。

検証コマンド：

```text
git switch -c codex/fix-android-admob-kotlin
node --test scripts/androidBuildCompatibility.test.cjs
node scripts/patchAdMobAgeTreatment.cjs --check
node --test scripts/androidBuildCompatibility.test.cjs scripts/patchAdMobAgeTreatment.test.cjs src/ads/adAgePolicy.test.cjs src/ads/AppBannerAd.test.cjs src/ads/adInitializationRecovery.test.cjs scripts/androidCapture/captureEnvironment.test.cjs
# 以下のprebuildのみ dist/android-build-fix/prebuild を作業ディレクトリとして実行
node node_modules/expo/bin/cli prebuild --platform android --no-install --template ./node_modules/expo/template.tgz
git diff --check
```

prebuildは`SMARTBUKATSU_CAPTURE=1`、`APP_VARIANT=development`、`EXPO_NO_DOTENV=1`、`EXPO_OFFLINE=1`、`CI=1`で実行。検証フォルダには必要な設定・スクリプト・画像だけをコピーし、既存node_modulesをjunctionで参照した。環境ファイルはコピーせず、テスト用Firebase設定とGoogleのサンプル広告IDを使用。依存パッケージのインストールや更新は行わず、元のプロジェクトのandroidフォルダも生成していない。

結果：新規6件を含む関連101テストがすべて成功。既存Android年齢補正の適用検査も成功。隔離prebuildで`android.kotlinVersion=2.2.20`、R8 8.13.19の依存1件、既存の難読化・リソース縮小とProGuardルールが生成されることを確認した。iOSのネイティブディレクトリは生成していない。

検証時の途中失敗も記録する。最初に渡したWindowsドライブ形式のテンプレートパスをExpo CLIがGitHub URLとして扱ったため、ローカル相対パスへ修正。junction作成と画像キャッシュ生成はサンドボックスのアクセス拒否・EPERMで停止し、同じ検証を制限外で再実行して成功した。これらは検証環境による失敗であり、EASログのKotlinエラーとは別である。

この検証はGradleによるネイティブコンパイル、KSP処理、R8実行、APK/AAB生成、実機の広告配信を実行していない。AndroidのEASネイティブ再ビルドと、テスト広告での年齢別設定・表示・キーボード開閉の確認が必要。今回の承認範囲にEAS再ビルドは含まれない。

今回の差分はAndroid専用であり、この修正のためのiOS再ビルドは不要。ただし先行する16.4.0への広告SDK更新がiOSビルドへ未反映の場合、その更新を反映するためのiOSネイティブビルドは必要。OTAだけでネイティブSDKを更新することはできない。

`app.json`、`eas.json`、package.json/lockfile、Expo/React Nativeの版、アプリバージョン・識別子、Firebaseの認証・Rules・Functions・データ、広告の年齢ポリシーとAndroid比較文字列補正は変更していない。LPの機能・料金説明に影響する変更もない。commit・push・PR・管理シート更新・EASビルド・配布は未実施。

戻す場合は`app.config.js`のKotlin指定と、R8プラグインへ追加したsettings.gradle処理、新規テスト、本節だけを取り消す。既存のProGuard最適化・年齢補正や他の変更を一括で破棄しない。生成済みAndroidプロジェクトがある場合は承認のうえ修正前設定から再生成する。Firebaseデータの復元は不要で、元のKotlinビルドエラーは再発する。

管理シート追記案（未書き込み）：2026-11-09、AndroidビルドのKotlin不整合を修正。Kotlin 2.2.20 / R8 8.13.19を指定、関連101テストと隔離prebuild成功。ネイティブ再ビルド・実機確認待ち。iOS/Firebase変更なし。ブランチ`codex/fix-android-admob-kotlin`、commit・PR未作成。対象行や書き込み先の列は未指定のため、確認・承認後に記録する。

### 同日の再ビルド失敗：コンパイラの依存指定を追加

前項の変更はユーザー側でPR #99としてマージされた。その後の[EASビルド](https://expo.dev/accounts/inoue420/projects/SMARTBUKATSU/builds/e4a207a6-1170-4da4-bd2a-f6c05b196eef#run-gradlew)はcommit `911555f3`、Android 1.1.11 / versionCode 28で再び同じKotlinエラーになった。

ログのExpoRootProjectにはKotlin 2.2.20 / KSP 2.2.20-2.0.3が表示されるが、コンパイル失敗時のexpected metadataは2.1.0のままだった。前回のテストは生成設定を検査しており、実際のコンパイラ版を確認できていなかった。

SDK 54の生成ルートbuild.gradleには`classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')`という版指定のない依存がある。React NativeのGradleプラグインはKotlin Gradleプラグイン2.1.20をimplementation依存として提供する。このため、gradle.propertiesの値だけを変更しても実際のコンパイラは切り替わらない。別SDKでの[同じ仕組みの報告](https://github.com/expo/expo/issues/49668)も確認したが、このプロジェクトについてはローカル生成物・導入済みReact Nativeソース・今回のEASログを根拠とする。

追加承認後、`codex/fix-android-kotlin-classpath`ブランチで次の3ファイルだけを変更した。

- `plugins/withAndroidR8Optimization.js`：withProjectBuildGradleでルートの依存を`org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.20`へ固定。対象宣言が1件でない場合やGroovy以外は停止。既存R8指定・ProGuard処理は維持。
- `scripts/androidBuildCompatibility.test.cjs`：版なし・2.1.20・2.2.20の入力、両引用符、LF/CRLF、繰り返し生成、対象欠落・重複・非対応言語の拒否を追加検証。
- `docs/AD_AGE_TREATMENT.md`：再失敗の原因、検証不足と追加修正、Gradle実解決確認を記録。

関連103テストはすべて成功。既存Android年齢補正の検査と隔離Android prebuildも成功し、ルートbuild.gradleの明示的な2.2.20指定と既存R8 8.13.19指定を確認した。prebuildの環境・隔離場所は前項と同じで、元のプロジェクトにはandroidディレクトリを生成せず、パッケージの追加・更新も行っていない。

さらに、公式Gradle 8.14.3と検証用Maven依存を`dist/android-build-fix/classpath-check/gradle-cache`へ取得した。既存Java 21の実行環境を読み取りで利用し、修正前・修正後の生成ルートGradleからKotlinのclasspath宣言を抽出した最小プロジェクトで比較した。React Nativeが供給する2.1.20依存を明示的に再現し、Gradleが実解決するKotlin GradleプラグインとkotlinCompilerClasspathのkotlin-compiler-embeddableを検査する。検証用プロジェクトは初回に通常依存用repositoriesを記載し忘れて失敗したため、検証フォルダ内だけにmavenCentralを補って再実行した。アプリ側の設定変更ではない。

| 最小プロジェクト | 実解決したKotlin Gradleプラグイン | 実解決したコンパイラ | 結果 |
| --- | --- | --- | --- |
| 修正前の版なしclasspath | 2.1.20 | 2.1.20 | 旧版が選ばれることを再現、確認タスク成功 |
| 修正後の明示的classpath | 2.2.20 | 2.2.20 | 新版への切り替えを確認、確認タスク成功 |

追加検証コマンド：

```text
git switch -c codex/fix-android-kotlin-classpath
node --test scripts/androidBuildCompatibility.test.cjs scripts/patchAdMobAgeTreatment.test.cjs src/ads/adAgePolicy.test.cjs src/ads/AppBannerAd.test.cjs src/ads/adInitializationRecovery.test.cjs scripts/androidCapture/captureEnvironment.test.cjs
node scripts/patchAdMobAgeTreatment.cjs --check
node --check plugins/withAndroidR8Optimization.js
# コピーしたプラグインを使い、前項の隔離フォルダでAndroid prebuildを再実行
node node_modules/expo/bin/cli prebuild --platform android --no-install --template ./node_modules/expo/template.tgz
node dist/android-build-fix/classpath-check/prepare.cjs
# JAVA_HOMEは既存Java 21、GRADLE_USER_HOMEは上記dist内のgradle-cache
dist/android-build-fix/prebuild/android/gradlew.bat --project-dir dist/android-build-fix/classpath-check/baseline --no-daemon --console plain verifyCompiler
dist/android-build-fix/prebuild/android/gradlew.bat --project-dir dist/android-build-fix/classpath-check/patched --no-daemon --console plain verifyCompiler
git diff --check
```

この検証は依存解決の比較であり、実アプリ全体のKotlin/KSP/Composeコンパイル、R8実行、APK/AAB生成の成功を保証するものではない。EASのAndroid再ビルドと実機の広告表示・年齢別設定確認は引き続き必要。

今回もiOS・Firebase・広告ポリシー・先行のAndroid年齢補正、app.config.js、app.json、eas.json、package.json/lockfileは変更していない。この追加修正のためにiOSを再ビルドする必要はない。commit・push・PR作成・EASビルド・管理シート更新は未実施。元に戻す場合は今回の3ファイルの差分だけを戻す。ただしコンパイラ不整合が再発する。データ復元は不要。

管理シート追記案（未書き込み）：Android再ビルドで設定値と実コンパイラの不一致を確認。ルートKotlin Gradleプラグインの版を2.2.20へ固定。関連103テスト・隔離prebuild成功。最小Gradleプロジェクトで修正前2.1.20、修正後2.2.20のプラグイン・実コンパイラ選択を確認。EASネイティブ再ビルド・実機確認待ち。iOS/Firebase変更なし。ブランチ`codex/fix-android-kotlin-classpath`、commit・PR未作成。

## SB-20261111-002：ユーザー単位の年齢確認

対応日：2026-11-11。ブランチ：`codex/user-ad-age-profile`。管理シート「改訂履歴」120行目の登録仕様に基づくローカル実装・検証。Firebase反映、実機確認、アプリ配布、サイト編集・公開は未実施。

### 今回の仕様と変更

- 成人確認は現在のチームではなく、`users/{uid}/adAge/profile` に保存する。いずれかの実在チームで実際の保護者所属をサーバーで確認できたユーザーに、成人確認・根拠・確認日時を記録する。その後のチーム切替・役職変更・退会だけでは成人確認を取り消さない。チーム代表・監督・owner・adminを成人判定の根拠にしない。
- 成人未確認の場合は、既存の `legalConsent.minimumAgeConfirmed === true` と整数の `minimumAge >= 13` からTEEN・T上限・非パーソナライズを選ぶ。それ以外は未確認として子ども向け保護・G上限・非パーソナライズを維持する。既存の年齢同意は書き換えず、新しい年齢入力や生年月日の収集も追加しない。
- 成人もT上限。広告への同意・端末設定を引き続き適用し、インタースティシャルの非パーソナライズも維持する。
- 初回広告は、ログインごとのサーバー確認と、その後のサーバー由来の判定スナップショットを待つ。端末キャッシュや未確定の書込みだけでは広告要求を開始しない。アプリ側は年齢区分の判定を現在の所属プロフィールから行わない。
- ユーザー・年齢区分・広告同意が同じなら広告セッションを維持する。同じチームの再選択や別チームでの保護者プロフィール取得を理由にバナーを作り直さない。
- 全画面広告の表示可否はチーム切替状態を別途確認する。チームの世代番号を持ち、切替前に予約された表示機会は、元のチームへ戻っても復活させない。既存の日次回数・利用時間・表示契機は維持する。
- ログアウト、別アカウント、実際の年齢区分変更、同意変更、広告要求不可では旧広告・非同期処理を無効化する。停止済みの年齢情報購読の遅延通知も無視する。
- 年齢情報の取得失敗後は前面復帰・通信復帰を契機に、最低60秒間隔で再試行する。常時ポーリングは追加しない。iOSで休止中の通信変化を取り逃した場合は前面復帰時に通信状態を再確認する。Web・撮影モードでは新しい取得・復帰処理を開始しない。

### ファイルごとの内容

| ファイル | 内容 |
| --- | --- |
| `functions/adAgeProfileBackend.js`（新規） | 初回確認、保護者所属検証、年齢情報保存、役職・利用者情報変更の処理。トランザクションで競合を防止。アカウント文書の作成時刻で同じUIDの旧記録を区別 |
| `functions/index.js` | `ensureAdAgeProfile`、`updateAdAgeMembership`、`updateAdAgeUser`を登録。すべてasia-northeast1・最大2インスタンス |
| `firestore.rules` | 年齢情報は本人が既知のprofile文書だけ取得可能。クライアントの作成・更新・削除・一覧取得と他ユーザーの取得を拒否。既存ルールは維持 |
| `src/services/adAgeProfileService.js`（新規） | 初回サーバー確認、専用文書の購読、キャッシュ・古い通知の除外、通信復帰、購読解除 |
| `src/AuthContext.js` | 年齢情報サービスの結果を広告へ提供。チーム選択で購読し直さず、アカウント変更時に破棄。チーム内の権限判定・登録手順は維持 |
| `src/ads/adAgePolicy.js` | 現在の保護者ロールによる成人判定を、ユーザー単位の成人確認に置換 |
| `src/ads/AdManager.native.js` | 広告セッションからチームID・切替状態を分離。バナーを保持し、全画面広告の切替中表示・古い表示予約を抑止 |
| `functions/adAgeProfileBackend.test.js`（新規） | 根拠検証・永続化・役職変更・アカウント再作成・入力検証・不要な再走査の抑止 |
| `src/services/adAgeProfileService.test.cjs`（新規） | 初回確認待ち、キャッシュ、通信復帰、旧アカウント・停止済み購読、Web・撮影モード |
| `src/ads/adAgeProfile.rules.test.cjs`（新規） | 実Firestoreエミュレーターで権限・同時初期化・保護者への変更・成人確認日時の保持・ユーザー削除を検証 |
| `src/ads/adAgePolicy.test.cjs` | Android/iOSの年齢区分、チーム切替での初期化回数・key・要求条件の保持、古い全画面広告予約の取消 |
| `src/services/emailVerification.test.cjs` | 新しいサービスの境界と、アカウント分離・年齢情報の購読保持を検証 |
| `src/services/teamSwitching.test.cjs` | AuthContextの新しいサービス依存をテスト用に置換。既存の切替仕様・テストの期待値は変更しない |
| `docs/AD_AGE_TREATMENT.md` | 本作業の仕様、変更・検証記録、公開文案、管理シート追記案 |

`App.js`、`AppBannerAd.native.js`、広告SDK・Android補正、package/lockfile、Expo/EAS設定、アプリ版・識別子・権限、`src/legal.js` は変更していない。

### Firebaseへの影響と反映順序

保存先は本人のみ取得できる専用のサブコレクションであり、クライアントが編集できる公開ユーザープロフィールへ成人フラグを書いても判定には使用しない。親ユーザー文書の通常編集・取得ルールは変更しない。既存アカウントに新しいメール確認要件は追加せず、アプリの既存のメール確認画面の制御を維持する。

初回確認はユーザー・判定文書を読み、未成人確認者に限り記録済みの所属チームとメンバーを検証する。通常ユーザーは最大5チーム、既存の拡張上限は100チームを想定し、100を超える有効なチームIDは確認失敗として扱う。判定文書の購読が1本増える。成人確認済みではチームの再走査を省き、結果が変わらなければ保存しない。同じ所属集合内でのチーム切替やIDの並び替えではユーザートリガーも再走査しない。

新規FunctionsとRulesを先に反映し、動作確認後にアプリを配布する必要がある。未反映の環境で新アプリを起動すると、年齢情報を確認できず広告を取得しない。本作業ではFirebaseの本番接続・deploy・既存データ移行を行っていない。実際のトリガー配信と実機広告SDKの挙動はローカル検証だけでは保証できない。

### 検証と既知の問題

- 新しい年齢情報・既存広告・認証の対象テストは成功。Android/iOSそれぞれで成人・TEEN・未確認のチーム再選択／切替による再初期化がないことと、初回保護者情報の遅延で広告区分が揺れないことを検証した。
- 関連20テストファイルの広範囲検証：375件中373件成功、2件失敗。今回追加したサービス依存の置換漏れで一度失敗したチーム切替6件は、テスト境界を補って解消。
- 残る2件は既存のテスト境界の不整合：`scripts/androidCapture/captureEnvironment.test.cjs` のcapture AdProviderテストが既存の `./interstitialPolicy` 依存を置換していないことと、`src/services/loadingOptimization.test.cjs` の起動テストが既存の `mergeMemberIdentity` を置換していないこと。今回と無関係の期待値・実装は変更せず、失敗を残して報告する。
- 切り分けのため、`git show HEAD:SMARTBUKATSU/...` で取得した変更前のAdManager・App.js・上記2テストのソースをメモリ上だけで実行した。基点でも46件中44件成功・同じ2件失敗を再現。チェックアウトや実ファイルの差し替えは行っていない。
- 実Firestoreエミュレーターの新規権限・競合テスト5件と既存の登録・参加検証11件は、合計16件すべて成功。拒否を期待する検証のPERMISSION_DENIED出力は正常。
- `functions/index.js` と新規バックエンドの構文確認、導入済みAndroid年齢指定補正の検査は成功。
- 全画面広告の1時間有効期限切れで広告全体が再初期化される既存経路と、iOS復帰時の既存のバナー再読込方針は、本件のユーザー単位化では変更していない。
- Android/iOSのネイティブビルド、実機での広告配信、通信断からの復旧、バックエンドトリガーの本番配信、AdMobのマッチ率・表示率は未確認。今回のテストからマッチ率改善は断定しない。

実行コマンド（依存追加や外部サービス反映なし）：

```text
git switch -c codex/user-ad-age-profile
node --test --test-reporter=tap functions/adAgeProfileBackend.test.js functions/interstitialSettingsBackend.test.js src/services/adAgeProfileService.test.cjs src/services/emailVerification.test.cjs src/ads/adAgePolicy.test.cjs src/ads/AppBannerAd.test.cjs src/ads/adInitializationRecovery.test.cjs src/ads/interstitialPolicy.test.cjs src/ads/interstitialSettingsService.test.cjs src/ads/navigationTransitionGate.test.cjs src/components/InterstitialSettingsPanel.test.cjs src/services/teamSwitching.test.cjs src/services/loadingOptimization.test.cjs src/services/workspaceStartup.test.cjs src/services/appReview.test.cjs src/services/videoViewingService.test.cjs src/services/dailyReportComments.test.cjs src/services/calendarWeekStart.test.cjs scripts/androidCapture/captureEnvironment.test.cjs scripts/patchAdMobAgeTreatment.test.cjs
node scripts/runLoadingOptimizationTests.cjs C:/projects/IEPpurchase/tmp/iep-p1-010-java/jdk-21.0.12.1+1-jre/bin/java.exe src/ads/adAgeProfile.rules.test.cjs
node scripts/runLoadingOptimizationTests.cjs C:/projects/IEPpurchase/tmp/iep-p1-010-java/jdk-21.0.12.1+1-jre/bin/java.exe src/services/emailVerification.rules.test.cjs
node --check functions/index.js
node --check functions/adAgeProfileBackend.js
node scripts/patchAdMobAgeTreatment.cjs --check
git diff --check
```

### 手動確認と戻し方

反映承認後、テスト広告を使って、他チームに保護者所属があるユーザーの初回起動、同じチームの再選択、別チームへの切替・役職変更、未成年者向け／未確認、別アカウント、同意変更、オフライン起動と復帰、通常のキーボード開閉、切替中の全画面広告抑止を両OSで確認する。専用保存文書が1ユーザーにつき1件となり、成人確認日時が通常の切替で更新されないことも確認する。

ローカルで戻す場合は本件の変更ファイルの差分だけを戻し、新規5ファイルを個別に除く。他の作業を含むreset/cleanは使わない。本番反映していないためデータ復旧は不要。将来サーバーを反映した後にアプリだけを戻す場合、追加文書を一括削除せず、既存クライアントとの互換性と保存済み確認記録を維持する。

### 公式プライバシーポリシー修正文案（未編集・未公開）

対象：別リポジトリ `company-website/smartbukatsu/privacy.html` の「5. 広告」の説明と3区分。既存のヘッダー・フッター・CSSを維持して、次の文面へ置換する案。サイトの編集・版番号・公開は別途承認を得る。

```html
<p>本サービスはGoogle AdMobおよびGoogle User Messaging Platformを利用する場合があります。広告の配信条件は、利用者ごとに保存する年齢確認の記録、広告への同意状況および端末の設定に応じて扱います。所属チームでの保護者登録をサーバーで確認した場合は、その確認結果・根拠・確認日時を利用者の情報として記録し、チームの切り替えや役割の変更だけでは成人確認を取り消しません。</p>
<ul>
  <li><strong>成人確認がなく、13歳以上の確認も済んでいない場合：</strong>子ども向けの保護設定を適用し、広告内容をG相当に制限して、非パーソナライズ広告を要求します。アカウント情報や年齢に関する配信条件を確認できない場合は、広告の取得・表示を見合わせます。</li>
  <li><strong>13歳以上の確認が済み、成人確認がない場合：</strong>未成年者向けの保護設定を適用します。広告内容はTを上限とする範囲（G・PG・T）とし、非パーソナライズ広告を要求します。</li>
  <li><strong>保護者として成人確認が済んでいる場合：</strong>保護者の役割は成人にのみ付与する運用とし、成人向けの配信設定を適用します。広告内容はTを上限とする範囲（G・PG・T）とし、バナー広告は同意状況と端末の設定で許可される範囲でパーソナライズされる場合があります。チーム代表・監督等の役割だけでは成人と判定しません。</li>
</ul>
```

既存の「インタースティシャルは非パーソナライズ」「Googleのポリシーも適用」等の後続段落は維持する。生年月日を収集しない方針と対象年齢の説明も維持する。

### 管理シート追記案（未書き込み）

対象は `SB-20261111-002` の同じ行。B「実施日」へ2026/11/11、K「ステータス」へレビュー中、F「改定内容」の先頭を「ローカル実装・自動検証済み／Firebase未反映・未配布」にする案。既存の登録仕様は維持する。実機確認が残るため、実装完了日・公開日・対象バージョン・PRは未確定のままとする。

変更ファイル、コマンド、テストの詳細、ブランチ・戻し方は本作業記録に保持する。管理シートには専用列がないため備考へ勝手に統合しない。追加の管理シート更新、commit・push・PR、Firebase/EAS操作は未実施。

### 追加レビュー対応：取得中の通信復旧通知の取りこぼし

同じ管理番号・作業ブランチの通信復帰処理を修正。ユーザーの指摘どおり、初回の年齢情報取得が進行中に通信が復旧すると、`inFlight` による早期returnで復旧通知が失われていた。Android/iOS双方の模擬環境で、復旧後に元の取得が失敗し、さらに120秒進めても要求1回・タイマー0件・年齢情報nullのままとなることを修正前に再現した。

変更は `src/services/adAgeProfileService.js`、同サービスのテスト、本記録の3ファイルに限定する。

- 通信復帰・前面復帰を `recoveryPending` として保持し、複数の通知は1件にまとめる。取得中・バックグラウンド・オフラインの間も復旧意図を保持する。
- 元の取得が失敗して終了したら、保持した復旧要求を再評価する。前回の取得開始から60秒未満なら残り時間だけ待ち、60秒以上経過していれば直ちに1回だけ再試行する。進行中の要求とは重ねない。
- 初回のFirestore購読待ちにも同じ仕組みを適用する。購読が動いている間はSDKの自動再接続に任せて追加の初回確認を発行せず、その購読が失敗した場合に保持済みの復旧要求を使う。
- サーバー由来の正常な年齢情報を取得したら、復旧予約・タイマーを解除する。再試行を開始した時点でも復旧要求を消費し、その再試行が失敗しても新しい外部通知がなければ繰り返さない。
- 前面復帰時は、取得中でも未解決なら通信状態を確認する。休止中に通信変化を取り逃した場合の古いオフライン状態で復旧を止めない。
- ログアウト・同一UIDでの再ログイン・別アカウント・購読解除後には、保留していた要求を実行しない。バックグラウンド・再オフライン時は実行を保留し、次の安全な復帰で処理する。

検証：サービスの既存8件にAndroid/iOS各8件の回帰テストを追加し、24件すべて成功。通知の連続、10秒での失敗→残り50秒待機、70秒での失敗→直ちに再試行、成功時の二重取得防止、再試行の再失敗、初回スナップショットの失敗、前面復帰・オフライン・アカウント変更・購読解除を確認した。広告・認証・チーム切替を含む下記175件もすべて成功・失敗0・スキップ0。

```text
node --test --test-reporter=spec src/services/adAgeProfileService.test.cjs
node --test --test-reporter=tap src/services/adAgeProfileService.test.cjs src/services/emailVerification.test.cjs src/services/teamSwitching.test.cjs src/ads/adAgePolicy.test.cjs src/ads/AppBannerAd.test.cjs src/ads/adInitializationRecovery.test.cjs
git diff --check
```

Android/iOS共通のクライアント処理だけの変更で、Functions・Firestore Rules・保存形式・年齢区分・SDK設定・パッケージ・Web/撮影モードの無接続方針は追加変更していない。本番反映・実機確認・commit・push・PR・管理シートの追加更新は未実施。前節の広範囲検証に残った既存2件のテスト不整合には、この追加修正では手を加えていない。

この追加修正だけを戻す場合は、サービスの復旧要求保持とそれに対応する16テスト・本節だけを取り消す。SB-20261111-002で追加した年齢情報サービス自体や、前回までのユーザー単位の判定・保存処理は削除しない。

### Functions反映結果（2026/11/11）

ユーザーの「functionも変更して」を受け、本件の3関数を `smart-bukatsu` / `asia-northeast1` に新規作成した。Firebase Rules・アプリ配布・公開サイトの変更は、この反映には含めない。

| 関数 | 状態 | ランタイム | 最大インスタンス | 最新リビジョンのトラフィック | 確認したトリガー |
| --- | --- | --- | --- | --- | --- |
| `ensureAdAgeProfile` | ACTIVE | Node.js 22・第2世代 | 2 | 100% | Callable（イベントトリガーなし） |
| `updateAdAgeMembership` | ACTIVE | Node.js 22・第2世代 | 2 | 100% | `teams/{teamId}/members/{uid}` のwritten、失敗時再試行有効 |
| `updateAdAgeUser` | ACTIVE | Node.js 22・第2世代 | 2 | 100% | `users/{uid}` のwritten、失敗時再試行有効 |

- 反映前は既存62関数・対象3件は未作成。反映後は65関数で、既存62関数の状態・更新時刻・ソース・リビジョン・実行設定・トリガー条件は不変。イベントフィルターの順序だけの差を正規化して比較した。
- 全3関数で最新の作成リビジョンと準備済みリビジョンが一致し、Cloud Runの準備完了を確認した。
- 反映済みソースのindex.js・adAgeProfileBackend.js・package.json・package-lock.jsonを配布用ソースと照合し、一致を確認。バックエンド本体はローカル実装とも一致。配布用index.jsは既存関数を混ぜない最小の起動処理と、ローカルindex.jsから抽出した対象3関数の登録のみ。
- `ensureAdAgeProfile` の未認証HTTP呼出しは401 / UNAUTHENTICATED。本番ユーザーとしての呼出しや、検証用の本番文書作成・更新・削除は行っていない。認証済みの一連の処理とイベントトリガーの本番実行は、今後の実機確認が必要。
- 反映開始から2026/11/11 20:52（日本時間）の確認時点まで、対象3関数の対象リビジョンにERRORログ0件。ログの本文やユーザーデータは取得せず、時刻・重要度による件数だけ確認した。
- 公開RulesのRuleset・更新時刻は反映前後で一致。既存のRuleset `bd82930d-7afe-4482-b7bd-3b53496ac28a` を維持。本件の `users/{uid}/adAge/profile` の本人取得許可はまだ未反映のため、新アプリの広告取得を有効にするにはRules反映が必要。
- Functionsの作成だけでは過去の所属情報を一括走査しない。今後の対象文書変更や、アプリからの初回確認で、必要に応じてユーザー単位の判定文書が作成される。既存のチーム・ユーザー・認証・Storageデータの一括変更や移行は行っていない。
- 通信復旧通知の保持はアプリ側JSの修正であり、今回のFunctions反映だけでは配布済みアプリへ届かない。Rules反映と、修正を含むアプリ配布・両OSの実機確認が残る。

反映前にバックエンドのテスト11件と構文確認が成功。配布準備の補助スクリプトで名前衝突と依存フォルダ参照の権限エラーを修正した後、限定ソースを準備した。初回のdeployは、失敗時再試行を有効にするCLIの確認で関数作成前に停止した。同じ3関数に限定し、設定済みの再試行を承認する `--force` を付けて再実行し成功した。SDK更新推奨の警告はあったが、依存を更新せず既存版で反映した。

反映・検証用ファイル：`dist/sb-20261111-002-firebase/`。`before.json`、`after.json`、`verification.json`、`authentication.json`、`sources.json`、`logs.json`、最小配布ソースを保存した。認証トークンや本番ユーザーデータは検証記録に含めない。

```text
node --test --test-reporter=tap functions/adAgeProfileBackend.test.js
node --check functions/index.js
node --check functions/adAgeProfileBackend.js
node dist/sb-20261111-002-firebase/prepare.cjs
node dist/sb-20261111-002-firebase/ops.cjs snapshot before
node <キャッシュ済みfirebase-tools/lib/bin/firebase.js> deploy --project smart-bukatsu --config dist/sb-20261111-002-firebase/deploy/firebase.json --only functions:ensureAdAgeProfile,functions:updateAdAgeMembership,functions:updateAdAgeUser --non-interactive --force
node dist/sb-20261111-002-firebase/ops.cjs snapshot after
node dist/sb-20261111-002-firebase/ops.cjs smoke
node dist/sb-20261111-002-firebase/ops.cjs sources
node dist/sb-20261111-002-firebase/ops.cjs logs
```

サーバー側を戻す必要がある場合は、新規3関数のみを対象に最新の状態と利用状況を確認し、削除等は別途承認後に行う。既存62関数と公開Rulesは戻さない。新アプリは3関数を必要とするため、アプリ側との整合を確認してから操作する。生成された成人確認記録を一括削除しない。

管理シートの追加更新、commit・push・PR、EASビルド・配布、公開サイト編集は未実施。

### 公開Rulesへの限定追加と既存アプリの影響確認（2026/11/11）

ユーザーの「運用中アプリに影響がなければ変更」という承認条件に従い、公開中Rulesを取得してそのまま保全し、本人の年齢判定文書を個別取得する条件だけを追加した。ローカルRules全体は配布していない。公開中には別件の登録・認証等の差分があるため、それらを持ち込まない。

追加した唯一のブロックは、既存の `match /users/{userId}` の内側：

```text
// Only the server verifies and stores advertising age information.
match /adAge/{profileId} {
  allow get: if signedIn() && userId == uid() && profileId == 'profile';
  allow list, write: if false;
}
```

新たに許可するのはログイン中の本人による `users/{uid}/adAge/profile` のgetのみ。他ユーザー・未認証・別の文書名・一覧取得・クライアント書込みは許可しない。既存のユーザープロフィールやチーム・投稿等の条件は追加変更していない。既存アプリは新しいパスを利用しないため、既存の読み書き条件を変えずに導入できる。

#### 反映前の検証

- 反映前の公開Rulesと配布候補を、それぞれ専用のローカルFirestoreエミュレーターへ適用して比較した。本番のユーザー・チームデータは使っていない。
- 既存操作37項目で許可・拒否が一致（許可24・拒否13）。プロフィールの取得・名前変更、他人の編集拒否、チーム選択、名簿、連絡、カレンダー、日誌、動画、通知、既存広告設定、バージョン取得、招待コード等を確認した。公開中の既存の未確認メール利用者の扱いも維持する。
- 本件の新しい取得許可、年齢情報の書込み・削除・他人による取得の拒否、実バックエンドの初期化・競合・成人確認維持、既存の広告共通設定の権限検証まで含め、45件すべて成功・失敗0・スキップ0。
- 初回の互換性テストでは、同じ招待文書を使い回して後半が「作成」ではなく「更新」になったため、テスト準備の不備による失敗があった。各フェーズの初期状態を揃えて解消し、Rules候補を変更せずに45件成功を確認した。削除・初期化はローカルのdemoエミュレーター内だけで実施した。
- 公開直前にRulesetと内容ハッシュを再確認し、検証中に公開Rulesが変更されていないことを確認した。配布ファイルも、検証した候補の内容・ハッシュと一致した。

#### 反映後の確認

- 対象：`smart-bukatsu` のCloud Firestore Rules。Functions・Storage Rules・インデックス・アプリ版・本番データはこの操作では変更していない。
- CLIでコンパイル成功・配布成功。2026/11/11 21:03（日本時間）に公開Rulesを再取得し、配布候補と完全一致することを確認した。
- 追加ブロックがちょうど1件であり、そのブロックだけを除くと反映前の公開Rulesと文字列として完全一致することを確認した。既存の許可・拒否条件は維持されている。
- 反映前Ruleset：`bd82930d-7afe-4482-b7bd-3b53496ac28a`
- 反映後Ruleset：`1909dadb-93fc-4a5a-b18e-6f9b2ea3eced`
- 公開後の更新時刻：`2026-11-11T12:02:34.816261Z`

反映前後のRulesと検証結果は `dist/sb-20261111-002-firebase/` の `before-ad-age.rules`、`ad-age-public.rules`、`after-ad-age.rules`、`rules-before.json`、`rules-compatibility.json`、`rules-verification.json` に保存。配布用設定は `deploy/rules.firebase.json` で、Firestore Rules以外の配布設定を含めていない。

```text
node dist/sb-20261111-002-firebase/rules-ops.cjs prepare
node scripts/runLoadingOptimizationTests.cjs C:/projects/IEPpurchase/tmp/iep-p1-010-java/jdk-21.0.12.1+1-jre/bin/java.exe dist/sb-20261111-002-firebase/rules-validation.test.cjs
node dist/sb-20261111-002-firebase/rules-ops.cjs guard
node <キャッシュ済みfirebase-tools/lib/bin/firebase.js> deploy --project smart-bukatsu --config dist/sb-20261111-002-firebase/deploy/rules.firebase.json --only firestore:rules --non-interactive
node dist/sb-20261111-002-firebase/rules-ops.cjs verify
```

本件で必要なFunctionsと本人取得用Rulesは反映済み。ユーザー単位の広告判定と通信復旧の修正を利用するには、修正を含むアプリ配布とAndroid/iOSの実機確認が引き続き必要。運用中アプリの実機操作や、本番ユーザーデータを用いる動作確認はこの検証には含めていない。

戻す必要がある場合は、最新の公開Rulesを再取得したうえで本件の追加ブロックだけを取り除く。保存した旧Rules全体をそのまま再配布して、後続の別件変更を上書きしない。戻すための公開操作は別途承認後に実施する。新アプリの年齢情報取得にはこの許可が必要なため、戻す場合はアプリとの整合も確認する。

管理シートの追加更新、commit・push・PR、アプリ配布、サイト編集・公開は未実施。
