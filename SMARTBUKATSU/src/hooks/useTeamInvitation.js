import { useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { createInvitationManager } from "../utils/teamInvitation";

const manager = createInvitationManager({
  storage: AsyncStorage,
  development: Application.applicationId === "com.sharprise.smartbukatsu.dev",
  getInitialURL: () => Linking.getInitialURL(),
  subscribeUrls: receive => {
    const subscription = Linking.addEventListener("url", ({ url }) => receive(url));
    return () => subscription.remove();
  },
  readReferrer: Platform.OS === "android" ? () => Application.getInstallReferrerAsync() : null,
});

export function useTeamInvitation() {
  const [snapshot, setSnapshot] = useState(manager.getSnapshot);
  useEffect(() => {
    const stop = manager.subscribe(setSnapshot);
    setSnapshot(manager.getSnapshot());
    void manager.initialize();
    return stop;
  }, []);
  return { ...snapshot, clearInvitation: manager.clearInvitation };
}
