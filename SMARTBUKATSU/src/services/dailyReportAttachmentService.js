import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import { storage } from "../firebase";
import {
  MAX_CALENDAR_ATTACHMENT_BYTES,
  prepareCalendarPdfAttachment,
} from "./calendarAttachmentService";

export const MAX_DAILY_REPORT_ATTACHMENTS = 2;
export const MAX_DAILY_REPORT_ATTACHMENT_BYTES =
  MAX_CALENDAR_ATTACHMENT_BYTES;
const DAILY_REPORT_IMAGE_MAX_DIMENSION = 1600;
const DAILY_REPORT_IMAGE_COMPRESSION = 0.7;

const getBlobFromUri = (uri) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () =>
      reject(new TypeError("添付ファイルを読み込めませんでした。"));
    xhr.responseType = "blob";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });

const createAttachmentId = () =>
  `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const getFileStem = (name = "image") => {
  const trimmedName = String(name || "image").trim();
  const lastDotIndex = trimmedName.lastIndexOf(".");
  return lastDotIndex > 0 ? trimmedName.slice(0, lastDotIndex) : trimmedName;
};

const assertStoragePathSegment = (value, label) => {
  const segment = String(value || "").trim();
  if (!segment || segment.includes("/")) {
    throw new Error(`${label}が不正です。`);
  }
  return segment;
};

export const prepareDailyReportImageAttachment = async (asset) => {
  if (!asset?.uri) {
    throw new Error("写真を読み込めませんでした。");
  }

  const width = Number(asset.width) || 0;
  const height = Number(asset.height) || 0;
  const longestSide = Math.max(width, height);
  const actions = [];

  if (longestSide > DAILY_REPORT_IMAGE_MAX_DIMENSION) {
    if (width >= height) {
      actions.push({ resize: { width: DAILY_REPORT_IMAGE_MAX_DIMENSION } });
    } else {
      actions.push({ resize: { height: DAILY_REPORT_IMAGE_MAX_DIMENSION } });
    }
  }

  const result = await manipulateAsync(asset.uri, actions, {
    compress: DAILY_REPORT_IMAGE_COMPRESSION,
    format: SaveFormat.JPEG,
  });
  const blob = await getBlobFromUri(result.uri);

  try {
    return {
      id: createAttachmentId(),
      localUri: result.uri,
      name: `${getFileStem(asset.fileName || "photo")}.jpg`,
      mimeType: "image/jpeg",
      type: "image",
      width: result.width,
      height: result.height,
      size: blob.size,
      pending: true,
    };
  } finally {
    if (typeof blob.close === "function") blob.close();
  }
};

export const prepareDailyReportPdfAttachment = prepareCalendarPdfAttachment;

export const getDailyReportAttachmentExpiryIso = (
  uploadedAt = new Date(),
) => {
  const source =
    uploadedAt instanceof Date ? new Date(uploadedAt) : new Date(uploadedAt);
  if (Number.isNaN(source.getTime())) {
    throw new Error("アップロード日時が不正です。");
  }

  const expiresAt = new Date(source);
  const originalDay = expiresAt.getUTCDate();
  expiresAt.setUTCDate(1);
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 12);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth() + 1, 0),
  ).getUTCDate();
  expiresAt.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return expiresAt.toISOString();
};

export const isDailyReportAttachmentExpired = (
  attachment,
  now = Date.now(),
) => {
  const expiresAt = Date.parse(attachment?.expiresAt || "");
  return Number.isFinite(expiresAt) && expiresAt <= now;
};

export const getActiveDailyReportAttachments = (
  report,
  now = Date.now(),
) => {
  const attachments = report?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.filter(
    (attachment) =>
      attachment?.pending ||
      (attachment?.downloadUrl &&
        !isDailyReportAttachmentExpired(attachment, now)),
  );
};

export const uploadDailyReportAttachment = async ({
  teamId,
  authorUid,
  reportId,
  attachment,
}) => {
  const safeTeamId = assertStoragePathSegment(teamId, "チームID");
  const safeAuthorUid = assertStoragePathSegment(authorUid, "投稿者UID");
  const safeReportId = assertStoragePathSegment(reportId, "振り返りID");
  const attachmentId = assertStoragePathSegment(
    attachment?.id || createAttachmentId(),
    "添付ID",
  );
  const extension = attachment?.type === "pdf" ? "pdf" : "jpg";
  const storagePath = [
    "dailyReportAttachments",
    safeTeamId,
    safeAuthorUid,
    safeReportId,
    `${attachmentId}.${extension}`,
  ].join("/");
  const uploadedAt = new Date().toISOString();
  const expiresAt = getDailyReportAttachmentExpiryIso(uploadedAt);
  const blob = await getBlobFromUri(attachment.localUri);

  try {
    if (blob.size > MAX_DAILY_REPORT_ATTACHMENT_BYTES) {
      throw new Error("添付ファイルは1ファイル10MB以下にしてください。");
    }

    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, blob, {
      contentType: attachment.mimeType,
      customMetadata: {
        teamId: safeTeamId,
        authorUid: safeAuthorUid,
        reportId: safeReportId,
        attachmentId,
        uploadedBy: safeAuthorUid,
        uploadedAt,
        expiresAt,
        originalName: String(
          attachment.name || `${attachmentId}.${extension}`,
        ),
        ...(attachment.type === "image"
          ? {
              processedWidth: String(attachment.width || ""),
              processedHeight: String(attachment.height || ""),
            }
          : {}),
      },
    });
    const downloadUrl = await getDownloadURL(storageRef);

    return {
      id: attachmentId,
      name: attachment.name || `${attachmentId}.${extension}`,
      mimeType: attachment.mimeType,
      type: attachment.type,
      size: blob.size,
      storagePath,
      downloadUrl,
      uploadedAt,
      expiresAt,
      uploadedBy: safeAuthorUid,
      ...(attachment.type === "image"
        ? {
            width: attachment.width || null,
            height: attachment.height || null,
          }
        : {}),
    };
  } finally {
    if (typeof blob.close === "function") blob.close();
  }
};

export const deleteDailyReportAttachment = async (storagePath) => {
  if (!storagePath) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (error) {
    if (error?.code !== "storage/object-not-found") throw error;
  }
};

export const deleteDailyReportAttachments = async (attachments = []) => {
  await Promise.all(
    attachments.map((attachment) =>
      deleteDailyReportAttachment(attachment?.storagePath),
    ),
  );
};
