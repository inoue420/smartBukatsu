import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { channelDisplayName } from '../../functions/workspaceAudience';
import { channelSettingsKey } from '../utils/workspaceChannel';

export async function saveWorkspaceChannel(teamId, next, before = null, fallbackChannels = []) {
  const label = channelDisplayName(next);
  if (!teamId || !next?.id || !next.name || !label.trim() || label.length > 100 || (before && (next.id !== before.id || next.name !== before.name))) {
    throw new Error('掲示板名を1〜100文字で入力してください。');
  }
  return runTransaction(db, async transaction => {
    const ref = doc(db, 'teams', teamId), snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('チームが見つかりません。');
    const team = snapshot.data();
    if (team.membershipBatchPending) throw new Error('一括処理が完了してから掲示板を編集してください。');
    const channels = Array.isArray(team.channels) && team.channels.length ? team.channels : fallbackChannels;
    const current = channels.find(channel => channel.id === next.id);
    if (before ? !current || channelSettingsKey(current) !== channelSettingsKey(before) : current) {
      throw new Error('掲示板の設定が更新されました。一度閉じて、最新の設定でやり直してください。');
    }
    if (channels.some(channel => channel.id !== next.id && (channelDisplayName(channel) === label || (!before && channel.name === next.name)))) {
      throw new Error('同じ名前、または以前その名前で作成した掲示板があります。別の掲示板名を入力してください。');
    }
    const updated = before ? channels.map(channel => channel.id === next.id ? next : channel) : [...channels, next];
    if (!before || channelSettingsKey(current) !== channelSettingsKey(next)) transaction.update(ref, { channels: updated });
    return updated;
  });
}
