# Node.js / nvm-windows 運用

管理番号: SB-20261022-001
方針確定日: 2026-10-27（日本時間）

## 対象と変更境界

本対応は、nvm-windowsを使ったアプリ開発環境のNode.js 22 / 24比較検証と、EAS BuildのNode.js 24移行を対象とする。
Firebase FunctionsはNode.js 22を維持する。Functionsの24移行は別作業とし、今回の作業ではFunctionsソース、Functionsのpackage.json / package-lock.json、Firebase設定、Rules、認証、本番データを変更・デプロイしない。
ストア提出、OTA配信、アプリ版数・buildNumber・versionCodeの変更は対象外。

作業開始時のGit基点は `0ac4cc54790f0fe758da0a2813cd7c89081db76d`。
開始時はmasterで作業ツリーがクリーンだったため、既存チェックアウトに専用ブランチ `codex/sb-20261022-001-node24` を作成した。
作業中の変更の退避・削除・自動commitは行っていない。

## バージョンの正式な管理場所

| 対象 | 管理場所 | 意味 |
| --- | --- | --- |
| アプリ開発で使用する完全なバージョン | この文書 | 通常利用・比較・復旧時の具体的な番号 |
| アプリ側の対応範囲 | ルートpackage.jsonのengines.node | 22系または24系。自動インストールや切替は行わない |
| EAS Buildの実行版 | eas.jsonの各buildプロファイルのnode | クラウドのビルド用Node.js。ローカルのnvmとは別設定 |
| Functionsのランタイム | functions/package.jsonのengines.node | `22`を維持。クラウドではメジャーバージョンを指定する |

**nvm-windows 1.2.2は.nvmrcを公式にサポートしないため、.nvmrcは作成しない。**
フォルダ移動時の自動切替や、引数なしの `nvm use` による設定読込を前提にしない。
PowerShellプロファイル、自動切替スクリプト、Voltaのプロジェクト固定も追加しない。

| 用途 | Node.js | npm | 状態 |
| --- | --- | --- | --- |
| 通常のアプリ開発・EAS移行先 | 24.22.1 x64 | 11.19.1 | 導入・比較検証済み。既存失敗は下記参照 |
| 比較・復旧確認・Functionsのローカル検証 | 22.23.4 x64 | 10.9.9 | 導入・比較検証済み。既存失敗は下記参照 |
| 作業開始時に選択されていた版 | 23.11.0 x64 | 10.9.2（通常実行時） | 削除せず保持 |

番号は2026-10-27に確認したもの。将来の修正版採用時は、再検証してこの表と該当するEAS指定を更新する。
Node.jsのメジャーを増やす際、`engines`の対応範囲だけを先に広げない。

## Windowsでの切り替え手順

1. Metro、開発用CLI、対象のNode.jsプロセスを終了する。他プロジェクトの作業者・ターミナルでもNode.jsを新規起動する予定がないか確認する。
2. 使用するバージョンをnvmで明示的に選択する。
3. 実際のNode.js、npm、実行元を確認する。
4. 必要な場合はロックファイルから依存関係を再構築し、開発サーバーを起動し直す。

通常のアプリ開発:

```powershell
nvm use 24.22.1 64
node --version
npm --version
node -p "process.execPath"
```

22系による比較・Functionsのローカル検証:

```powershell
nvm use 22.23.4 64
node --version
npm --version
node -p "process.execPath"
```

`nvm use`は共有シンボリックリンクを変更する。他のターミナル・別プロジェクトで今後起動するNode.jsにも影響する。
既に起動済みのプロセスは自動で切り替わらない。Git worktreeを分けてもNode.js選択は分離されないため、22 / 24の検証は直列で行う。

## Voltaとの共存・実行経路の確認

今回のPCでは、コマンド入口に `C:\Program Files\Volta`、nvmのリンク先に `C:\nvm4w\nodejs` が存在する。
通常実行ではnvmの選択版が使われた一方、権限を付けた実行ではVoltaの20.20.0が使われるケースがあった。
したがって、`nvm use`の成功表示だけでは検証環境が揃ったと判断しない。

