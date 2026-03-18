import React, { useEffect, useState } from "react";
import { Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import { SetupScreen } from "./src/screens/SetupScreen";
import { TodoScreen } from "./src/screens/TodoScreen";

const TOKEN_KEY = "triumph_notion_token";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY)
      .then((saved) => {
        if (saved) setToken(saved);
      })
      .finally(() => setReady(true));
  }, []);

  const handleConnected = async (newToken: string) => {
    await SecureStore.setItemAsync(TOKEN_KEY, newToken);
    setToken(newToken);
  };

  const handleDisconnect = () => {
    Alert.alert("Disconnect", "Remove saved token and return to setup?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          await SecureStore.deleteItemAsync(TOKEN_KEY);
          setToken(null);
        },
      },
    ]);
  };

  if (!ready) return null;

  if (!token) {
    return <SetupScreen onConnected={handleConnected} />;
  }

  return <TodoScreen token={token} onDisconnect={handleDisconnect} />;
}
