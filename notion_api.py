"""
Raw Notion API client for fetching and updating to-do blocks.
No SDK — uses requests only.
"""

import re
import time
from datetime import datetime, timedelta

import requests

NOTION_API_VERSION = "2022-06-28"
BASE_URL = "https://api.notion.com/v1"

# Target page: Triumph 2026 daily work journal
PAGE_ID = "29a5bdeb-6ad9-8046-b54f-c69734ecfe6b"


class NotionClient:
    def __init__(self, token):
        self.token = token
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_API_VERSION,
            "Content-Type": "application/json",
        })

    # ── Block fetching ───────────────────────────────────────────────

    def get_block_children(self, block_id, start_cursor=None):
        """Fetch one page of children for a block. Returns (results, next_cursor).
        Retries automatically on 429 rate-limit responses."""
        params = {"page_size": 100}
        if start_cursor:
            params["start_cursor"] = start_cursor

        url = f"{BASE_URL}/blocks/{block_id}/children"
        for attempt in range(4):
            resp = self.session.get(url, params=params)
            if resp.status_code == 429:
                wait = float(resp.headers.get("Retry-After", 1))
                time.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            return data.get("results", []), data.get("next_cursor")
        resp.raise_for_status()  # final attempt failed

    def get_all_block_children(self, block_id):
        """Paginate through ALL children of a block."""
        all_blocks = []
        cursor = None
        while True:
            results, cursor = self.get_block_children(block_id, cursor)
            all_blocks.extend(results)
            if not cursor:
                break
        return all_blocks

    # ── Recursive to-do collector ────────────────────────────────────

    def collect_todos(self, page_id=None, recent_days=7):
        """
        Walk the page tree, enter toggle headings, and collect every to_do block.

        Only enters headings with dates within `recent_days` of today.
        Stops paginating top-level blocks once it hits 2 consecutive old-date
        headings (the page is chronological, newest first).

        Returns a list of dicts:
        {
            "id": block_id,
            "text": plain text of the to-do,
            "checked": bool,
            "heading": the parent heading text (date context),
            "rich_text": original rich_text array (for display),
        }
        """
        if page_id is None:
            page_id = PAGE_ID

        cutoff = datetime.now().date() - timedelta(days=recent_days)
        todos = []
        current_heading = "Ungrouped"
        old_heading_streak = 0
        cursor = None

        # Paginate top-level blocks manually so we can stop early
        while True:
            results, cursor = self.get_block_children(page_id, cursor)

            for block in results:
                btype = block.get("type", "")

                if btype in ("heading_1", "heading_2", "heading_3"):
                    heading_data = block.get(btype, {})
                    current_heading = self._extract_plain_text(heading_data.get("rich_text", []))

                    if not self._heading_is_recent(current_heading, cutoff):
                        old_heading_streak += 1
                        if old_heading_streak >= 2:
                            return todos  # stop early — rest of page is older
                        continue
                    else:
                        old_heading_streak = 0

                    if block.get("has_children"):
                        child_todos = self._walk_children(block["id"], current_heading)
                        todos.extend(child_todos)

                elif btype == "toggle":
                    toggle_text = self._extract_plain_text(block.get("toggle", {}).get("rich_text", []))
                    label = toggle_text if toggle_text else current_heading
                    if block.get("has_children"):
                        child_todos = self._walk_children(block["id"], label)
                        todos.extend(child_todos)

                elif btype == "to_do":
                    todos.append(self._parse_todo(block, current_heading))

            if not cursor:
                break

        return todos

    @staticmethod
    def _heading_is_recent(heading_text, cutoff_date):
        """Check if a heading contains a date >= cutoff. No date = recent (keep it)."""
        match = re.search(r'(\d{4}-\d{2}-\d{2})', heading_text)
        if match:
            try:
                heading_date = datetime.strptime(match.group(1), "%Y-%m-%d").date()
                return heading_date >= cutoff_date
            except ValueError:
                pass
        # No parseable date — include it (could be a non-date heading with todos)
        return True

    def _walk_children(self, block_id, heading, depth=0):
        """Recursively walk children of a block and collect to-dos.
        Max depth of 3 prevents runaway recursion into deep bullet nests."""
        if depth > 3:
            return []

        todos = []
        children = self.get_all_block_children(block_id)

        for block in children:
            btype = block.get("type", "")

            if btype == "to_do":
                todos.append(self._parse_todo(block, heading))
                if block.get("has_children"):
                    todos.extend(self._walk_children(block["id"], heading, depth + 1))

            elif btype == "toggle":
                toggle_text = self._extract_plain_text(block.get("toggle", {}).get("rich_text", []))
                label = toggle_text if toggle_text else heading
                if block.get("has_children"):
                    todos.extend(self._walk_children(block["id"], label, depth + 1))

            elif btype in ("heading_1", "heading_2", "heading_3"):
                sub_heading = self._extract_plain_text(block.get(btype, {}).get("rich_text", []))
                if block.get("has_children"):
                    todos.extend(self._walk_children(block["id"], sub_heading, depth + 1))

            # Only recurse into containers if they're shallow — avoids
            # deep meeting-notes bullet trees that never contain to-dos.
            elif btype in ("bulleted_list_item", "numbered_list_item", "paragraph",
                           "callout", "quote", "column", "column_list"):
                if block.get("has_children") and depth < 1:
                    todos.extend(self._walk_children(block["id"], heading, depth + 1))

        return todos

    def _parse_todo(self, block, heading):
        """Extract a to-do block into our standard dict format."""
        todo_data = block.get("to_do", {})
        rich_text = todo_data.get("rich_text", [])
        return {
            "id": block["id"],
            "text": self._extract_plain_text(rich_text),
            "checked": todo_data.get("checked", False),
            "heading": heading,
            "rich_text": rich_text,
        }

    @staticmethod
    def _extract_plain_text(rich_text_array):
        """Pull plain_text from a Notion rich_text array."""
        parts = []
        for segment in rich_text_array:
            text = segment.get("plain_text", "")
            # Handle date mentions
            if segment.get("type") == "mention":
                mention = segment.get("mention", {})
                if mention.get("type") == "date":
                    date_info = mention.get("date", {})
                    text = date_info.get("start", text)
            parts.append(text)
        return "".join(parts).strip()

    # ── Write-back ───────────────────────────────────────────────────

    def update_todo_checked(self, block_id, checked):
        """PATCH a to_do block's checked state back to Notion."""
        url = f"{BASE_URL}/blocks/{block_id}"
        payload = {
            "to_do": {
                "checked": checked,
            }
        }
        resp = self.session.patch(url, json=payload)
        resp.raise_for_status()
        return resp.json()
