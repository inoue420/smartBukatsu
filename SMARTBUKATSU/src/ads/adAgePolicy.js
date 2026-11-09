const NON_PERSONALIZED_OPTIONS = Object.freeze({ requestNonPersonalizedAdsOnly: true });

const policy = (audience, ageRestrictedTreatment, maxAdContentRating) => Object.freeze({
  audience,
  requestConfiguration: Object.freeze({
    ageRestrictedTreatment,
    // Explicitly clear legacy flags so a previous child's settings cannot survive.
    tagForChildDirectedTreatment: false,
    tagForUnderAgeOfConsent: false,
    maxAdContentRating,
  }),
  consentOptions: Object.freeze({ tagForUnderAgeOfConsent: audience !== "adult" }),
  // For adults the SDK still applies UMP choices and OS privacy restrictions.
  requestOptions: audience === "adult" ? Object.freeze({}) : NON_PERSONALIZED_OPTIONS,
});

const UNKNOWN = policy("unknown", "child", "G");
const TEEN = policy("teen", "teen", "T");
const ADULT = policy("adult", "unspecified", "T");

function resolveAdAgePolicy({ uid, profileResolved, minimumAgeConfirmed, membershipRole } = {}) {
  if (!uid || !profileResolved) return UNKNOWN;
  // Product owner confirms guardian roles are assigned only to adults.
  // No other team role (including staff/owner/alumni) proves adulthood.
  if (membershipRole === "guardian") return ADULT;
  return minimumAgeConfirmed === true ? TEEN : UNKNOWN;
}

// Google SDK configuration and UMP state are global. Serialize transitions,
// including a slow consent form from an account that has just signed out.
function createAdTaskQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}

module.exports = { resolveAdAgePolicy, createAdTaskQueue };
