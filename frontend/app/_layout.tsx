import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SiteAccessGate } from "@/src/components/SiteAccessGate";
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
        <SiteAccessGate>
          <CartProvider>
            <UserProvider>
              <AdminProvider>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: "#0A0A0B" },
                    animation: "slide_from_right",
                    animationDuration: 220,
                    gestureEnabled: true,
                    fullScreenGestureEnabled: true,
                  }}
                >
                  <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: "fade" }} />
                  <Stack.Screen
                    name="product/[id]"
                    options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }}
                  />
                  <Stack.Screen
                    name="checkout"
                    options={{ headerShown: false, presentation: "card", animation: "slide_from_bottom", animationDuration: 280 }}
                  />
                  <Stack.Screen
                    name="order/[id]"
                    options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }}
                  />
                  <Stack.Screen
                    name="settings"
                    options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }}
                  />
                  <Stack.Screen
                    name="shop-hours"
                    options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }}
                  />
                  <Stack.Screen
                    name="login"
                    options={{ headerShown: false, presentation: "modal", animation: "slide_from_bottom", animationDuration: 300 }}
                  />
                  <Stack.Screen
                    name="admin"
                    options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }}
                  />
                </Stack>
              </AdminProvider>
            </UserProvider>
          </CartProvider>
        </SiteAccessGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
