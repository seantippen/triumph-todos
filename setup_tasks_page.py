"""
One-time setup: creates a "Quick Tasks" page in Notion and saves its ID.

Run this once:
    python setup_tasks_page.py

It will:
1. Create a child page under your daily work journal
2. Save the page ID to ~/.triumph-todos/config.json
3. Print the ID so you can set it as a Cloudflare Pages env var (TASKS_PAGE_ID)
"""

import json
import sys
from pathlib import Path

import requests

from notion_api import PAGE_ID, NOTION_API_VERSION

CONFIG_DIR = Path.home() / ".triumph-todos"
CONFIG_FILE = CONFIG_DIR / "config.json"


def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    return {}


def save_config(cfg):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


def main():
    cfg = load_config()
    token = cfg.get("token")

    if not token:
        print("No Notion token found in config. Run the app first to set it up.")
        sys.exit(1)

    # Check if already created
    if cfg.get("tasks_page_id"):
        print(f"Tasks page already exists: {cfg['tasks_page_id']}")
        print(f"Set this as TASKS_PAGE_ID in Cloudflare Pages.")
        return

    # Create the page
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
    }

    payload = {
        "parent": {"page_id": PAGE_ID},
        "properties": {
            "title": [{"text": {"content": "Quick Tasks"}}]
        },
        "icon": {"type": "emoji", "emoji": "⚡"},
        "children": [
            {
                "object": "block",
                "type": "callout",
                "callout": {
                    "icon": {"type": "emoji", "emoji": "📝"},
                    "rich_text": [{"text": {"content": "Tasks added from the Triumph Todos app appear here."}}],
                },
            }
        ],
    }

    resp = requests.post(
        "https://api.notion.com/v1/pages",
        headers=headers,
        json=payload,
    )

    if not resp.ok:
        print(f"Error creating page: {resp.status_code}")
        print(resp.text)
        sys.exit(1)

    page_id = resp.json()["id"]

    # Save to config
    cfg["tasks_page_id"] = page_id
    save_config(cfg)

    print(f"Created Quick Tasks page: {page_id}")
    print()
    print("Next step: set this as a Cloudflare Pages environment variable:")
    print(f"  TASKS_PAGE_ID = {page_id}")


if __name__ == "__main__":
    main()
