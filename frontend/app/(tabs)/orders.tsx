import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";

import { useAdmin } from "@/src/store/admin";
import { colors } from "@/src/theme";

/**
 * The "Commandes" tab is reserved for the shop owner.
 * Always route to the PIN-protected admin orders screen.
 * If the admin is already authenticated, jump straight in; otherwise show the PIN screen.
 */
export default function OrdersTabScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAdmin();

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        router.replace("/admin/orders");
      } else {
        router.replace("/admin/login");
      }
    }, [isAuthenticated, router]),
  );

  return (
    <View style={styles.center} testID="orders-tab-redirect">
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
});
