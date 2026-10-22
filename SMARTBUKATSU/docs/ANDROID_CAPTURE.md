# Android実機の撮影環境（SB-20261021-001）

Windows x64とUSB接続したAndroid実機1台を使う。実際に表示された画面をPNGで保存する。アプリ画面の再現図を作る仕組みではない。

## 第1段階の範囲

- Android Platform-Tools（adb）とscrcpyを専用フォルダへ展開する。
- 接続確認、PCへの画面表示、端末からのPNG保存を行う。
- アプリのインストール、Firebase接続、練習用アカウント作成、EASビルド、HP・PDFへの掲載は行わない。
- 次段階で練習専用アプリ・データ環境を整備する。それまでは実運用チームの画面を撮影しない。
- この環境はAndroid用。iOSの実画面・OS通知配信の検証は別途必要。

以下のコマンドは、アプリのpackage.jsonがあるフォルダで実行する。

```powershell
Set-Location 'C:\projects\smartbukatsu\SMARTBUKATSU\SMARTBUKATSU'
```

## 1. 初回セットアップ

PowerShell 7以上とNode.jsを使う。管理者での実行、Android Studio、エミュレーター、npmパッケージ追加は不要。PC全体のPATHは変更しない。

```powershell
pwsh -File scripts/setupAndroidCapture.ps1
node scripts/androidCapture.cjs help
```

PowerShell 7の`pwsh`がPATHにない場合は、Codexの依存ランタイムにある`pwsh.exe`で同じスクリプトを実行できる。実行ポリシーを緩める操作はスクリプトに含めない。

取得先：

