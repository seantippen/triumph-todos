import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors } from "../theme/colors";

interface Props {
  done: number;
  total: number;
}

export function ProgressBar({ done, total }: Props) {
  if (total === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>Today: no tasks</Text>
      </View>
    );
  }

  const pct = done / total;
  const pctText = `${Math.round(pct * 100)}%`;
  const barColor = pct >= 0.75 ? Colors.accent : pct >= 0.4 ? Colors.accent2 : Colors.textDim;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>
          Today: {done}/{total} done
        </Text>
        <Text style={[styles.pct, { color: barColor }]}>{pctText}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  label: {
    fontSize: 12,
    color: Colors.textDim,
    fontFamily: "monospace",
  },
  pct: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  track: {
    height: 5,
    backgroundColor: Colors.surface2,
    borderRadius: 3,
    overflow: "hidden",
  },
  fill: {
    height: 5,
    borderRadius: 3,
  },
});
