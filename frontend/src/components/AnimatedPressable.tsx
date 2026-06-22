import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import { Platform, Pressable, type PressableProps, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style"> & {
  style?: ViewStyle | ViewStyle[];
  scale?: number;
  haptic?: boolean | "light" | "medium" | "heavy";
};

/**
 * Pressable with a smooth spring scale + opacity tap feedback,
 * and optional haptic on press (iOS native + Android vibration).
 */
export function AnimatedPressable({
  children,
  style,
  scale = 0.96,
  haptic = "light",
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: Props) {
  const s = useSharedValue(1);
  const o = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: s.value }],
    opacity: o.value,
  }));

  const handlePressIn = useCallback(
    (e: any) => {
      s.value = withSpring(scale, { damping: 20, stiffness: 400 });
      o.value = withTiming(0.85, { duration: 80 });
      onPressIn?.(e);
    },
    [s, o, scale, onPressIn],
  );

  const handlePressOut = useCallback(
    (e: any) => {
      s.value = withSpring(1, { damping: 15, stiffness: 300 });
      o.value = withTiming(1, { duration: 120 });
      onPressOut?.(e);
    },
    [s, o, onPressOut],
  );

  const handlePress = useCallback(
    (e: any) => {
      if (haptic && Platform.OS !== "web") {
        const intensity =
          haptic === "heavy"
            ? Haptics.ImpactFeedbackStyle.Heavy
            : haptic === "medium"
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light;
        Haptics.impactAsync(intensity).catch(() => {});
      }
      onPress?.(e);
    },
    [haptic, onPress],
  );

  return (
    <AnimatedPressableBase
      style={[style, animatedStyle] as any}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      {...rest}
    >
      {children as any}
    </AnimatedPressableBase>
  );
}
