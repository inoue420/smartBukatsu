import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  reload,
  sendEmailVerification,
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
import { unregisterPushTokenForCurrentDevice } from "./services/notificationService";
import { auth, db } from "./firebase";
import {
  executeRegistration,
  switchActiveTeam,
} from "./services/firestoreService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState(""); // ★追加：ユーザー名を保持
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState(null);
  const [teamIds, setTeamIds] = useState([]);
  const [blockedUserUids, setBlockedUserUids] = useState([]);
  const [role, setRole] = useState(null);
  const [hasSelectedTeam, setHasSelectedTeam] = useState(false);
  const [teamAccessRevoked, setTeamAccessRevoked] = useState(false);
  const [emailVerificationRequired, setEmailVerificationRequired] =
    useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const authFlowRef = useRef(null);

  // Firebaseの認証状態を監視
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setIsEmailVerified(Boolean(u?.emailVerified));
      setRole(null);
      setActiveTeamId(null);
      setTeamIds([]);
      setBlockedUserUids([]);
      setUserName(""); // リセット
      setHasSelectedTeam(false);
      setTeamAccessRevoked(false);

      if (!u?.uid) {
        setEmailVerificationRequired(false);
        setLoading(false);
        return;
      }

      const isSigningUp = authFlowRef.current === "signup";
      setLoading(true);
      try {
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          if (isSigningUp) {
            setEmailVerificationRequired(true);
          } else {
            await setDoc(
              ref,
              {
                activeTeamId: "",
                teamIds: [],
                createdAt: serverTimestamp(),
                emailVerificationRequired: false,
              },
              { merge: true },
            );
            setEmailVerificationRequired(false);
          }
        } else {
          setEmailVerificationRequired(
            snap.data()?.emailVerificationRequired === true,
          );
        }
      } catch (error) {
        console.log("ユーザー情報の取得エラー:", error);
        setEmailVerificationRequired(isSigningUp);
      } finally {
        setLoading(false);
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
      if (snap.exists()) {
        setEmailVerificationRequired(
          data.emailVerificationRequired === true,
        );
      }
      const t = typeof data.activeTeamId === "string" ? data.activeTeamId : "";
      const ids = Array.isArray(data.teamIds)
        ? data.teamIds.filter((id) => typeof id === "string" && id)
        : [];
      const normalizedTeamIds = [...new Set([...ids, ...(t ? [t] : [])])];
      const normalizedBlockedUserUids = Array.isArray(data.blockedUserUids)
        ? [
            ...new Set(
              data.blockedUserUids.filter(
                (uid) => typeof uid === "string" && uid && uid !== user.uid,
              ),
            ),
          ]
        : [];

      setTeamIds(normalizedTeamIds);
      setBlockedUserUids(normalizedBlockedUserUids);
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
    const handleAccessRevoked = () => {
      setRole(null);
      setActiveTeamId(null);
      setHasSelectedTeam(false);
      setTeamAccessRevoked(true);
    };
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          handleAccessRevoked();
          return;
        }
        const data = snap.data() || {};
        setRole(data.role || null);
      },
      (error) => {
        if (error?.code === "permission-denied") {
          handleAccessRevoked();
          return;
        }
        console.log("Team role subscription error:", error);
      },
    );
    return () => unsub();
  }, [user?.uid, activeTeamId]);

  const api = useMemo(() => {
    const signIn = async (email, password) => {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    };
    const signUp = async (
      email,
      password,
      {
        role: registrationRole,
        userName: registrationUserName,
        teamName,
        inviteCode,
        legalConsent,
      },
    ) => {
      authFlowRef.current = "signup";
      setEmailVerificationRequired(true);
      setIsEmailVerified(false);
      setLoading(true);

      try {
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        await executeRegistration(
          userCredential.user.uid,
          registrationRole,
          registrationUserName,
          teamName,
          inviteCode,
          { emailVerificationRequired: true, legalConsent },
        );
        await sendEmailVerification(userCredential.user);
        return userCredential;
      } catch (error) {
        if (!auth.currentUser) {
          setEmailVerificationRequired(false);
          setLoading(false);
        }
        throw error;
      } finally {
        authFlowRef.current = null;
        setLoading(false);
      }
    };
    const resetPassword = async (email) => {
      await sendPasswordResetEmail(auth, email.trim());
    };
    const signOut = async () => {
      try {
        await unregisterPushTokenForCurrentDevice();
      } catch (error) {
        console.log("ログアウト前の通知端末解除エラー:", error?.message);
      }
      await fbSignOut(auth);
    };
    const resendVerificationEmail = async () => {
      if (!auth.currentUser) {
        throw new Error("ログイン中のユーザーを確認できませんでした。");
      }
      await sendEmailVerification(auth.currentUser);
    };
    const refreshEmailVerification = async () => {
      if (!auth.currentUser) {
        throw new Error("ログイン中のユーザーを確認できませんでした。");
      }
      await reload(auth.currentUser);
      const verified = Boolean(auth.currentUser.emailVerified);
      setIsEmailVerified(verified);
      return verified;
    };
    const selectTeam = async (teamId) => {
      if (!user?.uid) throw new Error("ユーザー情報を確認できませんでした。");
      await switchActiveTeam(user.uid, teamId);
      setHasSelectedTeam(true);
      setTeamAccessRevoked(false);
    };
    return {
      user,
      userName, // ★追加：Contextで名前を配信
      loading,
      activeTeamId,
      teamIds,
      blockedUserUids,
      role,
      isAdmin: role === "admin" || role === "owner", // ownerも管理者として扱うように強化
      teamSelectionRequired:
        teamAccessRevoked || (teamIds.length > 1 && !hasSelectedTeam),
      emailVerificationRequired,
      isEmailVerified,
      emailVerificationPending:
        Boolean(user) && emailVerificationRequired && !isEmailVerified,
      selectTeam,
      signIn,
      signUp,
      resetPassword,
      signOut,
      resendVerificationEmail,
      refreshEmailVerification,
    };
  }, [
    user,
    userName,
    loading,
    activeTeamId,
    teamIds,
    blockedUserUids,
    role,
    hasSelectedTeam,
    emailVerificationRequired,
    isEmailVerified,
    teamAccessRevoked,
  ]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
