"""
bearAI Internal Chat - agent tools.

Written by: zapulam
"""

import calendar
import requests

from agents import function_tool
from bs4 import BeautifulSoup
from datetime import datetime
from dotenv import load_dotenv
from langchain_community.vectorstores import SQLiteVec
from typing import Annotated

from repositories import ConnectionsRepository
from settings import settings


_openai_api_key = None
_client = None
_embeddings = None
_llm = None
_db = None

def _ensure_openai_initialized() -> None:
    if not _openai_api_key or _embeddings is None:
        raise RuntimeError("OpenAI API key not configured. Set it in Settings.")

def _get_vector_db() -> SQLiteVec:
    global _db
    _ensure_openai_initialized()
    if _db is None:
        db_path = settings.docs_path
        if not db_path:
            raise RuntimeError("VECTOR_DB_PATH missing")
        connection = SQLiteVec.create_connection(db_file=db_path)
        _db = SQLiteVec(
            table="articles",
            connection=connection,
            embedding=_embeddings
        )
    return _db

def _is_connection_enabled(connection_type: str) -> bool:
    repo = ConnectionsRepository()
    connection = repo.get_connection(connection_type)
    return bool(connection and connection.get("enabled"))



@function_tool()
def get_date_and_time():
    """Gets the current date and time."""
    today = datetime.now()
    date = today.strftime("%Y-%m-%d %H:%M:%S")
    weekday = calendar.day_name[today.weekday()]
    return f"{weekday}, {date}"


@function_tool()
def scrape_website(
        domain: Annotated[str, "The webpage domain to scrape"],
    ) -> str:
    """Scrape a webpage and extract info using optional CSS selectors

    Args:
        domain (str): The webpage domain to scrape

    Returns:
        dict: A dictionary containing the page title, metadata, and extracted data"""
    try:
        response = requests.get(f"https://{domain}", headers={"User-Agent": "Mozilla/5.0"})
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        title = soup.title.string.strip() if soup.title and soup.title.string else "No title found"
        meta_desc = soup.find("meta", attrs={"name": "description"})
        meta_kw = soup.find("meta", attrs={"name": "keywords"})

        meta_description = meta_desc["content"].strip() if meta_desc and meta_desc.get("content") else "No meta description found"
        meta_keywords = meta_kw["content"].strip() if meta_kw and meta_kw.get("content") else "No meta keywords found"

        # Extract headings and paragraphs
        headings = [el.get_text(strip=True) for el in soup.select("h1, h2, h3")]
        paragraphs = [el.get_text(strip=True) for el in soup.select("article p, main p, div[class*='content'] p")]

        formatted_output = [
            f"URL: https://{domain}",
            f"Title: {title}",
            f"Meta Description: {meta_description}",
            f"Meta Keywords: {meta_keywords}",
            "\nHeadings:",
            "\n".join(f"  - {h}" for h in headings) if headings else "  None found",
            "\nMain Content:",
            "\n".join(f"  {p}" for p in paragraphs) if paragraphs else "  None found",
        ]

        return "\n".join(formatted_output)

    except requests.RequestException as e:
        return f"Error fetching {domain}: {e}"


@function_tool()
def search_help_docs(
        query: Annotated[str, "The search query to find relevant help documentation"]
    ) -> str:
    """Searches the help docs vector database.
    
    Args:
        query (str): The search query to find relevant help documentation

    Returns:
        str: Formatted search results with article titles, URLs, and relevant content excerpts"""
    
    db = _get_vector_db()
    results = db.similarity_search_with_score(query, k=15)
    results = [(doc, score) for doc, score in results]
    
    if not results:
        return "No relevant help documentation found for this query."
    
    # Format results
    formatted_results = ["Found relevant help documentation:\n"]
    
    for idx, item in enumerate(results, 1):
        doc, score = item
        title = doc.metadata.get('title', 'Untitled')
        url = doc.metadata.get('url', 'N/A')
        collection = doc.metadata.get('collection', 'Unknown')
        content_preview = doc.page_content[:400].strip()
        
        formatted_results.append(f"\n{idx}. {title}")
        formatted_results.append(f"   Collection: {collection}")
        formatted_results.append(f"   URL: {url}")
        formatted_results.append(f"   Relevance Score: {score:.4f}")
        formatted_results.append(f"   Content: {content_preview}...")
        formatted_results.append("")
    
    return "\n".join(formatted_results)





@function_tool()
def gmail_search_messages(
        query: Annotated[str, "Search query for Gmail messages"],
    ) -> str:
    """Stub Gmail search tool."""
    if not _is_connection_enabled("gmail"):
        return "Gmail connection is disabled. Enable it in Settings to use this tool."
    return f"Gmail tool is enabled but not yet implemented. Query: {query}"


@function_tool()
def gmail_send_email(
        to: Annotated[str, "Recipient email address"],
        subject: Annotated[str, "Email subject"],
        body: Annotated[str, "Email body"],
    ) -> str:
    """Stub Gmail send tool."""
    if not _is_connection_enabled("gmail"):
        return "Gmail connection is disabled. Enable it in Settings to use this tool."
    return f"Gmail tool is enabled but not yet implemented. Drafted email to {to}."


@function_tool()
def outlook_search_messages(
        query: Annotated[str, "Search query for Outlook messages"],
    ) -> str:
    """Stub Outlook search tool."""
    if not _is_connection_enabled("outlook"):
        return "Outlook connection is disabled. Enable it in Settings to use this tool."
    return f"Outlook tool is enabled but not yet implemented. Query: {query}"


@function_tool()
def outlook_send_email(
        to: Annotated[str, "Recipient email address"],
        subject: Annotated[str, "Email subject"],
        body: Annotated[str, "Email body"],
    ) -> str:
    """Stub Outlook send tool."""
    if not _is_connection_enabled("outlook"):
        return "Outlook connection is disabled. Enable it in Settings to use this tool."
    return f"Outlook tool is enabled but not yet implemented. Drafted email to {to}."