```powershell
nvm current
where.exe node
where.exe npm
where.exe npx
node --version
npm --versions
node -p "process.execPath"
```

`npm --versions`でもnpm自身が動作するNode.jsを確認できる。
異なる版が選ばれる場合は、そのPowerShellプロセス内でのみnvmのリンクを優先できる。

```powershell
if ([string]::IsNullOrWhiteSpace($env:NVM_SYMLINK)) {
  throw 'NVM_SYMLINKを確認してください。'
}
$env:Path = "$env:NVM_SYMLINK;$env:Path"
node --version
npm --versions
node -p "process.execPath"
```

この操作は現在のPowerShellとその子プロセスだけに適用される。新しいターミナルでも実行版を確認する。
今回の検証ではnvm配下のnode.exeを直接起動し、Node.jsのメジャーがラベルと一致しない場合は検証を開始しないようにした。
2026-10-27、ユーザーの明示承認により、システムPATHの既存 `C:\nvm4w\nodejs` 1項目をVoltaより前の先頭へ移動した。
変更前はシステムPATH内の0始まり位置10、変更後は位置0。他の項目の順序と内容、ユーザーPATH、PowerShellプロファイル、Volta本体は維持した。
Windows管理者権限で適用し、変更前後の値を `dist/sb-20261022-001-node24/machine-path-backup.json` に保存した。この個別PCの設定バックアップはGitの対象にしない。
変更後の保存PATHを読み込んだ環境で、通常のnode / npm / npxがnvm配下から解決されることを確認した。
その後nvmで22.23.4 / npm 10.9.9、24.22.1 / npm 11.19.1へ順に切り替えられることを確認し、最後は24.22.1へ戻した。

**既に起動しているVS Code、ターミナル等には古いPATHが残る。アプリを終了して起動し直し、Node.jsとnpmを再確認する。**
再起動までのセッションでは上記の一時的なPATH設定を利用できる。

## 依存関係とローカル検証

バージョンを切り替えた直後、既存node_modulesをそのまま再利用できるとは限らない。
比較検証では各Node.js / npmで、既存のロックファイルを使って再構築する。

```powershell
npm ci --no-audit --no-fund
```

`npm ci`はnode_modulesを置き換え、インストールスクリプトを実行する。
ロックファイルの削除、npm update、npm audit fix --forceは行わない。
今回のロック変更はルートパッケージのenginesメタデータのみとし、依存バージョン・解決URL・integrityは維持する。

確認対象:

- 同じ対象テストの件数、成功・失敗・スキップ、終了コード。既存失敗と24系で追加された失敗を区別する。
- Expoの依存関係検査とExpo Doctor。同じDoctorバージョンで比較する。
- APP_VARIANT=developmentによるAndroid / iOSのJavaScript書き出し。
- Node.js / npmの実測値、実行元、依存関係の意図しない差分。

ルートにnpm test / lint / typecheckスクリプトはない。存在しないスクリプトやテスト基盤は追加しない。
通常の単体テストと、Firebase Emulatorが必要なRules / 統合テストは分離する。
アプリの既存テストには、Git履歴を読み取る比較テストがある。Git管理領域を読み取れない場合の失敗をアプリの不具合と混同しない。

書き出しの例:

```powershell
$env:APP_VARIANT = 'development'
$env:EXPO_NO_TELEMETRY = '1'
npx expo install --check
npx --yes expo-doctor@1.21.5
npx expo export --platform android --max-workers 2 --output-dir dist/node24-check/android
npx expo export --platform ios --max-workers 2 --output-dir dist/node24-check/ios
```

`APP_VARIANT=development`はFirebase接続先が検証環境になる保証ではない。
書き出し時にアプリは実機上で実行されない。ログへ秘密情報や.env内容を出力しない。
実機でデータ変更を伴う確認の前には、接続先とテストアカウントを確認する。

