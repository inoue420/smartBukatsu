import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
} from "firebase/auth";
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { switchActiveTeam } from "./services/firestoreService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState(""); // ★追加：ユーザー名を保持
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState(null);
  const [teamIds, setTeamIds] = useState([]);
  const [role, setRole] = useState(null);
  const [hasSelectedTeam, setHasSelectedTeam] = useState(false);

  // Firebaseの認証状態を監視
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setRole(null);
      setActiveTeamId(null);
      setTeamIds([]);
      setUserName(""); // リセット
      setHasSelectedTeam(false);
      setLoading(false);

      if (u?.uid) {
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(
            ref,
            { activeTeamId: "", teamIds: [], createdAt: serverTimestamp() },
            { merge: true },
          );
        }
      }
    });
    return () => unsub();
  }, []);

  // ユーザーの所属チームIDと「表示名（name）」を取得
  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, "users", user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() || {};
      const t = typeof data.activeTeamId === "string" ? data.activeTeamId : "";
      const ids = Array.isArray(data.teamIds)
        ? data.teamIds.filter((id) => typeof id === "string" && id)
        : [];
      const normalizedTeamIds = [...new Set([...ids, ...(t ? [t] : [])])];

      setTeamIds(normalizedTeamIds);
      setActiveTeamId(t || null);
      // ★取得した名前をセット（名前がなければメールアドレスを表示）
      setUserName(data.name || user.email || "ゲスト");

      if (!t && normalizedTeamIds.length === 1) {
        setDoc(ref, { activeTeamId: normalizedTeamIds[0] }, { merge: true });
      }
    });
    return () => unsub();
  }, [user?.uid]);

  // チーム内での権限（role）を取得
  useEffect(() => {
    if (!user?.uid || !activeTeamId) {
      setRole(null);
      return;
    }
    const ref = doc(db, "teams", activeTeamId, "members", user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() || {};
      setRole(data.role || null);
    });
    return () => unsub();
  }, [user?.uid, activeTeamId]);

  const api = useMemo(() => {
    const signIn = async (email, password) => {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    };
    const signUp = async (email, password) => {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
    };
    const resetPassword = async (email) => {
      await sendPasswordResetEmail(auth, email.trim());
    };
    const signOut = async () => {
      await fbSignOut(auth);
    };
    const selectTeam = async (teamId) => {
      if (!user?.uid) throw new Error("ユーザー情報を確認できませんでした。");
      await switchActiveTeam(user.uid, teamId);
      setHasSelectedTeam(true);
    };
    return {
      user,
      userName, // ★追加：Contextで名前を配信
      loading,
      activeTeamId,
      teamIds,
      role,
      isAdmin: role === "admin" || role === "owner", // ownerも管理者として扱うように強化
      teamSelectionRequired: teamIds.length > 1 && !hasSelectedTeam,
      selectTeam,
      signIn,
      signUp,
      resetPassword,
      signOut,
    };
  }, [user, userName, loading, activeTeamId, teamIds, role, hasSelectedTeam]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
