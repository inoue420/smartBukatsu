import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';

export async function reorderTeamGrades(teamId, before, after) {
  const valid = values => Array.isArray(values) && values.every(value => typeof value === 'string' && value.trim()) && new Set(values).size === values.length;
  const same = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
  if (!teamId || !valid(before) || !valid(after) || before.length !== after.length || after.some(value => !before.includes(value))) {
    throw new Error('並べ替える学年・グループを確認してください。');
  }
  if (same(before, after)) return false;
  return runTransaction(db, async transaction => {
    const ref = doc(db, 'teams', teamId), snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('チームが見つかりません。');
    const team = snapshot.data();
    if (team.membershipBatchPending) throw new Error('卒業などの一括処理が完了してから並べ替えてください。');
    const current = team.grades ?? ['1年生', '2年生', '3年生'];
    if (!Array.isArray(current) || !same(current, before)) throw new Error('学年・グループが更新されました。最新の一覧で並べ替え直してください。');
    transaction.update(ref, { grades: [...after] });
    return true;
  });
}