- [Google Android Platform-Tools](https://developer.android.com/tools/releases/platform-tools)：公式のWindows版ZIP。配布URLは最新版を指すため、実際の版とZIPのSHA-256を導入記録へ保存する。記録したSHA-256は再現・破損確認用で、Google公表値との照合ではない。
- [scrcpy 5.0.1](https://github.com/Genymobile/scrcpy/releases/tag/v5.0.1)：公式Windows x64版ZIP。[当該タグの公式手順](https://github.com/Genymobile/scrcpy/blob/v5.0.1/doc/windows.md)にあるSHA-256と照合してから展開する。scrcpy本体はApache-2.0。SDKおよび同梱ライブラリのライセンスは配布物を参照する。

保存構成：

```text
.codex-temp/android-capture/
  tools.json                 # 実際の版・取得元・ハッシュ・相対パス
  downloads/<導入ID>/         # 取得したZIP
  installations/<導入ID>/    # adb・scrcpy本体と同梱ファイル
  captures/                  # 未加工・非公開の画像
```

このフォルダ全体をGit管理から除外する。再実行時は実行ファイルのSHA-256を確認し、既存導入を再利用する。スクリーンショットを上書き・削除する処理はない。導入途中に失敗した場合はエラーを確認する。成功した導入記録がなければ、再実行時は別の導入IDを使用する。

## 2. 端末で行う初回操作

1. データ通信対応のUSBケーブルでPCへ接続する。
2. 端末の開発者向けオプションで「USBデバッグ」を有効にする。端末設定の変更と許可操作は端末の所有者が行う。
3. 端末のロックを解除し、このPCへのUSBデバッグ許可を確認する。信頼できる自分のPCだけを許可する。
4. 私用通知や個人情報を表示せず、練習用画面を準備する。

メーカーによってUSBドライバーが必要な場合がある。スクリプトはドライバーを自動導入しない。adbは初回起動時にPC認証用の鍵を通常のユーザー設定領域へ生成する場合がある。鍵を表示・共有・Gitへ追加しない。

## 3. 接続確認

```powershell
node scripts/androidCapture.cjs devices
node scripts/androidCapture.cjs check
```

`devices`は端末の実シリアル番号を表示せず、ハッシュ由来のラベルと状態を表示する。`check`はツールの動作、USB接続、Androidの版、画面サイズを確認する。

- `unauthorized`：端末側でPC接続を許可する。
- `offline`：ロック解除とUSBの差し直しを試す。
- 接続端末なし：通信対応ケーブル、USBデバッグ、USBポート、必要なメーカー製ドライバーを確認する。
- 複数のUSB端末：撮影する1台だけを接続する。

Wi-Fi接続やエミュレーターを撮影対象に選ばない。Windowsのファイアウォール、仮想化設定、端末のセキュリティ設定はスクリプトで変更しない。

## 4. PCへ画面を表示

```powershell
# 表示のみ。端末の操作は手元で行う。
node scripts/androidCapture.cjs mirror

# PCのマウス・キーボードで操作する場合
node scripts/androidCapture.cjs mirror --control
```

「SMARTBUKATSU Capture」というウィンドウが開く。音声転送とクリップボード自動同期は無効。表示の長辺は最大1600pxに抑えるが、次項のPNG保存は端末から直接取得するため、このプレビュー縮小の影響を受けない。

scrcpyは端末へ一時的なサーバーを転送して動作する。アプリのインストールや画面のクラウド送信は行わない。scrcpy表示中のアプリ自体が行う通信・保存は通常どおりなので、保存・投稿などは承認された練習環境でのみ実行する。

ウィンドウを閉じると画面表示を終了する。Ctrl+Cで終了した場合は、ウィンドウも閉じていることを確認する。

## 5. PNGを保存

練習用データの撮影対象を開いてから実行する。

```powershell
node scripts/androidCapture.cjs capture 01-members-invite
node scripts/androidCapture.cjs capture 02-calendar-add
```

画像名は半角英数字・ハイフン・下線で80文字以内。日時とランダム文字列を付けて保存するため既存画像を上書きしない。端末全体の表示を取得するので、キーボード、ステータスバー、通知、招待コードなども写り得る。秘密情報を自動で隠す機能はない。

PNGは`adb exec-out screencap -p`のバイナリをNode.jsから直接保存し、PNG構造と寸法を確認する。PowerShellの文字列パイプやリダイレクトを通さず、端末側の画像ファイル作成・削除もしない。端末の画面解像度設定や回転状態はそのまま使用する。

公開する画像は、練習用の表示名・予定・動画を使用し、個人情報・メールアドレス・認証情報・招待コードを掲載しない。招待コードは練習用でも不透明な塗りつぶし等で除く。公開可否を確認した加工済み画像だけを、HP側の承認済み保存先へ反映する。未加工画像はGit・HPへ追加しない。

ガイド用の画像名の例：`01-members-*`、`01-permissions-*`、`02-calendar-*`、`03-communication-*`、`03-notifications-*`、`04-video-create-*`、`04-video-clip-*`、`05-video-watch-*`、`06-tactics-*`。

## 6. 終了・再開

1. scrcpyウィンドウを閉じる。
2. USBケーブルを外す。必要に応じて端末側でUSBデバッグをOFFにする。
3. 再開時は接続し、`check`から行う。撮影用アプリのログイン・データ準備は別手順。

adbサーバーは接続確認時に起動し、画面表示終了後も動作する場合がある。他の開発作業と共用され得るため、自動で全体を停止する処理は入れていない。

## 7. 第2段階：ローカルの練習専用環境

導入済みのSMARTBUKATSU Devを使う。新規APK作成・EASビルド・本番接続は行わない。通常版のログイン状態は読み込まず、撮影専用のFirebaseアプリ名と認証保存領域を使用する。

```powershell
pwsh -File scripts/startAndroidCapture.ps1 start
pwsh -File scripts/startAndroidCapture.ps1 status
pwsh -File scripts/startAndroidCapture.ps1 open
```

`start`はバックグラウンドで準備を開始する。`status`の`ready: true`を確認してから`open`を実行する。開発版ランチャーが表示された場合は、**localhost:8083**のサーバーを選ぶ。過去に開いた通常環境のサーバーは選ばない。

起動に使う既存依存：

- アプリのExpo SDK 54、React Native 0.81.5、Firebase JS SDK 12系と、`functions/node_modules`の既存パッケージ。
- npmキャッシュ内のfirebase-tools **15.34.0**。見つからない場合は停止し、自動インストールはしない。
- Java 21以上。確認済みの既存Javaを既定値として使用する。他のPCでは環境変数`CAPTURE_JAVA`で既存の`java.exe`を指定する。
- Codex依存ランタイムのPlaywrightと、インストール済みMicrosoft Edge。動画生成に使い、新しいブラウザーはダウンロードしない。ランタイムの場所が異なる場合は`CAPTURE_NODE_MODULES`を指定する。

すべてのサービスはPCの127.0.0.1にのみ待ち受け、USBポート転送で端末とつなぐ。

| 用途 | ポート |
| --- | --- |
| Auth | 9098 |
| Firestore | 8185 |
| Functions | 5003 |
| Storage | 9198 |
| 開発サーバー（Metro） | 8083 |
| 練習用動画・画像、状態確認 | 8766 |
| Firebase内部制御 | 4403 / 4503 / 9153 |

既存サービスがこれらのポートを使用している場合は撮影環境の起動を中止する。既存サービスを勝手に終了したり、既存のUSBポート転送を書き換えたりしない。JavaとNodeのメモリ上限は起動する子プロセスにだけ設定する。

### 練習アカウント

次は架空のローカル専用データで、外部のサービスへログインするための情報ではない。

| ログイン用メール（架空） | 役割 |
| --- | --- |
| admin@capture.invalid | 管理者 |
| staff@capture.invalid | スタッフ |
| captain@capture.invalid | キャプテン |
| member@capture.invalid | 一般部員A |
| member-b@capture.invalid | 一般部員B |
| guardian@capture.invalid | 保護者 |

練習専用パスワードは全アカウント共通の`PracticeOnly-2026!`。本番では使用しない。メール確認済みの合成アカウントを投入するので、実メールの送受信は不要。招待コードは毎起動時にローカルで生成し、ログには出さない。画面撮影時はコードを除く。

「操作練習用チーム」に予定・連絡・タグ付きの元動画・閲覧用プロジェクト・戦術ノート・行動タスクを投入する。練習動画は人物を使わないコートとボールのアニメーションで、PC内で生成したWebMを再生する。YouTubeや外部の動画へは依存しない。

### 接続と外部通信の制限

- `SMARTBUKATSU_CAPTURE=1`、`APP_VARIANT=development`、`EXPO_NO_DOTENV=1`の組み合わせでのみ起動する。`.env`は撮影モードでは読み込まない。
- 実行時も開発版のパッケージ名・開発モード・固定のdemo Firebase設定を検査する。設定の不足・混在、通常版、リリースモードでは停止し、通常接続へ戻さない。
- Auth・Firestore・Functions・Storageの全サービスを、固定ポートのローカルエミュレーターへ接続する。
- クライアントのプッシュトークン取得・登録・解除と、広告の同意取得・初期化を撮影時は行わない。
- 撮影用Functionsでは必要な処理だけを公開し、外部HTTP fetchを拒否する。元の本番Functionsコードとルールは変更しない。
- 通知センターや通知設定は撮影できるが、実際のプッシュ配信の検証にはならない。Maps検索など、撮影環境で提供していない外部連携は検証対象外。

### 検証と停止

```powershell
node --test scripts/androidCapture/captureEnvironment.test.cjs
node scripts/androidCapture/verify.cjs
pwsh -File scripts/startAndroidCapture.ps1 stop
```

`verify`はPC内の練習アカウントでAuth・Firestore・Functions・動画配信を検証する。`stop`は、この起動処理が作成したプロセス群とUSBポート転送だけを終了する。他のFirebase・Metro・adbサーバー全体は停止しない。

`stop`は終了処理の完了を待ってから成功を表示する。起動・終了の途中はロックファイルにより重複起動を拒否する。失敗時は`runtime/worker.log`を確認し、ロックファイルを推測で削除しない。

**練習データは一時データで、サービス停止時に消える。** 次回起動時は基本の練習データを再投入する。再起動後にログイン状態が使えない場合は、練習アカウントで入り直す。

起動ログは`.codex-temp/android-capture/runtime/`の`worker.log`、`firebase.log`、`metro.log`にある。制限環境でローカル接続やadbが失敗する場合は、許可された通常の実行環境で同じ専用スクリプトを使う。ログの原文や未加工画像をそのまま公開しない。

端末がスリープすると保存画像が黒くなることがある。撮影時は所有者がロックを解除し、画面が点灯していることを確認する。画面ロックを自動解除する処理や、端末の消灯時間・セキュリティ設定を変更する処理は含めない。

Windowsのこの撮影環境だけではiOSの表示差は確認できない。Androidの画像はAndroid撮影と明記し、iOS固有手順は別途実機で確認する。

## 戻す場合

先に`stop`で撮影用サービスを終了する。その後、撮影作業の差分だけを対象に戻す。第2段階の対象は`app.config.js`、`src/firebase.js`、`src/config/captureEnvironment.js`、通知・広告の撮影モード分岐、`scripts/androidCapture/`、`scripts/startAndroidCapture.ps1`と本手順書。第1段階は撮影スクリプト2本と`.gitignore`の追記。専用ツールフォルダは画像の必要性を確認してから別途削除する。端末側の許可は所有者が必要に応じて解除する。一括リセット、他の作業ファイルの削除、PC認証鍵の削除は行わない。

## 検証記録

2026-10-22（日本時間）、第1段階：

- 専用ブランチ：`codex/sb-20261021-001-guide-capture`。作業前の未commit変更なし。
- Platform-Tools 37.0.1 / adb 1.0.41とscrcpy 5.0.1を導入し、両方のバージョン問い合わせに成功。
- セットアップの再実行で、実行ファイルのハッシュ照合と既存導入の再利用に成功。再ダウンロードなし。
- `node --check scripts/androidCapture.cjs`、PowerShell構文解析に成功。
- 有効PNGの寸法取得、途中切れ・末尾への余分なデータ・非PNGの拒否、保存先の外へのパス拒否、端末状態の解析、表示用ラベルへのシリアル番号非掲載を確認。
- scrcpyのヘルプで使用する起動オプションの存在を確認。不正なCLI引数を端末アクセス前に拒否することを確認。
- 制限環境ではダウンロードがDNSエラー、adb接続一覧が実行エラーになった。権限付きで再実行し、ダウンロード・展開・起動・端末検出処理に成功。
- 初回の接続確認時点ではUSB端末なし。その後、所有者がUSB接続・許可を実施し、`check`でAndroid 17、物理解像度1080×2400pxの実機を確認。
- `mirror`でPCの表示ウィンドウを起動。所有者が端末画面の表示を確認した。Codexのウィンドウキャプチャでは黒く見える場合があり、直接取得したPNGとは区別して確認した。
- `capture 00-connection-test`でホーム画面のテストPNGを保存。1080×2400pxで、文字・アイコン・背景が正常に表示されることを目視確認。公開用画像ではなく、Git管理から除外した専用フォルダにのみ保存。
- 表示ウィンドウを閉じてプロセスが正常終了した後、`check`でUSB接続を再確認し、`mirror`を再起動できた。端末の物理的な抜き差し後の再接続は未検証。
- 対象パッケージだけを照会し、端末にSMARTBUKATSUの通常版と開発版（`.dev`）が導入済みであることを確認。開発版と現行ソースの互換性、練習環境への接続はまだ確認していない。
- `git diff --check`成功。専用フォルダの導入記録と画像保存先が`git check-ignore`で除外されることを確認。
- アプリ本体、Expo/EAS設定、パッケージ、Firebase設定・データ、HP・PDFは変更なし。commit・push・PR・管理シート更新は未実施。

### 第2段階の検証（2026-10-22）

- `app.config.js`、`src/firebase.js`、`src/config/captureEnvironment.js`、`src/services/notificationService.js`、`src/ads/AdManager.native.js`に撮影モードだけの設定・接続・外部通信停止処理を追加。通常時の設定を維持。
- 専用起動スクリプト、ローカルFunctions入口、練習データ投入、動画・画像生成、安全確認・統合検証を追加。package.json・ロックファイル・EAS設定・本番Functions・ルールは変更なし。
- `node --test scripts/androidCapture/captureEnvironment.test.cjs src/services/pushTokenRegistration.test.cjs src/services/notificationPreferences.test.cjs src/ads/AppBannerAd.test.cjs`：安全確認と既存通知・広告の回帰を実行。第2段階の追加安全確認を含め最終68件成功。
- 最初の新規テスト1件はテスト用モックがimport時にも例外を出す不備で失敗し、モックを修正して成功。既存Git履歴参照テストは制限環境で失敗し、同じテストを権限付きで再実行して成功。
- JavaScript・PowerShell構文検査成功。
- `node scripts/androidCapture/run.cjs start` / `status` / `open`：Auth・Firestore・Functions・Storage・Metro・素材サーバーが127.0.0.1の指定ポートで起動し、`ready: true`を確認。実際の開発版でローカルサーバーを開けた。
- 最初の動画生成ではPlaywright専用Chromiumが未導入のため失敗。既存Edgeを使うよう変更して動画・画像の生成に成功。ブラウザーやパッケージの追加インストールなし。
- `node scripts/androidCapture/verify.cjs`：6種類の合成アカウントでメール確認済み認証・チーム情報・元動画・戦術ノートの閲覧権限、通知サマリーFunctionsを検証。保護者の戦術ノート拒否を確認。ローカル動画のRange配信と画像配信も成功。
- Android 17の既存開発版でログイン・練習チームのホーム表示・1080×2400pxのPNG取得に成功。最初の表示エラーは投入した練習投稿に`user`フィールドが不足していたためで、練習データだけを修正して解消。画面側のコードは変更していない。
- 動画の実機での再生、予定・権限の変更、戦術ノート投稿等の全操作とiOS実機は未検証。実プッシュ配信は対象外。各ガイド用の全画像撮影、番号・赤枠加工、HP・PDF更新は未実施。
- ローカルの起動ログに既存expo-avの非推奨警告が出る。今回の目的に関係するパッケージ更新は行わない。
- 停止直後の再起動で終了処理と競合したため、停止完了の待機と重複起動の拒否を追加。adbサーバーが応答しない状態も発生し、所有者の個別承認後、専用ツールのサーバープロセスであることを確認して再起動した。所有者が端末側でUSBデバッグを再許可し、`check`で接続復旧を確認。アプリや端末データの削除なし。
- 復旧後の`start` → `ready: true` → `verify`、および`stop`完了直後の`start` → `ready: true` → `open` → `verify`に成功。停止完了と練習データの再投入を確認。画面表示ウィンドウも再起動した。
- 本番Firebase・認証・データ・配信設定は変更なし。commit・push・PR・管理シート更新も未実施。
