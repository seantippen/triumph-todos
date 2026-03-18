/**
 * Raw Notion API client — ported from notion_api.py.
 * No SDK, just fetch.
 */

const NOTION_API_VERSION = "2022-06-28";
const BASE_URL = "https://api.notion.com/v1";
export const PAGE_ID = "29a5bdeb-6ad9-8046-b54f-c69734ecfe6b";

export interface Todo {
  id: string;
  text: string;
  checked: boolean;
  heading: string;
}

export class NotionClient {
  private token: string;
  private headers: Record<string, string>;

  constructor(token: string) {
    this.token = token;
    this.headers = {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    };
  }

  /** Validate token by attempting to read the page */
  async validate(): Promise<boolean> {
    try {
      const resp = await fetch(`${BASE_URL}/blocks/${PAGE_ID}/children?page_size=1`, {
        headers: this.headers,
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** Fetch one page of children. Returns [results, nextCursor]. */
  private async getBlockChildren(
    blockId: string,
    startCursor?: string | null
  ): Promise<[any[], string | null]> {
    const params = new URLSearchParams({ page_size: "100" });
    if (startCursor) params.set("start_cursor", startCursor);

    const url = `${BASE_URL}/blocks/${blockId}/children?${params}`;

    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch(url, { headers: this.headers });
      if (resp.status === 429) {
        const wait = parseFloat(resp.headers.get("Retry-After") || "1");
        await sleep(wait * 1000);
        continue;
      }
      if (!resp.ok) throw new Error(`Notion API ${resp.status}: ${resp.statusText}`);
      const data = await resp.json();
      return [data.results || [], data.next_cursor || null];
    }
    throw new Error("Notion API rate limited after 4 retries");
  }

  /** Paginate through ALL children of a block. */
  private async getAllBlockChildren(blockId: string): Promise<any[]> {
    const all: any[] = [];
    let cursor: string | null = null;
    do {
      const [results, next] = await this.getBlockChildren(blockId, cursor);
      all.push(...results);
      cursor = next;
    } while (cursor);
    return all;
  }

  /**
   * Walk the page tree, collect every to_do block.
   * Mirrors the Python collect_todos logic exactly.
   */
  async collectTodos(pageId: string = PAGE_ID, recentDays = 7): Promise<Todo[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - recentDays);
    const cutoffDate = stripTime(cutoff);

    const todos: Todo[] = [];
    let currentHeading = "Ungrouped";
    let oldHeadingStreak = 0;
    let cursor: string | null = null;

    while (true) {
      const [results, next] = await this.getBlockChildren(pageId, cursor);

      for (const block of results) {
        const btype: string = block.type || "";

        if (["heading_1", "heading_2", "heading_3"].includes(btype)) {
          const headingData = block[btype] || {};
          currentHeading = extractPlainText(headingData.rich_text || []);

          if (!headingIsRecent(currentHeading, cutoffDate)) {
            oldHeadingStreak++;
            if (oldHeadingStreak >= 2) return todos;
            continue;
          } else {
            oldHeadingStreak = 0;
          }

          if (block.has_children) {
            const childTodos = await this.walkChildren(block.id, currentHeading);
            todos.push(...childTodos);
          }
        } else if (btype === "toggle") {
          const toggleText = extractPlainText(block.toggle?.rich_text || []);
          const label = toggleText || currentHeading;
          if (block.has_children) {
            const childTodos = await this.walkChildren(block.id, label);
            todos.push(...childTodos);
          }
        } else if (btype === "to_do") {
          todos.push(parseTodo(block, currentHeading));
        }
      }

      cursor = next;
      if (!cursor) break;
    }

    return todos;
  }

  /** Recursively walk children, collect to-dos. Max depth 3. */
  private async walkChildren(blockId: string, heading: string, depth = 0): Promise<Todo[]> {
    if (depth > 3) return [];

    const todos: Todo[] = [];
    const children = await this.getAllBlockChildren(blockId);

    for (const block of children) {
      const btype: string = block.type || "";

      if (btype === "to_do") {
        todos.push(parseTodo(block, heading));
        if (block.has_children) {
          todos.push(...(await this.walkChildren(block.id, heading, depth + 1)));
        }
      } else if (btype === "toggle") {
        const toggleText = extractPlainText(block.toggle?.rich_text || []);
        const label = toggleText || heading;
        if (block.has_children) {
          todos.push(...(await this.walkChildren(block.id, label, depth + 1)));
        }
      } else if (["heading_1", "heading_2", "heading_3"].includes(btype)) {
        const subHeading = extractPlainText(block[btype]?.rich_text || []);
        if (block.has_children) {
          todos.push(...(await this.walkChildren(block.id, subHeading, depth + 1)));
        }
      } else if (
        ["bulleted_list_item", "numbered_list_item", "paragraph", "callout", "quote", "column", "column_list"].includes(btype)
      ) {
        if (block.has_children && depth < 1) {
          todos.push(...(await this.walkChildren(block.id, heading, depth + 1)));
        }
      }
    }

    return todos;
  }

  /** PATCH a to_do block's checked state. */
  async updateTodoChecked(blockId: string, checked: boolean): Promise<void> {
    const resp = await fetch(`${BASE_URL}/blocks/${blockId}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify({ to_do: { checked } }),
    });
    if (!resp.ok) throw new Error(`Save failed: ${resp.status}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function extractPlainText(richText: any[]): string {
  return richText
    .map((seg) => {
      if (seg.type === "mention" && seg.mention?.type === "date") {
        return seg.mention.date?.start || seg.plain_text || "";
      }
      return seg.plain_text || "";
    })
    .join("")
    .trim();
}

function parseTodo(block: any, heading: string): Todo {
  const todoData = block.to_do || {};
  return {
    id: block.id,
    text: extractPlainText(todoData.rich_text || []),
    checked: todoData.checked || false,
    heading,
  };
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function headingIsRecent(headingText: string, cutoffDate: Date): boolean {
  const match = headingText.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    const headingDate = new Date(match[1] + "T00:00:00");
    return headingDate >= cutoffDate;
  }
  return true; // no date = include it
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
