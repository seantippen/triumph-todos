import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SectionList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native";
import { Colors } from "../theme/colors";
import { NotionClient, Todo } from "../api/notion";
import { ProgressBar } from "../components/ProgressBar";
import { TodoRow } from "../components/TodoRow";

type FilterMode = "all" | "today" | "week";

interface Props {
  token: string;
  onDisconnect: () => void;
}

export function TodoScreen({ token, onDisconnect }: Props) {
  const client = useRef(new NotionClient(token)).current;

  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>("Loading...");
  const [syncColor, setSyncColor] = useState<string>(Colors.yellow);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────────

  const fetchTodos = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      setSyncStatus("Syncing...");
      setSyncColor(Colors.yellow);

      try {
        const result = await client.collectTodos();
        setTodos(result);
        const ts = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        setSyncStatus(`Synced ${ts}`);
        setSyncColor(Colors.textDim);
      } catch (e: any) {
        setSyncStatus(`Error`);
        setSyncColor(Colors.red);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client]
  );

  useEffect(() => {
    fetchTodos();
    // Auto-refresh every 2 minutes
    const interval = setInterval(() => fetchTodos(), 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchTodos]);

  // ── Toggle ───────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (todo: Todo) => {
      const newChecked = !todo.checked;

      // Optimistic update
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, checked: newChecked } : t))
      );

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      setSyncStatus("Saving...");
      setSyncColor(Colors.yellow);

      try {
        await client.updateTodoChecked(todo.id, newChecked);
        const ts = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        setSyncStatus(`Saved ${ts}`);
        setSyncColor(Colors.accent);
      } catch {
        // Revert on failure
        setTodos((prev) =>
          prev.map((t) => (t.id === todo.id ? { ...t, checked: !newChecked } : t))
        );
        setSyncStatus("Save failed");
        setSyncColor(Colors.red);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    },
    [client]
  );

  // ── Filtering ────────────────────────────────────────────────────

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const { active, completedToday, todayActive, todayDone } = useMemo(() => {
    // Date filter
    let source = todos;
    if (filter === "today") {
      source = source.filter((t) => t.heading.includes(todayStr));
    } else if (filter === "week") {
      const now = new Date();
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      source = source.filter((t) => {
        const m = t.heading.match(/(\d{4}-\d{2}-\d{2})/);
        if (!m) return false;
        const d = new Date(m[1] + "T00:00:00");
        return d >= stripTime(monday) && d <= stripTime(sunday);
      });
    }

    // Search filter
    const q = search.toLowerCase().trim();
    if (q) {
      source = source.filter(
        (t) => t.text.toLowerCase().includes(q) || t.heading.toLowerCase().includes(q)
      );
    }

    const active: Todo[] = [];
    const completedToday: Todo[] = [];

    for (const t of source) {
      if (!t.checked) {
        active.push(t);
      } else {
        const dateMatch = t.heading.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          if (dateMatch[1] === todayStr) completedToday.push(t);
        } else {
          completedToday.push(t);
        }
      }
    }

    // Progress bar counts (unfiltered by search)
    const todayActive = todos.filter((t) => !t.checked && t.heading.includes(todayStr)).length;
    const todayDone = todos.filter((t) => t.checked && t.heading.includes(todayStr)).length;

    return { active, completedToday, todayActive, todayDone };
  }, [todos, filter, search, todayStr]);

  // ── Section list data ────────────────────────────────────────────

  const sections = useMemo(() => {
    const result: { title: string; data: Todo[]; isCompleted?: boolean }[] = [];

    // Group active by heading
    const groups: Record<string, Todo[]> = {};
    const order: string[] = [];
    for (const t of active) {
      if (!groups[t.heading]) {
        groups[t.heading] = [];
        order.push(t.heading);
      }
      groups[t.heading].push(t);
    }
    for (const heading of order) {
      result.push({ title: heading, data: groups[heading] });
    }

    // Completed section
    if (completedToday.length > 0) {
      result.push({
        title: `completed_today`,
        data: completedExpanded ? completedToday : [],
        isCompleted: true,
      });
    }

    return result;
  }, [active, completedToday, completedExpanded]);

  // ── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.loadingText}>Fetching todos...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Green accent bar */}
      <View style={styles.accentBar} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Triumph Todos</Text>
        </View>
        <TouchableOpacity onLongPress={onDisconnect}>
          <Text style={[styles.syncText, { color: syncColor }]}>{syncStatus}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.divider} />

      {/* Progress bar */}
      <ProgressBar done={todayDone} total={todayActive + todayDone} />

      {/* Filters */}
      <View style={styles.toolbar}>
        <View style={styles.filterRow}>
          {(["all", "today", "week"] as FilterMode[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === "week" ? "This Week" : f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>/</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            placeholderTextColor={Colors.textDim}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} style={styles.searchClear}>
              <Text style={styles.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Todo list */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TodoRow todo={item} onToggle={handleToggle} />}
        renderSectionHeader={({ section }) => {
          if (section.isCompleted) {
            const arrow = completedExpanded ? "▾" : "▸";
            return (
              <View>
                <View style={styles.completedDivider} />
                <TouchableOpacity
                  style={styles.completedHeader}
                  onPress={() => setCompletedExpanded(!completedExpanded)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.completedHeaderText}>
                    {arrow}  Completed today
                  </Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{completedToday.length}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            );
          }

          const count = section.data.length;
          return (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}> {count}</Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {search ? "No matches" : "No to-dos"}
            </Text>
            <Text style={styles.emptySubtitle}>
              {search ? "Try a different search." : "Nothing here right now."}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchTodos(true)}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
            progressBackgroundColor={Colors.surface}
          />
        }
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
      />

      {/* Status bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          {active.length} active · {completedToday.length} done today
        </Text>
      </View>
    </SafeAreaView>
  );
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: Colors.textDim,
    marginTop: 12,
    fontSize: 14,
  },
  accentBar: {
    height: 3,
    backgroundColor: Colors.accent,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: Colors.headerBg,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.text,
  },
  syncText: {
    fontSize: 11,
    fontFamily: "monospace",
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  toolbar: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
  },
  filterRow: {
    flexDirection: "row",
    backgroundColor: Colors.surface2,
    borderRadius: 6,
    padding: 2,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 4,
  },
  filterBtnActive: {
    backgroundColor: Colors.surface,
  },
  filterText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textDim,
  },
  filterTextActive: {
    color: Colors.accent,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
  },
  searchIcon: {
    color: Colors.textDim,
    fontSize: 14,
    fontFamily: "monospace",
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    paddingVertical: 10,
  },
  searchClear: {
    padding: 4,
  },
  searchClearText: {
    color: Colors.textDim,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.heading,
  },
  sectionCount: {
    fontSize: 12,
    color: Colors.textDim,
    fontFamily: "monospace",
    marginLeft: 4,
  },
  completedDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginTop: 20,
  },
  completedHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  completedHeaderText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textDim,
  },
  badge: {
    backgroundColor: Colors.surface2,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  badgeText: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 16,
    color: Colors.textDim,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.border,
    marginTop: 4,
  },
  statusBar: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  statusText: {
    fontSize: 12,
    color: Colors.textDim,
  },
});
