import React, { createContext, useContext } from "react";

// 1. コンテキスト（データの通り道）を作成
const AuthContext = createContext();

// 2. データをアプリ全体に提供するプロバイダー
export const AuthProvider = ({ children, isAdmin, currentUser }) => {
  // 各画面で `const { isAdmin, currentUser, user, activeTeamId } = useAuth();`
  // のように呼び出せるように、必要な値をまとめておきます。
  const value = {
    isAdmin,
    currentUser,
    // 既存のFirebase連携コードなどと互換性を持たせるための安全対策（ダミーデータ）
    user: { uid: currentUser || "guest_user" },
    activeTeamId: "team_001",
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// 3. 各画面で簡単にデータを呼び出せるようにするカスタムフック
export const useAuth = () => {
  return useContext(AuthContext);
};
