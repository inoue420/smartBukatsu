const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const channelSettingsKey = value => JSON.stringify(canonical(value));
const channelFormKey = ({ isReadOnly, memberAudience, roleGroups, grades, notificationRecipientUids }) => channelSettingsKey({
  isReadOnly, memberAudience, roleGroups: [...roleGroups].sort(), grades: [...grades].sort(), notificationRecipientUids: [...notificationRecipientUids].sort(),
});
module.exports = { channelSettingsKey, channelFormKey };
