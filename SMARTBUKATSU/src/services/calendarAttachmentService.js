import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { storage } from "../firebase";

export const MAX_CALENDAR_ATTACHMENTS_PER_DATE = 3;
export const MAX_CALENDAR_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const CALENDAR_IMAGE_MAX_DIMENSION = 1600;
export const CALENDAR_IMAGE_COMPRESSION = 0.7;

const getBlobFromUri = (uri) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new TypeError("添付ファイルを読み込めませんでした。"));
    xhr.responseType = "blob";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });

const getFileStem = (name = "image") => {
  const trimmedName = String(name || "image").trim();
  const lastDotIndex = trimmedName.lastIndexOf(".");
  return lastDotIndex > 0 ? trimmedName.slice(0, lastDotIndex) : trimmedName;
};

const createAttachmentId = () =>
  `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const assertStoragePathSegment = (value, label) => {
  const segment = String(value || "").trim();
  if (!segment || segment.includes("/")) {
    throw new Error(`${label}が不正です。`);
  }
  return segment;
};

export const getCalendarAttachmentExpiryIso = (uploadedAt = new Date()) => {
  const source = uploadedAt instanceof Date ? new Date(uploadedAt) : new Date(uploadedAt);
  if (Number.isNaN(source.getTime())) {
    throw new Error("アップロード日時が不正です。");
  }

  const expiresAt = new Date(source);
  const originalDay = expiresAt.getUTCDate();
  expiresAt.setUTCDate(1);
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 3);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth() + 1, 0),
  ).getUTCDate();
  expiresAt.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return expiresAt.toISOString();
};

export const isCalendarAttachmentExpired = (attachment, now = Date.now()) => {
  const expiresAt = Date.parse(attachment?.expiresAt || "");
  return Number.isFinite(expiresAt) && expiresAt <= now;
};

export const getActiveCalendarAttachments = (event, eventDate, now = Date.now()) => {
  const attachments = event?.attachmentsByDate?.[eventDate];
  if (!Array.isArray(attachments)) return [];
  return attachments.filter(
    (attachment) => attachment?.downloadUrl && !isCalendarAttachmentExpired(attachment, now),
  );
};

export const prepareCalendarImageAttachment = async (asset) => {
  if (!asset?.uri) {
    throw new Error("写真を読み込めませんでした。");
  }

  const width = Number(asset.width) || 0;
  const height = Number(asset.height) || 0;
  const longestSide = Math.max(width, height);
  const actions = [];

  if (longestSide > CALENDAR_IMAGE_MAX_DIMENSION) {
    if (width >= height) {
      actions.push({ resize: { width: CALENDAR_IMAGE_MAX_DIMENSION } });
    } else {
      actions.push({ resize: { height: CALENDAR_IMAGE_MAX_DIMENSION } });
    }
  }

  const result = await manipulateAsync(asset.uri, actions, {
    compress: CALENDAR_IMAGE_COMPRESSION,
    format: SaveFormat.JPEG,
  });

  return {
    id: createAttachmentId(),
    localUri: result.uri,
    name: `${getFileStem(asset.fileName || "photo")}.jpg`,
    mimeType: "image/jpeg",
    type: "image",
    width: result.width,
    height: result.height,
    pending: true,
  };
};

export const prepareCalendarPdfAttachment = (asset) => {
  const isPdf =
    asset?.mimeType === "application/pdf" ||
    String(asset?.name || "").toLowerCase().endsWith(".pdf");
  if (!asset?.uri || !isPdf) {
    throw new Error("PDFファイルを選択してください。");
  }
  if (Number(asset.size) > MAX_CALENDAR_ATTACHMENT_BYTES) {
    throw new Error("PDFは1ファイル10MB以下にしてください。");
  }

  return {
    id: createAttachmentId(),
    localUri: asset.uri,
    name: asset.name || "document.pdf",
    mimeType: "application/pdf",
    type: "pdf",
    size: Number(asset.size) || null,
    pending: true,
  };
};

export const uploadCalendarAttachment = async ({
  teamId,
  eventId,
  eventDate,
  attachment,
  uploadedBy,
}) => {
  const safeTeamId = assertStoragePathSegment(teamId, "チームID");
  const safeEventId = assertStoragePathSegment(eventId, "予定ID");
  const safeEventDate = assertStoragePathSegment(eventDate, "予定日");
  const attachmentId = assertStoragePathSegment(
    attachment?.id || createAttachmentId(),
    "添付ID",
  );
  const extension = attachment?.type === "pdf" ? "pdf" : "jpg";
  const storagePath = [
    "calendarAttachments",
    safeTeamId,
    safeEventId,
    safeEventDate,
    `${attachmentId}.${extension}`,
  ].join("/");
  const uploadedAt = new Date().toISOString();
  const expiresAt = getCalendarAttachmentExpiryIso(uploadedAt);
  const blob = await getBlobFromUri(attachment.localUri);

  try {
    if (blob.size > MAX_CALENDAR_ATTACHMENT_BYTES) {
      throw new Error("添付ファイルは1ファイル10MB以下にしてください。");
    }

    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, blob, {
      contentType: attachment.mimeType,
      customMetadata: {
        teamId: safeTeamId,
        eventId: safeEventId,
        eventDate: safeEventDate,
        attachmentId,
        uploadedBy: String(uploadedBy || ""),
        uploadedAt,
        expiresAt,
        originalName: String(attachment.name || `${attachmentId}.${extension}`),
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
      uploadedBy: String(uploadedBy || ""),
    };
  } finally {
    if (typeof blob.close === "function") blob.close();
  }
};

export const deleteCalendarAttachment = async (storagePath) => {
  if (!storagePath) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (error) {
    if (error?.code !== "storage/object-not-found") throw error;
  }
};

export const deleteCalendarAttachments = async (attachments = []) => {
  await Promise.all(
    attachments.map((attachment) =>
      deleteCalendarAttachment(attachment?.storagePath),
    ),
  );
};
