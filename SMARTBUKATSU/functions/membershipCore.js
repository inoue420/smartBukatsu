// Shared with Metro: no Firebase or Node dependencies.
const ACTIVE_MEMBER_ROLES = ['owner', 'admin', 'staff', 'captain', 'member', 'guardian'];
// Legacy clients treated falsy roles as "member". Null and missing fields need
// the one-time repair: an in-filter does not return those legacy documents.
const ACTIVE_MEMBER_QUERY_ROLES = [...ACTIVE_MEMBER_ROLES, '', false, 0];
const isGuardianLike = (role) => ['guardian', 'alumni'].includes(role);
const isArchivedMember = (member) => member?.role === 'alumni';
const batchMembershipChange = (before, after) => Boolean(after?.membershipOperationId &&
  before?.membershipOperationId !== after.membershipOperationId);
const creationKey = (snap) => snap?.createTime ? `${snap.createTime.seconds}:${snap.createTime.nanoseconds}` : '';

function membershipPlan(team, members, input) {
  const { memberGrades } = require('./workspaceAudience');
  const fail = (message) => { throw new Error(message); };
  const changes = [], removals = [], selected = new Set(input.memberUids || []);
  let teamChanges = {}, removedGroups = [];
  if (input.action === 'rename') {
    const name = String(input.name || '').trim(), old = input.group;
    if (!name || name.length > 60 || !team.grades?.includes(old) || name === old || team.grades.includes(name)) fail('変更前のグループと重複しない名前を確認してください。');
    teamChanges = { grades: team.grades.map((g) => g === old ? name : g),
      ...(Array.isArray(team.channels) ? { channels: team.channels.map((c) => ({ ...c, ...(Array.isArray(c.allowedGrades) ? { allowedGrades: c.allowedGrades.map((g) => g === old ? name : g) } : {}) })) } : {}) };
    for (const m of members.filter((m) => memberGrades(m).includes(old))) {
      const grades = memberGrades(m).map((g) => g === old ? name : g);
      changes.push({ uid: m.uid, data: { grades, grade: grades[0] || '' } });
    }
  } else if (input.action === 'graduate') {
    if (!Array.isArray(input.memberUids) || !selected.size || selected.size !== input.memberUids?.length || selected.size > 200 ||
      !Number.isInteger(input.fiscalYear) || input.fiscalYear < 1900 || input.fiscalYear > 2200 ||
      !['keep', 'leave'].includes(input.guardianPolicy)) fail('対象者・卒業年度・保護者の扱いを確認してください。');
    for (const uid of selected) {
      const m = members.find((m) => m.uid === uid);
      if (!m || !['member', 'captain'].includes(m.role) || team.createdBy === uid ||
        (input.group && !memberGrades(m).includes(input.group))) fail('卒業対象は同じグループの在籍する部員・キャプテンに限定してください。');
      changes.push({ uid, data: { role: 'alumni', archived: true, graduationFiscalYear: input.fiscalYear,
        grade: '', grades: [], canEditCalendar: false, canPostTacticalNotes: false,
        canUploadVideos: false, canEditTags: false } });
    }
    for (const parent of members.filter((m) => m.role === 'guardian' && (m.childUids || []).some((uid) => selected.has(uid)))) {
      const childUids = parent.childUids.filter((uid) => !selected.has(uid));
      if (!childUids.length && !(parent.manualChildren || []).length && input.guardianPolicy === 'leave' && parent.uid !== team.createdBy) removals.push(parent.uid);
      else changes.push({ uid: parent.uid, data: { childUids, childMemberships: Object.fromEntries(Object.entries(parent.childMemberships || {}).filter(([uid]) => !selected.has(uid))) } });
    }
    const affectedGroups = new Set(members.filter(m => selected.has(m.uid)).flatMap(memberGrades));
    const remaining = members.filter(m => !selected.has(m.uid) && !removals.includes(m.uid));
    // Match App's existing catalog fallback for older teams.
    const catalog = team.grades ?? ['1年生', '2年生', '3年生'];
    removedGroups = catalog.filter(group => affectedGroups.has(group) && !remaining.some(m => memberGrades(m).includes(group)));
    if (removedGroups.length) teamChanges = {
      grades: catalog.filter(group => !removedGroups.includes(group)),
      ...(Array.isArray(team.channels) ? { channels: team.channels.map(channel => ({ ...channel,
        ...(Array.isArray(channel.allowedGrades) ? { allowedGrades: channel.allowedGrades.filter(group => !removedGroups.includes(group)) } : {}) })) } : {}),
    };
  } else if (input.action === 'restore') {
    if (!Array.isArray(input.memberUids) || input.memberUids.length !== 1) fail('戻す卒業者を1名選んでください。');
    const member = members.find(m => m.uid === input.memberUids[0]);
    if (!member || member.role !== 'alumni') fail('一般部員へ戻せるのはOB・OGだけです。');
    changes.push({ uid: member.uid, data: { role: 'member', archived: false, graduationFiscalYear: null,
      grade: '', grades: [], canEditCalendar: false, canPostTacticalNotes: false,
      canUploadVideos: false, canEditTags: false } });
  } else fail('処理を確認してください。');
  return { changes, removals, teamChanges, removedGroups };
}
module.exports = { ACTIVE_MEMBER_ROLES, ACTIVE_MEMBER_QUERY_ROLES, isGuardianLike, isArchivedMember, batchMembershipChange, creationKey, membershipPlan };
