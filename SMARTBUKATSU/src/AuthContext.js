import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { setPushRegistrationSession, unregisterPushTokenForCurrentDevice } from "./services/notificationService";
import { measuredOnSnapshot } from "./services/firestoreSubscription";
import { auth, db } from "./firebase";
import {
  createTeam,
  createRegistrationTeamIdentity,
  executeRegistration,
  joinTeamWithInvite,
  switchActiveTeam,
} from "./services/firestoreService";
import { createPendingRegistrationStore } from "./utils/pendingRegistration";

const AuthContext = createContext(null);
const registrationStore = createPendingRegistrationStore(AsyncStorage);

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
  const [pendingRegistration, setPendingRegistration] = useState(null);
  const [registrationReady, setRegistrationReady] = useState(false);
  const [registrationReadFailed, setRegistrationReadFailed] = useState(false);
  const [verificationRequested, setVerificationRequested] = useState(false);
  const verificationActionRef = useRef(null);
  const authFlowRef = useRef(null);
  const authUserRef = useRef(null);
  const teamSwitchRef = useRef(null);
  const [isTeamSwitching, setIsTeamSwitching] = useState(false);

  // Firebaseの認証状態を監視
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      authUserRef.current = u || null;
      setPushRegistrationSession(u?.uid);
      teamSwitchRef.current = null;
      setIsTeamSwitching(false);
      setUser(u || null);
      setIsEmailVerified(Boolean(u?.emailVerified));
      setPendingRegistration(null);
      setRegistrationReady(false);
      setRegistrationReadFailed(false);
      setVerificationRequested(false);
      verificationActionRef.current = null;
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
        let draft = null;
        let readFailed = false;
        try {
          draft = await registrationStore.read(u.uid);
        } catch {
          readFailed = true;
          console.log("端末内の登録情報を読み取れませんでした。");
        }
        if (authUserRef.current !== u) return;
        setPendingRegistration(draft);
        setRegistrationReadFailed(readFailed);
        setRegistrationReady(!readFailed);
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (authUserRef.current !== u) return;
        if (!snap.exists()) {
          if (isSigningUp || draft || readFailed || !u.emailVerified) {
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
            if (authUserRef.current !== u) return;
            setEmailVerificationRequired(false);
          }
        } else {
          setEmailVerificationRequired(
            snap.data()?.emailVerificationRequired === true,
          );
        }
      } catch (error) {
        console.log("ユーザー情報の取得エラー:", error);
        if (authUserRef.current === u) setEmailVerificationRequired(true);
      } finally {
        if (authUserRef.current === u) setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // ユーザーの所属チームIDと「表示名（name）」を取得
  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, "users", user.uid);
    let active = true;
    const unsub = measuredOnSnapshot("authUser", ref, (snap) => {
      if (!active) return;
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
    return () => { active = false; unsub(); };
  }, [user?.uid]);

  // チーム内での権限（role）を取得
  useEffect(() => {
    if (!user?.uid || !activeTeamId) {
      setRole(null);
      return;
    }
    const ref = doc(db, "teams", activeTeamId, "members", user.uid);
    let active = true;
    setRole(null);
    const handleAccessRevoked = () => {
      if (!active) return;
      setRole(null);
      setActiveTeamId(null);
      setHasSelectedTeam(false);
      setTeamAccessRevoked(true);
    };
    const unsub = measuredOnSnapshot(
      "authMembership",
      ref,
      (snap) => {
        if (!active) return;
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
    return () => { active = false; unsub(); };
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
        sport,
        inviteCode,
        legalConsent,
        invitationId,
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
        const ensureSignupCurrent = () => {
          if (auth.currentUser !== userCredential.user) throw new Error("ログイン状態が変わりました。もう一度ログインしてください。");
        };
        ensureSignupCurrent();
        const saveProfile = () => executeRegistration(
          userCredential.user.uid, registrationRole, registrationUserName, teamName, inviteCode,
          { emailVerificationRequired: true, legalConsent, sport, deferTeam: true },
        );
        let draft;
        try {
          draft = await registrationStore.save(userCredential.user.uid, {
            role: registrationRole, userName: registrationUserName, teamName, sport,
            inviteCode, legalConsent, invitationId,
            ...(registrationRole === "admin" ? createRegistrationTeamIdentity() : {}),
          });
        } catch {
          // Preserve consent even when this device cannot retain team inputs.
          // Verification can then proceed with team details re-entered afterwards.
          ensureSignupCurrent();
          await saveProfile();
          ensureSignupCurrent();
          throw new Error("登録情報を端末に保存できませんでした。確認メールを再送してメール確認を終えた後、チーム情報を再入力してください。");
        }
        ensureSignupCurrent();
        setPendingRegistration(draft);
        await saveProfile();
        ensureSignupCurrent();
        const savedDraft = await registrationStore.save(userCredential.user.uid, { ...draft, profileSaved: true });
        ensureSignupCurrent();
        setPendingRegistration(savedDraft);
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
      } catch {
        console.log("ログアウト前の通知端末解除に失敗しました。");
      }
      try {
        await fbSignOut(auth);
      } catch (error) {
        setPushRegistrationSession(auth.currentUser?.uid);
        throw error;
      }
    };
    const resendVerificationEmail = async () => {
      if (!auth.currentUser) {
        throw new Error("ログイン中のユーザーを確認できませんでした。");
      }
      await sendEmailVerification(auth.currentUser);
    };
    const refreshEmailVerification = () => {
      const current = auth.currentUser;
      if (!current) {
        throw new Error("ログイン中のユーザーを確認できませんでした。");
      }
      if (verificationActionRef.current) return verificationActionRef.current.promise || Promise.reject(new Error("登録処理の完了までお待ちください。"));
      const action = { user: current };
      verificationActionRef.current = action;
      const ensureCurrent = () => {
        if (authUserRef.current !== current || auth.currentUser !== current) {
          throw new Error("ログイン状態が変わりました。もう一度ログインしてください。");
        }
      };
      action.promise = (async () => {
        try {
          await reload(current);
          ensureCurrent();
          if (!current.emailVerified) {
            setIsEmailVerified(false);
            return false;
          }
          // reload() alone does not force the token used by Rules/callables to refresh.
          await current.getIdToken(true);
          ensureCurrent();
          const draft = await registrationStore.read(current.uid);
          ensureCurrent();
          setIsEmailVerified(true);
          if (draft) setPendingRegistration(draft);
          if (draft) {
            if (!draft.profileSaved) {
              await executeRegistration(current.uid, draft.role, draft.userName, draft.teamName, draft.inviteCode,
                { emailVerificationRequired: true, legalConsent: draft.legalConsent, sport: draft.sport, deferTeam: true });
              ensureCurrent();
              await registrationStore.save(current.uid, { ...draft, profileSaved: true });
            }
            ensureCurrent();
            const result = draft.role === "admin"
              ? await createTeam(current.uid, draft.teamName, draft.userName, draft.sport, draft)
              : await joinTeamWithInvite(current.uid, draft.inviteCode, draft.userName);
            ensureCurrent();
            await registrationStore.remove(current.uid);
            ensureCurrent();
            setPendingRegistration(null);
            setActiveTeamId(result.teamId);
            setHasSelectedTeam(true);
            setTeamAccessRevoked(false);
          }
          setRegistrationReady(true);
          setRegistrationReadFailed(false);
          setVerificationRequested(false);
          setIsEmailVerified(true);
          return true;
        } finally {
          if (verificationActionRef.current === action) verificationActionRef.current = null;
        }
      })();
      return action.promise;
    };
    const restartTeamRegistration = async () => {
      const current = auth.currentUser;
      if (!current?.emailVerified || authUserRef.current !== current) {
        throw new Error("先にメールアドレスの確認を完了してください。");
      }
      if (verificationActionRef.current) throw new Error("登録処理の完了までお待ちください。");
      const action = {};
      verificationActionRef.current = action;
      const ensureCurrent = () => {
        if (auth.currentUser !== current || authUserRef.current !== current) throw new Error("ログイン状態が変わりました。");
      };
      try {
        await current.getIdToken(true);
        ensureCurrent();
        const draft = await registrationStore.read(current.uid);
        ensureCurrent();
        if (draft && !draft.profileSaved) {
          await executeRegistration(current.uid, draft.role, draft.userName, draft.teamName, draft.inviteCode,
            { emailVerificationRequired: true, legalConsent: draft.legalConsent, sport: draft.sport, deferTeam: true });
          ensureCurrent();
        }
        await registrationStore.remove(current.uid);
        ensureCurrent();
        setPendingRegistration(null);
        setIsEmailVerified(true);
        setRegistrationReady(true);
        setRegistrationReadFailed(false);
        setVerificationRequested(false);
      } finally {
        if (verificationActionRef.current === action) verificationActionRef.current = null;
      }
    };
    const runTeamSelection = async (save) => {
      if (!user?.uid || authUserRef.current !== user) {
        throw new Error("ユーザー情報を確認できませんでした。");
      }
      if (teamSwitchRef.current) {
        throw new Error("チームを切り替え中です。完了するまでお待ちください。");
      }
      const request = { uid: user.uid };
      teamSwitchRef.current = request;
      setIsTeamSwitching(true);
      try {
        const result = await save(user.uid);
        if (teamSwitchRef.current !== request) {
          throw new Error("ログイン状態が変わりました。チームを選び直してください。");
        }
        const teamId = result.teamId;
        // Reflect a successful save without waiting for the listener's render.
        setActiveTeamId(teamId);
        setHasSelectedTeam(true);
        setTeamAccessRevoked(false);
        return result;
      } finally {
        if (teamSwitchRef.current === request) {
          teamSwitchRef.current = null;
          setIsTeamSwitching(false);
        }
      }
    };
    const selectTeam = (teamId) => runTeamSelection(async (uid) => {
      await switchActiveTeam(uid, teamId);
      return { teamId };
    });
    // These operations have already persisted membership and activeTeamId.
    const runVerifiedTeamSelection = (save) => runTeamSelection((uid) => {
      if (auth.currentUser?.emailVerified !== true) {
        setVerificationRequested(true);
        throw new Error("メールアドレスの確認後、チームへの参加・作成をもう一度お試しください。");
      }
      if (!registrationReadFailed) return save(uid);
      const current = auth.currentUser;
      // Existing teams stay usable, but an unread draft must be recovered before
      // starting another creation/join so its original operation is not duplicated.
      return (async () => {
        let draft;
        try {
          draft = await registrationStore.read(uid);
        } catch {
          throw new Error("端末内の登録情報を確認できませんでした。時間をおいてもう一度お試しください。");
        }
        if (auth.currentUser !== current || authUserRef.current !== current) {
          throw new Error("ログイン状態が変わりました。もう一度ログインしてください。");
        }
        setRegistrationReadFailed(false);
        setRegistrationReady(true);
        setPendingRegistration(draft);
        if (draft) throw new Error("完了していない登録があります。確認画面で登録を完了してください。");
        return save(uid);
      })();
    });
    const createAndSelectTeam = (teamName, name, sport) =>
      runVerifiedTeamSelection((uid) => createTeam(uid, teamName, name, sport));
    const joinAndSelectTeam = (inviteCode, name) =>
      runVerifiedTeamSelection((uid) => joinTeamWithInvite(uid, inviteCode, name));
    return {
      user,
      userName, // ★追加：Contextで名前を配信
      loading,
      activeTeamId,
      isTeamSwitching,
      teamIds,
      blockedUserUids,
      role,
      isAdmin: role === "admin" || role === "owner", // ownerも管理者として扱うように強化
      teamSelectionRequired:
        teamAccessRevoked || (teamIds.length > 1 && !hasSelectedTeam),
      emailVerificationRequired,
      isEmailVerified,
      pendingRegistration,
      emailVerificationPending:
        Boolean(user) && ((!registrationReady && !(registrationReadFailed && teamIds.length > 0)) || Boolean(pendingRegistration) ||
          ((emailVerificationRequired || verificationRequested) && !isEmailVerified)),
      selectTeam,
      createAndSelectTeam,
      joinAndSelectTeam,
      signIn,
      signUp,
      resetPassword,
      signOut,
      resendVerificationEmail,
      refreshEmailVerification,
      restartTeamRegistration,
    };
  }, [
    user,
    userName,
    loading,
    activeTeamId,
    isTeamSwitching,
    teamIds,
    blockedUserUids,
    role,
    hasSelectedTeam,
    emailVerificationRequired,
    isEmailVerified,
    pendingRegistration,
    registrationReady,
    registrationReadFailed,
    verificationRequested,
    teamAccessRevoked,
  ]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
