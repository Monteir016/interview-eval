"""Function-calling tools for JD-aware question generation.

Each tool returns a string (or JSON-encoded structure as a string) so the
result can be appended directly as a `tool` role message in the chat history.
On failure, tools return an error string rather than raising — the LLM can
read the error and adapt instead of crashing the loop.
"""
import json
from typing import Any

from tavily import TavilyClient

from app.config import settings

_client: TavilyClient | None = None


def _tavily() -> TavilyClient:
    global _client
    if _client is None:
        if not settings.tavily_api_key:
            raise RuntimeError(
                "TAVILY_API_KEY not set in .env — required for question generation."
            )
        _client = TavilyClient(api_key=settings.tavily_api_key)
    return _client


# Cap on extracted content to keep tool messages bounded (~2K tokens).
_JD_CHAR_LIMIT = 8000
_SEARCH_RESULT_CHAR_LIMIT = 1000
_SEARCH_MAX_RESULTS = 5


def fetch_jd(url: str) -> str:
    """Fetch and clean the text content of a job description from a URL."""
    import time
    last_error: str = ""
    for attempt in range(2):
        try:
            response = _tavily().extract(urls=[url])
            results = response.get("results") or []
            if results:
                text = results[0].get("raw_content") or ""
                if text.strip():
                    return text[:_JD_CHAR_LIMIT]
            last_error = f"no content extracted from {url}"
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
        if attempt == 0:
            time.sleep(2)
    return f"ERROR fetching {url}: {last_error}"


def search_company(query: str) -> str:
    """Search the web for company context. Returns JSON-encoded list of results."""
    try:
        response = _tavily().search(
            query=query,
            max_results=_SEARCH_MAX_RESULTS,
            search_depth="basic",
        )
    except Exception as e:
        return f"ERROR searching '{query}': {type(e).__name__}: {e}"
    results: list[dict[str, Any]] = [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "content": (r.get("content") or "")[:_SEARCH_RESULT_CHAR_LIMIT],
        }
        for r in response.get("results", [])
    ]
    return json.dumps(results, ensure_ascii=False)
