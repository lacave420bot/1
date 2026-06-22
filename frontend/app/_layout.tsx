import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AdminProvider } from "@/src/store/admin";
import { CartProvider } from "@/src/store/cart";
import { UserProvider } from "@/src/store/user";

LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#0A0A0B" }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <CartProvider>
          <UserProvider>
            <AdminProvider>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: "#0A0A0B" },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="product/[id]"
                  options={{ headerShown: false, presentation: "card" }}
                />
                <Stack.Screen
                  name="checkout"
                  options={{ headerShown: false, presentation: "card" }}
                />
                <Stack.Screen
                  name="order/[id]"
                  options={{ headerShown: false, presentation: "card" }}
                />
                <Stack.Screen
                  name="settings"
                  options={{ headerShown: false, presentation: "card" }}
                />
                <Stack.Screen
                  name="login"
                  options={{ headerShown: false, presentation: "modal" }}
                />
                <Stack.Screen
                  name="admin"
                  options={{ headerShown: false, presentation: "card" }}
                />
              </Stack>
            </AdminProvider>
          </UserProvider>
        </CartProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
