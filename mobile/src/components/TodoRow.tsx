import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Colors } from "../theme/colors";
import type { Todo } from "../api/notion";

interface Props {
  todo: Todo;
  onToggle: (todo: Todo) => void;
}

export function TodoRow({ todo, onToggle }: Props) {
  const { checked, text } = todo;
  const bg = checked ? Colors.surface2 : Colors.surface;

  return (
    <TouchableOpacity
      style={[styles.outer]}
      onPress={() => onToggle(todo)}
      activeOpacity={0.7}
    >
      <View style={[styles.row, { backgroundColor: bg }]}>
        {/* Left accent pip */}
        {!checked && <View style={styles.pip} />}

        {/* Checkbox */}
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked && <Text style={styles.checkmark}>✓</Text>}
        </View>

        {/* Text */}
        <Text
          style={[
            styles.text,
            checked && styles.textChecked,
          ]}
          numberOfLines={4}
        >
          {text}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginBottom: 2,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingRight: 14,
    paddingLeft: 0,
  },
  pip: {
    width: 3,
    alignSelf: "stretch",
    backgroundColor: Colors.accent,
    marginRight: 11,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.checkboxUnchecked,
    marginLeft: 14,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: Colors.checkboxChecked,
    borderColor: Colors.checkboxChecked,
  },
  checkmark: {
    color: Colors.bg,
    fontSize: 13,
    fontWeight: "700",
  },
  text: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    lineHeight: 21,
  },
  textChecked: {
    color: Colors.textDim,
    textDecorationLine: "line-through",
  },
});
