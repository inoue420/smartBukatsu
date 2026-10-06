import { useEffect, useRef, useState } from "react";
import { getOwnWorkspaceReaction, getWorkspaceReactionDetails, sendWorkspaceReaction } from "../services/workspaceReactionService";
import { canViewWorkspaceReactionSenders } from "../utils/workspaceReactions";

export function useWorkspaceReactions({ teamId, uid, role, channelId, posts, isOffline }) {
  const [details, setDetails] = useState(null);
  const [ownState, setOwnState] = useState(null);
  const [busyPostId, setBusyPostId] = useState(null);
  const scope = `${teamId || ""}/${uid || ""}/${channelId || ""}`;
  const context = useRef({ scope, generation: 0, detailsGeneration: 0, cache: new Map(), pending: new Set() });
  const latest = useRef(null);
  latest.current = { teamId, uid, role, posts, isOffline };
  if (context.current.scope !== scope) {
    context.current = { scope, generation: context.current.generation + 1,
      detailsGeneration: context.current.detailsGeneration + 1, cache: new Map(), pending: new Set() };
  }
  const closeDetails = () => {
    context.current.detailsGeneration++;
    context.current.detailsKey = null;
    setDetails(null);
  };
  useEffect(() => {
    setDetails(null);
    setOwnState(null);
    setBusyPostId(null);
    return () => { context.current.generation++; context.current.detailsGeneration++; };
  }, [scope]);
  useEffect(() => {
    if (details && (!canViewWorkspaceReactionSenders(posts.find((post) => post.id === details.postId), uid, role) || isOffline)) closeDetails();
  }, [posts, uid, role, isOffline, details]);

  const current = (generation) => context.current.generation === generation;
  const prepareReaction = async (postId) => {
    if (!teamId || !uid || isOffline || context.current.pending.has(postId)) return false;
    if (context.current.cache.has(postId)) return !context.current.cache.get(postId);
    const generation = context.current.generation;
    context.current.pending.add(postId);
    setBusyPostId(postId);
    try {
      const emoji = await getOwnWorkspaceReaction(teamId, postId, uid);
      if (!current(generation)) return false;
      context.current.cache.set(postId, emoji);
      setOwnState((previous) => ({ scope, items: { ...(previous?.scope === scope ? previous.items : {}), [postId]: emoji } }));
      return !emoji;
    } catch (error) {
      if (!current(generation)) return false;
      throw error;
    } finally {
      if (current(generation)) { context.current.pending.delete(postId); setBusyPostId(null); }
    }
  };

  const submitReaction = async (postId, emoji) => {
    if (!teamId || !uid || isOffline || context.current.pending.has(postId)) return null;
    const cached = context.current.cache.get(postId);
    if (cached) return { added: false, emoji: cached };
    const generation = context.current.generation;
    context.current.pending.add(postId);
    setBusyPostId(postId);
    try {
      const result = await sendWorkspaceReaction(teamId, postId, emoji);
      if (!current(generation)) return null;
      context.current.cache.set(postId, result.emoji);
      setOwnState((previous) => ({ scope, items: { ...(previous?.scope === scope ? previous.items : {}), [postId]: result.emoji } }));
      // Counts arrive through the existing post listener; never add twice locally.
      return result;
    } catch (error) {
      if (!current(generation)) return null;
      throw error;
    } finally {
      if (current(generation)) { context.current.pending.delete(postId); setBusyPostId(null); }
    }
  };

  const openDetails = async (postId, emoji) => {
    const post = posts.find((item) => item.id === postId);
    if (isOffline || !canViewWorkspaceReactionSenders(post, uid, role)) return;
    const key = `${postId}/${emoji}`;
    if (context.current.detailsKey === key) return;
    context.current.detailsKey = key;
    const generation = context.current.generation;
    const request = ++context.current.detailsGeneration;
    const count = post.reactions?.[emoji] || 0;
    setDetails({ scope, postId, emoji, count, loading: true, reactors: {}, error: "" });
    try {
      const reactors = await getWorkspaceReactionDetails(teamId, postId);
      const now = latest.current;
      if (!current(generation) || request !== context.current.detailsGeneration || now.isOffline ||
        !canViewWorkspaceReactionSenders(now.posts.find((item) => item.id === postId), now.uid, now.role)) return;
      setDetails({ scope, postId, emoji, count, loading: false, reactors, error: "" });
    } catch {
      if (current(generation) && request === context.current.detailsGeneration) {
        setDetails({ scope, postId, emoji, count, loading: false, reactors: {}, error: "送信者を取得できませんでした。通信状態や閲覧権限を確認してください。" });
      }
    } finally {
      if (current(generation) && request === context.current.detailsGeneration) context.current.detailsKey = null;
    }
  };
  const visibleDetails = details?.scope === scope && !isOffline &&
    canViewWorkspaceReactionSenders(posts.find((post) => post.id === details.postId), uid, role) ? details : null;
  return { details: visibleDetails, ownReactions: ownState?.scope === scope ? ownState.items : {}, busyPostId,
    prepareReaction, submitReaction, openDetails, closeDetails };
}