## EAS Buildの段階移行

ローカルの比較結果を評価し、development → preview → productionの順に進める。
各プロファイルのnode値だけを検証済みの24系へ変更し、各段階でAndroid / iOSを確認する。
Node.js更新と関係しないSDK、React Native、ビルドイメージ、識別子、権限、署名、版数を同時変更しない。

| プロファイル | 作業前のNode.js | 現在の指定 | 進行条件 |
| --- | --- | --- | --- |
| development | 20.20.0 | 24.22.1（設定準備のみ・ビルド未実施） | 既存失敗の扱いを確認、必要なcommitの明示承認 |
| preview | 20.20.0 | 20.20.0 | developmentの両OSビルド・必要な動作確認 |
| production | 20.20.0 | 20.20.0 | previewの検証結果を評価してから実施 |

`cli.requireCommit=true`を維持する。必要なcommitは、差分・結果・メッセージ案を提示して承認を得る。
CLIの自動commitやrequireCommit無効化で回避しない。push / PR / マージは別途承認。
ビルド成功、JavaScript書き出し成功、実機成功、ストア公開はそれぞれ別の状態として記録する。

既存のEAS CLI 16.32.0がNode.js 24.22.1でバージョン表示まで起動することを確認した。
CLIの更新通知（25.3.0）は適用していない。24系のnvm配下へEAS CLIをグローバル追加する操作も行っていない。
CLIの起動確認は、認証・クラウドビルドの成功を意味しない。

実機では、起動・認証・チーム切替・データ表示・通知・添付・動画・地図・広告をAndroid / iOSで確認する。
今回のビルド検証に、ストア提出・OTA配信・本番データ更新・実利用者への通知送信を含めない。

## 復旧

- アプリ環境の問題: 検証済み22系へnvmで切り替え、今回の設定差分を確認して元のロックでnpm ciを実行する。
- 環境整備自体の失敗: 開始時の選択版23.11.0へ一時的に戻せる。既存版は今回削除しない。
- EASの問題: 対象プロファイルのnode値を変更前に戻し、必要なビルドを承認範囲内で行う。
- ファイルの復旧: 今回変更した設定・文書だけを対象とし、他の作業を上書きしない。git reset --hardやgit cleanは使用しない。
- システムPATHの復旧: 管理者権限で上記JSONのmachinePathBeforeを復元する。適用後に他のPATH変更がある場合は丸ごと上書きせず、nvm項目だけを元の位置へ戻す方法を検討する。新しいプロセスで確認する。
- Functions: 今回は22維持・デプロイなしのため、Functionsのランタイム復旧操作は発生しない。

## 検証記録

2026-10-27に実施。Node.jsの実行元とnpmを各検証開始時に確認した。
権限昇格時にVoltaの20系が選ばれた初期試行は、22系の比較結果から除外して取り直した。

| 確認 | Node.js 22.23.4 / npm 10.9.9 | Node.js 24.22.1 / npm 11.19.1 |
| --- | --- | --- |
| npm ci --no-audit --no-fund | 成功、900パッケージ | 成功、900パッケージ |
| Expo依存関係検査 | 終了1、Expoのパッチ版指摘 | 終了1、同じ指摘 |
| Expo Doctor 1.21.5 | 18項目中17成功、終了1 | 同じ結果 |
| 既存単体テスト34ファイル | 600件: 成功543、失敗57、スキップ0 | 同じ件数・失敗項目・エラー内容 |
| Android向け書き出し | 成功、1,660モジュール | 成功、1,660モジュール |
| iOS向け書き出し | 成功、1,656モジュール | 成功、1,656モジュール |
| 開発サーバーの起動確認 | 専用の起動確認は未実施（書き出し時のMetro起動は成功） | localhostの/statusがpackager-status:running。確認後、起動したプロセスツリーを終了 |

