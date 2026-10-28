import { useCallback, useEffect, useRef } from "react";
import { AppState, Keyboard } from "react-native";
import { recordReviewUsage, requestAppReview } from "../services/appReviewService";

export function useAppReview({ uid, enabled, screen }) {
  const current = useRef(null);
  current.current = { uid, enabled, screen };
  const timer = useRef(null);
  const generation = useRef(0);
  const keyboardVisible = useRef(Keyboard.isVisible?.() || false);
  const foreground = useRef(AppState.currentState === "active");
  const foregroundStartedAt = useRef(Date.now());
  const cancelReview = useCallback(() => {
    generation.current += 1;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    cancelReview();
    if (uid && enabled && foreground.current) void recordReviewUsage(uid);
    const app = AppState.addEventListener("change", state => {
      if (state === "active" && !foreground.current) foregroundStartedAt.current = Date.now();
      foreground.current = state === "active";
      cancelReview();
      if (foreground.current && current.current.enabled) void recordReviewUsage(current.current.uid);
    });
    const show = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisible.current = true; cancelReview();
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => { keyboardVisible.current = false; });
    return () => { cancelReview(); app.remove(); show.remove(); hide.remove(); };
  }, [uid, enabled, cancelReview]);

  const completeInteraction = useCallback(async expectedScreen => {
    cancelReview();
    const snapshot = current.current, version = generation.current;
    const isSafe = () => generation.current === version && current.current.uid === snapshot.uid &&
      current.current.enabled && current.current.screen === expectedScreen &&
      foreground.current && Date.now() - foregroundStartedAt.current >= 60000 &&
      !keyboardVisible.current && !Keyboard.isVisible?.();
    if (!snapshot.uid || !isSafe()) return;
    await recordReviewUsage(snapshot.uid);
    if (!isSafe()) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void requestAppReview(snapshot.uid, isSafe);
    }, 2000);
  }, [cancelReview]);

  const reviewNavigationChanged = useCallback(nextScreen => {
    cancelReview();
    current.current.screen = nextScreen;
  }, [cancelReview]);

  return { cancelReview, completeInteraction, reviewNavigationChanged };
}
