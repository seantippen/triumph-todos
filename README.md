# Triumph Todos

Desktop to-do manager that syncs with a Notion page. Pulls to-do checkbox blocks from your Notion daily work journal and displays them in a native task manager UI.

## Setup

1. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

2. Run the app:
   ```
   python app.py
   ```

3. On first run, paste your Notion integration token when prompted. It's saved to `~/.triumph-todos/config.json`.

   Alternatively, set the `NOTION_TOKEN` environment variable.

## Features

- Groups to-dos by date heading from your Notion page
- Filters: All / Today / This Week
- Show/hide completed items
- Check-off syncs back to Notion in real-time
- Smart polling: pauses when window is unfocused, exponential backoff on idle
- Dark theme with Triumph brand colors

## Dependencies

- Python 3.8+
- `requests` (HTTP client)
- `tkinter` (ships with Python)
