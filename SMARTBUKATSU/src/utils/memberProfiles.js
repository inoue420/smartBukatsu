// One conversion for live updates and an explicit refresh of the member list.
function createMemberProfiles(membersData) {
  const names = [], profiles = {};
  membersData.forEach((m) => {
    const displayName = m.name || '名称未設定';
    let profileKey = displayName;
    if (profiles[profileKey]) profileKey = `${displayName}_${m.uid.substring(0, 4)}`;
    names.push(profileKey);
    profiles[profileKey] = {
      uid: m.uid, name: displayName, role: m.role || 'member',
      childUids: Array.isArray(m.childUids) ? m.childUids : [],
      manualChildren: Array.isArray(m.manualChildren) ? m.manualChildren : [],
      assignedStaff: m.assignedStaff || null, staffScope: m.staffScope || 'all',
      canUploadVideos: Boolean(m.canUploadVideos), canPostTacticalNotes: Boolean(m.canPostTacticalNotes),
      canEditTags: Boolean(m.canEditTags), canEditCalendar: Boolean(m.canEditCalendar),
      grade: m.grade || '', grades: m.grades, archived: m.role === 'alumni',
      graduationFiscalYear: m.graduationFiscalYear, position: m.position || '',
    };
  });
  return { names, profiles };
}
function mergeMemberIdentity(rows, identity) {
  if (!identity?.uid || rows.some(m => m.uid === identity.uid)) return rows;
  return [...rows, identity];
}
module.exports = { createMemberProfiles, mergeMemberIdentity };
