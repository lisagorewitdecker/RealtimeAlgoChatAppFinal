import { ActivityIndicator, StyleSheet, View } from "react-native";

/** The parent button owns the accessible name and busy state. */
export function ButtonSpinner({ color }: { color: string }) {
  return (
    <View
      testID="button-spinner"
      style={styles.center}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <ActivityIndicator color={color} accessible={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { width: "100%", alignItems: "center", justifyContent: "center" },
});