import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { Calendar, LocaleConfig } from "react-native-calendars";
import { httpsCallable } from "firebase/functions";

import { useAuth } from "../AuthContext";
import { cloudFunctions } from "../firebase";
import {
  createClubEvent,
  updateClubEvent,
  removeClubEventAbsenceComment,
  deleteClubEvent,
  createPersonalEvent,
  updatePersonalEvent,
  deletePersonalEvent,
} from "../services/firestoreService";

const NativeMaps =
  Platform.OS === "web"
    ? { default: null, Marker: null }
    : require("react-native-maps");
const MapView = NativeMaps.default;
const Marker = NativeMaps.Marker;
const PROVIDER_GOOGLE = NativeMaps.PROVIDER_GOOGLE;

LocaleConfig.locales["ja"] = {
  monthNames: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
  monthNamesShort: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
  dayNames: [
    "日曜日",
    "月曜日",
    "火曜日",
    "水曜日",
    "木曜日",
    "金曜日",
    "土曜日",
  ],
  dayNamesShort: ["日", "月", "火", "水", "木", "金", "土"],
  today: "今日",
};
LocaleConfig.defaultLocale = "ja";

const COLORS = {
  primary: "#0077cc",
  secondary: "#f39c12",
  danger: "#e74c3c",
  success: "#2ecc71",
  background: "#f0f2f5",
  card: "#ffffff",
  textMain: "#333333",
  textSub: "#666666",
  border: "#eeeeee",
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);
const MINUTE_OPTIONS = [
  "00",
  "05",
  "10",
  "15",
  "20",
  "25",
  "30",
  "35",
  "40",
  "45",
  "50",
  "55",
];

const DEFAULT_LOCATION_COORDINATE = {
  latitude: 36.6953,
  longitude: 137.2137,
};

