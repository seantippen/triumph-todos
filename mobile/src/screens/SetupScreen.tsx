import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Colors } from "../theme/colors";
import { NotionClient } from "../api/notion";

interface Props {
  onConnected: (token: string) => void;
}

export function SetupScreen({ onConnected }: Props) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      Alert.alert("Missing Token", "Paste your Notion integration token.");
      return;
    }

    setLoading(true);
    try {
      const client = new NotionClient(trimmed);
      const valid = await client.validate();
      if (valid) {
        onConnected(trimmed);
      } else {
        Alert.alert(
          "Connection Failed",
          "Token was rejected. Make sure your integration has access to the page."
        );
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not connect to Notion.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <StatusBar style="light" />
      <View style={styles.inner}>
        {/* Accent bar */}
        <View style={styles.accentBar} />

        <Text style={styles.title}>Triumph Todos</Text>
        <Text style={styles.subtitle}>Connect your Notion workspace</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Integration Token</Text>
          <TextInput
            style={styles.input}
            placeholder="ntn_..."
            placeholderTextColor={Colors.textDim}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={handleConnect}
          />
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={Colors.bg} size="small" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Create an internal integration at notion.so/my-integrations{"\n"}
          then share your journal page with it.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  accentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: Colors.accent,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textDim,
    marginBottom: 36,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textDim,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  inputContainer: {
    marginBottom: 24,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: Colors.bg,
    fontSize: 16,
    fontWeight: "700",
  },
  hint: {
    marginTop: 32,
    fontSize: 12,
    color: Colors.border,
    textAlign: "center",
    lineHeight: 18,
  },
});
