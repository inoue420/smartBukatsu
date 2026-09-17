export const SPORT_CATEGORIES = [
  {
    id: "ball_sports",
    label: "球技",
    sports: ["野球", "ソフトボール", "サッカー", "フットサル", "バスケットボール", "バレーボール", "ハンドボール", "ラグビー", "アメリカンフットボール", "ラクロス", "フィールドホッケー", "水球", "テニス", "ソフトテニス", "バドミントン", "卓球", "ゴルフ"],
  },
  { id: "track_water", label: "陸上・水上競技", sports: ["陸上競技", "駅伝・長距離", "水泳", "飛込", "ボート・カヌー"] },
  { id: "martial_arts", label: "武道・格闘技", sports: ["剣道", "柔道", "空手道", "弓道", "なぎなた", "少林寺拳法", "ボクシング", "レスリング", "フェンシング"] },
  { id: "performance", label: "表現・体操競技", sports: ["体操", "新体操", "ダンス", "チアリーディング・チアダンス"] },
  { id: "winter_sports", label: "ウィンタースポーツ", sports: ["スキー", "スノーボード", "スケート", "フィギュアスケート", "アイスホッケー"] },
  { id: "other_sports", label: "その他スポーツ", sports: ["アーチェリー", "自転車競技", "馬術", "登山・山岳", "ヨット・セーリング", "eスポーツ", "相撲", "ウエイトリフティング", "その他スポーツ"] },
  { id: "cultural_club", label: "文化部", sports: ["吹奏楽", "軽音楽", "合唱", "器楽・管弦楽", "日本音楽", "吟詠剣詩舞", "郷土芸能", "マーチングバンド／バトントワリング", "美術工芸", "書道", "演劇", "写真", "茶道", "華道", "放送", "囲碁", "将棋", "弁論", "かるた", "新聞", "文芸", "自然科学", "その他文化部"] },
];

export const CUSTOM_SPORT_OPTIONS = new Set(["その他スポーツ", "その他文化部"]);

export function getSportsForCategory(categoryId) {
  return SPORT_CATEGORIES.find((category) => category.id === categoryId)?.sports || [];
}

export function getCategoryLabel(categoryId) {
  return SPORT_CATEGORIES.find((category) => category.id === categoryId)?.label || "";
}
