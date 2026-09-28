const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isRecordedTagOwner, canViewRecordedTag, canEditRecordedTag,
} = require("./recordedTagPermissions");

for (const role of ["owner", "admin", "staff", "captain", "member", "guardian", "unknown"]) {
  for (const permission of [false, true]) {
    test(`${role}, permission ${permission}: public and private tag access`, () => {
      const viewer = {
        userRole: role, canEditTags: permission,
        currentUserUid: "self", displayUserName: "Player",
      };
      const allowed = ["owner", "admin", "staff", "captain"].includes(role) ||
        (["member", "guardian"].includes(role) && permission);
      for (const uid of ["self", "other"]) {
        for (const status of ["shared", "private"]) {
          const tag = { uid, user: "Player", status };
          const visible = uid === "self" || status === "shared";
          assert.equal(canViewRecordedTag(tag, viewer), visible);
          assert.equal(canEditRecordedTag(tag, viewer), allowed && visible);
        }
      }
    });
  }
}

test("UID takes precedence over names and survives name changes", () => {
  const viewer = { currentUserUid: "self", displayUserName: "New name" };
  assert.equal(isRecordedTagOwner({ uid: "self", user: "Old name" }, viewer), true);
  assert.equal(isRecordedTagOwner({ uid: "other", user: "New name" }, viewer), false);
  assert.equal(isRecordedTagOwner({ uid: "other", user: "New name" }, {
    displayUserName: "New name",
  }), false);
});

test("legacy tags without a UID use nonempty display names", () => {
  const viewer = { currentUserUid: "self", displayUserName: "Player" };
  assert.equal(isRecordedTagOwner({ user: "Player" }, viewer), true);
  assert.equal(isRecordedTagOwner({ uid: "", user: "Player" }, viewer), true);
  assert.equal(isRecordedTagOwner({ user: "Other" }, viewer), false);
  assert.equal(isRecordedTagOwner({}, {}), false);
});

test("missing or nonpublic foreign tags cannot be edited, even by managers", () => {
  const viewer = { userRole: "owner", currentUserUid: "self", displayUserName: "Player" };
  for (const tag of [null, undefined, {}, { uid: "other" }, { uid: "other", status: "deleted" }]) {
    assert.equal(canViewRecordedTag(tag, viewer), false);
    assert.equal(canEditRecordedTag(tag, viewer), false);
  }
});

test("permission checks preserve creator data", () => {
  const tag = Object.freeze({ uid: "other", user: "Original author", status: "shared" });
  const viewer = { userRole: "captain", currentUserUid: "self", displayUserName: "Player" };
  assert.equal(canEditRecordedTag(tag, viewer), true);
  assert.deepEqual(tag, { uid: "other", user: "Original author", status: "shared" });
});
