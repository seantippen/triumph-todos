"""
Triumph To-Do Manager
Desktop app that syncs to-do items from a Notion page.
"""

import json
import os
import re
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime, timedelta
from pathlib import Path

from notion_api import NotionClient, PAGE_ID

# ── Config ────────────────────────────────────────────────────────────

CONFIG_DIR = Path.home() / ".triumph-todos"
CONFIG_FILE = CONFIG_DIR / "config.json"

# ── Design tokens (Triumph Dashboard Design System) ──────────────────
BG           = "#0a0d12"        # --bg: page background
BG_SURFACE   = "#0e1423"        # --surface: card/panel fill
BG_SURFACE2  = "#121a2a"        # --surface2: elevated surface
BG_INPUT     = "#162033"        # input fields
BORDER       = "#1e2230"        # --border: subtle dividers
HEADER_BG    = "#0a0d12"        # header background

FG_TEXT      = "#e2e8f0"        # --text: primary
FG_DIM       = "#94a3b8"        # --text-dim: secondary
FG_HEADING   = "#34d399"        # --green: heading accent

ACCENT       = "#22c55e"        # --accent: green primary
ACCENT2      = "#3b82f6"        # --accent2: blue secondary
YELLOW       = "#fbbf24"        # --yellow: status/sync indicator
RED          = "#f87171"        # --red: errors

# Typography
FONT         = "Segoe UI"
FONT_MONO    = "Consolas"

# Polling
BASE_REFRESH_MS = 2 * 60 * 1000        # 2 minutes
IDLE_THRESHOLDS = [                      # (idle_minutes, new_interval_ms)
    (10, 5 * 60 * 1000),                # 5 min after 10 min idle
    (20, 10 * 60 * 1000),               # 10 min after 20 min idle
    (30, 30 * 60 * 1000),               # 30 min after 30 min idle
]
FOCUS_STALE_MS = 2 * 60 * 1000          # refresh on focus if >2 min stale


def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    return {}


def save_config(cfg):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


def get_token():
    """Resolve token: env var > config file > None."""
    token = os.environ.get("NOTION_TOKEN")
    if token:
        return token
    cfg = load_config()
    return cfg.get("token")


# ── Setup Window ──────────────────────────────────────────────────────

class SetupWindow:
    def __init__(self):
        self.token = None
        self.root = tk.Tk()
        self.root.title("Triumph Todos — Setup")
        self.root.configure(bg=BG)
        self.root.geometry("480x240")
        self.root.resizable(False, False)

        frame = tk.Frame(self.root, bg=BG, padx=32, pady=24)
        frame.pack(fill="both", expand=True)

        tk.Label(frame, text="Notion Integration Token", font=(FONT, 15, "bold"),
                 fg=FG_TEXT, bg=BG).pack(anchor="w")
        tk.Label(frame, text="Paste your internal integration token below.",
                 font=(FONT, 10), fg=FG_DIM, bg=BG).pack(anchor="w", pady=(4, 12))

        entry_frame = tk.Frame(frame, bg=BORDER, padx=1, pady=1)
        entry_frame.pack(fill="x")
        self.entry = tk.Entry(entry_frame, font=(FONT_MONO, 11), bg=BG_SURFACE, fg=FG_TEXT,
                              insertbackground=FG_TEXT, relief="flat", show="*")
        self.entry.pack(fill="x", ipady=8, padx=1, pady=1)
        self.entry.focus_set()

        btn = tk.Button(frame, text="Save & Connect", font=(FONT, 11, "bold"),
                        bg=ACCENT, fg="#0a0d12", activebackground="#16a34a", relief="flat",
                        cursor="hand2", command=self._save)
        btn.pack(pady=(18, 0), ipadx=24, ipady=5)

        self.root.bind("<Return>", lambda e: self._save())

    def _save(self):
        token = self.entry.get().strip()
        if not token:
            messagebox.showwarning("Missing Token", "Please enter your Notion token.")
            return
        save_config({"token": token})
        self.token = token
        self.root.destroy()

    def run(self):
        self.root.mainloop()
        return self.token