const DEFAULT_MAP_DELTA = {
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const isValidCoordinate = (latitude, longitude) => {
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined ||
    String(latitude).trim() === "" ||
    String(longitude).trim() === ""
  ) {
    return false;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

const buildGoogleMapsUrl = (latitude, longitude) =>
  `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;


const getLocationFromEvent = (event) => {
  if (!event) return null;
  if (event.location && typeof event.location === "object") {
    return event.location;
  }
  if (
    event.locationName ||
    event.locationAddress ||
    event.locationLatitude ||
    event.locationLongitude ||
    event.locationUrl
  ) {
    return {
      name: event.locationName || "",
      address: event.locationAddress || "",
      note: event.locationNote || "",
      latitude: event.locationLatitude,
      longitude: event.locationLongitude,
      url: event.locationUrl,
      source: event.locationSource || "legacy",
      manuallyAdjusted: !!event.locationManuallyAdjusted,
    };
  }
  return null;
};

const getLocationUrl = (location) => {
  if (!location || !isValidCoordinate(location.latitude, location.longitude)) {
    return "";
  }
  return buildGoogleMapsUrl(
    Number(location.latitude),
    Number(location.longitude),
  );
};

const normalizeDate = (dateStr) => {
  if (!dateStr) return "";
  if (dateStr.includes("/")) {
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    }
  }
  return dateStr;
};

const normalizeAbsenceCommentDate = (dateValue) => {
  if (!dateValue) return "";

  if (typeof dateValue === "string") {
    const normalized = normalizeDate(dateValue.trim());
    const datePrefix = /^(\d{4}-\d{2}-\d{2})/.exec(normalized);
    return datePrefix ? datePrefix[1] : normalized;
  }

  const date =
    dateValue instanceof Date
      ? dateValue
      : typeof dateValue?.toDate === "function"
        ? dateValue.toDate()
        : null;
  if (!date || Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getLocalDateStart = (dateStr) => {
  const normalized = normalizeDate(dateStr);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
};

const isAbsenceDeadlineReached = (dateStr, daysBefore) => {
  const eventDate = getLocalDateStart(dateStr);
  if (!eventDate) return false;

  const normalizedDays = Number(daysBefore);
  const safeDays =
    Number.isInteger(normalizedDays) &&
    normalizedDays >= 0 &&
    normalizedDays <= 365
      ? normalizedDays
      : 3;
  const deadline = new Date(eventDate);
  deadline.setDate(deadline.getDate() - safeDays);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today >= deadline;
};

const getDatesInRange = (startDate, endDate) => {
  const dates = [];
  let currentDate = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  while (currentDate <= end && count < 365) {
    dates.push(currentDate.toISOString().split("T")[0]);
    currentDate.setDate(currentDate.getDate() + 1);
    count++;
  }
  return dates;
};

const getUniqueSortedDates = (dates = []) =>
  Array.from(new Set(dates.map(normalizeDate).filter(Boolean))).sort();

const getEventDates = (event) => {
  const explicitDates = getUniqueSortedDates(event?.selectedDates || []);
  if (explicitDates.length > 0) return explicitDates;

  const start = normalizeDate(event?.date);
  if (!start) return [];
  const end = event?.endDate ? normalizeDate(event.endDate) : start;
  return getDatesInRange(start, end);
};

const getClubScheduleForDate = (event, date) => {
  const schedule = event?.timeSchedules?.[date];
  const isAllDay = schedule?.isAllDay ?? event?.isAllDay ?? false;
  return {
    start: isAllDay ? "" : schedule?.start || event?.startTime || "09:00",
    end: isAllDay ? "" : schedule?.end || event?.endTime || "12:00",
    isAllDay,
  };
};

const getDefaultClubSchedule = () => ({
  start: "09:00",
  end: "12:00",
  isAllDay: false,
});

const getDateLabel = (date) => date.substring(5).replace("-", "/");

const getMinutesFromTime = (time) => {
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return Math.max(0, Math.min(23 * 60 + 55, hour * 60 + minute));
};

const formatMinutesAsTime = (minutes) => {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 55, minutes));
  const hour = String(Math.floor(safeMinutes / 60)).padStart(2, "0");
  const minute = String(safeMinutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
};

const getTimeAtOrAfter = (time, minTime) =>
  getMinutesFromTime(time) < getMinutesFromTime(minTime) ? minTime : time;

const getAdjustedEndTime = (startTime, endTime) => {
  if (getMinutesFromTime(endTime) > getMinutesFromTime(startTime)) {
    return endTime;
  }
  return formatMinutesAsTime(getMinutesFromTime(startTime) + 60);
};

const getScheduleColor = (schedule) => {
  if (schedule?.isAllDay) return COLORS.primary;
  const hour = Number(String(schedule?.start || "00:00").split(":")[0]);
  return Number.isFinite(hour) && hour >= 12 ? COLORS.danger : COLORS.primary;
};

const getPersonalScheduleForDate = (event, date) => {
  const schedule = event?.timeSchedules?.[date];
  const isAllDay = schedule?.isAllDay ?? event?.isAllDay ?? false;
  return {
    start: isAllDay ? "" : schedule?.start || event?.startTime || "18:00",
    end: isAllDay ? "" : schedule?.end || event?.endTime || "19:00",
    isAllDay,
  };
};

const TimePickerOverlay = ({
  onClose,
  onSelect,
  currentHour,
  currentMin,
  title,
  minTime = "",
}) => {
  const minMinutes = minTime ? getMinutesFromTime(minTime) : null;
  return (
  <View
    style={[
      StyleSheet.absoluteFill,
      {
        backgroundColor: "rgba(0,0,0,0.6)",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      },
    ]}
  >
    <View style={styles.timePickerContent}>
      <Text style={styles.timePickerTitle}>{title}</Text>
      <View style={styles.timePickerRow}>
        <ScrollView
          style={styles.timeScroll}
          showsVerticalScrollIndicator={false}
        >
          {HOUR_OPTIONS.map((h) => {
            const hourDisabled =
              minMinutes !== null && Number(h) * 60 + 55 < minMinutes;
            return (
            <TouchableOpacity
              key={h}
              disabled={hourDisabled}
              onPress={() => onSelect(h, currentMin)}
              style={[
                styles.timeOption,
                currentHour === h && styles.timeOptionActive,
                hourDisabled && styles.timeOptionDisabled,
              ]}
            >
              <Text
                style={[
                  styles.timeOptionText,
                  currentHour === h && styles.timeOptionTextActive,
                  hourDisabled && styles.timeOptionTextDisabled,
                ]}
              >
                {h}時
              </Text>
            </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Text style={styles.timeSeparator}>:</Text>
        <ScrollView
          style={styles.timeScroll}
          showsVerticalScrollIndicator={false}
        >
          {MINUTE_OPTIONS.map((m) => {
            const minuteDisabled =
              minMinutes !== null &&
              getMinutesFromTime(`${currentHour}:${m}`) < minMinutes;
            return (
            <TouchableOpacity
              key={m}
              disabled={minuteDisabled}
              onPress={() => onSelect(currentHour, m)}
              style={[
                styles.timeOption,
                currentMin === m && styles.timeOptionActive,
                minuteDisabled && styles.timeOptionDisabled,
              ]}
            >
              <Text
                style={[
                  styles.timeOptionText,
                  currentMin === m && styles.timeOptionTextActive,
                  minuteDisabled && styles.timeOptionTextDisabled,
                ]}
              >
                {m}分
              </Text>
            </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <TouchableOpacity style={styles.timePickerCloseBtn} onPress={onClose}>
        <Text style={styles.timePickerCloseText}>決定</Text>
      </TouchableOpacity>
    </View>
  </View>
  );
};

const CalendarScreen = ({
  navigation,
  isAdmin,
  currentUser,
  currentUserUid = "",
  clubEvents = [],
  dailyReports = [],
  personalEvents = [],
  userProfiles = {},
  isOffline = false,
  absenceDeadlineDaysBefore = 3,
}) => {
  const { activeTeamId, user, role: authUserRole } = useAuth();

  const currentUserProfile =
    Object.values(userProfiles).find(
      (profile) => profile?.uid === currentUserUid,
    ) || {};
  const resolvedUserRole =
    global.TEST_ROLE ||
    authUserRole ||
    currentUserProfile.role ||
    (isAdmin ? "owner" : "");
  const userRole = resolvedUserRole || "member";

  const canManageClubEvents = ["owner", "admin", "staff", "captain"].includes(
    userRole,
  );
  const canSubmitAbsence =
    Boolean(resolvedUserRole) && userRole !== "guardian";
  const configuredAbsenceDeadlineDays = Number(absenceDeadlineDaysBefore);
  const safeAbsenceDeadlineDays =
    Number.isInteger(configuredAbsenceDeadlineDays) &&
    configuredAbsenceDeadlineDays >= 0 &&
    configuredAbsenceDeadlineDays <= 365
      ? configuredAbsenceDeadlineDays
      : 3;

  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0],
  );

  const [isClubModalVisible, setIsClubModalVisible] = useState(false);
  const [isPersonalModalVisible, setIsPersonalModalVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // === 部活の予定ステート ===
  const [editingClubEventId, setEditingClubEventId] = useState(null);
  const [editingClubEventSplit, setEditingClubEventSplit] = useState(null);
  const [clubEventTitle, setClubEventTitle] = useState("");
  const [clubEventDescription, setClubEventDescription] = useState("");
  const [clubEventType, setClubEventType] = useState("練習");
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [clubSelectedDates, setClubSelectedDates] = useState([]);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [clubStartTime, setClubStartTime] = useState("09:00");
  const [clubEndTime, setClubEndTime] = useState("12:00");
  const [isClubAllDay, setIsClubAllDay] = useState(false);
  const [clubTimeSchedules, setClubTimeSchedules] = useState({});
  const [clubLocationName, setClubLocationName] = useState("");
  const [clubLocationAddress, setClubLocationAddress] = useState("");
  const [clubLocationNote, setClubLocationNote] = useState("");
  const [clubLocationPlaceId, setClubLocationPlaceId] = useState("");
  const [clubLocationSource, setClubLocationSource] = useState("manual_pin");
  const [clubLocationLatitude, setClubLocationLatitude] = useState(null);
  const [clubLocationLongitude, setClubLocationLongitude] = useState(null);
  const [clubLocationManuallyAdjusted, setClubLocationManuallyAdjusted] =
    useState(false);
  const [isClubLocationDetailsEnabled, setIsClubLocationDetailsEnabled] =
    useState(false);
  const [isLocationMapVisible, setIsLocationMapVisible] = useState(false);
  const [isLocationGeocoding, setIsLocationGeocoding] = useState(false);
  const [mapDraftCoordinate, setMapDraftCoordinate] = useState(
    DEFAULT_LOCATION_COORDINATE,
  );
  const [selectedAbsenceEvent, setSelectedAbsenceEvent] = useState(null);
  const [absenceModalMode, setAbsenceModalMode] = useState(null);
  const [absenceCommentText, setAbsenceCommentText] = useState("");

  // === 個人の予定ステート ===
  const [editingPersonalEventId, setEditingPersonalEventId] = useState(null);
  const [personalEventTitle, setPersonalEventTitle] = useState("");
  const [personalEventDescription, setPersonalEventDescription] = useState("");
  const [isPersonalMultiDay, setIsPersonalMultiDay] = useState(false);
  const [personalEndDate, setPersonalEndDate] = useState("");
  const [showPersonalEndDatePicker, setShowPersonalEndDatePicker] =
    useState(false);
  const [personalStartTime, setPersonalStartTime] = useState("18:00");
  const [personalEndTime, setPersonalEndTime] = useState("19:00");
  const [isPersonalAllDay, setIsPersonalAllDay] = useState(false);
  const [personalTimeSchedules, setPersonalTimeSchedules] = useState({});

  const [viewingReport, setViewingReport] = useState(null);

  const [isTimePickerVisible, setIsTimePickerVisible] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState("");

  const calendarDayIndicators = useMemo(() => {
    const indicators = {};
    const addIndicator = (dateStr, key, color) => {
      const normDate = normalizeDate(dateStr);
      if (!normDate) return;
      if (!indicators[normDate]) indicators[normDate] = [];
      if (!indicators[normDate].some((item) => item.key === key)) {
        indicators[normDate].push({ key, color });
      }
    };

    clubEvents.forEach((event) => {
      if (event.status === "deleted") return;
      const isPending = event.status === "pending";
      getEventDates(event).forEach((date) => {
        addIndicator(
          date,
          `club-${event.id}-${date}`,
          getScheduleColor(getClubScheduleForDate(event, date), isPending),
        );
      });
    });

    personalEvents.forEach((event) => {
      if (event.status === "deleted") return;
      const start = normalizeDate(event.date);
      const end = event.endDate ? normalizeDate(event.endDate) : start;
      getDatesInRange(start, end).forEach((date) => {
        addIndicator(
          date,
          `personal-${event.id}-${date}`,
          getScheduleColor(
            getPersonalScheduleForDate(event, date),
            event.status === "pending",
          ),
        );
      });
    });

    dailyReports.forEach((report) => {
      if (report.author === currentUser && report.status !== "deleted") {
        addIndicator(report.date, `report-${report.id}`, COLORS.secondary);
      }
    });

    return indicators;
  }, [clubEvents, personalEvents, dailyReports, currentUser]);

  const dailyClubEvents = clubEvents.filter((p) => {
    if (p.status === "deleted") return false;
    return getEventDates(p).includes(selectedDate);
  });

  const dailyPersonalEvents = personalEvents.filter((pe) => {
    if (pe.status === "deleted") return false;
    const start = normalizeDate(pe.date);
    const end = pe.endDate ? normalizeDate(pe.endDate) : start;
    return selectedDate >= start && selectedDate <= end;
  });

  const dailyMyReports = dailyReports.filter(
    (r) =>
      normalizeDate(r.date) === selectedDate &&
      r.author === currentUser &&
      r.status !== "deleted",
  );

  const renderCalendarDay = ({ date, state }) => {
    const dateString = date?.dateString;
    const indicators = calendarDayIndicators[dateString] || [];
    const isSelected = dateString === selectedDate;
    const isDisabled = state === "disabled";
    const isToday = dateString === new Date().toISOString().split("T")[0];
    const dayTextStyle = [
      styles.calendarDayText,
      isToday && styles.calendarDayTodayText,
      isSelected && styles.calendarDaySelectedText,
      isDisabled && styles.calendarDayDisabledText,
    ];

    return (
      <TouchableOpacity
        style={[
          styles.calendarDayCell,
          isSelected && styles.calendarDayCellSelected,
        ]}
        onPress={() => !isDisabled && setSelectedDate(dateString)}
        disabled={isDisabled}
        activeOpacity={0.75}
      >
        <Text style={dayTextStyle}>{date?.day}</Text>
        {indicators.length >= 3 ? (
          <View style={styles.calendarCountBadge}>
            <Text style={styles.calendarCountText}>{indicators.length}</Text>
          </View>
        ) : indicators.length > 0 ? (
          <View style={styles.calendarDotRow}>
            {indicators.map((indicator) => (
              <View
                key={indicator.key}
                style={[
                  styles.calendarTimeDot,
                  { backgroundColor: indicator.color },
                ]}
              />
            ))}
          </View>
        ) : (
          <View style={styles.calendarEmptyMarker} />
        )}
      </TouchableOpacity>
    );
  };

  const recentClubLocations = useMemo(() => {
    const seen = new Set();
    const locations = [];
    clubEvents.forEach((event) => {
      const location = getLocationFromEvent(event);
      if (!location || !isValidCoordinate(location.latitude, location.longitude)) {
        return;
      }
      const key = [
        location.name || "",
        location.address || "",
        Number(location.latitude).toFixed(6),
        Number(location.longitude).toFixed(6),
      ].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      locations.push(location);
    });
    return locations.slice(0, 5);
  }, [clubEvents]);

  const sortedClubSelectedDates = useMemo(
    () =>
      getUniqueSortedDates(clubSelectedDates.length ? clubSelectedDates : [selectedDate]),
    [clubSelectedDates, selectedDate],
  );

  const clubSelectionMarkedDates = useMemo(() => {
    const marks = {};
    sortedClubSelectedDates.forEach((date) => {
      marks[date] = {
        selected: true,
        selectedColor: COLORS.primary,
        selectedTextColor: "#ffffff",
      };
    });
    return marks;
  }, [sortedClubSelectedDates]);

  const getClubEventDateSummary = (event) => {
    const eventDates = getEventDates(event);
    if (!event.isMultiDay || eventDates.length <= 1) return "";
    if (Array.isArray(event.selectedDates) && event.selectedDates.length > 0) {
      return "";
    }
    return `(期間: ${event.date.replace(/-/g, "/")} 〜 ${event.endDate.replace(/-/g, "/")})`;
  };

  const toggleClubSelectedDate = (dateString) => {
    setClubSelectedDates((prev) => {
      const current = getUniqueSortedDates(prev.length ? prev : [selectedDate]);
      if (current.includes(dateString)) {
        return current.length === 1
          ? current
          : current.filter((date) => date !== dateString);
      }
      return getUniqueSortedDates([...current, dateString]);
    });
  };

  const activeAbsenceEvent = selectedAbsenceEvent
    ? clubEvents.find((event) => event.id === selectedAbsenceEvent.id) ||
      selectedAbsenceEvent
    : null;

  const getAbsenceComments = (event) =>
    Array.isArray(event?.absenceComments) ? event.absenceComments : [];

  const isActiveAbsenceDeadlineReached = isAbsenceDeadlineReached(
    selectedDate,
    safeAbsenceDeadlineDays,
  );

  const canCancelAbsenceComment = (comment) =>
    !!user?.uid && comment?.uid === user.uid;

  const getAbsenceCommentsOutsideDate = (event, date) => {
    const normalizedDate = normalizeAbsenceCommentDate(date);
    return getAbsenceComments(event).filter(
      (comment) =>
        normalizeAbsenceCommentDate(comment?.date) !== normalizedDate,
    );
  };

  const getAbsenceCommentsForDate = (event, date) => {
    const comments = getAbsenceComments(event);
    if (getEventDates(event).length <= 1) return comments;

    const normalizedDate = normalizeAbsenceCommentDate(date);
    return comments.filter(
      (comment) =>
        normalizeAbsenceCommentDate(comment?.date) === normalizedDate,
    );
  };

  const activeAbsenceComments = getAbsenceCommentsForDate(
    activeAbsenceEvent,
    selectedDate,
  );
  const activeOwnAbsenceComments = activeAbsenceComments.filter(
    canCancelAbsenceComment,
  );

  const buildRemainingClubEventData = (event, removedDate) => {
    const remainingDates = getEventDates(event).filter(
      (date) => date !== removedDate,
    );
    if (remainingDates.length === 0) return null;

    const firstDate = remainingDates[0];
    const lastDate = remainingDates[remainingDates.length - 1];
    const firstSchedule = getClubScheduleForDate(event, firstDate);
    const remainingComments = getAbsenceCommentsOutsideDate(event, removedDate);

    if (remainingDates.length === 1) {
      return {
        date: firstDate,
        endDate: firstDate,
        selectedDates: null,
        isMultiDay: false,
        isAllDay: firstSchedule.isAllDay,
        startTime: firstSchedule.start,
        endTime: firstSchedule.end,
        timeSchedules: null,
        absenceComments: remainingComments,
      };
    }

    const hasTimeSchedules =
      event?.timeSchedules && typeof event.timeSchedules === "object";
    const remainingSchedules = hasTimeSchedules
      ? remainingDates.reduce((nextSchedules, date) => {
          if (event.timeSchedules[date]) {
            nextSchedules[date] = event.timeSchedules[date];
          }
          return nextSchedules;
        }, {})
      : null;

    return {
      date: firstDate,
      endDate: lastDate,
      selectedDates: remainingDates,
      isMultiDay: true,
      isAllDay: event?.isAllDay ?? false,
      startTime: event?.startTime || "09:00",
      endTime: event?.endTime || "12:00",
      timeSchedules: remainingSchedules,
      absenceComments: remainingComments,
    };
  };

  const hasClubLocationDraft = () =>
    !!(
      clubLocationName.trim() ||
      clubLocationAddress.trim() ||
      clubLocationNote.trim() ||
      clubLocationLatitude !== null ||
      clubLocationLongitude !== null
    );

  const getClubLocationDraft = () => {
    if (!hasClubLocationDraft()) return null;
    const hasCoordinate = isValidCoordinate(
      clubLocationLatitude,
      clubLocationLongitude,
    );
    const latitude = hasCoordinate ? Number(clubLocationLatitude) : null;
    const longitude = hasCoordinate ? Number(clubLocationLongitude) : null;
    return {
      name: clubLocationName.trim(),
      address: clubLocationAddress.trim(),
      latitude,
      longitude,
      placeId: clubLocationPlaceId,
      note: clubLocationNote.trim(),
      source: clubLocationManuallyAdjusted ? "manual_pin" : clubLocationSource,
      manuallyAdjusted: clubLocationManuallyAdjusted,
      updatedAt: new Date().toISOString(),
    };
  };

  const applyClubLocation = (location) => {
    if (!location) return;
    const locationName = location.name || location.address || "";
    setClubLocationName(locationName);
    setClubLocationAddress(location.name ? location.address || "" : "");
    setClubLocationNote(location.note || "");
    setClubLocationPlaceId(location.placeId || "");
    setClubLocationSource(location.source || "manual_pin");
    if (isValidCoordinate(location.latitude, location.longitude)) {
      setClubLocationLatitude(Number(location.latitude));
      setClubLocationLongitude(Number(location.longitude));
      setMapDraftCoordinate({
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
      });
    } else {
      setClubLocationLatitude(null);
      setClubLocationLongitude(null);
    }
    setClubLocationManuallyAdjusted(!!location.manuallyAdjusted);
  };

  const clearClubLocationCoordinate = () => {
    setClubLocationLatitude(null);
    setClubLocationLongitude(null);
    setClubLocationManuallyAdjusted(false);
    setClubLocationPlaceId("");
    setClubLocationSource("manual_pin");
    setMapDraftCoordinate(DEFAULT_LOCATION_COORDINATE);
  };

  const handleClubLocationNameChange = (text) => {
    setClubLocationName(text);
    setClubLocationAddress("");
    clearClubLocationCoordinate();
  };

  const clearClubLocation = () => {
    setClubLocationName("");
    setClubLocationAddress("");
    setClubLocationNote("");
    clearClubLocationCoordinate();
  };

  const normalizeLocationSearchText = (value) =>
    value.trim().replace(/\s+/g, " ");

  const getClubLocationSearchText = () =>
    normalizeLocationSearchText(
      [clubLocationName, clubLocationAddress]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" "),
    );

  const getClubLocationSearchQueries = () => {
    const searchText = getClubLocationSearchText();
    if (!searchText) return [];

    const queries = [searchText];
    if (Platform.OS === "ios") {
      const japanHintQuery = `${searchText} 日本`;
      if (!queries.includes(japanHintQuery)) queries.push(japanHintQuery);
    }
    return queries;
  };

  const getManualFallbackCoordinate = () => {
    if (isValidCoordinate(clubLocationLatitude, clubLocationLongitude)) {
      return {
        latitude: Number(clubLocationLatitude),
        longitude: Number(clubLocationLongitude),
      };
    }
    if (isValidCoordinate(mapDraftCoordinate.latitude, mapDraftCoordinate.longitude)) {
      return mapDraftCoordinate;
    }
    return DEFAULT_LOCATION_COORDINATE;
  };

  const openManualLocationMap = () => {
    setMapDraftCoordinate(getManualFallbackCoordinate());
    setIsLocationMapVisible(true);
  };

  const applyResolvedClubLocation = ({
    latitude,
    longitude,
    source,
    placeId = "",
    name = "",
    address = "",
  }) => {
    const coordinate = {
      latitude: Number(latitude),
      longitude: Number(longitude),
    };
    setClubLocationLatitude(coordinate.latitude);
    setClubLocationLongitude(coordinate.longitude);
    setClubLocationManuallyAdjusted(false);
    setClubLocationPlaceId(placeId || "");
    setClubLocationSource(source || "device_geocode");
    setMapDraftCoordinate(coordinate);
    if (!clubLocationName.trim() && name) {
      setClubLocationName(name);
    }
    if (address) {
      setClubLocationAddress(address);
    }
    return coordinate;
  };

  const searchGooglePlaceLocation = async (query) => {
    try {
      const searchPlaceLocation = httpsCallable(cloudFunctions, "searchPlaceLocation");
      const response = await searchPlaceLocation({ query });
      const place = response.data?.place;
      if (
        !response.data?.found ||
        !place ||
        !isValidCoordinate(place.latitude, place.longitude)
      ) {
        return null;
      }
      return place;
    } catch {
      return null;
    }
  };

  const ensureGeocodingPermission = async () => {
    if (Platform.OS === "web") {
      Alert.alert(
        "地図検索は未対応です",
        "住所から座標を取得する機能はAndroid/iOSアプリで利用できます。",
      );
      return false;
    }
    if (Platform.OS !== "android") return true;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === "granted") return true;

    Alert.alert(
      "位置情報の許可が必要です",
      "Androidでは場所名から座標を取得するために位置情報の許可が必要です。",
    );
    return false;
  };

  const geocodeClubLocation = async ({ openMapAfterSearch = false } = {}) => {
    const searchText = getClubLocationSearchText();
    if (!searchText) {
      Alert.alert(
        "場所を入力してください",
        "場所を入力してから座標を取得してください。",
      );
      return null;
    }

    const hasPermission = await ensureGeocodingPermission();
    if (!hasPermission) return null;

    const applyGooglePlace = (googlePlace) => {
      const coordinate = applyResolvedClubLocation({
        latitude: googlePlace.latitude,
        longitude: googlePlace.longitude,
        source: googlePlace.source || "google_places_text_search",
        placeId: googlePlace.placeId || "",
        name: googlePlace.name || "",
        address: googlePlace.address || "",
      });
      if (openMapAfterSearch) {
        setIsLocationMapVisible(true);
      } else {
        Alert.alert(
          "座標を取得しました",
          "Googleの場所検索で座標を取得しました。地図でピンを調整すると、集合場所をさらに正確にできます。",
        );
      }
      return coordinate;
    };

    const applyDeviceResult = (result) => {
      const coordinate = applyResolvedClubLocation({
        latitude: result.latitude,
        longitude: result.longitude,
        source: "device_geocode",
      });
      if (openMapAfterSearch) {
        setIsLocationMapVisible(true);
      } else {
        Alert.alert(
          "座標を取得しました",
          "地図でピンを調整すると、集合場所をさらに正確にできます。",
        );
      }
      return coordinate;
    };

    setIsLocationGeocoding(true);
    try {
      if (Platform.OS === "ios") {
        const googlePlace = await searchGooglePlaceLocation(searchText);
        if (googlePlace) return applyGooglePlace(googlePlace);
      }

      let result = null;
      const queries = getClubLocationSearchQueries();
      for (const query of queries) {
        const results = await Location.geocodeAsync(query);
        result = (Array.isArray(results) ? results : []).find((item) =>
          isValidCoordinate(item.latitude, item.longitude),
        );
        if (result) break;
      }

      if (result) return applyDeviceResult(result);

      if (Platform.OS !== "ios") {
        const googlePlace = await searchGooglePlaceLocation(searchText);
        if (googlePlace) return applyGooglePlace(googlePlace);
      }

      if (openMapAfterSearch) {
        openManualLocationMap();
        Alert.alert(
          "場所が見つかりません",
          "検索では見つからなかったため、地図上で手動でピンを調整してください。",
        );
      } else {
        Alert.alert(
          "場所が見つかりません",
          "入力内容を少し具体的にして、もう一度お試しください。地図でピンを調整する場合は、手動で位置を指定できます。",
        );
      }
      return null;
    } catch (error) {
      if (Platform.OS !== "ios") {
        const googlePlace = await searchGooglePlaceLocation(searchText);
        if (googlePlace) return applyGooglePlace(googlePlace);
      }

      if (openMapAfterSearch) {
        openManualLocationMap();
        Alert.alert(
          "場所を検索できません",
          "検索に失敗したため、地図上で手動でピンを調整してください。",
        );
      } else {
        Alert.alert(
          "場所を検索できません",
          "通信状況や入力内容を確認して、もう一度お試しください。",
        );
      }
      return null;
    } finally {
      setIsLocationGeocoding(false);
    }
  };
  const openLocationMap = async () => {
    if (isLocationGeocoding) return;
    if (isValidCoordinate(clubLocationLatitude, clubLocationLongitude)) {
      setMapDraftCoordinate({
        latitude: Number(clubLocationLatitude),
        longitude: Number(clubLocationLongitude),
      });
      setIsLocationMapVisible(true);
      return;
    }

    if (getClubLocationSearchText()) {
      await geocodeClubLocation({ openMapAfterSearch: true });
      return;
    }

    openManualLocationMap();
  };

  const confirmLocationPin = () => {
    setClubLocationLatitude(mapDraftCoordinate.latitude);
    setClubLocationLongitude(mapDraftCoordinate.longitude);
    setClubLocationManuallyAdjusted(true);
    setIsLocationMapVisible(false);
  };

  const buildLocationShareMessage = (event) => {
    const location = getLocationFromEvent(event);
    if (!location) return "";
    const lines = ["【活動場所】"];
    const title = event.title || event.name;
    if (title) lines.push(`活動名：${title}`);
    lines.push(`日時：${selectedDate} ${getDisplayTime(event, selectedDate)}`);
    if (location.name) lines.push(`場所：${location.name}`);
    if (location.address) lines.push(`住所：${location.address}`);
    if (location.note) lines.push(`補足：${location.note}`);
    const url = getLocationUrl(location);
    if (url) lines.push("Googleマップで確認", url);
    return lines.filter(Boolean).join("\n");
  };

  const shareEventLocation = async (event) => {
    const message = buildLocationShareMessage(event);
    if (!message) {
      Alert.alert("地図情報なし", "この予定には共有できる場所情報がありません。");
      return;
    }
    try {
      await Share.share({ message });
    } catch (error) {
      Alert.alert("共有できません", "場所情報を共有できませんでした。");
    }
  };

  useEffect(() => {
    if (!isOffline) {
      const hasPendingEvents =
        clubEvents.some((p) => p.status === "pending") ||
        personalEvents.some((pe) => pe.status === "pending");
      if (hasPendingEvents) {
        setIsLoading(true);
        setTimeout(() => {
          setIsLoading(false);
          Alert.alert(
            "📶 通信復旧",
            "待機していたカレンダーの予定を同期しました！",
          );
        }, 1500);
      }
    }
  }, [isOffline]);

  const getDisplayTime = (item, targetDate) => {
    if (
      item.isMultiDay &&
      item.timeSchedules &&
      item.timeSchedules[targetDate]
    ) {
      const sched = item.timeSchedules[targetDate];
      if (sched.isAllDay) return "⏰ 終日";
      return `⏰ ${sched.start} 〜 ${sched.end}`;
    }
    if (item.isAllDay) return "⏰ 終日";
    return `⏰ ${item.startTime || "00:00"} 〜 ${item.endTime || "00:00"}`;
  };

  const handleSaveClubEvent = async () => {
    const eventTitle = clubEventType;

    const locationDraft = getClubLocationDraft();
    if (locationDraft) {
      const hasLocationText = !!(
        locationDraft.name ||
        locationDraft.address ||
        locationDraft.note
      );
      const hasLocationCoordinate = isValidCoordinate(
        locationDraft.latitude,
        locationDraft.longitude,
      );
      if (!hasLocationText && !hasLocationCoordinate) {
        return Alert.alert("場所情報エラー", "場所を入力してください。");
      }
    }

    const saveEventDate = editingClubEventSplit?.date || selectedDate;
    const eventDates = getUniqueSortedDates(
      isMultiDay
        ? sortedClubSelectedDates.length
          ? sortedClubSelectedDates
          : [saveEventDate]
        : [saveEventDate],
    );
    if (isMultiDay && eventDates.length === 0) {
      return Alert.alert("エラー", "予定日を1日以上選択してください");
    }

    const firstEventDate = eventDates[0] || saveEventDate;
    const lastEventDate = eventDates[eventDates.length - 1] || firstEventDate;

    const editingClubEvent = editingClubEventId
      ? clubEvents.find((event) => event.id === editingClubEventId)
      : null;
    const splitEditDate = saveEventDate;

    setIsLoading(true);

    setTimeout(async () => {
      const schedules = {};
      if (isMultiDay) {
        const commonSchedule = {
          start: isClubAllDay ? "" : clubStartTime,
          end: isClubAllDay ? "" : clubEndTime,
          isAllDay: isClubAllDay,
        };
        eventDates.forEach((d) => {
          schedules[d] = commonSchedule;
        });
      }

      const eventData = {
        title: eventTitle,
        name: eventTitle,
        description: clubEventDescription.trim(),
        type: clubEventType,
        date: isMultiDay ? firstEventDate : saveEventDate,
        endDate: isMultiDay ? lastEventDate : saveEventDate,
        selectedDates: isMultiDay ? eventDates : null,
        isMultiDay,
        isAllDay: isClubAllDay,
        startTime: isClubAllDay ? "" : clubStartTime,
        endTime: isClubAllDay ? "" : clubEndTime,
        timeSchedules: isMultiDay ? schedules : null,
        location: locationDraft,
        participants: "team",
        status: isOffline ? "pending" : "active",
        createdBy: user?.uid || "local_user",
        absenceComments: editingClubEventSplit
          ? getAbsenceCommentsForDate(editingClubEvent, splitEditDate)
          : editingClubEventId
            ? getAbsenceComments(editingClubEvent)
            : [],
        ...(editingClubEventSplit
          ? {
              splitFromEventId: editingClubEventSplit.sourceEventId,
              splitFromDate: editingClubEventSplit.date,
            }
          : {}),
      };

      try {
        if (editingClubEventId) {
          if (!isOffline) {
            if (editingClubEventSplit && editingClubEvent) {
              const remainingEventData = buildRemainingClubEventData(
                editingClubEvent,
                splitEditDate,
              );
              await createClubEvent(activeTeamId, eventData);
              if (remainingEventData) {
                await updateClubEvent(
                  activeTeamId,
                  editingClubEventId,
                  remainingEventData,
                );
              } else {
                await deleteClubEvent(activeTeamId, editingClubEventId);
              }
            } else {
              await updateClubEvent(activeTeamId, editingClubEventId, eventData);
            }
          }
        } else {
          if (!isOffline) await createClubEvent(activeTeamId, eventData);
        }
        setIsClubModalVisible(false);
        resetClubForm();
      } catch (error) {
        Alert.alert("エラー", "保存に失敗しました。");
      } finally {
        setIsLoading(false);
      }
    }, 400);
  };

  const resetClubForm = () => {
    setEditingClubEventId(null);
    setEditingClubEventSplit(null);
    setClubEventTitle("");
    setClubEventDescription("");
    setClubEventType("練習");
    setIsMultiDay(false);
    setEndDate("");
    setClubSelectedDates([selectedDate]);
    setShowEndDatePicker(false);
    setClubStartTime("09:00");
    setClubEndTime("12:00");
    setIsClubAllDay(false);
    setClubTimeSchedules({});
    clearClubLocation();
    setIsClubLocationDetailsEnabled(false);
  };

  const openEditClubEvent = (event) => {
    setEditingClubEventId(event.id);
    setClubEventTitle(event.title || event.name);
    setClubEventDescription(event.description || "");
    setClubEventType(event.type || "練習");
    const eventDates = getEventDates(event);
    const targetDate = eventDates.includes(selectedDate)
      ? selectedDate
      : eventDates[0] || normalizeDate(event.date) || selectedDate;
    const editsSingleOccurrence = eventDates.length > 1;
    const schedule = getClubScheduleForDate(event, targetDate);
    setEditingClubEventSplit(
      editsSingleOccurrence
        ? { sourceEventId: event.id, date: targetDate }
        : null,
    );
    setIsMultiDay(editsSingleOccurrence ? false : event.isMultiDay || false);
    setEndDate(editsSingleOccurrence ? targetDate : event.endDate || event.date);
    setClubSelectedDates(editsSingleOccurrence ? [targetDate] : eventDates);
    setClubStartTime(schedule.start || "09:00");
    setClubEndTime(schedule.end || "12:00");
    setIsClubAllDay(schedule.isAllDay);
    setClubTimeSchedules(editsSingleOccurrence ? {} : event.timeSchedules || {});
    const location = getLocationFromEvent(event);
    if (location) {
      applyClubLocation(location);
      setIsClubLocationDetailsEnabled(
        !!location.note ||
          !!location.address ||
          isValidCoordinate(location.latitude, location.longitude),
      );
    } else {
      clearClubLocation();
      setIsClubLocationDetailsEnabled(false);
    }
    setIsClubModalVisible(true);
  };

  const handleDeleteClubEvent = (event, targetDate) => {
    Alert.alert("削除", "部活の予定を削除しますか？", [
      { text: "キャンセル" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          setIsLoading(true);
          try {
            if (!isOffline) {
              const remainingEventData = buildRemainingClubEventData(
                event,
                targetDate,
              );
              if (remainingEventData) {
                await updateClubEvent(
                  activeTeamId,
                  event.id,
                  remainingEventData,
                );
              } else {
                await deleteClubEvent(activeTeamId, event.id);
              }
            }
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  };

  const openAbsenceListModal = (event) => {
    setSelectedAbsenceEvent(event);
    setAbsenceModalMode("list");
    setAbsenceCommentText("");
  };

  const openAbsenceReportModal = (event) => {
    setSelectedAbsenceEvent(event);
    setAbsenceModalMode("report");
    setAbsenceCommentText("");
  };

  const closeAbsenceModal = () => {
    setSelectedAbsenceEvent(null);
    setAbsenceModalMode(null);
    setAbsenceCommentText("");
  };

  const handleSendAbsenceComment = async () => {
    if (!canSubmitAbsence) return;
    const text = absenceCommentText.trim();
    if (!activeAbsenceEvent || !text) return;
    if (isActiveAbsenceDeadlineReached) {
      Alert.alert(
        "受付期限終了",
        "この予定の不参加連絡は、予定日の" +
          safeAbsenceDeadlineDays +
          "日前に締め切られました。",
      );
      return;
    }
    if (isOffline) {
      Alert.alert("通信エラー", "不参加連絡はオンライン時に送信してください。");
      return;
    }

    const newComment = {
      id: `absence_${Date.now()}`,
      user: currentUser || "名称未設定",
      uid: user?.uid || "",
      text,
      date: selectedDate,
      time: new Date().toISOString(),
    };
    const nextComments = [...getAbsenceComments(activeAbsenceEvent), newComment];

    setIsLoading(true);
    try {
      await updateClubEvent(activeTeamId, activeAbsenceEvent.id, {
        absenceComments: nextComments,
      });
      setSelectedAbsenceEvent((prev) =>
        prev ? { ...prev, absenceComments: nextComments } : prev,
      );
      setAbsenceCommentText("");
    } catch (error) {
      Alert.alert("エラー", "不参加連絡の送信に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelAbsenceComment = (comment) => {
    if (
      !activeAbsenceEvent ||
      !comment?.id ||
      !canCancelAbsenceComment(comment)
    ) {
      return;
    }
    if (isOffline) {
      Alert.alert(
        "通信エラー",
        "不参加連絡はオンライン時に取り消してください。",
      );
      return;
    }

    Alert.alert(
      "不参加連絡の取り消し",
      "この不参加連絡を取り消しますか？",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "取り消す",
          style: "destructive",
          onPress: async () => {
            setIsLoading(true);
            try {
              await removeClubEventAbsenceComment(
                activeTeamId,
                activeAbsenceEvent.id,
                comment,
              );
              setSelectedAbsenceEvent((prev) =>
                prev
                  ? {
                      ...prev,
                      absenceComments: getAbsenceComments(prev).filter(
                        (item) => item.id !== comment.id,
                      ),
                    }
                  : prev,
              );
            } catch (error) {
              Alert.alert("エラー", "不参加連絡の取り消しに失敗しました。");
            } finally {
              setIsLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleSavePersonalEvent = async () => {
    if (!personalEventTitle.trim())
      return Alert.alert("エラー", "タイトルを入力してください");
    if (isPersonalMultiDay && personalEndDate < selectedDate)
      return Alert.alert("エラー", "終了日を正しく選択してください");

    setIsLoading(true);

    setTimeout(async () => {
      const schedules = {};
      if (isPersonalMultiDay) {
        const dates = getDatesInRange(selectedDate, personalEndDate);
        dates.forEach((d) => {
          schedules[d] = personalTimeSchedules[d] || {
            start: "18:00",
            end: "19:00",
            isAllDay: false,
          };
        });
      }

      const eventData = {
        date: selectedDate,
        endDate: isPersonalMultiDay ? personalEndDate : selectedDate,
        isMultiDay: isPersonalMultiDay,
        isAllDay: isPersonalMultiDay ? false : isPersonalAllDay,
        startTime:
          isPersonalMultiDay || isPersonalAllDay ? "" : personalStartTime,
        endTime: isPersonalMultiDay || isPersonalAllDay ? "" : personalEndTime,
        timeSchedules: isPersonalMultiDay ? schedules : null,
        title: personalEventTitle.trim(),
        description: personalEventDescription.trim(),
        status: isOffline ? "pending" : "active",
      };

      try {
        if (editingPersonalEventId) {
          if (!isOffline)
            await updatePersonalEvent(
              user.uid,
              editingPersonalEventId,
              eventData,
            );
        } else {
          if (!isOffline) await createPersonalEvent(user.uid, eventData);
        }
        setIsPersonalModalVisible(false);
        resetPersonalForm();
      } catch (error) {
        Alert.alert("エラー", "個人予定の保存に失敗しました。");
      } finally {
        setIsLoading(false);
      }
    }, 400);
  };

  const resetPersonalForm = () => {
    setEditingPersonalEventId(null);
    setPersonalEventTitle("");
    setPersonalEventDescription("");
    setIsPersonalMultiDay(false);
    setPersonalEndDate("");
    setShowPersonalEndDatePicker(false);
    setPersonalStartTime("18:00");
    setPersonalEndTime("19:00");
    setIsPersonalAllDay(false);
    setPersonalTimeSchedules({});
  };

  const openEditPersonalEvent = (event) => {
    setEditingPersonalEventId(event.id);
    setPersonalEventTitle(event.title);
    setPersonalEventDescription(event.description || "");
    setIsPersonalMultiDay(event.isMultiDay || false);
    setPersonalEndDate(event.endDate || event.date);
    setPersonalStartTime(event.startTime || "18:00");
    setPersonalEndTime(event.endTime || "19:00");
    setIsPersonalAllDay(event.isAllDay || false);
    setPersonalTimeSchedules(event.timeSchedules || {});
    setIsPersonalModalVisible(true);
  };

  const handleDeletePersonalEvent = (id) => {
    Alert.alert("削除", "個人の予定を削除しますか？", [
      { text: "キャンセル" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          setIsLoading(true);
          try {
            if (!isOffline) await deletePersonalEvent(user.uid, id);
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  };

  let currentPickerHour = "09";
  let currentPickerMin = "00";
  let pickerTitle = "時間を選択";
  let pickerMinTime = "";

  if (timePickerTarget === "club_single_start") {
    [currentPickerHour, currentPickerMin] = clubStartTime.split(":");
    pickerTitle = "開始時間を選択";
  } else if (timePickerTarget === "club_single_end") {
    pickerMinTime = clubStartTime;
    [currentPickerHour, currentPickerMin] = getTimeAtOrAfter(
      clubEndTime,
      pickerMinTime,
    ).split(":");
    pickerTitle = "終了時間を選択";
  } else if (timePickerTarget.startsWith("club_multi_start_")) {
    const d = timePickerTarget.replace("club_multi_start_", "");
    const t = clubTimeSchedules[d]?.start || "09:00";
    [currentPickerHour, currentPickerMin] = t.split(":");
    pickerTitle = `${d.substring(5).replace("-", "/")} の開始時間`;
  } else if (timePickerTarget.startsWith("club_multi_end_")) {
    const d = timePickerTarget.replace("club_multi_end_", "");
    pickerMinTime = clubTimeSchedules[d]?.start || "09:00";
    const t = getTimeAtOrAfter(
      clubTimeSchedules[d]?.end || "12:00",
      pickerMinTime,
    );
    [currentPickerHour, currentPickerMin] = t.split(":");
    pickerTitle = `${d.substring(5).replace("-", "/")} の終了時間`;
  } else if (timePickerTarget === "personal_single_start") {
    [currentPickerHour, currentPickerMin] = personalStartTime.split(":");
    pickerTitle = "開始時間を選択";
  } else if (timePickerTarget === "personal_single_end") {
    pickerMinTime = personalStartTime;
    [currentPickerHour, currentPickerMin] = getTimeAtOrAfter(
      personalEndTime,
      pickerMinTime,
    ).split(":");
    pickerTitle = "終了時間を選択";
  } else if (timePickerTarget.startsWith("personal_multi_start_")) {
    const d = timePickerTarget.replace("personal_multi_start_", "");
    const t = personalTimeSchedules[d]?.start || "18:00";
    [currentPickerHour, currentPickerMin] = t.split(":");
    pickerTitle = `${d.substring(5).replace("-", "/")} の開始時間`;
  } else if (timePickerTarget.startsWith("personal_multi_end_")) {
    const d = timePickerTarget.replace("personal_multi_end_", "");
    pickerMinTime = personalTimeSchedules[d]?.start || "18:00";
    const t = getTimeAtOrAfter(
      personalTimeSchedules[d]?.end || "19:00",
      pickerMinTime,
    );
    [currentPickerHour, currentPickerMin] = t.split(":");
    pickerTitle = `${d.substring(5).replace("-", "/")} の終了時間`;
  }

  const handleTimeSelect = (h, m) => {
    const timeStr = `${h}:${m}`;
    if (timePickerTarget === "club_single_start") {
      setClubStartTime(timeStr);
      setClubEndTime((prev) => getAdjustedEndTime(timeStr, prev));
    } else if (timePickerTarget === "club_single_end") {
      setClubEndTime(getTimeAtOrAfter(timeStr, clubStartTime));
    }
    else if (timePickerTarget.startsWith("club_multi_start_")) {
      const d = timePickerTarget.replace("club_multi_start_", "");
      setClubTimeSchedules((prev) => ({
        ...prev,
        [d]: {
          ...getDefaultClubSchedule(),
          ...prev[d],
          start: timeStr,
          end: getAdjustedEndTime(
            timeStr,
            prev[d]?.end || getDefaultClubSchedule().end,
          ),
        },
      }));
    } else if (timePickerTarget.startsWith("club_multi_end_")) {
      const d = timePickerTarget.replace("club_multi_end_", "");
      setClubTimeSchedules((prev) => ({
        ...prev,
        [d]: {
          ...getDefaultClubSchedule(),
          ...prev[d],
          end: getTimeAtOrAfter(
            timeStr,
            prev[d]?.start || getDefaultClubSchedule().start,
          ),
        },
      }));
    } else if (timePickerTarget === "personal_single_start") {
      setPersonalStartTime(timeStr);
      setPersonalEndTime((prev) => getAdjustedEndTime(timeStr, prev));
    } else if (timePickerTarget === "personal_single_end") {
      setPersonalEndTime(getTimeAtOrAfter(timeStr, personalStartTime));
    }
    else if (timePickerTarget.startsWith("personal_multi_start_")) {
      const d = timePickerTarget.replace("personal_multi_start_", "");
      setPersonalTimeSchedules((prev) => ({
        ...prev,
        [d]: {
          ...prev[d],
          start: timeStr,
          end: getAdjustedEndTime(timeStr, prev[d]?.end || "19:00"),
        },
      }));
    } else if (timePickerTarget.startsWith("personal_multi_end_")) {
      const d = timePickerTarget.replace("personal_multi_end_", "");
      setPersonalTimeSchedules((prev) => ({
        ...prev,
        [d]: {
          ...prev[d],
          end: getTimeAtOrAfter(timeStr, prev[d]?.start || "18:00"),
        },
      }));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtnWrapper}
        >
          <Text style={styles.backBtnText}>◁ ホーム</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📅 カレンダー</Text>
        <View style={{ width: 60 }} />
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <ActivityIndicator
            size="small"
            color="#fff"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.offlineBannerText}>
            現在オフラインです。予定の変更は通信復旧時に送信されます。
          </Text>
        </View>
      )}

      <Calendar
        onDayPress={(day) => setSelectedDate(day.dateString)}
        dayComponent={renderCalendarDay}
        theme={{ todayTextColor: COLORS.primary, arrowColor: "#555" }}
      />

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <View style={styles.dateHeaderRow}>
          <Text style={styles.selectedDateText}>
            {selectedDate.replace(/-/g, "/")} の予定
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🏟️ 部活の予定（共有）</Text>
            {canManageClubEvents && (
              <TouchableOpacity
                style={styles.addBtnSmall}
                onPress={() => {
                  resetClubForm();
                  setIsClubModalVisible(true);
                }}
              >
                <Text style={styles.addBtnTextSmall}>＋ 追加</Text>
              </TouchableOpacity>
            )}
          </View>
          {dailyClubEvents.length === 0 ? (
            <Text style={styles.emptyText}>予定なし</Text>
          ) : (
            dailyClubEvents.map((item) => {
              const isPending = item.status === "pending";
              const itemLocation = getLocationFromEvent(item);
              const hasItemLocationCoordinate = isValidCoordinate(
                itemLocation?.latitude,
                itemLocation?.longitude,
              );
              const absenceCount = getAbsenceCommentsForDate(
                item,
                selectedDate,
              ).length;
              return (
                <View
                  key={item.id}
                  style={[
                    styles.eventCard,
                    {
                      borderLeftColor:
                        item.type === "試合" ? COLORS.danger : COLORS.primary,
                    },
                    isPending && styles.pendingCard,
                  ]}
                >
                  {isPending && (
                    <Text style={styles.pendingText}>🕒 待機中</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle}>
                      {item.type || item.title || item.name}
                    </Text>
                    <View style={styles.timeSummaryRow}>
                      <Text style={styles.timeRangeText}>
                        {getDisplayTime(item, selectedDate)}
                      </Text>
                      <TouchableOpacity
                        onPress={() => openAbsenceListModal(item)}
                        style={styles.absenceCountBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`不参加 ${absenceCount}件の一覧を確認`}
                      >
                        <Text style={styles.absenceCountBtnText}>
                          不参加 {absenceCount}件
                        </Text>
                      </TouchableOpacity>
                      {canSubmitAbsence && !isPending && (
                        <TouchableOpacity
                          onPress={() => openAbsenceReportModal(item)}
                          style={styles.absenceBtn}
                        >
                          <Text style={styles.absenceBtnText}>不参加連絡</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {item.description ? (
                      <Text style={styles.eventDescription} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                    {itemLocation ? (
                      <View style={styles.locationSummaryBox}>
                        {itemLocation.name ? (
                          <Text style={styles.locationSummaryName}>
                            場所：{itemLocation.name}
                          </Text>
                        ) : null}
                        {itemLocation.address ? (
                          <Text style={styles.locationSummaryText}>
                            住所：{itemLocation.address}
                          </Text>
                        ) : null}
                        {itemLocation.note ? (
                          <Text style={styles.locationSummaryText}>
                            補足：{itemLocation.note}
                          </Text>
                        ) : null}
                        {hasItemLocationCoordinate ? (
                          <View style={styles.locationButtonRow}>
                            <TouchableOpacity
                              style={styles.locationMiniBtn}
                              onPress={() => shareEventLocation(item)}
                            >
                              <Text style={styles.locationMiniBtnText}>場所を共有</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                    <Text style={styles.eventSub}>
                      {item.type} {getClubEventDateSummary(item)}
                    </Text>
                  </View>
                  {canManageClubEvents && !isPending && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={() => openEditClubEvent(item)}
                        style={styles.iconBtn}
                      >
                        <Text>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() =>
                          handleDeleteClubEvent(item, selectedDate)
                        }
                        style={styles.iconBtn}
                      >
                        <Text>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>👤 個人の予定（非公開）</Text>
            <TouchableOpacity
              style={[styles.addBtnSmall, { backgroundColor: COLORS.success }]}
              onPress={() => {
                resetPersonalForm();
                setIsPersonalModalVisible(true);
              }}
            >
              <Text style={styles.addBtnTextSmall}>＋ 追加</Text>
            </TouchableOpacity>
          </View>
          {dailyPersonalEvents.length === 0 ? (
            <Text style={styles.emptyText}>予定なし</Text>
          ) : (
            dailyPersonalEvents.map((item) => {
              const isPending = item.status === "pending";
              return (
                <View
                  key={item.id}
                  style={[
                    styles.eventCard,
                    { borderLeftColor: COLORS.success },
                    isPending && styles.pendingCard,
                  ]}
                >
                  {isPending && (
                    <Text style={styles.pendingText}>🕒 待機中</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle}>{item.title}</Text>
                    <Text style={styles.timeRangeText}>
                      {getDisplayTime(item, selectedDate)}
                    </Text>
                    {item.description ? (
                      <Text style={styles.eventDescription} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                    {item.isMultiDay ? (
                      <Text style={styles.eventSub}>
                        期間: {item.date.replace(/-/g, "/")} 〜{" "}
                        {item.endDate.replace(/-/g, "/")}
                      </Text>
                    ) : null}
                  </View>
                  {!isPending && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={() => openEditPersonalEvent(item)}
                        style={styles.iconBtn}
                      >
                        <Text>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeletePersonalEvent(item.id)}
                        style={styles.iconBtn}
                      >
                        <Text>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📝 あなたの提出済み振り返り</Text>
          {dailyMyReports.length === 0 ? (
            <Text style={styles.emptyText}>未提出</Text>
          ) : (
            dailyMyReports.map((report) => {
              const isPending = report.status === "pending";
              return (
                <TouchableOpacity
                  key={report.id}
                  style={[
                    styles.eventCard,
                    {
                      borderLeftColor: COLORS.secondary,
                      backgroundColor: "#fff9f0",
                    },
                    isPending && styles.pendingCard,
                  ]}
                  onPress={() => setViewingReport(report)}
                >
                  {isPending && (
                    <Text style={styles.pendingText}>🕒 送信待機中</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle}>
                      日報: {report.condition}
                    </Text>
                    <Text style={styles.eventSub} numberOfLines={1}>
                      {report.reflection || "振り返り未記入"}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 20 }}>🔍</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      {isLoading && (
        <View style={styles.globalLoadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.globalLoadingText}>処理中...</Text>
        </View>
      )}

      {/* 振り返り詳細モーダル */}
      <Modal visible={viewingReport !== null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>提出済みの振り返り</Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
              contentContainerStyle={styles.clubModalScrollContent}
            >
              {viewingReport && (
                <>
                  <Text style={styles.label}>📅 提出日</Text>
                  <Text style={styles.viewingText}>{viewingReport.date}</Text>

                  <Text style={styles.label}>🏥 コンディション</Text>
                  <Text style={styles.viewingText}>
                    体調: {viewingReport.condition} / 疲労度:{" "}
                    {viewingReport.fatigue} / 練習:{" "}
                    {viewingReport.isParticipating}
                  </Text>

                  {viewingReport.hasPain && viewingReport.painDetails && (
                    <Text
                      style={[
                        styles.viewingText,
                        { color: COLORS.danger, fontWeight: "bold" },
                      ]}
                    >
                      🤕 ケガ・痛み: {viewingReport.painDetails.part} (レベル:{" "}
                      {viewingReport.painDetails.level})
                    </Text>
                  )}

                  <Text style={styles.label}>📝 振り返り内容</Text>
                  <Text style={styles.viewingText}>
                    {viewingReport.reflection || "未記入"}
                  </Text>

                  <Text style={styles.label}>📈 達成度 (自己評価)</Text>
                  <Text style={styles.viewingText}>
                    {viewingReport.achievement} / 5
                  </Text>

                  {viewingReport.memo ? (
                    <>
                      <Text style={styles.label}>📎 メモ</Text>
                      <Text style={styles.viewingText}>
                        {viewingReport.memo}
                      </Text>
                    </>
                  ) : null}

                  {viewingReport.comments &&
                    viewingReport.comments.length > 0 && (
                      <>
                        <Text style={styles.label}>💬 やり取り</Text>
                        {viewingReport.comments.map((c) => (
                          <View key={c.id} style={styles.commentBox}>
                            <Text style={styles.commentUser}>{c.user}</Text>
                            <Text style={styles.commentText}>{c.text}</Text>
                          </View>
                        ))}
                      </>
                    )}
                </>
              )}
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={() => setViewingReport(null)}
                >
                  <Text style={styles.submitBtnText}>閉じる</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 不参加者一覧・不参加連絡モーダル */}
      <Modal visible={activeAbsenceEvent !== null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {absenceModalMode === "list" ? "不参加者一覧" : "不参加連絡"}
              </Text>
              {activeAbsenceEvent && (
                <Text style={styles.modalSubTitle}>
                  {activeAbsenceEvent.title || activeAbsenceEvent.name}・
                  {selectedDate.replace(/-/g, "/")}
                </Text>
              )}
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 30 }}
            >
              {absenceModalMode === "list" ? (
                <>
                  <Text style={styles.label}>不参加者一覧</Text>
                  {activeAbsenceComments.length === 0 ? (
                    <Text style={styles.emptyText}>不参加者はいません</Text>
                  ) : (
                    activeAbsenceComments.map((comment) => (
                      <View key={comment.id} style={styles.commentBox}>
                        <Text style={styles.commentUser}>{comment.user}</Text>
                        <Text style={styles.commentText}>{comment.text}</Text>
                      </View>
                    ))
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.label}>自分の不参加連絡</Text>
                  {activeOwnAbsenceComments.length === 0 ? (
                    <Text style={styles.emptyText}>自分の不参加連絡はありません</Text>
                  ) : (
                    activeOwnAbsenceComments.map((comment) => (
                      <View key={comment.id} style={styles.commentBox}>
                        <View style={styles.commentHeaderRow}>
                          <Text
                            style={[styles.commentUser, styles.commentHeaderUser]}
                          >
                            {comment.user}
                          </Text>
                          <TouchableOpacity
                            style={[
                              styles.absenceCancelBtn,
                              isLoading && styles.absenceCancelBtnDisabled,
                            ]}
                            onPress={() => handleCancelAbsenceComment(comment)}
                            disabled={isLoading}
                          >
                            <Text style={styles.absenceCancelBtnText}>取り消す</Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.commentText}>{comment.text}</Text>
                      </View>
                    ))
                  )}

                  {isActiveAbsenceDeadlineReached ? (
                    <View style={styles.absenceDeadlineNotice}>
                      <Text style={styles.absenceDeadlineNoticeText}>
                        この予定の新しい不参加連絡は、予定日の
                        {safeAbsenceDeadlineDays}
                        日前に締め切られました。登録済みの連絡は確認・取り消しできます。
                      </Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.label}>不参加コメント</Text>
                      <TextInput
                        style={[styles.input, styles.textArea]}
                        value={absenceCommentText}
                        onChangeText={setAbsenceCommentText}
                        placeholder="例: 体調不良のため欠席します"
                        multiline
                      />
                    </>
                  )}
                </>
              )}
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={closeAbsenceModal}
                >
                  <Text style={styles.cancelBtnText}>閉じる</Text>
                </TouchableOpacity>
                {absenceModalMode === "report" &&
                  !isActiveAbsenceDeadlineReached && (
                    <TouchableOpacity
                      style={styles.submitBtn}
                      onPress={handleSendAbsenceComment}
                    >
                      <Text style={styles.submitBtnText}>送信</Text>
                    </TouchableOpacity>
                  )}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* 部活予定モーダル */}
      <Modal visible={isClubModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 20 : 0}
          style={styles.modalKeyboardAvoiding}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingClubEventId ? "予定の編集" : "新しい予定を追加"}
              </Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
              contentContainerStyle={styles.clubModalScrollContent}
            >
              <Text style={styles.label}>予定の種類</Text>
              <View style={styles.typeContainer}>
                {["練習", "試合", "その他"].map((t) => (
                  <TouchableOpacity key={t} style={[styles.typeBtn, clubEventType === t && styles.typeBtnActive]} onPress={() => setClubEventType(t)}>
                    <Text style={[styles.typeBtnText, clubEventType === t && styles.typeBtnTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>日程 (開始日: {selectedDate})</Text>
              <View style={styles.typeContainer}>
                <TouchableOpacity style={[styles.typeBtn, !isMultiDay && styles.typeBtnActive, editingClubEventSplit && styles.typeBtnDisabled]} disabled={!!editingClubEventSplit} onPress={() => { setIsMultiDay(false); setEndDate(selectedDate); setClubSelectedDates([selectedDate]); }}>
                  <Text style={[styles.typeBtnText, !isMultiDay && styles.typeBtnTextActive]}>当日のみ</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.typeBtn, isMultiDay && styles.typeBtnActive, editingClubEventSplit && styles.typeBtnDisabled]} disabled={!!editingClubEventSplit} onPress={() => { setIsMultiDay(true); setEndDate(endDate || selectedDate); setClubSelectedDates((prev) => prev.length ? getUniqueSortedDates(prev) : [selectedDate]); }}>
                  <Text style={[styles.typeBtnText, isMultiDay && styles.typeBtnTextActive]}>複数日</Text>
                </TouchableOpacity>
              </View>

              {isMultiDay ? (
                <View style={styles.multiDayContainer}>
                  <Text style={[styles.label, { color: COLORS.primary, textAlign: "center", marginBottom: 10 }]}>▼ カレンダーで予定日を選択 ▼</Text>
                  <Calendar current={sortedClubSelectedDates[0] || selectedDate} onDayPress={(day) => toggleClubSelectedDate(day.dateString)} markedDates={clubSelectionMarkedDates} theme={{ todayTextColor: COLORS.primary, arrowColor: "#555" }} />
                  <Text style={styles.multiDateSummary}>選択中: {sortedClubSelectedDates.map((date) => date.replace(/-/g, "/")).join("?")}</Text>
                  <View style={{ marginTop: 15 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                      <Text style={styles.label}>時間設定</Text>
                      <View style={{ flexDirection: "row", alignItems: "center" }}><Text style={{ marginRight: 5, fontSize: 14, fontWeight: "bold", color: COLORS.textSub }}>終日</Text><Switch value={isClubAllDay} onValueChange={setIsClubAllDay} /></View>
                    </View>
                    {!isClubAllDay && <View style={styles.timeInputRow}><TouchableOpacity style={styles.timeSelectBtn} onPress={() => { setTimePickerTarget("club_single_start"); setIsTimePickerVisible(true); }}><Text style={styles.timeSelectBtnText}>{clubStartTime}</Text></TouchableOpacity><Text style={styles.timeBetween}>〜</Text><TouchableOpacity style={styles.timeSelectBtn} onPress={() => { setTimePickerTarget("club_single_end"); setIsTimePickerVisible(true); }}><Text style={styles.timeSelectBtnText}>{clubEndTime}</Text></TouchableOpacity></View>}
                    <Text style={styles.multiDateSummary}>選択した全日に同じ時間設定を保存します。</Text>
                  </View>
                </View>
              ) : (
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                    <Text style={styles.label}>時間</Text>
                    <View style={{ flexDirection: "row", alignItems: "center" }}><Text style={{ marginRight: 5, fontSize: 14, fontWeight: "bold", color: COLORS.textSub }}>終日</Text><Switch value={isClubAllDay} onValueChange={setIsClubAllDay} /></View>
                  </View>
                  {!isClubAllDay && <View style={styles.timeInputRow}><TouchableOpacity style={styles.timeSelectBtn} onPress={() => { setTimePickerTarget("club_single_start"); setIsTimePickerVisible(true); }}><Text style={styles.timeSelectBtnText}>{clubStartTime}</Text></TouchableOpacity><Text style={styles.timeBetween}>〜</Text><TouchableOpacity style={styles.timeSelectBtn} onPress={() => { setTimePickerTarget("club_single_end"); setIsTimePickerVisible(true); }}><Text style={styles.timeSelectBtnText}>{clubEndTime}</Text></TouchableOpacity></View>}
                </View>
              )}

              <Text style={styles.label}>詳細説明・備考</Text>
              <TextInput style={[styles.input, styles.textArea]} value={clubEventDescription} onChangeText={setClubEventDescription} placeholder="集合時間、持ち物など" multiline blurOnSubmit={false} />

              <Text style={styles.label}>場所</Text>
              <TextInput style={styles.input} value={clubLocationName} onChangeText={handleClubLocationNameChange} placeholder="施設名・住所・集合場所名" returnKeyType="done" />
              {recentClubLocations.length > 0 ? <View style={styles.recentLocationBox}><Text style={styles.recentLocationTitle}>最近使用した場所</Text>{recentClubLocations.map((location, index) => <TouchableOpacity key={`${location.name || "location"}-${index}`} style={styles.recentLocationItem} onPress={() => applyClubLocation(location)}><Text style={styles.recentLocationName}>{location.name || "名称未設定"}</Text>{location.address ? <Text style={styles.recentLocationAddress} numberOfLines={1}>{location.address}</Text> : null}</TouchableOpacity>)}</View> : null}

              <View style={styles.locationDetailsToggleRow}><Text style={styles.locationDetailsToggleText}>場所詳細機能</Text><Switch value={isClubLocationDetailsEnabled} onValueChange={setIsClubLocationDetailsEnabled} /></View>

              {isClubLocationDetailsEnabled ? <><TouchableOpacity style={[styles.locationSearchBtn, isLocationGeocoding ? styles.locationDisabledBtn : null]} onPress={() => geocodeClubLocation()} disabled={isLocationGeocoding}>{isLocationGeocoding ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.locationSearchBtnText}>座標を取得</Text>}</TouchableOpacity><View style={styles.locationEditorActions}><TouchableOpacity style={[styles.mapOpenBtn, isLocationGeocoding ? styles.locationDisabledBtn : null]} onPress={openLocationMap} disabled={isLocationGeocoding}><Text style={styles.mapOpenBtnText}>地図でピンを調整</Text></TouchableOpacity>{hasClubLocationDraft() ? <TouchableOpacity style={styles.locationClearBtn} onPress={clearClubLocation}><Text style={styles.locationClearBtnText}>場所を削除</Text></TouchableOpacity> : null}</View>{isValidCoordinate(clubLocationLatitude, clubLocationLongitude) ? <Text style={styles.coordinatePreview}>座標: {Number(clubLocationLatitude).toFixed(6)}, {Number(clubLocationLongitude).toFixed(6)}</Text> : <Text style={styles.coordinateHint}>地図でピン位置を確定すると座標が保存されます。</Text>}<TextInput style={[styles.input, styles.textAreaSmall]} value={clubLocationNote} onChangeText={setClubLocationNote} placeholder="場所に関する補足（例：正面入口前に集合）" multiline blurOnSubmit={false} /></> : null}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsClubModalVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={handleSaveClubEvent}
                >
                  <Text style={styles.submitBtnText}>保存する</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
            </View>

          {isTimePickerVisible && timePickerTarget.includes("club") && (
            <TimePickerOverlay
              onClose={() => setIsTimePickerVisible(false)}
              title={pickerTitle}
              currentHour={currentPickerHour}
              currentMin={currentPickerMin}
              onSelect={handleTimeSelect}
              minTime={pickerMinTime}
            />
          )}

          {isLocationMapVisible ? (
        <View style={styles.mapModalOverlay}>
          <View style={styles.mapModalContent}>
            <View style={styles.mapModalHeader}>
              <Text style={styles.mapModalTitle}>ピン位置を調整</Text>
              <Text style={styles.mapModalSubTitle}>
                地図を拡大・移動し、ピンを集合場所にドラッグしてください。
              </Text>
            </View>
            {Platform.OS === "web" || !MapView || !Marker ? (
              <View style={styles.mapUnavailableBox}>
                <Text style={styles.mapUnavailableText}>
                  アプリ内地図はAndroid/iOSで利用できます。
                </Text>
              </View>
            ) : (
              <MapView
                key={`${mapDraftCoordinate.latitude}-${mapDraftCoordinate.longitude}`}
                provider={PROVIDER_GOOGLE}
                style={styles.mapView}
                initialRegion={{
                  ...mapDraftCoordinate,
                  ...DEFAULT_MAP_DELTA,
                }}
              >
                <Marker
                  coordinate={mapDraftCoordinate}
                  draggable
                  title={clubLocationName || "活動場所"}
                  description="ピンをドラッグして微調整できます"
                  onDragEnd={(event) => {
                    setMapDraftCoordinate(event.nativeEvent.coordinate);
                  }}
                />
              </MapView>
            )}
            <Text style={styles.mapCoordinateText}>
              {mapDraftCoordinate.latitude.toFixed(6)},
              {mapDraftCoordinate.longitude.toFixed(6)}
            </Text>
            <View style={styles.mapModalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsLocationMapVisible(false)}
              >
                <Text style={styles.cancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={confirmLocationPin}
              >
                <Text style={styles.submitBtnText}>ピン位置を確定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
          ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>


      {/* 個人予定モーダル */}
      <Modal visible={isPersonalModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingPersonalEventId
                  ? "個人の予定を編集"
                  : "個人の予定を追加"}
              </Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
              contentContainerStyle={styles.clubModalScrollContent}
            >
              <Text style={styles.label}>予定のタイトル</Text>
              <TextInput
                style={styles.input}
                placeholder="例: 塾、通院"
                value={personalEventTitle}
                onChangeText={setPersonalEventTitle}
              />

              <Text style={styles.label}>日程 (開始日: {selectedDate})</Text>
              <View style={styles.typeContainer}>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    !isPersonalMultiDay && styles.typeBtnActive,
                  ]}
                  onPress={() => {
                    setIsPersonalMultiDay(false);
                    setPersonalEndDate(selectedDate);
                  }}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      !isPersonalMultiDay && styles.typeBtnTextActive,
                    ]}
                  >
                    当日のみ
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    isPersonalMultiDay && styles.typeBtnActive,
                  ]}
                  onPress={() => {
                    setIsPersonalMultiDay(true);
                    setPersonalEndDate(personalEndDate || selectedDate);
                  }}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      isPersonalMultiDay && styles.typeBtnTextActive,
                    ]}
                  >
                    複数日
                  </Text>
                </TouchableOpacity>
              </View>

              {isPersonalMultiDay ? (
                <View style={styles.multiDayContainer}>
                  <Text
                    style={[
                      styles.label,
                      {
                        color: COLORS.success,
                        textAlign: "center",
                        marginBottom: 10,
                      },
                    ]}
                  >
                    ▼ 終了日をタップして選択 ▼
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.endDateSelector,
                      { borderColor: COLORS.success },
                    ]}
                    onPress={() =>
                      setShowPersonalEndDatePicker(!showPersonalEndDatePicker)
                    }
                  >
                    <Text
                      style={[styles.endDateText, { color: COLORS.success }]}
                    >
                      🗓️ {personalEndDate || selectedDate}
                    </Text>
                  </TouchableOpacity>
                  {showPersonalEndDatePicker && (
                    <Calendar
                      onDayPress={(day) => {
                        setPersonalEndDate(day.dateString);
                        setShowPersonalEndDatePicker(false);
                      }}
                      markedDates={{
                        [personalEndDate]: {
                          selected: true,
                          selectedColor: COLORS.success,
                        },
                      }}
                    />
                  )}

                  {personalEndDate >= selectedDate && (
                    <View style={{ marginTop: 15 }}>
                      <Text style={[styles.label, { marginBottom: 10 }]}>
                        ⏰ 日ごとの時間設定
                      </Text>
                      {getDatesInRange(selectedDate, personalEndDate).map(
                        (date) => {
                          const sched = personalTimeSchedules[date] || {
                            start: "18:00",
                            end: "19:00",
                            isAllDay: false,
                          };
                          return (
                            <View key={date} style={styles.multiTimeRow}>
                              <View style={styles.multiTimeLeft}>
                                <Text style={styles.multiTimeDate}>
                                  {date.substring(5).replace("-", "/")}
                                </Text>
                                <View style={styles.allDaySwitchRow}>
                                  <Switch
                                    value={sched.isAllDay}
                                    onValueChange={(val) =>
                                      setPersonalTimeSchedules((prev) => ({
                                        ...prev,
                                        [date]: { ...sched, isAllDay: val },
                                      }))
                                    }
                                    scaleX={0.7}
                                    scaleY={0.7}
                                  />
                                  <Text style={styles.allDayLabelSmall}>
                                    終日
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.multiTimeRight}>
                                {!sched.isAllDay ? (
                                  <View style={styles.multiTimeInputContainer}>
                                    <TouchableOpacity
                                      style={styles.multiTimeBtn}
                                      onPress={() => {
                                        setTimePickerTarget(
                                          `personal_multi_start_${date}`,
                                        );
                                        setIsTimePickerVisible(true);
                                      }}
                                    >
                                      <Text style={styles.multiTimeBtnText}>
                                        {sched.start}
                                      </Text>
                                    </TouchableOpacity>
                                    <Text style={styles.timeBetweenSmall}>
                                      〜
                                    </Text>
                                    <TouchableOpacity
                                      style={styles.multiTimeBtn}
                                      onPress={() => {
                                        setTimePickerTarget(
                                          `personal_multi_end_${date}`,
                                        );
                                        setIsTimePickerVisible(true);
                                      }}
                                    >
                                      <Text style={styles.multiTimeBtnText}>
                                        {sched.end}
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : (
                                  <Text
                                    style={[
                                      styles.allDayActiveText,
                                      { color: COLORS.success },
                                    ]}
                                  >
                                    終日設定中
                                  </Text>
                                )}
                              </View>
                            </View>
                          );
                        },
                      )}
                    </View>
                  )}
                </View>
              ) : (
                <View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 10,
                    }}
                  >
                    <Text style={styles.label}>⏰ 時間</Text>
                    <View
                      style={{ flexDirection: "row", alignItems: "center" }}
                    >
                      <Text
                        style={{
                          marginRight: 5,
                          fontSize: 14,
                          fontWeight: "bold",
                          color: COLORS.textSub,
                        }}
                      >
                        終日
                      </Text>
                      <Switch
                        value={isPersonalAllDay}
                        onValueChange={setIsPersonalAllDay}
                      />
                    </View>
                  </View>
                  {!isPersonalAllDay && (
                    <View style={styles.timeInputRow}>
                      <TouchableOpacity
                        style={styles.timeSelectBtn}
                        onPress={() => {
                          setTimePickerTarget("personal_single_start");
                          setIsTimePickerVisible(true);
                        }}
                      >
                        <Text style={styles.timeSelectBtnText}>
                          {personalStartTime}
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.timeBetween}>〜</Text>
                      <TouchableOpacity
                        style={styles.timeSelectBtn}
                        onPress={() => {
                          setTimePickerTarget("personal_single_end");
                          setIsTimePickerVisible(true);
                        }}
                      >
                        <Text style={styles.timeSelectBtnText}>
                          {personalEndTime}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              <Text style={styles.label}>メモ</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={personalEventDescription}
                onChangeText={setPersonalEventDescription}
                placeholder="自分用のメモ"
                multiline
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsPersonalModalVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    { backgroundColor: COLORS.success },
                  ]}
                  onPress={handleSavePersonalEvent}
                >
                  <Text style={styles.submitBtnText}>保存する</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>

          {isTimePickerVisible && timePickerTarget.includes("personal") && (
            <TimePickerOverlay
              onClose={() => setIsTimePickerVisible(false)}
              title={pickerTitle}
              currentHour={currentPickerHour}
              currentMin={currentPickerMin}
              onSelect={handleTimeSelect}
              minTime={pickerMinTime}
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    height: 60,
    backgroundColor: "#34495e",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  backBtnWrapper: { width: 60 },
  backBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  offlineBanner: {
    backgroundColor: COLORS.secondary,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  offlineBannerText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  scrollContent: { flex: 1, padding: 15 },
  dateHeaderRow: {
    marginBottom: 15,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#ddd",
  },
  selectedDateText: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.textMain,
  },

  calendarDayCell: {
    width: 36,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    paddingVertical: 3,
  },
  calendarDayCellSelected: {
    backgroundColor: "#e8f0fe",
  },
  calendarDayText: {
    fontSize: 15,
    color: COLORS.textMain,
    fontWeight: "600",
  },
  calendarDayTodayText: {
    color: COLORS.primary,
    fontWeight: "bold",
  },
  calendarDaySelectedText: {
    color: COLORS.textMain,
  },
  calendarDayDisabledText: {
    color: "#c7ced6",
  },
  calendarDotRow: {
    height: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  calendarTimeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 1.5,
  },
  calendarCountBadge: {
    minWidth: 18,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.textMain,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    marginTop: 1,
  },
  calendarCountText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
  },
  calendarEmptyMarker: {
    height: 12,
    marginTop: 2,
  },

  section: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    marginBottom: 20,
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  sectionTitle: { fontSize: 15, fontWeight: "bold", color: COLORS.textMain },
  addBtnSmall: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  addBtnTextSmall: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  emptyText: {
    textAlign: "center",
    color: "#aaa",
    marginVertical: 10,
    fontSize: 13,
  },

  eventCard: {
    backgroundColor: "#fdfdfd",
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: "#eee",
  },
  pendingCard: { opacity: 0.6, borderStyle: "dashed" },
  pendingText: {
    position: "absolute",
    top: 5,
    right: 10,
    fontSize: 10,
    color: COLORS.secondary,
    fontWeight: "bold",
  },
  eventTitle: { fontSize: 15, fontWeight: "bold", color: COLORS.textMain },
  timeSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  timeRangeText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: "bold",
    marginVertical: 2,
  },
  eventDescription: {
    fontSize: 13,
    color: COLORS.textSub,
    marginTop: 4,
    lineHeight: 18,
  },
  eventSub: { fontSize: 11, color: "#aaa", marginTop: 4 },
  absenceCountBtn: {
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginLeft: 8,
    backgroundColor: "#fff5f5",
  },
  absenceCountBtnText: {
    fontSize: 12,
    color: COLORS.danger,
    fontWeight: "bold",
  },
  absenceBtn: {
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginLeft: 8,
    backgroundColor: "#fff5f5",
  },
  absenceBtnText: {
    fontSize: 12,
    color: COLORS.danger,
    fontWeight: "bold",
  },

  locationSummaryBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#eef7f1",
    borderWidth: 1,
    borderColor: "#cde9d5",
  },
  locationSummaryName: {
    fontSize: 13,
    color: COLORS.textMain,
    fontWeight: "bold",
    marginBottom: 3,
  },
  locationSummaryText: {
    fontSize: 12,
    color: COLORS.textSub,
    lineHeight: 17,
  },
  locationButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  locationMiniBtn: {
    borderWidth: 1,
    borderColor: COLORS.success,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 9,
    marginRight: 6,
    marginBottom: 6,
    backgroundColor: "#ffffff",
  },
  locationMiniBtnText: {
    fontSize: 11,
    color: COLORS.success,
    fontWeight: "bold",
  },

  actionRow: { flexDirection: "row", marginLeft: "auto" },
  iconBtn: { padding: 10, marginLeft: 5 },

  globalLoadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  globalLoadingText: {
    marginTop: 10,
    color: COLORS.primary,
    fontWeight: "bold",
    fontSize: 16,
  },

  modalKeyboardAvoiding: { flex: 1 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    maxHeight: "90%",
  },
  clubModalScrollContent: { paddingBottom: 120 },

  modalHeader: { marginBottom: 15, alignItems: "center" },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 5,
  },
  modalSubTitle: {
    fontSize: 13,
    color: COLORS.textSub,
    textAlign: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  textAreaSmall: { minHeight: 56, textAlignVertical: "top" },
  recentLocationBox: {
    backgroundColor: "#f6fbff",
    borderWidth: 1,
    borderColor: "#d7eaff",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  recentLocationTitle: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: "bold",
    marginBottom: 6,
  },
  recentLocationItem: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#e7f1ff",
  },
  recentLocationName: {
    fontSize: 13,
    color: COLORS.textMain,
    fontWeight: "bold",
  },
  recentLocationAddress: {
    fontSize: 12,
    color: COLORS.textSub,
    marginTop: 2,
  },
  locationDetailsToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    marginBottom: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#eeeeee",
  },
  locationDetailsToggleText: {
    fontSize: 14,
    color: COLORS.textMain,
    fontWeight: "bold",
  },
  locationSearchBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginBottom: 8,
  },
  locationSearchBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  locationDisabledBtn: {
    opacity: 0.65,
  },
  locationEditorActions: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  mapOpenBtn: {
    flex: 1,
    backgroundColor: COLORS.success,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  mapOpenBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  locationClearBtn: {
    marginLeft: 8,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: "#fff5f5",
  },
  locationClearBtnText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: "bold",
  },
  coordinatePreview: {
    fontSize: 12,
    color: COLORS.success,
    fontWeight: "bold",
    marginBottom: 8,
  },
  coordinateHint: {
    fontSize: 12,
    color: COLORS.textSub,
    marginBottom: 8,
  },
  mapModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 16,
    zIndex: 20,
    elevation: 20,
  },
  mapModalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    maxHeight: "90%",
  },
  mapModalHeader: { marginBottom: 10 },
  mapModalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.textMain,
    textAlign: "center",
  },
  mapModalSubTitle: {
    fontSize: 12,
    color: COLORS.textSub,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  mapView: {
    height: 360,
    borderRadius: 8,
    overflow: "hidden",
    marginVertical: 10,
  },
  mapUnavailableBox: {
    height: 220,
    borderRadius: 8,
    backgroundColor: "#f0f2f5",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
    padding: 16,
  },
  mapUnavailableText: {
    fontSize: 13,
    color: COLORS.textSub,
    textAlign: "center",
    lineHeight: 18,
  },
  mapCoordinateText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: "bold",
    textAlign: "center",
  },
  mapModalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 14,
  },
  typeContainer: { flexDirection: "row", marginBottom: 10 },

  // ★ 修正：種類/日程選択ボタンのスタイル
  typeBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginRight: 10,
    backgroundColor: "#f9f9f9",
  },
  typeBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  typeBtnDisabled: {
    opacity: 0.6,
  },
  typeBtnText: { fontSize: 13, color: "#555", fontWeight: "bold" },
  typeBtnTextActive: { color: "#ffffff" },

  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 20,
  },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 20, marginRight: 10 },
  cancelBtnText: { color: "#888", fontWeight: "bold", fontSize: 15 },
  submitBtn: {
    backgroundColor: "#34495e",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  submitBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },

  multiDayContainer: {
    backgroundColor: "#f9f9f9",
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#eee",
  },
  multiTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  multiTimeLeft: { width: 85 },
  multiTimeDate: { fontSize: 14, fontWeight: "bold", color: COLORS.textMain },
  allDaySwitchRow: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  allDayLabelSmall: { fontSize: 11, color: "#666", fontWeight: "bold" },

  multiDateSummary: {
    marginTop: 10,
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: "bold",
    lineHeight: 19,
  },

  multiTimeRight: { flex: 1, alignItems: "flex-end" },
  multiTimeInputContainer: { flexDirection: "row", alignItems: "center" },
  multiTimeBtn: {
    backgroundColor: "#f0f2f5",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ccc",
    minWidth: 65,
    alignItems: "center",
  },
  multiTimeBtnText: { fontSize: 13, fontWeight: "bold", color: COLORS.primary },
  timeBetweenSmall: {
    marginHorizontal: 5,
    color: "#888",
    fontWeight: "bold",
    fontSize: 12,
  },
  allDayActiveText: { fontSize: 13, color: COLORS.primary, fontWeight: "bold" },

  endDateSelector: {
    backgroundColor: "#fff",
    paddingVertical: 15,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: "center",
    marginBottom: 10,
  },
  endDateText: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.primary,
  },

  timePickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
  },
  timeInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
  },
  timeSelectBtn: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  timeSelectBtnText: {
    fontSize: 20,
    fontWeight: "bold",
    color: COLORS.primary,
  },
  timeBetween: {
    marginHorizontal: 15,
    fontSize: 18,
    fontWeight: "bold",
    color: "#888",
  },
  timePickerContent: {
    width: "80%",
    height: 400,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    alignSelf: "center",
  },
  timePickerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
    marginBottom: 10,
  },
  timePickerRow: { flexDirection: "row", flex: 1, alignItems: "center" },
  timeScroll: { flex: 1 },
  timeSeparator: { fontSize: 24, fontWeight: "bold", marginHorizontal: 10 },
  timeOption: { paddingVertical: 15, alignItems: "center" },
  timeOptionActive: { backgroundColor: "#e8f0fe", borderRadius: 8 },
  timeOptionDisabled: { opacity: 0.35 },
  timeOptionText: { fontSize: 18, color: "#555" },
  timeOptionTextActive: { color: COLORS.primary, fontWeight: "bold" },
  timeOptionTextDisabled: { color: "#aaa" },
  timePickerCloseBtn: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  timePickerCloseText: { color: "#fff", fontWeight: "bold", fontSize: 16 },

  viewingText: {
    fontSize: 15,
    color: COLORS.textMain,
    marginBottom: 15,
    lineHeight: 22,
  },
  commentBox: {
    backgroundColor: "#f9f9f9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  commentUser: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.primary,
    marginBottom: 4,
  },
  commentHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  commentHeaderUser: {
    flex: 1,
    marginBottom: 0,
  },
  absenceDeadlineNotice: {
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fff4e5",
    borderWidth: 1,
    borderColor: "#f5c16c",
  },
  absenceDeadlineNoticeText: {
    fontSize: 13,
    color: "#8a5200",
    lineHeight: 19,
  },
  absenceCancelBtn: {
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginLeft: 8,
    backgroundColor: "#fff5f5",
  },
  absenceCancelBtnDisabled: {
    opacity: 0.5,
  },
  absenceCancelBtnText: {
    fontSize: 11,
    color: COLORS.danger,
    fontWeight: "bold",
  },
  commentText: { fontSize: 14, color: COLORS.textMain },
});

export default CalendarScreen;