Android / iOSとも生成バンドル名は22系と24系で一致した。HBCファイルのSHA256は異なり、同一バイナリとは判定していない。
JavaScript書き出しの成功は、ネイティブビルドや実機動作の成功を意味しない。

比較に使った主なコマンド:

```powershell
npm ci --no-audit --no-fund
npx expo install --check
npx --yes expo-doctor@1.21.5
npx expo export --platform android --max-workers 2 --output-dir <各Node.js版の出力先>
npx expo export --platform ios --max-workers 2 --output-dir <各Node.js版の出力先>
node --test-reporter=tap <対象テストファイル>
```

対象テストは、functions / src / scriptsの既存テストからRules専用ファイルとEmulator専用のattachmentExpiryBackend / tacticalNoteBackendを除いた34ファイル。
node --test実行時にテスト用VMの例外のIPCデシリアライズで一度件数が変動したため、比較では各ファイルを個別プロセスで直接実行してTAPを集計した。テストソースは修正していない。
各ファイルの件数・失敗タイトル・エラー行を機械比較し、22系と24系に差分がないことを確認した。

既存の57失敗は次の内訳。今回のアプリ側変更はNode.js対応範囲のメタデータのみで、以下のソース・テストは変更していない。

| エラーの種類 | 件数 | 主な対象 |
| --- | --- | --- |
| GuideHelpLinkを既存テストのモックが扱えない | 49 | notePlaybackRender、tacticalNoteLifecycle |
| workspaceReactionServiceを既存テストのモックが扱えない | 5 | tacticalNoteServices |
| removeHandler is not a function | 2 | dailyReportComments、loadingOptimization |
| アカウント削除ハンドラーのテスト失敗 | 1 | workspaceReactions |

Expoの指摘はexpo@54.0.35に対して~54.0.37を推奨するもの。両系統で同じ結果であり、今回パッケージは更新していない。
全テスト成功・全検査成功とは扱わず、既存課題として記録する。
EAS developmentへ進む前に、これらを今回の移行から切り分けて扱うことと、必要なcommitをユーザーへ確認する。

npmの警告:

- 22系ではFirebase AuthのAsyncStorage peerOptional（^1.18.1に対し2.2.0）警告が出た。インストールは成功。
- 24系のnpm 11.19.1ではallowScripts未承認の@firebase/util@1.13.0とprotobufjs@7.5.4のpostinstallに関する警告が出た。同梱npmの説明で、未承認の依存インストールスクリプトは既定でスキップされることを確認した。
- 両スクリプトのソースを確認した。前者はFirebase設定の既定値生成、後者は依存バージョン指定の検査である。アプリはsrc/firebase.jsで明示的なconfigをinitializeAppへ渡す構成。今回allowScriptsの追加・一括承認・ユーザーnpm設定変更は行っていない。
- 24系の上表はこの既定ポリシーのままの結果。将来必要性が判明した場合は、対象パッケージと版を限定して別途判断する。実機のFirebase機能は未確認。
- inflight / rimraf / glob / uuidの非推奨警告は今回修正していない。

Functionsのpackage.json / package-lock.json、firebase.json、Firestore / Storage Rules、app.config.jsは開始時とSHA256一致を確認した。
Firebaseへのデプロイ、データ変更、EAS Build、実機確認、commit / push / PR、ストア提出、OTA配信は未実施。
eas.jsonはdevelopmentのnode値のみ24.22.1へ準備し、preview / productionは20.20.0を維持している。

詳細ログと比較用の一時スクリプトは `dist/sb-20261022-001-node24/` に置き、Gitの対象にはしない。

## 参照

- nvm-windows 1.xの.nvmrc非対応と共有リンク: https://github.com/nvm-windows/nvm/wiki/Common-Issues
- Node.js 22配布: https://nodejs.org/download/release/latest-v22.x/
- Node.js 24配布: https://nodejs.org/download/release/latest-v24.x/
- npm ci: https://docs.npmjs.com/cli/v11/commands/npm-ci/
- EAS設定: https://docs.expo.dev/eas/json/