# ── Main App ──────────────────────────────────────────────────────────

class TodoApp:
    def __init__(self, token):
        self.client = NotionClient(token)
        self.todos = []
        self.filter_mode = "all"       # all | today | week
        self._search_query = ""

        # Smart polling state
        self._focused = True
        self._last_sync_time = 0       # timestamp of last successful sync
        self._last_interaction = time.time()
        self._current_refresh_ms = BASE_REFRESH_MS
        self._refresh_after_id = None

        # System tray
        self._tray_icon = None
        self._minimized_to_tray = False

        self._build_ui()
        self._bind_shortcuts()
        self._setup_tray()

    # ── UI Construction ──────────────────────────────────────────────

    def _build_ui(self):
        self.root = tk.Tk()
        self.root.title("Triumph Todos")
        self.root.configure(bg=BG)
        self.root.geometry("620x780")
        self.root.minsize(420, 520)

        # Minimize to tray on close instead of quitting
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        # Window icon (ST monogram)
        try:
            icon_path = Path(__file__).parent / "icon.png"
            if not icon_path.exists():
                icon_path = Path(sys._MEIPASS) / "icon.png"  # PyInstaller bundle
            icon_img = tk.PhotoImage(file=str(icon_path))
            self.root.iconphoto(True, icon_img)
            self._icon_ref = icon_img  # prevent GC
        except Exception:
            pass

        # Focus tracking for smart polling
        self.root.bind("<FocusIn>", self._on_focus_in)
        self.root.bind("<FocusOut>", self._on_focus_out)

        # Track user interactions for idle detection
        self.root.bind("<Button-1>", self._on_interaction)
        self.root.bind("<MouseWheel>", self._on_interaction)
        self.root.bind("<Key>", self._on_interaction)

        # ── Header ───────────────────────────────────────────────────
        header_outer = tk.Frame(self.root, bg=BG)
        header_outer.pack(fill="x")

        # Green accent bar at top (like dashboard KPI gradient)
        accent_bar = tk.Frame(header_outer, bg=ACCENT, height=3)
        accent_bar.pack(fill="x")

        header = tk.Frame(header_outer, bg=HEADER_BG, padx=20, pady=14)
        header.pack(fill="x")

        title_frame = tk.Frame(header, bg=HEADER_BG)
        title_frame.pack(side="left")
        tk.Label(title_frame, text="Triumph Todos", font=(FONT, 17, "bold"),
                 fg=FG_TEXT, bg=HEADER_BG).pack(side="left")

        right_frame = tk.Frame(header, bg=HEADER_BG)
        right_frame.pack(side="right")
        self.status_label = tk.Label(right_frame, text="Loading...",
                                     font=(FONT_MONO, 9), fg=YELLOW, bg=HEADER_BG)
        self.status_label.pack(side="right")

        # Subtle border under header
        tk.Frame(header_outer, bg=BORDER, height=1).pack(fill="x")

        # ── Progress bar (today's completion) ────────────────────────
        self._progress_frame = tk.Frame(self.root, bg=BG, padx=20, pady=(8, 0))
        self._progress_frame.pack(fill="x")

        progress_inner = tk.Frame(self._progress_frame, bg=BG)
        progress_inner.pack(fill="x")

        self._progress_label = tk.Label(progress_inner, text="Today: 0/0",
                                        font=(FONT_MONO, 9), fg=FG_DIM, bg=BG)
        self._progress_label.pack(side="left")

        self._progress_pct = tk.Label(progress_inner, text="",
                                      font=(FONT_MONO, 9, "bold"), fg=ACCENT, bg=BG)
        self._progress_pct.pack(side="right")

        # Track bar — outer (bg) and inner (fill)
        bar_outer = tk.Frame(self._progress_frame, bg=BG_SURFACE2, height=6)
        bar_outer.pack(fill="x", pady=(4, 0))
        bar_outer.pack_propagate(False)

        self._progress_bar_outer = bar_outer
        self._progress_bar = tk.Frame(bar_outer, bg=ACCENT, height=6)
        self._progress_bar.place(relx=0, rely=0, relwidth=0, relheight=1)

        # ── Toolbar ──────────────────────────────────────────────────
        toolbar = tk.Frame(self.root, bg=BG, padx=20, pady=8)
        toolbar.pack(fill="x")

        filter_frame = tk.Frame(toolbar, bg=BG_SURFACE2, padx=2, pady=2)
        filter_frame.pack(side="left")

        self.filter_var = tk.StringVar(value="all")
        self._filter_buttons = {}
        filters = [("All", "all"), ("Today", "today"), ("This Week", "week")]
        for label, val in filters:
            rb = tk.Radiobutton(
                filter_frame, text=label, variable=self.filter_var, value=val,
                font=(FONT, 9, "bold"), fg=FG_DIM, bg=BG_SURFACE2,
                selectcolor=BG_SURFACE, activebackground=BG_SURFACE,
                activeforeground=ACCENT, indicatoron=0, padx=14, pady=5,
                relief="flat", bd=0, cursor="hand2",
                command=self._on_filter_change,
            )
            rb.pack(side="left", padx=1)
            self._filter_buttons[val] = rb

        # "Completed" section expanded/collapsed state
        self._completed_expanded = False

        refresh_btn = tk.Button(
            toolbar, text="Refresh", font=(FONT, 9),
            fg=FG_DIM, bg=BG_SURFACE2, activebackground=BG_SURFACE,
            activeforeground=FG_TEXT, relief="flat", bd=0,
            cursor="hand2", padx=12, pady=4,
            command=self._trigger_refresh,
        )
        refresh_btn.pack(side="right")

        # ── Search box ───────────────────────────────────────────────
        search_frame = tk.Frame(self.root, bg=BG, padx=20, pady=(0, 4))
        search_frame.pack(fill="x")

        search_border = tk.Frame(search_frame, bg=BORDER, padx=1, pady=1)
        search_border.pack(fill="x")

        search_inner = tk.Frame(search_border, bg=BG_SURFACE)
        search_inner.pack(fill="x")

        tk.Label(search_inner, text=" /", font=(FONT_MONO, 10), fg=FG_DIM,
                 bg=BG_SURFACE).pack(side="left")

        self._search_var = tk.StringVar()
        self._search_var.trace_add("write", self._on_search_change)
        self._search_entry = tk.Entry(
            search_inner, textvariable=self._search_var,
            font=(FONT, 10), bg=BG_SURFACE, fg=FG_TEXT,
            insertbackground=FG_TEXT, relief="flat", bd=0,
        )
        self._search_entry.pack(side="left", fill="x", expand=True, ipady=6, padx=(2, 8))

        self._search_clear = tk.Label(
            search_inner, text="x", font=(FONT, 9), fg=FG_DIM,
            bg=BG_SURFACE, cursor="hand2", padx=8,
        )
        self._search_clear.bind("<Button-1>", lambda e: self._clear_search())

        # ── Scrollable todo list ─────────────────────────────────────
        container = tk.Frame(self.root, bg=BG)
        container.pack(fill="both", expand=True, padx=20, pady=(4, 0))

        self.canvas = tk.Canvas(container, bg=BG, highlightthickness=0, bd=0)
        scrollbar = tk.Scrollbar(container, orient="vertical", command=self.canvas.yview,
                                 bg=BG_SURFACE, troughcolor=BG,
                                 activebackground=FG_DIM, width=8)
        self.scroll_frame = tk.Frame(self.canvas, bg=BG)

        self.scroll_frame.bind("<Configure>",
                               lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self._canvas_window = self.canvas.create_window((0, 0), window=self.scroll_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        # Keep scroll_frame width in sync with canvas
        self.canvas.bind("<Configure>", self._on_canvas_resize)

        # Mousewheel scrolling
        self.canvas.bind_all("<MouseWheel>",
                             lambda e: self.canvas.yview_scroll(-1 * (e.delta // 120), "units"))

        self.canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # ── Status bar ───────────────────────────────────────────────
        status_bar = tk.Frame(self.root, bg=BG_SURFACE, padx=20, pady=6)
        status_bar.pack(fill="x", side="bottom")
        tk.Frame(self.root, bg=BORDER, height=1).pack(fill="x", side="bottom")

        self.count_label = tk.Label(status_bar, text="", font=(FONT, 9),
                                    fg=FG_DIM, bg=BG_SURFACE)
        self.count_label.pack(side="left")

        self._shortcut_hint = tk.Label(
            status_bar, text="Ctrl+F search  ·  Ctrl+R refresh  ·  Ctrl+1/2/3 filter",
            font=(FONT, 8), fg="#475569", bg=BG_SURFACE,
        )
        self._shortcut_hint.pack(side="right")

    def _on_canvas_resize(self, event):
        """Keep scroll_frame filling the canvas width."""
        self.canvas.itemconfig(self._canvas_window, width=event.width)

    # ── Keyboard Shortcuts ────────────────────────────────────────────

    def _bind_shortcuts(self):
        self.root.bind("<Control-r>", lambda e: self._trigger_refresh())
        self.root.bind("<Control-f>", lambda e: self._focus_search())
        self.root.bind("<Control-e>", lambda e: self._toggle_completed_section())
        self.root.bind("<Control-Key-1>", lambda e: self._set_filter("all"))
        self.root.bind("<Control-Key-2>", lambda e: self._set_filter("today"))
        self.root.bind("<Control-Key-3>", lambda e: self._set_filter("week"))
        self.root.bind("<Escape>", lambda e: self._on_escape())

    def _focus_search(self):
        self._search_entry.focus_set()

    def _set_filter(self, mode):
        self.filter_var.set(mode)
        self._on_filter_change()

    def _on_escape(self):
        """Escape clears search if active, otherwise unfocuses."""
        if self._search_var.get():
            self._clear_search()
        else:
            self.root.focus_set()

    # ── Search ────────────────────────────────────────────────────────

    def _on_search_change(self, *args):
        self._search_query = self._search_var.get().strip().lower()
        # Show/hide clear button
        if self._search_query:
            self._search_clear.pack(side="right")
        else:
            self._search_clear.pack_forget()
        self._render_todos()

    def _clear_search(self):
        self._search_var.set("")
        self.root.focus_set()

    # ── System Tray ───────────────────────────────────────────────────

    def _setup_tray(self):
        """Set up system tray icon using pystray (if available)."""
        try:
            import pystray
            from PIL import Image
            self._pystray = pystray
            self._PIL_Image = Image

            # Load icon for tray
            icon_path = Path(__file__).parent / "icon.png"
            if not icon_path.exists():
                icon_path = Path(sys._MEIPASS) / "icon.png"
            self._tray_image = Image.open(str(icon_path))

            # Build tray icon (don't start yet — starts on minimize)
            self._tray_ready = True
        except ImportError:
            self._tray_ready = False

    def _on_close(self):
        """Minimize to tray on close (if available), otherwise quit."""
        if self._tray_ready:
            self._minimize_to_tray()
        else:
            self._quit()

    def _minimize_to_tray(self):
        """Hide window and show tray icon."""
        import pystray
        self.root.withdraw()
        self._minimized_to_tray = True

        menu = pystray.Menu(
            pystray.MenuItem("Open", self._restore_from_tray, default=True),
            pystray.MenuItem("Refresh", lambda: self.root.after(0, self._trigger_refresh)),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._quit_from_tray),
        )

        self._tray_icon = pystray.Icon(
            "triumph-todos", self._tray_image, "Triumph Todos", menu,
        )
        threading.Thread(target=self._tray_icon.run, daemon=True).start()

    def _restore_from_tray(self, icon=None, item=None):
        """Restore window from tray."""
        if self._tray_icon:
            self._tray_icon.stop()
            self._tray_icon = None
        self._minimized_to_tray = False
        self.root.after(0, self._do_restore)

    def _do_restore(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()
        # Trigger refresh if stale
        elapsed_ms = (time.time() - self._last_sync_time) * 1000
        if elapsed_ms > FOCUS_STALE_MS:
            self._trigger_refresh()

    def _quit_from_tray(self, icon=None, item=None):
        if self._tray_icon:
            self._tray_icon.stop()
        self.root.after(0, self._quit)

    def _quit(self):
        self.root.destroy()

    # ── Smart Polling ────────────────────────────────────────────────

    def _on_focus_in(self, event):
        # Only respond to root window focus, not child widget focus
        if event.widget is not self.root:
            return
        self._focused = True
        self._on_interaction()
        # Refresh immediately if stale
        elapsed_ms = (time.time() - self._last_sync_time) * 1000
        if elapsed_ms > FOCUS_STALE_MS:
            self._trigger_refresh()

    def _on_focus_out(self, event):
        if event.widget is not self.root:
            return
        self._focused = False

    def _on_interaction(self, event=None):
        """Reset idle timer on any user interaction."""
        self._last_interaction = time.time()
        if self._current_refresh_ms != BASE_REFRESH_MS:
            self._current_refresh_ms = BASE_REFRESH_MS
            self._schedule_refresh()

    def _get_refresh_interval(self):
        """Calculate refresh interval based on idle time."""
        idle_seconds = time.time() - self._last_interaction
        idle_minutes = idle_seconds / 60

        interval = BASE_REFRESH_MS
        for threshold_min, threshold_ms in IDLE_THRESHOLDS:
            if idle_minutes >= threshold_min:
                interval = threshold_ms
        return interval

    def _schedule_refresh(self):
        """Cancel any pending refresh and schedule a new one."""
        if self._refresh_after_id:
            self.root.after_cancel(self._refresh_after_id)

        self._current_refresh_ms = self._get_refresh_interval()
        self._refresh_after_id = self.root.after(self._current_refresh_ms, self._auto_refresh)

    def _auto_refresh(self):
        """Called by the timer. Only refresh if focused."""
        if self._focused:
            self._trigger_refresh()
        else:
            # Reschedule — will pick up focus-regain via _on_focus_in
            self._schedule_refresh()

    def _trigger_refresh(self):
        """Start a background refresh."""
        self.status_label.config(text="Syncing...", fg=YELLOW)
        threading.Thread(target=self._fetch_todos, daemon=True).start()

    # ── Data Fetching ────────────────────────────────────────────────

    def _fetch_todos(self):
        """Fetch todos in background thread, update UI on main thread."""
        try:
            todos = self.client.collect_todos()
            self.root.after(0, self._update_todos, todos, None)
        except Exception as e:
            self.root.after(0, self._update_todos, None, e)

    def _update_todos(self, todos, error):
        """Update the UI with fetched todos (runs on main thread)."""
        if error:
            self.status_label.config(text=f"Error: {error}", fg=RED)
            self._schedule_refresh()
            return

        self.todos = todos
        self._last_sync_time = time.time()
        ts = datetime.now().strftime("%I:%M %p")
        self.status_label.config(text=f"Synced {ts}", fg=FG_DIM)
        self._render_todos()
        self._schedule_refresh()

    # ── Filtering ────────────────────────────────────────────────────

    def _on_filter_change(self):
        self.filter_mode = self.filter_var.get()
        self._render_todos()

    def _filter_todos(self):
        """Apply current filter and split into (active, completed_today) lists.
        Completed tasks from previous days are dropped entirely."""
        today_str = datetime.now().strftime("%Y-%m-%d")

        # Apply date filter first
        source = self.todos
        if self.filter_mode == "today":
            source = [t for t in source if today_str in t["heading"]]
        elif self.filter_mode == "week":
            today = datetime.now().date()
            monday = today - timedelta(days=today.weekday())
            sunday = monday + timedelta(days=6)
            source = [t for t in source if self._heading_in_range(t["heading"], monday, sunday)]

        # Apply search filter
        if self._search_query:
            q = self._search_query
            source = [t for t in source if q in t["text"].lower() or q in t["heading"].lower()]

        active = []
        completed_today = []

        for t in source:
            if not t["checked"]:
                active.append(t)
            else:
                # Only keep completed tasks if they're from today (or no parseable date)
                date_match = re.search(r'(\d{4}-\d{2}-\d{2})', t["heading"])
                if date_match:
                    if date_match.group(1) == today_str:
                        completed_today.append(t)
                    # else: stale completed — drop it
                else:
                    # No date in heading — keep it so it doesn't vanish silently
                    completed_today.append(t)

        return active, completed_today

    @staticmethod
    def _heading_in_range(heading, start_date, end_date):
        """Check if heading contains a date within the given range."""
        match = re.search(r'(\d{4}-\d{2}-\d{2})', heading)
        if match:
            try:
                heading_date = datetime.strptime(match.group(1), "%Y-%m-%d").date()
                return start_date <= heading_date <= end_date
            except ValueError:
                pass
        return False

    # ── Progress Bar ──────────────────────────────────────────────────

    def _update_progress(self, active_count, completed_count):
        """Update the today's progress bar."""
        total = active_count + completed_count
        if total == 0:
            self._progress_label.config(text="Today: no tasks")
            self._progress_pct.config(text="")
            self._progress_bar.place(relwidth=0)
            return

        pct = completed_count / total
        self._progress_label.config(text=f"Today: {completed_count}/{total} done")
        self._progress_pct.config(text=f"{int(pct * 100)}%")
        self._progress_bar.place(relx=0, rely=0, relwidth=pct, relheight=1)

        # Color shifts: low=dim, medium=blue, high=green
        if pct >= 0.75:
            self._progress_bar.config(bg=ACCENT)
            self._progress_pct.config(fg=ACCENT)
        elif pct >= 0.4:
            self._progress_bar.config(bg=ACCENT2)
            self._progress_pct.config(fg=ACCENT2)
        else:
            self._progress_bar.config(bg=FG_DIM)
            self._progress_pct.config(fg=FG_DIM)

    # ── Rendering ────────────────────────────────────────────────────

    def _render_todos(self):
        """Rebuild the scrollable todo list with collapsible completed section."""
        for widget in self.scroll_frame.winfo_children():
            widget.destroy()

        active, completed_today = self._filter_todos()

        # Update progress bar with today's numbers (unfiltered by search)
        today_str = datetime.now().strftime("%Y-%m-%d")
        today_active = sum(1 for t in self.todos
                           if not t["checked"] and today_str in t["heading"])
        today_done = sum(1 for t in self.todos
                         if t["checked"] and today_str in t["heading"])
        self._update_progress(today_active, today_done)

        if not active and not completed_today:
            empty = tk.Frame(self.scroll_frame, bg=BG, pady=60)
            empty.pack(fill="x")
            msg = "No matches" if self._search_query else "No to-dos"
            sub = "Try a different search." if self._search_query else "Nothing here right now."
            tk.Label(empty, text=msg, font=(FONT, 13), fg=FG_DIM, bg=BG).pack()
            tk.Label(empty, text=sub, font=(FONT, 10), fg=BORDER, bg=BG).pack(pady=(4, 0))
            self.count_label.config(text="0 items")
            return

        # ── Active todos grouped by heading ───────────────────────
        if active:
            groups = {}
            for todo in active:
                h = todo["heading"]
                if h not in groups:
                    groups[h] = []
                groups[h].append(todo)

            first_group = True
            for heading, items in groups.items():
                # Section heading with count badge
                hf = tk.Frame(self.scroll_frame, bg=BG)
                hf.pack(fill="x", pady=(4 if first_group else 16, 6))
                first_group = False

                tk.Label(hf, text=heading, font=(FONT, 11, "bold"),
                         fg=FG_HEADING, bg=BG).pack(side="left")
                tk.Label(hf, text=f" {len(items)}", font=(FONT_MONO, 9),
                         fg=FG_DIM, bg=BG).pack(side="left", padx=(4, 0))

                for todo in items:
                    self._render_todo_row(todo)

        # ── Collapsible completed section ─────────────────────────
        if completed_today:
            sep = tk.Frame(self.scroll_frame, bg=BORDER, height=1)
            sep.pack(fill="x", pady=(20, 0))

            arrow = "▾" if self._completed_expanded else "▸"
            toggle_frame = tk.Frame(self.scroll_frame, bg=BG, pady=6)
            toggle_frame.pack(fill="x")

            toggle_btn = tk.Label(
                toggle_frame,
                text=f"{arrow}  Completed today",
                font=(FONT, 10, "bold"), fg=FG_DIM, bg=BG,
                cursor="hand2",
            )
            toggle_btn.pack(side="left")

            badge = tk.Label(
                toggle_frame, text=f" {len(completed_today)} ",
                font=(FONT_MONO, 8), fg=ACCENT, bg=BG_SURFACE2,
            )
            badge.pack(side="left", padx=(6, 0))

            # Bind click on the whole frame
            for w in (toggle_frame, toggle_btn, badge):
                w.bind("<Button-1>", lambda e: self._toggle_completed_section())
                w.configure(cursor="hand2")

            if self._completed_expanded:
                for todo in completed_today:
                    self._render_todo_row(todo)

        self.count_label.config(
            text=f"{len(active)} active  ·  {len(completed_today)} done today"
        )

    def _toggle_completed_section(self):
        """Toggle the completed section open/closed."""
        self._completed_expanded = not self._completed_expanded
        self._render_todos()

    def _render_todo_row(self, todo):
        """Render a single to-do item as a card row."""
        checked = todo["checked"]

        # Card-style row with surface background and subtle border
        outer = tk.Frame(self.scroll_frame, bg=BORDER, padx=1, pady=0)
        outer.pack(fill="x", pady=(0, 2))

        row_bg = BG_SURFACE2 if checked else BG_SURFACE
        row = tk.Frame(outer, bg=row_bg, padx=14, pady=8)
        row.pack(fill="x")

        # Left accent pip for unchecked items
        if not checked:
            pip = tk.Frame(row, bg=ACCENT, width=3)
            pip.pack(side="left", fill="y", padx=(0, 10))

        var = tk.BooleanVar(value=checked)
        cb = tk.Checkbutton(
            row, variable=var, bg=row_bg, activebackground=row_bg,
            selectcolor=row_bg, relief="flat",
            command=lambda: self._toggle_todo(todo, var),
        )
        cb.pack(side="left")

        text = todo["text"]
        fg = FG_DIM if checked else FG_TEXT
        font_style = (FONT, 10, "overstrike") if checked else (FONT, 10)

        label = tk.Label(row, text=text, font=font_style, fg=fg, bg=row_bg,
                         wraplength=460, justify="left", anchor="w")
        label.pack(side="left", fill="x", expand=True, padx=(6, 0))

    # ── Check-off Write-back ─────────────────────────────────────────

    def _toggle_todo(self, todo, var):
        """Toggle a to-do's checked state and sync to Notion."""
        new_checked = var.get()
        todo["checked"] = new_checked
        self._on_interaction()

        # Update UI immediately
        self._render_todos()

        # Sync to Notion in background
        self.status_label.config(text="Saving...", fg=YELLOW)

        def sync():
            try:
                self.client.update_todo_checked(todo["id"], new_checked)
                ts = datetime.now().strftime('%I:%M %p')
                self.root.after(0, lambda: self.status_label.config(
                    text=f"Saved {ts}", fg=ACCENT))
            except Exception as e:
                self.root.after(0, lambda: self.status_label.config(
                    text=f"Save error: {e}", fg=RED))

        threading.Thread(target=sync, daemon=True).start()

    # ── Run ──────────────────────────────────────────────────────────

    def run(self):
        # Initial fetch
        self._trigger_refresh()
        self.root.mainloop()


# ── Entry Point ───────────────────────────────────────────────────────

def main():
    token = get_token()

    if not token:
        setup = SetupWindow()
        token = setup.run()
        if not token:
            print("No token provided. Exiting.")
            sys.exit(1)

    app = TodoApp(token)
    app.run()


if __name__ == "__main__":
    main()
