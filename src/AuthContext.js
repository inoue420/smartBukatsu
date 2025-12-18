import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'member' | null

  // Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setRole(null);
      setActiveTeamId(null);
      setLoading(false);

      // ユーザーがログインしたら users/{uid} を必ず用意（なければ作る）
      if (u?.uid) {
        const ref = doc(db, 'users', u.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, { activeTeamId: '', createdAt: serverTimestamp() }, { merge: true });
        }
      }
    });
    return () => unsub();
  }, []);

  // users/{uid}.activeTeamId
  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() || {};
      const t = typeof data.activeTeamId === 'string' ? data.activeTeamId : '';
      setActiveTeamId(t || null);
    });
    return () => unsub();
  }, [user?.uid]);

  // teams/{teamId}/members/{uid}.role
  useEffect(() => {
    if (!user?.uid || !activeTeamId) return;
    const ref = doc(db, 'teams', activeTeamId, 'members', user.uid);
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
    return {
      user,
      loading,
      activeTeamId,
      role,
      isAdmin: role === 'admin',
      signIn,
      signUp,
      resetPassword,
      signOut,
    };
  }, [user, loading, activeTeamId, role]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
